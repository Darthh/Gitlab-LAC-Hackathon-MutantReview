import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mutationMetrics, evaluateGate, applyOverride } from '../../review-core/src/report.js';
import { updateAgentsMd, type MemoryLesson } from '../../review-core/src/memory.js';
import { formatGrams } from '../../review-core/src/footprint.js';
import { codeQualityReport, metricsReport } from '../../review-core/src/reports.js';
import { ciContext, demoContext, git, json, protectionBlocks, protectedPath, runReview, save } from './review.js';
import { findOverride, flowAdapter, flowHandle, flowNotify, flowPrepare, flowPublish } from './flow.js';
import { formatPrecheck, precheck } from './precheck.js';
import { isTestFile } from '../../review-core/src/protection.js';
import { reviewFailureSchema } from '../../review-core/src/review-failure.js';

async function review(demo: boolean) {
  const { evidence, baselinePassed, complete } = await runReview(demo ? demoContext() : ciContext());
  const { mutation, gate, triage, savings, protection } = evidence;
  console.log(`${demo ? 'Local demonstration' : 'MR review'}: baseline ${evidence.baseline.status}; changed-line mutation score ${mutation.score ?? 'unavailable'}; ${mutation.counts.survived} survivor(s); gate ${gate.status}.`);
  console.log(`Triage: ${triage.arid.length} arid mutant(s) filtered, ${triage.ranked.length} finding(s) to comment, ${triage.overflow} over budget. Mutants run ${savings.mutantsChangedLines}${savings.mutantsWholeFiles === null ? '' : ` of ${savings.mutantsWholeFiles} in the whole changed files`}.`);
  console.log(`Model input: ${savings.modelInput.findingsSent} of ${savings.modelInput.findingsOpen} open mutant(s) would reach the drafting prompt; ${savings.modelInput.charsAvoided} characters (≈${savings.modelInput.tokensAvoidedApprox} tokens) kept out by triage.`);
  if (protection) {
    const label = protection.scenario ? 'Lost-protection check (demonstration fixture, not gated)' : 'Lost-protection check';
    console.log(`${label}: ${protection.status}. ${protection.reason ?? ''}${protection.cost ? ` Cost ${formatGrams(protection.cost.sciG)}, ${protection.cost.cpuSeconds} CPU-s.` : ''}`.trim());
    for (const item of protection.lost) console.log(`  lost: ${item.path}:${item.line} \`${item.original}\` -> \`${item.replacement}\` was caught by "${item.caughtBy[0]?.name}" (test ${item.caughtBy[0]?.fate}).`);
  }
  if (evidence.footprint) {
    const { actual, changedLinesRun, projectedWholeFile, savedPercent, region, gridIntensity } = evidence.footprint;
    console.log(`Footprint (SCI per review): ${formatGrams(actual.sciG)}, ${actual.energyWh.toFixed(2)} Wh, ${actual.cpuSeconds} CPU-s${actual.cpuMeasured ? '' : ' (CPU time not measurable here: full utilisation assumed)'}, ${region} grid at ${gridIntensity} gCO2e/kWh.`);
    if (changedLinesRun && projectedWholeFile) console.log(`Mutation work: ${changedLinesRun.mutants} changed-line mutants at ${formatGrams(changedLinesRun.sciG)} instead of ${projectedWholeFile.mutants} whole-file mutants projected at ${formatGrams(projectedWholeFile.sciG)} (${savedPercent}% avoided).`);
  }
  // Native MR widgets: Code Quality lists each unnoticed change on its line; Metrics compares score and footprint with the target branch.
  // The demo's protection scenario is a separate fixture MR, so it stays out of this review's MR widgets.
  const gated = protection && !protection.scenario ? protection : null;
  await save('evidence/gl-code-quality.json', codeQualityReport(mutation.mutants, triage, gated?.lost ?? []));
  await writeFile('evidence/metrics.txt', metricsReport({ score: mutation.score, survived: mutation.counts.survived, noCoverage: mutation.counts.noCoverage, mutantsRun: savings.mutantsChangedLines, mutantsAvoided: savings.mutantsAvoided, aiCallsAvoided: savings.aiCallsAvoided, modelInputTokensAvoided: savings.modelInput.tokensAvoidedApprox,
    lostProtection: gated && (gated.status === 'lost' || gated.status === 'held') ? gated.lost.length : null, footprint: evidence.footprint }));
  console.log('Evidence: evidence/latest.json; MR widgets: evidence/gl-code-quality.json, evidence/metrics.txt');
  if (!baselinePassed || !complete) process.exitCode = 2;
}

