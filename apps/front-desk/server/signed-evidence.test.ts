import { readFileSync } from 'node:fs';
import { mkdtemp, readFile as readText, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeEvidenceCache, type EvidenceCachePayload } from '../../../packages/gitlab-adapter/src/evidence-cache.js';
import { loadSignedEvidence } from './signed-evidence.js';

// Synthetic GitLab provenance exercises delivery policy; this fixture is never served.
const measured = JSON.parse(readFileSync(new URL('./fixtures/local-run.json', import.meta.url), 'utf8'));
const head = 'a'.repeat(40);
function artifact() {
  const evidence = structuredClone(measured);
  evidence.source = 'gitlab';
  Object.assign(evidence.provenance, { projectId: '5', mrIid: 2, headSha: head, baseSha: 'b'.repeat(40), pipelineId: '8', jobId: '9' });
  for (const mutant of evidence.mutation.mutants) mutant.provenance.headSha = head;
  return evidence;
}
const adapter = (sha = head) => ({ currentMergeRequest: async () => ({ sha }) });

async function cacheFixture(evidence = artifact(), pipelineId = '8') {
  const directory = await mkdtemp(join(tmpdir(), 'mutant-review-signed-delivery-test-'));
  const now = new Date();
  const payload: EvidenceCachePayload = { schemaVersion: 1, source: 'authenticated-gitlab-artifact-cache', verifiedAt: now.toISOString(), projectId: 5, mrIid: 2, jobId: 9, headSha: head, pipelineId, evidence };
  const files = await writeEvidenceCache(payload, join(directory, 'artifact.json'), join(directory, 'keys'));
  return { settings: { ...files, projectId: 5, mrIid: 2, jobId: 9 }, now };
}

describe('credential-free signed evidence delivery', () => {
  it('verifies the signature and current public MR head, then preserves measured evidence', async () => {
    const { settings, now } = await cacheFixture();
    const result = await loadSignedEvidence(settings, adapter(), now);
    expect(result.evidence.mutation.score).toBe(80);
    expect(result.delivery.mode).toBe('signed-cache');
    expect(result.delivery.verifiedAt).toBe(now.toISOString());
    expect(result.delivery.currentHeadSha).toBe(head);
    expect(Number.isFinite(Date.parse(result.delivery.currentHeadCheckedAt))).toBe(true);
  });
  it('fails closed if the live MR head has advanced', async () => {
    const { settings, now } = await cacheFixture();
    await expect(loadSignedEvidence(settings, adapter('c'.repeat(40)), now)).rejects.toThrow('current MR head');
  });
  it('fails closed for a tampered signature without loading job metadata or credentials', async () => {
    const { settings, now } = await cacheFixture();
    const envelope = JSON.parse(await readText(settings.cacheFile, 'utf8'));
    envelope.payload.evidence.mutation.score = 100;
    await writeFile(settings.cacheFile, JSON.stringify(envelope));
    await expect(loadSignedEvidence(settings, adapter(), now)).rejects.toThrow('could not be verified');
  });
  it('deeply validates signed counts and pipeline bindings', async () => {
    const malformed = artifact();
    malformed.mutation.counts.killed += 1;
    const first = await cacheFixture(malformed);
    await expect(loadSignedEvidence(first.settings, adapter(), first.now)).rejects.toThrow('mutation counts');
    const second = await cacheFixture(artifact(), '99');
    await expect(loadSignedEvidence(second.settings, adapter(), second.now)).rejects.toThrow('different pipelines');
  });
  it('never falls back to a snapshot when the anonymous current-head check fails', async () => {
    const { settings, now } = await cacheFixture();
    const unavailable = { currentMergeRequest: async () => { throw new Error('GitLab public MR metadata unavailable'); } } as Parameters<typeof loadSignedEvidence>[1];
    await expect(loadSignedEvidence(settings, unavailable, now)).rejects.toThrow('public MR metadata unavailable');
  });
});
