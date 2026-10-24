/**
 * Render benchmarks/RESULTS.md from benchmarks/results/<repo>.json (written by run.ts).
 *   node node_modules/tsx/dist/cli.mjs benchmarks/report.ts [results/es-toolkit.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const file = resolve(HERE, process.argv[2] ?? 'results/es-toolkit.json');
const data = JSON.parse(readFileSync(file, 'utf8'));

interface Metrics { score: number | null; killed: number; survived: number; noCoverage: number; timedOut: number; invalid: number; total: number }
interface NonKilled { fingerprint: string; path: string; line: number; operator: string; original: string; replacement: string; status: string }
interface Rec {
  number: number; title: string; url: string; mergedAt: string; mergeSha?: string; status: string; reason?: string; note?: string;
  changedLines?: number; metrics?: Metrics; wholeFileMutants?: number | null; durationMs?: number; nonKilled?: NonKilled[]; scope?: { path: string }[];
}

/** Hand-picked after reading each mutant against the merged source (fingerprint prefix + why it matters). */
const EXAMPLES: { fingerprint: string; why: string }[] = [
  { fingerprint: '18057012', why: 'With the mutation every `dequeue()` clears the tail pointer, so `enqueue(1); enqueue(2); dequeue(); enqueue(3)` leaves `[3]` instead of `[2, 3]`. The spec tests enqueue-after-fully-emptied and clear-then-enqueue, but never enqueue after a partial dequeue. The same mutant (`this.#head === undefined` → `true`) also survived in [#2150](https://github.com/toss/es-toolkit/pull/2150), which introduced `Queue`.' },
  { fingerprint: '84df0245', why: 'Boundary of the new Latin-letter range check: U+1E00 (`Ḁ`), the first letter of Latin Extended Additional, would no longer be deburred to `A`. No test uses a letter at either end of that block (`code <= 0x1ef9` → `code < 0x1ef9`, U+1EF9 `ỹ`, also survived).' },
  { fingerprint: 'd565cd2d', why: 'Dropping the end anchor makes any user function whose source merely *contains* `{ [native code] }` (for example in a string literal) serialize as `name:[native]`, so two different functions can hash identically. The tests only use real native functions and ordinary user functions.' },
  { fingerprint: 'aea6c4f9', why: 'The new `TypeError` message can be emptied without any test failing: the spec asserts `toThrow(TypeError)` but never the message. Low risk, but it is exactly the kind of gap a reviewer would want to see before merging an error-message change.' },
];

