# Devpost submission text

Paste-ready. Replace bracketed items only with results you have actually observed.

**Name:** Mutant Review
**Tagline:** Your tests passed. Would they notice the code breaking, and did the agent just loosen them?
**Path / level:** Path A (Start Fresh), Assisted. Also entering Most Creative, Most Stages Covered and **Most Environmentally Impactful** (opt in on the form; the SCI analysis is below and in `docs/sustainability.md`).
**Images:** cover / YouTube thumbnail `docs/images/cover.png` (1280×720); gallery `docs/images/front-desk-overview.png`, `docs/images/front-desk-protection.png`, `docs/images/front-desk-findings.png`, `docs/images/front-desk-footprint.png`.

## Inspiration

Coverage tells you which lines ran, not whether any test would notice them breaking. When an agent writes both the code and the tests, the tests often mirror the implementation or assert on mocks. They stay green forever and protect nothing. Human review won't catch it: on teams with high AI adoption, PR review time rose 91% (Faros AI, 2025). Google solved a version of this by mutation-testing only the changed lines during code review; developers who saw surviving mutants wrote more and better tests (Petrović et al., ICSE 2021). GitLab merge requests had nothing like it.

And there is a failure no coverage report or changed-line check can see: the agent turns a red build green by changing the test. In ImpossibleBench (Zhong, Raghunathan and Carlini, 2025), frontier agents given SWE-bench tasks whose tests contradict the spec "passed" about half of them anyway; for Claude models, more than 79% of those cheats modified the test cases. Read-only tests stop that, but an agent whose job includes writing tests can't work with read-only tests.

## What it does

On every merge request, Mutant Review runs StrykerJS on only the changed lines and computes a changed-line mutation score. Deterministic triage removes noise (logging, error-message text) and ranks at most three findings, such as "Flipping `>=` to `>` on line 4 fails no test. A cart of exactly $100 is untested."

When a developer mentions the agent, a GitLab Duo custom flow makes one model call to draft a test for each finding, deriving the expected value from the written contract. Then comes the part we're proudest of: **every AI-drafted test is executed against its mutant before a human sees it.** A draft must pass on the current code and fail on the mutant; otherwise it is rejected and logged as a blocked hallucination. Verified tests appear as at most three inline MR comments.

Nothing is committed until a human replies `@mutant-review apply 1 and 3`. Only humans can fire a mention trigger, and the flow's composite identity can't exceed that person's permissions. The agent re-checks the role, the proposal author and hash and the MR head, commits the tests, re-runs Stryker on the same lines and posts the score change. The same commit writes the lesson into `AGENTS.md`, which every GitLab Duo agent reads, so the mistake isn't repeated. The mutation gate is a required pipeline job: the score must clear 90%, or a Maintainer must override with a written reason, which is audited and opens a test-debt issue. Only gated code reaches `main`, which is scanned, packaged and deployed to Google Cloud Run with a smoke test and automatic rollback. The Front Desk console shows every useless test caught and repaired, AI drafts rejected, and the compute and model calls saved.

**When the MR edits the tests instead of the code.** An MR that only loosens an assertion (`toBe(0)` to `toBeLessThanOrEqual(500)`), or deletes the test that went red, keeps 100% coverage and a green pipeline, and has no changed source line to mutate. Mutant Review's lost-protection check catches it by execution: in a worktree of the target branch it mutates only the production code the edited tests import, keeps the mutants an edited test killed there, and re-runs just those at the MR head. Killed before and not now is protection the MR removed. The gate fails, the comment names the test that used to catch the change, the failure it produced, and shows the before/after assertion; the flow can draft a verified test that restores it, and approving it teaches AGENTS.md never to loosen, delete or skip a test to go green. A test refactor that keeps every assertion passes the gate on evidence ("4 re-checked, 0 lost") instead of the old warning.

The cheapest useless test is the one never pushed. The same engine runs as an MCP server with two read-only tools: `mutation_check` mutation-tests an agent's uncommitted changes (and reports any protection its test edits removed) and `verify_test` executes its draft test against the mutant. `.gitlab/duo/mcp.json` registers it for GitLab Duo Agentic Chat and the Software Development Flow, and `AGENTS.md` tells every agent to use it before finishing, so an AI coding agent checks its own tests before a pipeline or a reviewer ever sees them.

Every review also measures its own carbon footprint with the Green Software Foundation's SCI standard: real CPU time from the process tree, Cloud Carbon Footprint's power model, Google's grid intensity for the GitLab runner's region and the embodied share of the host. The footprint appears in the MR comment, in GitLab's native metrics widget next to the mutation score, and on Front Desk's Footprint page, alongside the projected cost of the whole-file run that changed-line scoping avoided. Surviving mutants also appear in GitLab's Code Quality widget, so a fixed one shows as resolved.

## How we built it

