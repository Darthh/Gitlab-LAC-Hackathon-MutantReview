import { describe, expect, it, vi } from 'vitest';
import { GitLabAdapter, exactPatchHash, exactLessonHash, validateTestChanges, type ApprovalLedger, type ExactPatchApproval, type ExactPatchProposal, type ExactLessonProposal } from './index.js';

const head = 'a'.repeat(40);
const mr = { iid: 2, sha: head, source_branch: 'feature/shipping', source_project_id: 7,
  target_project_id: 7, state: 'opened', web_url: 'https://gitlab.example/team/shop/-/merge_requests/2',
  diff_refs: { head_sha: head, base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40) } };
const file = { path: 'packages/demo-domain/src/shipping.test.ts', before: 'import { expect, it } from "vitest";\n',
  after: 'import { expect, it } from "vitest";\n\nit("includes the boundary", () => { expect(shippingFee(10_000)).toBe(0); });\n' };
const rawProposal = { id: 'proposal-1', projectId: 7, mergeRequestIid: 2, sourceHeadSha: head,
  runId: 'run-1', findingIds: ['gap-1'], files: [file] };
const proposal: ExactPatchProposal = { ...rawProposal, patchHash: exactPatchHash(rawProposal) };
const approval: ExactPatchApproval = { action: 'apply', eventId: 'note-1', actorId: 11, projectId: 7, mergeRequestIid: 2,
  sourceHeadSha: head, runId: 'run-1', proposalId: 'proposal-1', findingIds: ['gap-1'], patchHash: proposal.patchHash,
  approvedAt: '2026-10-23T12:00:00Z', expiresAt: '2026-10-23T12:30:00Z' };
const now = new Date('2026-10-23T12:05:00Z');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const ledger = (): ApprovalLedger => ({ reserve: vi.fn(async () => true), record: vi.fn(async () => {}) });

