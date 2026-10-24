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
