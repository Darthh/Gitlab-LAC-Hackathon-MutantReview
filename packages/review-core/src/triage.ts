import type { NormalizedMutant } from './types.js';

export interface RankedFinding {
  rank: number;
  fingerprint: string;
  path: string;
  line: number;
  operator: string;
  original: string;
  replacement: string;
  status: 'Survived' | 'NoCoverage';
  priority: 'high' | 'medium' | 'low';
  why: string;
}
export interface MutantTriage {
  policy: 'arid-v1';
  considered: number;
  arid: { fingerprint: string; path: string; line: number; reason: string }[];
  ranked: RankedFinding[];
  overflow: number;
}

const LOGGING = /\b(?:console\s*\.\s*(?:log|debug|info|warn|error|trace)|(?:logger|log)\s*\.\s*(?:debug|info|warn|error|trace|fatal)|debug)\s*\(/;
const MESSAGE = /\bthrow\b|\bnew\s+\w*Error\s*\(/;
const PRIORITY: Record<string, RankedFinding['priority']> = {
  EqualityOperator: 'high', ConditionalExpression: 'high', LogicalOperator: 'high', BooleanLiteral: 'high', MethodExpression: 'high',
  ArithmeticOperator: 'medium', UnaryOperator: 'medium', UpdateOperator: 'medium', OptionalChaining: 'medium', StringLiteral: 'medium',
  ArrayDeclaration: 'medium', ObjectLiteral: 'medium', Regex: 'medium', AssignmentOperator: 'medium',
};
const ORDER = { high: 0, medium: 1, low: 2 } as const;
const short = (code: string) => { const flat = code.replace(/\s+/g, ' ').trim(); return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat; };

/** Google calls these "arid": mutants whose behaviour no reasonable test asserts. */
export function aridReason(mutant: Pick<NormalizedMutant, 'operator' | 'original'>, lineText: string): string | null {
  if (LOGGING.test(lineText)) return 'logging statement';
  if (mutant.operator === 'StringLiteral' && MESSAGE.test(lineText)) return 'error message text';
  if (mutant.operator === 'BlockStatement') {
    const statements = mutant.original.replace(/^\{|\}$/g, '').split(/[;\n]/).map((statement) => statement.trim()).filter(Boolean);
    if (statements.length && statements.every((statement) => LOGGING.test(statement))) return 'block only logs';
  }
  return null;
}

function why(mutant: NormalizedMutant, line: number): string {
  const from = short(mutant.original), to = short(mutant.replacement);
  if (mutant.status === 'NoCoverage') return `No test executes line ${line}, so changing \`${from}\` to \`${to}\` cannot fail anything.`;
  switch (mutant.operator) {
    case 'EqualityOperator': return `Changing \`${from}\` to \`${to}\` on line ${line} fails no test. The boundary value itself is untested.`;
    case 'ConditionalExpression': return `Forcing \`${from}\` to \`${to}\` on line ${line} fails no test. One side of this condition is never asserted.`;
    case 'LogicalOperator': return `Swapping \`${from}\` for \`${to}\` on line ${line} fails no test. The combined condition is never checked case by case.`;
    case 'BlockStatement': return `Emptying the block on line ${line} fails no test. Its effect is never observed.`;
    case 'ArithmeticOperator': return `Changing \`${from}\` to \`${to}\` on line ${line} fails no test. The computed value is never asserted exactly.`;
    default: return `Changing \`${from}\` to \`${to}\` on line ${line} fails no test.`;
  }
}

/**
 * Deterministic, model-free triage: drop arid mutants, keep one finding per line,
 * rank by how likely the gap hides a real behavioural bug, and cap comments at `limit`.
 */
export function triageMutants(mutants: NormalizedMutant[], sources: Record<string, string>, limit = 3): MutantTriage {
  const open = mutants.filter((mutant) => mutant.status === 'Survived' || mutant.status === 'NoCoverage');
  const arid: MutantTriage['arid'] = [];
  const byLine = new Map<string, RankedFinding>();
  for (const mutant of open) {
    const line = mutant.location.start.line;
    const reason = aridReason(mutant, sources[mutant.path]?.split('\n')[line - 1] ?? '');
    if (reason) { arid.push({ fingerprint: mutant.fingerprint, path: mutant.path, line, reason }); continue; }
    const finding: RankedFinding = { rank: 0, fingerprint: mutant.fingerprint, path: mutant.path, line, operator: mutant.operator, original: mutant.original, replacement: mutant.replacement,
      status: mutant.status as RankedFinding['status'], priority: mutant.status === 'NoCoverage' ? 'high' : PRIORITY[mutant.operator] ?? 'low', why: why(mutant, line) };
    const key = `${mutant.path}:${line}`, prior = byLine.get(key);
    if (!prior || ORDER[finding.priority] < ORDER[prior.priority]) byLine.set(key, finding);
  }
  const sorted = [...byLine.values()].sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || a.path.localeCompare(b.path) || a.line - b.line);
  return { policy: 'arid-v1', considered: open.length, arid, ranked: sorted.slice(0, limit).map((finding, index) => ({ ...finding, rank: index + 1 })), overflow: Math.max(0, sorted.length - limit) };
}
