import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { execute } from './runner.js';

it('rejects when the execution log cannot be written instead of leaving the run pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mutant-review-log-'));
  try {
    // The child succeeds, but a directory cannot be used as its log file.
    await expect(execute(['--version'], directory)).rejects.toMatchObject({ code: 'EISDIR' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 2000);
