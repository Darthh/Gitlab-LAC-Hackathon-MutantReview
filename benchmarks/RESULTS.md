# Mutant Review on real merged PRs: toss/es-toolkit

Generated 2026-10-24 from [`results/es-toolkit.json`](results/es-toolkit.json) by `benchmarks/run.ts` + `benchmarks/report.ts`. Cutoff: merged before 2026-10-23T23:59:59Z.

**11 of 25 analyzed merged PRs shipped changed lines where at least one mutant survived — a change no test noticed.**

"Survived" here means Stryker `Survived` or `NoCoverage`: the changed line was mutated and the PR's own merged test suite still passed. All 11 PRs had at least one strictly `Survived` mutant (tests executed the line but nothing failed). The denominator is conservative: 5 of the 25 completed PRs produced no mutants on their changed lines (see Limitations) and count as "no gap". Among the 20 PRs where Stryker generated at least one mutant, 11 had an undetected one. One large PR dominates the mutant totals: [#2097](https://github.com/toss/es-toolkit/pull/2097) accounts for 252 of the 294 undetected mutants; the per-PR count above does not depend on it.

Considered 39 merged PRs newest-first; 14 excluded with a recorded reason; **25 eligible PRs attempted, 25 completed, 0 failed**.

Context: es-toolkit's README describes the library as "battle-tested with 100% test coverage" ([README](https://github.com/toss/es-toolkit#readme)), and its [`codecov.yml`](https://github.com/toss/es-toolkit/blob/main/codecov.yml) sets a 100% project coverage target. Line coverage and mutation testing measure different things: coverage asks whether a line ran, mutation testing asks whether a test fails when the line's behaviour changes. Nothing below says a survivor is a bug, or anything about how the tests were written.

## Aggregate

| Metric | Value |
|---|---|
| Median mutation score on changed lines (PRs with ≥1 mutant, n=20) | 93.5% |
| Mutants run (changed lines only) | 1057 |
| Killed / timed out | 737 / 23 |
| Survived / no coverage | 178 / 116 |
| Compile/runtime-error mutants (excluded from scores) | 3 |
| Whole-file mutants for the same files (n=25 PRs measured) | 4088 |
| Mutants avoided by changed-line scoping | 3031 of 4088 (74.1%) |
| Total Stryker runtime, all attempted PRs (excl. installs) | 12.0 min (median 18 s per PR) |

