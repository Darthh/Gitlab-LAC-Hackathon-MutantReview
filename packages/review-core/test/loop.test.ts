import { describe, expect, it } from 'vitest';
import { applyOverride, learnFromRepair, parseReviewCommand, renderLessons, triageMutants, updateAgentsMd } from '../src/index.js';
import type { GateDecision, NormalizedMutant, RankedFinding } from '../src/index.js';

const handle = '@ai-mutant-review';
let next = 0;
const mutant = (line: number, operator: string, original: string, replacement: string, status: NormalizedMutant['status'] = 'Survived'): NormalizedMutant => ({
  id: String(next), fingerprint: (next++).toString(16).padStart(64, '0'), path: 'src/cart.ts',
  location: { start: { line, column: 3 }, end: { line, column: 3 + original.length } }, original, replacement, operator, status, coveredBy: [], killedBy: [],
});
const source = [
  'export function fee(items: number) {',            // 1
  '  console.log(`items: ${items}`);',                 // 2
  '  if (items < 0) throw new Error("negative cart");', // 3
  '  return items >= 100 ? 0 : 5 + items * 0;',         // 4
  '}',                                                  // 5
  'export const label = (n: number) => n > 1 ? "items" : "item";', // 6
].join('\n');

describe('deterministic triage', () => {
  it('drops arid mutants, keeps one finding per line, ranks boundaries first and caps comments at three', () => {
    const mutants = [
      mutant(2, 'StringLiteral', '`items: ${items}`', '``'),
      mutant(3, 'StringLiteral', '"negative cart"', '""'),
      mutant(4, 'ArithmeticOperator', '5 + items * 0', '5 - items * 0'),
      mutant(4, 'EqualityOperator', 'items >= 100', 'items > 100'),
      mutant(6, 'StringLiteral', '"items"', '""'),
      mutant(6, 'ConditionalExpression', 'n > 1', 'true', 'NoCoverage'),
      mutant(3, 'ConditionalExpression', 'items < 0', 'false'),
      mutant(4, 'BlockStatement', '{}', '{}', 'Killed'),
    ];
    const triage = triageMutants(mutants, { 'src/cart.ts': source });
    expect(triage.considered).toBe(7);
    expect(triage.arid.map((item) => [item.line, item.reason])).toEqual([[2, 'logging statement'], [3, 'error message text']]);
    expect(triage.ranked.map((item) => [item.rank, item.line, item.operator, item.priority])).toEqual([
      [1, 3, 'ConditionalExpression', 'high'], [2, 4, 'EqualityOperator', 'high'], [3, 6, 'ConditionalExpression', 'high'],
    ]);
    expect(triage.ranked[1]!.why).toBe('Changing `items >= 100` to `items > 100` on line 4 fails no test. The boundary value itself is untested.');
    expect(triage.ranked[2]!.why).toMatch(/^No test executes line 6/);
    expect(triage.overflow).toBe(0);
  });
  it('reports findings beyond the comment budget instead of posting them', () => {
    const mutants = [1, 2, 3, 4, 5].map((line) => mutant(line, 'EqualityOperator', 'a >= b', 'a > b'));
    const triage = triageMutants(mutants, { 'src/cart.ts': 'a\nb\nc\nd\ne' });
    expect(triage.ranked).toHaveLength(3);
    expect(triage.overflow).toBe(2);
  });
  it('treats a block that only logs as arid but keeps blocks with behaviour', () => {
    const logsOnly = mutant(1, 'BlockStatement', '{\n  console.debug("x");\n}', '{}');
    const behaves = mutant(1, 'BlockStatement', '{\n  console.debug("x");\n  total += 1;\n}', '{}');
    const triage = triageMutants([logsOnly, behaves], { 'src/cart.ts': 'function f() {' });
    expect(triage.arid).toHaveLength(1);
    expect(triage.ranked.map((item) => item.fingerprint)).toEqual([behaves.fingerprint]);
  });
});

