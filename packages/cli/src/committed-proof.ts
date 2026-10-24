import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { GitLabAdapter, ExactPatchProposal } from '../../gitlab-adapter/src/index.js';
import { digest } from './proof.js';
import { execute } from './runner.js';

export const fixtureFeatures = {
  'packages/demo-domain/src/shipping.test.ts': { sourcePath: 'packages/demo-domain/src/shipping.ts', original: 'subtotalCents >= 10_000', replacement: 'subtotalCents > 10_000', message: 'expected 500 to be +0', contract: 'SHIPPING-001', symbol: 'shippingFee' },
  'packages/demo-domain/src/discount.test.ts': { sourcePath: 'packages/demo-domain/src/discount.ts', original: 'subtotalCents >= 20_000', replacement: 'subtotalCents > 20_000', message: 'expected +0 to be 1000', contract: 'DISCOUNT-001', symbol: 'loyaltyDiscount' },
} as const;

/** Fetches actual immutable commit contents, then executes with no inherited write credentials. */
export async function verifyCommittedFixture(adapter: GitLabAdapter, proposal: ExactPatchProposal, repairCommitSha: string, outputDirectory: string) {
  if (proposal.files.length !== 1) throw new Error('Committed verification supports one domain feature per proposal');
  const changed = proposal.files[0]!;
  const feature = fixtureFeatures[changed.path as keyof typeof fixtureFeatures];
  if (!feature) throw new Error('Only the two explicit demo contracts are supported');
  const paths = ['packages/demo-domain/src/shipping.ts', 'packages/demo-domain/src/shipping.test.ts', 'packages/demo-domain/src/discount.ts', 'packages/demo-domain/src/discount.test.ts'];
  const contents = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await adapter.readRepositoryFile(path, repairCommitSha)] as const)));
  if (contents[changed.path] !== changed.after) throw new Error('Committed test contents differ from the human-approved proposal');
  for (const path of paths.filter((path) => path !== changed.path)) {
    if (contents[path] !== await adapter.readRepositoryFile(path, proposal.sourceHeadSha)) throw new Error('Repair commit changed production behavior or an unapproved test');
  }
  const source = contents[feature.sourcePath]!;
  if (source.split(feature.original).length !== 2) throw new Error('Exact targeted mutation cannot be uniquely located');
  await mkdir('.mutant-review/work', { recursive: true });
  const work = await mkdtemp(resolve('.mutant-review/work/committed-'));
  const rel = relative(process.cwd(), work).replaceAll('\\', '/');
  for (const [path, content] of Object.entries(contents)) await writeFile(`${work}/${path.split('/').at(-1)}`, content.replaceAll("'./shipping.js'", "'./shipping.ts'").replaceAll("'./discount.js'", "'./discount.ts'"));
  const config = `${rel}/vitest.proof.config.mjs`;
  await writeFile(config, `export default ${JSON.stringify({ test: { include: [`${rel}/*.test.ts`], exclude: [], pool: 'forks', maxWorkers: 1, minWorkers: 1 } })};\n`);
  await mkdir(outputDirectory, { recursive: true });
  const runs = [];
  const targetFile = `${work}/${feature.sourcePath.split('/').at(-1)}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await writeFile(targetFile, source);
    const originalPath = `${outputDirectory}/original-${attempt}.json`;
    const original = await execute(['node_modules/vitest/vitest.mjs', 'run', '--config', config, '--reporter=json', `--outputFile=${originalPath}`], `${outputDirectory}/original-${attempt}.log`);
    await writeFile(targetFile, source.replace(feature.original, feature.replacement));
    const mutantPath = `${outputDirectory}/mutant-${attempt}.json`;
    const mutant = await execute(['node_modules/vitest/vitest.mjs', 'run', '--config', config, '--reporter=json', `--outputFile=${mutantPath}`], `${outputDirectory}/mutant-${attempt}.log`);
    const result = JSON.parse(await readFile(mutantPath, 'utf8')) as { numFailedTests: number; testResults: { assertionResults: { status: string; failureMessages: string[] }[] }[] };
    const failures = result.testResults.flatMap((test) => test.assertionResults).filter((assertion) => assertion.status === 'failed');
    const assertionKilled = mutant.exitCode === 1 && !mutant.timedOut && failures.length > 0 && result.numFailedTests === failures.length && failures.every((failure) => failure.failureMessages.some((message) => message.includes(feature.message)));
    runs.push({ attempt, original, mutant, assertionKilled });
  }
  const passed = runs.every((run) => run.original.exitCode === 0 && !run.original.timedOut && run.assertionKilled);
  return { status: passed ? 'passed' : 'failed', source: 'fresh local execution of immutable GitLab commit contents', repairCommitSha, patchHash: proposal.patchHash, sourceHash: digest(source), exactMutation: feature, cleanRerun: passed, runs, tokens: null };
}
