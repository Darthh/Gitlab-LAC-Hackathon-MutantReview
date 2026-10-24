import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execute } from './runner.js';

export const testPath = 'packages/demo-domain/src/shipping.test.ts';
export const proposedAssertion = "\nit('ships for free at exactly $100 (SHIPPING-001)', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});\n";
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function renderPatch(originalTest: string): string {
  const lines = originalTest.trimEnd().split('\n').length;
  return `--- a/${testPath}\n+++ b/${testPath}\n@@ -${lines},0 +${lines + 1},4 @@\n+\n+it('ships for free at exactly $100 (SHIPPING-001)', () => {\n+  expect(shippingFee(10_000)).toBe(0);\n+});\n`;
}

export function validateFixtureProposal(proposal: { patch: string; patchHash: string; testPath: string; originalTest: string; repairedTest: string; repairedTestHash: string; originalTestHash: string }) {
  if (proposal.testPath !== testPath || proposal.patch !== renderPatch(proposal.originalTest) || digest(proposal.patch) !== proposal.patchHash || digest(proposal.originalTest) !== proposal.originalTestHash || digest(proposal.repairedTest) !== proposal.repairedTestHash || proposal.repairedTest !== proposal.originalTest + proposedAssertion) {
    throw new Error('Proposal content does not match the exact, additive fixture patch');
  }
}

export async function makeProposal() {
  const originalTest = await readFile(testPath, 'utf8');
  const source = await readFile('packages/demo-domain/src/shipping.ts', 'utf8');
  const repaired = originalTest + proposedAssertion;
  const patch = renderPatch(originalTest);
  const proposal = {
    id: `proposal-${digest(repaired).slice(0, 12)}`,
    patch,
    patchHash: digest(patch),
    originalTestHash: digest(originalTest),
    repairedTestHash: digest(repaired),
    sourceHash: digest(source),
    testPath,
    originalTest,
    repairedTest: repaired,
    approvalStatus: 'awaiting approval',
    generatedBy: 'deterministic demonstration fixture; not GitLab Duo',
  };
  await mkdir('.mutant-review/proposals', { recursive: true });
  await writeFile('.mutant-review/proposals/shipping.json', JSON.stringify(proposal, null, 2) + '\n');
  return proposal;
}

/** A sandbox proves the patch without applying or approving it in the repository. */
export async function verifySandbox(proposal: Awaited<ReturnType<typeof makeProposal>>) {
  validateFixtureProposal(proposal);
  const currentTest = await readFile(testPath, 'utf8');
  const source = await readFile('packages/demo-domain/src/shipping.ts', 'utf8');
  if (digest(currentTest) !== proposal.originalTestHash || digest(source) !== proposal.sourceHash) {
    throw new Error('Proposal is stale: source or test content changed');
  }
  await mkdir('.mutant-review/work', { recursive: true });
  const work = await mkdtemp(resolve('.mutant-review/work/shipping-'));
  const rel = relative(process.cwd(), work).replaceAll('\\', '/');
  const config = `${rel}/vitest.proof.config.mjs`;
  await writeFile(config, `export default ${JSON.stringify({ test: { include: [`${rel}/shipping.test.ts`, 'packages/demo-domain/src/discount.test.ts'], exclude: [], pool: 'forks', maxWorkers: 1, minWorkers: 1 } })};\n`);
  // The temporary fixture imports Vitest from the pinned project dependency.
  const test = proposal.repairedTest.replace("'./shipping.js'", "'./shipping.ts'");
  await writeFile(`${work}/shipping.test.ts`, test);
  const mutant = source.replace('subtotalCents >= 10_000', 'subtotalCents > 10_000');
  if (source === mutant) throw new Error('Exact targeted mutation was not found');
  const runs = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    await writeFile(`${work}/shipping.ts`, source);
    const original = await execute(['node_modules/vitest/vitest.mjs', 'run', '--config', config, '--reporter=json', `--outputFile=evidence/verification/original-${attempt}.json`], `evidence/verification/original-${attempt}.log`);
    await writeFile(`${work}/shipping.ts`, mutant);
    const changed = await execute(['node_modules/vitest/vitest.mjs', 'run', '--config', config, '--reporter=json', `--outputFile=evidence/verification/mutant-${attempt}.json`], `evidence/verification/mutant-${attempt}.log`);
    const report = JSON.parse(await readFile(`evidence/verification/mutant-${attempt}.json`, 'utf8'));
    const assertions = (report.testResults as { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[]).flatMap((suite) => suite.assertionResults);
    const failedBoundary = assertions.find((assertion) => assertion.title.includes('at exactly $100') && assertion.status === 'failed' && assertion.failureMessages.some((message) => message.includes('expected 500 to be +0')));
    const otherTestsPass = assertions.filter((assertion) => !assertion.title.includes('at exactly $100')).every((assertion) => assertion.status === 'passed');
    runs.push({ attempt, original, mutant: changed, assertionKilled: changed.exitCode === 1 && Boolean(failedBoundary) && otherTestsPass });
  }
  const originalPasses = runs.every((run) => run.original.exitCode === 0 && !run.original.timedOut);
  const mutantFails = runs.every((run) => run.assertionKilled && !run.mutant.timedOut);
  return {
    status: originalPasses && mutantFails ? 'passed' : 'failed',
    scope: 'local sandbox proof; not an approved or committed repair',
    originalPasses,
    mutantFails,
    cleanRerun: runs.length === 2 && originalPasses && mutantFails,
    patchHash: proposal.patchHash,
    exactMutation: { original: 'subtotalCents >= 10_000', replacement: 'subtotalCents > 10_000' },
    runs,
    logs: runs.flatMap((run) => [run.original.log, run.mutant.log]),
    approval: null,
    repairCommit: null,
    gitlabPipeline: null,
  };
}
