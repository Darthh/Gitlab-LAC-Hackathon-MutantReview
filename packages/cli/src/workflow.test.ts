import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GitLabAdapter, ExactPatchProposal } from '../../gitlab-adapter/src/index.js';
import { applyAppendPatch, approvalFromNote, hydrateEvidence, recordLessonRetrieval, trustedStateDirectory, writeImmutable } from './workflow.js';
import { execute, executionEnvironment } from './runner.js';

const testPath = 'packages/demo-domain/src/shipping.test.ts';
const before = "import { it, expect } from 'vitest';\n";
const patch = `--- a/${testPath}\n+++ b/${testPath}\n@@ -1,0 +2,3 @@\n+it('boundary', () => {\n+  expect(shippingFee(10_000)).toBe(0);\n+});\n`;
const proposal: ExactPatchProposal = { id: 'proposal-demo', projectId: 5, mergeRequestIid: 2, sourceHeadSha: 'a'.repeat(40), runId: 'run-1', findingIds: ['finding-1'], files: [], patchHash: 'b'.repeat(64) };
const now = new Date('2026-10-24T04:00:00Z');

function fakeAdapter(change: { body?: string; time?: string; head?: string; level?: number; authorId?: number; state?: string } = {}) {
  return {
    projectId: 5,
    readMergeRequestNote: async () => ({ id: 7, author: { id: change.authorId ?? 42 }, body: change.body ?? `@actual-flow apply ${proposal.id} ${proposal.patchHash}`, created_at: change.time ?? '2026-10-24T03:55:00Z', updated_at: change.time ?? '2026-10-24T03:55:00Z' }),
    currentMember: async (actorId: number) => ({ id: actorId, access_level: change.level ?? 40, state: change.state ?? 'active', expires_at: null }),
    currentMergeRequest: async () => ({ sha: change.head ?? proposal.sourceHeadSha, state: 'opened' }),
  } as unknown as GitLabAdapter;
}

describe('unified patch execution binding', () => {
  it('applies the exact appended assertion while preserving existing bytes', () => {
    expect(applyAppendPatch(patch, { [testPath]: before })).toEqual([{ path: testPath, before, after: before + "it('boundary', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});\n" }]);
  });
  it('rejects forged hunk coordinates and counts', () => {
    expect(() => applyAppendPatch(patch.replace('+2,3', '+22,3'), { [testPath]: before })).toThrow();
    expect(() => applyAppendPatch(patch.replace('+2,3', '+2,8'), { [testPath]: before })).toThrow();
  });
  it('preserves significant whitespace in the exact displayed addition', () => {
    const value = patch.replace('+2,3', '+2,4') + '+  \n';
    expect(applyAppendPatch(value, { [testPath]: before })[0]!.after.endsWith('});\n  \n')).toBe(true);
  });
  it('rejects an assertion inserted before existing test behavior', () => {
    expect(() => applyAppendPatch(patch.replace('-1,0 +2,3', '-0,0 +1,3'), { [testPath]: before })).toThrow('preserve existing');
  });
  it('rejects production paths, removals, and weakened appended checks', () => {
    expect(() => applyAppendPatch(patch.replaceAll('shipping.test.ts', 'shipping.ts'), { [testPath]: before })).toThrow();
    expect(() => applyAppendPatch(patch.replace("+it('boundary'", "-it('boundary'"), { [testPath]: before })).toThrow();
    expect(() => applyAppendPatch(patch.replace("it('boundary'", "it.skip('boundary'"), { [testPath]: before })).toThrow();
  });
});

