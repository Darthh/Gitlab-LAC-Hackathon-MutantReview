/**
 * Runs the lost-protection check (review-core/src/protection.ts) for a merge request or for a working tree.
 *
 *   1. Which existing test files did the change edit, move or delete? None: nothing can be lost, nothing runs.
 *   2. A detached worktree of the target branch. There, the test files in the mutation run (vitest list) and the
 *      production files they import: the only code that is mutated.
 *   3. Stryker on those files on the target branch: which mutants did a changed test kill?
 *   4. Stryker at the head on only those mutants' lines. Killed before and not now is protection the change removed.
 *
 * Read-only. Both runs use this checkout's protected Stryker configuration; the worktree is removed afterwards.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  candidateRanges, changedTestFiles, compareProtection, emptyProtection, importedSources, lineMap, parseNameStatus, protectionCandidates, protectionVerdict,
  type ProtectionCandidate, type ProtectionResult, type StrykerReportWithTests,
} from '../../review-core/src/protection.js';
import type { NormalizedMutant } from '../../review-core/src/types.js';
import { execute, type Execution } from './runner.js';
import { git, json, runStryker } from './review.js';

export interface ProtectionRun {
  result: ProtectionResult;
  /** Every execution the check made, for the review's footprint. */
  runs: { step: string; run: Execution }[];
  /** Head source text of the files that lost protection, for triage and the drafting brief. */
  sources: Record<string, string>;
  /** The lost-protection mutants as Stryker reported them at the head. */
  mutants: NormalizedMutant[];
}

