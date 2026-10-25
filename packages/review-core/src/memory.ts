import type { RankedFinding } from './triage.js';

export interface MemoryLesson {
  id: string;
  repository: string;
  module: string;
  tags: string[];
  pattern: string;
  recommendation: string;
  status: 'approved';
  verified: true;
  approvedBy: string;
  approvedAt: string;
  receiptId: string;
  examples: string[];
}

const START = '<!-- mutant-review:lessons:start -->';
const END = '<!-- mutant-review:lessons:end -->';

const CATEGORIES: Record<string, { tag: string; pattern: string; recommendation: string }> = {
  EqualityOperator: { tag: 'boundary', pattern: 'Untested boundary value', recommendation: 'When code compares with <, <=, > or >=, test the exact boundary value and one step on each side. Derive each expected value from the written requirement, never from the implementation.' },
  ConditionalExpression: { tag: 'branch', pattern: 'One side of a condition is never asserted', recommendation: 'For every condition, write one test where it is true and one where it is false, and assert the observable result of each.' },
  LogicalOperator: { tag: 'compound-condition', pattern: 'Compound condition only tested as a whole', recommendation: 'Test each operand of && and || on its own: one case where only the left side holds and one where only the right side holds.' },
  BooleanLiteral: { tag: 'return-value', pattern: 'Returned flag never asserted', recommendation: 'Assert the exact boolean with toBe(true) or toBe(false). toBeTruthy and toBeDefined cannot tell a wrong value from a right one.' },
  ArithmeticOperator: { tag: 'computed-value', pattern: 'Computed value never asserted exactly', recommendation: 'Assert computed numbers against exact values taken from the spec, not against a recomputation using the same formula.' },
  StringLiteral: { tag: 'output-text', pattern: 'Output text never asserted', recommendation: 'When text is part of the contract (labels, keys, messages users see), assert the exact string.' },
  BlockStatement: { tag: 'side-effect', pattern: 'Effect of a block never observed', recommendation: 'Assert the state change, call or return value each block produces. "Does not throw" is not an assertion about behaviour.' },
  NoCoverage: { tag: 'untested-line', pattern: 'Changed line executed by no test', recommendation: 'Every changed line needs at least one test that executes it and asserts its result.' },
  LostProtection: { tag: 'weakened-test', pattern: 'A test edit removed protection the target branch had', recommendation: 'Never loosen an existing assertion (toBe to toBeLessThanOrEqual, toEqual to toBeDefined) or delete or skip a failing test to make a build green. If the requirement changed, take the new expected value from the new requirement; otherwise fix the code.' },
};
const FALLBACK = { tag: 'undetected-change', pattern: 'Behaviour change not detected by tests', recommendation: 'Write a test that would fail if this line behaved differently, with the expected value taken from the requirement.' };

export function lessonCategory(finding: Pick<RankedFinding, 'operator' | 'status' | 'origin'>) {
  if (finding.origin === 'lost-protection') return CATEGORIES.LostProtection!;
  return finding.status === 'NoCoverage' ? CATEGORIES.NoCoverage! : CATEGORIES[finding.operator] ?? FALLBACK;
}

/** One lesson per category; a repeated category records another example instead of another rule. */
export function learnFromRepair(existing: MemoryLesson | null, finding: RankedFinding, context: { repository: string; module: string; approvedBy: string; approvedAt: string; receiptId: string; mergeRequestIid: number | null }): MemoryLesson {
  const category = lessonCategory(finding);
  const example = `${finding.path}:${finding.line} \`${finding.original.replace(/\s+/g, ' ')}\` -> \`${finding.replacement.replace(/\s+/g, ' ')}\`${context.mergeRequestIid ? ` (!${context.mergeRequestIid})` : ''}`;
  return {
    id: `lesson-${category.tag}`,
    repository: context.repository,
    module: existing?.module ?? context.module,
    tags: [...new Set([...(existing?.tags ?? []), category.tag, finding.operator])],
    pattern: category.pattern,
    recommendation: category.recommendation,
    status: 'approved',
    verified: true,
    approvedBy: context.approvedBy,
    approvedAt: context.approvedAt,
    receiptId: context.receiptId,
    examples: [example, ...(existing?.examples ?? []).filter((item) => item !== example)].slice(0, 5),
  };
}

export function renderLessons(lessons: MemoryLesson[]): string {
  const learned = [...lessons].sort((a, b) => a.id.localeCompare(b.id)).map((lesson) =>
    `- **${lesson.pattern}.** ${lesson.recommendation} _Learned from ${lesson.examples.length} approved repair(s), latest by @${lesson.approvedBy}: ${lesson.examples[0] ?? 'n/a'}._`);
  return [
    START,
    '## Testing rules learned by Mutant Review',
    '',
    'Mutant Review mutation-tests every changed line in a merge request. These rules come from tests a human approved after a surviving mutant proved the old tests could not notice a change. Follow them when you write or change tests in this repository.',
    '',
    '- Derive expected values from the written requirement (README, `CONTRACTS.md`, doc comments), never by calling the code under test.',
    '- Do not mock the unit under test. Assert on its real outputs, not on calls to a mock.',
    '- Never let `toBeDefined`, `toBeTruthy` or `not.toThrow` be the only assertion in a test.',
    '- Before you finish, a test you add must fail if the line it covers changes behaviour.',
    '- Never make a failing test pass by loosening its assertion, deleting it or skipping it. Mutant Review re-runs the target branch\'s tests against your test changes and blocks the merge when protection is lost.',
    '',
    ...(learned.length ? ['### Learned from approved repairs', '', ...learned] : ['_No repairs approved yet._']),
    END,
  ].join('\n');
}

/** Replaces only the managed section, so human-written AGENTS.md content is preserved. */
export function updateAgentsMd(existing: string, lessons: MemoryLesson[]): string {
  const section = renderLessons(lessons);
  const start = existing.indexOf(START), end = existing.indexOf(END);
  if (start !== -1 && end > start) return existing.slice(0, start) + section + existing.slice(end + END.length);
  return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${section}\n`;
}