describe('authoritative GitLab note authorization', () => {
  it('uses the fetched author and binds a single explicit action', async () => {
    const approval = await approvalFromNote(fakeAdapter(), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', now);
    expect(approval.actorId).toBe(42);
    expect(approval.action).toBe('apply');
    expect(approval.eventId).toBe('project-5-mr-2-note-7');
  });
  it('rejects a verify command as patch authorization', async () => {
    await expect(approvalFromNote(fakeAdapter({ body: `@actual-flow verify ${proposal.id} ${proposal.patchHash}` }), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', now)).rejects.toThrow('exact action');
  });
  it('rejects unknown hashes and arbitrary prose', async () => {
    await expect(approvalFromNote(fakeAdapter({ body: `@actual-flow apply ${proposal.id} ${'c'.repeat(64)}` }), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', now)).rejects.toThrow();
    await expect(approvalFromNote(fakeAdapter({ body: 'Please apply this, approved!' }), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', now)).rejects.toThrow();
  });
  it('rejects stale heads, expired notes, and notes from before the proposal', async () => {
    await expect(approvalFromNote(fakeAdapter({ head: 'c'.repeat(40) }), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', now)).rejects.toThrow('stale');
    await expect(approvalFromNote(fakeAdapter({ time: '2026-10-24T02:00:00Z' }), proposal, 'apply', 7, '@actual-flow', '2026-10-24T01:50:00Z', now)).rejects.toThrow('expired');
    await expect(approvalFromNote(fakeAdapter(), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:59:00Z', now)).rejects.toThrow('predates');
  });
  it('checks current membership rather than trusting a past approval role', async () => {
    await expect(approvalFromNote(fakeAdapter({ level: 30 }), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', now)).rejects.toThrow('maintainer');
    await expect(approvalFromNote(fakeAdapter({ state: 'blocked' }), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', now)).rejects.toThrow('maintainer');
  });
  it('rejects malformed trusted timestamps rather than bypassing date comparisons', async () => {
    await expect(approvalFromNote(fakeAdapter(), proposal, 'apply', 7, '@actual-flow', 'invalid', now)).rejects.toThrow();
    await expect(approvalFromNote(fakeAdapter(), proposal, 'apply', 7, '@actual-flow', '2026-10-24T03:50:00Z', new Date('invalid'))).rejects.toThrow();
  });
});

describe('durable operator state and execution credentials', () => {
  it('rejects a state directory inside the checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mutant-review-state-test-'));
    const inside = join(root, 'untrusted');
    await expect(trustedStateDirectory(inside, root)).rejects.toThrow('outside');
    const outside = await mkdtemp(join(tmpdir(), 'mutant-review-operator-test-'));
    await expect(trustedStateDirectory(outside, root)).resolves.toBeTruthy();
  });
  it('never overwrites a changed proposal or completed receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mutant-review-immutable-test-'));
    const path = join(root, 'proposal.json');
    await writeImmutable(path, { patchHash: 'original' });
    await expect(writeImmutable(path, { patchHash: 'changed' })).rejects.toThrow();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ patchHash: 'original' });
  });
  it('strips service credentials and custom Node loaders from test subprocesses', () => {
    const environment = executionEnvironment({ PATH: '/usr/bin', SystemRoot: 'C:\\Windows', GITLAB_WRITE_TOKEN: 'secret', CI_JOB_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', NODE_OPTIONS: '--require untrusted.js' });
    expect(environment.PATH).toBe('/usr/bin');
    expect(environment.GITLAB_WRITE_TOKEN).toBeUndefined();
    expect(environment.CI_JOB_TOKEN).toBeUndefined();
    expect(environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(environment.NODE_OPTIONS).toBeUndefined();
  });
  it('stops timed-out execution instead of leaving the proof pending', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mutant-review-timeout-test-'));
    const run = await execute(['-e', 'setInterval(() => {}, 1000)'], join(root, 'timeout.log'), 200);
    expect(run.timedOut).toBe(true);
    expect(run.exitCode).not.toBe(0);
  });
});

describe('read-only GitLab flow artifact hydration (mock transport)', () => {
  const evidence = {
    runId: 'measured-run', source: 'gitlab',
    provenance: { projectId: '5', mrIid: 2, headSha: proposal.sourceHeadSha, baseSha: 'c'.repeat(40), jobId: '9' },
    baseline: { status: 'passed' }, scope: { complete: true }, mutation: { status: 'complete', mutants: [] },
  };
  function adapter(data: unknown = evidence) {
    return { projectId: 5, currentMergeRequest: async () => ({ sha: proposal.sourceHeadSha }), readEvidenceArtifact: async () => data } as unknown as GitLabAdapter;
  }
  it('hydrates the exact configured MR/job/head and returns compact provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mutant-review-hydration-test-'));
    const output = join(root, 'latest.json');
    await expect(hydrateEvidence(adapter(), 2, 9, proposal.sourceHeadSha, output)).resolves.toEqual({ status: 'hydrated', projectId: 5, mrIid: 2, headSha: proposal.sourceHeadSha, jobId: 9 });
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(evidence);
  });
  it('removes stale evidence when checkout or live source revision is incorrect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mutant-review-hydration-stale-test-'));
    const output = join(root, 'latest.json');
    await writeFile(output, JSON.stringify({ source: 'stale local fixture' }));
    await expect(hydrateEvidence(adapter(), 2, 9, 'b'.repeat(40), output)).rejects.toThrow('checkout');
    await expect(readFile(output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects mismatched MR provenance and incomplete mutation execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mutant-review-hydration-invalid-test-'));
    await expect(hydrateEvidence(adapter({ ...evidence, provenance: { ...evidence.provenance, mrIid: 3 } }), 2, 9, proposal.sourceHeadSha, join(root, 'wrong-mr.json'))).rejects.toThrow('incomplete, stale');
    await expect(hydrateEvidence(adapter({ ...evidence, scope: { complete: false } }), 2, 9, proposal.sourceHeadSha, join(root, 'incomplete.json'))).rejects.toThrow('incomplete, stale');
  });
  it('does not create a learned-use record for an empty approved lesson set', async () => {
    await expect(recordLessonRetrieval('boundary', [], 5, proposal.sourceHeadSha)).resolves.toBeNull();
  });
  it('journals an actual retrieval separately from successful application', async () => {
    const state = await mkdtemp(join(tmpdir(), 'mutant-review-retrieval-test-'));
    vi.stubEnv('MUTANT_REVIEW_STATE_DIR', state);
    try {
      const lesson = { id: 'lesson-boundary', repository: 'mutant-review', module: 'demo-domain', tags: ['inclusive-threshold'], pattern: 'Inclusive monetary boundary', recommendation: 'Test below, at and above the threshold using the current contract.', status: 'approved' as const, verified: true, approvedBy: '42', approvedAt: '2026-10-24T03:55:00Z', receiptId: 'c'.repeat(64) };
      const retrieval = await recordLessonRetrieval('boundary', [lesson], 5, proposal.sourceHeadSha);
      expect(retrieval?.status).toBe('retrieved');
      expect(retrieval?.lessonIds).toEqual(['lesson-boundary']);
      const journal = JSON.parse(await readFile(join(state, 'retrievals', `${retrieval!.id}.json`), 'utf8'));
      expect(journal.sourceHeadSha).toBe(proposal.sourceHeadSha);
      expect(journal.projectId).toBe(5);
      expect(journal.lessons[0].id).toBe('lesson-boundary');
      expect(journal).not.toHaveProperty('successfullyApplied');
    } finally { vi.unstubAllEnvs(); }
  });
});
