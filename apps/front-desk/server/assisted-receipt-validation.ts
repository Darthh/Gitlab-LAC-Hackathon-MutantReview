import { z } from 'zod';
import { exactPatchHash } from '../../../packages/gitlab-adapter/src/index.js';
import { applyAppendPatch } from '../../../packages/cli/src/workflow.js';
import { fixtureFeatures } from '../../../packages/cli/src/committed-proof.js';

const label = z.string().min(1).max(500);
const text = z.string().max(100_000);
const positive = z.number().int().positive();
const sha = z.string().regex(/^[a-f0-9]{40}$/i);
const hash = z.string().regex(/^[a-f0-9]{64}$/i);
const actor = z.string().regex(/^[1-9]\d*$/);
const timestamp = z.iso.datetime();
const path = z.string().max(1000).refine(value => !value.startsWith('/') && !value.includes('\\') && !/[\x00-\x1f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'));
const url = z.string().max(2000).refine(value => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash; } catch { return false; } });
const execution = z.object({ exitCode: z.number().int().nullable(), durationMs: z.number().finite().nonnegative(), timedOut: z.boolean(), log: path });
const proposalSchema = z.object({ id: label, projectId: positive, mergeRequestIid: positive, sourceHeadSha: sha, runId: label,
  findingIds: z.array(label).min(1).max(20), files: z.array(z.object({ path, before: text, after: text })).min(1).max(1), patchHash: hash });

export const assistedReceiptSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal('gitlab-assisted-local-verification'), proposalId: label,
  projectId: actor, mrIid: positive, sourceHeadSha: sha, runId: label, patchHash: hash,
  proposal: proposalSchema, proposalPatch: text, testPath: path,
  repair: z.object({ commitSha: sha, branch: label, url, approvedBy: actor, approvedAt: timestamp, approvalEventId: label }),
  verification: z.object({ status: z.enum(['passed', 'failed']), source: z.literal('fresh local execution of immutable GitLab commit contents'),
    repairCommitSha: sha, patchHash: hash, sourceHash: hash, cleanRerun: z.boolean(), tokens: z.null(),
    exactMutation: z.object({ sourcePath: path, original: text, replacement: text, message: text, contract: label, symbol: label }),
    runs: z.array(z.object({ attempt: positive, original: execution, mutant: execution, assertionKilled: z.boolean() })).min(1).max(2),
    approvedBy: actor, approvedAt: timestamp, approvalEventId: label }),
  pipeline: z.object({ id: positive, sha, url, status: z.literal('started-or-existing-outcome-unverified') }),
  lesson: z.object({ id: label, status: z.literal('approved'), verified: z.literal(true), approvedBy: actor, approvedAt: timestamp,
    receiptId: hash, commitSha: sha, branch: label, url, recommendation: text, tags: z.array(label).max(30), sourceReceiptHash: hash }).optional(),
  lessonApplication: z.object({ retrievalId: label, lessonIds: z.array(label).min(1).max(5), sourceRevision: sha,
    whyApplies: label, status: z.enum(['retrieved', 'applied-and-verified']), repairCommitSha: sha,
    provenance: z.literal('submitted-structured-triage'), duoExecution: z.literal('unverified') }).optional(),
  createdAt: timestamp,
});

export interface AssistedReceiptExpectations { projectId?: string; mergeRequestIid?: number; gitlabOrigin?: string }
export type AssistedReceipt = z.infer<typeof assistedReceiptSchema>;

export function validateAssistedReceipt(input: unknown, expected: AssistedReceiptExpectations = {}): AssistedReceipt {
  const parsed = assistedReceiptSchema.safeParse(input);
  if (!parsed.success) throw new Error('Assisted receipt format is unsupported or malformed.');
  const receipt = parsed.data;
  const fail = (reason: string): never => { throw new Error(`Assisted receipt rejected: ${reason}`); };
  if (expected.projectId && receipt.projectId !== expected.projectId) fail('receipt belongs to another project');
  if (expected.mergeRequestIid && receipt.mrIid !== expected.mergeRequestIid) fail('receipt belongs to another merge request');
  for (const link of [receipt.repair.url, receipt.pipeline.url, receipt.lesson?.url].filter((item): item is string => !!item)) {
    if (expected.gitlabOrigin && new URL(link).origin !== expected.gitlabOrigin) fail('an evidence link leaves the configured GitLab instance');
  }
  const proposal = receipt.proposal;
  if (proposal.id !== receipt.proposalId || String(proposal.projectId) !== receipt.projectId || proposal.mergeRequestIid !== receipt.mrIid || proposal.sourceHeadSha !== receipt.sourceHeadSha || proposal.runId !== receipt.runId || proposal.patchHash !== receipt.patchHash || proposal.files[0]!.path !== receipt.testPath || exactPatchHash(proposal) !== receipt.patchHash) fail('proposal content or revision does not match its exact approved hash');
  try {
    const reconstructed = applyAppendPatch(receipt.proposalPatch, Object.fromEntries(proposal.files.map(file => [file.path, file.before])));
    if (JSON.stringify(reconstructed) !== JSON.stringify(proposal.files)) fail('visible patch differs from the approved file contents');
  } catch { fail('visible patch cannot reproduce the approved file contents'); }
  const verification = receipt.verification;
  if (receipt.repair.commitSha === receipt.sourceHeadSha || verification.repairCommitSha !== receipt.repair.commitSha || verification.patchHash !== receipt.patchHash || receipt.pipeline.sha !== receipt.repair.commitSha) fail('repair, verification, or pipeline refers to another revision');
  if (receipt.repair.approvalEventId === verification.approvalEventId) fail('patch and verification require separate human approval events');
  const repairTime = Date.parse(receipt.repair.approvedAt), verificationTime = Date.parse(verification.approvedAt), createdTime = Date.parse(receipt.createdAt);
  if (repairTime > verificationTime || verificationTime > createdTime) fail('approval timestamps do not follow the repair sequence');
  const feature = fixtureFeatures[receipt.testPath as keyof typeof fixtureFeatures];
  if (!feature || verification.exactMutation.sourcePath !== feature.sourcePath || verification.exactMutation.original !== feature.original || verification.exactMutation.replacement !== feature.replacement || verification.exactMutation.contract !== feature.contract) fail('verification does not target the approved demo contract mutation');
  if (verification.status === 'passed' && (!verification.cleanRerun || verification.runs.length !== 2 || new Set(verification.runs.map(run => run.attempt)).size !== 2 || verification.runs.some(run => run.original.exitCode !== 0 || run.original.timedOut || run.mutant.exitCode !== 1 || run.mutant.timedOut || !run.assertionKilled))) fail('successful verification lacks repeated fresh assertion-failure execution');
  if (receipt.lesson && (verification.status !== 'passed' || receipt.lesson.receiptId !== receipt.lesson.sourceReceiptHash || Date.parse(receipt.lesson.approvedAt) < verificationTime || Date.parse(receipt.lesson.approvedAt) > createdTime)) fail('lesson lacks a successful preceding repair and matching receipt reference');
  if (receipt.lessonApplication) {
    const application = receipt.lessonApplication;
    if (application.sourceRevision !== receipt.sourceHeadSha || application.repairCommitSha !== receipt.repair.commitSha || new Set(application.lessonIds).size !== application.lessonIds.length || application.lessonIds.some(id => !application.whyApplies.includes(id))) fail('lesson application does not match the task revision and named lesson rationale');
    if (application.status === 'applied-and-verified' && verification.status !== 'passed') fail('lesson application has not passed fresh repair verification');
  }
  return receipt;
}
