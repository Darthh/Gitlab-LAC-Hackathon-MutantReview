# Energy: changed-line vs whole-file mutation testing on toss/es-toolkit

Generated 2026-10-25 from [`energy/es-toolkit.json`](energy/es-toolkit.json) by `benchmarks/energy.ts` + `benchmarks/energy-report.ts`. Same merged PRs, merge commits and changed-line ranges as [RESULTS.md](RESULTS.md).

**Mutating only the changed lines used 49% less energy than mutating the whole changed files** across 25 PRs: 4.26 Wh instead of 8.30 Wh, 2088.1 instead of 4268.4 CPU-seconds. Both runs were executed and timed on the same machine; nothing here is projected.

## Aggregate (SCI, R = one merge-request review)

| | Changed lines (Mutant Review) | Whole changed files |
|---|---:|---:|
| Mutants executed | 1057 | 4088 |
| CPU time | 2088.1 s | 4268.4 s |
| Energy (CPU + memory, PUE 1.1) | 4.26 Wh | 8.30 Wh |
| SCI, all PRs, us-east1 (579 gCO2e/kWh) | 2.80 gCO2e | 5.42 gCO2e |
| SCI per review (mean) | 112 mgCO2e | 217 mgCO2e |

Machine: 2 vCPU / 7.8 GB, Intel(R) Xeon(R) Processor @ 2.10GHz, concurrency 2. GitLab's default hosted runner (`saas-linux-small-amd64`) is also 2 vCPU / 8 GB. Measured in a cloud development container, not on a GitLab runner; other Stryker jobs shared the machine during part of the run. CPU time is counted per process tree, so it is far less affected than wall time.

**Per-MR projection check.** Every MR review projects the whole-file cost from two runs it already makes (the changed-line run and a whole-file dry run). Against the executed whole-file runs here, that projection's median absolute error on CPU time is **15%**.

## Model input kept out of the drafting prompt

The second saving is model input. On 25 of these PRs (11 with surviving or uncovered mutants), an agent asked to write a test for every surviving mutant would receive **293** findings. Mutant Review's deterministic triage (arid filter, one finding per line, at most three per MR) sends **23**, keeping **92%** of the per-finding brief context out of the prompt: 236,083 characters, roughly 59,022 tokens at 4 characters per token. Characters are measured by building the brief both ways with the product's own `findingContext`; the shared preamble, requirement docs and test-file excerpts are left out of both sides, so the real difference is larger. Source: [`results/es-toolkit-model-input.json`](results/es-toolkit-model-input.json) (changed-line Stryker reports of benchmarks/energy.ts (same merge commits and ranges)).

## Per PR

