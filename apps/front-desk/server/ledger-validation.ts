import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { label, repositoryPath as path, text } from './evidence-validation.js';

const score = z.number().finite().min(0).max(100).nullable();
const entry = z.object({
  id: label,
  kind: z.enum(['repaired', 'rejected-proposal', 'override']),
  recordedAt: z.iso.datetime(),
  mergeRequestIid: z.number().int().positive().nullable(),
  headSha: z.string().regex(/^[a-f0-9]{40}$/i),
  mutant: z.object({ path, line: z.number().int().positive(), operator: label, original: text, replacement: text }).nullable(),
  test: z.object({ path, name: label }).nullable(),
  scoreBefore: score,
  scoreAfter: score,
  actor: z.string().regex(/^@?[A-Za-z0-9_.-]{1,255}$/).nullable(),
  reason: z.string().min(1).max(5000),
  lessonId: label.nullable(),
});
const ledgerSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(entry).max(1000) });
export type LedgerEntry = z.infer<typeof entry>;

/** Committed approval history; unknown fields are stripped before it reaches the browser. */
export function validateLedger(input: unknown): { entries: LedgerEntry[] } {
  const parsed = ledgerSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`Ledger rejected: ${issue.path.join('.') || 'file'}: ${issue.message}`);
  }
  if (new Set(parsed.data.entries.map(item => item.id)).size !== parsed.data.entries.length) throw new Error('Ledger rejected: duplicate entry ids');
  return { entries: parsed.data.entries };
}

/** An absent ledger means nothing has been approved yet; it is not an error. */
export async function readLedger(file: string, maximumBytes = 1_000_000): Promise<{ entries: LedgerEntry[] }> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] };
    throw error;
  }
  if (size > maximumBytes) throw new Error('Ledger exceeds the 1 MB limit.');
  const raw = await readFile(file, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > maximumBytes) throw new Error('Ledger exceeds the 1 MB limit.');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('Ledger rejected: .mutant-review/ledger.json is not valid JSON.');
  }
  return validateLedger(input);
}
