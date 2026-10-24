export interface PreflightFinding {
  classification: 'definite-structural-issue' | 'possible-behavioral-weakness' | 'needs-human-context';
  line: number;
  code: string;
  concern: string;
}

/** Advisory heuristics; clean results never establish behavioral adequacy. No tests are deleted. */
export function preflight(source: string): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const lines = source.split(/\r?\n/);
  const add = (index: number, classification: PreflightFinding['classification'], concern: string) => findings.push({ line: index + 1, code: lines[index]!, classification, concern });
  if (/\b(?:it|test)\s*\(/.test(source) && !/\b(?:expect|assert)\s*[.(]/.test(source)) {
    add(lines.findIndex(line => /\b(?:it|test)\s*\(/.test(line)), 'possible-behavioral-weakness', 'No recognizable assertions in this test file. Custom assertion helpers may require human context.');
  }
  lines.forEach((line, index) => {
    const self = /expect\(\s*([\w.$]+)\s*\)\s*\.to(?:Be|Equal|StrictEqual)\(\s*\1\s*\)/.test(line);
    if (self) add(index, 'definite-structural-issue', 'This assertion compares a value to itself and cannot detect a wrong value.');
    if (/\.toBe(?:Defined|Truthy)\s*\(/.test(line)) add(index, 'needs-human-context', 'An existence-only assertion may be valid for a smoke contract; check whether a concrete value is required.');
    if (/\b(?:vi|jest)\s*\.\s*mock\s*\(/.test(line)) add(index, 'needs-human-context', 'Check that this mock does not replace the behavior the test claims to verify.');
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) add(index, 'possible-behavioral-weakness', 'An empty catch can swallow the failure the test should observe.');
    const sameCall = /expect\(\s*([\w.$]+\([^)]*\))\s*\)\.to(?:Be|Equal)\(\s*\1\s*\)/.test(line);
    if (sameCall) add(index, 'possible-behavioral-weakness', 'The expected answer is recomputed using the subject itself; derive it from the written contract.');
  });
  return findings;
}

export interface ApprovedLesson {
  id: string;
  repository: string;
  module: string;
  symbols?: string[];
  tags: string[];
  pattern: string;
  recommendation: string;
  status: 'approved' | 'superseded' | 'dismissed';
  verified: boolean;
  approvedBy: string;
  approvedAt: string;
  receiptId: string;
}
export interface LessonQuery { repository: string; module: string; symbol?: string; tags?: string[]; source?: string }

export function retrieveLessons(lessons: ApprovedLesson[], query: LessonQuery, limit = 3): ApprovedLesson[] {
  return lessons.filter(lesson => lesson.status === 'approved' && lesson.verified && lesson.approvedBy && lesson.receiptId && Number.isFinite(Date.parse(lesson.approvedAt)) && lesson.repository === query.repository)
    .map(lesson => ({ lesson, score: (lesson.module === query.module ? 4 : 0)
      + (query.symbol && lesson.symbols?.includes(query.symbol) ? 3 : 0)
      + (query.tags ?? []).filter(tag => lesson.tags.includes(tag)).length * 2
      + (query.source && lesson.tags.includes('inclusive-threshold') && />=|<=/.test(query.source) ? 2 : 0) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id))
    .slice(0, Math.max(0, Math.min(limit, 5))).map(item => item.lesson);
}
