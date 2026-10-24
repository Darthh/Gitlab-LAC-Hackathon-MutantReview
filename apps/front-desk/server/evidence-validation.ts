import { createHash } from 'node:crypto';
import { z } from 'zod';
import { filterMutantsToScope, normalizePath } from '../../../packages/review-core/src/scope.js';
import { mutationMetrics } from '../../../packages/review-core/src/report.js';

const text = z.string().max(100_000);
const label = z.string().min(1).max(500);
const count = z.number().int().nonnegative();
const duration = z.number().finite().nonnegative();
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const hash = z.string().regex(/^[a-f0-9]{64}$/i);
const path = z.string().max(1000).refine(value => { try { return normalizePath(value) === value; } catch { return false; } }, 'Invalid repository-relative path');
const safeUrl = z.string().max(2000).refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }, 'Invalid HTTPS evidence URL');
const position = z.object({ line: z.number().int().positive(), column: z.number().int().positive() });
const location = z.object({ start: position, end: position }).refine(value => value.start.line < value.end.line || value.start.line === value.end.line && value.start.column <= value.end.column, 'Invalid source range');
const interval = z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).refine(value => value.start <= value.end, 'Invalid changed-line range');
const execution = z.object({ exitCode: z.number().int().nullable(), durationMs: duration, timedOut: z.boolean(), log: path });
const proposal = z.object({ id: label, patch: text, patchHash: hash, testPath: path,
  originalTestHash: hash.optional(), repairedTestHash: hash.optional(), sourceHash: hash.optional(),
  originalTest: text.optional(), repairedTest: text.optional(), approvalStatus: label.optional(), generatedBy: label.optional() });
const rawProvenance = z.object({ headSha: sha, baseSha: sha.optional(), toolchain: z.record(z.string(), z.string().max(100)), fresh: z.boolean().optional(), projectId: z.string().optional(), mergeRequestIid: count.optional(), pipelineId: z.string().optional(), jobId: z.string().optional() });
const mutant = z.object({ id: label, fingerprint: hash, path, line: z.number().int().positive(), location,
  original: text, replacement: text, operator: label,
  status: z.enum(['Killed', 'Survived', 'NoCoverage', 'Timeout', 'CompileError', 'RuntimeError', 'Ignored', 'Pending']),
  coveredBy: z.array(label).max(10000), killedBy: z.array(label).max(10000),
  provenance: rawProvenance.optional(), assertionKilled: z.boolean().optional() });
const approvedLesson = z.object({
  id: label, repository: label, module: label, symbols: z.array(label).optional(), tags: z.array(label).max(30),
  pattern: text, recommendation: text, status: z.literal('approved'), verified: z.literal(true),
  approvedBy: label, approvedAt: z.iso.datetime(), receiptId: label,
});

/** Only the supported artifact shape crosses the server/browser boundary; unknown fields are stripped. */
export const evidenceSchema = z.object({
  schemaVersion: z.literal(1), runId: label, createdAt: z.iso.datetime(), source: z.enum(['local', 'gitlab']),
  provenance: z.object({ projectId: z.string().nullable(), mrIid: z.number().int().positive().nullable(), headSha: sha,
    baseSha: sha.nullable(), pipelineId: z.string().nullable(), jobId: z.string().nullable(),
    pipelineUrl: safeUrl.nullable().optional(), projectUrl: safeUrl.nullable().optional(),
    policyVersion: label, toolchain: z.record(z.string(), z.string().max(100)), scopeKind: label, workingTreeHash: hash.optional() }),
  baseline: z.object({ status: z.enum(['passed', 'failed']), tests: count, branchCoverage: z.number().finite().min(0).max(100).nullable(), durationMs: duration, log: path }),
  scope: z.object({ files: z.array(z.object({ path, startLine: z.number().int().positive(), endLine: z.number().int().positive(), lines: z.array(interval).min(1).max(1000) })).max(1000),
    changedLines: count, complete: z.boolean(), reason: text.nullable(), limits: z.record(z.string(), duration).optional(), protectedFilesChanged: z.boolean().optional() }),
  mutation: z.object({ status: z.enum(['complete', 'inconclusive']), score: z.number().finite().min(0).max(100).nullable(),
    counts: z.object({ killed: count, survived: count, noCoverage: count, timedOut: count, invalid: count, ignored: count, pending: count }),
    mutants: z.array(mutant).max(10000), durationMs: duration.nullable(), reportPath: path.nullable(), incremental: z.boolean().optional(), cacheKey: hash.nullable().optional() }),
  findings: z.array(z.object({ id: label, title: text, consequence: text, requirement: text, requirementReference: label.optional(),
    mutantFingerprint: hash, proposal, interpretationSource: label, confidence: z.number().min(0).max(1).nullable(), approvalStatus: label, uncertainty: text.optional() })).max(100),
  verification: z.object({ status: z.enum(['passed', 'failed', 'not_run']), scope: text, originalPasses: z.boolean(), mutantFails: z.boolean(), cleanRerun: z.boolean(), logs: z.array(path).max(100),
    patchHash: hash.optional(), exactMutation: z.object({ original: text, replacement: text }).optional(),
    runs: z.array(z.object({ attempt: z.number().int().positive(), original: execution, mutant: execution, assertionKilled: z.boolean() })).max(10).optional(),
    approval: z.null().optional(), repairCommit: z.null().optional(), gitlabPipeline: z.null().optional() }),
  metrics: z.record(z.string(), duration.nullable()), lessons: z.array(approvedLesson).max(1000),
  preflight: z.object({ results: z.array(z.object({ path, findings: z.array(z.object({ classification: label, line: z.number().int().positive(), code: text, concern: text })) })),
    retrievedLessons: z.array(approvedLesson).max(5), note: text }).optional(),
  integrations: z.object({ gitlab: label, duo: label }),
  gate: z.object({ status: z.enum(['passed', 'failed', 'inconclusive', 'no-applicable-scope']), reasons: z.array(text).max(100) }),
  evidenceFiles: z.array(path).max(200),
});

