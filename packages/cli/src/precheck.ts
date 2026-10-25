/**
 * Pre-push check: the same changed-line mutation review, run on a working tree before anything is pushed.
 * A coding agent (GitLab Duo Agentic Chat, Claude Code, Cursor) calls it through the MCP server in mcp.ts,
 * or a person runs `npm run mr -- check`. The useless test is caught before an MR, a pipeline or a reviewer exists.
 * Read-only: it never commits, and verify_test restores every file it touches.
 */
import { readFile } from 'node:fs/promises';
import { parseDiff, isProductionTypeScript, normalizePath, strykerRanges } from '../../review-core/src/scope.js';
import { mutationMetrics, normalizeStrykerReport } from '../../review-core/src/report.js';
import { triageMutants, type RankedFinding } from '../../review-core/src/triage.js';
import { footprintReceipt, formatGrams, type FootprintReceipt } from '../../review-core/src/footprint.js';
import type { MutationScope } from '../../review-core/src/types.js';
import { buildBrief, draftTestSchema, verifyDraft } from './flow.js';
import { git, json, runStryker, save, usageOf } from './review.js';

const STATE = '.mutant-review/work/precheck.json';

export interface PrecheckResult {
  base: string;
  scope: MutationScope[];
  status: 'clean' | 'gaps' | 'no-scope' | 'over-budget' | 'inconclusive';
  reason: string | null;
  score: number | null;
  counts: { killed: number; survived: number; noCoverage: number; total: number };
  findings: (RankedFinding & { testPath: string })[];
  arid: number;
  overflow: number;
  brief: string;
  footprint: FootprintReceipt | null;
}

/** A ref an agent may pass: a branch, tag or SHA. Never an option, never a range. */
export function safeRef(ref: string): string {
  if (!/^[A-Za-z0-9][\w./-]{0,199}$/.test(ref) || ref.includes('..')) throw new Error(`Unsupported base ref: ${ref}`);
  return ref;
}

/** Default base: where this branch left the default branch, so committed-but-unpushed work counts too. */
export function defaultBase(): string {
  for (const candidate of ['origin/HEAD', 'origin/main', 'origin/master']) {
    try { return git('merge-base', 'HEAD', candidate); } catch { /* try the next */ }
  }
  return 'HEAD';
}

/** Changed executable lines between `base` and the working tree, plus new untracked source files. */
export async function workingTreeScope(base: string): Promise<MutationScope[]> {
  const scope = parseDiff(git('diff', '--no-ext-diff', '--unified=0', '--find-renames', safeRef(base), '--'));
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean).filter(isProductionTypeScript);
  for (const path of untracked) {
    const lines = (await readFile(normalizePath(path), 'utf8')).split('\n').length;
    if (lines > 0 && !scope.some((file) => file.path === path)) scope.push({ path, lines: [{ start: 1, end: lines }], change: 'added' });
  }
  return scope;
}

