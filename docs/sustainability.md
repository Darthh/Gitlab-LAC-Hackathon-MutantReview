# Sustainability: what a Mutant Review costs, measured with SCI

Mutation testing has a reputation for burning compute: every mutant re-runs tests. Mutant Review was designed so that a mutation gate on every merge request is cheap enough to leave on, and since this change it **measures its own footprint on every review** with the Green Software Foundation's Software Carbon Intensity specification (SCI, [ISO/IEC 21031:2024](https://greensoftware.foundation/standards/sci/)) and reports it in the MR, the CI metrics widget and Front Desk.

## The numbers

| What | Result | Status |
| --- | --- | --- |
| Mutants avoided by mutating only changed lines, 25 merged es-toolkit PRs | **3,031 of 4,088 (74%)** | Measured counts ([RESULTS.md](../benchmarks/RESULTS.md)) |
| Energy avoided by the same scoping, both arms executed | `benchmarks/energy.ts` → [ENERGY.md](../benchmarks/ENERGY.md) | Harness and manual CI job ready; see [Reproduce](#reproduce) |
| SCI of one review of the demo MR (2 vCPU / 7.8 GB Linux, us-east1 grid) | **17 mgCO2e** (range 12–20) per review | Measured CPU time, see the worked example |
| Model calls made by the CI review and gate | **0** | By construction; at most one per human request in the Duo flow |
| AI drafts that a reviewer has to read and reject | **0** | Every draft is executed against its mutant first |

Every MR pipeline produces its own receipt in `evidence/latest.json` (`footprint`), a one-line footprint in the MR summary comment and `mutant_review_review_sci_mgco2e` / `_energy_mwh` / `_cpu_seconds` in the MR's metrics widget, so the figure is tracked per change rather than estimated once.

## SCI as Mutant Review computes it

```
SCI = (E × I + M) per R
```

| Term | Value | Source |
| --- | --- | --- |
| **R**, functional unit | One merge-request review (the `mutation:review` job for one push) | Matches how the cost is incurred and how the gate is used |
| **E**, energy | CPU: 0.71 W per reserved vCPU idle, +3.55 W per busy vCPU (4.26 W at 100%), from **measured CPU-seconds**. Memory: 0.392 W per GB reserved. × PUE 1.1 | [Cloud Carbon Footprint GCP coefficients](https://www.cloudcarbonfootprint.org/docs/methodology/) |
| **I**, carbon intensity | us-east1 579 gCO2e/kWh (GitLab hosted x86 runners); us-central1 432 (hosted Arm64 runners); any region via `MUTANT_REVIEW_GRID_REGION` | [Google Cloud region carbon data, 2025](https://cloud.google.com/sustainability/region-carbon), [GitLab runner regions](https://docs.gitlab.com/ci/runners/hosted_runners/linux/) |
| **M**, embodied | TE × (TiR / EL) × (RR / ToR): 1,610.79 kgCO2e host, 4-year life, reserved vCPUs of a 112-vCPU host | [CCF embodied method](https://www.cloudcarbonfootprint.org/docs/embodied-emissions), host figures as used for CI runners by [Saavedra et al. 2025](https://arxiv.org/abs/2510.26413) |

**Boundary.** Every process Mutant Review starts in the review job (baseline tests with coverage, Stryker on the changed lines, the whole-file dry run that counts what scoping avoided) on the reserved runner VM, including its idle share, memory, data-centre overhead and the embodied share of the host. **Excluded:** job setup (image pull, `npm ci`), network transfer, storage, and model inference in the Duo flow (no provider publishes per-call energy; the design minimises the count instead and reports it).

**CPU time is measured, not assumed.** `packages/cli/src/runner.ts` reads the user+system time of each child process tree (`cutime + cstime` of `/proc/self/stat` around every run), so Stryker's workers and the test runners are counted. Where the platform cannot measure it (Windows, macOS), the receipt assumes full load, marks `cpuMeasured: false` and is an upper bound.

**Uncertainty.** Each receipt carries a range from two other power models: AMD EPYC 3rd-gen per-vCPU coefficients (0.434–1.948 W, low) and CCF's earlier GCP averages (1.34–4.98 W, high). The SCI specification asks for marginal emission rates; none are published for these regions under an open licence, so Google's location-based average is used and stated. No market-based instruments (RECs, offsets, Google's CFE matching) are applied, as SCI requires.

## Worked example: the demo review

`npm run demo` on a 2 vCPU / 7.8 GB Linux machine (Intel Xeon, 2.8 GHz). Values from `evidence/latest.json`:

| Step | CPU-s | Energy | SCI |
| --- | ---: | ---: | ---: |
| Baseline tests with coverage | 1.7 | 3.6 mWh | 2.4 mg |
| Stryker on changed lines (5 mutants) | 6.5 | 13.1 mWh | 8.6 mg |
| Whole-file mutant count (dry run) | 4.8 | 9.8 mWh | 6.4 mg |
| **Review** (9.0 s wall, 72% of 2 vCPU busy) | **12.9** | **26.4 mWh** | **17.3 mgCO2e** (15.3 operational + 2.1 embodied) |

Two things this shows. First, the demo's change spans its whole file, so scoping saved nothing here, and the receipt says so (0%) instead of inventing a saving. Second, measuring the saving has a price: the whole-file dry run is about a third of this tiny review. It is reported as its own step, and on real MRs, where the changed-line run dominates, it shrinks in proportion.

## Design choices and what each saves

| Practice | Mechanism | Evidence |
| --- | --- | --- |
| Mutate only the diff | Stryker `mutate: path:start-end` from `parseDiff`; whole files are never executed | 74% of mutants avoided on es-toolkit; per-MR `savings.mutantsAvoided` and projected `footprint.savedPercent` |
| No model in CI | Review, triage, gate and the MR comment are deterministic | `metrics.modelCalls: 0` in every CI evidence file |
| One model call, only on request | The Duo flow has a single `AgentComponent`, started by a human mention, capped at three findings | `.gitlab/duo/mutant-review.yml`; `savings.aiCallsAvoided` counts noise and overflow filtered before it |
| Never show a useless draft | Each draft runs against its mutant; rejected drafts are logged, not shown | `verify:hallucination-check` job on every pipeline; ledger `rejected-proposal` entries |
| Catch it before the pipeline | MCP `mutation_check` / `verify_test` and `npm run check` run the same review locally | `packages/cli/src/mcp.e2e.ts`; a gap fixed before push costs no MR pipeline and no review round |
| Don't compute what will be thrown away | MR jobs are `interruptible`; mutation jobs have `rules: changes`, so docs-only MRs run no mutation; Stryker's incremental cache persists per MR | `.gitlab-ci.yml` |
| Learn once | Approved repairs become AGENTS.md rules read by every agent, so the same useless test is not written, found and repaired again | `lessonsInMemory`, ledger |
| Low-carbon hosting for the console | Cloud Run in us-central1 (88% carbon-free energy), scales to zero, max 2 instances | `ci/release.gitlab-ci.yml` |

## Where the same review runs cleaner

Front Desk's Footprint page re-prices the measured usage of a review in each Google Cloud region (only operational emissions change). For the demo review: us-east1 17 mg, us-central1 14 mg, us-west1 5 mg, europe-north1 3 mg. GitLab's hosted **Arm64** runners run in us-central1; the review is pure JavaScript, so moving `mutation:review` to `tags: [saas-linux-small-arm64]` cuts grid intensity by 25% with no code change. It is not the default yet because it has not been exercised on the demo project.

## Reproduce

- **Per review:** `npm run demo`, then open Front Desk (`npm run dev`) → Footprint, or read `footprint` in `evidence/latest.json`. On GitLab, every MR pipeline's `mutation:review` job writes the same receipt and the metrics report.
- **Energy saved by scoping, executed:** `node node_modules/tsx/dist/cli.mjs benchmarks/energy.ts` (Linux, needs network; clones es-toolkit and installs each historical lockfile), then `benchmarks/energy-report.ts` renders `benchmarks/ENERGY.md`. On GitLab: Build > Pipelines > Run pipeline with `RUN_ENERGY_BENCHMARK=1` runs the `benchmark:energy` job on the same 2 vCPU / 8 GB hosted runner the review uses. The report also checks the per-MR whole-file projection against the executed whole-file runs.
- **Model and tests:** `packages/review-core/src/footprint.ts` (pure), with a hand-worked example in `packages/review-core/test/footprint.test.ts`.

## Limitations

- Coefficients are published averages, not wattmeter readings; the receipt range shows their spread.
- Location-based average grid intensity, not marginal, and annual rather than hourly.
- The boundary excludes job setup, network, storage and model inference. Those are real; they are not attributed to the review.
- Per-MR whole-file figures are projections (dry-run cost plus measured cost per mutant); executed comparisons come only from the energy benchmark.
- CPU time is measured only on Linux. Measurements are single runs; shared runners add noise.
