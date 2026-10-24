// Runs real Vitest + Stryker against the demo shipping contract. Separate from `npm test`
// because it rewrites the demo test file in place while it verifies drafts.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { normalizeStrykerReport } from '../../review-core/src/report.js';
import { triageMutants } from '../../review-core/src/triage.js';
import { runStryker } from './review.js';
import { verifyDraft } from './flow.js';

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
  }, 240_000);
});
