import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { GitLabAdapter } from '../../gitlab-adapter/src/index.js';
import { flowNotify } from './flow.js';

it('only skips notifications already posted by the authenticated CI account at this head', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mutant-review-notify-'));
  const previous = process.cwd();
  const head = 'a'.repeat(40);
  const marker = `<!-- mutant-review:notified ${head} -->`;
  let notes = [{ body: marker, system: false, author: { id: 99 } }];
  const publish = vi.fn(async () => []);
  const api = {
    currentMergeRequest: async () => ({ iid: 1, sha: head }),
    currentUserId: async () => 42,
    listMergeRequestNotes: async () => notes,
    publishFindings: publish,
  } as unknown as GitLabAdapter;
  try {
    await mkdir(join(directory, 'evidence'));
    await writeFile(join(directory, 'evidence/latest.json'), JSON.stringify({
      provenance: { headSha: head }, mutation: { score: 80, counts: { killed: 4, survived: 1, noCoverage: 0 } }, gate: { status: 'failed' },
      triage: { arid: [], overflow: 0, ranked: [{ rank: 1, fingerprint: 'f'.repeat(64), path: 'src/shipping.ts', line: 4, original: 'a >= b', replacement: 'a > b', why: 'A boundary is untested.' }] },
    }));
    process.chdir(directory);
    vi.stubEnv('CI_MERGE_REQUEST_IID', '1');
    vi.stubGlobal('fetch', () => { throw new Error('Network is disabled in this test'); });
    const notify = () => flowNotify(['--handle', '@ai-mutant-review'], async () => api);
    await notify();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]).toEqual([1, head, expect.stringContaining(marker), [expect.objectContaining({ path: 'src/shipping.ts', line: 4 })]]);
    notes = [{ body: marker, system: false, author: { id: 42 } }];
    await notify();
    expect(publish).toHaveBeenCalledTimes(1);
    notes = [{ body: marker.replace(head, 'b'.repeat(40)), system: false, author: { id: 42 } }];
    await notify();
    expect(publish).toHaveBeenCalledTimes(2);
    notes = [{ body: marker, system: true, author: { id: 42 } }];
    await notify();
    expect(publish).toHaveBeenCalledTimes(3);
    api.currentUserId = async () => { throw new Error('Identity lookup failed'); };
    await expect(notify()).rejects.toThrow('Identity lookup failed');
    expect(publish).toHaveBeenCalledTimes(3);
  } finally {
    process.chdir(previous);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  }
});
