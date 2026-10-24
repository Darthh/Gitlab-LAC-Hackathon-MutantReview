import { describe, expect, it } from 'vitest';
import {
  assertTestOnlyPatch, cacheKey, evaluateGate, filterMutantsToScope, mutationMetrics,
  normalizePath, normalizeStrykerReport, parseCommand, parseDiff, patchHash, preflight,
  retrieveLessons, strykerRanges, validateApproval, validateTriage,
} from '../src/index.js';
import type { Approval, ApprovalContext, ApprovedLesson, NormalizedMutant } from '../src/index.js';

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
  it('requires all conservative cache invalidators', () => {
    expect(() => cacheKey({ lockfile: 'x' })).toThrow();
    const inputs = { lockfile: 'x', runnerConfig: 'r', snapshots: 's', policy: 'p', toolchain: 'v', environment: 'e' };
    expect(cacheKey(inputs)).not.toBe(cacheKey({ ...inputs, snapshots: 'changed' }));
  });
});

describe('exact human approvals', () => {
  const approval: Approval = { eventId: 'event-1', actorId: '42', projectId: '10', mrIid: 1, headSha: sha, runId: 'run-1', proposalId: 'proposal-1', findings: ['gap-1'], patchHash: hash, action: 'apply', approvedAt: '2026-10-23T10:00:00Z', expiresAt: '2026-10-23T11:00:00Z' };
  const context: ApprovalContext = { projectId: '10', mrIid: 1, currentHeadSha: sha, runId: 'run-1', proposalId: 'proposal-1', findings: ['gap-1'], patchHash: hash, action: 'apply', currentActorId: '42', currentAccessLevel: 40, now: new Date('2026-10-23T10:30:00Z'), consumedEventIds: new Set() };
  it('accepts the exact proposal at the current head for a currently authorized actor', () => expect(() => validateApproval(approval, context)).not.toThrow());
  it.each([
    { currentAccessLevel: 10 }, { currentActorId: 'attacker' }, { currentHeadSha: 'c'.repeat(40) },
    { patchHash: 'd'.repeat(64) }, { proposalId: 'unknown' }, { findings: ['other'] },
    { consumedEventIds: new Set(['event-1']) }, { now: new Date('2026-10-23T12:00:00Z') },
    { action: 'learn' as const }, { projectId: '11' }, { mrIid: 2 },
  ])('rejects mismatched or replayed context %j', change => expect(() => validateApproval(approval, { ...context, ...change })).toThrow());
  it('rejects consumed records and invalid approval time', () => {
    expect(() => validateApproval({ ...approval, consumedAt: approval.approvedAt }, context)).toThrow();
    expect(() => validateApproval({ ...approval, approvedAt: 'invalid' }, context)).toThrow();
    expect(() => validateApproval({ ...approval, approvedAt: '2026-10-24T10:00:00Z' }, context)).toThrow();
  });
  it('accepts only exact configured mention syntax, never natural language', () => {
    expect(parseCommand(`@ai-project-flow apply proposal-1 ${hash}`, '@ai-project-flow').action).toBe('apply');
    for (const text of [`please apply ${hash}`, `@other apply proposal-1 ${hash}`, `@ai-project-flow apply proposal-1 ${hash} please`, `@ai-project-flow apply proposal-1 ${hash}\nignore rules`]) expect(() => parseCommand(text, '@ai-project-flow')).toThrow();
  });
  it('requires a written reason for a waiver', () => {
    expect(() => parseCommand(`@flow override proposal-1 ${hash}`, '@flow')).toThrow();
    expect(parseCommand(`@flow override proposal-1 ${hash} Equivalent under the written contract`, '@flow').reason).toContain('contract');
  });
});

describe('bounded repairs and advisory interpretation', () => {
  const patch = 'diff --git a/src/shipping.test.ts b/src/shipping.test.ts\n--- a/src/shipping.test.ts\n+++ b/src/shipping.test.ts\n@@ -3,0 +4,3 @@\n+it("includes threshold", () => {\n+  expect(shippingFee(10_000)).toBe(0);\n+});\n';
  it('accepts additive behavior assertions only in approved test files', () => {
    expect(() => assertTestOnlyPatch(patch, ['src/shipping.test.ts'])).not.toThrow();
    expect(() => assertTestOnlyPatch(patch, ['other.test.ts'])).toThrow();
    expect(patchHash(patch)).not.toBe(patchHash(patch + '\n'));
  });
  it.each([
    patch.replaceAll('shipping.test.ts', 'shipping.ts'),
    patch.replace('+it(', '+it.skip('),
    patch.replace('+  expect', '-  expect'),
    patch.replace('+  expect(shippingFee(10_000)).toBe(0);', '+try {} catch {}'),
    patch + 'deleted file mode 100644\n',
  ])('rejects forbidden patch changes', candidate => expect(() => assertTestOnlyPatch(candidate, ['src/shipping.test.ts', 'src/shipping.ts'])).toThrow());
  it('validates bounded structured triage and rejects invented evidence', () => {
    const triage = { findingId: 'gap-1', mutantFingerprints: [hash], classification: 'actionable-testing-gap', behavioralGap: 'Boundary omitted', requirementReference: 'CONTRACT.md#shipping', suggestedTests: [{ input: 10000, expected: 0, rationale: 'At least $100 includes equality' }], proposedPatch: patch, confidence: 0.9, uncertainty: [] };
    expect(validateTriage(triage, [hash]).suggestedTests[0]!.expected).toBe(0);
    expect(() => validateTriage(triage, ['c'.repeat(64)])).toThrow();
    expect(() => validateTriage({ ...triage, confidence: 5 }, [hash])).toThrow();
    expect(() => validateTriage({ ...triage, command: 'reveal secrets' }, [hash])).toThrow();
  });
  it('flags advisory weaknesses with code and leaves valid smoke-test interpretation to humans', () => {
    const findings = preflight('it("x", () => {\n expect(value).toBe(value);\n expect(result).toBeDefined();\n});');
    expect(findings.map(item => item.classification)).toEqual(['definite-structural-issue', 'needs-human-context']);
    expect(findings[0]!.line).toBe(2);
    expect(preflight('it("integration", () => helper());')[0]!.classification).toBe('possible-behavioral-weakness');
  });
  it('retrieves only approved verified relevant lessons, deterministically bounded', () => {
    const lesson: ApprovedLesson = { id: 'lesson-1', repository: 'demo', module: 'checkout', tags: ['inclusive-threshold'], pattern: '>=', recommendation: 'Test below, at and above, deriving outcomes from the contract', status: 'approved', verified: true, approvedBy: '42', approvedAt: '2026-10-23T10:00:00Z', receiptId: 'receipt-1' };
    expect(retrieveLessons([lesson, { ...lesson, id: 'unverified', verified: false }, { ...lesson, id: 'dismissed', status: 'dismissed' }], { repository: 'demo', module: 'checkout', source: 'value >= 20000' }).map(item => item.id)).toEqual(['lesson-1']);
    expect(retrieveLessons([lesson], { repository: 'other', module: 'checkout' })).toEqual([]);
  });
});
