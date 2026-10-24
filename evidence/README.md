# Execution evidence

Run `npm run demo` to produce fresh, local evidence in `latest.json` and the
subdirectories below. It runs the pinned Vitest and Stryker binaries, rather
than populating a dashboard with invented results.

| Artifact | Meaning |
| --- | --- |
| `baseline.json`, `baseline.log` | Original full domain test suite and output |
| `coverage/coverage-summary.json` | Measured coverage for the shipping fixture |
| `mutation/mutation.json`, `mutation.log` | Raw Stryker results, including the survivor |
| `verification/original-{1,2}.json` | Proposed boundary test and unchanged existing tests pass |
| `verification/mutant-{1,2}.json` | The exact mutant fails only the new boundary assertion |
| `verification/receipt.json` | Links proposal hash, targeted mutant, revision, and proof runs |
| `latest.json` | Normalized console view over those real artifacts |

The baseline fixture currently produces **100% shipping branch coverage** and
**80% mutation score** (four killed, one surviving mutant). These numbers describe
the measured fixture, not a general claim about an arbitrary repository.

The proof runner writes repaired and mutated code only beneath
`.mutant-review/work/`; it does not approve or commit a test repair. Each of its
two verification attempts starts new Vitest processes and bypasses mutation
incremental reuse. The mutation must fail the exact `10_000`-cent assertion,
while the other tests pass. A timeout or unrelated exception is not accepted.

`npm run review` instead requires GitLab MR CI context and uses its exact
comparison base and source SHA. `npm run gate` fails for this intentionally weak
fixture. A locally failed gate has not demonstrated that GitLab merge settings
block an MR; that requires tenant configuration and an actual failed MR pipeline.

GitLab Duo calls, human approval, an applied repair commit, saved approved
lessons, demonstrated lesson application, and deployment remain separate
evidence states. The local proof claims none of them. Reported token usage is
unavailable and model calls are zero until a real integration records them.