describe('conversational MR commands', () => {
  it.each([
    [`${handle} apply 1 and 3`, [1, 3]],
    [`${handle} apply 3, 1`, [1, 3]],
    [`${handle} APPLY 2`, [2]],
    [`${handle} apply 1&2`, [1, 2]],
    [`  ${handle} apply all`, [1, 2, 3]],
  ])('parses %s', (text, findings) => expect(parseReviewCommand(text, handle)).toEqual({ action: 'apply', findings }));
  it('treats a bare mention as a review request and keeps override reasons verbatim', () => {
    expect(parseReviewCommand(handle, handle)).toEqual({ action: 'review' });
    expect(parseReviewCommand(`${handle} override Boundary is enforced by the payment provider`, handle)).toEqual({ action: 'override', reason: 'Boundary is enforced by the payment provider' });
  });
  it.each([
    `${handle} apply 4`, `${handle} apply 1 and 1`, `${handle} apply one`, `${handle} apply`, `${handle} override too short`,
    `${handle}x apply 1`, `please ${handle} apply 1`, `${handle} apply 1\n${handle} apply 2`, `${handle} delete everything`,
  ])('rejects ambiguous or unsafe command %j', (text) => expect(() => parseReviewCommand(text, handle)).toThrow());
});

describe('audited override', () => {
  const failed: GateDecision = { status: 'failed', reasons: ['Mutation score 75.0% is below the 90% project policy.'] };
  const override = { actor: 'maintainer', accessLevel: 40, reason: 'Boundary is enforced by the payment provider', noteUrl: 'https://gitlab.com/x/-/merge_requests/1#note_1', approvedAt: '2026-10-24T12:00:00Z', headSha: 'a'.repeat(40) };
  it('waives only a measured failure, by a maintainer, with a reason, at the same head', () => {
    expect(applyOverride(failed, override, 'a'.repeat(40))).toMatchObject({ status: 'overridden', override });
    expect(applyOverride(failed, { ...override, accessLevel: 30 }, 'a'.repeat(40)).status).toBe('failed');
    expect(applyOverride(failed, override, 'b'.repeat(40)).status).toBe('failed');
    expect(applyOverride({ status: 'inconclusive', reasons: ['baseline failed'] }, override, 'a'.repeat(40)).status).toBe('inconclusive');
    expect(applyOverride(failed, null, 'a'.repeat(40))).toBe(failed);
  });
});

describe('agent memory', () => {
  const finding: RankedFinding = { rank: 1, fingerprint: 'f'.repeat(64), path: 'src/cart.ts', line: 4, operator: 'EqualityOperator', original: 'items >= 100', replacement: 'items > 100', status: 'Survived', priority: 'high', why: '' };
  const context = { repository: 'group/project', module: 'src', approvedBy: 'reviewer', approvedAt: '2026-10-24T12:00:00Z', receiptId: 'repair-1', mergeRequestIid: 7 };
  it('turns an approved repair into one rule per category and records repeats as examples', () => {
    const first = learnFromRepair(null, finding, context);
    const second = learnFromRepair(first, { ...finding, line: 9 }, { ...context, receiptId: 'repair-2' });
    expect(second.id).toBe('lesson-boundary');
    expect(second.examples).toEqual(['src/cart.ts:9 `items >= 100` -> `items > 100` (!7)', 'src/cart.ts:4 `items >= 100` -> `items > 100` (!7)']);
    expect(renderLessons([second])).toContain('**Untested boundary value.**');
  });
  it('rewrites only its managed AGENTS.md section', () => {
    const lesson = learnFromRepair(null, finding, context);
    const once = updateAgentsMd('# Project rules\n\nUse tabs.\n', [lesson]);
    const twice = updateAgentsMd(once.replace('Use tabs.', 'Use spaces.'), [lesson]);
    expect(once.startsWith('# Project rules\n\nUse tabs.\n\n<!-- mutant-review:lessons:start -->')).toBe(true);
    expect(twice).toContain('Use spaces.');
    expect(twice.match(/mutant-review:lessons:start/g)).toHaveLength(1);
  });
});