export async function precheck(options: { base?: string } = {}): Promise<PrecheckResult> {
  const base = options.base ? safeRef(options.base) : defaultBase();
  const scope = await workingTreeScope(base);
  const policy = await json('.mutant-review/policy.json').catch(() => ({}));
  const budget = { files: policy.budgets?.files ?? 5, changedLines: policy.budgets?.changedLines ?? 100, runtimeMs: (policy.budgets?.runtimeSeconds ?? 180) * 1000 };
  const lines = scope.reduce((sum, file) => sum + file.lines.reduce((n, range) => n + range.end - range.start + 1, 0), 0);
  const empty = { killed: 0, survived: 0, noCoverage: 0, total: 0 };
  const result = (status: PrecheckResult['status'], reason: string | null, extra: Partial<PrecheckResult> = {}): PrecheckResult =>
    ({ base, scope, status, reason, score: null, counts: empty, findings: [], arid: 0, overflow: 0, brief: '', footprint: null, ...extra });
  if (!scope.length) return result('no-scope', 'No executable TypeScript lines changed since the base.');
  if (scope.length > budget.files || lines > budget.changedLines) return result('over-budget', `${scope.length} file(s) and ${lines} changed line(s) exceed the policy budget of ${budget.files} files and ${budget.changedLines} lines. Check a smaller change.`);

  const { run, report } = await runStryker(strykerRanges(scope), { incremental: false, name: 'precheck', timeoutMs: budget.runtimeMs });
  const footprint = footprintReceipt({ review: [{ ...usageOf(run)!, step: 'Stryker on changed lines' }], changedLinesRun: null, wholeFileDryRun: null, changedMutants: 0, wholeFileMutants: null, env: process.env });
  if (run.exitCode !== 0 || run.timedOut || !report) {
    const log = await readFile(run.log, 'utf8').catch(() => '');
    if (run.exitCode === 0 && /mutant-free world/i.test(log)) return result('no-scope', 'Stryker generated no mutants on the changed lines.', { footprint });
    return result('inconclusive', run.timedOut ? 'Stryker exceeded the runtime budget.' : `Stryker did not finish (see ${run.log}). The existing tests may be failing.`, { footprint });
  }
  const mutants = normalizeStrykerReport(report as never, scope);
  const metrics = mutationMetrics(mutants);
  const sources = Object.fromEntries(Object.entries((report as { files?: Record<string, { source: string }> }).files ?? {}).map(([path, file]) => [path.replaceAll('\\', '/').replace(/^\.\//, ''), file.source]));
  const triage = triageMutants(mutants, sources);
  const { targets, brief } = triage.ranked.length ? await buildBrief(triage.ranked, sources) : { targets: [], brief: '' };
  const checked = result(targets.length ? 'gaps' : 'clean', null, {
    score: metrics.score,
    counts: { killed: metrics.killed + metrics.timedOut, survived: metrics.survived, noCoverage: metrics.noCoverage, total: metrics.total },
    findings: targets, arid: triage.arid.length, overflow: triage.overflow, brief, footprint,
  });
  await save(STATE, { base, findings: targets, createdAt: new Date().toISOString() });
  return checked;
}

/** Human- and agent-readable report. The agent gets the same brief the Duo flow's drafting step gets. */
export function formatPrecheck(result: PrecheckResult): string {
  const cost = result.footprint ? ` Check cost: ${formatGrams(result.footprint.actual.sciG)} (${result.footprint.actual.cpuSeconds} CPU-s).` : '';
  if (result.status !== 'gaps' && result.status !== 'clean') return `Mutant Review pre-push check (base ${result.base.slice(0, 12)}): ${result.status}. ${result.reason ?? ''}${cost}`.trim();
  const head = `Mutant Review pre-push check (base ${result.base.slice(0, 12)}): changed-line mutation score ${result.score === null ? 'n/a' : `${result.score.toFixed(0)}%`} (${result.counts.killed} of ${result.counts.total} mutants noticed by a test).${cost}`;
  if (result.status === 'clean') return `${head}\nEvery change Stryker made to your changed lines failed a test. Nothing to add.`;
  return [
    head,
    `${result.findings.length} change(s) no test would notice${result.arid ? ` (${result.arid} logging/message mutant(s) ignored as noise)` : ''}${result.overflow ? `, ${result.overflow} lower-ranked not shown` : ''}.`,
    'For each finding, write ONE test that passes on the current code and fails on the mutation, with the expected value taken from the written requirement, never from calling the code. Then call verify_test with it before adding it to the file: a test that also passes on the mutant protects nothing.',
    result.brief.replace(/^MODE: review\n\n.*\n\n/, ''),
  ].join('\n\n');
}

/** Executes a draft against the finding's mutant. The test file is restored afterwards either way. */
export async function verifyTest(input: unknown): Promise<{ verdict: 'verified' | 'rejected'; reason: string | null; testPath: string; finding: number }> {
  const state = await json(STATE).catch(() => null) as { findings: (RankedFinding & { testPath: string })[] } | null;
  if (!state?.findings?.length) throw new Error('Run mutation_check first; there are no open findings to verify against.');
  const draft = draftTestSchema.parse(input);
  const finding = state.findings.find((item) => item.rank === draft.finding);
  if (!finding) throw new Error(`No finding ${draft.finding} in the last check (findings: ${state.findings.map((item) => item.rank).join(', ')}).`);
  const verdict = await verifyDraft(draft, finding, 100 + draft.finding);
  return 'reason' in verdict
    ? { verdict: 'rejected', reason: verdict.reason, testPath: draft.testPath, finding: draft.finding }
    : { verdict: 'verified', reason: null, testPath: draft.testPath, finding: draft.finding };
}
