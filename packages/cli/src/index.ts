import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDiff, strykerRanges } from '../../review-core/src/scope.js';
import { mutationMetrics, normalizeStrykerReport, evaluateGate } from '../../review-core/src/report.js';
import { preflight, retrieveLessons, type ApprovedLesson } from '../../review-core/src/preflight.js';
import type { MutationScope, NormalizedMutant } from '../../review-core/src/types.js';
import { execute } from './runner.js';
import { digest, makeProposal, verifySandbox } from './proof.js';
import { runAssisted } from './workflow.js';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 8_000_000 }).trim();
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = async (path: string, value: unknown) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
const LIMITS = { files: 5, changedLines: 100, mutants: 64, runtimeMs: 180_000, concurrency: 2, modelCalls: 3, repairAttempts: 2 };
const protectedPath = (path: string) => /^(?:\.gitlab-ci\.yml|\.gitlab\/|\.mutant-review\/policy\.json|packages\/(?:review-core|cli|gitlab-adapter)\/|package(?:-lock)?\.json$|vitest(?:\.domain)?\.config\.ts$|stryker\.config\.json$)/.test(path);

async function relevantLessons(query: string) {
  const names = await readdir('.mutant-review/lessons').catch(() => []);
  const records: ApprovedLesson[] = [];
  for (const name of names.filter((name) => name.endsWith('.json'))) {
    try { records.push(await json(`.mutant-review/lessons/${name}`)); } catch { /* malformed lesson is never approved evidence */ }
  }
  return retrieveLessons(records, { repository: process.env.CI_PROJECT_PATH ?? 'mutant-review', module: 'demo-domain', symbol: query, tags: ['inclusive-threshold', query], source: await readFile('packages/demo-domain/src/shipping.ts', 'utf8') });
}

