import { describe, expect, it } from 'vitest';
import { exactPatchHash } from '../../../packages/gitlab-adapter/src/index.js';
import { validateAssistedReceipt } from './assisted-receipt-validation.js';

// Synthetic parser inputs live only in this test. They are never exported as measured evidence.
function example() {
  const path = 'packages/demo-domain/src/shipping.test.ts';
  const before = "import { it, expect } from 'vitest';\n";
  const added = "it('boundary', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});\n";
  const proposal = { id: 'proposal-test', projectId: 88030103, mergeRequestIid: 1, sourceHeadSha: 'a'.repeat(40), runId: 'run-test', findingIds: ['gap-1'], files: [{ path, before, after: before + added }], patchHash: '' };
  proposal.patchHash = exactPatchHash(proposal);
  const execution = (attempt: number, mutant: boolean) => ({ exitCode: mutant ? 1 : 0, durationMs: 100, timedOut: false, log: `evidence/approved/test/${mutant ? 'mutant' : 'original'}-${attempt}.log` });
  return {
    schemaVersion: 1, source: 'gitlab-assisted-local-verification', proposalId: proposal.id, projectId: '88030103', mrIid: 1,
    sourceHeadSha: proposal.sourceHeadSha, runId: proposal.runId, patchHash: proposal.patchHash, proposal,
    proposalPatch: `--- a/${path}\n+++ b/${path}\n@@ -1,0 +2,3 @@\n+it('boundary', () => {\n+  expect(shippingFee(10_000)).toBe(0);\n+});\n`, testPath: path,
    repair: { commitSha: 'b'.repeat(40), branch: 'mutant-review/test', url: `https://gitlab.com/Darthh2/mutant-review/-/commit/${'b'.repeat(40)}`, approvedBy: '42', approvedAt: '2026-10-24T03:55:00Z', approvalEventId: 'project-88030103-mr-1-note-1' },
    verification: { status: 'passed', source: 'fresh local execution of immutable GitLab commit contents', repairCommitSha: 'b'.repeat(40), patchHash: proposal.patchHash, sourceHash: 'c'.repeat(64), cleanRerun: true, tokens: null,
      exactMutation: { sourcePath: 'packages/demo-domain/src/shipping.ts', original: 'subtotalCents >= 10_000', replacement: 'subtotalCents > 10_000', message: 'expected 500 to be +0', contract: 'SHIPPING-001', symbol: 'shippingFee' },
      runs: [1, 2].map(attempt => ({ attempt, original: execution(attempt, false), mutant: execution(attempt, true), assertionKilled: true })), approvedBy: '42', approvedAt: '2026-10-24T04:00:00Z', approvalEventId: 'project-88030103-mr-1-note-2' },
    pipeline: { id: 123, sha: 'b'.repeat(40), url: 'https://gitlab.com/Darthh2/mutant-review/-/pipelines/123', status: 'started-or-existing-outcome-unverified' },
    createdAt: '2026-10-24T04:01:00Z',
  };
}

