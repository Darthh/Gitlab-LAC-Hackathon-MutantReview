import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { coversCandidateLines, parseDiff, strykerRanges } from '../../review-core/src/scope.js';
import { mutationMetrics, normalizeStrykerReport, evaluateGate } from '../../review-core/src/report.js';
import { preflight } from '../../review-core/src/preflight.js';
import type { MemoryLesson } from '../../review-core/src/memory.js';
import { modelInputSavings, triageMutants } from '../../review-core/src/triage.js';
import { isTestFile, withLostProtection, type ProtectionResult } from '../../review-core/src/protection.js';
import { footprintReceipt, type Usage } from '../../review-core/src/footprint.js';
import type { MutationScope, NormalizedMutant } from '../../review-core/src/types.js';
import { execute, type Execution } from './runner.js';
import { machine } from './cpu.js';
import { digest, makeProposal, verifySandbox } from './proof.js';
import { checkProtection, demoProtection, type ProtectionRun } from './protection.js';

export const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 8_000_000 }).trim();
export const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
export const save = async (path: string, value: unknown) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
// .gitattributes can mark TypeScript as binary (`-diff`) and empty the changed-line scope, so it is part of the evaluator.
export const protectedPath = (path: string) => /^(?:\.gitlab-ci\.yml|\.gitlab\/|\.mutant-review\/policy\.json|packages\/(?:review-core|cli|gitlab-adapter)\/|package(?:-lock)?\.json$|vitest(?:\.domain)?\.config\.ts$|stryker\.config\.json$)|(?:^|\/)\.gitattributes$/.test(path);

export interface ReviewContext {
  mode: 'demo' | 'ci' | 'flow';
  headSha: string;
  baseSha: string | null;
  projectId: string | null;
  mrIid: number | null;
  pipelineId: string | null;
  jobId: string | null;
  pipelineUrl: string | null;
  projectUrl: string | null;
  output: string;
}

export function demoContext(): ReviewContext {
  return { mode: 'demo', headSha: git('rev-parse', 'HEAD'), baseSha: null, projectId: null, mrIid: null, pipelineId: null, jobId: null, pipelineUrl: null, projectUrl: null, output: 'evidence/latest.json' };
}

export function ciContext(env = process.env): ReviewContext {
  if (!env.CI_COMMIT_SHA || !env.CI_MERGE_REQUEST_DIFF_BASE_SHA || !env.CI_MERGE_REQUEST_IID || !env.CI_PROJECT_ID) {
    throw new Error('MR review requires CI_COMMIT_SHA, CI_MERGE_REQUEST_DIFF_BASE_SHA, CI_MERGE_REQUEST_IID, and CI_PROJECT_ID. Use demo for an explicitly local fixture.');
  }
  return { mode: 'ci', headSha: env.CI_COMMIT_SHA, baseSha: env.CI_MERGE_REQUEST_DIFF_BASE_SHA, projectId: env.CI_PROJECT_ID, mrIid: Number(env.CI_MERGE_REQUEST_IID),
    pipelineId: env.CI_PIPELINE_ID ?? null, jobId: env.CI_JOB_ID ?? null, pipelineUrl: env.CI_PIPELINE_URL ?? null, projectUrl: env.CI_PROJECT_URL ?? null, output: 'evidence/latest.json' };
}

export async function versionedLessons(): Promise<MemoryLesson[]> {
  const names = await readdir('.mutant-review/lessons').catch(() => []);
  const records: MemoryLesson[] = [];
  for (const name of names.filter((name) => name.endsWith('.json'))) {
    try {
      const path = `.mutant-review/lessons/${name}`;
      const content = await readFile(path, 'utf8');
      const versioned = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      if (content === versioned) records.push(JSON.parse(content));
    } catch { /* Uncommitted or malformed lesson data is never approved versioned evidence. */ }
  }
  return records;
}

/**
 * Runs Stryker on exact `path:start-end` ranges using the project's own Stryker configuration (always this checkout's,
 * which is protected). `cwd` runs it in another checkout, such as the target-branch worktree of the protection check.
 */
