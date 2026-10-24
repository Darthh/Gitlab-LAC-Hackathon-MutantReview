# Run Mutant Review

Requires Node 22.12 or newer; the CI image pins Node 24.16.0. Dependencies are exact versions in `package.json` and `package-lock.json`.

```sh
npm ci
npm test
npm run demo
npm run dev
```

Open `http://localhost:4173`. The console reads `evidence/latest.json` produced by real local execution. `npm run demo` measures Vitest coverage, runs Stryker, proposes the omitted shipping assertion, and checks that assertion in a temporary sandbox. It preserves the intentionally incomplete original tests. A sandbox proof does not grant human approval, commit a repair, save an approved lesson, run Duo, or prove later lesson reuse.

`npm run gate` intentionally exits nonzero while the shipping-boundary mutant survives. `npm run build` checks TypeScript and builds the React interface. `npm start` serves the built interface.

## GitLab project and access

The public demonstration project is [Darthh2/mutant-review](https://gitlab.com/Darthh2/mutant-review), numeric project ID `88030103`. Project creation was confirmed in the signed-in browser, and a real public API capability probe resolved the same project. The required-successful-pipeline merge setting was enabled and confirmed in the signed-in UI. Anonymous API responses omit that field, so the public capability probe records it as unavailable (`null`). This does not establish CI runners, Duo enablement, discussion creation, artifact reads, or actual merge blocking. The original checkout's configured `origin` is GitHub; a GitLab remote is separate.

Use `.env.example` as a variable reference. Set the values in your shell or runtime configuration; the server does not need browser credentials.

```text
GITLAB_URL=https://gitlab.com
GITLAB_PROJECT_ID=88030103
GITLAB_READ_TOKEN=<server-side read credential, if public access is insufficient>
GITLAB_MR_IID=<demonstration MR IID>
GITLAB_EVIDENCE_JOB_ID=<mutation review job ID at the approved revision>
GITLAB_FLOW_HANDLE=<actual configured flow service-account handle>
```

Never prefix a credential with `VITE_`. Never commit `.env`, tokens, approval journals, or service-account keys. Keep a write credential out of Front Desk and untrusted MR execution. The public console is read-only.

Read-only capability inspection:

```sh
npx tsx packages/gitlab-adapter/src/capabilities.ts
```

This checks project readability, an optional MR, and the required-successful-pipeline setting. It deliberately leaves write and Duo capabilities `unverified`; successful reads cannot establish them.

## Configure GitLab CI

The implementation was pushed to GitLab and [pipeline 2983816811](https://gitlab.com/Darthh2/mutant-review/-/pipelines/2983816811) was created at `12fb58c38cad1533c21563b0b85aa04ece7abcdb`. It failed before any job started. The signed-in UI displayed **Phone Number Verification** as the execution blocker. Public API inspection showed no jobs, no start time, and no YAML error. No GitLab test, mutation, gate, or artifact execution has been established by that attempt.

The real demonstration MR is [!1: Demonstrate the unprotected free-shipping boundary](https://gitlab.com/Darthh2/mutant-review/-/merge_requests/1), branch `demo/shipping-boundary`, head `c6d5ae3d101660a2ef5cc28ab35b4e65994b7c91`. It changes only shipping source to an equivalent `if`/`return` implementation while retaining the inclusive comparison; four domain tests passed locally in an isolated worktree. Its MR pipeline [2983839784](https://gitlab.com/Darthh2/mutant-review/-/pipelines/2983839784) also failed before execution. GitLab reports `ci_must_pass` for the MR, but no mutation-gate job has run. The MR remains open and unmerged; creation is not repair approval.

Push the repository to the GitLab project and enable a compatible runner. Open an MR that changes the shipping implementation. The pipeline runs baseline tests and measured coverage, then blocks on `mutation:review`. Playing that job authorizes a bounded mutation run only. It cannot approve a repair, lesson, merge, or deployment. The next job evaluates the deterministic gate and preserves diagnostics on failure.

Turn on **Settings > Merge requests > Merge checks > Pipelines must succeed**. Record a demonstration MR link and a failed mutation-gate job proving merge blocking. Do not claim it works merely because `.gitlab-ci.yml` exists. Protect the default branch, review CI/policy/evaluator changes as a Maintainer, and keep an authoritative policy/evaluator outside an unreviewed MR for hostile-repository use. The current gate detects protected-path changes and fails; it is a single-project MVP, not a hardened external policy service.

The review command requires `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`, `CI_COMMIT_SHA`, and `CI_MERGE_REQUEST_DIFF_BASE_SHA`. It fetches a missing comparison base and records the exact revision. A test-only MR returns no applicable changed-source scope, never a green mutation assessment. `GIT_DEPTH: 0` reduces shallow-clone problems.

To run a diagnostic proof independently of a failed MR pipeline, create a web/API pipeline with `MUTANT_ACTION=sandbox-proof` and play `repair:sandbox-proof`. It runs an isolated experiment, without changing the MR. This job is deliberately named as a sandbox proof; it is not a verified approved repair.

## Enable the Duo custom flow

1. Confirm the tenant permits custom flows, has the necessary GitLab Duo access/credits, and can run its configured tools. The observed UI requested a Duo trial; no Duo session has been executed yet.
2. Import `.gitlab/duo/mutant-review.yml` into a custom flow in the AI Catalog and enable it for this project. `.gitlab/duo/agent-config.yml` supplies the Node execution environment. Accepting a schema in documentation is different from this tenant accepting and executing it.
3. Inspect the tenant's actual `run_command` tool schema. The primary flow uses the capability-selected shell form `command`. If the tenant exposes structured `program` and `args` instead, import `.gitlab/duo/mutant-review.structured.yml`. Both forms are present in GitLab's [official command-tool implementation](https://gitlab.com/gitlab-org/modelops/applied-ml/code-suggestions/ai-assist/-/blob/main/duo_workflow_service/tools/command.py); they are different schemas under the same tool name. Confirm `DeterministicStepComponent`, `AgentComponent`, `read_file`, and `list_dir` are supported. Do not replace them with guessed Human Input syntax.
4. Configure a mention trigger and record the real service-account handle in `GITLAB_FLOW_HANDLE`. Never advertise `@mutant-review` as a configured account until verified.
5. Run the flow checkout at the actual current MR source SHA. The first fixed CLI step hydrates measured evidence, then a fixed lesson lookup feeds read-only triage. Hydration must succeed before the agent proposes a patch. Missing, stale, failed, or inaccessible artifacts produce an execution-problem state; the flow cannot substitute the local demonstration.
6. Validate the returned JSON with review-core, preserve its Duo session link, and publish the finding through the scoped adapter. The adapter caps inline findings at three and falls back to the summary when it cannot map a changed line to current diff coordinates.

The prepared flow follows GitLab's [custom-flow YAML restrictions](https://docs.gitlab.com/user/duo_agent_platform/flows/custom_flows_schema/) and [flow registry v1 reference](https://gitlab.com/gitlab-org/modelops/applied-ml/code-suggestions/ai-assist/-/blob/main/docs/flow_registry/v1.md). It does not claim unsupported per-prompt model selection, an exact provider-request count, or native built-in `review`/`apply` commands.

### Evidence hydration in a real flow job

`evidence/latest.json` is ignored by Git and absent in a fresh flow checkout. Both prepared flow variants run the fixed command `node node_modules/tsx/dist/cli.mjs packages/cli/src/index.ts hydrate-evidence` before lesson lookup and triage. It removes stale evidence before configuration or network access, validates the actual checked-out Git SHA, finds a unique open MR at that SHA, examines at most five matching MR pipelines, and selects a successful `mutation:review` job. The adapter then verifies the artifact's project, MR, job, pipeline and head provenance before atomically writing the local evidence file. No matching completed job means no proposal.

GitLab's [documented flow execution environment](https://docs.gitlab.com/user/duo_agent_platform/flows/execution/execution-variables/) filters out custom project/group CI variables and `CI_COMMIT_SHA`. The hydration code therefore uses the documented `CI_PROJECT_ID`, `DUO_WORKFLOW_GIT_HTTP_BASE_URL` or `GITLAB_BASE_URL`, and optional `GITLAB_TOKEN` OAuth access with a Bearer header. It does not assume that a flow inherits `GITLAB_MR_IID`, an artifact job ID, or an operator write token from Settings > CI/CD > Variables. Actual OAuth permissions and artifact visibility still require a tenant check; a rejected read stops hydration without exposing credentials.

Outside Duo, a trusted operator may explicitly set `GITLAB_PROJECT_ID`, `GITLAB_URL`, `GITLAB_READ_TOKEN`, and both `GITLAB_MR_IID` and `GITLAB_EVIDENCE_JOB_ID` to select an exact artifact. The same provenance and checkout checks apply. The read credential is optional when the project's public artifact settings permit anonymous reads. `GITLAB_WRITE_TOKEN` is never used as a hydration fallback.

The agent receives the hydration result separately from model interpretation. A tool invocation that returned is not itself evidence that the command succeeded. The prompt requires `status: hydrated`; a failed hydration leaves no stale local fixture. The current tenant has not executed either schema variant or this hydration path against a real completed mutation job.

## Approvals and exact repair branches

The core command parser accepts exact application commands using the configured handle. The adapter validates the fetched note author's active unlocked non-bot account, project membership live, current MR head, proposal/run/finding IDs, expiry, exact before/after patch hash, and one-use reservation. Apply requires Maintainer access in this adapter. The human must inspect the full before/after test change and its hash before issuing the exact command. A mention by itself never authorizes an arbitrary patch.

`override` has strict command parsing and a pure approval predicate, including the written-reason requirement. Gate waiver execution is not implemented. No `Passed with human waiver` result is claimed.

`GitLabAdapter.commitApprovedTests` requires an `ApprovalLedger`. `FileApprovalLedger` provides atomic single-host event reservation and durable outcomes. Configure its absolute directory outside the checkout and restrict its OS permissions; a multi-host deployment needs a shared atomic trusted ledger. Never accept a browser-supplied ledger or approval record as authenticated identity. The trusted operator CLI re-fetches each actual GitLab note, its author, current project membership, and current MR head before accepting its exact command. An automatic webhook receiver is not provided.

The adapter creates an isolated `mutant-review/<patch-hash>-<random-uuid>` branch from the exact approved parent. It returns `sourceBranchUpdated: false`. A fresh unpredictable branch prevents an earlier branch from changing the parent. This avoids treating GitLab's per-file conflict check as a branch-wide atomic compare-and-swap. Human review and integration into the demonstration MR remain separate. After integration, call `ensureMergeRequestPipeline` and require the returned pipeline SHA to match the repair SHA. A push alone is insufficient, particularly with `CI_JOB_TOKEN`.

### Run the assisted operator CLI

Run this on a trusted single operator host, outside untrusted MR jobs. Keep its durable state directory outside the checkout. Use a narrow server-side write credential for the configured demonstration project. Neither the write credential nor the state directory belongs in the public dashboard runtime.

```text
GITLAB_PROJECT_ID=88030103
GITLAB_FLOW_HANDLE=<actual @flow-service-account>
GITLAB_WRITE_TOKEN=<trusted-operator write credential>
MUTANT_REVIEW_STATE_DIR=<absolute durable directory outside the repository>
```

The CLI uses the fixed configured project. Its GitLab note IDs come from the actual MR, not browser-supplied identities. A separate explicit command authorizes each action:

```sh
# Confirm readable project/MR capabilities.
npx tsx packages/cli/src/index.ts capabilities <MR-IID>

# Import and validate actual structured Duo output against measured survivors.
# Publishes the exact visible test patch and canonical content/revision hash.
npx tsx packages/cli/src/index.ts publish <MR-IID> <evidence-job-ID> <triage.json> [retrieval-ID]

# After a maintainer posts the displayed @handle apply proposal-id hash:
npx tsx packages/cli/src/index.ts apply <proposal-ID> <GitLab-note-ID>

# After a separate newer @handle verify proposal-id hash:
npx tsx packages/cli/src/index.ts verify <proposal-ID> <GitLab-note-ID>

# Inspect the exact verified candidate lesson and its different lesson hash.
npx tsx packages/cli/src/index.ts prepare-lesson <proposal-ID>

# After a separate @handle learn lesson-id lesson-hash:
# The CLI lookup key remains the original repair proposal ID.
npx tsx packages/cli/src/index.ts learn <repair-proposal-ID> <GitLab-note-ID>
```

`publish` refuses incomplete, stale, wrong-project, wrong-job, or unsupported targeted evidence. Submitted JSON is not proof Duo produced it: retain and link the actual Duo session separately. `apply` commits only the exact approved additive test on a separate branch. `verify` fetches immutable GitLab commit contents, confirms approved tests and unchanged production files, runs the original and exact mutant twice locally with write credentials removed from the subprocess environment, and separately ensures a branch pipeline exists. A started/existing pipeline is not a successful CI outcome; the receipt labels these evidence states separately.

`prepare-lesson` requires a successful fresh receipt. It displays exact candidate semantic content before human approval. `learn` commits those semantics on a separate lesson branch, adding only deterministic actual-approver/time metadata and the approved candidate hash. Human review and merge are required before later repository lesson retrieval can find it. No command merges or deploys. `sandbox-verify` remains the separate unapproved local experiment.

Persistent state records proposals, published hashes, one-use events, applied commits, bounded verification attempts, receipts, and lesson drafts. Independent ephemeral GitLab jobs do not share this journal. A distributed dispatcher needs trusted shared atomic storage or a single protected operator runner. The CLI provides a manually invoked assisted workflow; automatic mention-event ingestion remains open work.

## Lessons and release

`npm run lessons -- boundary` retrieves at most three applicable versioned approved lessons with repair evidence. The initial approved-lesson directory is empty. A candidate lesson is not approved memory, and retrieval is not demonstrated application. The operator workflow saves lessons only after actual verification and separate human approval, in a separate branch to preserve the repair revision.

When retrieval runs against unchanged approved lessons at the checked-out revision with trusted external operator state configured, its output can include a `retrievalId`. Passing that ID as the optional fourth `publish` argument binds the same project/revision and cited lesson rationale to a later proposal. Only a successful fresh repair receipt can mark that submitted-triage application verified; it still does not establish Duo generated the triage. Normal ephemeral Duo jobs have no external operator journal by default: they can retrieve versioned approved lessons, but retrieval alone does not produce application evidence.

No Cloud Run deployment, container publication, deployment approval, or public smoke check is claimed. Add release automation only after the approved repair and lesson loop runs in GitLab. Use workload identity and a separate protected deployment environment; never add deployment credentials to MR jobs.
