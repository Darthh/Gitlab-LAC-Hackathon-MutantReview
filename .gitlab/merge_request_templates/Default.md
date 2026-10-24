## What changed and why

<!-- One or two sentences. Link the issue or requirement the change implements. -->

## How Mutant Review checks this MR

- `mutation:review` mutates only the lines this MR changes and lists, at most three, the changes no test notices.
- `mutation:gate` blocks the merge while the changed-line mutation score is below `.mutant-review/policy.json`.
- Mention `@ai-mutant-review-evidence-triage-mutant-review` (or add it as a reviewer) to get a test for each finding. Each one is run against its mutant before you see it.
- Reply `@ai-mutant-review-evidence-triage-mutant-review apply 1 and 3` to commit the tests you approve.
- If a survivor genuinely doesn't matter, a Maintainer replies `@ai-mutant-review-evidence-triage-mutant-review override <reason>`. The gate records the reason and opens a test-debt issue.

## Before requesting review

- [ ] New tests take expected values from the requirement, not by calling the code under test
- [ ] No mocks of the unit under test; assertions check exact values
- [ ] I read the rules in `AGENTS.md` that Mutant Review learned from earlier repairs