const sourcesOf = (report: StrykerReportWithTests) => Object.fromEntries(Object.entries(report.files).map(([path, file]) => [path.replaceAll('\\', '/').replace(/^\.\//, ''), file.source]));

/** Was Stryker's "nothing to mutate" message the reason there is no report? */
const mutantFree = async (run: Execution) => run.exitCode === 0 && !run.timedOut && /mutant-free world/i.test(await readFile(run.log, 'utf8').catch(() => ''));
/** Stryker stops when no test relates to the mutated files (vitest.related): every mutant there is uncovered, not an error. */
const noTestsRan = async (run: Execution) => !run.timedOut && /ERROR Stryker No tests were executed/.test(await readFile(run.log, 'utf8').catch(() => ''));

/**
 * `base`: the target branch commit. `head`: the MR head commit, or null for the working tree (pre-push check).
 * The process must be running in the head checkout.
 */
/** The report Stryker would write if it ran no test at all: each candidate NoCoverage, in the head's source. */
async function uncoveredReport(candidates: ProtectionCandidate[]): Promise<StrykerReportWithTests> {
  const files: StrykerReportWithTests['files'] = {};
  for (const [index, item] of candidates.entries()) {
    files[item.path] ??= { source: await readFile(item.path, 'utf8'), mutants: [] };
    files[item.path]!.mutants.push({ id: `uncovered-${index}`, mutatorName: item.operator, replacement: item.replacement, status: 'NoCoverage', location: item.location, coveredBy: [], killedBy: [] });
  }
  return { files, testFiles: {} };
}

export async function checkProtection(options: { base: string; head: string | null; budget: { files: number; runtimeMs: number } }): Promise<ProtectionRun> {
  const { base, head, budget } = options;
  const runs: ProtectionRun['runs'] = [];
  const done = (result: ProtectionResult, extra: Partial<ProtectionRun> = {}): ProtectionRun => ({ result, runs, sources: {}, mutants: [], ...extra });
  const revisions = [base, ...(head ? [head] : [])];
  // NUL-separated and unquoted: every path arrives exactly as committed, renames with both names.
  const entries = parseNameStatus(execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-status', '-z', '--find-renames', ...revisions, '--'], { encoding: 'utf8', windowsHide: true, maxBuffer: 8_000_000 }));
  const changedTests = changedTestFiles(entries);
  if (!changedTests.length) return done(emptyProtection('not-applicable', 'This change edits, moves or deletes no existing test file.'));

  const config = (await json('stryker.config.json')).vitest?.configFile ?? 'vitest.config.ts';
  const worktree = join(tmpdir(), `mutant-review-base-${randomBytes(6).toString('hex')}`);
  git('worktree', 'add', '--detach', '--force', worktree, base);
  try {
    await symlink(resolve('node_modules'), join(worktree, 'node_modules'), 'junction');
    const root = realpathSync(worktree);
    // The target branch's own test selection: a changed file the mutation run never executes cannot have protected anything.
    const listFile = resolve('evidence/protection/base-tests.json');
    await rm(listFile, { force: true });
    const list = await execute([resolve('node_modules/vitest/vitest.mjs'), 'list', '--config', config, '--filesOnly', `--json=${listFile}`], 'evidence/protection/base-list.log', budget.runtimeMs, worktree);
    runs.push({ step: 'Target-branch test list', run: list });
    const listed = await json(listFile).catch(() => null) as { file: string }[] | null;
    if (list.exitCode !== 0 || !Array.isArray(listed)) {
      return done(emptyProtection('inconclusive', `Vitest could not list the target branch's tests (see ${list.log}).`, { changedTests }));
    }
    const inRun = new Set(listed.map((item) => relative(root, realpathSync(item.file)).replaceAll('\\', '/')));
    const testsInRun = changedTests.map((item) => item.path).filter((path) => inRun.has(path));
    if (!testsInRun.length) return done(emptyProtection('not-applicable', `The changed test files are not part of the mutation test run (${config}).`, { changedTests }));

    const inWorktree = (path: string) => existsSync(join(worktree, path));
    const readInWorktree = (path: string) => { try { return readFileSync(join(worktree, path), 'utf8'); } catch { return null; } };
    const subjects = [...new Set((await Promise.all(testsInRun.map(async (path) =>
      importedSources(path, await readFile(join(worktree, path), 'utf8'), inWorktree, readInWorktree)))).flat())].sort();
    const context = { changedTests, testsInRun, subjects };
    if (!subjects.length) return done(emptyProtection('not-applicable', 'The changed tests import no production TypeScript by relative path.', context));
    if (subjects.length > budget.files) return done(emptyProtection('over-budget', `The changed tests import ${subjects.length} production files; the policy budget is ${budget.files}.`, context));

    const before = await runStryker(subjects, { incremental: false, name: 'protection-base', timeoutMs: budget.runtimeMs, cwd: worktree });
    runs.push({ step: 'Stryker on the target branch (code the changed tests import)', run: before.run });
    if (before.run.timedOut) return done(emptyProtection('over-budget', 'Mutating the code the changed tests import exceeded the runtime budget on the target branch.', context));
    if (!before.report) {
      if (await mutantFree(before.run)) return done(emptyProtection('not-applicable', 'Stryker generated no mutants in the code the changed tests import.', context));
      // The changed tests are in the run and import this code, so "no tests ran" contradicts the target branch: fail closed.
      if (await noTestsRan(before.run)) return done(emptyProtection('inconclusive', `Stryker ran no test on the target branch for code the changed tests import (see ${before.run.log}).`, context));
      return done(emptyProtection('inconclusive', `Stryker could not finish on the target branch (see ${before.run.log}). Its tests may be failing.`, context));
    }
    const baseReport = before.report as unknown as StrykerReportWithTests;

    // Target-branch line -> head path and line per subject, following renames. A subject the change deleted maps nothing:
    // its code is gone, or reappears as added lines the changed-line review mutates in full.
    const targets = Object.fromEntries(subjects.map((path) => {
      const entry = entries.find((item) => item.path === path);
      const headPath = !entry ? path : entry.status.startsWith('D') ? null : entry.headPath;
      const present = headPath !== null && (head ? (() => { try { git('cat-file', '-e', `${head}:${headPath}`); return true; } catch { return false; } })() : existsSync(headPath));
      if (!present || headPath === null) return [path, undefined];
      const paths = headPath === path ? [path] : [path, headPath];
      return [path, { path: headPath, map: lineMap(git('diff', '--no-ext-diff', '--no-textconv', '--text', '--unified=0', '--find-renames', ...revisions, '--', ...paths)) }];
    }));
    const { candidates, baseMutants, guarded, onChangedLines } = protectionCandidates(baseReport, new Set(testsInRun), targets);
    const counts = { ...context, baseMutants, guarded, onChangedLines, rechecked: candidates.length };
    if (!candidates.length) return done(protectionVerdict({ ...counts, held: 0, lost: [], unknown: 0 }));

    const after = await runStryker(candidateRanges(candidates), { incremental: false, name: 'protection-head', timeoutMs: budget.runtimeMs });
    runs.push({ step: 'Stryker at the head (mutants a changed test killed)', run: after.run });
    const unchecked = { ...counts, rechecked: 0 };
    if (after.run.timedOut) return done(emptyProtection('over-budget', 'Re-checking the guarded mutants at the head exceeded the runtime budget.', unchecked));
    let headReport = after.report as unknown as StrykerReportWithTests | null;
    // No test at the head touches this code any more (deleted or no longer importing it): every guarded mutant is uncovered.
    if (!headReport && await noTestsRan(after.run)) headReport = await uncoveredReport(candidates);
    if (!headReport) return done(emptyProtection('inconclusive', `Stryker could not finish at the head (see ${after.run.log}). The tests may be failing.`, unchecked));
    const { held, lost, unknown, mutants } = compareProtection(candidates, baseReport, headReport);
    const sources = sourcesOf(headReport);
    return done(protectionVerdict({ ...counts, held, lost, unknown }), { sources, mutants });
  } finally {
    // Unlink the shared node_modules first, so no cleanup path can ever reach the real one.
    await rm(join(worktree, 'node_modules'), { force: true }).catch(() => undefined);
    try { git('worktree', 'remove', '--force', worktree); } catch { await rm(worktree, { recursive: true, force: true }); git('worktree', 'prune'); }
  }
}

// ---------- Scratch repositories: the local demonstration and the end-to-end proof ----------

const SETUP = ['package.json', 'tsconfig.json', 'stryker.config.json', 'vitest.domain.config.ts', '.mutant-review/policy.json',
  'packages/demo-domain/CONTRACTS.md', 'packages/demo-domain/src/shipping.ts', 'packages/demo-domain/src/shipping.test.ts', 'packages/demo-domain/src/discount.ts', 'packages/demo-domain/src/discount.test.ts'];

export interface ScratchRepository { dir: string; base: string; head: string; cleanup(): Promise<void> }

/**
 * A throwaway git repository with this project's test setup and demo domain: one commit with each file's `base`
 * content, then one commit with its `head` content (null: absent at that commit). node_modules is shared by symlink.
 */
export async function scratchRepository(files: { path: string; base: string | null; head: string | null }[], message = 'test: update tests'): Promise<ScratchRepository> {
  const dir = join(tmpdir(), `mutant-review-scratch-${randomBytes(6).toString('hex')}`);
  const run = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Mutant Review demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
  const put = async (path: string, content: string) => { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); };
  await mkdir(dir, { recursive: true });
  for (const path of SETUP) await put(path, await readFile(path, 'utf8'));
  await put('.gitignore', 'node_modules\nevidence/\n.stryker-tmp/\n');
  await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'junction');
  for (const file of files) { if (file.base === null) await rm(join(dir, file.path), { force: true }); else await put(file.path, file.base); }
  run('init', '-q', '-b', 'main');
  run('add', '-A');
  run('commit', '-q', '-m', 'main: checkout contracts and tests');
  const base = run('rev-parse', 'HEAD');
  for (const file of files) { if (file.head === null) await rm(join(dir, file.path), { force: true }); else await put(file.path, file.head); }
  run('add', '-A');
  run('commit', '-q', '-m', message);
  return { dir, base, head: run('rev-parse', 'HEAD'), cleanup: async () => { await rm(join(dir, 'node_modules'), { force: true }); await rm(dir, { recursive: true, force: true }); } };
}

export const BOUNDARY_TEST = "it('ships free at exactly $100 (SHIPPING-001)', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});";
const BOUNDARY_ASSERTION = /expect\(shippingFee\(10_000\)\)\.toBe\(0\)/;

/**
 * The local demonstration's second scenario, executed for real in a scratch repository: the target branch carries the
 * exact-$100 boundary test that `apply 1` commits in the boundary review, and the change loosens its assertion to
 * `toBeLessThanOrEqual(500)`, the way an agent might to turn a red build green. Shown in Front Desk, never gated.
 */
export async function demoProtection(budget: { files: number; runtimeMs: number }): Promise<ProtectionRun | null> {
  const testPath = 'packages/demo-domain/src/shipping.test.ts';
  const current = await readFile(testPath, 'utf8');
  const base = BOUNDARY_ASSERTION.test(current) ? current : `${current.trimEnd()}\n\n${BOUNDARY_TEST}\n`;
  const repo = await scratchRepository([{ path: testPath, base, head: base.replace(BOUNDARY_ASSERTION, 'expect(shippingFee(10_000)).toBeLessThanOrEqual(500)') }],
    'test: make the shipping tests robust to fee changes');
  const home = process.cwd();
  try {
    process.chdir(repo.dir);
    const run = await checkProtection({ base: repo.base, head: repo.head, budget });
    run.result.scenario = 'Demonstration fixture, separate from the boundary review: the target branch has the exact-$100 test that apply 1 commits, and the change loosens it from toBe(0) to toBeLessThanOrEqual(500).';
    return run;
  } finally {
    process.chdir(home);
    await repo.cleanup();
  }
}