describe('project-restricted GitLab adapter', () => {
  it('rejects credential-bearing or non-HTTPS base URLs', () => {
    for (const baseUrl of ['http://gitlab.example', 'https://user:secret@gitlab.example', 'https://gitlab.example/api']) {
      expect(() => new GitLabAdapter({ baseUrl, projectId: 7 })).toThrow();
    }
  });
  it('encodes a fixed artifact allowlist and never follows credential redirects', async () => {
    const fake = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => json({ runId: 'run-1' }));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, token: 'server-only', fetch: fake });
    expect(await api.readArtifact(13)).toEqual({ runId: 'run-1' });
    expect(fake.mock.calls[0]?.[0]).toBe('https://gitlab.example/api/v4/projects/7/jobs/13/artifacts/evidence/latest.json');
    expect((fake.mock.calls[0]?.[1] as RequestInit)?.redirect).toBe('error');
    expect(await api.readArtifact(13, 'evidence/assisted-receipt.json')).toEqual({ runId: 'run-1' });
    expect(fake.mock.calls[1]?.[0]).toBe('https://gitlab.example/api/v4/projects/7/jobs/13/artifacts/evidence/assisted-receipt.json');
    await expect(api.readArtifact(13, '../../secrets')).rejects.toThrow('allowlisted');
    expect(fake).toHaveBeenCalledTimes(2);
  });
  it('rejects cross-project and fork MRs', async () => {
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7,
      fetch: vi.fn(async () => json({ ...mr, source_project_id: 8 })) });
    await expect(api.currentMergeRequest(2)).rejects.toThrow('cross-project');
  });
  it('does not expose upstream error text', async () => {
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7,
      fetch: vi.fn(async () => new Response('secret=do-not-leak', { status: 403 })) });
    await expect(api.currentMergeRequest(2)).rejects.toThrow('GitLab request failed (403)');
  });
  it('enforces evidence size while streaming when content length is omitted', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(10_000_001)); },
      cancel() { cancelled = true; },
    });
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7,
      fetch: vi.fn(async () => new Response(body)) });
    await expect(api.capabilityCheck()).rejects.toThrow('evidence budget');
    expect(cancelled).toBe(true);
  });
  it('reports an omitted project merge setting as unknown, not disabled', async () => {
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7,
      fetch: vi.fn(async () => json({ id: 7, web_url: 'https://gitlab.example/team/shop' })) });
    expect((await api.capabilityCheck()).requiredSuccessfulPipeline).toBeNull();
  });
  it('supports documented Duo OAuth bearer authentication without exposing it in URLs', async () => {
    const fake = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => json({ id: 7, web_url: 'https://gitlab.example/team/shop' }));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, token: 'fixture-oauth-token', tokenType: 'bearer', fetch: fake });
    await api.capabilityCheck();
    expect(fake.mock.calls[0]?.[0]).toBe('https://gitlab.example/api/v4/projects/7');
    expect(fake.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-oauth-token' });
    expect(fake.mock.calls[0]?.[1]?.headers).not.toHaveProperty('PRIVATE-TOKEN');
  });
  it('limits inline comments to three and falls back when diff coordinates cannot be mapped', async () => {
    const writes: Record<string, unknown>[] = [];
    const fake = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return json({ id: String(writes.length) }); }
      if (url.endsWith('/versions?per_page=1')) return json([{ id: 5, head_commit_sha: head, base_commit_sha: 'b'.repeat(40), start_commit_sha: 'c'.repeat(40) }]);
      if (url.endsWith('/versions/5')) return json({ id: 5, head_commit_sha: head, diffs: [{ old_path: 'src/old.ts', new_path: 'src/shipping.ts', diff: '@@ -1,1 +1,4 @@\n+one\n+two\n+three\n+four' }] });
      return json(mr);
    });
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, token: 'server-only', fetch: fake });
    await api.publishFindings(2, head, 'Mutation review', [1, 2, 3, 4, 99].map((line) => ({ id: `gap-${line}`, body: `Finding ${line}`, path: 'src/shipping.ts', line })));
    expect(writes).toHaveLength(4);
    expect(writes.filter((item) => item.position)).toHaveLength(3);
    expect(writes[0]?.body).toContain('Finding 4');
    expect(writes[0]?.body).toContain('Finding 99');
    expect(writes[1]?.position).toMatchObject({ old_path: 'src/old.ts', new_path: 'src/shipping.ts', head_sha: head, new_line: 1 });
  });
  it('rejects stale findings before posting anything', async () => {
    const fake = vi.fn(async () => json({ ...mr, sha: 'd'.repeat(40), diff_refs: { ...mr.diff_refs, head_sha: 'd'.repeat(40) } }));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    await expect(api.publishFindings(2, head, 'summary', [])).rejects.toThrow('Stale evidence');
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('explicitly starts a missing MR pipeline and checks its exact SHA', async () => {
    const fake = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (options?.method === 'POST') return json({ id: 14, sha: head, web_url: 'https://gitlab.example/pipelines/14' });
      return json(String(input).includes('/pipelines?') ? [] : mr);
    });
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    expect(await api.ensureMergeRequestPipeline(2, head)).toMatchObject({ id: 14, sha: head });
    expect(fake).toHaveBeenCalledTimes(3);
  });
  it('binds read-only artifacts to the real project job and revision', async () => {
    const evidence = { source: 'gitlab', provenance: { projectId: '7', headSha: head, jobId: '13', pipelineId: '4' } };
    const fake = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/jobs/13')
      ? json({ id: 13, commit: { id: head }, pipeline: { id: 4, sha: head } }) : json(evidence));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    expect(await api.readEvidenceArtifact(13, head)).toEqual(evidence);
    evidence.provenance.projectId = '8';
    await expect(api.readEvidenceArtifact(13, head)).rejects.toThrow('provenance');
    evidence.provenance.projectId = '7';
    evidence.provenance.headSha = 'b'.repeat(40);
    await expect(api.readEvidenceArtifact(13, head)).rejects.toThrow('provenance');
  });
  it('rejects a stale artifact job before downloading its body', async () => {
    const fake = vi.fn(async () => json({ id: 13, commit: { id: 'b'.repeat(40) } }));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    await expect(api.readEvidenceArtifact(13, head)).rejects.toThrow('expected source revision');
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('reads actor identity from the actual GitLab note and rejects bot or system notes', async () => {
    const note = { id: 10, author: { id: 11, username: 'reviewer', bot: false }, body: '@flow apply proposal hash',
      created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z', system: false };
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: vi.fn(async (input: string | URL | Request) => json(String(input).endsWith('/users/11') ? { id: 11, bot: false, state: 'active', locked: false } : note)) });
    expect((await api.readMergeRequestNote(2, 10)).author.id).toBe(11);
    note.author.bot = true;
    await expect(api.readMergeRequestNote(2, 10)).rejects.toThrow('human approval');
    note.author.bot = false; note.system = true;
    await expect(api.readMergeRequestNote(2, 10)).rejects.toThrow('human approval');
  });
  it('never treats an omitted note bot flag as proof of a human author', async () => {
    const note = { id: 10, author: { id: 11, username: 'unknown-kind' }, body: '@flow apply proposal hash',
      created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z', system: false };
    const fake = vi.fn(async (input: string | URL | Request) => json(String(input).endsWith('/users/11')
      ? { id: 11, state: 'active', locked: false } : note));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    await expect(api.readMergeRequestNote(2, 10)).rejects.toThrow('human account');
    expect(fake.mock.calls[1]?.[0]).toBe('https://gitlab.example/api/v4/users/11');
  });
  it('refuses branch-pipeline creation if the recorded repair branch advanced', async () => {
    const fake = vi.fn(async () => json({ commit: { id: 'b'.repeat(40) } }));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    await expect(api.ensureBranchPipeline('mutant-review/repair', head)).rejects.toThrow('head changed');
    expect(fake).toHaveBeenCalledTimes(1);
  });
});

