import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile, rename } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { ApprovalLedger } from './index.js';

/**
 * Single-host durable reservation journal. Supply a trusted absolute directory outside
 * the checkout. A production multi-host flow needs a shared atomic reservation store.
 */
export class FileApprovalLedger implements ApprovalLedger {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Approval journal must use an absolute trusted directory');
  }
  private file(eventId: string) {
    if (!eventId || eventId.length > 200) throw new Error('Invalid approval event identifier');
    return join(this.directory, `${createHash('sha256').update(eventId).digest('hex')}.json`);
  }
  async reserve(eventId: string): Promise<boolean> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const file = await open(this.file(eventId), 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ eventId, state: 'reserved', reservedAt: new Date().toISOString() })); }
      finally { await file.close(); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }
  async record(eventId: string, outcome: 'committed' | 'rejected', commitSha?: string): Promise<void> {
    const file = this.file(eventId);
    const existing = JSON.parse(await readFile(file, 'utf8'));
    if (existing.eventId !== eventId || existing.state !== 'reserved') throw new Error('Approval reservation is absent or finalized');
    const temporary = `${file}.pending`;
    await writeFile(temporary, JSON.stringify({ ...existing, state: outcome, commitSha: commitSha ?? null,
      finalizedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  }
}
