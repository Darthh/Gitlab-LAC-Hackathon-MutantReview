What this repo does: Mutant Review tests whether a GitLab merge request's tests notice deliberate changes to its code. It verifies proposed tests by execution, requires a human command before committing them, and shows the results in a read-only dashboard. Assumed load: one developer using a CLI or MCP server, isolated CI jobs per merge request, and a small number of dashboard readers.

Audit date: 2026-10-25. This is the read-only Ponytail audit after the repository review fixes. The findings below remain open; they are separate from the fixes already delivered.

**Must fix**

1. **A comment from another user can stop the agent handling a valid command** (`packages/cli/src/flow.ts:95-100`, `packages/cli/src/flow.ts:425`).
   - **What this is:** The flow uses hidden comment markers to identify work it has already answered or reported.
   - **Problem:** `pendingTrigger` stops at any comment containing `<!-- mutant-review:`, without checking its author. A newer comment containing `<!-- mutant-review:fake -->` makes an older, unanswered `@ai-mutant-review apply 1` disappear; `flowNotify` similarly accepts another user's copied notification marker.
   - **Fix:** Accept reply markers only from the configured flow account. For CI notification markers, verify the author against the account that owns the CI token before skipping publication.
   - **If we skip it:** Quoting an agent comment, or posting a forged marker, can cause an authorized request to be skipped or a findings comment to be omitted. The direct reproduction returned `null` for the pending command.

2. **The failure handler writes evidence the dashboard cannot read** (`packages/cli/src/index.ts:118-126`, `apps/front-desk/server/evidence-validation.ts:75`).
   - **What this is:** When a review throws, the CLI replaces the latest evidence with a record explaining the failed attempt.
   - **Problem:** It writes `baseline.durationMs: null`, but the server requires a number. It also spreads old evidence into a new record with an empty mutation inventory, potentially retaining incompatible triage and savings; the dashboard returns a generic malformed-evidence error instead of the review failure.
   - **Fix:** Define a distinct, validated error artifact for failed attempts and have the server return a sanitized failure message and log reference. Keep the successful-run schema strict.
   - **If we skip it:** An interrupted review looks like corrupt data in Front Desk, and the useful error is hidden in server files. Passing the failure handler's baseline shape to `validateEvidence` reproduced the schema rejection.

**Should fix**

3. **The release path builds an image it never deploys** (`ci/release.gitlab-ci.yml:29-40`, `ci/release.gitlab-ci.yml:78-80`).
   - **What this is:** `package:image` builds and pushes a GitLab registry image. The deployment job then uses `gcloud run deploy --source .`, which builds the application again.
   - **Problem:** The deployment job never consumes the first image. With Google Cloud deployment enabled, each release performs two builds and deploys the second artifact.
   - **Fix:** Delete the unused `package:image` job and its deployment dependency, retaining the Cloud Run source build as the build-and-release path. Update the release description to match.
   - **If we skip it:** Each enabled deployment spends extra runner time and registry storage on an image that this repository's release path does not use.

**Work completed before the audit**

- Fixed benchmark discovery when the model-input companion JSON sorts before the benchmark results.
- Rejected non-object MCP requests without stopping the server.
- Required a unique draft test and its own recorded mutant kill, including its file and line; rejected unfinished verification runs.
- Restored temporary test edits after apply verification, including refusal paths, and stopped treating a corrupt repair ledger as an empty history.
- Fixed Windows line-ending differences in the displayed test diff and rejected execution-log write failures instead of leaving runs pending.
- Made release packaging wait for the end-to-end safety check; excluded local scratch files and caches from Docker and Cloud Build uploads.
- Corrected the cloud setup audience to match the CI token, following [Google Cloud's audience guidance](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation).
- Updated Vite to 7.3.7 and Vitest/coverage to 4.1.12, applied a scoped `qs` 6.16.1 override for `typed-rest-client`, and recorded installed tool versions in new evidence. Historical benchmark and fixture provenance was preserved.

**Validation**

| Check | Result |
| --- | --- |
| Unit tests | 191 passed across 16 files. |
| TypeScript and production build | Passed with Vite 7.3.7. |
| Fresh install | `npm ci --ignore-scripts --no-audit --no-fund` passed in an isolated verification checkout. |
| End-to-end tests | All 8 passed with real git, Vitest 4.1.12 and Stryker 10.1.1; external GitLab writes were mocked. |
| Snapshot comparison | All 17 changed source/configuration files matched the isolated snapshot used for the final end-to-end run. |
| Dependency audit | Zero reported vulnerabilities, down from eight in the starting dependency tree. |
| Production HTTP smoke | `/`, health, config, benchmark, energy, ledger and evidence all returned HTTP 200. The benchmark returned 25 analyses, 11 with survivors, and 1,057 mutants run. |
| Demo | Baseline passed, 100% branch coverage, 80% mutation score, intentionally failed gate, and the sandbox repair verification passed. |
| Regression strength | Benchmark, malformed MCP request, ineffective draft, Windows line-ending and log-write regressions failed against the original behavior. The end-to-end suite also checks rollback and corrupt-ledger refusal. |
| Repository pre-push mutation check | Exit 2: six production files exceed the five-file policy budget. An earlier smaller run was inconclusive because the configured mutation tests cover the demo domain. This check did not pass; budgets and evaluator rules were preserved. |

Verdict: The core local review, verification and apply paths pass their tests. Fix marker-author checks first, then make failed attempts readable in Front Desk.

Lean: -14 lines, -0 dependencies possible by removing the unused image-build job and its deployment dependency; update the accompanying documentation too.

Not checked: live GitLab/Duo execution or account permissions, a real approval/commit in GitLab, deployed CI or Cloud Run behavior, Linux CPU measurement, hostile-repository sandbox isolation, concurrent independent MCP processes, sustained traffic, and a fresh run of all historical benchmark PRs. The React/CSS presentation, screenshots, historical raw reports and benchmark-maintenance scripts were not read line by line. The pre-push mutation check is not a passing mutation assessment of the changed product code.
