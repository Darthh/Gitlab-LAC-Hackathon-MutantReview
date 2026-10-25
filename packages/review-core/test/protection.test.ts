import { describe, expect, it } from 'vitest';
import {
  candidateRanges, changedTestFiles, codeQualityReport, isProductionTypeScript, compareProtection, diffLines, evaluateGate, importedSources, lineMap, metricsReport, mutationMetrics,
  protectionCandidates, protectionVerdict, testBlock, withLostProtection, type MutantTriage, type StrykerReportWithTests,
} from '../src/index.js';

const SOURCE = 'packages/demo-domain/src/shipping.ts';
const TESTS = 'packages/demo-domain/src/shipping.test.ts';
const source = "/** SHIPPING-001 */\nexport function shippingFee(subtotalCents: number): number {\n  return subtotalCents >= 10_000 ? 0 : 500;\n}\n";
const baseTests = [
  "import { describe, expect, it } from 'vitest';",
  "import { shippingFee } from './shipping.js';",
  '',
  "describe('shipping fee', () => {",
  "  it('charges $5 below the free-shipping threshold', () => {",
  '    expect(shippingFee(9_999)).toBe(500);',
  '  });',
  '',
  "  it('ships for free above the threshold', () => {",
  '    expect(shippingFee(10_001)).toBe(0);',
  '  });',
  '});',
  '',
].join('\n');
const weakenedTests = baseTests.replace('expect(shippingFee(10_001)).toBe(0);', 'expect(shippingFee(10_001)).toBeLessThanOrEqual(500);');

const at = (line: number, from: number, to: number) => ({ start: { line, column: from }, end: { line, column: to } });
const tests = (text: string) => ({ [TESTS]: { source: text, tests: [
  { id: '0', name: 'shipping fee charges $5 below the free-shipping threshold', location: { start: { line: 5 } } },
  { id: '1', name: 'shipping fee ships for free above the threshold', location: { start: { line: 9 } } },
] } });
// The four mutants Stryker makes on line 3 plus the function body, as the target branch's tests leave them.
const base: StrykerReportWithTests = {
  files: { [SOURCE]: { source, mutants: [
    { id: '0', mutatorName: 'BlockStatement', replacement: '{}', status: 'Killed', killedBy: ['0'], coveredBy: ['0', '1'], location: { start: { line: 2, column: 60 }, end: { line: 4, column: 2 } }, statusReason: 'expected undefined to be 500' },
    { id: '1', mutatorName: 'ConditionalExpression', replacement: 'true', status: 'Killed', killedBy: ['0'], coveredBy: ['0', '1'], location: at(3, 10, 33), statusReason: 'expected +0 to be 500' },
    { id: '2', mutatorName: 'ConditionalExpression', replacement: 'false', status: 'Killed', killedBy: ['1'], coveredBy: ['0', '1'], location: at(3, 10, 33), statusReason: 'expected 500 to be +0' },
    { id: '3', mutatorName: 'EqualityOperator', replacement: 'subtotalCents > 10_000', status: 'Survived', killedBy: [], coveredBy: ['0', '1'], location: at(3, 10, 33) },
  ] } },
  testFiles: tests(baseTests),
};
// The MR loosened `toBe(0)`: the always-$5 mutant now survives, the others are still killed.
const head = (status: string): StrykerReportWithTests => ({
  files: { [SOURCE]: { source, mutants: [
    { id: '1', mutatorName: 'ConditionalExpression', replacement: 'true', status: 'Killed', killedBy: ['0'], location: at(3, 10, 33) },
    { id: '2', mutatorName: 'ConditionalExpression', replacement: 'false', status, killedBy: [], location: at(3, 10, 33) },
    { id: '3', mutatorName: 'EqualityOperator', replacement: 'subtotalCents > 10_000', status: 'Survived', killedBy: [], location: at(3, 10, 33) },
  ] } },
  testFiles: tests(weakenedTests),
});
const identity = { [SOURCE]: lineMap('') };

describe('which test changes can lose protection', () => {
  it('keeps modified, deleted and renamed test files, never added ones or source files', () => {
    expect(changedTestFiles(['M\tsrc/a.test.ts', 'A\tsrc/new.test.ts', 'D\tsrc/b.spec.ts', 'R087\tsrc/c.test.ts\tsrc/d.test.ts', 'M\tsrc/a.ts', 'M\t../x.test.ts', ''].join('\n'))).toEqual([
      { path: 'src/a.test.ts', change: 'modified', headPath: 'src/a.test.ts' },
      { path: 'src/b.spec.ts', change: 'deleted', headPath: null },
      { path: 'src/c.test.ts', change: 'renamed', headPath: 'src/d.test.ts' },
    ]);
  });
  it('never treats test, spec or end-to-end files as production code', () => {
    expect(['src/a.ts', 'src/a.test.ts', 'src/a.spec.ts', 'packages/cli/src/mcp.e2e.ts'].map(isProductionTypeScript)).toEqual([true, false, false, false]);
  });
  it('resolves the production modules a test imports, ESM .js specifiers included', () => {
    const files = new Set([SOURCE, 'packages/demo-domain/src/money/index.ts', 'packages/demo-domain/src/fixtures/cart.ts']);
    const content = `${baseTests}\nimport { cents } from './money';\nimport { cart } from './fixtures/cart.js';\nimport x from '../../../../outside.js';\nimport { z } from 'zod';`;
    expect(importedSources(TESTS, content, (path) => files.has(path))).toEqual(['packages/demo-domain/src/money/index.ts', SOURCE]);
  });
});

