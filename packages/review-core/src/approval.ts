import { createHash } from 'node:crypto';
import { normalizePath } from './scope.js';

export type ApprovalAction = 'review' | 'apply' | 'verify' | 'learn' | 'override';
export interface Approval {
  eventId: string;
  actorId: string;
  projectId: string;
  mrIid: number;
  headSha: string;
  runId: string;
  proposalId: string;
  findings: string[];
  patchHash: string;
  action: ApprovalAction;
  approvedAt: string;
  expiresAt: string;
  consumedAt?: string;
  reason?: string;
}
export interface ApprovalContext {
  projectId: string;
  mrIid: number;
  currentHeadSha: string;
  runId: string;
  proposalId: string;
  findings: string[];
  patchHash: string;
  action: ApprovalAction;
  currentActorId: string;
  currentAccessLevel: number;
  now: Date;
  consumedEventIds: ReadonlySet<string>;
}

export function patchHash(patch: string): string { return createHash('sha256').update(patch).digest('hex'); }

/** A mention is transport only; this validator consumes no state and never infers consent. */
export function validateApproval(approval: Approval, context: ApprovalContext): void {
  const fail = (reason: string): never => { throw new Error(`Approval rejected: ${reason}`); };
  if (!approval.eventId || approval.consumedAt || context.consumedEventIds.has(approval.eventId)) fail('already consumed or replayed event');
  const minimum = approval.action === 'override' || approval.action === 'learn' ? 40 : 30;
  if (approval.actorId !== context.currentActorId || !Number.isFinite(context.currentAccessLevel) || context.currentAccessLevel < minimum) fail('actor is not currently authorized');
  if (approval.projectId !== context.projectId || approval.mrIid !== context.mrIid) fail('project or merge request mismatch');
  if (!/^[a-f0-9]{40,64}$/i.test(approval.headSha) || approval.headSha !== context.currentHeadSha) fail('stale or invalid source revision');
  if (approval.runId !== context.runId || approval.proposalId !== context.proposalId || !approval.proposalId) fail('unknown run or proposal');
  if (approval.patchHash !== context.patchHash || !/^[a-f0-9]{64}$/i.test(approval.patchHash)) fail('the exact patch has changed');
  if (approval.action !== context.action) fail('approval authorizes a different action');
  const canonical = (values: string[]) => JSON.stringify([...new Set(values)].sort());
  if (new Set(approval.findings).size !== approval.findings.length || canonical(approval.findings) !== canonical(context.findings)) fail('selected findings changed');
  const approvedAt = Date.parse(approval.approvedAt), expiresAt = Date.parse(approval.expiresAt), now = context.now.getTime();
  if (![approvedAt, expiresAt, now].every(Number.isFinite) || approvedAt > now || expiresAt <= now || expiresAt <= approvedAt) fail('expired or invalid approval time');
  if (expiresAt - approvedAt > 24 * 60 * 60 * 1000) fail('approval duration exceeds 24 hours');
  if (approval.action === 'override' && (!approval.reason || approval.reason.trim().length < 10)) fail('a specific written override reason is required');
}

export interface ParsedCommand { action: ApprovalAction; proposalId: string; patchHash: string; reason?: string }

/** Application commands, never built-in GitLab commands. Reject prose, extra mentions and ambiguous tokens. */
export function parseCommand(text: string, configuredHandle: string): ParsedCommand {
  if (!/^@[a-zA-Z0-9_.-]+$/.test(configuredHandle)) throw new Error('Configure the actual flow service-account handle');
  const prefix = `${configuredHandle} `;
  if (!text.startsWith(prefix) || /[\r\n]/.test(text)) throw new Error('Ambiguous command');
  const parts = text.slice(prefix.length).split(' ');
  const [action, proposalId, hash, ...rest] = parts;
  if (!['review', 'apply', 'verify', 'learn', 'override'].includes(action ?? '') || !/^[a-zA-Z0-9_-]{1,100}$/.test(proposalId ?? '') || !/^[a-f0-9]{64}$/i.test(hash ?? '')) throw new Error('Use: @configured-handle <action> <proposal-id> <exact-patch-sha256>');
  if (action !== 'override' && rest.length) throw new Error('Unexpected command text');
  const reason = rest.join(' ').trim();
  if (action === 'override' && reason.length < 10) throw new Error('Override requires a written reason');
  return { action: action as ApprovalAction, proposalId: proposalId!, patchHash: hash!, ...(reason ? { reason } : {}) };
}

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

/** Default repair policy is additive test-only patches. Strict by design for the single-project MVP. */
export function assertTestOnlyPatch(patch: string, allowedPaths: string[]): void {
  const allowed = new Set(allowedPaths.map(normalizePath));
  let current: string | undefined;
  let addedAssertion = false;
  let hunk = false;
  let files = 0;
  if (/^(GIT binary patch|Binary files|rename from|rename to|old mode|new mode|deleted file mode)/m.test(patch)) throw new Error('Repair may not delete, rename, change mode, or contain binary files');
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) { current = undefined; hunk = false; }
    if (!hunk && line.startsWith('+++ ')) {
      const raw = line.slice(4);
      if (raw === '/dev/null' || raw.startsWith('"')) throw new Error('Unsupported repair path');
      current = normalizePath(raw.replace(/^b\//, ''));
      if (!allowed.has(current) || !/\.(test|spec)\.tsx?$/.test(current)) throw new Error('Repair may modify only explicitly approved test files');
      files++;
      continue;
    }
    if (line.startsWith('@@ ')) { if (!current) throw new Error('Patch hunk has no approved path'); hunk = true; continue; }
    if (!hunk) continue;
    if (line.startsWith('-') && line.slice(1).trim()) throw new Error('Default repair policy does not remove or weaken existing test lines');
    if (line.startsWith('+')) {
      const code = line.slice(1);
      if (/\b(?:it|test|describe)\s*\.\s*(?:skip|todo|fails)\b|\b(?:xit|xtest|xdescribe)\b|\.\s*only\b|\bcatch\s*(?:\(|\{)|@ts-(?:ignore|nocheck)|istanbul ignore|v8 ignore|Stryker disable|\.not\s*\./i.test(code)) throw new Error('Repair contains disabled, narrowed, swallowed, or weakened checks');
      if (/\bexpect\s*\(.+\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(/.test(code)) addedAssertion = true;
    }
  }
  if (!files || !addedAssertion) throw new Error('Repair must add an explicit behavioral assertion to an approved test');
}
