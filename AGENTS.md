# AGENTS.md

Instructions for AI agents (GitLab Duo, Claude Code, Codex, Cursor) working in this repository.

## Project

Mutant Review mutation-tests the lines a merge request changes and asks a human to approve the tests that close each gap.

- `packages/review-core`: pure logic (diff scope, scoring, gate, triage, command parsing, memory). No I/O.
- `packages/cli`: runs Vitest and Stryker, the Duo flow steps (`flow prepare|publish|notify`) and the gate.
- `packages/gitlab-adapter`: the only code that calls the GitLab API. Project-scoped.
- `apps/front-desk`: read-only React console and its Express server.
- `packages/demo-domain`: the demo checkout contracts in `CONTRACTS.md`. Its tests intentionally miss the exact thresholds.

## Commands

- `npm test`: unit tests. `npm run test:e2e`: real Stryker run proving drafts are verified by execution.
- `npm run typecheck`, `npm run build`.
- `npm run demo`: local mutation review of the demo contract, written to `evidence/latest.json`.
- `npm run check`: pre-push mutation check of your uncommitted changes. The same check is the `mutation_check` tool of the `mutant-review` MCP server (`.gitlab/duo/mcp.json`, `.mcp.json`).

## Rules

- Never weaken the evaluator to make a gate pass: `.mutant-review/policy.json`, `stryker.config.json`, `vitest*.config.ts`, `.gitlab-ci.yml` and `packages/{review-core,cli,gitlab-adapter}` are protected paths.
- On `main`, the demo tests in `packages/demo-domain` deliberately miss the exact thresholds. Add tests there only when Mutant Review asks you to draft one for a finding.
- Keep GitLab writes in `packages/gitlab-adapter`, behind an explicit human command.
- Before you finish a change that adds or edits TypeScript, run `mutation_check` (or `npm run check`). For each finding, draft one test and add it only after `verify_test` reports it verified: it must pass on the code and fail on the mutant.

<!-- mutant-review:lessons:start -->
## Testing rules learned by Mutant Review

Mutant Review mutation-tests every changed line in a merge request. These rules come from tests a human approved after a surviving mutant proved the old tests could not notice a change. Follow them when you write or change tests in this repository.

- Derive expected values from the written requirement (README, `CONTRACTS.md`, doc comments), never by calling the code under test.
- Do not mock the unit under test. Assert on its real outputs, not on calls to a mock.
- Never let `toBeDefined`, `toBeTruthy` or `not.toThrow` be the only assertion in a test.
- Before you finish, a test you add must fail if the line it covers changes behaviour.

_No repairs approved yet._
<!-- mutant-review:lessons:end -->
