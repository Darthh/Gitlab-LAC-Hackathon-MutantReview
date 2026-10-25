/**
 * Lost protection: did this merge request's test changes stop the tests noticing something they noticed before?
 *
 * Coverage cannot see it. An agent that turns a red build green by loosening `toBe(0)` to `toBeLessThanOrEqual(500)`,
 * or by deleting the test that failed, leaves every line covered and every test passing, and the changed-line review
 * has no changed source to mutate. Mutation testing can see it: a mutant the target branch's tests killed and the MR's
 * tests no longer kill is protection the MR removed, whatever the reason.
 *
 * Kept small on purpose: only the production code the changed tests import is mutated on the target branch, and only
 * the mutants a changed test killed there are re-run at the MR head. Pure functions; packages/cli/src/protection.ts runs Stryker.
 */
import { posix } from 'node:path';
import { isProductionTypeScript, normalizePath } from './scope.js';
import { normalizeStrykerReport, type StrykerReport } from './report.js';
import type { Location, MutantStatus, MutationScope } from './types.js';
import type { MutantTriage, RankedFinding } from './triage.js';

export interface TestFileChange { path: string; change: 'modified' | 'deleted' | 'renamed'; headPath: string | null }
export interface CatchingTest { id: string; name: string; file: string; line: number | null; failure: string | null }
export interface ProtectionCandidate {
  path: string; baseLine: number; location: Location; operator: string; original: string; replacement: string; caughtBy: CatchingTest[];
}
export interface TestDiffLine { kind: ' ' | '-' | '+'; text: string }
export interface LostProtection {
  fingerprint: string; path: string; line: number; baseLine: number; location: Location; operator: string; original: string; replacement: string;
  status: 'Survived' | 'NoCoverage';
  caughtBy: (CatchingTest & { fate: 'weakened' | 'removed' })[];
  /** The first catching test on the target branch against the same test at the MR head (absent there: removed, renamed or skipped). */
  testDiff: { file: string; name: string; lines: TestDiffLine[] } | null;
  why: string;
}
export interface ProtectionResult {
  status: 'not-applicable' | 'held' | 'lost' | 'inconclusive' | 'over-budget';
  reason: string | null;
  /** Set only for the local demonstration fixture, never for a merge request. */
  scenario?: string;
  /** Every path the MR changes is a test file; only then can the gate pass on this check alone. */
  testOnly?: boolean;
  changedTests: TestFileChange[];
  /** Changed test files that are part of the mutation test run on the target branch. */
  testsInRun: string[];
  /** Production files those tests import: the only code mutated on the target branch. */
  subjects: string[];
  baseMutants: number;
  /** Target-branch mutants a changed test killed. */
  guarded: number;
  /** Of those, on lines this MR also changed: the changed-line review judges them instead. */
  onChangedLines: number;
  /** Re-run at the MR head. */
  rechecked: number;
  held: number;
  lost: LostProtection[];
  unknown: number;
  /** Measured cost of this check alone (SCI, same model as the review's footprint). */
  cost?: { cpuSeconds: number; energyWh: number; sciG: number };
}

type TestEntry = { id: string; name: string; location?: { start: { line: number } } };
export interface StrykerReportWithTests extends StrykerReport {
  files: Record<string, { source: string; mutants: (StrykerReport['files'][string]['mutants'][number] & { statusReason?: string })[] }>;
  testFiles?: Record<string, { tests: TestEntry[]; source?: string }>;
}

export const isTestFile = (path: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);

export function emptyProtection(status: ProtectionResult['status'], reason: string | null, extra: Partial<ProtectionResult> = {}): ProtectionResult {
  return { status, reason, changedTests: [], testsInRun: [], subjects: [], baseMutants: 0, guarded: 0, onChangedLines: 0, rechecked: 0, held: 0, lost: [], unknown: 0, ...extra };
}

export interface NameStatus { status: string; path: string; headPath: string | null }

/**
 * `git -c core.quotePath=false diff --name-status -z --find-renames BASE [HEAD]`: NUL-separated, so no path is ever
 * quoted or split. Renames and copies carry two paths. Unparseable paths are kept as reported (never silently dropped).
 */
export function parseNameStatus(output: string): NameStatus[] {
  const fields = output.split('\0');
  const entries: NameStatus[] = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++] ?? '';
    if (!status) continue;
    const path = fields[i++] ?? '';
    const second = /^[RC]/.test(status) ? fields[i++] ?? '' : null;
    entries.push({ status, path, headPath: status.startsWith('D') ? null : second ?? path });
  }
  return entries;
}

/**
 * Test files that existed on the target branch and changed, changed type, moved or disappeared. Added and copied files
 * cannot remove protection. Any status not understood counts as modified, so the check runs rather than being skipped.
 */