describe('bounded flow evidence discovery', () => {
  it('selects only a completed mutation job at the unique current MR checkout revision', async () => {
    const fake = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/merge_requests?')) return json([{ iid: 2, sha: head, state: 'opened' }, { iid: 3, sha: 'b'.repeat(40), state: 'opened' }]);
      if (url.endsWith('/merge_requests/2')) return json(mr);
      if (url.endsWith('/pipelines?per_page=5')) return json([{ id: 90, sha: 'b'.repeat(40) }, { id: 89, sha: head }]);
      return json([{ id: 13, name: 'mutation:review', status: 'success' }]);
    });
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    expect(await api.findEvidenceJobForHead(head)).toEqual({ mrIid: 2, jobId: 13 });
    expect(fake.mock.calls.some(([input]) => String(input).includes('/pipelines/90/jobs'))).toBe(false);
  });
  it('rejects ambiguous MRs rather than guessing from the goal text', async () => {
    const fake = vi.fn(async () => json([{ iid: 2, sha: head, state: 'opened' }, { iid: 3, sha: head, state: 'opened' }]));
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    await expect(api.findEvidenceJobForHead(head)).rejects.toThrow('unique open MR');
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('cannot hydrate from a manual or failed mutation job', async () => {
    const fake = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/merge_requests?')) return json([{ iid: 2, sha: head, state: 'opened' }]);
      if (url.endsWith('/merge_requests/2')) return json(mr);
      if (url.endsWith('/pipelines?per_page=5')) return json([{ id: 89, sha: head }]);
      return json([{ id: 13, name: 'mutation:review', status: 'manual' }, { id: 12, name: 'mutation:review', status: 'failed' }]);
    });
    const api = new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, fetch: fake });
    await expect(api.findEvidenceJobForHead(head)).rejects.toThrow('No completed mutation');
  });
});

