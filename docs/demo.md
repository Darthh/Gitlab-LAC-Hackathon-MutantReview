# Demo video script (2:55)

Record at 1080p with browser zoom at 125%. Have these tabs ready: MR !1 (Overview with widgets, Changes tab), its latest pipeline, the Duo session list, Front Desk on Cloud Run (Footprint page), `benchmarks/RESULTS.md`, and VS Code with GitLab Duo Agentic Chat open on this repository (MCP enabled for the group). Run the loop once beforehand so nothing waits on a cold runner, then record a second, clean run on a fresh push. No music with third-party rights.

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:15 | MR !1: green tests, coverage 100% | "This merge request has 100% branch coverage and every test is green. It still ships a change no test would notice." |
| 0:15–0:30 | Faros and Google citations from the README | "When an agent writes the code and the tests, the tests mirror the code. Review time is up 91%. Google fixed this with mutation testing at code review. GitLab had nothing like it." |
| 0:30–0:50 | Pipeline: `mutation:review` log, then red `mutation:gate` | "Mutant Review mutates only the lines this MR changed. Four mutants, one survives: `>=` became `>`, and no test failed. The changed-line score is 75%, so the gate blocks the merge." |
| 0:50–1:05 | MR overview: Code Quality widget (1 finding on `shipping.ts:4`), metrics widget, `mutation:notify` comment | "No model has run yet. Deterministic triage kept one finding, and it shows up right in GitLab's own Code Quality and metrics widgets." |
| 1:05–1:35 | Type `@ai-mutant-review… ` → Duo session: prepare, draft_tests, verify_and_publish → summary + inline comment | "I mention the agent. One model call drafts a test from the written contract: an order of exactly $100 ships free. Then Mutant Review runs it. It must pass on this code and fail on the mutant. Drafts that don't are rejected before I ever see them." |
| 1:35–1:42 | `verify:hallucination-check` job log | "Every pipeline proves it: a plausible test at $100.01 passes on the mutant too, so it is thrown out." |
| 1:42–2:00 | Reply `apply 1` → agent's commit (test, ledger, AGENTS.md) → "75% → 100%" reply → pipeline green | "Nothing is committed until a human says so. I reply apply 1. It re-checks my role, commits the test, re-runs the mutants, and the gate turns green." |
| 2:00–2:20 | AGENTS.md diff, then VS Code with GitLab Duo Agentic Chat: the agent calls `mutation_check` and `verify_test` on an uncommitted edit | "The lesson goes into AGENTS.md, which every agent reads. And the next agent doesn't wait for a pipeline: over MCP it mutation-checks its own change and verifies its own test before it pushes." |
| 2:20–2:40 | Merge → main pipeline: SAST, package, Cloud Run deploy with smoke test → Front Desk Footprint page | "Only gated code reaches main, deployed to Cloud Run with a smoke test and rollback. Every review also measures its own carbon footprint with the SCI standard, from real CPU time, and shows the work it chose not to do." |
| 2:40–2:55 | `benchmarks/RESULTS.md` headline | "es-toolkit advertises 100% test coverage. In 11 of its last 25 merged PRs, a changed line could break without any test noticing, and scoping to changed lines skipped 74% of the mutation work. Mutant Review: tests that actually test something." |

If a step fails live, show the CI job that proves it (`verify:hallucination-check`, `mutation:gate`) and say what the agent would do; never splice in a run that didn't happen.