export function changedTestFiles(entries: NameStatus[]): TestFileChange[] {
  const changes: TestFileChange[] = [];
  for (const entry of entries) {
    if (!isTestFile(entry.path) || entry.status.startsWith('A') || entry.status.startsWith('C')) continue;
    const change: TestFileChange['change'] = entry.status.startsWith('D') ? 'deleted' : entry.status.startsWith('R') ? 'renamed' : 'modified';
    changes.push({ path: entry.path, change, headPath: change === 'deleted' ? null : entry.headPath });
  }
  return changes;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/g;
const RE_EXPORT = /\bexport\s+(?!type\b)(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g;

function resolveSpecifier(from: string, specifier: string, exists: (path: string) => boolean): string | null {
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (joined.startsWith('..') || joined.startsWith('/')) return null;
  const stem = joined.replace(/\.(?:[cm]?js|jsx)$/, '');
  const options = /\.tsx?$/.test(joined) ? [joined] : [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`];
  return options.find((candidate) => { try { return normalizePath(candidate) === candidate && isProductionTypeScript(candidate) && exists(candidate); } catch { return false; } }) ?? null;
}

/**
 * Production TypeScript a test file imports by relative path (`./shipping.js` resolves to `shipping.ts`), following
 * barrel re-exports (`export * from './x.js'`) a few levels, so `import { f } from './index.js'` reaches f's file.
 */
export function importedSources(testPath: string, content: string, exists: (path: string) => boolean, read?: (path: string) => string | null, limit = 20): string[] {
  const found = new Set<string>();
  const queue: string[] = [];
  for (const match of content.matchAll(SPECIFIER)) {
    const hit = resolveSpecifier(testPath, match[2]!, exists);
    if (hit && !found.has(hit)) { found.add(hit); queue.push(hit); }
  }
  for (let depth = 0; read && depth < 3 && queue.length && found.size < limit; depth++) {
    for (const file of queue.splice(0)) {
      for (const match of (read(file) ?? '').matchAll(RE_EXPORT)) {
        const hit = resolveSpecifier(file, match[2]!, exists);
        if (hit && !found.has(hit) && found.size < limit) { found.add(hit); queue.push(hit); }
      }
    }
  }
  return [...found].sort();
}

/**
 * Target-branch line number to MR-head line number for one file, from `git diff --unified=0` of that file.
 * Lines the MR changed or removed map to null; an empty diff is the identity.
 */
export function lineMap(diff: string): (line: number) => number | null {
  const hunks = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
    oldStart: Number(match[1]), oldCount: match[2] === undefined ? 1 : Number(match[2]), newCount: match[4] === undefined ? 1 : Number(match[4]),
  })).sort((a, b) => a.oldStart - b.oldStart);
  return (line) => {
    let offset = 0;
    for (const hunk of hunks) {
      if (hunk.oldCount === 0) { if (line > hunk.oldStart) { offset += hunk.newCount; continue; } break; }
      if (line < hunk.oldStart) break;
      if (line < hunk.oldStart + hunk.oldCount) return null;
      offset += hunk.newCount - hunk.oldCount;
    }
    return line + offset;
  };
}

function testIndex(report: StrykerReportWithTests): Map<string, { name: string; file: string; line: number | null }> {
  const index = new Map<string, { name: string; file: string; line: number | null }>();
  for (const [rawPath, file] of Object.entries(report.testFiles ?? {})) {
    let path: string;
    try { path = normalizePath(rawPath); } catch { continue; }
    for (const test of file.tests ?? []) index.set(String(test.id), { name: test.name, file: path, line: test.location?.start.line ?? null });
  }
  return index;
}

function testSource(report: StrykerReportWithTests, file: string): string | undefined {
  for (const [rawPath, entry] of Object.entries(report.testFiles ?? {})) {
    try { if (normalizePath(rawPath) === file) return entry.source; } catch { /* not a repository path */ }
  }
  return undefined;
}

const sliceSource = (source: string, location: Location) => {
  const lines = source.split('\n');
  const offset = (line: number, column: number) => lines.slice(0, line - 1).reduce((n, text) => n + text.length + 1, 0) + Math.max(0, column - 1);
  return source.slice(offset(location.start.line, location.start.column), offset(location.end.line, location.end.column));
};

/**
 * Mutants the target branch's tests killed where a killing test lives in a changed test file, located at the MR head.
 * A mutant killed only by unchanged tests is still killed by them; one on a line the MR changed is the changed-line review's.
 */
export interface HeadTarget { path: string; map: (line: number) => number | null }

/** `targets` maps each target-branch file to its head path (renames followed) and line map; a missing one maps nothing. */
export function protectionCandidates(base: StrykerReportWithTests, changedTests: Set<string>, targets: Record<string, HeadTarget | undefined>) {
  const tests = testIndex(base);
  const candidates: ProtectionCandidate[] = [];
  let baseMutants = 0, guarded = 0, onChangedLines = 0;
  for (const [rawPath, file] of Object.entries(base.files)) {
    const path = normalizePath(rawPath);
    for (const mutant of file.mutants) {
      baseMutants++;
      if (mutant.status !== 'Killed') continue;
      const caughtBy = (mutant.killedBy ?? []).map((id) => ({ id: String(id), ...tests.get(String(id)) })).filter((test): test is CatchingTest => Boolean(test.name && test.file))
        .map((test, index) => ({ id: test.id, name: test.name, file: test.file, line: test.line ?? null, failure: index === 0 ? mutant.statusReason?.slice(0, 300) ?? null : null }));
      if (!caughtBy.some((test) => changedTests.has(test.file))) continue;
      guarded++;
      // Every line the mutant spans must be unchanged and still contiguous at the head, or the comparison is not like for like.
      const target = targets[path];
      const map = target?.map;
      const { start: { line: from }, end: { line: to } } = mutant.location;
      const start = map?.(from) ?? null;
      if (start === null || Array.from({ length: to - from + 1 }, (_, k) => map!(from + k)).some((mapped, k) => mapped !== start + k)) { onChangedLines++; continue; }
      candidates.push({
        path: target!.path, baseLine: mutant.location.start.line, operator: mutant.mutatorName, replacement: mutant.replacement, original: sliceSource(file.source, mutant.location), caughtBy,
        location: { start: { line: start, column: mutant.location.start.column }, end: { line: start + to - from, column: mutant.location.end.column } },
      });
    }
  }
  return { candidates, baseMutants, guarded, onChangedLines };
}

/** `path:start-end` ranges at the MR head that hold every candidate, merged per line. */
export function candidateRanges(candidates: ProtectionCandidate[]): string[] {
  const ranges = new Set(candidates.map((item) => `${item.path}:${item.location.start.line}-${item.location.end.line}`));
  return [...ranges].sort();
}

/** The `it(...)` block that starts on `line` (1-based), by bracket depth, skipping string and template contents. */
export function testBlock(source: string, line: number, maxLines = 40): string[] {
  const lines = source.split(/\r?\n/).slice(line - 1, line - 1 + maxLines);
  const out: string[] = [];
  let depth = 0, opened = false, quote: string | null = null;
  for (const text of lines) {
    out.push(text);
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      if (quote) { if (char === '\\') i++; else if (char === quote) quote = null; continue; }
      if (char === '/' && text[i + 1] === '/') break;
      if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
      if (char === '(' || char === '{' || char === '[') { depth++; opened = true; }
      else if (char === ')' || char === '}' || char === ']') depth--;
    }
    if (quote !== '`') quote = null;
    if (opened && depth <= 0) break;
  }
  return out;
}

/** Line diff by longest common subsequence; small inputs only (two test blocks). */
export function diffLines(before: string[], after: string[]): TestDiffLine[] {
  const a = before.slice(0, 80), b = after.slice(0, 80);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: TestDiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: ' ', text: a[i]! }); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: '-', text: a[i++]! });
    else out.push({ kind: '+', text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: '-', text: a[i++]! });
  while (j < b.length) out.push({ kind: '+', text: b[j++]! });
  return out;
}