describe('separately approved verified lessons', () => {
  const repairCommitSha = 'e'.repeat(40);
  const receiptHash = 'f'.repeat(64);
  const lesson = { id: 'inclusive-money-boundary', state: 'candidate', approval: null,
    recommendation: 'Derive below, at, and above expected values from the contract.',
    repairReceipt: { hash: receiptHash, repairCommitSha, status: 'passed' } };
  const raw = { id: 'lesson-proposal-1', projectId: 7, mergeRequestIid: 2, sourceHeadSha: head,
    runId: 'run-1', findingIds: ['gap-1'], repairCommitSha, verifiedReceiptHash: receiptHash,
    lessonPath: '.mutant-review/lessons/inclusive-money-boundary.json', lessonContent: JSON.stringify(lesson, null, 2) + '\n' };
  const lessonProposal: ExactLessonProposal = { ...raw, patchHash: exactLessonHash(raw) };
  const lessonApproval: ExactPatchApproval = { ...approval, action: 'learn', proposalId: lessonProposal.id, patchHash: lessonProposal.patchHash };
  function api() {
    const writes: Record<string, unknown>[] = [];
    const fake = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return json({ id: '9'.repeat(40), parent_ids: [repairCommitSha], web_url: 'https://gitlab.example/commit/9' }); }
      if (String(input).includes('/members/')) return json({ id: 11, access_level: 40, state: 'active' });
      if (String(input).includes('/repository/commits/')) return json({ id: repairCommitSha });
      return json(mr);
    });
    return { adapter: new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, token: 'server-only', fetch: fake }), writes };
  }
  it('preserves approved semantic content and derives audit fields from the actual approval', async () => {
    const { adapter, writes } = api();
    const result = await adapter.commitApprovedLesson(lessonProposal, lessonApproval, ledger(), now);
    expect(result.sourceBranchUpdated).toBe(false);
    expect(result.lesson).toMatchObject({ recommendation: lesson.recommendation, state: 'approved', status: 'approved',
      verified: true, approvedBy: '11', approvedAt: approval.approvedAt, approvedContentHash: lessonProposal.patchHash,
      approval: { actor: 11, noteEventId: 'note-1' } });
    expect(writes[0]).toMatchObject({ start_sha: repairCommitSha, actions: [{ action: 'create', file_path: raw.lessonPath }] });
  });
  it('rejects changed candidate content and unverified receipts', async () => {
    const { adapter, writes } = api();
    await expect(adapter.commitApprovedLesson({ ...lessonProposal, lessonContent: '{}' }, lessonApproval, ledger(), now)).rejects.toThrow('hash');
    const unverified = { ...raw, lessonContent: JSON.stringify({ ...lesson, repairReceipt: { hash: receiptHash, repairCommitSha, status: 'failed' } }) };
    const proposal = { ...unverified, patchHash: exactLessonHash(unverified) };
    await expect(adapter.commitApprovedLesson(proposal, { ...lessonApproval, patchHash: proposal.patchHash }, ledger(), now)).rejects.toThrow('verified candidate');
    expect(writes).toHaveLength(0);
  });
  it('rejects arbitrary lesson paths and previously claimed approval', async () => {
    const { adapter, writes } = api();
    const unsafe = { ...raw, lessonPath: '.gitlab-ci.yml' };
    await expect(adapter.commitApprovedLesson({ ...unsafe, patchHash: exactLessonHash(unsafe) }, lessonApproval, ledger(), now)).rejects.toThrow('scope');
    const preapproved = { ...raw, lessonContent: JSON.stringify({ ...lesson, state: 'approved', approval: { actor: 'AI' } }) };
    const proposal = { ...preapproved, patchHash: exactLessonHash(preapproved) };
    await expect(adapter.commitApprovedLesson(proposal, { ...lessonApproval, patchHash: proposal.patchHash }, ledger(), now)).rejects.toThrow('verified candidate');
    expect(writes).toHaveLength(0);
  });
});

