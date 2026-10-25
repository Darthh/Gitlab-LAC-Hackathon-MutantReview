# Architecture

```mermaid
sequenceDiagram
  actor Dev as Developer
  participant CI as GitLab CI
  participant Flow as Duo flow (workload)
  participant LLM as Drafting agent
  participant GL as GitLab API
  Dev->>CI: push to MR
  CI->>CI: mutation:review (Stryker on changed lines, triage)
  CI->>CI: tests edited? lost-protection check (target-branch worktree, re-run caught mutants at head)
  CI->>GL: mutation:notify (≤3 findings)
  CI->>CI: mutation:gate (fails below policy)
  Dev->>Flow: "@mutant-review" (mention or assign reviewer)
  Flow->>Flow: prepare: find MR by head, read trigger, run review, write brief
  Flow->>LLM: brief (≤3 findings, source, contract, AGENTS.md rules)
  LLM->>Flow: .mutant-review/work/proposals.json
  Flow->>Flow: verify: each draft passes on code AND fails on mutant
  Flow->>GL: summary + inline comments + hashed proposal payload
  Dev->>Flow: "@mutant-review apply 1 and 3"
  Flow->>GL: check role, proposal author/hash, MR head
  Flow->>Flow: apply tests, vitest, Stryker on same ranges
  Flow->>GL: commit tests + ledger + lessons + AGENTS.md; reply score delta
  GL->>CI: new MR pipeline, gate passes
```

## Trust boundaries

| Decision | Made by | Why |
| --- | --- | --- |
| Which lines are in scope | `parseDiff` on `git diff base..head` | Deterministic; rejects path tricks |
| Score and gate | `mutationMetrics`, `evaluateGate` | Model output never changes counts |
| Which findings are shown | `triageMutants` | Cheap, reproducible, no model |
| What a test should assert | Drafting agent | The one creative step |
| Whether a test is kept | Execution: Vitest + Stryker | A test that doesn't kill its mutant is useless by definition |
| Whether anything is committed | Human mention, verified by `flowApply` | Role ≥ Developer, proposal from the flow's own account, hash intact, head unchanged |
| Whether the gate can be waived | Maintainer comment, verified by `findOverride` | After the latest push (server time), reason ≥ 10 characters, audited, test-debt issue |
| Whether edited tests removed protection | `protectionCandidates` and `compareProtection` on two Stryker runs | Mutants matched by file, mapped line, column and mutation; unknown results are inconclusive, never held |
| What a review cost | `footprintReceipt` from measured CPU time | Coefficients and region are data in `footprint.ts`; the receipt is validated (parts add up, counts match) before Front Desk shows it |
| What a pre-push check may touch | `precheck` / MCP `verify_test` | Read-only: base refs are validated (no options, no ranges), drafts pass the same guardrails and the test file is restored |

## Data

- `evidence/latest.json`: one run's provenance, scope, every mutant, triage, savings, gate. Artifact of `mutation:review`.
- `protection` in `evidence/latest.json`: the lost-protection check (changed tests, tests in the run, imported files, target-branch mutants, re-checked, held, lost with the catching test, its target-branch failure and the before/after test block, and the check's own SCI cost).
- `.mutant-review/ledger.json`: append-only history of repairs and rejected drafts, committed by `apply`.
- `.mutant-review/lessons/*.json` and the managed section of `AGENTS.md`: approved lessons, one per category, with examples.
- `.mutant-review/policy.json`: threshold, budgets, protected paths.
- `evidence/gl-code-quality.json`, `evidence/metrics.txt`: the MR widget reports from `mutation:review`.
- `footprint` in `evidence/latest.json`: the SCI receipt (measured usage, energy, intensity, embodied share, range, per-step breakdown, projected whole-file run).

The score is `(Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage)` over changed-line mutants. Invalid, pending, partial or stale runs are inconclusive, never passing. Zero applicable mutants is `no-applicable-scope`, never a pass: the gate exits 3, which CI shows as a warning rather than a pass or a block. The exception is evidence of another kind: a test-only MR whose lost-protection check re-checked at least one mutant and lost none passes, and one that lost any fails.
