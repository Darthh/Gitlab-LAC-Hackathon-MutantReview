import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLedger, validateLedger } from './ledger-validation.js';

// Synthetic parser inputs live only in this test. They are never served as recorded history.
const repaired = {
  id: 'repair-1', kind: 'repaired', recordedAt: '2026-10-24T03:53:42.759Z', mergeRequestIid: 3, headSha: 'a'.repeat(40),
  mutant: { path: 'packages/demo-domain/src/shipping.ts', line: 4, operator: 'EqualityOperator', original: 'subtotalCents >= 10_000', replacement: 'subtotalCents > 10_000' },
  test: { path: 'packages/demo-domain/src/shipping.test.ts', name: 'ships for free at exactly $100 (SHIPPING-001)' },
  scoreBefore: 80, scoreAfter: 100, actor: 'maintainer', reason: 'Kills the >= to > boundary mutant.', lessonId: 'inclusive-boundary',
};
const ledger = () => ({ schemaVersion: 1, entries: [structuredClone(repaired), { ...structuredClone(repaired), id: 'reject-1', kind: 'rejected-proposal', test: null, scoreAfter: null, actor: null, lessonId: null, reason: 'Draft passed on the mutant.' }, { ...structuredClone(repaired), id: 'override-1', kind: 'override', mutant: null, test: null, scoreBefore: null, scoreAfter: null, mergeRequestIid: null, reason: 'Equivalent mutant.' }] });
const file = (content: string) => { const path = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'ledger.json'); writeFileSync(path, content); return path; };

describe('repair ledger', () => {
  it('accepts every entry kind and strips unrecognized fields', () => {
    const result = validateLedger({ ...ledger(), token: 'never-return-this' });
    expect(result.entries.map(entry => entry.kind)).toEqual(['repaired', 'rejected-proposal', 'override']);
    expect(result).not.toHaveProperty('token');
  });
  it('treats an absent ledger as no recorded history', async () => {
    expect(await readLedger(join(tmpdir(), 'absent-ledger-dir', 'ledger.json'))).toEqual({ entries: [] });
  });
  it('reads a valid file and rejects malformed JSON or an oversized file with a clear message', async () => {
    expect((await readLedger(file(JSON.stringify(ledger())))).entries).toHaveLength(3);
    await expect(readLedger(file('{ not json'))).rejects.toThrow('Ledger rejected: .mutant-review/ledger.json is not valid JSON.');
    await expect(readLedger(file(JSON.stringify(ledger())), 100)).rejects.toThrow('Ledger exceeds');
  });
  it.each([
    ['unsafe test path', (value: any) => { value.entries[0].test.path = '../secrets.ts'; }],
    ['absolute mutant path', (value: any) => { value.entries[0].mutant.path = '/etc/passwd'; }],
    ['non-ISO date', (value: any) => { value.entries[0].recordedAt = 'yesterday'; }],
    ['short head SHA', (value: any) => { value.entries[0].headSha = 'abc123'; }],
    ['score above 100', (value: any) => { value.entries[0].scoreAfter = 140; }],
    ['negative line', (value: any) => { value.entries[0].mutant.line = -1; }],
    ['unknown kind', (value: any) => { value.entries[0].kind = 'deleted'; }],
    ['duplicate id', (value: any) => { value.entries[1].id = value.entries[0].id; }],
    ['wrong schema version', (value: any) => { value.schemaVersion = 2; }],
  ])('rejects %s', (_name, mutate) => {
    const value = ledger(); mutate(value);
    expect(() => validateLedger(value)).toThrow('Ledger rejected');
  });
  it('rejects more entries than the bounded history', () => {
    const value = ledger(); value.entries = Array.from({ length: 1001 }, (_, index) => ({ ...structuredClone(repaired), id: `repair-${index}` }));
    expect(() => validateLedger(value)).toThrow('Ledger rejected: entries');
  });
});
