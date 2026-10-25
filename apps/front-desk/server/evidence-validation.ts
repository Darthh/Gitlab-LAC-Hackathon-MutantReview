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
const line = z.number().int().positive();
const triage = z.object({
  policy: label, considered: count,
  arid: z.array(z.object({ fingerprint: hash, path, line, reason: text })).max(10000),
  ranked: z.array(z.object({ rank: z.number().int().min(1).max(3), fingerprint: hash, path, line, operator: label, original: text, replacement: text,
    status: z.enum(['Survived', 'NoCoverage']), priority: z.enum(['high', 'medium', 'low']), why: text })).max(3),
  overflow: count,
});
const modelInput = z.object({ findingsSent: z.number().int().min(0).max(3), findingsOpen: count, charsSent: count, charsOpen: count, charsAvoided: count, tokensAvoidedApprox: count });
const savings = z.object({ mutantsChangedLines: count, mutantsWholeFiles: count.nullable(), mutantsAvoided: count.nullable(),
  aridFiltered: count, aiCallsAvoided: count, lessonsInMemory: count, modelInput: modelInput.optional(), wholeFileCount: text.nullable().optional() });
const grams = z.number().finite().nonnegative();
const usage = z.object({ wallMs: duration, cpuMs: duration.nullable(), vCpus: z.number().int().positive().max(1024), memoryGb: z.number().finite().positive().max(100_000) });
const footprintValue = z.object({ energyWh: grams, operationalG: grams, embodiedG: grams, sciG: grams, cpuSeconds: grams, utilization: z.number().finite().min(0).max(1), cpuMeasured: z.boolean() });
const footprint = z.object({
  functionalUnit: z.literal('one merge-request review'), boundary: text, region: label, regionBasis: label,
  gridIntensity: grams, machine: z.object({ vCpus: z.number().int().positive(), memoryGb: z.number().finite().positive() }),
  measured: usage, actual: footprintValue, range: z.object({ lowG: grams, highG: grams }),
  steps: z.array(z.object({ step: label, cpuSeconds: grams, energyWh: grams, sciG: grams })).max(20).optional(),
  changedLinesRun: footprintValue.extend({ mutants: count }).nullable(),
  projectedWholeFile: footprintValue.extend({ mutants: count, projected: z.literal(true) }).nullable(),
  savedG: grams.nullable(), savedPercent: z.number().finite().min(0).max(100).nullable(),
  modelCalls: z.object({ made: count, avoided: count }),
});
export type EvidenceTriage = z.infer<typeof triage>;
export type EvidenceFootprint = z.infer<typeof footprint>;
export type EvidenceSavings = z.infer<typeof savings>;
export { label, text, path as repositoryPath };

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
  metrics: z.record(z.string(), duration.nullable()),
  preflight: z.object({ results: z.array(z.object({ path, findings: z.array(z.object({ classification: label, line: z.number().int().positive(), code: text, concern: text })) })),
    note: text }).optional(),
  integrations: z.object({ gitlab: label, duo: label }),
  gate: z.object({ status: z.enum(['passed', 'failed', 'inconclusive', 'no-applicable-scope']), reasons: z.array(text).max(100) }),
  evidenceFiles: z.array(path).max(200),
  triage: triage.optional(), savings: savings.optional(), footprint: footprint.nullable().optional(),
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
  const byFingerprint = new Map(evidence.mutation.mutants.map(item => [item.fingerprint, item]));
  if (evidence.triage) {
    const { arid, ranked, overflow, considered } = evidence.triage;
    const listed = [...arid, ...ranked];
    if (listed.some(item => { const raw = byFingerprint.get(item.fingerprint); return !raw || raw.path !== item.path || raw.line !== item.line || (raw.status !== 'Survived' && raw.status !== 'NoCoverage'); })) fail('triage references an unknown or detected mutation');
    if (ranked.some(item => byFingerprint.get(item.fingerprint)!.status !== item.status) || new Set(ranked.map(item => item.rank)).size !== ranked.length || new Set(listed.map(item => item.fingerprint)).size !== listed.length) fail('ranked findings do not match the raw inventory');
    if (considered > evidence.mutation.counts.survived + evidence.mutation.counts.noCoverage || listed.length + overflow > considered) fail('triage counts exceed the surviving mutants');
  }
  if (evidence.savings) {
    const { mutantsWholeFiles: whole, mutantsAvoided: avoided, mutantsChangedLines: changed, aridFiltered, aiCallsAvoided } = evidence.savings;
    if ((whole === null) !== (avoided === null) || (whole !== null && avoided !== whole - changed)) fail('avoided mutants do not equal whole-file minus changed-line mutants');
    if (evidence.triage && (aridFiltered !== evidence.triage.arid.length || aiCallsAvoided !== aridFiltered + evidence.triage.overflow)) fail('savings do not match the triage record');
    const input = evidence.savings.modelInput;
    if (input && (input.charsAvoided !== input.charsOpen - input.charsSent || input.tokensAvoidedApprox !== Math.round(input.charsAvoided / 4)
      || input.findingsOpen !== evidence.mutation.counts.survived + evidence.mutation.counts.noCoverage
      || (evidence.triage && input.findingsSent !== evidence.triage.ranked.length))) fail('model input savings do not match the triage record');
  }
  if (evidence.footprint) {
    const { actual, range, changedLinesRun, projectedWholeFile, savedG, modelCalls, steps } = evidence.footprint;
    if (steps && Math.abs(steps.reduce((sum, step) => sum + step.sciG, 0) - actual.sciG) > 0.001 * Math.max(1, steps.length)) fail('footprint steps do not add up');
    if (Math.abs(actual.operationalG + actual.embodiedG - actual.sciG) > 0.001 || range.lowG > actual.sciG + 0.001 || range.highG < actual.sciG - 0.001) fail('footprint does not add up');
    if (changedLinesRun && changedLinesRun.mutants !== evidence.mutation.mutants.length) fail('footprint mutant count does not match the raw inventory');
    if (projectedWholeFile && (evidence.savings?.mutantsWholeFiles !== projectedWholeFile.mutants || !changedLinesRun)) fail('footprint projection does not match the measured whole-file count');
    if ((savedG === null) !== (projectedWholeFile === null)) fail('footprint saving has no projection behind it');
    if (evidence.savings && modelCalls.avoided !== evidence.savings.aiCallsAvoided) fail('footprint model calls do not match the savings record');
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
