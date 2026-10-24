import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const MAX_BYTES = 5_000_000;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const payloadSchema = z.object({ schemaVersion: z.literal(1), source: z.literal('authenticated-gitlab-artifact-cache'),
  verifiedAt: z.iso.datetime(), projectId: id, mrIid: id, jobId: id, headSha: sha,
  pipelineId: z.string().regex(/^[1-9]\d*$/), evidence: z.unknown() }).strict();
const signedPayloadSchema = payloadSchema.extend({ artifactDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export type EvidenceCachePayload = z.infer<typeof payloadSchema>;
export type SignedEvidenceCachePayload = z.infer<typeof signedPayloadSchema>;
export interface EvidenceCacheExpectations { projectId: number; mrIid: number; jobId: number; headSha: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function boundedRead(filename: string, limit: number): Promise<string> {
  if (!(await lstat(filename)).isFile()) throw new Error('Evidence cache paths must be regular files');
  const file = await open(filename, 'r');
  try {
    if ((await file.stat()).size > limit) throw new Error('Evidence cache file exceeds its size limit');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new Error('Evidence cache file exceeds its size limit');
    return buffer.subarray(0, length).toString('utf8');
  } finally { await file.close(); }
}

/** Exclusive key installation uses a hard link so readers never observe a partial key. */
async function atomicWrite(filename: string, contents: string, exclusive = false): Promise<boolean> {
  if (Buffer.byteLength(contents, 'utf8') > MAX_BYTES) throw new Error('Evidence cache exceeds the 5 MB limit');
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(contents, 'utf8'); await file.sync(); } finally { await file.close(); }
    if (exclusive) await link(temporary, filename);
    else await rename(temporary, filename);
    return true;
  } catch (error) {
    if (exclusive && (error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

async function signingKeys(directory: string) {
  if (!isAbsolute(directory)) throw new Error('Signing keys require an absolute trusted directory outside the checkout');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const location = await realpath(directory), checkout = await realpath(process.cwd());
  const relation = relative(checkout, location);
  if (!relation || relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)) throw new Error('Signing keys must stay outside the checkout');
  const privateKeyFile = join(location, 'artifact-signing-private.pem');
  const publicKeyFile = join(location, 'artifact-signing-public.pem');
  try { await lstat(privateKeyFile); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const key = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await atomicWrite(privateKeyFile, key, true);
  }
  const privateKey = createPrivateKey(await boundedRead(privateKeyFile, 16_384));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Evidence cache signing key must be Ed25519');
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  await atomicWrite(publicKeyFile, publicPem, true);
  if (await boundedRead(publicKeyFile, 16_384) !== publicPem) throw new Error('Existing evidence verification key does not match the signing key');
  return { privateKey, publicKeyFile };
}

/** Caller obtains the evidence through authenticated GitLab provenance checks before signing. */
export async function writeEvidenceCache(input: EvidenceCachePayload, outputFile: string, keyDirectory: string) {
  const parsed = payloadSchema.parse(input);
  const evidenceJson = JSON.stringify(parsed.evidence);
  if (evidenceJson === undefined) throw new Error('Evidence cache requires JSON evidence');
  const payload: SignedEvidenceCachePayload = { ...parsed, evidence: JSON.parse(evidenceJson), artifactDigest: digest(evidenceJson) };
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') + 256 > MAX_BYTES) throw new Error('Evidence cache exceeds the 5 MB limit');
  const { privateKey, publicKeyFile } = await signingKeys(keyDirectory);
  const signature = sign(null, Buffer.from(serialized), privateKey).toString('base64');
  const output = resolve(outputFile);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const cacheFile = join(await realpath(dirname(output)), basename(output));
  const comparable = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  if ([publicKeyFile, join(dirname(publicKeyFile), 'artifact-signing-private.pem')].some(key => comparable(key) === comparable(cacheFile))) throw new Error('Evidence cache cannot overwrite its signing keys');
  await atomicWrite(cacheFile, JSON.stringify({ payload, signature }) + '\n');
  return { cacheFile, publicKeyFile, verifiedAt: payload.verifiedAt };
}

/** Public-key-only reader. Every binding and age check fails closed before evidence is returned. */
export async function readEvidenceCache(cacheFile: string, publicKeyFile: string, expected: EvidenceCacheExpectations, now = new Date()): Promise<SignedEvidenceCachePayload> {
  const envelope = z.object({ payload: z.unknown(), signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().parse(JSON.parse(await boundedRead(cacheFile, MAX_BYTES)));
  const signature = Buffer.from(envelope.signature, 'base64');
  const publicKey = createPublicKey(await boundedRead(publicKeyFile, 16_384));
  if (publicKey.asymmetricKeyType !== 'ed25519' || signature.length !== 64 || signature.toString('base64') !== envelope.signature || !verify(null, Buffer.from(JSON.stringify(envelope.payload)), publicKey, signature)) throw new Error('Evidence cache signature is invalid');
  const payload = signedPayloadSchema.parse(envelope.payload);
  if (digest(JSON.stringify(payload.evidence)) !== payload.artifactDigest) throw new Error('Evidence cache artifact digest is invalid');
  for (const key of ['projectId', 'mrIid', 'jobId', 'headSha'] as const) {
    if (payload[key] !== expected[key]) throw new Error(`Evidence cache ${key} does not match the requested revision`);
  }
  const age = now.getTime() - Date.parse(payload.verifiedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 24 * 60 * 60 * 1000) throw new Error('Evidence cache verification time is expired or in the future');
  return payload;
}