const flat = (code: string) => { const text = code.replace(/\s+/g, ' ').trim(); return text.length > 60 ? `${text.slice(0, 57)}...` : text; };

/** Repository text inside a `code span` of a sentence that also lands in MR comments: no backtick can close the span early. */
const span = (text: string) => `\`${flat(text).replaceAll('`', "'")}\``;

export function lostWhy(item: Pick<LostProtection, 'original' | 'replacement' | 'line' | 'caughtBy'>): string {
  const test = item.caughtBy[0]!;
  const change = `${span(item.original)} became ${span(item.replacement)}`;
  return test.fate === 'weakened'
    ? `On the target branch, ${span(test.name)} failed when ${change} on line ${item.line}. This MR changed that test and it no longer fails, so the change goes unnoticed.`
    : `On the target branch, ${span(test.name)} failed when ${change} on line ${item.line}. This MR removed, renamed or skipped that test, and no other test notices the change.`;
}

/**
 * Re-run results at the MR head against the candidates. Killed or timed out: protection held. Survived or uncovered:
 * protection lost. Anything that cannot be matched or ran with an error is counted unknown, which the caller treats
 * as inconclusive, never as held.
 */
export function compareProtection(candidates: ProtectionCandidate[], base: StrykerReportWithTests, head: StrykerReportWithTests) {
  const byPath = new Map<string, MutationScope>();
  for (const item of candidates) {
    const file = byPath.get(item.path) ?? { path: item.path, change: 'modified' as const, lines: [] };
    file.lines.push({ start: item.location.start.line, end: item.location.end.line });
    byPath.set(item.path, file);
  }
  const mutants = normalizeStrykerReport(head, [...byPath.values()]);
  const headTests = [...testIndex(head).values()];
  // Same file first, then anywhere (the test file may have been renamed); a name the head no longer runs was removed, renamed or skipped.
  const headTest = (test: CatchingTest) => headTests.find((other) => other.file === test.file && other.name === test.name) ?? headTests.find((other) => other.name === test.name);
  const sameAt = (a: Location, b: Location) => a.start.line === b.start.line && a.start.column === b.start.column && a.end.line === b.end.line && a.end.column === b.end.column;
  let held = 0, unknown = 0;
  const lost: LostProtection[] = [];
  for (const candidate of candidates) {
    const match = mutants.find((mutant) => mutant.path === candidate.path && mutant.operator === candidate.operator && mutant.replacement === candidate.replacement && sameAt(mutant.location, candidate.location));
    const status: MutantStatus | undefined = match?.status;
    if (status === 'Killed' || status === 'Timeout') { held++; continue; }
    if (!match || (status !== 'Survived' && status !== 'NoCoverage')) { unknown++; continue; }
    const caughtBy = candidate.caughtBy.map((test) => ({ ...test, fate: headTest(test) ? 'weakened' as const : 'removed' as const }));
    const first = caughtBy[0]!;
    const baseSource = testSource(base, first.file);
    const now = headTest(first);
    const headSource = now ? testSource(head, now.file) : undefined;
    const before = baseSource && first.line ? testBlock(baseSource, first.line) : [];
    const after = headSource && now?.line ? testBlock(headSource, now.line) : [];
    const item = {
      fingerprint: match.fingerprint, path: candidate.path, line: candidate.location.start.line, baseLine: candidate.baseLine, location: candidate.location,
      operator: candidate.operator, original: candidate.original, replacement: candidate.replacement, status, caughtBy,
      testDiff: before.length ? { file: first.file, name: first.name, lines: diffLines(before, after) } : null,
    };
    lost.push({ ...item, why: lostWhy(item) });
  }
  return { held, unknown, lost, mutants: mutants.filter((mutant) => lost.some((item) => item.fingerprint === mutant.fingerprint)) };
}

