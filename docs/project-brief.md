# Project brief: Mutant Review

The working brief for this project, rewritten from the original pitch so each part maps to a judging criterion and to code that exists.

**Target:** GitLab Transcend, Path A (Start Fresh), Assisted ($4k). Also Most Creative ($4k) and Most Stages Covered ($5k). Google Cloud bonus (+0.2).

**One line:** Mutant Review catches AI-written tests that don't test anything, proves its own AI-written replacements by execution, and only commits what a human approves.

## Problem (Potential Impact)

- Coverage says which lines ran, not whether a test would notice them breaking.
- When an agent writes the code and the tests, the tests mirror the implementation or assert on mocks: green forever, protecting nothing.
- Review doesn't catch it. On high-AI teams, PR review time rose 91% ([Faros AI, 2025](https://www.faros.ai/research/ai-productivity-paradox)).
- Google mutation-tests only changed lines at code review; developers who saw surviving mutants wrote more and better tests ([Petrović et al., ICSE 2021](https://arxiv.org/abs/2103.07189)). GitLab MRs have nothing like it.

**Audience:** teams shipping AI-assisted TypeScript through GitLab merge requests, and the reviewers drowning in them.

## Solution (Design, Innovation)

1. **Mutate only the diff.** Each MR pipeline runs StrykerJS on the changed line ranges (`src/app.ts:5-7`) with incremental caching, and measures how many mutants the whole files would have produced.
2. **Filter noise without a model.** Deterministic triage drops arid mutants (logging, error-message text), keeps one finding per line, ranks boundary and branch changes first, caps at three.
3. **One cheap model call.** A Duo flow drafts one test per finding, expected values taken from the written contract, guided by `AGENTS.md`.
4. **Execution is the hallucination check.** A draft is shown only if it passes on the code and fails on its mutant. Rejected drafts are logged, never shown.
5. **Comment sparingly.** At most three inline comments, e.g. "Flipping `>=` to `>` on line 31 fails no test. A cart of exactly 100 items is untested." Each carries its verified test.
6. **Assisted by design.** Nothing is committed until a human replies `@mutant-review apply 1 and 3`. That reply is a mention trigger, which only humans can fire; the flow's composite identity can't exceed theirs. The agent commits the tests, re-runs Stryker on the same lines and posts the score change.
7. **Learn once.** The approval commit adds a lesson to `AGENTS.md`, read by every GitLab Duo agent, so the same useless test isn't written again. Fewer repeat findings means fewer model calls and Stryker runs.
8. **Merge gate.** The changed-line score must clear policy, or a Maintainer overrides with a written, audited reason, which opens a test-debt issue.
9. **Front Desk.** A console of useless tests caught and repaired, AI drafts rejected, and compute and model calls saved.

## Lifecycle reach (Technological Implementation, Most Stages)

Plan (test-debt issue) · Create (approved test commits) · Verify (mutation, verified drafts) · Secure (SAST, secret detection, protected evaluator, credential-free execution) · Package (registry image) · Release (Cloud Run, smoke, rollback) · Configure (policy, flow, memory as code) · Monitor (scheduled smoke, Front Desk) · Govern (required gate, audited override, ledger).

## Proof (measured, not claimed)

- Run the gate over the last 25 merged PRs of a well-known MIT TypeScript repo and publish every exclusion. Result: es-toolkit ("battle-tested with 100% test coverage") shipped a change no test would notice in 11 of 25; changed-line scoping avoided 74% of mutants ([RESULTS.md](../benchmarks/RESULTS.md)). A survivor is a change no test detects, not proof of a production bug.
- Demo MR: 100% branch coverage, 75% changed-line score, gate blocks; after `apply 1`, 100% and green.
- CI job `verify:hallucination-check` proves on every pipeline that a plausible-but-useless draft is rejected.

## Demo beats (Presentation, under 3 minutes)

Green MR with 100% coverage → gate red at 75% → mention → verified test, rejected draft → `apply 1` → 100%, green → AGENTS.md lesson → merge → Cloud Run + Front Desk → benchmark headline. Script: [demo.md](demo.md).

## Non-goals

No autonomous commits or merges. No claims about production bugs, token savings the platform doesn't report, or tests being AI-written in the benchmark. TypeScript + Vitest + Stryker only.
