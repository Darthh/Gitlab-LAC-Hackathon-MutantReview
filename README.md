<p align="center">
  <img src="docs/assets/mutant-review-logo.png" alt="MutantReview logo: the original emerald M with horns and a single eye beside the navy wordmark" width="720">
</p>

<h1 align="center">MutantReview</h1>

<p align="center"><strong>Mutation testing for AI-written code.</strong><br>Find the gaps. Prove the tests. Keep a human in control.</p>

<p align="center">
  <a href="https://gitlab.com/mutant-review1/mutant-review/-/pipelines"><img src="https://gitlab.com/mutant-review1/mutant-review/badges/main/pipeline.svg" alt="GitLab pipeline status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-008D72" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/GitLab_Duo-Assisted-008D72" alt="GitLab Duo assisted workflow">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.12-333333" alt="Node.js 22.12 or newer">
</p>

<p align="center">
  <a href="https://gitlab.com/mutant-review1/mutant-review">GitLab project</a> &middot;
  <a href="https://gitlab.com/mutant-review1/mutant-review/-/merge_requests/1">Demo MR</a> &middot;
  <a href="benchmarks/RESULTS.md">Benchmark</a> &middot;
  <a href="docs/demo.md">Demo walkthrough</a> &middot;
  <a href="docs/setup.md">Setup</a>
</p>

**100% coverage. 0 bugs caught.** Coverage tells you which lines ran, not whether any test would notice them breaking.

Mutant Review is a GitLab Duo agent that mutation-tests **only the lines a merge request changes**, surfaces at most three changes no test would notice, and drafts a test for each. Every draft must **pass on the code and fail on the mutant** before a human sees it. A human approves the tests; the agent commits them, re-runs the mutants, and records the lesson in `AGENTS.md`.