describe('line map from target branch to MR head', () => {
  it('is the identity for an unchanged file', () => expect(lineMap('')(7)).toBe(7));
  it('shifts lines after insertions and deletions and drops changed lines', () => {
    const map = lineMap(['@@ -2,0 +3,2 @@', '+a', '+b', '@@ -5 +7 @@', '-x', '+y', '@@ -9,2 +10,0 @@', '-p', '-q'].join('\n'));
    expect([1, 2, 3, 4, 5, 6, 8, 9, 10, 11].map(map)).toEqual([1, 2, 5, 6, null, 8, 10, null, null, 11]);
  });
});

describe('lost protection', () => {
  const changed = new Set([TESTS]);
  it('re-checks only mutants a changed test killed, on lines the MR left alone', () => {
    const { candidates, baseMutants, guarded, onChangedLines } = protectionCandidates(base, changed, identity);
    expect({ baseMutants, guarded, onChangedLines }).toEqual({ baseMutants: 4, guarded: 3, onChangedLines: 0 });
    expect(candidates.map((item) => `${item.operator}:${item.replacement}`)).toEqual(['BlockStatement:{}', 'ConditionalExpression:true', 'ConditionalExpression:false']);
    expect(candidates[2]!.caughtBy).toEqual([{ id: '1', name: 'shipping fee ships for free above the threshold', file: TESTS, line: 9, failure: 'expected 500 to be +0' }]);
    expect(candidateRanges(candidates)).toEqual([`${SOURCE}:2-4`, `${SOURCE}:3-3`]);
    expect(protectionCandidates(base, new Set(['other.test.ts']), identity).guarded).toBe(0);
  });
  it('leaves mutants on lines the MR changed to the changed-line review', () => {
    const { candidates, onChangedLines } = protectionCandidates(base, changed, { [SOURCE]: lineMap('@@ -3 +3 @@\n-old\n+new') });
    expect(candidates).toEqual([]);
    expect(onChangedLines).toBe(3);
  });
  it('names the test that used to catch the change and shows how it was weakened', () => {
    const { candidates } = protectionCandidates(base, changed, identity);
    const result = compareProtection(candidates.slice(1), base, head('Survived'));
    expect(result.held).toBe(1);
    expect(result.unknown).toBe(0);
    expect(result.lost).toHaveLength(1);
    const lost = result.lost[0]!;
    expect(lost).toMatchObject({ path: SOURCE, line: 3, operator: 'ConditionalExpression', original: 'subtotalCents >= 10_000', replacement: 'false', status: 'Survived' });
    expect(lost.caughtBy[0]!.fate).toBe('weakened');
    expect(lost.why).toContain('`shipping fee ships for free above the threshold` failed when `subtotalCents >= 10_000` became `false`');
    expect(lost.testDiff!.lines.filter((line) => line.kind !== ' ')).toEqual([
      { kind: '-', text: '    expect(shippingFee(10_001)).toBe(0);' },
      { kind: '+', text: '    expect(shippingFee(10_001)).toBeLessThanOrEqual(500);' },
    ]);
  });
  it('reports a deleted test as removed', () => {
    const { candidates } = protectionCandidates(base, changed, identity);
    const gone = { ...head('Survived'), testFiles: { [TESTS]: { source: baseTests.split('\n').slice(0, 8).join('\n'), tests: [{ id: '0', name: 'shipping fee charges $5 below the free-shipping threshold', location: { start: { line: 5 } } }] } } };
    const lost = compareProtection(candidates.slice(2), base, gone).lost[0]!;
    expect(lost.caughtBy[0]!.fate).toBe('removed');
    expect(lost.why).toContain('removed, renamed or skipped');
    expect(lost.testDiff!.lines.every((line) => line.kind === '-')).toBe(true);
  });
  it('fails closed when a mutant cannot be re-checked', () => {
    const { candidates } = protectionCandidates(base, changed, identity);
    const result = compareProtection(candidates, base, head('RuntimeError'));
    expect(result.unknown).toBe(2);
    expect(protectionVerdict({ changedTests: [], testsInRun: [TESTS], subjects: [SOURCE], baseMutants: 4, guarded: 3, onChangedLines: 0, rechecked: 3, ...result }).status).toBe('inconclusive');
  });
  it('turns the comparison into one verdict', () => {
    const rest = { changedTests: [], testsInRun: [TESTS], subjects: [SOURCE], baseMutants: 4, guarded: 3, onChangedLines: 0, rechecked: 3, unknown: 0 };
    const { candidates } = protectionCandidates(base, changed, identity);
    const { lost } = compareProtection(candidates, base, head('Survived'));
    expect(protectionVerdict({ ...rest, held: 2, lost }).status).toBe('lost');
    expect(protectionVerdict({ ...rest, held: 3, lost: [] })).toMatchObject({ status: 'held', reason: expect.stringContaining('all 3 re-checked') });
    expect(protectionVerdict({ ...rest, guarded: 0, rechecked: 0, held: 0, lost: [] }).reason).toContain('no protection could be lost');
  });
});