describe('assisted receipt trust boundaries', () => {
  it('accepts the exact approved file contents and a separately approved local proof', () => {
    const receipt = validateAssistedReceipt(example(), { projectId: '88030103', mergeRequestIid: 1, gitlabOrigin: 'https://gitlab.com' });
    expect(receipt.verification.runs).toHaveLength(2);
    expect(receipt.pipeline.status).toBe('started-or-existing-outcome-unverified');
  });
  it('rejects changed approved contents or a displayed patch that differs from those contents', () => {
    const changed = example(); changed.proposal.files[0]!.after += '// unapproved\n';
    expect(() => validateAssistedReceipt(changed)).toThrow('exact approved hash');
    const patch = example(); patch.proposalPatch = patch.proposalPatch.replace('toBe(0)', 'toBe(500)');
    expect(() => validateAssistedReceipt(patch)).toThrow('visible patch');
  });
  it('rejects another project or MR and links leaving the configured GitLab instance', () => {
    expect(() => validateAssistedReceipt(example(), { projectId: 'other' })).toThrow('another project');
    expect(() => validateAssistedReceipt(example(), { mergeRequestIid: 2 })).toThrow('another merge request');
    const value = example(); value.pipeline.url = 'https://elsewhere.example/pipeline';
    expect(() => validateAssistedReceipt(value, { gitlabOrigin: 'https://gitlab.com' })).toThrow('leaves the configured');
  });
  it('rejects reused approval events and incorrect stage order', () => {
    const replay = example(); replay.verification.approvalEventId = replay.repair.approvalEventId;
    expect(() => validateAssistedReceipt(replay)).toThrow('separate human approval');
    const time = example(); time.repair.approvedAt = '2026-10-24T04:00:30Z';
    expect(() => validateAssistedReceipt(time)).toThrow('repair sequence');
  });
  it('rejects a pipeline on another revision and a timeout masquerading as an assertion kill', () => {
    const pipeline = example(); pipeline.pipeline.sha = 'f'.repeat(40);
    expect(() => validateAssistedReceipt(pipeline)).toThrow('another revision');
    const timeout = example(); timeout.verification.runs[0]!.mutant.timedOut = true;
    expect(() => validateAssistedReceipt(timeout)).toThrow('fresh assertion-failure');
  });
  it('rejects the wrong targeted mutation and duplicate rerun numbers', () => {
    const wrong = example(); wrong.verification.exactMutation.original = 'subtotalCents > 10_000';
    expect(() => validateAssistedReceipt(wrong)).toThrow('approved demo contract mutation');
    const repeated = example(); repeated.verification.runs[1]!.attempt = 1;
    expect(() => validateAssistedReceipt(repeated)).toThrow('fresh assertion-failure');
  });
  it('requires approved verified lessons to follow a successful repair and share its receipt reference', () => {
    const value = { ...example(), lesson: { id: 'lesson-1', status: 'approved', verified: true, approvedBy: '42', approvedAt: '2026-10-24T04:00:30Z', receiptId: 'd'.repeat(64), sourceReceiptHash: 'd'.repeat(64), commitSha: 'e'.repeat(40), branch: 'mutant-review/lesson-test', url: `https://gitlab.com/Darthh2/mutant-review/-/commit/${'e'.repeat(40)}`, recommendation: 'Test below, at and above the inclusive threshold.', tags: ['inclusive-threshold'] } };
    expect(validateAssistedReceipt(value).lesson?.verified).toBe(true);
    value.lesson.sourceReceiptHash = 'f'.repeat(64);
    expect(() => validateAssistedReceipt(value)).toThrow('matching receipt reference');
  });
  it('never treats a pipeline-start receipt as a successful CI outcome and strips unknown data', () => {
    const value = { ...example(), privateCredential: 'not-a-real-secret' };
    expect(validateAssistedReceipt(value)).not.toHaveProperty('privateCredential');
    value.pipeline.status = 'passed';
    expect(() => validateAssistedReceipt(value)).toThrow('unsupported or malformed');
  });
  it('binds demonstrated lesson application to the new task and proof without inventing Duo execution', () => {
    const value = { ...example(), lessonApplication: { retrievalId: 'retrieval-1', lessonIds: ['lesson-boundary-1'], sourceRevision: 'a'.repeat(40), whyApplies: 'lesson-boundary-1 applies to the new inclusive discount threshold.', status: 'applied-and-verified', repairCommitSha: 'b'.repeat(40), provenance: 'submitted-structured-triage', duoExecution: 'unverified' } };
    expect(validateAssistedReceipt(value).lessonApplication?.status).toBe('applied-and-verified');
    value.lessonApplication.sourceRevision = 'f'.repeat(40);
    expect(() => validateAssistedReceipt(value)).toThrow('task revision');
    value.lessonApplication.sourceRevision = 'a'.repeat(40);
    value.lessonApplication.duoExecution = 'verified';
    expect(() => validateAssistedReceipt(value)).toThrow('unsupported or malformed');
  });
});