async function review(demo: boolean) {
  const started = Date.now();
  await mkdir('evidence', { recursive: true });
  const headSha = demo ? git('rev-parse', 'HEAD') : process.env.CI_COMMIT_SHA;
  const baseSha = demo ? null : process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  if (!headSha || (!demo && (!baseSha || !process.env.CI_MERGE_REQUEST_IID || !process.env.CI_PROJECT_ID))) {
    throw new Error('MR review requires CI_COMMIT_SHA, CI_MERGE_REQUEST_DIFF_BASE_SHA, CI_MERGE_REQUEST_IID, and CI_PROJECT_ID. Use demo for an explicitly local fixture.');
  }
  const shaPattern = /^[a-f0-9]{40,64}$/;
  if (!shaPattern.test(headSha) || (baseSha && !shaPattern.test(baseSha))) throw new Error('Invalid revision format');
  if (git('rev-parse', 'HEAD') !== headSha) throw new Error('Checkout does not match the recorded source head');
  if (!demo && git('status', '--porcelain', '--untracked-files=no')) throw new Error('MR checkout has modified tracked files; evidence would not match its revision');
  let scope: MutationScope[];
  if (demo) {
    scope = [{ path: 'packages/demo-domain/src/shipping.ts', lines: [{ start: 3, end: 5 }], change: 'modified' }];
  } else {
    try { git('cat-file', '-e', `${baseSha}^{commit}`); } catch { git('fetch', '--no-tags', 'origin', baseSha!); }
    scope = parseDiff(git('diff', '--no-ext-diff', '--unified=0', '--find-renames', baseSha!, headSha, '--'));
  }
  const scopeLines = scope.reduce((sum, file) => sum + file.lines.reduce((n, lines) => n + lines.end - lines.start + 1, 0), 0);
  const protectedChanges = demo ? false : git('diff', '--name-only', baseSha!, headSha, '--').split('\n').some(protectedPath);
  const policy = await json('.mutant-review/policy.json').catch(() => ({ version: '1', threshold: 100 }));
  const provenance = {
    projectId: process.env.CI_PROJECT_ID ?? null,
    mrIid: process.env.CI_MERGE_REQUEST_IID ? Number(process.env.CI_MERGE_REQUEST_IID) : null,
    headSha,
    baseSha,
    pipelineId: process.env.CI_PIPELINE_ID ?? null,
    jobId: process.env.CI_JOB_ID ?? null,
    pipelineUrl: process.env.CI_PIPELINE_URL ?? null,
    projectUrl: process.env.CI_PROJECT_URL ?? null,
    policyVersion: String(policy.version ?? '1'),
    toolchain: { node: process.version, vitest: '3.2.7', stryker: '10.1.1' },
    scopeKind: demo ? 'local demonstration fixture; not an MR comparison' : 'merge request changed source',
    workingTreeHash: digest(await readFile('packages/demo-domain/src/shipping.ts', 'utf8')),
  };
  const testPaths = demo ? ['packages/demo-domain/src/shipping.test.ts', 'packages/demo-domain/src/discount.test.ts'] : git('diff', '--name-only', '--diff-filter=AM', baseSha!, headSha, '--').split('\n').filter((path) => /\.(?:test|spec)\.ts$/.test(path));
  const preflightResults = await Promise.all(testPaths.map(async (path) => ({ path, findings: preflight(await readFile(path, 'utf8')) })));
  const retrievedLessons = await relevantLessons('shippingFee');
  await rm('evidence/baseline.json', { force: true });
  await rm('evidence/coverage/coverage-summary.json', { force: true });
  const baselineRun = await execute(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.domain.config.ts', '--coverage', '--reporter=json', '--outputFile=evidence/baseline.json'], 'evidence/baseline.log');
  const baselineRaw = await json('evidence/baseline.json').catch(() => null);
  const coverage = await json('evidence/coverage/coverage-summary.json').catch(() => null);
  const baselinePassed = baselineRun.exitCode === 0 && !baselineRun.timedOut && baselineRaw?.success === true;
  const scopeWithinBudget = scope.length <= LIMITS.files && scopeLines <= LIMITS.changedLines;
  let mutationRun: Awaited<ReturnType<typeof execute>> | null = null;
  let mutants: NormalizedMutant[] = [];
  let rawReport: Record<string, unknown> | null = null;
  let cacheKey: string | null = null;
  const skippedReason = !baselinePassed ? 'Inconclusive: the unmodified test suite failed.' : !scope.length ? 'Changed-source mode has no applicable source scope.' : !scopeWithinBudget ? 'The MR scope exceeds the configured file or line budget.' : null;
  if (!skippedReason) {
    const config = await json('stryker.config.json');
    config.mutate = strykerRanges(scope);
    config.incremental = !demo;
    config.incrementalFile = 'evidence/incremental/mutation.json';
    config.jsonReporter = { fileName: 'evidence/mutation/mutation.json' };
    // Dependency, runner, policy, snapshot, environment and toolchain changes invalidate reuse.
    const sensitiveFiles = git('ls-files').split('\n').filter((path) => /(?:package(?:-lock)?\.json|vitest.*\.[cm]?[jt]s|stryker.*\.json|policy\.json|\.snap)$/.test(path));
    const keyParts = await Promise.all(sensitiveFiles.map(async (path) => `${path}:${digest(await readFile(path, 'utf8'))}`));
    cacheKey = digest(JSON.stringify({ keyParts, node: process.version, platform: process.platform, env: { NODE_ENV: process.env.NODE_ENV, TZ: process.env.TZ }, toolchain: provenance.toolchain }));
    const previous = await json('evidence/incremental/key.json').catch(() => null);
    if (previous?.cacheKey !== cacheKey) await rm('evidence/incremental/mutation.json', { force: true });
    await save('evidence/stryker.current.json', config);
    await rm('evidence/mutation/mutation.json', { force: true });
    mutationRun = await execute(['node_modules/@stryker-mutator/core/bin/stryker.js', 'run', 'evidence/stryker.current.json'], 'evidence/mutation.log', LIMITS.runtimeMs);
    rawReport = await json('evidence/mutation/mutation.json').catch(() => null);
    if (rawReport) mutants = normalizeStrykerReport(rawReport as never, scope, { headSha, ...(baseSha ? { baseSha } : {}), toolchain: provenance.toolchain, fresh: demo });
    await save('evidence/incremental/key.json', { cacheKey });
  }
  const metrics = mutationMetrics(mutants);
  const complete = Boolean(!skippedReason && mutationRun?.exitCode === 0 && !mutationRun.timedOut && rawReport && metrics.total <= LIMITS.mutants && metrics.pending === 0 && metrics.invalid === 0);
  const threshold = policy.mutationThreshold ?? 100;
  const gate = evaluateGate({ baselinePassed, complete, expectedHeadSha: headSha, evidenceHeadSha: headSha, metrics, threshold, actionableSurvivors: metrics.survived, protectedFilesChanged: protectedChanges });
  const targeted = mutants.find((mutant) => mutant.status === 'Survived' && mutant.operator === 'EqualityOperator' && mutant.replacement === 'subtotalCents > 10_000' && mutant.path === 'packages/demo-domain/src/shipping.ts');
  const proposal = targeted ? await makeProposal() : null;
  // Automatic sandbox execution is only a local engineering proof, never repair authorization.
  const verification = demo && proposal ? await verifySandbox(proposal) : { status: 'not_run', scope: 'Awaiting separate verification approval', originalPasses: false, mutantFails: false, cleanRerun: false, logs: [], approval: null, repairCommit: null };
  const findings = targeted && proposal ? [{
    id: 'SHIPPING-001-boundary',
    title: 'The tests missed the exact $100 free-shipping boundary.',
    consequence: 'Changing >= to > charges $5 shipping on an order of exactly $100 while the original tests remain green.',
    requirement: 'SHIPPING-001: Orders with a subtotal of at least $100 receive free shipping. Smaller orders pay $5 shipping. Money uses integer cents.',
    requirementReference: 'packages/demo-domain/CONTRACTS.md#checkout-contracts',
    mutantFingerprint: targeted.fingerprint,
    proposal,
    interpretationSource: 'deterministic demonstration fixture; not GitLab Duo',
    confidence: null,
    approvalStatus: 'awaiting approval',
    uncertainty: 'This is evidence of a missing boundary assertion, not evidence of a production defect. Duo interpretation has not run.',
  }] : [];
  const evidence = {
    schemaVersion: 1,
    runId: `run-${new Date(started).toISOString().replace(/[:.]/g, '-')}`,
    createdAt: new Date().toISOString(),
    source: demo ? 'local' : 'gitlab',
    provenance,
    baseline: { status: baselinePassed ? 'passed' : 'failed', tests: baselineRaw?.numPassedTests ?? 0, branchCoverage: coverage?.total?.branches?.pct ?? null, durationMs: baselineRun.durationMs, log: baselineRun.log },
    scope: { files: scope.map((file) => ({ path: file.path, startLine: file.lines[0]?.start, endLine: file.lines.at(-1)?.end, lines: file.lines })), changedLines: scopeLines, complete, reason: skippedReason, limits: LIMITS, protectedFilesChanged: protectedChanges },
    mutation: { status: complete ? 'complete' : 'inconclusive', score: metrics.score, counts: { killed: metrics.killed, survived: metrics.survived, noCoverage: metrics.noCoverage, timedOut: metrics.timedOut, invalid: metrics.invalid, ignored: metrics.ignored, pending: metrics.pending }, mutants: mutants.map((mutant) => ({ ...mutant, line: mutant.location.start.line })), durationMs: mutationRun?.durationMs ?? null, reportPath: rawReport ? 'evidence/mutation/mutation.json' : null, incremental: !demo, cacheKey },
    findings,
    verification,
    metrics: { modelCalls: 0, tokens: null, repairAttempts: demo && proposal ? 1 : 0, verifiedRepairs: 0, localSandboxProofs: verification.status === 'passed' ? 1 : 0, mutantsGenerated: metrics.total, freshExecutions: demo ? metrics.total : null, cachedResults: demo ? 0 : null, totalDurationMs: Date.now() - started, lessonsApproved: 0, lessonApplications: 0 },
    lessons: [],
    preflight: { results: preflightResults, retrievedLessons, note: 'Advisory heuristics. A clean preflight does not establish behavioral adequacy; retrieved lessons are not demonstrated applications.' },
    integrations: { gitlab: demo ? 'unconfigured' : 'ci execution', duo: 'not_executed' },
    gate,
    evidenceFiles: ['evidence/baseline.json', 'evidence/baseline.log', 'evidence/coverage/coverage-summary.json', ...(rawReport ? ['evidence/mutation/mutation.json', 'evidence/mutation.log'] : []), ...verification.logs],
  };
  await save('evidence/latest.json', evidence);
  if (demo && proposal) await save('evidence/verification/receipt.json', { schemaVersion: 1, runId: evidence.runId, provenance, mutant: targeted, proposalId: proposal.id, patchHash: proposal.patchHash, verification, evidenceState: 'local sandbox proof; human approval, repair commit and GitLab pipeline absent' });
  console.log(`${demo ? 'Local demonstration' : 'MR review'}: baseline ${evidence.baseline.status}; mutation score ${metrics.score ?? 'unavailable'}; ${metrics.survived} survivor(s); gate ${gate.status}.`);
  console.log('Evidence: evidence/latest.json. Repair approval and GitLab Duo execution are separate, uncompleted stages.');
  if (!baselinePassed || !complete) process.exitCode = 2;
}

async function lessons(query: string) {
  console.log(JSON.stringify({ query, lessons: await relevantLessons(query), note: 'Only versioned, approved lessons with a repair receipt are returned. Retrieval alone does not demonstrate application.' }, null, 2));
}

async function main() {
  const [command = 'help', argument] = process.argv.slice(2);
  if (['capabilities', 'publish', 'apply', 'verify', 'prepare-lesson', 'learn'].includes(command)) return runAssisted(command, process.argv.slice(3));
  if (command === 'demo' || command === 'review') return review(command === 'demo');
  if (command === 'gate') {
    const evidence = await json('evidence/latest.json');
    const headSha = process.env.CI_COMMIT_SHA ?? git('rev-parse', 'HEAD');
    const storedMetrics = mutationMetrics(evidence.mutation.mutants);
    const policy = await json('.mutant-review/policy.json');
    const protectedChanges = evidence.source === 'gitlab' && evidence.provenance.baseSha ? git('diff', '--name-only', evidence.provenance.baseSha, headSha, '--').split('\n').some(protectedPath) : false;
    const gate = evaluateGate({ baselinePassed: evidence.baseline.status === 'passed', complete: evidence.scope.complete && evidence.mutation.status === 'complete', expectedHeadSha: headSha, evidenceHeadSha: evidence.provenance.headSha, metrics: storedMetrics, threshold: policy.mutationThreshold ?? 100, actionableSurvivors: storedMetrics.survived, protectedFilesChanged: protectedChanges });
    console.log(JSON.stringify(gate, null, 2));
    if (gate.status !== 'passed') process.exitCode = 1;
    return;
  }
  if (command === 'lessons') return lessons(argument ?? 'boundary');
  if (command === 'sandbox-verify') {
    const proposal = await json(argument ?? '.mutant-review/proposals/shipping.json');
    const verification = await verifySandbox(proposal);
    await save('evidence/verification/sandbox.json', verification);
    console.log(JSON.stringify(verification, null, 2));
    if (verification.status !== 'passed') process.exitCode = 1;
    return;
  }
  console.log('Commands: demo | review (GitLab MR CI only) | gate | sandbox-verify [proposal.json] | lessons [query] | capabilities [MR IID] | publish <MR IID> <job ID> <triage.json> | apply <proposal ID> <note ID> | verify <proposal ID> <note ID> | prepare-lesson <proposal ID> | learn <repair proposal ID> <note ID>');
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await save('evidence/error.json', { status: 'inconclusive', message, createdAt: new Date().toISOString() });
  if (['demo', 'review'].includes(process.argv[2] ?? '')) {
    const old = await json('evidence/latest.json').catch(() => ({}));
    await save('evidence/latest.json', { ...old, createdAt: new Date().toISOString(), lastAttemptError: message, baseline: { status: 'failed', tests: 0, branchCoverage: null, durationMs: null, log: 'evidence/error.json' }, scope: { ...old.scope, complete: false, reason: message }, mutation: { status: 'inconclusive', score: null, counts: { killed: 0, survived: 0, noCoverage: 0, timedOut: 0, invalid: 0, ignored: 0, pending: 0 }, mutants: [], durationMs: null, reportPath: null }, findings: [], verification: { status: 'not_run', originalPasses: false, mutantFails: false, cleanRerun: false, logs: [], scope: 'Review did not complete' }, gate: { status: 'inconclusive', reasons: [message] }, evidenceFiles: ['evidence/error.json'] });
  }
  process.exitCode = 2;
});