const METHODOLOGY = `## Methodology

- **Target.** [toss/es-toolkit](https://github.com/toss/es-toolkit): MIT (\`LICENSE\` checked at every candidate merge SHA), TypeScript, Vitest 4, Yarn 4, unit tests colocated as \`src/**/*.spec.ts\`. The predeclared candidate in \`manifest.json\` was Zod; it was switched to es-toolkit before any analysis ran, because es-toolkit's single-package layout and colocated tests made historical checkouts cheap to drive. No Zod analysis was run.
- **Selection.** \`gh pr list --state merged --limit 80\`, sorted newest-first by \`mergedAt\`, keeping PRs merged before the cutoff. Every PR was either excluded with a recorded reason or attempted, in order, until 25 eligible PRs had been attempted. Failed attempts count as attempted.
- **Scope.** For merge (squash) commit M and base M^ (first parent): \`git diff --no-ext-diff --unified=0 M^ M\` → \`parseDiff\` from \`packages/review-core\` (added-side lines of production TypeScript; spec/test/fixture/\`.d.ts\` files, comments, imports and \`type\`/\`interface\` lines dropped) → keep files under \`src/\`. Eligible = at least one candidate line left. This is the same scoping code the Mutant Review gate runs on a merge request.
- **Checkout.** Detached checkout of M in a disposable clone. Dependencies from M's own \`yarn.lock\` with the repo's pinned Yarn (\`yarnPath\`), \`nodeLinker=node-modules\` set via environment (the repo default is Plug'n'Play) and \`--mode=skip-build\` (no install scripts); reinstalled only when \`package.json\`/\`yarn.lock\`/\`.yarnrc.yml\` changed. Stryker 10.1.1 and \`@stryker-mutator/vitest-runner\` 10.1.1 were \`yarn add\`ed into that checkout, then \`package.json\`/\`yarn.lock\` were restored with \`git checkout\`, so the tracked tree under test is exactly M.
- **Mutation run.** StrykerJS 10.1.1 default mutators, \`mutate\` = the changed-line ranges, \`testRunner: vitest\` with the repo's own \`vitest.config.mts\`, \`coverageAnalysis: perTest\`, the runner's default related-test selection, concurrency 4, default timeouts, 10-minute budget per PR. Stryker's sandbox skipped \`docs/\`, \`benchmarks/\`, \`tests/types\`, \`tests/browser-compat\` (separate workspaces, not unit tests), \`.yarn\`, \`.github\`, \`dist\`, \`coverage\`. Stryker's initial (unmutated) test run must pass, otherwise the PR is recorded as failed.
- **Scoring.** The Stryker JSON report goes through \`normalizeStrykerReport(report, scope)\` and \`mutationMetrics\` from \`packages/review-core\`. Score = (killed + timeout) / (killed + timeout + survived + no coverage). Every Survived and NoCoverage mutant is listed with its fingerprint in the results JSON.
- **Whole-file baseline.** The same files without line ranges, \`dryRunOnly\`, stopped as soon as Stryker logs \`Instrumented N source file(s) with M mutant(s)\`. Only the count is used; whole-file mutants were not executed.
- **Environment.** One run on Windows 11, Node v24.16.0 (the repo's \`.nvmrc\` says 24.13.0), Yarn 4.12.0 from the repo, no repetition.

## Limitations

- A surviving mutant is a behaviour change on a changed line that the merged test suite did not detect. It is **not** proof that a production bug shipped.
- Equivalent mutants (changes that cannot alter observable behaviour) are in these counts. Two seen while picking examples: [#2123](https://github.com/toss/es-toolkit/pull/2123) \`index < str.length\` → \`index <= str.length\` (\`charCodeAt\` past the end is \`NaN\`, so the loop exits the same way) and [#2120](https://github.com/toss/es-toolkit/pull/2120) \`result === '0'\` → \`true\` (the second half of that condition is only true for \`-0\`). Apart from the examples above, which were read against the merged source and spec, **the survivors were not human-reviewed**, so the counts are an upper bound on actionable test gaps. The predeclared protocol's human review step and reviewed-sample precision were not done.
- All 116 \`NoCoverage\` mutants come from [#2097](https://github.com/toss/es-toolkit/pull/2097) (Node.js 6+ support for \`es-toolkit/compat\`, 50 files); 87 of them are in \`src/compat/_internal/\`, which es-toolkit's own coverage config excludes. Some may be fallbacks for old runtimes that Node 24 never takes.
- Stryker 10.1.1 never mutates inside a TypeScript \`as\` expression (it treats \`TSAsExpression\` as a type node) and has no mutator for an \`instanceof\` ternary test or a plain call/assignment. That is why 5 completed PRs got 0 mutants (e.g. [#2056](https://github.com/toss/es-toolkit/pull/2056) changed \`return (value === undefined ? other : value) as number;\`). Those changed lines were not tested at all by this method, and they count as "no gap", which lowers the headline ratio rather than raising it.
- Deviations from the predeclared \`manifest.json\` limits: the per-run budgets (5 files, 200 lines, 100 mutants, 300 s, concurrency 2) were not enforced; this run used a 10-minute budget and concurrency 4. Build and the full unmodified suite were not run separately; Stryker's initial test run over related tests is the baseline check. The base was M^ and the head was M (the squash/merge commit), not the PR's pre-merge head.
- Tests are selected by Vitest's import graph (\`related\`); a test that exercises a file without importing it would be missed.
- Runtimes are from one laptop run and exclude dependency installs.
- Nothing here says anything about how es-toolkit's tests were written; no evidence suggests they were AI-generated.

## Rerun

\`\`\`sh
node node_modules/tsx/dist/cli.mjs benchmarks/run.ts      # clones into %TEMP%/mrbench, writes results/es-toolkit.json (+ raw/)
node node_modules/tsx/dist/cli.mjs benchmarks/report.ts   # renders this file
\`\`\`
`;