/** One verdict for the gate and the reviewer. Unknown results fail closed as inconclusive. */
export function protectionVerdict(input: Omit<ProtectionResult, 'status' | 'reason'>): ProtectionResult {
  if (input.unknown) return { ...input, status: 'inconclusive', reason: `${input.unknown} mutant(s) killed on the target branch could not be re-checked at the MR head.` };
  if (input.lost.length) return { ...input, status: 'lost', reason: `${input.lost.length} change(s) the target branch's tests noticed are no longer noticed after this MR's test changes.` };
  return { ...input, status: 'held', reason: input.guarded
    ? `The changed tests still notice all ${input.rechecked} re-checked change(s) they noticed on the target branch${input.onChangedLines ? ` (${input.onChangedLines} on changed lines are judged by the changed-line review)` : ''}.`
    : 'On the target branch, no mutant in the code these tests import was killed by a changed test, so no protection could be lost.' };
}

/** A lost-protection mutant as a review finding: ranked first, because it is a regression rather than a pre-existing gap. */
export function lostFinding(item: LostProtection): RankedFinding {
  return { rank: 0, fingerprint: item.fingerprint, path: item.path, line: item.line, endLine: item.location.end.line, operator: item.operator, original: item.original, replacement: item.replacement,
    status: item.status, priority: 'high', why: item.why, origin: 'lost-protection' };
}

/** Puts lost protection ahead of changed-line findings within the same comment budget. */
export function withLostProtection(triage: MutantTriage, lost: LostProtection[], limit = 3): MutantTriage {
  if (!lost.length) return triage;
  const lines = new Set<string>();
  const first = lost.map(lostFinding).filter((item) => { const key = `${item.path}:${item.line}`; if (lines.has(key)) return false; lines.add(key); return true; });
  const rest = triage.ranked.filter((item) => !lines.has(`${item.path}:${item.line}`));
  const all = [...first, ...rest];
  return { ...triage, considered: triage.considered + lost.length, ranked: all.slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 })), overflow: triage.overflow + Math.max(0, all.length - limit) };
}
