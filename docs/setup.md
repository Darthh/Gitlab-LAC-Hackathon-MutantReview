# Set up Mutant Review on GitLab

About 15 minutes on a project with GitLab Duo Agent Platform (Premium/Ultimate or a trial). The demo project is [mutant-review1/mutant-review](https://gitlab.com/mutant-review1/mutant-review) (ID `88030103`).

## 1. Local check

```sh
npm ci && npm test && npm run test:e2e && npm run demo
```

## 2. Push the code to GitLab

GitHub is a mirror; GitLab runs everything.

```sh
git remote add gitlab https://gitlab.com/mutant-review1/mutant-review.git
git push gitlab main
```

`.gitlab/duo/agent-config.yml` must be on the default branch: GitLab reads the flow's execution environment (Node image, `npm ci`) only from there.

## 3. Merge checks and the CI token

1. **Settings > Merge requests > Merge checks > Pipelines must succeed.** The `mutation:gate` job is then what blocks a merge.
2. **Settings > Access tokens:** create a project access token, role **Reporter**, scope **api**.
3. **Settings > CI/CD > Variables:** add it as `MUTANT_REVIEW_TOKEN`, **masked**, **not protected** (MR pipelines must see it). CI uses it to post findings once per push, verify override comments, and open test-debt issues. Without it, review and gate still run; only commenting and overrides are skipped.

## 4. Update and enable the flow

1. **AI > Flows** (or the AI Catalog): open the Mutant Review flow and replace its definition with [`.gitlab/duo/mutant-review.yml`](../.gitlab/duo/mutant-review.yml). If the tenant's `run_command` tool takes `program` and `args`, use `mutant-review.structured.yml` instead.
2. Enable it in the project with the **Mention** and **Assign reviewer** triggers.
3. Note the service account GitLab creates (`ai-<flow>-<group>`). If it is not `ai-mutant-review-evidence-triage-mutant-review`, replace that handle in both `--handle` lines of the flow YAML and in `MUTANT_REVIEW_HANDLE` in `.gitlab-ci.yml`.

The flow gets a short-lived `GITLAB_TOKEN` with the triggering person's permissions (composite identity). It needs no CI variables and never sees `MUTANT_REVIEW_TOKEN`.

## 5. Run the loop on an MR

The flow runs from the MR's own checkout, so the MR branch must contain this code. For the demo MR:

```sh
git fetch gitlab && git checkout demo/shipping-boundary && git merge gitlab/main && git push gitlab demo/shipping-boundary
```

1. The MR pipeline runs `mutation:review`. `mutation:notify` comments the ranked findings; `mutation:gate` fails at 75%.
2. Comment `@ai-mutant-review-evidence-triage-mutant-review` (or assign it as reviewer). The flow runs Stryker on the changed lines, drafts tests, executes each one against its mutant, and replies with verified tests and inline comments.
3. Reply `@ai-mutant-review-evidence-triage-mutant-review apply 1`. The flow re-checks your role and the proposal, commits the test, the ledger entry and the AGENTS.md lesson, re-runs Stryker and posts the score change.
4. The new commit's pipeline passes the gate. Merge. On `main`, `ci/release.gitlab-ci.yml` packages and deploys (see [deploy.md](deploy.md)).

To see an override instead: as a Maintainer, comment `@ai-mutant-review-evidence-triage-mutant-review override <reason, 10+ characters>` and re-run `mutation:gate`. It passes as `overridden`, writes `evidence/gate.json`, and opens a `test-debt` issue.

## Commands reference

| Command | Where | What |
| --- | --- | --- |
| `npm run review` | MR CI | Stryker on changed lines, triage, `evidence/latest.json` |
| `npm run mr -- flow notify` | MR CI | Post ranked findings once per head |
| `npm run gate` | MR CI | Score vs policy, override lookup, test-debt issue |
| `npm run mr -- flow prepare --handle @x` | Duo flow | Apply/override, or review and write the model brief |
| `npm run mr -- flow publish --handle @x` | Duo flow | Verify drafts by execution, comment |
| `npm run mr -- memory [--check]` | anywhere | Rebuild or check the AGENTS.md lessons section |
| `npm run demo` | local | Demo-contract review with sandbox proof |

The earlier operator CLI (`publish`, `apply`, `verify`, `prepare-lesson`, `learn`, `export-console`) is still available for a trusted host with exact hash-bound commands; see `packages/cli/src/workflow.ts`.
