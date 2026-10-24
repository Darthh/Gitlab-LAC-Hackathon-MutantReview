import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mutationMetrics, evaluateGate, applyOverride } from '../../review-core/src/report.js';
import { updateAgentsMd, type MemoryLesson } from '../../review-core/src/memory.js';
import { verifySandbox } from './proof.js';
import { runAssisted, recordLessonRetrieval, hydrateConfiguredEvidence } from './workflow.js';
import { ciContext, demoContext, git, json, protectedPath, relevantLessons, runReview, save } from './review.js';
import { findOverride, flowAdapter, flowHandle, flowNotify, flowPrepare, flowPublish } from './flow.js';

async function review(demo: boolean) {
  const { evidence, baselinePassed, complete } = await runReview(demo ? demoContext() : ciContext());
  const { mutation, gate, triage, savings } = evidence;
  console.log(`${demo ? 'Local demonstration' : 'MR review'}: baseline ${evidence.baseline.status}; changed-line mutation score ${mutation.score ?? 'unavailable'}; ${mutation.counts.survived} survivor(s); gate ${gate.status}.`);
  console.log(`Triage: ${triage.arid.length} arid mutant(s) filtered, ${triage.ranked.length} finding(s) to comment, ${triage.overflow} over budget. Mutants run ${savings.mutantsChangedLines}${savings.mutantsWholeFiles === null ? '' : ` of ${savings.mutantsWholeFiles} in the whole changed files`}.`);
  console.log('Evidence: evidence/latest.json');
  if (!baselinePassed || !complete) process.exitCode = 2;
}

async function lessons(query: string) {
  const lessons = await relevantLessons(query);
  const retrieval = await recordLessonRetrieval(query, lessons, Number(process.env.GITLAB_PROJECT_ID ?? process.env.CI_PROJECT_ID), git('rev-parse', 'HEAD'));
  console.log(JSON.stringify({ query, lessons, retrieval, note: 'Only unchanged versioned approved lessons with a repair receipt are returned. Retrieval alone does not demonstrate application or actual Duo execution.' }, null, 2));
}

async function gate() {
  const evidence = await json('evidence/latest.json');
  const headSha = process.env.CI_COMMIT_SHA ?? git('rev-parse', 'HEAD');
  const storedMetrics = mutationMetrics(evidence.mutation.mutants);
  const policy = await json('.mutant-review/policy.json');
  const protectedChanges = evidence.source === 'gitlab' && evidence.provenance.baseSha ? git('diff', '--name-only', evidence.provenance.baseSha, headSha, '--').split('\n').some(protectedPath) : false;
  const decision = evaluateGate({ baselinePassed: evidence.baseline.status === 'passed', complete: evidence.scope.complete && evidence.mutation.status === 'complete', expectedHeadSha: headSha, evidenceHeadSha: evidence.provenance.headSha, metrics: storedMetrics, threshold: policy.mutationThreshold ?? 100, actionableSurvivors: storedMetrics.survived, protectedFilesChanged: protectedChanges });
  let override = null;
  const mrIid = Number(process.env.CI_MERGE_REQUEST_IID);
  if (decision.status === 'failed' && mrIid && process.env.MUTANT_REVIEW_TOKEN) {
    try {
      override = await findOverride(await flowAdapter(), mrIid, headSha, flowHandle([]));
    } catch (error) { console.error(`Override lookup failed: ${(error as Error).message}`); }
  }
  const final = applyOverride(decision, override, headSha);
  if (final.status === 'overridden') {
    // A waiver is debt, not a pass: track the untested changes as a planned follow-up.
    const open = evidence.mutation.mutants.filter((mutant: { status: string }) => mutant.status === 'Survived' || mutant.status === 'NoCoverage');
    try {
      const issue = await (await flowAdapter()).ensureIssue(`Test debt: mutation gate overridden on !${mrIid}`, [
        `@${final.override.actor} overrode the mutation gate on !${mrIid} at \`${headSha.slice(0, 8)}\`: "${final.override.reason}" ([comment](${final.override.noteUrl})).`,
        '', 'Changes no test would notice:', '',
        ...open.map((mutant: { path: string; line: number; original: string; replacement: string }) => `- [ ] \`${mutant.path}:${mutant.line}\` \`${mutant.original.replace(/\s+/g, ' ')}\` → \`${mutant.replacement.replace(/\s+/g, ' ')}\``),
      ].join('\n'), ['mutant-review', 'test-debt']);
      console.log(`Follow-up issue: ${issue.web_url}`);
    } catch (error) { console.error(`Could not open the test-debt issue: ${(error as Error).message}`); }
  }
  await save('evidence/gate.json', { ...final, headSha, threshold: policy.mutationThreshold ?? 100, score: storedMetrics.score, checkedAt: new Date().toISOString() });
  console.log(JSON.stringify(final, null, 2));
  if (final.status === 'failed') console.log(`Add the tests Mutant Review proposed, or have a Maintainer comment "${process.env.MUTANT_REVIEW_HANDLE ?? '@<flow-account>'} override <reason>" and re-run this job.`);
  if (final.status !== 'passed' && final.status !== 'overridden') process.exitCode = 1;
}

