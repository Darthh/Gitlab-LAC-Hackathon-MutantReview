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

Push the repository to the GitLab project and enable a compatible runner. Open an MR that changes the shipping implementation. The pipeline runs baseline tests and measured coverage, then blocks on `mutation:review`. Playing that job authorizes a bounded mutation run only. It cannot approve a repair, lesson, merge, or deployment. The next job evaluates the deterministic gate and preserves diagnostics on failure.

Turn on **Settings > Merge requests > Merge checks > Pipelines must succeed**. Record a demonstration MR link and a failed mutation-gate job proving merge blocking. Do not claim it works merely because `.gitlab-ci.yml` exists. Protect the default branch, review CI/policy/evaluator changes as a Maintainer, and keep an authoritative policy/evaluator outside an unreviewed MR for hostile-repository use. The current gate detects protected-path changes and fails; it is a single-project MVP, not a hardened external policy service.

The review command requires `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`, `CI_COMMIT_SHA`, and `CI_MERGE_REQUEST_DIFF_BASE_SHA`. It fetches a missing comparison base and records the exact revision. A test-only MR returns no applicable changed-source scope, never a green mutation assessment. `GIT_DEPTH: 0` reduces shallow-clone problems.

To run a diagnostic proof independently of a failed MR pipeline, create a web/API pipeline with `MUTANT_ACTION=sandbox-proof` and play `repair:sandbox-proof`. It runs an isolated experiment, without changing the MR. This job is deliberately named as a sandbox proof; it is not a verified approved repair.

## Enable the Duo custom flow

1. Confirm the tenant permits custom flows, has the necessary GitLab Duo access/credits, and can run its configured tools. The observed UI requested a Duo trial; no Duo session has been executed yet.
2. Import `.gitlab/duo/mutant-review.yml` into a custom flow in the AI Catalog and enable it for this project. `.gitlab/duo/agent-config.yml` supplies the Node execution environment. Accepting a schema in documentation is different from this tenant accepting and executing it.
3. Confirm `DeterministicStepComponent`, `run_command` with its `command` argument, `AgentComponent`, `read_file`, and `list_dir` are available in that tenant. If the deterministic tool schema differs, adjust against the actual tool schema and preserve the fixed lesson-retrieval command. Do not replace it with guessed Human Input syntax.
4. Configure a mention trigger and record the real service-account handle in `GITLAB_FLOW_HANDLE`. Never advertise `@mutant-review` as a configured account until verified.
5. Make the exact measured evidence artifact available in the flow checkout. Run the flow against the same source SHA. It retrieves approved lessons with a fixed CLI call, reads the relevant measured evidence and contract, and returns a JSON triage proposal. It has no write or commit tools.
6. Validate the returned JSON with review-core, preserve its Duo session link, and publish the finding through the scoped adapter. The adapter caps inline findings at three and falls back to the summary when it cannot map a changed line to current diff coordinates.

The prepared flow follows GitLab's [custom-flow YAML restrictions](https://docs.gitlab.com/user/duo_agent_platform/flows/custom_flows_schema/) and [flow registry v1 reference](https://gitlab.com/gitlab-org/modelops/applied-ml/code-suggestions/ai-assist/-/blob/main/docs/flow_registry/v1.md). It does not claim unsupported per-prompt model selection, an exact provider-request count, or native built-in `review`/`apply` commands.

## Approvals and exact repair branches

The core command parser accepts exact application commands using the configured handle. The adapter validates actor membership live, current MR head, proposal/run/finding IDs, expiry, exact before/after patch hash, and one-use reservation. Apply requires Maintainer access in this adapter. The human must inspect the full before/after test change and its hash before issuing the exact command. A mention by itself never authorizes an arbitrary patch.

`GitLabAdapter.commitApprovedTests` requires an `ApprovalLedger`. `FileApprovalLedger` provides atomic single-host event reservation and durable outcomes. Configure its absolute directory outside the checkout and restrict its OS permissions; a multi-host deployment needs a shared atomic trusted ledger. Never accept a browser-supplied ledger or approval record as authenticated identity. The event receiver must re-fetch the GitLab note and its author before calling this API. A production event receiver is not yet wired.

The adapter creates an isolated `mutant-review/<patch-hash>-<random-uuid>` branch from the exact approved parent. It returns `sourceBranchUpdated: false`. A fresh unpredictable branch prevents an earlier branch from changing the parent. This avoids treating GitLab's per-file conflict check as a branch-wide atomic compare-and-swap. Human review and integration into the demonstration MR remain separate. After integration, call `ensureMergeRequestPipeline` and require the returned pipeline SHA to match the repair SHA. A push alone is insufficient, particularly with `CI_JOB_TOKEN`.

## Lessons and release

`npm run lessons -- boundary` retrieves at most three applicable versioned approved lessons with repair evidence. The initial approved-lesson directory is empty. A candidate lesson is not approved memory, and retrieval is not demonstrated application. Save a lesson only after actual verification and separate human approval, in a separate lesson change if necessary to preserve the repair revision.

No Cloud Run deployment, container publication, deployment approval, or public smoke check is claimed. Add release automation only after the approved repair and lesson loop runs in GitLab. Use workload identity and a separate protected deployment environment; never add deployment credentials to MR jobs.