| PR | Changed lines | Mutants (changed / whole) | CPU-s (changed / whole) | Energy (changed / whole) | Projected whole CPU-s |
|---|---:|---:|---:|---:|---:|
| [#2154](https://github.com/toss/es-toolkit/pull/2154) fix[serialize, hash]: make Set and Map output inde | 37 | 67 / 94 | 56.1 / 62.8 | 108.9 mWh / 121.0 mWh | 71.1 |
| [#2149](https://github.com/toss/es-toolkit/pull/2149) fix[Semaphore]: keep release fast when may tasks a | 3 | 1 / 22 | 23.4 / 31.9 | 55.3 mWh / 103.6 mWh | 41 |
| [#2153](https://github.com/toss/es-toolkit/pull/2153) fix[Queue]: shrink the bundle by shortening node p | 18 | 13 / 26 | 23.5 / 25.1 | 48.8 mWh / 50.9 mWh | 29.7 |
| [#2097](https://github.com/toss/es-toolkit/pull/2097) feat(compat): support Node.js 6+ in es-toolkit/com | 621 | 637 / 2414 | 878 / 2365.5 | 1.64 Wh / 4.39 Wh | 3140.2 |
| [#2150](https://github.com/toss/es-toolkit/pull/2150) feat[Queue]: add Queue to es-toolkit/util | 36 | 16 / 26 | 21 / 22.9 | 45.3 mWh / 46.3 mWh | 24.4 |
| [#2143](https://github.com/toss/es-toolkit/pull/2143) fix[deepFreeze]: freeze symbol and non-enumerable  | 1 | 0 / 29 | 16.8 / 25.9 | 35.5 mWh / 51.9 mWh | n/a |
| [#2146](https://github.com/toss/es-toolkit/pull/2146) fix[intersectionBy]: match each mapped value at mo | 8 | 5 / 11 | 19.3 / 20 | 40.0 mWh / 44.9 mWh | 22.3 |
| [#2113](https://github.com/toss/es-toolkit/pull/2113) fix[head, last, maxBy, minBy]: improve fp type inf | 15 | 0 / 11 | 17.2 / 20 | 38.9 mWh / 43.7 mWh | n/a |
| [#2121](https://github.com/toss/es-toolkit/pull/2121) feat[query-string]: add stringify to es-toolkit/qu | 13 | 20 / 24 | 23.3 / 24.8 | 56.3 mWh / 51.9 mWh | 24.7 |
| [#2133](https://github.com/toss/es-toolkit/pull/2133) fix[orderBy, sortBy]: keep sort order consistent w | 5 | 8 / 44 | 22.8 / 38.2 | 47.5 mWh / 78.3 mWh | 39.9 |
| [#2130](https://github.com/toss/es-toolkit/pull/2130) fix[truncate]: escape string separator in RegExp | 1 | 0 / 59 | 30.9 / 53.6 | 70.2 mWh / 116.0 mWh | n/a |
| [#2124](https://github.com/toss/es-toolkit/pull/2124) fix[deburr]: keep letters of non-Latin scripts as  | 27 | 80 / 185 | 242.2 / 316.3 | 509.6 mWh / 611.1 mWh | 515 |
| [#2114](https://github.com/toss/es-toolkit/pull/2114) fix(compat/unionWith): match lodash comparator arg | 2 | 5 / 7 | 35.1 / 35.5 | 77.7 mWh / 81.6 mWh | 35.7 |
| [#2123](https://github.com/toss/es-toolkit/pull/2123) fix[deburr]: only deburr Latin letters like lodash | 19 | 64 / 71 | 116.7 / 123.9 | 258.2 mWh / 255.7 mWh | 125.8 |
| [#2122](https://github.com/toss/es-toolkit/pull/2122) fix[groupBy, maxBy, minBy]: call the iteratee with | 10 | 9 / 84 | 38.4 / 69.8 | 84.6 mWh / 141.7 mWh | 55.6 |
| [#2120](https://github.com/toss/es-toolkit/pull/2120) refactor(compat): move baseToString into _internal | 20 | 40 / 163 | 135.9 / 196.8 | 285.9 mWh / 439.3 mWh | 382.3 |
| [#2056](https://github.com/toss/es-toolkit/pull/2056) fix(add,subtract,multiply,divide): match Lodash on | 13 | 0 / 157 | 59.1 / 229.1 | 140.9 mWh / 458.6 mWh | n/a |
| [#2110](https://github.com/toss/es-toolkit/pull/2110) fix(compat/words): match emoji sequences, non-ASCI | 13 | 13 / 48 | 62.5 / 93.3 | 131.6 mWh / 186.6 mWh | 130.2 |
| [#2099](https://github.com/toss/es-toolkit/pull/2099) fix(dedent): keep interpolated values out of the i | 15 | 11 / 141 | 23.7 / 77.2 | 49.0 mWh / 146.3 mWh | 80.7 |
| [#2100](https://github.com/toss/es-toolkit/pull/2100) fix(dedent): throw a TypeError for a malformed tem | 11 | 30 / 133 | 31.3 / 68.4 | 62.6 mWh / 129.8 mWh | 71.9 |
| [#2102](https://github.com/toss/es-toolkit/pull/2102) fix(compat/words): keep combining marks attached t | 2 | 2 / 47 | 47.3 / 82.2 | 103.5 mWh / 166.1 mWh | 275.6 |
| [#2103](https://github.com/toss/es-toolkit/pull/2103) fix(words): match titlecase letters, aligning with | 1 | 1 / 47 | 47.7 / 86.5 | 105.4 mWh / 172.8 mWh | 661.8 |
| [#2101](https://github.com/toss/es-toolkit/pull/2101) fix[forEach, forEachRight, forIn, forInRight, forO | 8 | 0 / 167 | 37.3 / 110.9 | 83.9 mWh / 223.8 mWh | n/a |
| [#2098](https://github.com/toss/es-toolkit/pull/2098) fix[xorBy, xorWith]: ignore the iteratee and compa | 4 | 8 / 27 | 36.9 / 40.8 | 80.9 mWh / 87.0 mWh | 47.9 |
| [#2095](https://github.com/toss/es-toolkit/pull/2095) fix[pull, pullAll, pullAllBy, remove]: handle null | 7 | 27 / 51 | 41.7 / 47 | 95.4 mWh / 103.5 mWh | 50.7 |

Every PR from RESULTS.md was measured.

## Method

- **Runs.** Per PR, StrykerJS 10.1.1 with the repository's own Vitest config, `coverageAnalysis: perTest`, no incremental cache: (1) the changed-line ranges, (2) the whole changed files as a dry run, (3) the whole changed files with every mutant executed.
- **CPU time** is the user+system time of each Stryker process tree (`cutime + cstime` of `/proc/self/stat` around the run), so it includes every worker and test-runner process.
- **Energy** uses the product's footprint model (`packages/review-core/src/footprint.ts`): Cloud Carbon Footprint GCP coefficients, 0.71 W idle to 4.26 W busy per vCPU over the reserved vCPUs, 0.392 W per GB of reserved memory, PUE 1.1. Embodied: 1610.79 kgCO2e per 112-vCPU host over 4 years.
- **Carbon intensity**: Google Cloud's published 2025 location-based grid intensity for us-east1, where GitLab's hosted x86 runners run. The SCI specification prefers marginal rates, which are not published for this region.
- **Not included**: dependency installs (identical in both arms), network and storage.
- One run per arm, no repetition; CPU frequency and noisy neighbours add variance.
