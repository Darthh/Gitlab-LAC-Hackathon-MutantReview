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

1. **AI > Flows** (or the AI Catalog): open the Mutant Review flow and replace its definition with [`.gitlab/duo/mutant-review.yml`](../.gitlab/duo/mutant-review.yml). It uses `run_command(command)`, the form this GitLab tenant already accepted.
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

## 6. Let coding agents check themselves before they push (MCP)

1. A group owner turns on **Settings > GitLab Duo > Change configuration > Allow external MCP tools** (GitLab.com).
2. Open the repository in VS Code or JetBrains with the GitLab Duo extension (or the Duo CLI) and run `npm ci`. Duo Agentic Chat reads [`.gitlab/duo/mcp.json`](../.gitlab/duo/mcp.json) from the workspace and starts the `mutant-review` server; its two read-only tools are pre-approved there.
3. Ask Duo to change the code; `AGENTS.md` tells it to run `mutation_check` before finishing and to add a test only after `verify_test` reports it verified. Claude Code picks up the same server from [`.mcp.json`](../.mcp.json).

Without an agent, `npm run check` prints the same report and exits 1 when a changed line has a change no test notices; add it to a `pre-push` hook if you like.

## 7. See lost protection on a real MR

The check runs inside `mutation:review` on every MR that edits, moves or deletes an existing test; nothing to configure. To demonstrate it after !1 has merged (so `main` has the exact-$100 test that `apply 1` committed):

```sh
git fetch gitlab && git checkout -b demo/weakened-test gitlab/main
# In the exact-$100 test in packages/demo-domain/src/shipping.test.ts, change toBe(0) to toBeLessThanOrEqual(500)
git commit -am "test: make the shipping tests robust to fee changes" && git push gitlab demo/weakened-test
```

Open the MR. Tests stay green and branch coverage stays 100%, and no source line changed, so before this check the gate would only warn. Now `mutation:review` logs `Lost-protection check: lost`, the Code Quality widget shows a *critical* `mutant-review/lost-protection` finding on `shipping.ts:4`, `mutation:notify` posts the *Lost protection* section with the before/after assertion, and `mutation:gate` fails. Mention the flow to get a verified restoring test, or revert the line.

If !1 has not merged yet, the GitHub branch `demo/weakened-test` loosens the existing `ships for free above the threshold` test instead (`toBe(0)` to `toBeLessThanOrEqual(500)`): the lost change is the free-shipping condition forced to `false`, i.e. every order pays $5 and no test fails. Push it to GitLab once this check is on `main`.

## Commands reference

| Command | Where | What |
| --- | --- | --- |
| `npm run review` | MR CI | Stryker on changed lines, triage, `evidence/latest.json` |
| `npm run mr -- flow notify` | MR CI | Post ranked findings once per head |
| `npm run gate` | MR CI | Score vs policy, override lookup, test-debt issue |
| `npm run mr -- flow prepare --handle @x` | Duo flow | Apply/override, or review and write the model brief |
| `npm run mr -- flow publish --handle @x` | Duo flow | Verify drafts by execution, comment |
| `npm run mr -- memory [--check]` | anywhere | Rebuild or check the AGENTS.md lessons section |
| `npm run demo` | local | Demo-contract review with sandbox proof and SCI receipt |
| `npm run check [-- --base <ref>]` | local | Pre-push mutation check of uncommitted and unpushed changes, including protection your test edits removed |
| `node node_modules/tsx/dist/cli.mjs packages/cli/src/mcp.ts` | IDE / agent | MCP server (`mutation_check`, `verify_test`) over stdio |
| `node node_modules/tsx/dist/cli.mjs benchmarks/energy.ts` | Linux / CI | Executed changed-line vs whole-file energy on es-toolkit; then `benchmarks/energy-report.ts` |