const repo: string = data.target.repository;
const prs: Rec[] = data.pullRequests;
const attempted = prs.filter(p => p.status !== 'excluded');
const completed = attempted.filter(p => p.status === 'completed');
const failed = attempted.filter(p => p.status === 'failed');
const withMutants = completed.filter(p => p.metrics!.total > 0);
const undetected = (p: Rec) => p.metrics!.survived + p.metrics!.noCoverage;
const gapPrs = completed.filter(p => undetected(p) > 0);
const survivedPrs = completed.filter(p => p.metrics!.survived > 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : NaN; };
const pct = (n: number | null | undefined) => n == null ? 'n/a' : `${n.toFixed(1)}%`;
const secs = (ms?: number) => ms == null ? 'n/a' : `${(ms / 1000).toFixed(0)} s`;
const code = (s: string) => '`' + s.replace(/\s+/g, ' ').replace(/`/g, "'").slice(0, 90) + '`';
const link = (p: Rec) => `[#${p.number}](${p.url})`;
const permalink = (p: Rec, m: NonKilled) => `${repo}/blob/${p.mergeSha}/${m.path}#L${m.line}`;

const scores = withMutants.map(p => p.metrics!.score!).filter(s => s != null);
const mutantsRun = sum(completed.map(p => p.metrics!.total));
const comparable = completed.filter(p => p.wholeFileMutants != null);
const runComparable = sum(comparable.map(p => p.metrics!.total));
const wholeComparable = sum(comparable.map(p => p.wholeFileMutants!));
const runtime = sum(attempted.map(p => p.durationMs ?? 0));

const lines: string[] = [];
lines.push(`# Mutant Review on real merged PRs: ${repo.replace('https://github.com/', '')}`, '');
lines.push(`Generated ${data.generatedAt.slice(0, 10)} from [\`results/${file.split(/[\\/]/).pop()}\`](results/${file.split(/[\\/]/).pop()}) by \`benchmarks/run.ts\` + \`benchmarks/report.ts\`. Cutoff: merged before ${data.cutoff}.`, '');
lines.push(`**${gapPrs.length} of ${completed.length} analyzed merged PRs shipped changed lines where at least one mutant survived — a change no test noticed.**`, '');
const zero = completed.length - withMutants.length;
const top = [...completed].sort((a, b) => undetected(b) - undetected(a))[0];
const allUndetected = sum(completed.map(undetected));
lines.push([
  `"Survived" here means Stryker \`Survived\` or \`NoCoverage\`: the changed line was mutated and the PR's own merged test suite still passed. ${survivedPrs.length === gapPrs.length ? 'All' : `${survivedPrs.length} of the`} ${gapPrs.length} PRs had at least one strictly \`Survived\` mutant (tests executed the line but nothing failed).`,
  `The denominator is conservative: ${zero} of the ${completed.length} completed PRs produced no mutants on their changed lines (see Limitations) and count as "no gap". Among the ${withMutants.length} PRs where Stryker generated at least one mutant, ${gapPrs.length} had an undetected one.`,
  top && undetected(top) ? `One large PR dominates the mutant totals: ${link(top)} accounts for ${undetected(top)} of the ${allUndetected} undetected mutants; the per-PR count above does not depend on it.` : '',
].filter(Boolean).join(' '), '');
lines.push(`Considered ${prs.length} merged PRs newest-first; ${prs.length - attempted.length} excluded with a recorded reason; **${attempted.length} eligible PRs attempted, ${completed.length} completed, ${failed.length} failed**${failed.length ? ' (failed PRs are listed in the table and are not part of the N of M above, which counts completed analyses only)' : ''}.`, '');
lines.push(`Context: es-toolkit's README describes the library as "battle-tested with 100% test coverage" ([README](${repo}#readme)), and its [\`codecov.yml\`](${repo}/blob/main/codecov.yml) sets a 100% project coverage target. Line coverage and mutation testing measure different things: coverage asks whether a line ran, mutation testing asks whether a test fails when the line's behaviour changes. Nothing below says a survivor is a bug, or anything about how the tests were written.`, '');

lines.push('## Aggregate', '');
lines.push('| Metric | Value |', '|---|---|');
lines.push(`| Median mutation score on changed lines (PRs with ≥1 mutant, n=${scores.length}) | ${pct(median(scores))} |`);
lines.push(`| Mutants run (changed lines only) | ${mutantsRun} |`);
lines.push(`| Killed / timed out | ${sum(completed.map(p => p.metrics!.killed))} / ${sum(completed.map(p => p.metrics!.timedOut))} |`);
lines.push(`| Survived / no coverage | ${sum(completed.map(p => p.metrics!.survived))} / ${sum(completed.map(p => p.metrics!.noCoverage))} |`);
lines.push(`| Compile/runtime-error mutants (excluded from scores) | ${sum(completed.map(p => p.metrics!.invalid))} |`);
lines.push(`| Whole-file mutants for the same files (n=${comparable.length} PRs measured) | ${wholeComparable} |`);
lines.push(`| Mutants avoided by changed-line scoping | ${wholeComparable - runComparable} of ${wholeComparable} (${pct(wholeComparable ? 100 * (wholeComparable - runComparable) / wholeComparable : null)}) |`);
lines.push(`| Total Stryker runtime, all attempted PRs (excl. installs) | ${(runtime / 60000).toFixed(1)} min (median ${secs(median(attempted.map(p => p.durationMs ?? 0)))} per PR) |`, '');
lines.push('Whole-file counts come from instrumenting the same files without a line range (Stryker\'s "Instrumented N source file(s) with M mutant(s)"); no whole-file mutants were executed, so no runtime saving is claimed from them.', '');

lines.push('## Per PR', '');
lines.push('| PR | Merged | Changed lines | Mutants | Killed | Survived | No cov. | Score | Whole-file mutants | Runtime | Status |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
for (const p of attempted) {
  const m = p.metrics;
  lines.push(`| ${link(p)} ${p.title.replace(/\|/g, '\\|').slice(0, 60)} | ${p.mergedAt.slice(0, 10)} | ${p.changedLines ?? ''} | ${m?.total ?? ''} | ${m ? m.killed + m.timedOut : ''} | ${m?.survived ?? ''} | ${m?.noCoverage ?? ''} | ${m ? pct(m.score) : ''} | ${p.wholeFileMutants ?? 'n/a'} | ${secs(p.durationMs)} | ${p.status}${p.reason ? `: ${p.reason.replace(/\|/g, '\\|').slice(0, 120)}` : p.note ? ` (${p.note})` : ''} |`);
}
lines.push('', 'Killed includes Stryker `Timeout` (counted as detected, as Stryker does).', '');

lines.push('## Example survivors', '');
lines.push('Each links to the exact line at the merge commit. "Mutation" is what Stryker changed; the full test suite of that commit still passed.', '');
for (const ex of EXAMPLES) {
  const p = completed.find(r => r.nonKilled?.some(m => m.fingerprint.startsWith(ex.fingerprint)));
  const m = p?.nonKilled!.find(n => n.fingerprint.startsWith(ex.fingerprint));
  if (!p || !m) throw new Error(`example ${ex.fingerprint} not found in results`);
  lines.push(`- ${link(p)} [\`${m.path}:${m.line}\`](${permalink(p, m)}) — ${m.operator}: ${code(m.original)} → ${code(m.replacement)} (${m.status}). ${ex.why}`);
}
lines.push('');

lines.push('## Excluded PRs', '');
lines.push('| PR | Merged | Reason |', '|---|---|---|');
for (const p of prs.filter(r => r.status === 'excluded')) lines.push(`| ${link(p)} ${p.title.replace(/\|/g, '\\|').slice(0, 60)} | ${p.mergedAt.slice(0, 10)} | ${p.reason} |`);
lines.push('');

lines.push(METHODOLOGY);
writeFileSync(join(HERE, 'RESULTS.md'), lines.join('\n'));
console.log(`RESULTS.md: ${gapPrs.length}/${completed.length} PRs with undetected mutants; ${attempted.length} attempted, ${failed.length} failed`);