export async function runStryker(ranges: string[], options: { incremental: boolean; name: string; dryRunOnly?: boolean; timeoutMs?: number; cwd?: string }) {
  const config = await json('stryker.config.json');
  // Stryker resolves its paths against its own working directory, so a run elsewhere gets absolute ones.
  const here = (path: string) => options.cwd ? resolve(path) : path;
  config.mutate = ranges;
  config.incremental = options.incremental;
  config.incrementalFile = here('evidence/incremental/mutation.json');
  config.jsonReporter = { fileName: here(`evidence/${options.name}/mutation.json`) };
  if (options.dryRunOnly) config.dryRunOnly = true;
  await save(`evidence/stryker.${options.name}.json`, config);
  await rm(`evidence/${options.name}/mutation.json`, { force: true });
  const run = await execute([here('node_modules/@stryker-mutator/core/bin/stryker.js'), 'run', here(`evidence/stryker.${options.name}.json`)], `evidence/${options.name}.log`, options.timeoutMs ?? 180_000, options.cwd);
  const report = await json(`evidence/${options.name}/mutation.json`).catch(() => null) as Record<string, unknown> | null;
  return { run, report };
}

/** Measured, not estimated: how many mutants the whole changed files would have generated. The run is also the fixed cost of any Stryker run on those files. */
export async function countWholeFileMutants(paths: string[]): Promise<{ count: number | null; run: Execution | null }> {
  if (!paths.length) return { count: null, run: null };
  const { run } = await runStryker(paths, { incremental: false, name: 'whole-file-count', dryRunOnly: true, timeoutMs: 120_000 });
  const match = /Instrumented \d+ source file\(s\) with (\d+) mutant\(s\)/.exec(await readFile(run.log, 'utf8').catch(() => ''));
  return { count: match ? Number(match[1]) : null, run };
}

/** The runner VM is reserved for the job, so its vCPUs and memory are the resources the review holds. */
export function usageOf(run: Execution | null): Usage | null {
  if (!run) return null;
  const host = machine();
  return { wallMs: run.durationMs, cpuMs: run.cpuMs, vCpus: host.vCpus, memoryGb: host.memoryGb };
}

/** An unfinished lost-protection check fails closed: the gate is inconclusive rather than passing. */
export function protectionBlocks(protection: Pick<ProtectionResult, 'status' | 'reason'> | null | undefined): string | null {
  return protection && (protection.status === 'inconclusive' || protection.status === 'over-budget') ? protection.reason ?? protection.status : null;
}

