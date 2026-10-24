import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileApprovalLedger } from './ledger.js';

describe('durable approval reservation', () => {
  it('allows exactly one concurrent consumer and rejects replay across instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mutant-review-ledger-'));
    try {
      const first = new FileApprovalLedger(directory);
      const second = new FileApprovalLedger(directory);
      const results = await Promise.all([first.reserve('note/123'), second.reserve('note/123')]);
      expect(results.filter(Boolean)).toHaveLength(1);
      await first.record('note/123', 'committed', 'a'.repeat(40));
      expect(await second.reserve('note/123')).toBe(false);
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      expect(JSON.parse(await readFile(join(directory, files[0]!), 'utf8'))).toMatchObject({ state: 'committed', commitSha: 'a'.repeat(40) });
      await expect(second.record('note/123', 'rejected')).rejects.toThrow('finalized');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('requires a trusted absolute storage location', () => {
    expect(() => new FileApprovalLedger('.mutant-review/approvals')).toThrow('absolute');
  });
});