Built for the [GitLab Transcend hackathon](https://gitlab-transcend.devpost.com/), **Path A · Assisted**. The [verification status](#status) separates live GitLab evidence, automated checks, and integrations awaiting their first live run.

## Contents

- [Judging in 60 seconds](#judging-in-60-seconds)
- [What Mutant Review implements](#what-mutant-review-implements)
- [The problem](#the-problem)
- [What the reviewer sees](#what-the-reviewer-sees)
- [How it works](#how-it-works)
- [When the agent edits the tests](#when-the-agent-edits-the-tests)
- [Catch it before you push](#catch-it-before-you-push)
- [Footprint, measured](#footprint-measured)
- [DevSecOps stages covered](#devsecops-stages-covered)
- [Measured, not claimed](#measured-not-claimed)
- [Front Desk](#front-desk)
- [Run it](#run-it)
- [Technology and repository map](#technology-and-repository-map)
- [Contributing and license](#contributing-and-license)

## Judging in 60 seconds

[![Front Desk Overview in the current dark UI: 100% branch coverage, 80% mutation score, and a blocked merge gate](docs/images/front-desk-overview.png)](docs/images/front-desk-overview.png)

*Current Front Desk UI, captured with local demo evidence. Click a screenshot to view it at full size.*

| Start here | What the evidence shows |
| --- | --- |
| **A green suite with a gap** | [MR !1](https://gitlab.com/mutant-review1/mutant-review/-/merge_requests/1) has 100% branch coverage, but `>=` can become `>` without a test failing. The [mutation gate blocks the merge](https://gitlab.com/mutant-review1/mutant-review/-/jobs/17440386477). |
| **Real merged changes** | **11 of 25** analyzed es-toolkit PRs had a changed line with an undetected mutation. A survivor is a change no test noticed, not a proven bug. [Method and results](benchmarks/RESULTS.md). |
| **One drafting agent** | The [Duo flow](.gitlab/duo/mutant-review.yml) runs deterministic preparation, one model call, and deterministic verification. Drafts are executed against their mutants before review. |
| **A repair you can reproduce** | `npm ci && npm run test:e2e` keeps the boundary test, rejects a useless draft, and applies an approved repair: **80% → 100%**. It also checks an uncommitted edit and verifies a draft through MCP. GitLab is mocked in this suite. |
| **Protection for the tests** | The same e2e suite uses real git, Vitest and Stryker to show that loosening an assertion blocks the gate and names the lost protection; a rename-only test refactor still passes. [How it works](#when-the-agent-edits-the-tests). |
| **Measured review cost** | Each review writes an SCI receipt to the MR comment, metrics widget and Front Desk. The demo receipt is **17 mgCO2e**, using measured CPU time and a carbon model. [Method and limits](docs/sustainability.md). |

## What Mutant Review implements

| Capability | Implementation |
| --- | --- |
| Changed-line mutation testing | Stryker runs on the MR's changed lines; deterministic triage ranks at most three findings. |
| Tests proved by execution | A proposed test must pass on the current code and fail on its mutant. Useless drafts are rejected before human review. |
| Human-controlled repairs | A human replies `@mutant-review apply 1 and 3`; deterministic checks bind approval to the actor, proposal and MR head before a commit. |
| Protection against weakened tests | Re-run the target branch's caught mutants against the MR's tests. Loosened, deleted or skipped protection blocks the gate. |
| Checks before the push | The same engine exposes `mutation_check` and `verify_test` over MCP for GitLab Duo Agentic Chat, Claude Code and other MCP clients. |
| Repository memory | Approved repairs add a test, ledger entry and lesson to `AGENTS.md`. |
| Review footprint | Each review records an SCI receipt using process-tree CPU time, energy and carbon models, with the assumptions and range exposed. |
| Evidence console | Front Desk brings findings, test changes, verification, repair history and footprint into a read-only React console. |

These capabilities have different verification states. See [Status](#status) for what has run on GitLab, what is covered by automated tests, and what is wired but awaiting a live run.

## The problem

When an agent writes both the code and the tests, the tests tend to mirror the implementation or assert on mocks. They stay green forever and protect nothing. Human review won't catch it either: on teams with high AI adoption, [PR review time rose 91%](https://www.faros.ai/research/ai-productivity-paradox) while merged PRs nearly doubled.

Google solved a version of this years ago: mutation-test only the changed lines during code review and surface the mutants that survive. Developers who saw them [wrote more tests and strengthened their suites](https://arxiv.org/abs/2103.07189). GitLab merge requests have nothing like it. Now they do.

There is a second failure that changed-line review alone can't see: the agent makes a red build green by changing the test. [ImpossibleBench](https://arxiv.org/abs/2510.20270) gave frontier coding agents SWE-bench tasks whose tests contradict the spec, so any pass is a cheat: GPT-5 "passed" 54% of them and Claude Opus 4.1 about half, and for Claude models more than 79% of those cheats modified the test cases. Read-only tests stopped the test edits in the benchmark, but an agent whose job includes writing tests can't work with read-only tests. So Mutant Review lets agents edit tests and checks, by execution, that the edit didn't remove protection.

## What the reviewer sees

An example of the summary comment `flow publish` writes, for the demo MR's measured result (`@mutant-review` stands for the flow's service account, `@ai-mutant-review-evidence-triage-mutant-review` in the demo project):

```text
Mutant Review: 1 change on your changed lines that no test would notice
Changed-line mutation score 75% (3 of 4 mutants killed). Policy 90%. Gate: failed.

| # | Where                    | Change no test noticed                          | Verified test                          |
| 1 | shipping.ts:4            | subtotalCents >= 10_000 → subtotalCents > 10_000 | ✅ ships free at exactly $100 kills it  |

1 AI-drafted test rejected by execution before you saw it. A test that still passes on the mutant protects nothing.
Reply `@mutant-review apply 1` to commit this verified test. Approving also adds "Untested boundary value" to AGENTS.md.
```

Inline on line 4: *"Changing `>=` to `>` fails no test. An order of exactly $100 is untested."* with the test that kills it.

And when an MR loosens that test later, the same comment leads with what was lost (the demo fixture's measured result):

````text
Mutant Review: this MR's test changes stopped 1 change(s) from being noticed
No changed source lines to mutate. Gate: failed.

Lost protection
1. shipping.ts:4: when `subtotalCents >= 10_000` became `subtotalCents > 10_000`,
   `ships free at exactly $100 (SHIPPING-001)` failed on the target branch ("expected 500 to be +0").
   This MR changed that test and it no longer fails.
   ```diff
    it('ships free at exactly $100 (SHIPPING-001)', () => {
   -  expect(shippingFee(10_000)).toBe(0);
   +  expect(shippingFee(10_000)).toBeLessThanOrEqual(500);
    });
   ```
````

## How it works

```mermaid
flowchart LR
  Agent["Coding agent<br/>(Duo Agentic Chat, Claude Code)"] --> Pre["MCP before push:<br/>mutation_check, verify_test"]
  Pre --> MR[MR pipeline]
  MR --> S[Stryker on changed lines only<br/>+ SCI receipt]
  MR --> LP[Tests edited? Re-run the target branch's<br/>caught mutants against them]
  LP -->|lost protection| T
  S --> W[MR widgets: Code Quality, metrics]
  S --> T[Deterministic triage<br/>drop arid mutants, rank, cap at 3]
  T --> G{Mutation gate}
  T --> C[CI comment: findings]
  C --> M["Human: @mutant-review"]
  M --> F1[Duo flow: one model call drafts tests]
  F1 --> V[Execute each draft:<br/>pass on code AND fail on mutant]
  V -->|rejected drafts never shown| X[(ledger)]
  V --> P[≤3 inline comments with verified tests]
  P --> A["Human: @mutant-review apply 1 and 3"]
  A --> R[Commit tests, re-run Stryker,<br/>post score delta, update AGENTS.md]
  R --> G
  G -->|pass or audited override| Merge --> Build[Cloud Build image] --> Run[Cloud Run + smoke + rollback] --> Mon[Scheduled monitor]
```

1. **Mutate only the diff.** Every MR pipeline computes changed line ranges and runs StrykerJS on just those lines (`path:start-end`), with incremental caching. It also measures how many mutants the whole changed files would have produced, so the compute saved is a measured number.
2. **Filter the noise without a model.** Deterministic triage drops *arid* mutants (logging, error-message text, log-only blocks), keeps one finding per line, ranks boundary and branch changes first, and comments on at most three.
3. **One cheap model call.** The Duo flow's single `AgentComponent` drafts one test per finding, deriving expected values from `CONTRACTS.md` and doc comments, guided by the rules in `AGENTS.md`.
4. **Execution is the hallucination check.** Each draft must pass on the current code **and** fail on its mutant (a fresh Stryker run on that line), or it is rejected and logged. `npm run test:e2e` proves this on every pipeline: the boundary test is kept, a plausible `shippingFee(10_001)` test is rejected.
5. **Assisted by design.** Nothing is committed until a human replies `@mutant-review apply 1 and 3`. Only humans can fire a GitLab mention trigger, the flow's composite identity can never exceed that person's permissions, and deterministic code re-checks the author's role, the proposal's author and hash, and the MR head before writing.
6. **Learn once.** The approval commit adds the tests, a ledger entry, and a lesson to `AGENTS.md`, which GitLab Duo agents (and Claude Code, Codex, Cursor) read on every task.
7. **Merge gate.** The changed-line mutation score must clear `.mutant-review/policy.json` (90%), or a Maintainer comments `@mutant-review override <reason>`. The gate verifies the comment came after the latest push, records the reason, and opens a *test debt* issue. An MR with no mutable changed lines exits as a warning (`no-applicable-scope`), never as a pass and never as a block; docs-only MRs skip the mutation jobs entirely.
8. **Native MR widgets.** `mutation:review` publishes a Code Quality report (each unnoticed change on its line, with a stable fingerprint, so GitLab marks it *fixed* once a test kills it; lost protection as *critical*) and a metrics report (score, unnoticed changes, lost protection, mutants avoided, review energy and SCI, compared with the target branch).
9. **Guard the tests themselves.** When an MR edits, moves or deletes a test, the lost-protection check (below) compares what the target branch's tests caught with what the MR's tests catch. Anything lost fails the gate, is ranked first among the findings, and gets a drafted, execution-verified test like any other finding.

## When the agent edits the tests

The changed-line review answers "do the tests notice changes to the new code?". It can't answer "did this MR make the tests notice less?", because a test-only MR has no changed source to mutate. Before this check, such an MR left the gate at `no-applicable-scope`: a warning, not a block. Coverage can't help either: a loosened assertion still executes every line.

[![Front Desk Test changes in the current dark UI: the exact-$100 test was loosened, so the boundary mutation is no longer caught](docs/images/front-desk-protection.png)](docs/images/front-desk-protection.png)

[`packages/review-core/src/protection.ts`](packages/review-core/src/protection.ts) (pure) and [`packages/cli/src/protection.ts`](packages/cli/src/protection.ts) (runs it) do three things, only when the MR edits, moves or deletes an existing test file:

1. **Mutate the target branch, narrowly.** In a detached worktree of the target branch: the changed test files that are part of the mutation run (`vitest list`), the production files they import, and Stryker on just those files with the project's own (protected) configuration.
2. **Keep what the edited tests caught.** Only mutants a changed test killed there. Mutants that only unchanged tests killed are still killed by them; mutants on lines the MR also changed belong to the changed-line review.
3. **Re-run only those at the head.** Same file, same line (mapped through the diff), same mutation. Killed before and not now is protection the MR removed. The result names the test that caught it, the failure it produced on the target branch, and whether the MR *weakened* that test (still there, no longer fails) or *removed* it (deleted, renamed or skipped), with the before/after test block.

It fails closed: a mutant that can't be re-checked, a Stryker failure, or an over-budget run blocks the merge with the reason (a Maintainer can waive it in writing), never a pass. Renamed source files are followed, barrel re-exports are resolved, and test file names are read NUL-separated so none is skipped. Only an MR that changes nothing but tests can pass on this check alone: it now **passes** the gate on evidence (`N re-checked, 0 lost`) instead of warning. And since agents can also silence the evaluator itself, mutants disabled with `// Stryker disable` on changed lines need the same written waiver as a survivor, and `.gitattributes` (which can hide a diff as binary) is a protected path. The flow drafts a restoring test (verified against the mutant like every draft), `apply` proves it by re-running those lines, and the approval teaches `AGENTS.md`: *never make a failing test pass by loosening, deleting or skipping it*. Agents get the same check before they push: `mutation_check` reports lost protection with the diff of the test they weakened.

## Catch it before you push

The useless test is cheapest to catch before the MR exists. `packages/cli/src/mcp.ts` is a dependency-free MCP server (stdio) with two read-only tools:

- **`mutation_check`** mutation-tests the TypeScript lines changed since the branch left the default branch, uncommitted edits included, and returns the changes no test would notice, the code around each, the requirement docs and the repository's learned testing rules.
- **`verify_test`** executes a draft test for a finding: *verified* only if it passes on the current code and fails on the mutant. The file is restored either way; the agent adds the test only when it is verified.

[`.gitlab/duo/mcp.json`](.gitlab/duo/mcp.json) registers it for GitLab Duo Agentic Chat and the Software Development Flow (IDE and CLI); [`.mcp.json`](.mcp.json) does the same for Claude Code. AGENTS.md tells every agent to call it before finishing. Without an agent: `npm run check` (exit 1 when a changed line has a change no test notices, so it works as a pre-push hook).

## Footprint, measured

Every review records an [SCI](https://greensoftware.foundation/standards/sci/) receipt per merge-request review: CPU time measured from the process tree, Cloud Carbon Footprint's GCP power model, Google's grid intensity for the runner's region, and the embodied share of the host, with a low–high range. The receipt also projects what mutating the whole changed files would have cost, so the saving from scoping is shown per MR, not claimed once.

[![Front Desk Footprint in the current dark UI: review carbon intensity, energy and CPU time, and region comparisons](docs/images/front-desk-footprint.png)](docs/images/front-desk-footprint.png)

Design choices that keep it small, each with its evidence: mutate only the diff (74% of mutants avoided on es-toolkit), no model call in CI, one model call per human request, verify drafts before a human reads them, interruptible jobs, no mutation on docs-only MRs, learn once in AGENTS.md. Full method, boundary and limitations: [docs/sustainability.md](docs/sustainability.md). Executed on the same 25 es-toolkit PRs ([ENERGY.md](benchmarks/ENERGY.md)), changed-line scoping used **49% less energy** than mutating the whole changed files (4.26 vs 8.30 Wh), the per-MR projection was within 15% (median), and triage kept 92% of the per-finding prompt context out of the model. `benchmarks/energy.ts` reproduces it, also as the manual `benchmark:energy` CI job on GitLab's hosted runner.

## DevSecOps stages covered

| Stage | What Mutant Review does |
| --- | --- |
| **Plan** | Gate overrides open a `test-debt` issue listing the waived mutants and any protection the MR removed |
| **Create** | The agent commits human-approved tests to the MR branch |
| **Verify** | Stryker on changed lines, lost-protection check on edited tests, unit and e2e suites, verified-by-execution drafts, pre-push `mutation_check` over MCP, Code Quality MR widget |
| **Secure** | SAST and secret detection; protected evaluator paths; drafts run without credentials |
| **Package** | CI execution evidence and one Front Desk image built by Cloud Build for deployment |
| **Release** | Cloud Run deploy with smoke test and automatic traffic rollback |
| **Configure** | Policy, flow, MCP and agent memory as code: `policy.json`, `agent-config.yml`, `.gitlab/duo/mcp.json`, `AGENTS.md` |
| **Monitor** | Scheduled smoke monitor; per-MR SCI footprint in the metrics widget; Front Desk console of repairs, compute saved and carbon |
| **Govern** | Required mutation gate (changed-line score and lost protection), audited Maintainer overrides, append-only repair ledger |

## Measured, not claimed

- **Energy, executed:** both arms of that comparison were run, not projected: 2,088 vs 4,268 CPU-seconds, 49% less energy for changed lines ([ENERGY.md](benchmarks/ENERGY.md)).
- **Open-source benchmark:** [es-toolkit](https://github.com/toss/es-toolkit) (MIT, 11k★) describes itself as "battle-tested with 100% test coverage". Run over its last 25 merged PRs, the gate found that **11 shipped a changed line where a behaviour change survived every test** (178 surviving mutants). Scoping to changed lines ran 1,057 mutants instead of 4,088 (74% avoided), 18 seconds median per PR. A survivor is a change no test noticed, not a proven bug; survivors were not human-reviewed. Methodology, all 14 exclusions and per-PR results: [benchmarks/RESULTS.md](benchmarks/RESULTS.md).
- **Live GitLab MR:** [pipeline 2984978409](https://gitlab.com/mutant-review1/mutant-review/-/pipelines/2984978409) on [!1](https://gitlab.com/mutant-review1/mutant-review/-/merge_requests/1): 100% branch coverage, 4 mutants, 1 survivor, 75% changed-line score, [gate failed](https://gitlab.com/mutant-review1/mutant-review/-/jobs/17440386477) and blocked the merge.
- **Local proof:** `npm run demo` reproduces it in about 20 seconds and writes every raw artifact under `evidence/`.

### Status

| | |
| --- | --- |
| Verified on GitLab | Changed-line review and the gate blocking !1; the custom flow enabled and executing in a GitLab Duo workload ([pipeline 2985096882](https://gitlab.com/mutant-review1/mutant-review/-/pipelines/2985096882)) |
| Verified by automated tests | Lost protection with real git, Vitest and Stryker in scratch repositories (`packages/cli/src/protection.e2e.ts`): a loosened assertion fails the gate and names the test, a rename-only refactor passes, deleted tests lose everything they guarded; arid triage, `apply 1 and 3` parsing and refusals, audited override, AGENTS.md memory, SCI footprint model (hand-worked example), Code Quality and metrics reports, and with real Vitest + Stryker (`npm run test:e2e`, GitLab mocked): draft verification, then `apply 1` committing the test, ledger, lesson and AGENTS.md with the score going 80% → 100%; the MCP server over stdio checking an uncommitted edit and verifying an agent's draft |
| Wired, first live run pending | The lost-protection check on a GitLab MR (branch `demo/weakened-test`, see [docs/setup.md](docs/setup.md)); the new flow's draft → verify → `apply` loop on !1, and the Cloud Run deploy (needs the GCP variables in [docs/deploy.md](docs/deploy.md)); the Code Quality and metrics MR widgets, `rules: changes` and the warning exit on the gate, the `benchmark:energy` job on GitLab's runner (the same benchmark has been executed in a cloud container: [ENERGY.md](benchmarks/ENERGY.md)), and Duo Agentic Chat using `.gitlab/duo/mcp.json` |

## Front Desk

A read-only console (React + Express) for the reviewer and the team lead: the changed-line score and gate, the ranked findings and the arid mutants filtered out, the **ledger of useless tests caught and repaired** (and AI drafts rejected), and **compute saved**: mutants avoided by diff scoping, mutants filtered before any model call, model calls avoided, and lessons in agent memory. The **Test changes** page shows the lost-protection check: what the edited tests caught on the target branch, what they still catch, and for each loss the catching test and its before/after (the deployed demo runs it for real on a second fixture MR that loosens the exact-$100 test). The **Footprint** page breaks each review's SCI into energy, grid intensity and embodied share, shows where the energy went step by step, and re-prices the same measured work in other regions. It deploys to Cloud Run from `main`.

The current GitLab-style dark interface uses charcoal panels, compact navigation and Mutant Review's emerald accents. The screenshots use local demo evidence and cover all six pages: Overview, Findings, Test changes, Verification, Work ledger and Footprint.

**Findings** shows the surviving mutation, its priority and the untested shipping boundary.

[![Front Desk Findings in the current dark UI: the triaged surviving mutant and the exact-$100 shipping boundary](docs/images/front-desk-findings.png)](docs/images/front-desk-findings.png)

<details>
<summary>Verification: execution evidence for proposed tests</summary>

[![Front Desk Verification in the current dark UI: evidence used to verify proposed tests before human approval](docs/images/front-desk-verification.png)](docs/images/front-desk-verification.png)

</details>

<details>
<summary>Work ledger: review and repair history</summary>

[![Front Desk Work ledger in the current dark UI: recorded review activity and repair outcomes](docs/images/front-desk-ledger.png)](docs/images/front-desk-ledger.png)

</details>

## Run it

Requires Node 22.12+ (CI pins 24.16).

```sh
npm ci
npm test            # unit tests
npm run test:e2e    # real Stryker: good AI draft kept, hallucinated draft rejected, loosened test blocked
npm run demo        # mutation-review the demo checkout contract (with its SCI receipt)
npm run check       # pre-push: mutation-check your uncommitted changes
npm run dev         # Front Desk at http://localhost:4173
```

GitLab setup (flow, triggers, CI variable, required pipelines) and Google Cloud deployment: [docs/setup.md](docs/setup.md) and [docs/deploy.md](docs/deploy.md).

## Technology and repository map

| Layer | Stack |
| --- | --- |
| Review engine | TypeScript, StrykerJS, Vitest. |
| Agent workflow | GitLab Duo custom flow, GitLab CI, MCP over stdio. |
| Front Desk | React, Vite, Express, Lucide icons. |
| Release and monitoring | Cloud Build, Google Cloud Run, smoke checks and rollback. |
| Evidence | Mutation reports, repair ledger, repository lessons, Code Quality and metrics reports, SCI receipts. |

| Path | Responsibility |
| --- | --- |
| [`packages/review-core/`](packages/review-core) | Pure functions for diff scope, scoring, gate, override, triage, lost protection, commands, memory, SCI and MR reports. |
| [`packages/cli/`](packages/cli) | Vitest/Stryker execution, CPU-time measurement, target-branch worktrees, `flow prepare \| publish \| notify`, gate, demo, `check` and MCP server. |
| [`packages/gitlab-adapter/`](packages/gitlab-adapter) | The only GitLab API client, scoped to one project. |
| [`.gitlab/duo/mutant-review.yml`](.gitlab/duo/mutant-review.yml) | Deterministic preparation, one drafting agent, deterministic verification and publication. |
| [`.gitlab-ci.yml`](.gitlab-ci.yml) and [`ci/release.gitlab-ci.yml`](ci/release.gitlab-ci.yml) | MR review and gate, packaging, Cloud Run deployment and monitoring. |
| [`apps/front-desk/`](apps/front-desk) | Overview, Findings, Test changes, Verification, Work ledger and Footprint pages. |
| [`packages/demo-domain/`](packages/demo-domain) | Demo contracts and their intentionally incomplete baseline tests. |
| [`benchmarks/`](benchmarks) | The es-toolkit study and executed comparison of changed-line and whole-file energy use. |
| [`docs/`](docs) | Architecture, setup, deployment, demo walkthrough, sustainability method and limitations. |

Read the [architecture](docs/architecture.md), [GitLab setup](docs/setup.md), [deployment guide](docs/deploy.md) and [limitations](docs/limitations.md) for the operational details.

## Contributing and license

Keep changes focused and follow [AGENTS.md](AGENTS.md). Run the relevant checks before submitting a change; edits to TypeScript also require `npm run check`. Never make a failing test pass by loosening, deleting or skipping its assertion. Derive new tests from the written contract and verify they catch their target mutation.

The **Mutant Review** logo is the original emerald, single-eyed M, also used in the app's top-left header and favicon. Brand accents use the matching emerald green (`#009777`). The [README wordmark](docs/assets/mutant-review-logo.png) has a light background for readability in both themes; the [transparent original](docs/assets/mutant-review-logo-transparent.png) is available for reuse.

Code is distributed under the [MIT License](LICENSE). Third-party names and marks belong to their respective owners.