async function gate() {
  const evidence = await json('evidence/latest.json');
  const headSha = process.env.CI_COMMIT_SHA ?? git('rev-parse', 'HEAD');
  const storedMetrics = mutationMetrics(evidence.mutation.mutants);
  const policy = await json('.mutant-review/policy.json');
  const changedPaths = evidence.source === 'gitlab' && evidence.provenance.baseSha ? git('-c', 'core.quotePath=false', 'diff', '--name-only', evidence.provenance.baseSha, headSha, '--').split('\n').filter(Boolean) : [];
  const protectedChanges = changedPaths.some(protectedPath);
  const protection = evidence.source === 'gitlab' ? evidence.protection ?? null : null;
  // A GitLab review always records a protection result once its baseline passed; a missing one is an incomplete review.
  const missingProtection = evidence.source === 'gitlab' && evidence.baseline.status === 'passed' && !protection ? 'no result recorded for this review' : null;
  const decision = evaluateGate({ baselinePassed: evidence.baseline.status === 'passed', complete: evidence.scope.complete && evidence.mutation.status === 'complete', expectedHeadSha: headSha, evidenceHeadSha: evidence.provenance.headSha, metrics: storedMetrics, threshold: policy.mutationThreshold ?? 100, actionableSurvivors: storedMetrics.survived, protectedFilesChanged: protectedChanges,
    lostProtection: protection?.lost?.length ?? 0, protectionRechecked: protection?.rechecked ?? 0, protectionTestOnly: changedPaths.length > 0 && changedPaths.every(isTestFile),
    protectionInconclusive: protectionBlocks(protection) ?? missingProtection });
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
        ...(protection?.lost?.length ? ['', 'Protection this MR removed (caught on the target branch, not any more):', '',
          ...protection.lost.map((item: { path: string; line: number; original: string; replacement: string; caughtBy: { name: string; fate: string }[] }) =>
            `- [ ] \`${item.path}:${item.line}\` \`${item.original.replace(/\s+/g, ' ')}\` → \`${item.replacement.replace(/\s+/g, ' ')}\`, previously caught by "${item.caughtBy[0]?.name}" (test ${item.caughtBy[0]?.fate})`)] : []),
      ].join('\n'), ['mutant-review', 'test-debt']);
      console.log(`Follow-up issue: ${issue.web_url}`);
    } catch (error) { console.error(`Could not open the test-debt issue: ${(error as Error).message}`); }
  }
  await save('evidence/gate.json', { ...final, headSha, threshold: policy.mutationThreshold ?? 100, score: storedMetrics.score, checkedAt: new Date().toISOString() });
  console.log(JSON.stringify(final, null, 2));
  if (final.status === 'failed') console.log(`Add the tests Mutant Review proposed, or have a Maintainer comment "${process.env.MUTANT_REVIEW_HANDLE ?? '@<flow-account>'} override <reason>" and re-run this job.`);
  // No executable changed lines is not a pass and not a block: exit 3, which CI shows as a warning (allow_failure: exit_codes).
  if (final.status === 'no-applicable-scope') { console.log('No mutable changed lines: nothing for the mutation gate to protect. Not a pass; shown as a warning.'); process.exitCode = 3; }
  else if (final.status !== 'passed' && final.status !== 'overridden') process.exitCode = 1;
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
  if (command === 'demo' || command === 'review') return review(command === 'demo');
  if (command === 'gate') return gate();
  if (command === 'memory') return memory(argument === '--check');
  if (command === 'check') {
    // Pre-push: the same review on the working tree. Exit 1 when a changed line has a change no test notices.
    const index = rest.indexOf('--base');
    const result = await precheck(index >= 0 ? { base: rest[index + 1] ?? '' } : {});
    console.log(formatPrecheck(result));
    process.exitCode = result.status === 'gaps' ? 1 : result.status === 'inconclusive' || result.status === 'over-budget' ? 2 : 0;
    return;
  }
  console.log('Commands: demo | review (GitLab MR CI) | gate | check [--base <ref>] (pre-push) | flow prepare|publish|notify --handle @flow | memory [--check]');
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const createdAt = new Date().toISOString();
  await save('evidence/error.json', { status: 'inconclusive', message, createdAt });
  if (['demo', 'review'].includes(process.argv[2] ?? '')) {
    await save('evidence/latest.json', reviewFailureSchema.parse({ schemaVersion: 1, kind: 'review-error', status: 'inconclusive', createdAt, log: 'evidence/error.json' }));
  }
  process.exitCode = 2;
});
