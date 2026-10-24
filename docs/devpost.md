# Devpost submission text

Paste-ready. Replace bracketed items only with results you have actually observed.

**Name:** Mutant Review
**Tagline:** Your tests passed. Would they notice the code breaking?
**Path / level:** Path A (Start Fresh), Assisted. Also entering Most Creative and Most Stages Covered.

## Inspiration

Coverage tells you which lines ran, not whether any test would notice them breaking. When an agent writes both the code and the tests, the tests often mirror the implementation or assert on mocks. They stay green forever and protect nothing. Human review won't catch it: on teams with high AI adoption, PR review time rose 91% (Faros AI, 2025). Google solved a version of this by mutation-testing only the changed lines during code review; developers who saw surviving mutants wrote more and better tests (Petrović et al., ICSE 2021). GitLab merge requests had nothing like it.

## What it does

On every merge request, Mutant Review runs StrykerJS on only the changed lines and computes a changed-line mutation score. Deterministic triage removes noise (logging, error-message text) and ranks at most three findings, such as "Flipping `>=` to `>` on line 4 fails no test. A cart of exactly $100 is untested."

When a developer mentions the agent, a GitLab Duo custom flow makes one model call to draft a test for each finding, deriving the expected value from the written contract. Then comes the part we're proudest of: **every AI-drafted test is executed against its mutant before a human sees it.** A draft must pass on the current code and fail on the mutant; otherwise it is rejected and logged as a blocked hallucination. Verified tests appear as at most three inline MR comments.

Nothing is committed until a human replies `@mutant-review apply 1 and 3`. Only humans can fire a mention trigger, and the flow's composite identity can't exceed that person's permissions. The agent re-checks the role, the proposal author and hash and the MR head, commits the tests, re-runs Stryker on the same lines and posts the score change. The same commit writes the lesson into `AGENTS.md`, which every GitLab Duo agent reads, so the mistake isn't repeated. The mutation gate is a required pipeline job: the score must clear 90%, or a Maintainer must override with a written reason, which is audited and opens a test-debt issue. Only gated code reaches `main`, which is scanned, packaged and deployed to Google Cloud Run with a smoke test and automatic rollback. The Front Desk console shows every useless test caught and repaired, AI drafts rejected, and the compute and model calls saved.

## How we built it

- **GitLab Duo Agent Platform:** a custom flow (Flow Registry v1) with a deterministic `prepare` step, one `AgentComponent` that drafts tests, and a deterministic `verify_and_publish` step; Mention and Assign-reviewer triggers; composite-identity `GITLAB_TOKEN`; `agent-config.yml` execution environment; `AGENTS.md` as shared agent memory.
- **GitLab CI/CD:** changed-line review, findings comment, required mutation gate with audited override, SAST and secret detection, an e2e "hallucination check" job, container registry, Cloud Run deploy with environment tracking, scheduled monitor.
- **Code:** TypeScript on Node 24. `review-core` is pure functions (diff scope, scoring, gate, arid triage, command parsing, memory); `gitlab-adapter` is the only API client; Front Desk is React + Express.
- **Google Cloud:** Cloud Run via Cloud Build, keyless Workload Identity Federation from GitLab OIDC.

## DevSecOps stages

Plan (test-debt issues on override), Create (agent commits approved tests), Verify (changed-line mutation testing, verified drafts), Secure (SAST, secret detection, protected evaluator paths, credential-free draft execution), Package (container registry), Release (Cloud Run with rollback), Configure (policy, flow and agent memory as code), Monitor (scheduled smoke monitor, Front Desk), Govern (required gate, audited overrides, repair ledger).

## Measured impact

es-toolkit (MIT, 11k stars) calls itself "battle-tested with 100% test coverage". We ran the gate over its last 25 merged PRs: 11 shipped a changed line where a behaviour change survived every test, 178 surviving mutants in total. Changed-line scoping ran 1,057 mutants instead of 4,088 (74% avoided), 18 seconds median per PR. A survivor is a change no test noticed, not a proven bug, and these were not human-reviewed; every exclusion is published in benchmarks/RESULTS.md. On the demo MR: 100% branch coverage, 75% changed-line mutation score, merge blocked until a one-line boundary test was approved, then 100%.

## Challenges

Making AI-written tests trustworthy without trusting the model: we moved every decision that matters (scope, scoring, authorization, what gets committed) into deterministic code and made execution, not the model's confidence, the judge of a test. Mapping conversational approvals onto GitLab safely: proposals are bound to the exact MR head and only accepted from the flow's own account.

## What's next

More languages (PIT for Java, mutmut for Python), equivalent-mutant detection with a second cheap model call, and lesson retrieval scoped by module so `AGENTS.md` stays short in large repositories.

## Built with

gitlab-duo-agent-platform, gitlab-ci, stryker, vitest, typescript, node.js, react, express, zod, google-cloud-run, cloud-build
