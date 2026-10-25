import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { validateEvidence } from '../../../apps/front-desk/server/evidence-validation.js';
import { executionEnvironment } from './runner.js';

it('replaces stale evidence with a distinct public failure record while keeping details in the log', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mutant-review-failure-'));
  try {
    await mkdir(join(directory, 'evidence'));
    await writeFile(join(directory, 'evidence/latest.json'), JSON.stringify({ runId: 'stale-run', triage: { ranked: ['old'] }, internalCredential: 'private-fixture-value' }));
    const run = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('packages/cli/src/index.ts'), 'review'], {
      cwd: directory, env: executionEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
    expect(run.status).toBe(2);
    const failure = JSON.parse(await readFile(join(directory, 'evidence/latest.json'), 'utf8'));
    expect(failure).toEqual({ schemaVersion: 1, kind: 'review-error', status: 'inconclusive', createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/), log: 'evidence/error.json' });
    expect(() => validateEvidence(failure)).toThrow('the last review did not complete. Check evidence/error.json on the server');
    const log = JSON.parse(await readFile(join(directory, 'evidence/error.json'), 'utf8'));
    expect(log.message).toBe('MR review requires CI_COMMIT_SHA, CI_MERGE_REQUEST_DIFF_BASE_SHA, CI_MERGE_REQUEST_IID, and CI_PROJECT_ID. Use demo for an explicitly local fixture.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
