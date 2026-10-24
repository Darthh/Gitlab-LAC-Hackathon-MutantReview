# Demo video script (2:55)

Record at 1080p with browser zoom at 125%. Have these tabs ready: MR !1 (Changes tab), its latest pipeline, the Duo session list, Front Desk on Cloud Run, `benchmarks/RESULTS.md`. Run the loop once beforehand so nothing waits on a cold runner, then record a second, clean run on a fresh push. No music with third-party rights.

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:15 | MR !1: green tests, coverage 100% | "This merge request has 100% branch coverage and every test is green. It still ships a change no test would notice." |
| 0:15–0:35 | Faros and Google citations from the README | "When an agent writes the code and the tests, the tests mirror the code. Review time is up 91%. Google fixed this with mutation testing at code review. GitLab had nothing like it." |
| 0:35–0:55 | Pipeline: `mutation:review` log, then red `mutation:gate` | "Mutant Review mutates only the lines this MR changed. Four mutants, one survives: `>=` became `>`, and no test failed. The changed-line score is 75%, so the gate blocks the merge." |
| 0:55–1:10 | `mutation:notify` comment on the MR | "No model has run yet. Deterministic triage dropped the noise and kept one finding." |
| 1:10–1:45 | Type `@ai-mutant-review… ` → Duo session: prepare, draft_tests, verify_and_publish → summary + inline comment | "I mention the agent. One model call drafts a test from the written contract: an order of exactly $100 ships free. Then Mutant Review runs it. It must pass on this code and fail on the mutant. Drafts that don't are rejected before I ever see them." |
| 1:45–1:55 | `verify:hallucination-check` job log | "Every pipeline proves it: a plausible test at $100.01 passes on the mutant too, so it is thrown out." |
| 1:55–2:15 | Reply `apply 1` → agent's commit (test, ledger, AGENTS.md) → "75% → 100%" reply → pipeline green | "Nothing is committed until a human says so. I reply apply 1. It re-checks my role and the proposal, commits the test, re-runs the mutants, and the gate turns green." |
| 2:15–2:30 | AGENTS.md diff: "Untested boundary value" | "It also writes the lesson into AGENTS.md, which every GitLab Duo agent reads, so the next agent doesn't make the same mistake." |
| 2:30–2:45 | Merge → main pipeline: SAST, package, Cloud Run deploy with smoke test → Front Desk ledger and compute-saved tiles | "Only gated code reaches main. It is scanned, packaged and deployed to Cloud Run with a smoke test and automatic rollback. Front Desk shows every useless test caught and the compute we didn't spend." |
| 2:45–2:55 | `benchmarks/RESULTS.md` headline | "es-toolkit advertises 100% test coverage. In 11 of its last 25 merged PRs, a changed line could break without any test noticing. Mutant Review: tests that actually test something." |

If a step fails live, show the CI job that proves it (`verify:hallucination-check`, `mutation:gate`) and say what the agent would do; never splice in a run that didn't happen.