- **GitLab Duo Agent Platform:** a custom flow (Flow Registry v1) with a deterministic `prepare` step, one `AgentComponent` that drafts tests, and a deterministic `verify_and_publish` step; Mention and Assign-reviewer triggers; composite-identity `GITLAB_TOKEN`; `agent-config.yml` execution environment; `AGENTS.md` as shared agent memory.
- **Lost-protection check:** `git worktree` of the MR's base, `vitest list` to find which edited tests are in the mutation run, Stryker on the code they import there, Stryker at the head on only the mutants an edited test killed, line-mapped through the diff; pure comparison logic in `review-core/src/protection.ts`, proven end to end with real git, Vitest and Stryker in scratch repositories.
- **GitLab CI/CD:** changed-line review and lost-protection check, findings comment, required mutation gate with audited override (and a warning, not a block, when there is nothing to mutate), Code Quality and metrics report artifacts for the MR widgets, interruptible jobs and `rules: changes` so docs-only MRs spend no mutation time, SAST and secret detection, an e2e "hallucination check" job, container registry, Cloud Run deploy with environment tracking, scheduled monitor, a manual energy-benchmark job.
- **MCP:** a dependency-free stdio MCP server (`mutation_check`, `verify_test`) registered for GitLab Duo Agentic Chat via `.gitlab/duo/mcp.json` and for Claude Code via `.mcp.json`.
- **Sustainability:** an SCI model (`footprint.ts`, pure, hand-checked in tests) fed by measured CPU time of every Stryker and Vitest process tree.
- **Code:** TypeScript on Node 24. `review-core` is pure functions (diff scope, scoring, gate, arid triage, command parsing, memory); `gitlab-adapter` is the only API client; Front Desk is React + Express.
- **Google Cloud:** Cloud Run via Cloud Build, keyless Workload Identity Federation from GitLab OIDC.

## DevSecOps stages

Plan (test-debt issues on override, listing any protection lost), Create (agent commits approved tests; agents self-check before pushing over MCP), Verify (changed-line mutation testing, lost-protection check on edited tests, verified drafts, Code Quality widget), Secure (SAST, secret detection, protected evaluator paths, credential-free draft execution), Package (container registry), Release (Cloud Run with rollback), Configure (policy, flow, MCP and agent memory as code), Monitor (scheduled smoke monitor, per-MR SCI footprint in the metrics widget, Front Desk), Govern (required gate on changed-line score and lost protection, audited overrides, repair ledger).

## Measured impact

es-toolkit (MIT, 11k stars) calls itself "battle-tested with 100% test coverage". We ran the gate over its last 25 merged PRs: 11 shipped a changed line where a behaviour change survived every test, 178 surviving mutants in total. Changed-line scoping ran 1,057 mutants instead of 4,088 (74% avoided), 18 seconds median per PR. A survivor is a change no test noticed, not a proven bug, and these were not human-reviewed; every exclusion is published in benchmarks/RESULTS.md. On the demo MR: 100% branch coverage, 75% changed-line mutation score, merge blocked until a one-line boundary test was approved, then 100%. On the second demo MR, which only loosens that boundary test: coverage still 100%, tests green, no source changed; 5 target-branch mutants re-checked, 1 lost (`>=` to `>` no longer caught), gate blocked.

## Sustainability (Most Environmentally Impactful)

Mutation testing re-runs tests for every mutant, so it is usually too expensive to leave on. Mutant Review's design keeps it cheap, and every review now quantifies its own footprint with SCI (ISO/IEC 21031:2024): **SCI = (E × I + M) per R**, R = one merge-request review. E comes from measured CPU-seconds of every process the review starts (Cloud Carbon Footprint's GCP coefficients: 0.71–4.26 W per vCPU, 0.392 W/GB, PUE 1.1), I from Google's 2025 grid intensity for the region of GitLab's hosted runners (us-east1, 579 gCO2e/kWh), M from the host's embodied emissions shared by time and vCPUs. Each receipt carries a low–high range from two other power models. The demo review measures **17 mgCO2e** (12–20).

What the design avoids, measured: mutating only changed lines skipped **74% of mutants** (3,031 of 4,088) across 25 real es-toolkit PRs; CI makes **zero** model calls and the Duo flow makes **one** per human request, capped at three findings; drafts that fail execution never reach a reviewer; MR jobs are interruptible and docs-only MRs skip mutation; approved lessons stop agents from repeating the same useless test; and the MCP pre-push check moves the whole loop before the pipeline. The executed energy comparison of changed-line vs whole-file runs on the same 25 PRs is reproducible with `benchmarks/energy.ts` or the manual `benchmark:energy` job on GitLab's own runner. Front Desk re-prices any review in other regions: the same demo review would be 14 mg on GitLab's Arm64 runners (us-central1) and 3 mg in europe-north1.

## Challenges

Making AI-written tests trustworthy without trusting the model: we moved every decision that matters (scope, scoring, authorization, what gets committed) into deterministic code and made execution, not the model's confidence, the judge of a test. Mapping conversational approvals onto GitLab safely: proposals are bound to the exact MR head and only accepted from the flow's own account. Comparing protection across two revisions without guessing: mutants are matched by file, mapped line, column and mutation, a multi-line mutant only when every line it spans is unchanged, and anything that can't be re-checked makes the gate inconclusive rather than passing.

## What's next

More languages (PIT for Java, mutmut for Python), equivalent-mutant detection with a second cheap model call, scoping the target-branch run of the lost-protection check to the lines the edited tests cover, and lesson retrieval scoped by module so `AGENTS.md` stays short in large repositories.

## Built with

gitlab-duo-agent-platform, gitlab-ci, model-context-protocol, stryker, vitest, typescript, node.js, react, express, zod, google-cloud-run, cloud-build, green-software-foundation-sci, cloud-carbon-footprint