export interface EvidenceExpectations {
  source?: 'local' | 'gitlab';
  projectId?: string;
  mergeRequestIid?: number;
  headSha?: string;
  jobId?: string;
}

export function validateEvidence(input: unknown, expected: EvidenceExpectations = {}) {
  const parsed = evidenceSchema.safeParse(input);
  if (!parsed.success) throw new Error('Evidence format is unsupported or malformed. Regenerate the run.');
  const evidence = parsed.data;
  const fail = (reason: string): never => { throw new Error(`Evidence rejected: ${reason}`); };
  if (expected.source && evidence.source !== expected.source) fail('execution source does not match the configured evidence source');
  if (expected.projectId && evidence.provenance.projectId !== expected.projectId) fail('artifact belongs to another project');
  if (expected.mergeRequestIid && evidence.provenance.mrIid !== expected.mergeRequestIid) fail('artifact belongs to another merge request');
  if (expected.headSha && evidence.provenance.headSha !== expected.headSha) fail('artifact is stale for the current merge request head');
  if (expected.jobId && evidence.provenance.jobId !== expected.jobId) fail('artifact belongs to another CI job');
  if (evidence.source === 'gitlab' && (!evidence.provenance.projectId || !evidence.provenance.mrIid || !evidence.provenance.baseSha || !evidence.provenance.pipelineId || !evidence.provenance.jobId)) fail('GitLab execution provenance is incomplete');
  const scopes = evidence.scope.files.map(file => ({ path: file.path, lines: file.lines, change: 'modified' as const }));
  if (filterMutantsToScope(evidence.mutation.mutants, scopes).length !== evidence.mutation.mutants.length) fail('mutation inventory includes results outside the recorded source scope');
  if (evidence.mutation.mutants.some(item => item.provenance && item.provenance.headSha !== evidence.provenance.headSha)) fail('mutant provenance belongs to a different revision');
  const metrics = mutationMetrics(evidence.mutation.mutants);
  for (const key of ['killed', 'survived', 'noCoverage', 'timedOut', 'invalid', 'ignored', 'pending'] as const) {
    if (metrics[key] !== evidence.mutation.counts[key]) fail('mutation counts do not match the raw inventory');
  }
  if (metrics.score === null ? evidence.mutation.score !== null : evidence.mutation.score === null || Math.abs(metrics.score - evidence.mutation.score) > 0.001) fail('mutation score does not match the raw inventory');
  if (new Set(evidence.mutation.mutants.map(item => item.fingerprint)).size !== evidence.mutation.mutants.length) fail('duplicate mutant fingerprints');
  const fingerprints = new Set(evidence.mutation.mutants.map(item => item.fingerprint));
  for (const finding of evidence.findings) {
    if (!fingerprints.has(finding.mutantFingerprint)) fail('a finding references an unknown mutation');
    if (createHash('sha256').update(finding.proposal.patch).digest('hex') !== finding.proposal.patchHash) fail('the visible proposal patch does not match its hash');
  }
  if (evidence.mutation.status === 'complete' && (!evidence.scope.complete || metrics.invalid || metrics.pending || evidence.baseline.status !== 'passed')) fail('completed analysis contains incomplete or failed execution');
  if (evidence.gate.status === 'passed' && (evidence.baseline.status !== 'passed' || !evidence.scope.complete || evidence.mutation.status !== 'complete' || metrics.score === null || metrics.invalid || metrics.pending || evidence.scope.protectedFilesChanged)) fail('passing gate contradicts the execution evidence');
  if (evidence.verification.status === 'passed') {
    const verification = evidence.verification;
    if (!verification.originalPasses || !verification.mutantFails || !verification.cleanRerun || !verification.patchHash || !evidence.findings.some(finding => finding.proposal.patchHash === verification.patchHash)) fail('verification does not establish the exact proposed repair');
    if (!verification.runs || verification.runs.length < 2 || verification.runs.some(run => run.original.exitCode !== 0 || run.original.timedOut || run.mutant.exitCode !== 1 || run.mutant.timedOut || !run.assertionKilled)) fail('verification lacks reproducible assertion-failure execution');
  }
  return evidence;
}

/** Credentials and paths in a server setting must never be reflected into browser links. */
export function gitlabOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('GitLab URL must be an HTTPS origin without credentials, paths, query, or fragment.');
  return url.origin;
}

/** Enforce the evidence budget while reading, before allocating an arbitrary upstream body. */
export async function readBoundedText(response: Response, maximumBytes = 5_000_000): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maximumBytes) throw new Error('Evidence exceeds the 5 MB limit.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new Error('Evidence exceeds the 5 MB limit.'); }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}
