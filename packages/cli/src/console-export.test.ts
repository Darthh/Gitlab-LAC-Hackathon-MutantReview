import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GitLabAdapter } from '../../gitlab-adapter/src/index.js';
import { readEvidenceCache } from '../../gitlab-adapter/src/evidence-cache.js';
import { exportConsoleEvidence, runAssisted } from './workflow.js';

const head = 'a'.repeat(40);
const now = new Date('2026-10-24T18:30:00Z');
const artifact = () => ({ schemaVersion: 1, source: 'gitlab', runId: 'mock-measured-run',
  provenance: { projectId: '5', mrIid: 2, jobId: '9', pipelineId: '8', headSha: head, baseSha: 'c'.repeat(40) },
  baseline: { status: 'passed' }, scope: { complete: true }, mutation: { status: 'complete', mutants: [] } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function scenario(evidence: unknown = artifact(), change: { authenticationFails?: boolean; headChanges?: boolean } = {}) {
  let mrReads = 0;
  const fetch = vi.fn(async (input: string | URL | Request, _options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/merge_requests/2')) {
      mrReads++;
      const sha = change.headChanges && mrReads > 1 ? 'b'.repeat(40) : head;
      return json({ iid: 2, sha, source_project_id: 5, target_project_id: 5,
        diff_refs: { head_sha: sha, base_sha: 'c'.repeat(40), start_sha: 'c'.repeat(40) } });
    }
    if (url.endsWith('/jobs/9')) return change.authenticationFails ? json({}, 401) : json({ id: 9, commit: { id: head }, pipeline: { id: 8, sha: head } });
    if (url.endsWith('/jobs/9/artifacts/evidence/latest.json')) return json(evidence);
    throw new Error('Unexpected mock transport request');
  });
  return { fetch, adapter: new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 5, token: 'fixture-only-operator', fetch }) };
}

describe('authenticated signed console export (mock HTTP)', () => {
  it('exports an authoritative exact-revision artifact and returns only paths, timestamp and provenance', async () => {
    const state = await mkdtemp(join(tmpdir(), 'mutant-review-console-export-'));
    const { adapter, fetch } = scenario();
    const output = await exportConsoleEvidence(adapter, 2, 9, state, now);
    expect(output).toEqual({ cacheFile: join(state, 'console', 'evidence.json'), publicKeyFile: join(state, 'console', 'keys', 'artifact-signing-public.pem'),
      verifiedAt: now.toISOString(), provenance: { source: 'authenticated-gitlab-artifact-cache', projectId: 5, mrIid: 2, jobId: 9, headSha: head, pipelineId: '8' } });
    expect(output).not.toHaveProperty('evidence');
    expect(JSON.stringify(output)).not.toContain('fixture-only-operator');
    const verified = await readEvidenceCache(output.cacheFile, output.publicKeyFile, { projectId: 5, mrIid: 2, jobId: 9, headSha: head }, now);
    expect(verified.evidence).toEqual(artifact());
    expect(fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  });
  it.each([{ projectId: '6' }, { mrIid: 3 }, { jobId: '10' }, { headSha: 'b'.repeat(40) }, { pipelineId: '10' }])('rejects changed inner provenance without signing: %o', async (changed) => {
    const state = await mkdtemp(join(tmpdir(), 'mutant-review-console-provenance-'));
    const value = artifact();
    const { adapter } = scenario({ ...value, provenance: { ...value.provenance, ...changed } });
    await expect(exportConsoleEvidence(adapter, 2, 9, state, now)).rejects.toThrow(/provenance|revision/);
    await expect(stat(join(state, 'console'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('cannot replace authenticated job metadata with a publicly readable artifact', async () => {
    const state = await mkdtemp(join(tmpdir(), 'mutant-review-console-auth-'));
    const { adapter, fetch } = scenario(artifact(), { authenticationFails: true });
    await expect(exportConsoleEvidence(adapter, 2, 9, state, now)).rejects.toThrow('(401)');
    expect(fetch.mock.calls.some(([input]) => String(input).includes('/artifacts/'))).toBe(false);
    await expect(stat(join(state, 'console'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects an MR head that moves while the authenticated artifact is being read', async () => {
    const state = await mkdtemp(join(tmpdir(), 'mutant-review-console-stale-'));
    const { adapter } = scenario(artifact(), { headChanges: true });
    await expect(exportConsoleEvidence(adapter, 2, 9, state, now)).rejects.toThrow('MR head changed');
    await expect(stat(join(state, 'console'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not require a configured Duo flow and prints no artifact or approval payload', async () => {
    const state = await mkdtemp(join(tmpdir(), 'mutant-review-console-command-'));
    const { fetch } = scenario();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('GITLAB_URL', 'https://gitlab.example');
    vi.stubEnv('GITLAB_PROJECT_ID', '5');
    vi.stubEnv('GITLAB_WRITE_TOKEN', 'fixture-only-operator');
    vi.stubEnv('MUTANT_REVIEW_STATE_DIR', state);
    vi.stubEnv('GITLAB_FLOW_HANDLE', '');
    try {
      await runAssisted('export-console', ['2', '9']);
      const reported = JSON.parse(String(output.mock.calls[0]?.[0]));
      expect(reported.provenance).toMatchObject({ projectId: 5, mrIid: 2, jobId: 9, headSha: head });
      expect(reported).not.toHaveProperty('evidence');
      expect(reported).not.toHaveProperty('approval');
      expect(await readFile(reported.cacheFile, 'utf8')).not.toContain('fixture-only-operator');
    } finally { output.mockRestore(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
