import { describe, expect, it } from 'vitest';
import {
  evaluateGate, filterMutantsToScope, mutationMetrics, normalizePath, normalizeStrykerReport, parseDiff, preflight, strykerRanges,
} from '../src/index.js';
import type { NormalizedMutant } from '../src/index.js';

const sha = 'a'.repeat(40), hash = 'b'.repeat(64);
const location = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 1 } });
const mutant = (status: NormalizedMutant['status'], line = 3): NormalizedMutant => ({ id: '1', fingerprint: hash, path: 'src/shipping.ts', location: location(line), original: '>=', replacement: '>', operator: 'EqualityOperator', status, coveredBy: [], killedBy: [] });

describe('changed-source scope', () => {
  it('keeps the added side across multiple hunks and excludes tests/deletions', () => {
    const diff = [
      'diff --git a/src/shipping.ts b/src/shipping.ts', '--- a/src/shipping.ts', '+++ b/src/shipping.ts',
      '@@ -3 +3 @@', '-return value > 100;', '+return value >= 100;',
      '@@ -8,0 +9,2 @@', '+const discount = 10;', '+return discount;',
      'diff --git a/src/shipping.test.ts b/src/shipping.test.ts', '--- a/src/shipping.test.ts', '+++ b/src/shipping.test.ts', '@@ -1 +1 @@', '-old()', '+new()',
      'diff --git a/src/deleted.ts b/src/deleted.ts', '--- a/src/deleted.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-const gone = 1;',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([{ path: 'src/shipping.ts', change: 'modified', lines: [{ start: 3, end: 3 }, { start: 9, end: 10 }] }]);
    expect(strykerRanges(parseDiff(diff))).toEqual(['src/shipping.ts:3-3', 'src/shipping.ts:9-10']);
  });
  it('handles added and renamed files while excluding comments and generated output', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts', 'similarity index 80%', 'rename from src/old.ts', 'rename to src/new.ts', '--- a/src/old.ts', '+++ b/src/new.ts', '@@ -1 +1 @@', '-old()', '+new()',
      'diff --git a/src/added.ts b/src/added.ts', 'new file mode 100644', '--- /dev/null', '+++ b/src/added.ts', '@@ -0,0 +1,3 @@', '+// comment', '+import { x } from "x";', '+export const answer = 42;',
      'diff --git a/dist/build.ts b/dist/build.ts', '--- /dev/null', '+++ b/dist/build.ts', '@@ -0,0 +1 @@', '+evil()',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([
      { path: 'src/new.ts', change: 'renamed', lines: [{ start: 1, end: 1 }] },
      { path: 'src/added.ts', change: 'added', lines: [{ start: 3, end: 3 }] },
    ]);
  });
  it('does not manufacture source scope for test-only or deletion-only changes', () => {
    expect(parseDiff('diff --git a/a.test.ts b/a.test.ts\n--- a/a.test.ts\n+++ b/a.test.ts\n@@ -1 +1 @@\n-a\n+b')).toEqual([]);
    expect(parseDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +0,0 @@\n-a')).toEqual([]);
  });
  it.each(['../x.ts', '/absolute.ts', 'a/../../x.ts', 'C:\\x.ts', 'src/*.ts', 'src/[x].ts', 'a\n.ts'])('rejects unsafe or range-expanding path %s', path => expect(() => normalizePath(path)).toThrow());
  it('filters cached mutants outside the current MR before scoring', () => {
    const filtered = filterMutantsToScope([mutant('Survived', 3), mutant('Killed', 30)], [{ path: 'src/shipping.ts', change: 'modified', lines: [{ start: 3, end: 3 }] }]);
    expect(mutationMetrics(filtered).score).toBe(0);
    expect(filtered).toHaveLength(1);
  });
});

describe('normalization and policy', () => {
  it('uses context/operator/replacement fingerprints independent of engine ID', () => {
    const raw = { files: { 'src/shipping.ts': { source: 'a\nb\nx >= 100\nd', mutants: [{ id: '1', mutatorName: 'EqualityOperator', replacement: '>', status: 'Survived', location: { start: { line: 3, column: 3 }, end: { line: 3, column: 5 } } }] } } };
    const scope = [{ path: 'src/shipping.ts', change: 'modified' as const, lines: [{ start: 3, end: 3 }] }];
    const before = normalizeStrykerReport(raw, scope);
    raw.files['src/shipping.ts'].mutants[0]!.id = 'new-id';
    const after = normalizeStrykerReport(raw, scope);
    expect(before[0]!.original).toBe('>=');
    expect(before[0]!.fingerprint).toBe(after[0]!.fingerprint);
  });
  it('includes timeouts in the score while preserving separate raw counts', () => {
    expect(mutationMetrics(['Killed', 'Timeout', 'Survived', 'NoCoverage', 'CompileError', 'Ignored', 'Pending'].map(status => mutant(status as NormalizedMutant['status'])))).toEqual({ score: 50, killed: 1, assertionKills: null, survived: 1, noCoverage: 1, timedOut: 1, invalid: 1, ignored: 1, pending: 1, total: 7 });
    expect(mutationMetrics([{ ...mutant('Killed'), assertionKilled: true }]).assertionKills).toBe(1);
    expect(mutationMetrics([]).score).toBeNull();
  });
  const gate = { baselinePassed: true, complete: true, expectedHeadSha: sha, evidenceHeadSha: sha, metrics: mutationMetrics([mutant('Killed')]), threshold: 90 };
  it('cannot pass broken baseline, incomplete, stale, or error evidence', () => {
    expect(evaluateGate({ ...gate, baselinePassed: false }).status).toBe('inconclusive');
    expect(evaluateGate({ ...gate, complete: false }).status).toBe('inconclusive');
    expect(evaluateGate({ ...gate, evidenceHeadSha: 'old' }).status).toBe('inconclusive');
    expect(evaluateGate({ ...gate, metrics: mutationMetrics([mutant('RuntimeError')]) }).status).toBe('inconclusive');
    expect(evaluateGate({ ...gate, metrics: mutationMetrics([]) }).status).toBe('no-applicable-scope');
  });
  it('does not silently waive survivors or trust an edited evaluator', () => {
    expect(evaluateGate({ ...gate, actionableSurvivors: 1 }).status).toBe('failed');
    expect(evaluateGate({ ...gate, protectedFilesChanged: true }).status).toBe('inconclusive');
    expect(evaluateGate({ ...gate, protectedFilesChanged: true, maintainerApprovedPolicy: true }).status).toBe('passed');
  });
});

describe('advisory preflight', () => {
  it('flags advisory weaknesses with code and leaves valid smoke-test interpretation to humans', () => {
    const findings = preflight('it("x", () => {\n expect(value).toBe(value);\n expect(result).toBeDefined();\n});');
    expect(findings.map(item => item.classification)).toEqual(['definite-structural-issue', 'needs-human-context']);
    expect(findings[0]!.line).toBe(2);
    expect(preflight('it("integration", () => helper());')[0]!.classification).toBe('possible-behavioral-weakness');
  });
});
