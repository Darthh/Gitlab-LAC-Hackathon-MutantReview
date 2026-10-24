# Historical evaluation protocol

This study is **not started**. `manifest.json` predeclares selection and budgets; its zero counts are actual study status, not a finding about Zod. Compatibility of historical Zod revisions has not been established. Do not put planned results in the dashboard.

First verify the repository's MIT license and historical Vitest setup. Work in isolated disposable checkouts without deployment or GitLab write credentials. Enumerate merged PRs from the cutoff backwards. Preserve every considered PR, exclusion reason, base SHA, pre-merge head, historical lockfile hash, Node and package versions, install/build/test output, mutation report, runtime, and completion state. Stop when the latest 25 eligible consecutive merged PRs have been attempted. Never omit a failed analysis to improve the result.

Normalize and independently filter results to the recorded scope. A person must review each surfaced gap against the historical contract. Report attempted and completed analyses, actionable gaps among successfully analyzed PRs, reviewed-sample precision, overhead, and limitations. A surviving mutant is not proof a production bug shipped. No evidence establishes that these historical tests were AI-generated.

Compare whole-module fresh mutation, changed-source incremental mutation, and changed-source plus approved lessons only using the same workload and runner conditions. Count preflight, model reasoning, failed repairs, verification, and retrieval costs. Report tokens as unavailable when the platform does not expose them. Keep held-out lesson-reuse evaluation separate from examples used to create lessons. Do not infer token, dollar, energy, or carbon savings from avoided test execution.
