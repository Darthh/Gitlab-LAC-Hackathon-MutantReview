// Runs real Vitest + Stryker against the demo shipping contract. Separate from `npm test`
// because it rewrites the demo test file in place while it verifies drafts.
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { normalizeStrykerReport } from '../../review-core/src/report.js';
import { triageMutants } from '../../review-core/src/triage.js';
import { git, runStryker } from './review.js';
import { encodePayload, flowApply, verifyDraft, type ProposalPayload, type RejectedProposal, type VerifiedProposal } from './flow.js';

const source = 'packages/demo-domain/src/shipping.ts';
const testPath = 'packages/demo-domain/src/shipping.test.ts';
const draft = (test: string) => ({ finding: 1, testPath, imports: [], test, expectedFrom: 'SHIPPING-001' });

describe('execution is the hallucination check', () => {
  it('keeps a draft that kills the mutant and rejects one that does not', async () => {
    const before = await readFile(testPath, 'utf8');
    const scope = [{ path: source, lines: [{ start: 4, end: 4 }], change: 'modified' as const }];
    const { report } = await runStryker([`${source}:4-4`], { incremental: false, name: 'e2e-baseline' });
    const triage = triageMutants(normalizeStrykerReport(report as never, scope), { [source]: await readFile(source, 'utf8') });
    const finding = triage.ranked[0]!;
    expect(finding.replacement).toBe('subtotalCents > 10_000');

    const kept = await verifyDraft(draft("it('ships free at exactly $100 (SHIPPING-001)', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});"), finding, 1);
    expect(kept).not.toHaveProperty('reason');

    // Plausible-looking, green, and useless: 10_001 behaves the same under `>` and `>=`.
    const hallucinated = await verifyDraft(draft("it('ships free for big orders', () => {\n  expect(shippingFee(10_001)).toBe(0);\n});"), finding, 2);
    expect(hallucinated).toMatchObject({ reason: expect.stringContaining('passes on the mutant too') });

    const wrong = await verifyDraft(draft("it('charges at exactly $100', () => {\n  expect(shippingFee(10_000)).toBe(500);\n});"), finding, 3);
    expect(wrong).toMatchObject({ reason: expect.stringContaining('fails or does not run') });

    expect(await readFile(testPath, 'utf8')).toBe(before);

    // Human replies "apply 1": commit exactly the verified test, ledger, lesson and AGENTS.md.
    const head = git('rev-parse', 'HEAD');
    const payload: ProposalPayload = { version: 1, mrIid: 1, headSha: head, runId: 'run-e2e', score: 80, ranges: [`${source}:4-4`],
      proposals: [kept as VerifiedProposal], rejected: [hallucinated as RejectedProposal], equivalent: [] };
    const command = { id: 11, body: '@ai-mutant-review apply 1', system: false, created_at: '2026-10-24T12:00:00.000Z', author: { id: 9, username: 'reviewer' } };
    const posted = { id: 10, body: `summary\n${encodePayload(payload)}`, system: false, created_at: '2026-10-24T11:00:00.000Z', author: { id: 2, username: 'ai-mutant-review' } };
    const replies: string[] = [];
    let committed: { path: string; content: string }[] = [];
    const adapter = {
      listMergeRequestNotes: async () => [command, posted],
      accountKind: async () => 'human',
      currentMember: async (id: number) => ({ id, access_level: 30, state: 'active' }),
      createMergeRequestNote: async (_iid: number, body: string) => { replies.push(body); return { id: 99 }; },
      commitToMergeRequest: async (_iid: number, expected: string, files: { path: string; content: string }[]) => { expect(expected).toBe(head); committed = files; return { id: 'c'.repeat(40), web_url: 'https://gitlab.com/g/p/-/commit/c' }; },
    } as never;
    try {
      const result = await flowApply(adapter, { iid: 1, sha: head, web_url: 'https://gitlab.com/g/p/-/merge_requests/1' } as never, '@ai-mutant-review', command, [1]);
      expect(result).toBe(`Committed ${'c'.repeat(40)}.`);
    } finally {
      await writeFile(testPath, before);
    }
    const file = (path: string) => committed.find((item) => item.path === path)?.content ?? '';
    expect(file(testPath)).toContain('expect(shippingFee(10_000)).toBe(0);');
    const ledger = JSON.parse(file('.mutant-review/ledger.json'));
    expect(ledger.entries.map((entry: { kind: string }) => entry.kind)).toEqual(['repaired', 'rejected-proposal']);
    expect(ledger.entries[0]).toMatchObject({ actor: 'reviewer', scoreBefore: 80, scoreAfter: 100, lessonId: 'lesson-boundary' });
    expect(JSON.parse(file('.mutant-review/lessons/lesson-boundary.json'))).toMatchObject({ repository: 'g/p', approvedBy: 'reviewer' });
    expect(file('AGENTS.md')).toContain('**Untested boundary value.**');
    expect(replies.at(-1)).toContain('**80% → 100%**');
  }, 240_000);
});