export async function runReview(context: ReviewContext) {
  const started = Date.now();
  const demo = context.mode === 'demo';
  await mkdir('evidence', { recursive: true });
  const { headSha, baseSha } = context;
  const shaPattern = /^[a-f0-9]{40,64}$/;
  if (!shaPattern.test(headSha) || (baseSha && !shaPattern.test(baseSha)) || (!demo && !baseSha)) throw new Error('Invalid revision format');
  if (git('rev-parse', 'HEAD') !== headSha) throw new Error('Checkout does not match the recorded source head');
  if (!demo && git('status', '--porcelain', '--untracked-files=no')) throw new Error('MR checkout has modified tracked files; evidence would not match its revision');
  let scope: MutationScope[];
  if (demo) {
    scope = [{ path: 'packages/demo-domain/src/shipping.ts', lines: [{ start: 3, end: 5 }], change: 'modified' }];
  } else {
    try { git('cat-file', '-e', `${baseSha}^{commit}`); } catch { git('fetch', '--no-tags', 'origin', baseSha!); }
    scope = parseDiff(git('diff', '--no-ext-diff', '--no-textconv', '--text', '--unified=0', '--find-renames', baseSha!, headSha, '--'));
  }
  const scopeLines = scope.reduce((sum, file) => sum + file.lines.reduce((n, lines) => n + lines.end - lines.start + 1, 0), 0);
  const changedPaths = demo ? [] : git('-c', 'core.quotePath=false', 'diff', '--name-only', baseSha!, headSha, '--').split('\n').filter(Boolean);
  const protectedChanges = changedPaths.some(protectedPath);
  // Only an MR that changes nothing but tests can pass on the protection check alone.
  const testOnly = changedPaths.length > 0 && changedPaths.every(isTestFile);
  const policy = await json('.mutant-review/policy.json').catch(() => ({ version: '1', threshold: 100 }));
  // Budgets live in .mutant-review/policy.json only; defaults apply when the policy is missing.
  const budget = { files: policy.budgets?.files ?? 5, changedLines: policy.budgets?.changedLines ?? 100, mutants: policy.budgets?.mutants ?? 100, runtimeMs: (policy.budgets?.runtimeSeconds ?? 180) * 1000 };
  const [vitest, stryker] = await Promise.all([json('node_modules/vitest/package.json'), json('node_modules/@stryker-mutator/core/package.json')]);
  const provenance = {
    projectId: context.projectId,
    mrIid: context.mrIid,
    headSha,
    baseSha,
    pipelineId: context.pipelineId,
    jobId: context.jobId,
    pipelineUrl: context.pipelineUrl,
    projectUrl: context.projectUrl,
    policyVersion: String(policy.version ?? '1'),
    toolchain: { node: process.version, vitest: vitest.version, stryker: stryker.version },
    scopeKind: demo ? 'local demonstration fixture; not an MR comparison' : context.mode === 'flow' ? 'merge request changed source (GitLab Duo flow workload)' : 'merge request changed source',
    workingTreeHash: digest(await readFile('packages/demo-domain/src/shipping.ts', 'utf8')),
  };
  const testPaths = demo ? ['packages/demo-domain/src/shipping.test.ts', 'packages/demo-domain/src/discount.test.ts'] : git('diff', '--name-only', '--diff-filter=AM', baseSha!, headSha, '--').split('\n').filter((path) => /\.(?:test|spec)\.ts$/.test(path));
  const preflightResults = await Promise.all(testPaths.map(async (path) => ({ path, findings: preflight(await readFile(path, 'utf8')) })));
  await rm('evidence/baseline.json', { force: true });
  await rm('evidence/coverage/coverage-summary.json', { force: true });
  const baselineRun = await execute(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.domain.config.ts', '--coverage', '--reporter=json', '--outputFile=evidence/baseline.json'], 'evidence/baseline.log');
  const baselineRaw = await json('evidence/baseline.json').catch(() => null);
  const coverage = await json('evidence/coverage/coverage-summary.json').catch(() => null);
  const baselinePassed = baselineRun.exitCode === 0 && !baselineRun.timedOut && baselineRaw?.success === true;
  const scopeWithinBudget = scope.length <= budget.files && scopeLines <= budget.changedLines;
  let mutationRun: Awaited<ReturnType<typeof execute>> | null = null;
  let mutants: NormalizedMutant[] = [];
  let rawReport: Record<string, unknown> | null = null;
  let cacheKey: string | null = null;
  let wholeFileMutants: number | null = null;
  let wholeFileRun: Execution | null = null;
  let wholeFileCount: string | null = null;
  const skippedReason = !baselinePassed ? 'Inconclusive: the unmodified test suite failed.' : !scope.length ? 'Changed-source mode has no applicable source scope.' : !scopeWithinBudget ? 'The MR scope exceeds the configured file or line budget.' : null;
  if (!skippedReason) {
    // Dependency, runner, policy, snapshot, environment and toolchain changes invalidate reuse.
    const sensitiveFiles = git('ls-files').split('\n').filter((path) => /(?:package(?:-lock)?\.json|vitest.*\.[cm]?[jt]s|stryker.*\.json|policy\.json|\.snap)$/.test(path));
    const keyParts = await Promise.all(sensitiveFiles.map(async (path) => `${path}:${digest(await readFile(path, 'utf8'))}`));
    cacheKey = digest(JSON.stringify({ keyParts, node: process.version, platform: process.platform, env: { NODE_ENV: process.env.NODE_ENV, TZ: process.env.TZ }, toolchain: provenance.toolchain }));
    const previous = await json('evidence/incremental/key.json').catch(() => null);
    if (previous?.cacheKey !== cacheKey) await rm('evidence/incremental/mutation.json', { force: true });
    const stryker = await runStryker(strykerRanges(scope), { incremental: context.mode === 'ci', name: 'mutation', timeoutMs: budget.runtimeMs });
    mutationRun = stryker.run;
    rawReport = stryker.report;
    if (rawReport) mutants = normalizeStrykerReport(rawReport as never, scope, { headSha, ...(baseSha ? { baseSha } : {}), toolchain: provenance.toolchain, fresh: demo });
    await save('evidence/incremental/key.json', { cacheKey });
    // When the changed lines already cover every candidate line of their files, the whole files hold exactly these
    // mutants: skip the dry run that would only count them again (it is a third of a small review's energy).
    const fileSources = Object.fromEntries(await Promise.all(scope.map(async (file) => [file.path, await readFile(file.path, 'utf8').catch(() => undefined)] as const)));
    if (rawReport && coversCandidateLines(scope, fileSources)) {
      wholeFileMutants = mutants.length;
      wholeFileCount = 'changed lines cover every candidate line of their files; no dry run needed';
    } else {
      ({ count: wholeFileMutants, run: wholeFileRun } = await countWholeFileMutants(scope.map((file) => file.path)));
      wholeFileCount = wholeFileMutants === null ? null : 'Stryker dry run of the whole changed files';
    }
    if (wholeFileMutants !== null && wholeFileMutants < mutants.length) wholeFileMutants = null;
  }
  // Test edits can remove protection the target branch had, which no changed source line shows: run both sides.
  let protectionRun: ProtectionRun | null = null;
  if (baselinePassed) {
    protectionRun = demo ? await demoProtection({ files: budget.files, runtimeMs: budget.runtimeMs })
      : await checkProtection({ base: baseSha!, head: headSha, budget: { files: budget.files, runtimeMs: budget.runtimeMs } });
  }
  const protection: ProtectionResult | null = protectionRun?.result ?? null;
  const lost = protection?.lost ?? [];
  const metrics = mutationMetrics(mutants);
  // An MR with no executable changed source has nothing to mutate: the analysis is complete and the gate reports no-applicable-scope.
  // Stryker can also generate no mutants for real changes (e.g. inside a TypeScript `as` expression).
  const mutantFree = Boolean(!skippedReason && mutationRun?.exitCode === 0 && !mutationRun.timedOut && !rawReport && /mutant-free world/i.test(await readFile(mutationRun.log, 'utf8').catch(() => '')));
  const nothingToMutate = baselinePassed && (!scope.length || mutantFree);
  const complete = nothingToMutate || Boolean(!skippedReason && mutationRun?.exitCode === 0 && !mutationRun.timedOut && rawReport && metrics.total <= budget.mutants && metrics.pending === 0 && metrics.invalid === 0);
  const threshold = policy.mutationThreshold ?? 100;
  // The demo's protection scenario is a second, separate fixture MR; it is shown, not gated, so the demo gate stays the boundary story.
  const gated = demo ? null : protection;
  const gate = evaluateGate({ baselinePassed, complete, expectedHeadSha: headSha, evidenceHeadSha: headSha, metrics, threshold, actionableSurvivors: metrics.survived, protectedFilesChanged: protectedChanges,
    lostProtection: gated?.lost.length ?? 0, protectionRechecked: gated?.rechecked ?? 0, protectionTestOnly: testOnly, protectionInconclusive: protectionBlocks(gated) });
  if (protection && !demo) protection.testOnly = testOnly;
  const sources = { ...(demo ? {} : protectionRun?.sources), ...Object.fromEntries(Object.entries((rawReport as { files?: Record<string, { source: string }> } | null)?.files ?? {}).map(([path, file]) => [path.replaceAll('\\', '/').replace(/^\.\//, ''), file.source])) };
  // Lost protection is a regression, not a pre-existing gap, so it is ranked ahead of changed-line findings.
  const triage = withLostProtection(triageMutants(mutants, sources), demo ? [] : lost);
  const lessons = await versionedLessons();
  const savings = {
    mutantsChangedLines: metrics.total,
    mutantsWholeFiles: wholeFileMutants,
    mutantsAvoided: wholeFileMutants === null ? null : wholeFileMutants - metrics.total,
    wholeFileCount,
    aridFiltered: triage.arid.length,
    aiCallsAvoided: triage.arid.length + triage.overflow,
    lessonsInMemory: lessons.length,
    // Characters of drafting-brief context triage keeps out of the model prompt (measured; tokens are an estimate).
    modelInput: modelInputSavings([...mutants, ...(demo ? [] : protectionRun?.mutants ?? [])], sources, triage),
  };
  // SCI of this review from measured CPU time, plus the projected cost of mutating the whole changed files.
  const changedLinesUsage = usageOf(mutationRun);
  const wholeFileDryUsage = usageOf(wholeFileRun);
  const footprint = footprintReceipt({
    review: [
      { label: 'Baseline tests with coverage', usage: usageOf(baselineRun) },
      { label: 'Stryker on changed lines', usage: changedLinesUsage },
      { label: 'Whole-file mutant count (dry run)', usage: wholeFileDryUsage },
      ...(demo ? [] : protectionRun?.runs ?? []).map(({ step, run }) => ({ label: `Lost-protection check: ${step}`, usage: usageOf(run) })),
    ].flatMap(({ label, usage }) => (usage ? [Object.assign(usage, { step: label })] : [])),
    changedLinesRun: changedLinesUsage,
    wholeFileDryRun: wholeFileDryUsage,
    changedMutants: metrics.total,
    wholeFileMutants: wholeFileMutants === null || wholeFileMutants < metrics.total ? null : wholeFileMutants,
    env: process.env,
    modelCalls: { made: 0, avoided: savings.aiCallsAvoided },
  });
  // What the protection check itself cost, measured the same way (its runs are part of the review footprint above, except in the demo).
  if (protection && protectionRun?.runs.length) {
    const own = footprintReceipt({ review: protectionRun.runs.flatMap(({ step, run }) => { const usage = usageOf(run); return usage ? [{ ...usage, step }] : []; }),
      changedLinesRun: null, wholeFileDryRun: null, changedMutants: 0, wholeFileMutants: null, env: process.env });
    if (own) protection.cost = { cpuSeconds: own.actual.cpuSeconds, energyWh: own.actual.energyWh, sciG: own.actual.sciG };
  }
  const targeted = mutants.find((mutant) => mutant.status === 'Survived' && mutant.operator === 'EqualityOperator' && mutant.replacement === 'subtotalCents > 10_000' && mutant.path === 'packages/demo-domain/src/shipping.ts');
  // The fixture proof is for the local demo console only; MR reviews use the Duo flow's verifyDraft.
  const proposal = targeted && demo ? await makeProposal() : null;
  const verification = proposal ? await verifySandbox(proposal) : { status: 'not_run', scope: 'Awaiting separate verification approval', originalPasses: false, mutantFails: false, cleanRerun: false, logs: [], approval: null, repairCommit: null };
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
    uncertainty: 'This is evidence of a missing boundary assertion, not evidence of a production defect.',
  }] : [];
  const evidence = {
    schemaVersion: 1,
    runId: `run-${new Date(started).toISOString().replace(/[:.]/g, '-')}`,
    createdAt: new Date().toISOString(),
    source: demo ? 'local' : 'gitlab',
    provenance,
    baseline: { status: baselinePassed ? 'passed' : 'failed', tests: baselineRaw?.numPassedTests ?? 0, branchCoverage: coverage?.total?.branches?.pct ?? null, durationMs: baselineRun.durationMs, log: baselineRun.log },
    scope: { files: scope.map((file) => ({ path: file.path, startLine: file.lines[0]?.start, endLine: file.lines.at(-1)?.end, lines: file.lines })), changedLines: scopeLines, complete, reason: skippedReason, limits: budget, protectedFilesChanged: protectedChanges },
    mutation: { status: complete ? 'complete' : 'inconclusive', score: metrics.score, counts: { killed: metrics.killed, survived: metrics.survived, noCoverage: metrics.noCoverage, timedOut: metrics.timedOut, invalid: metrics.invalid, ignored: metrics.ignored, pending: metrics.pending }, mutants: mutants.map((mutant) => ({ ...mutant, line: mutant.location.start.line })), durationMs: mutationRun?.durationMs ?? null, reportPath: rawReport ? 'evidence/mutation/mutation.json' : null, incremental: context.mode === 'ci', cacheKey },
    triage,
    savings,
    protection,
    footprint,
    findings,
    verification,
    metrics: { modelCalls: 0, tokens: null, repairAttempts: proposal ? 1 : 0, verifiedRepairs: 0, localSandboxProofs: verification.status === 'passed' ? 1 : 0, mutantsGenerated: metrics.total, freshExecutions: demo ? metrics.total : null, cachedResults: demo ? 0 : null, totalDurationMs: Date.now() - started, lessonsApproved: lessons.length, lessonApplications: 0 },
    preflight: { results: preflightResults, note: 'Advisory heuristics. A clean preflight does not establish behavioral adequacy.' },
    integrations: { gitlab: demo ? 'unconfigured' : 'ci execution', duo: context.mode === 'flow' ? 'flow workload' : 'not_executed' },
    gate,
    evidenceFiles: ['evidence/baseline.json', 'evidence/baseline.log', 'evidence/coverage/coverage-summary.json', ...(rawReport ? ['evidence/mutation/mutation.json', 'evidence/mutation.log'] : []), ...verification.logs],
  };
  await save(context.output, evidence);
  if (proposal) await save('evidence/verification/receipt.json', { schemaVersion: 1, runId: evidence.runId, provenance, mutant: targeted, proposalId: proposal.id, patchHash: proposal.patchHash, verification, evidenceState: 'local sandbox proof; human approval, repair commit and GitLab pipeline absent' });
  return { evidence, scope, sources, baselinePassed, complete };
}