/** Regenerates the AGENTS.md section from approved lessons; CI fails if it drifted. */
async function memory(check: boolean) {
  const lessons: MemoryLesson[] = [];
  for (const name of (await readdir('.mutant-review/lessons').catch(() => [])).filter((item) => item.endsWith('.json'))) {
    const lesson = await json(`.mutant-review/lessons/${name}`).catch(() => null);
    if (lesson?.examples) lessons.push(lesson);
  }
  const current = await readFile('AGENTS.md', 'utf8').catch(() => '');
  const next = updateAgentsMd(current, lessons);
  if (check) { if (next !== current) { console.error('AGENTS.md is out of date; run npm run mr -- memory'); process.exitCode = 1; } else console.log(`AGENTS.md carries ${lessons.length} learned rule(s).`); return; }
  await writeFile('AGENTS.md', next);
  console.log(`AGENTS.md updated with ${lessons.length} learned rule(s).`);
}

async function main() {
  const [command = 'help', argument] = process.argv.slice(2);
  const rest = process.argv.slice(3);
  if (command === 'flow') {
    if (argument === 'prepare') return flowPrepare(rest.slice(1));
    if (argument === 'publish') return flowPublish(rest.slice(1));
    if (argument === 'notify') return flowNotify(rest.slice(1));
    throw new Error('Use: flow prepare|publish|notify [--handle @flow-account]');
  }
  if (command === 'hydrate-evidence') { console.log(JSON.stringify(await hydrateConfiguredEvidence(git('rev-parse', 'HEAD')), null, 2)); return; }
  if (['capabilities', 'publish', 'apply', 'verify', 'prepare-lesson', 'learn', 'export-receipt', 'export-console'].includes(command)) return runAssisted(command, rest);
  if (command === 'demo' || command === 'review') return review(command === 'demo');
  if (command === 'gate') return gate();
  if (command === 'memory') return memory(argument === '--check');
  if (command === 'lessons') return lessons(argument ?? 'boundary');
  if (command === 'sandbox-verify') {
    const proposal = await json(argument ?? '.mutant-review/proposals/shipping.json');
    const verification = await verifySandbox(proposal);
    await save('evidence/verification/sandbox.json', verification);
    console.log(JSON.stringify(verification, null, 2));
    if (verification.status !== 'passed') process.exitCode = 1;
    return;
  }
  console.log('Commands: demo | review (GitLab MR CI) | gate | flow prepare|publish|notify --handle @flow | memory [--check] | lessons [query] | sandbox-verify [proposal.json] | hydrate-evidence | capabilities | export-console | publish | apply | verify | prepare-lesson | learn | export-receipt');
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