describe('exact approved test commits', () => {
  function adapter(overrides: { memberLevel?: number; remoteHead?: string } = {}) {
    const writes: Record<string, unknown>[] = [];
    const fake = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return json({ id: 'e'.repeat(40), parent_ids: [head], web_url: 'https://gitlab.example/commit/e' }); }
      if (url.includes('/members/')) return json({ id: 11, access_level: overrides.memberLevel ?? 40, state: 'active' });
      if (url.includes('/raw?')) return new Response(file.before);
      const current = overrides.remoteHead ?? head;
      return json({ ...mr, sha: current, diff_refs: { ...mr.diff_refs, head_sha: current } });
    });
    return { api: new GitLabAdapter({ baseUrl: 'https://gitlab.example', projectId: 7, token: 'server-only', fetch: fake }), writes, fake };
  }
  it('binds every byte of the patch to the approval', async () => {
    const { api, writes } = adapter();
    await expect(api.commitApprovedTests({ ...proposal, files: [{ ...file, after: `${file.after}\n// changed` }] }, approval, [file.path], ledger(), now)).rejects.toThrow('hash');
    expect(writes).toHaveLength(0);
  });
  it.each([
    { patchHash: 'changed' }, { sourceHeadSha: 'b'.repeat(40) }, { proposalId: 'unknown' },
    { expiresAt: '2026-10-23T12:01:00Z' }, { findingIds: ['other'] }, { action: 'verify' as const },
  ])('rejects mismatched or expired approvals: %o', async (change) => {
    const { api, writes } = adapter();
    await expect(api.commitApprovedTests(proposal, { ...approval, ...change }, [file.path], ledger(), now)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
  it('rejects an actor whose current permission was revoked', async () => {
    const { api, writes } = adapter({ memberLevel: 30 });
    await expect(api.commitApprovedTests(proposal, approval, [file.path], ledger(), now)).rejects.toThrow('currently authorized');
    expect(writes).toHaveLength(0);
  });
  it('rejects a changed MR head', async () => {
    const { api, writes } = adapter({ remoteHead: 'd'.repeat(40) });
    await expect(api.commitApprovedTests(proposal, approval, [file.path], ledger(), now)).rejects.toThrow('Stale approval');
    expect(writes).toHaveLength(0);
  });
  it('rejects replayed approvals before a commit', async () => {
    const { api, writes } = adapter();
    const used = ledger(); used.reserve = vi.fn(async () => false);
    await expect(api.commitApprovedTests(proposal, approval, [file.path], used, now)).rejects.toThrow('already consumed');
    expect(writes).toHaveLength(0);
  });
  it('commits exactly approved tests at the exact parent on an isolated branch', async () => {
    const { api, writes } = adapter();
    const journal = ledger();
    const result = await api.commitApprovedTests(proposal, approval, [file.path], journal, now);
    expect(result.sourceBranchUpdated).toBe(false);
    expect(writes[0]).toMatchObject({ start_sha: head, branch: expect.stringMatching(new RegExp(`^mutant-review/${proposal.patchHash.slice(0, 20)}-[a-f0-9-]{36}$`)),
      actions: [{ action: 'update', file_path: file.path, content: file.after }] });
    expect(journal.record).toHaveBeenCalledWith('note-1', 'committed', 'e'.repeat(40));
  });
  it('rejects production paths, changed existing tests, and skipped assertions', () => {
    expect(() => validateTestChanges([{ ...file, path: 'src/shipping.ts' }], ['src/shipping.ts'])).toThrow('test file');
    expect(() => validateTestChanges([{ ...file, after: 'replaced everything' }], [file.path])).toThrow('preserve');
    expect(() => validateTestChanges([{ ...file, after: `${file.before}\nit.skip("x",()=>expect(1).toBe(1));` }], [file.path])).toThrow('unsafe');
  });
});