describe('lost protection in the review', () => {
  const { candidates } = protectionCandidates(base, new Set([TESTS]), { [SOURCE]: lineMap('') });
  const { lost } = compareProtection(candidates, base, head('Survived'));
  const triage: MutantTriage = { policy: 'arid-v1', considered: 1, arid: [], overflow: 0, ranked: [
    { rank: 1, fingerprint: 'a'.repeat(64), path: 'src/other.ts', line: 8, operator: 'EqualityOperator', original: 'a >= b', replacement: 'a > b', status: 'Survived', priority: 'high', why: 'gap' },
    { rank: 2, fingerprint: 'b'.repeat(64), path: 'src/other.ts', line: 9, operator: 'ArithmeticOperator', original: 'a + b', replacement: 'a - b', status: 'Survived', priority: 'medium', why: 'gap' },
    { rank: 3, fingerprint: 'c'.repeat(64), path: 'src/other.ts', line: 10, operator: 'StringLiteral', original: '"x"', replacement: '""', status: 'Survived', priority: 'low', why: 'gap' },
  ] };
  it('ranks lost protection first within the same three comments', () => {
    const merged = withLostProtection(triage, lost);
    expect(merged.ranked.map((item) => `${item.rank}:${item.origin ?? 'changed-line'}:${item.line}`)).toEqual(['1:lost-protection:3', '2:changed-line:8', '3:changed-line:9']);
    expect(merged.overflow).toBe(1);
    expect(withLostProtection(triage, [])).toBe(triage);
  });
  it('blocks a test-only MR that loses protection and passes one that keeps it', () => {
    const gate = { baselinePassed: true, complete: true, expectedHeadSha: 'a', evidenceHeadSha: 'a', metrics: mutationMetrics([]), threshold: 90 };
    expect(evaluateGate(gate).status).toBe('no-applicable-scope');
    expect(evaluateGate({ ...gate, lostProtection: 1, protectionRechecked: 3 })).toEqual({ status: 'failed', reasons: [expect.stringContaining('lost protection')] });
    expect(evaluateGate({ ...gate, protectionRechecked: 3 }).status).toBe('passed');
    expect(evaluateGate({ ...gate, protectionInconclusive: 'Stryker failed on the target branch.' }).status).toBe('inconclusive');
  });
  it('adds lost protection to a failing changed-line verdict rather than replacing it', () => {
    const survivor = { id: '1', fingerprint: 'f'.repeat(64), path: 'a.ts', location: at(1, 1, 2), original: 'a', replacement: 'b', operator: 'X', status: 'Survived' as const, coveredBy: [], killedBy: [] };
    const gate = { baselinePassed: true, complete: true, expectedHeadSha: 'a', evidenceHeadSha: 'a', metrics: mutationMetrics([survivor]), threshold: 90, actionableSurvivors: 1, lostProtection: 2 };
    expect(evaluateGate(gate).reasons).toHaveLength(3);
  });
  it('shows up as a critical Code Quality finding and a metric', () => {
    const issues = codeQualityReport([], null, lost);
    expect(issues).toEqual([expect.objectContaining({ check_name: 'mutant-review/lost-protection', severity: 'critical', location: { path: SOURCE, lines: { begin: 3 } } })]);
    expect(issues[0]!.description).toContain('"shipping fee ships for free above the threshold" on the target branch');
    expect(metricsReport({ score: null, survived: 0, noCoverage: 0, mutantsRun: 0, mutantsAvoided: null, aiCallsAvoided: 0, lostProtection: 1 })).toMatch(/^mutant_review_lost_protection 1$/m);
    expect(metricsReport({ score: null, survived: 0, noCoverage: 0, mutantsRun: 0, mutantsAvoided: null, aiCallsAvoided: 0 })).not.toContain('lost_protection');
  });
});

describe('test blocks for the reviewer', () => {
  it('cuts one it(...) block by bracket depth, ignoring brackets in strings', () => {
    const text = "it('handles ) and { in names', () => {\n  expect(f('}')).toBe(1);\n});\nit('next', () => {});";
    expect(testBlock(text, 1)).toEqual(["it('handles ) and { in names', () => {", "  expect(f('}')).toBe(1);", '});']);
  });
  it('diffs two blocks line by line', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([{ kind: ' ', text: 'a' }, { kind: '-', text: 'b' }, { kind: '+', text: 'x' }, { kind: ' ', text: 'c' }]);
  });
});
