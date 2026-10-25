// Real git, Vitest and Stryker in scratch repositories (the demo domain, one commit for the target branch and one for
// the MR): a test-only MR that loosens an assertion is blocked and names the test that used to catch the change, a
// refactor that keeps every assertion passes, and deleting the tests loses everything they guarded.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkProtection, scratchRepository, type ScratchRepository } from './protection.js';
import { runReview } from './review.js';

const testPath = 'packages/demo-domain/src/shipping.test.ts';
const source = 'packages/demo-domain/src/shipping.ts';
const budget = { files: 5, runtimeMs: 180_000 };

async function inside<T>(repo: ScratchRepository, work: () => Promise<T>): Promise<T> {
  const home = process.cwd();
  process.chdir(repo.dir);
  try { return await work(); } finally { process.chdir(home); await repo.cleanup(); }
}
const mrReview = (repo: ScratchRepository) => runReview({ mode: 'ci', headSha: repo.head, baseSha: repo.base, projectId: '1', mrIid: 2, pipelineId: null, jobId: null, pipelineUrl: null, projectUrl: null, output: 'evidence/latest.json' });

describe('lost protection, end to end', () => {
  it('blocks a test-only MR that loosens an assertion, and names the test that used to catch the change', async () => {
    const base = await readFile(testPath, 'utf8');
    const head = base.replace('expect(shippingFee(10_001)).toBe(0);', 'expect(shippingFee(10_001)).toBeLessThanOrEqual(500);');
    expect(head).not.toBe(base);
    const repo = await scratchRepository([{ path: testPath, base, head }], 'test: make the shipping test robust to fee changes');
    const { evidence } = await inside(repo, () => mrReview(repo));

    // Before this check, the gate had nothing to mutate here: a warning, never a block.
    expect(evidence.scope.files).toEqual([]);
    expect(evidence.baseline.status).toBe('passed');
    expect(evidence.protection).toMatchObject({ status: 'lost', testsInRun: [testPath], subjects: [source], baseMutants: 5, guarded: 4, rechecked: 4, held: 3, unknown: 0 });
    const lost = evidence.protection!.lost[0]!;
    expect(lost).toMatchObject({ path: source, line: 4, operator: 'ConditionalExpression', original: 'subtotalCents >= 10_000', replacement: 'false', status: 'Survived' });
    expect(lost.caughtBy[0]).toMatchObject({ name: 'shipping fee ships for free above the threshold', file: testPath, fate: 'weakened' });
    expect(lost.testDiff!.lines.filter((line) => line.kind !== ' ').map((line) => `${line.kind}${line.text.trim()}`)).toEqual([
      '-expect(shippingFee(10_001)).toBe(0);', '+expect(shippingFee(10_001)).toBeLessThanOrEqual(500);']);
    expect(evidence.gate).toEqual({ status: 'failed', reasons: [expect.stringContaining('lost protection')] });
    // The flow drafts a restoring test for it like any other finding, ranked first.
    expect(evidence.triage.ranked[0]).toMatchObject({ rank: 1, origin: 'lost-protection', path: source, line: 4, replacement: 'false' });
    expect(evidence.footprint!.steps!.map((step) => step.step)).toContain('Lost-protection check: Stryker on the target branch (code the changed tests import)');
  });

  it('passes a test-only MR that renames and reorders tests but keeps every assertion', async () => {
    const base = await readFile(testPath, 'utf8');
    const head = [
      "import { describe, expect, it } from 'vitest';",
      "import { shippingFee } from './shipping.js';",
      '',
      "describe('shippingFee (SHIPPING-001)', () => {",
      "  it('is free just above $100', () => {",
      '    expect(shippingFee(10_001)).toBe(0);',
      '  });',
      "  it('costs $5 just below $100', () => {",
      '    expect(shippingFee(9_999)).toBe(500);',
      '  });',
      '});',
      '',
    ].join('\n');
    const repo = await scratchRepository([{ path: testPath, base, head }], 'test: tidy shipping test names');
    const { evidence } = await inside(repo, () => mrReview(repo));
    expect(evidence.protection).toMatchObject({ status: 'held', guarded: 4, rechecked: 4, held: 4, lost: [] });
    expect(evidence.gate.status).toBe('passed');
  });

  it('follows a moved source file instead of losing sight of what its tests guarded', async () => {
    const base = await readFile(testPath, 'utf8');
    const code = await readFile(source, 'utf8');
    const moved = 'packages/demo-domain/src/shipping-fee.ts';
    const head = base.replace("from './shipping.js'", "from './shipping-fee.js'").replace('expect(shippingFee(10_001)).toBe(0);', 'expect(shippingFee(10_001)).toBeLessThanOrEqual(500);');
    const repo = await scratchRepository([{ path: source, base: code, head: null }, { path: moved, base: null, head: code }, { path: testPath, base, head }], 'refactor: rename the shipping module');
    const { result } = await inside(repo, () => checkProtection({ base: repo.base, head: repo.head, budget }));
    expect(result).toMatchObject({ status: 'lost', subjects: [source], guarded: 4, onChangedLines: 0, rechecked: 4 });
    expect(result.lost[0]).toMatchObject({ path: moved, line: 4, replacement: 'false' });
  });

  it('reports every guarded change as lost when the tests are deleted', async () => {
    const base = await readFile(testPath, 'utf8');
    const repo = await scratchRepository([{ path: testPath, base, head: null }], 'test: remove flaky shipping tests');
    const { result } = await inside(repo, () => checkProtection({ base: repo.base, head: repo.head, budget }));
    expect(result).toMatchObject({ status: 'lost', changedTests: [{ path: testPath, change: 'deleted', headPath: null }], guarded: 4 });
    expect(result.lost).toHaveLength(4);
    expect(result.lost.every((item) => item.status === 'NoCoverage' && item.caughtBy.every((test) => test.fate === 'removed'))).toBe(true);
  });
});

