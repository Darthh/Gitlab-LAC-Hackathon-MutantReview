import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readEvidenceCache, writeEvidenceCache, type EvidenceCachePayload } from './evidence-cache.js';

const now = new Date('2026-10-24T18:34:00.000Z');
const expected = { projectId: 88030103, mrIid: 1, jobId: 123, headSha: 'a'.repeat(40) };
const payload = (verifiedAt = now.toISOString()): EvidenceCachePayload => ({ schemaVersion: 1, source: 'authenticated-gitlab-artifact-cache',
  verifiedAt, ...expected, pipelineId: '456', evidence: { source: 'gitlab', measuredScore: 80, survivors: 1 } });
async function setup(value = payload()) {
  const directory = await mkdtemp(join(tmpdir(), 'mutant-review-evidence-cache-'));
  const keys = join(directory, 'keys');
  const written = await writeEvidenceCache(value, join(directory, 'cache.json'), keys);
  return { directory, keys, ...written };
}

describe('signed GitLab artifact cache', () => {
  it('concurrent first writers share one exclusively installed key pair without partial files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mutant-review-evidence-cache-'));
    const keys = join(directory, 'keys');
    const results = await Promise.all([1, 2, 3, 4].map(index => writeEvidenceCache(payload(), join(directory, `cache-${index}.json`), keys)));
    expect(new Set(results.map(result => result.publicKeyFile)).size).toBe(1);
    for (const result of results) await expect(readEvidenceCache(result.cacheFile, result.publicKeyFile, expected, now)).resolves.toHaveProperty('jobId', 123);
    expect(await readdir(keys)).toEqual(['artifact-signing-private.pem', 'artifact-signing-public.pem']);
  });
  it('uses real Ed25519 signatures and a public-key-only read path', async () => {
    const cache = await setup();
    const result = await readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, now);
    expect(result.evidence).toEqual(payload().evidence);
    expect(result.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(cache.publicKeyFile, 'utf8')).toContain('BEGIN PUBLIC KEY');
    expect(await readdir(cache.keys)).toEqual(['artifact-signing-private.pem', 'artifact-signing-public.pem']);
  });
  it('rejects tampered evidence without returning any payload', async () => {
    const cache = await setup();
    const envelope = JSON.parse(await readFile(cache.cacheFile, 'utf8'));
    envelope.payload.evidence.measuredScore = 100;
    await writeFile(cache.cacheFile, JSON.stringify(envelope));
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, now)).rejects.toThrow('signature');
  });
  it('rejects an invalid signature and a different verification key', async () => {
    const cache = await setup();
    const envelope = JSON.parse(await readFile(cache.cacheFile, 'utf8'));
    envelope.signature = Buffer.alloc(64).toString('base64');
    await writeFile(cache.cacheFile, JSON.stringify(envelope));
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, now)).rejects.toThrow('signature');
    const other = await setup();
    await expect(readEvidenceCache(other.cacheFile, cache.publicKeyFile, expected, now)).rejects.toThrow('signature');
  });
  it('checks the artifact digest even when the envelope has a valid signature', async () => {
    const cache = await setup();
    const envelope = JSON.parse(await readFile(cache.cacheFile, 'utf8'));
    envelope.payload.artifactDigest = 'f'.repeat(64);
    // This test owns its ephemeral signing key; no real credential is read or printed.
    const key = createPrivateKey(await readFile(join(cache.keys, 'artifact-signing-private.pem'), 'utf8'));
    envelope.signature = sign(null, Buffer.from(JSON.stringify(envelope.payload)), key).toString('base64');
    await writeFile(cache.cacheFile, JSON.stringify(envelope));
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, now)).rejects.toThrow('digest');
  });
  it.each([{ projectId: 2 }, { mrIid: 2 }, { jobId: 2 }, { headSha: 'b'.repeat(40) }])('rejects incorrect project/MR/job/revision binding %j', async change => {
    const cache = await setup();
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, { ...expected, ...change }, now)).rejects.toThrow('does not match');
  });
  it.each(['2026-10-23T18:33:59.999Z', '2026-10-24T18:35:00.001Z'])('rejects expired or more than sixty seconds future verification time %s', async time => {
    const cache = await setup(payload(time));
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, now)).rejects.toThrow('verification time');
  });
  it('accepts clock skew within sixty seconds and rejects invalid current time', async () => {
    const cache = await setup(payload('2026-10-24T18:35:00.000Z'));
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, now)).resolves.toHaveProperty('jobId', 123);
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, new Date('invalid'))).rejects.toThrow('verification time');
  });
  it('preserves existing keys and refuses to silently replace an inconsistent public key', async () => {
    const cache = await setup();
    const firstPrivate = await readFile(join(cache.keys, 'artifact-signing-private.pem'), 'utf8');
    await writeEvidenceCache(payload(), cache.cacheFile, cache.keys);
    expect(await readFile(join(cache.keys, 'artifact-signing-private.pem'), 'utf8')).toBe(firstPrivate);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await writeFile(cache.publicKeyFile, other);
    await expect(writeEvidenceCache(payload(), cache.cacheFile, cache.keys)).rejects.toThrow('does not match');
    expect(await readFile(cache.publicKeyFile, 'utf8')).toBe(other);
  });
  it('enforces the five-megabyte input and file-read budget', async () => {
    const cache = await setup();
    await expect(writeEvidenceCache({ ...payload(), evidence: 'x'.repeat(5_000_000) }, cache.cacheFile, cache.keys)).rejects.toThrow('5 MB');
    await writeFile(cache.cacheFile, 'x'.repeat(5_000_001));
    await expect(readEvidenceCache(cache.cacheFile, cache.publicKeyFile, expected, now)).rejects.toThrow('size limit');
  });
  it('refuses a cache output path that would overwrite a signing key', async () => {
    const cache = await setup();
    await expect(writeEvidenceCache(payload(), cache.publicKeyFile, cache.keys)).rejects.toThrow('cannot overwrite');
    if (process.platform === 'win32') await expect(writeEvidenceCache(payload(), cache.publicKeyFile.replace('artifact-signing-public.pem', 'ARTIFACT-SIGNING-PUBLIC.PEM'), cache.keys)).rejects.toThrow('cannot overwrite');
    await expect(writeEvidenceCache(payload(), cache.cacheFile, process.cwd())).rejects.toThrow('outside');
  });
});
