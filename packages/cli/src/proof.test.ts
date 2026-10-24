import { describe, expect, it } from 'vitest';
import { digest, proposedAssertion, renderPatch, testPath, validateFixtureProposal } from './proof.js';

function proposal() {
  const originalTest = "import { it, expect } from 'vitest';\n";
  const repairedTest = originalTest + proposedAssertion;
  const patch = renderPatch(originalTest);
  return { patch, patchHash: digest(patch), originalTest, originalTestHash: digest(originalTest), repairedTest, repairedTestHash: digest(repairedTest), testPath };
}

describe('fixture patch binding', () => {
  it('accepts only the concrete additive assertion derived from the shipping contract', () => {
    expect(() => validateFixtureProposal(proposal())).not.toThrow();
  });
  it('rejects changed execution content even when the displayed patch hash is unchanged', () => {
    const value = proposal();
    value.repairedTest = value.repairedTest.replace('toBe(0)', 'toBe(500)');
    value.repairedTestHash = digest(value.repairedTest);
    expect(() => validateFixtureProposal(value)).toThrow('exact, additive');
  });
  it('rejects a patch changed after approval', () => {
    const value = proposal();
    value.patch += '+it.skip("ignore", () => {});\n';
    expect(() => validateFixtureProposal(value)).toThrow();
  });
  it('rejects attempts to target production code', () => {
    expect(() => validateFixtureProposal({ ...proposal(), testPath: 'packages/demo-domain/src/shipping.ts' })).toThrow();
  });
});
