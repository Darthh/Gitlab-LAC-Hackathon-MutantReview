import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exactPatchHash, type GitLabAdapter, type ExactPatchProposal } from '../../gitlab-adapter/src/index.js';
import { verifyCommittedFixture } from './committed-proof.js';
import { proposedAssertion } from './proof.js';

async function fixture(feature: 'shipping' | 'discount') {
  const paths = ['shipping.ts', 'shipping.test.ts', 'discount.ts', 'discount.test.ts'];
  const originals = Object.fromEntries(await Promise.all(paths.map(async (path) => [`packages/demo-domain/src/${path}`, await readFile(`packages/demo-domain/src/${path}`, 'utf8')] as const)));
  const path = `packages/demo-domain/src/${feature}.test.ts`;
  const assertion = feature === 'shipping' ? proposedAssertion : "\nit('includes exactly $200 (DISCOUNT-001)', () => {\n  expect(loyaltyDiscount(20_000)).toBe(1_000);\n});\n";
  const body = { id: `proposal-${feature}`, projectId: 1, mergeRequestIid: 1, sourceHeadSha: 'a'.repeat(40), runId: 'test-run', findingIds: ['test-finding'], files: [{ path, before: originals[path]!, after: originals[path]! + assertion }] };
  const proposal: ExactPatchProposal = { ...body, patchHash: exactPatchHash(body) };
  const adapter = { readRepositoryFile: async (requested: string, ref: string) => {
    if (ref !== proposal.sourceHeadSha && ref !== 'b'.repeat(40)) throw new Error('Unknown mock revision');
    if (ref === 'b'.repeat(40) && requested === path) return proposal.files[0]!.after;
    if (!(requested in originals)) throw new Error('Unknown fixture file');
    return originals[requested]!;
  } } as unknown as GitLabAdapter;
  return { adapter, proposal };
}

describe('fresh execution of approved immutable commit contents (mock GitLab transport)', () => {
  it('proves the shipping boundary repair twice with assertion failures against the exact mutant', async () => {
    const { adapter, proposal } = await fixture('shipping');
    const directory = await mkdtemp(join(tmpdir(), 'mutant-review-committed-shipping-test-'));
    const result = await verifyCommittedFixture(adapter, proposal, 'b'.repeat(40), directory);
    expect(result.status).toBe('passed');
    expect(result.cleanRerun).toBe(true);
    expect(result.runs).toHaveLength(2);
    expect(result.runs.every((run) => run.original.exitCode === 0 && run.mutant.exitCode === 1 && run.assertionKilled)).toBe(true);
  }, 30_000);
  it('derives the second feature result from its own $200 contract', async () => {
    const { adapter, proposal } = await fixture('discount');
    const directory = await mkdtemp(join(tmpdir(), 'mutant-review-committed-discount-test-'));
    const result = await verifyCommittedFixture(adapter, proposal, 'b'.repeat(40), directory);
    expect(result.status).toBe('passed');
    expect(result.exactMutation.contract).toBe('DISCOUNT-001');
    expect(result.exactMutation.message).toBe('expected +0 to be 1000');
  }, 30_000);
  it('rejects a commit whose actual test differs from the approved exact contents', async () => {
    const { proposal } = await fixture('shipping');
    const adapter = { readRepositoryFile: async () => 'different source\n' } as unknown as GitLabAdapter;
    await expect(verifyCommittedFixture(adapter, proposal, 'b'.repeat(40), 'unused')).rejects.toThrow('differ');
  });
});