Whole-file counts come from instrumenting the same files without a line range (Stryker's "Instrumented N source file(s) with M mutant(s)"); no whole-file mutants were executed, so no runtime saving is claimed from them.

## Per PR

| PR | Merged | Changed lines | Mutants | Killed | Survived | No cov. | Score | Whole-file mutants | Runtime | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| [#2154](https://github.com/toss/es-toolkit/pull/2154) fix[serialize, hash]: make Set and Map output independent of | 2026-10-23 | 37 | 67 | 54 | 13 | 0 | 80.6% | 94 | 16 s | completed |
| [#2149](https://github.com/toss/es-toolkit/pull/2149) fix[Semaphore]: keep release fast when may tasks are waiting | 2026-10-23 | 3 | 1 | 1 | 0 | 0 | 100.0% | 22 | 18 s | completed |
| [#2153](https://github.com/toss/es-toolkit/pull/2153) fix[Queue]: shrink the bundle by shortening node property na | 2026-10-23 | 18 | 13 | 12 | 1 | 0 | 92.3% | 26 | 11 s | completed |
| [#2097](https://github.com/toss/es-toolkit/pull/2097) feat(compat): support Node.js 6+ in es-toolkit/compat | 2026-10-23 | 621 | 637 | 385 | 136 | 116 | 60.4% | 2414 | 190 s | completed |
| [#2150](https://github.com/toss/es-toolkit/pull/2150) feat[Queue]: add Queue to es-toolkit/util | 2026-10-23 | 36 | 16 | 15 | 1 | 0 | 93.8% | 26 | 12 s | completed |
| [#2143](https://github.com/toss/es-toolkit/pull/2143) fix[deepFreeze]: freeze symbol and non-enumerable properties | 2026-10-22 | 1 | 0 | 0 | 0 | 0 | n/a | 29 | 13 s | completed |
| [#2146](https://github.com/toss/es-toolkit/pull/2146) fix[intersectionBy]: match each mapped value at most once in | 2026-10-22 | 8 | 5 | 5 | 0 | 0 | 100.0% | 11 | 13 s | completed |
| [#2113](https://github.com/toss/es-toolkit/pull/2113) fix[head, last, maxBy, minBy]: improve fp type inference | 2026-10-11 | 15 | 0 | 0 | 0 | 0 | n/a | 11 | 12 s | completed |
| [#2121](https://github.com/toss/es-toolkit/pull/2121) feat[query-string]: add stringify to es-toolkit/query-string | 2026-10-10 | 13 | 20 | 18 | 2 | 0 | 90.0% | 24 | 13 s | completed |
| [#2133](https://github.com/toss/es-toolkit/pull/2133) fix[orderBy, sortBy]: keep sort order consistent when values | 2026-10-09 | 5 | 8 | 8 | 0 | 0 | 100.0% | 44 | 13 s | completed |
| [#2130](https://github.com/toss/es-toolkit/pull/2130) fix[truncate]: escape string separator in RegExp | 2026-10-09 | 1 | 0 | 0 | 0 | 0 | n/a | 59 | 18 s | completed |
| [#2124](https://github.com/toss/es-toolkit/pull/2124) fix[deburr]: keep letters of non-Latin scripts as they are | 2026-09-30 | 27 | 80 | 70 | 7 | 0 | 90.9% | 185 | 78 s | completed |
| [#2114](https://github.com/toss/es-toolkit/pull/2114) fix(compat/unionWith): match lodash comparator argument orde | 2026-09-30 | 2 | 5 | 5 | 0 | 0 | 100.0% | 7 | 19 s | completed |
| [#2123](https://github.com/toss/es-toolkit/pull/2123) fix[deburr]: only deburr Latin letters like lodash | 2026-09-30 | 19 | 64 | 59 | 5 | 0 | 92.2% | 71 | 49 s | completed |
| [#2122](https://github.com/toss/es-toolkit/pull/2122) fix[groupBy, maxBy, minBy]: call the iteratee with only the  | 2026-09-30 | 10 | 9 | 9 | 0 | 0 | 100.0% | 84 | 19 s | completed |
| [#2120](https://github.com/toss/es-toolkit/pull/2120) refactor(compat): move baseToString into _internal | 2026-09-26 | 20 | 40 | 37 | 3 | 0 | 92.5% | 163 | 49 s | completed |
| [#2056](https://github.com/toss/es-toolkit/pull/2056) fix(add,subtract,multiply,divide): match Lodash on null oper | 2026-09-26 | 13 | 0 | 0 | 0 | 0 | n/a | 157 | 28 s | completed |
| [#2110](https://github.com/toss/es-toolkit/pull/2110) fix(compat/words): match emoji sequences, non-ASCII numerals | 2026-09-19 | 13 | 13 | 8 | 5 | 0 | 61.5% | 48 | 29 s | completed |
| [#2099](https://github.com/toss/es-toolkit/pull/2099) fix(dedent): keep interpolated values out of the indentation | 2026-09-17 | 15 | 11 | 8 | 3 | 0 | 72.7% | 141 | 11 s | completed |
| [#2100](https://github.com/toss/es-toolkit/pull/2100) fix(dedent): throw a TypeError for a malformed template lite | 2026-09-16 | 11 | 30 | 28 | 2 | 0 | 93.3% | 133 | 12 s | completed |
| [#2102](https://github.com/toss/es-toolkit/pull/2102) fix(compat/words): keep combining marks attached to the lett | 2026-09-16 | 2 | 2 | 2 | 0 | 0 | 100.0% | 47 | 23 s | completed |
| [#2103](https://github.com/toss/es-toolkit/pull/2103) fix(words): match titlecase letters, aligning with lodash | 2026-09-15 | 1 | 1 | 1 | 0 | 0 | 100.0% | 47 | 22 s | completed |
| [#2101](https://github.com/toss/es-toolkit/pull/2101) fix[forEach, forEachRight, forIn, forInRight, forOwn, forOwn | 2026-09-15 | 8 | 0 | 0 | 0 | 0 | n/a | 167 | 17 s | completed |
| [#2098](https://github.com/toss/es-toolkit/pull/2098) fix[xorBy, xorWith]: ignore the iteratee and comparator for  | 2026-09-13 | 4 | 8 | 8 | 0 | 0 | 100.0% | 27 | 17 s | completed |
| [#2095](https://github.com/toss/es-toolkit/pull/2095) fix[pull, pullAll, pullAllBy, remove]: handle nullish inputs | 2026-09-11 | 7 | 27 | 27 | 0 | 0 | 100.0% | 51 | 19 s | completed |

Killed includes Stryker `Timeout` (counted as detected, as Stryker does).

## Example survivors

Each links to the exact line at the merge commit. "Mutation" is what Stryker changed; the full test suite of that commit still passed.

- [#2153](https://github.com/toss/es-toolkit/pull/2153) [`src/util/queue.ts:94`](https://github.com/toss/es-toolkit/blob/4a2a17880bc13c7dcf468a5d8fc3c28c7069c3f6/src/util/queue.ts#L94) — ConditionalExpression: `this.#head === null` → `true` (Survived). With the mutation every `dequeue()` clears the tail pointer, so `enqueue(1); enqueue(2); dequeue(); enqueue(3)` leaves `[3]` instead of `[2, 3]`. The spec tests enqueue-after-fully-emptied and clear-then-enqueue, but never enqueue after a partial dequeue. The same mutant (`this.#head === undefined` → `true`) also survived in [#2150](https://github.com/toss/es-toolkit/pull/2150), which introduced `Queue`.
- [#2124](https://github.com/toss/es-toolkit/pull/2124) [`src/string/deburr.ts:107`](https://github.com/toss/es-toolkit/blob/43e1118884e07cebdf1e767038f6e7f697fa27ec/src/string/deburr.ts#L107) — EqualityOperator: `code >= 0x1e00` → `code > 0x1e00` (Survived). Boundary of the new Latin-letter range check: U+1E00 (`Ḁ`), the first letter of Latin Extended Additional, would no longer be deburred to `A`. No test uses a letter at either end of that block (`code <= 0x1ef9` → `code < 0x1ef9`, U+1EF9 `ỹ`, also survived).
- [#2154](https://github.com/toss/es-toolkit/pull/2154) [`src/util/serialize/serializeFunction.ts:24`](https://github.com/toss/es-toolkit/blob/c64e27288ad98f369b918574a669b5636b98e626/src/util/serialize/serializeFunction.ts#L24) — Regex: `/\{\s*\[native code\]\s*\}$/` → `/\{\s*\[native code\]\s*\}/` (Survived). Dropping the end anchor makes any user function whose source merely *contains* `{ [native code] }` (for example in a string literal) serialize as `name:[native]`, so two different functions can hash identically. The tests only use real native functions and ordinary user functions.
- [#2100](https://github.com/toss/es-toolkit/pull/2100) [`src/string/dedent.ts:91`](https://github.com/toss/es-toolkit/blob/f348be3ad50acb1eb7fd25f489384a7ab0ebcc30/src/string/dedent.ts#L91) — StringLiteral: `'Invalid opening line.'` → `""` (Survived). The new `TypeError` message can be emptied without any test failing: the spec asserts `toThrow(TypeError)` but never the message. Low risk, but it is exactly the kind of gap a reviewer would want to see before merging an error-message change.

## Excluded PRs

| PR | Merged | Reason |
|---|---|---|
| [#2156](https://github.com/toss/es-toolkit/pull/2156) fix[ObjectKeys]: keep string enum keys as the enum type | 2026-10-23 | source changes contain no executable lines (types, imports, comments or re-exports only) |
| [#2148](https://github.com/toss/es-toolkit/pull/2148) fix[merge]: keep the input type when merging a type with its | 2026-10-21 | docs only; no library source changes |
| [#2138](https://github.com/toss/es-toolkit/pull/2138) docs[rearg, take, takeRight, update]: finish the review poin | 2026-10-20 | docs only; no library source changes |
| [#2145](https://github.com/toss/es-toolkit/pull/2145) fix[PropertyPath]: export type from compat | 2026-10-20 | source changes contain no executable lines (types, imports, comments or re-exports only) |
| [#2142](https://github.com/toss/es-toolkit/pull/2142) feat[DistributiveOmit]: add distributive omit type | 2026-10-17 | source changes contain no executable lines (types, imports, comments or re-exports only) |
| [#2137](https://github.com/toss/es-toolkit/pull/2137) docs[iterator]: list the iterator docs under the es-toolkit  | 2026-10-10 | docs only; no library source changes |
| [#2109](https://github.com/toss/es-toolkit/pull/2109) docs: fix reference examples whose documented results don't  | 2026-10-09 | docs only; no library source changes |
| [#2136](https://github.com/toss/es-toolkit/pull/2136) docs[toKebabCaseKeys]: fix kebab-case example comment in Kor | 2026-10-08 | docs only; no library source changes |
| [#2132](https://github.com/toss/es-toolkit/pull/2132) docs[lowerFirst]: fix JSDoc examples calling lowerCase inste | 2026-10-08 | source changes contain no executable lines (types, imports, comments or re-exports only) |
| [#2126](https://github.com/toss/es-toolkit/pull/2126) build(deps): bump the github-actions group with 3 updates | 2026-10-07 | ci only; no library source changes |
| [#2125](https://github.com/toss/es-toolkit/pull/2125) docs(contributing): require both conditions for compat behav | 2026-09-30 | docs only; no library source changes |
| [#2119](https://github.com/toss/es-toolkit/pull/2119) test: update bundle size snapshots | 2026-09-26 | benchmarks only; no library source changes |
| [#2108](https://github.com/toss/es-toolkit/pull/2108) docs(contributing): limit compat fixes to inputs Lodash's ty | 2026-09-17 | empty diff (the merge commit changed no files) |
| [#2107](https://github.com/toss/es-toolkit/pull/2107) docs: limit compat fixes to inputs Lodash's types allow or r | 2026-09-17 | docs only; no library source changes |

## Methodology

- **Target.** [toss/es-toolkit](https://github.com/toss/es-toolkit): MIT (`LICENSE` checked at every candidate merge SHA), TypeScript, Vitest 4, Yarn 4, unit tests colocated as `src/**/*.spec.ts`. The predeclared candidate in `manifest.json` was Zod; it was switched to es-toolkit before any analysis ran, because es-toolkit's single-package layout and colocated tests made historical checkouts cheap to drive. No Zod analysis was run.
- **Selection.** `gh pr list --state merged --limit 80`, sorted newest-first by `mergedAt`, keeping PRs merged before the cutoff. Every PR was either excluded with a recorded reason or attempted, in order, until 25 eligible PRs had been attempted. Failed attempts count as attempted.
- **Scope.** For merge (squash) commit M and base M^ (first parent): `git diff --no-ext-diff --unified=0 M^ M` → `parseDiff` from `packages/review-core` (added-side lines of production TypeScript; spec/test/fixture/`.d.ts` files, comments, imports and `type`/`interface` lines dropped) → keep files under `src/`. Eligible = at least one candidate line left. This is the same scoping code the Mutant Review gate runs on a merge request.
- **Checkout.** Detached checkout of M in a disposable clone. Dependencies from M's own `yarn.lock` with the repo's pinned Yarn (`yarnPath`), `nodeLinker=node-modules` set via environment (the repo default is Plug'n'Play) and `--mode=skip-build` (no install scripts); reinstalled only when `package.json`/`yarn.lock`/`.yarnrc.yml` changed. Stryker 10.1.1 and `@stryker-mutator/vitest-runner` 10.1.1 were `yarn add`ed into that checkout, then `package.json`/`yarn.lock` were restored with `git checkout`, so the tracked tree under test is exactly M.
- **Mutation run.** StrykerJS 10.1.1 default mutators, `mutate` = the changed-line ranges, `testRunner: vitest` with the repo's own `vitest.config.mts`, `coverageAnalysis: perTest`, the runner's default related-test selection, concurrency 4, default timeouts, 10-minute budget per PR. Stryker's sandbox skipped `docs/`, `benchmarks/`, `tests/types`, `tests/browser-compat` (separate workspaces, not unit tests), `.yarn`, `.github`, `dist`, `coverage`. Stryker's initial (unmutated) test run must pass, otherwise the PR is recorded as failed.
- **Scoring.** The Stryker JSON report goes through `normalizeStrykerReport(report, scope)` and `mutationMetrics` from `packages/review-core`. Score = (killed + timeout) / (killed + timeout + survived + no coverage). Every Survived and NoCoverage mutant is listed with its fingerprint in the results JSON.
- **Whole-file baseline.** The same files without line ranges, `dryRunOnly`, stopped as soon as Stryker logs `Instrumented N source file(s) with M mutant(s)`. Only the count is used; whole-file mutants were not executed.
- **Environment.** One run on Windows 11, Node v24.16.0 (the repo's `.nvmrc` says 24.13.0), Yarn 4.12.0 from the repo, no repetition.

## Limitations

- A surviving mutant is a behaviour change on a changed line that the merged test suite did not detect. It is **not** proof that a production bug shipped.
- Equivalent mutants (changes that cannot alter observable behaviour) are in these counts. Two seen while picking examples: [#2123](https://github.com/toss/es-toolkit/pull/2123) `index < str.length` → `index <= str.length` (`charCodeAt` past the end is `NaN`, so the loop exits the same way) and [#2120](https://github.com/toss/es-toolkit/pull/2120) `result === '0'` → `true` (the second half of that condition is only true for `-0`). Apart from the examples above, which were read against the merged source and spec, **the survivors were not human-reviewed**, so the counts are an upper bound on actionable test gaps. The predeclared protocol's human review step and reviewed-sample precision were not done.
- All 116 `NoCoverage` mutants come from [#2097](https://github.com/toss/es-toolkit/pull/2097) (Node.js 6+ support for `es-toolkit/compat`, 50 files); 87 of them are in `src/compat/_internal/`, which es-toolkit's own coverage config excludes. Some may be fallbacks for old runtimes that Node 24 never takes.
- Stryker 10.1.1 never mutates inside a TypeScript `as` expression (it treats `TSAsExpression` as a type node) and has no mutator for an `instanceof` ternary test or a plain call/assignment. That is why 5 completed PRs got 0 mutants (e.g. [#2056](https://github.com/toss/es-toolkit/pull/2056) changed `return (value === undefined ? other : value) as number;`). Those changed lines were not tested at all by this method, and they count as "no gap", which lowers the headline ratio rather than raising it.
- Deviations from the predeclared `manifest.json` limits: the per-run budgets (5 files, 200 lines, 100 mutants, 300 s, concurrency 2) were not enforced; this run used a 10-minute budget and concurrency 4. Build and the full unmodified suite were not run separately; Stryker's initial test run over related tests is the baseline check. The base was M^ and the head was M (the squash/merge commit), not the PR's pre-merge head.
- Tests are selected by Vitest's import graph (`related`); a test that exercises a file without importing it would be missed.
- Runtimes are from one laptop run and exclude dependency installs.
- Nothing here says anything about how es-toolkit's tests were written; no evidence suggests they were AI-generated.

## Rerun

```sh
node node_modules/tsx/dist/cli.mjs benchmarks/run.ts      # clones into %TEMP%/mrbench, writes results/es-toolkit.json (+ raw/)
node node_modules/tsx/dist/cli.mjs benchmarks/report.ts   # renders this file
```
