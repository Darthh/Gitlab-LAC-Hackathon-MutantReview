export type ReviewCommand =
  | { action: 'review' }
  | { action: 'apply'; findings: number[] }
  | { action: 'override'; reason: string };

/**
 * Conversational MR commands: `@handle apply 1 and 3`, `@handle apply all`,
 * `@handle override <reason>`, or a bare mention / `@handle review`.
 * Finding numbers refer to the latest verified proposals the agent posted at the current head.
 */
export function parseReviewCommand(text: string, handle: string, available = 3): ReviewCommand {
  if (!/^@[a-zA-Z0-9_.-]+$/.test(handle)) throw new Error('Configure the actual flow service-account mention');
  const body = text.trim();
  if (!body.toLowerCase().startsWith(handle.toLowerCase()) || /^[a-zA-Z0-9_.-]/.test(body.slice(handle.length))) throw new Error(`Start the comment with ${handle}`);
  const rest = body.slice(handle.length).trim();
  const [verb = 'review', ...words] = rest.split(/\s+/).filter(Boolean);
  const action = verb.toLowerCase();
  if (action === 'review' && !words.length) return { action: 'review' };
  if (action === 'override') {
    const reason = rest.slice(verb.length).trim();
    if (reason.length < 10) throw new Error('An override needs a written reason of at least 10 characters');
    return { action: 'override', reason };
  }
  if (action !== 'apply' || /[\r\n]/.test(rest)) throw new Error(`Use: ${handle} apply 1 and 3 | ${handle} apply all | ${handle} override <reason>`);
  const tokens = rest.slice(verb.length).toLowerCase().split(/[\s,]+|\band\b|&/).filter(Boolean);
  if (tokens.length === 1 && tokens[0] === 'all') return { action: 'apply', findings: Array.from({ length: available }, (_, index) => index + 1) };
  const findings = tokens.map(Number);
  if (!findings.length || findings.some((n) => !Number.isInteger(n) || n < 1 || n > available) || new Set(findings).size !== findings.length) {
    throw new Error(`Choose distinct finding numbers between 1 and ${available}, for example: ${handle} apply 1 and 3`);
  }
  return { action: 'apply', findings: findings.sort((a, b) => a - b) };
}
