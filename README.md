# Mutant Review

**Your tests passed. Would they notice the code breaking?**

Mutant Review is an assisted mutation-review workflow for TypeScript, Vitest, StrykerJS, and GitLab. Its Front Desk console connects a behavioral testing gap to an exact proposed test and fresh execution evidence. Humans approve consequential changes separately.

## Run it

Requires Node 22.12+. The lockfile pins the toolchain.

```sh
npm ci
npm test
npm run demo
npm run dev
```

Open **http://localhost:4173**. `npm run demo` generates real evidence in about 20 seconds, without changing the intentionally incomplete domain tests. `npm run build` checks TypeScript and builds the interface; `npm start` serves the production build.

## What the local proof demonstrates

The shipping contract grants free shipping for orders of **at least $100**. Original tests check 9,999 and 10,001 cents, omitting exactly 10,000.

| Measured result | Observation |
| --- | --- |
| Baseline | Four passing domain tests |
| Shipping branch coverage | 100% |
| Stryker shipping mutations | Five generated, four killed, one survived |
| Mutation score | 80% |
| Surviving change | `subtotalCents >= 10_000` becomes `subtotalCents > 10_000` |
| Proposed test | `expect(shippingFee(10_000)).toBe(0)` |
| Fresh sandbox verification | Original passes; exact mutant fails the new assertion, twice |
| Gate | Intentionally fails the 90% project policy |

`npm run gate` exits nonzero for this survivor. Raw Vitest, coverage, Stryker and verification artifacts are generated beside `evidence/latest.json`. The console validates their shape, counts, score, mutation scope, and patch hashes. A second inclusive discount feature has its own contract for a future lesson-reuse demonstration.

## Evidence boundaries

The local proof is executed, reproducible evidence. It is **not** an approved repair, a committed test change, a completed Duo session, an approved lesson, or demonstrated later reuse. The interface labels these stages separately and remains read-only.

The public GitLab project is [mutant-review1/mutant-review](https://gitlab.com/mutant-review1/mutant-review). GitHub remains this checkout’s configured origin. GitLab adapters, a custom-flow configuration, a blocking manual review job and the mutation gate are implemented; live CI and Duo acceptance are tracked separately in the setup documentation. Historical benchmarks and deployment are not claimed as completed.

Front Desk can also serve an authenticated GitLab artifact capture through a signed cache. Configure `GITLAB_EVIDENCE_CACHE_FILE` and `GITLAB_EVIDENCE_PUBLIC_KEY_FILE` with the exact project, MR and job IDs from `.env.example`. A trusted operator creates the capture after authenticating the job provenance. The public server verifies its Ed25519 signature, artifact digest, 24-hour freshness limit, and current public MR head before deeply validating the execution evidence. This mode uses the public verification key and anonymous MR metadata; its interface shows **Signed GitLab snapshot**, the authenticated capture time, and the current-head check time. Direct GitLab artifact API access and local proof mode remain available.

## Structure

- `apps/front-desk`: React evidence console and server-side artifact reader.
- `packages/demo-domain`: original shipping and discount contracts and fixtures.
- `packages/review-core`: diff scopes, normalization, scoring, gate, approvals, preflight and lesson retrieval.
- `packages/gitlab-adapter`: restricted-project API client, current diff discussions, exact patch commits and replay journal.
- `packages/cli`: executable review, sandbox proof, gate and lesson commands.
- `.gitlab/duo`: bounded custom flow and execution environment.
- `.mutant-review`: policy and structured evidence schemas.

The assisted CLI is available through `npm run mr -- <command>`; its exact patch approvals use authenticated GitLab notes and durable operator state outside this checkout. `hydrate-evidence` validates and loads one GitLab job artifact before a Duo task; `publish`, `apply`, `verify`, `prepare-lesson`, `learn`, and `export-receipt` keep the stages separate. API execution requires a project-scoped credential; repository-only Git authentication is insufficient.

Read [setup](docs/setup.md), [architecture](docs/architecture.md), [limitations](docs/limitations.md), the [timed demo](docs/demo.md), and the [submission checklist](docs/submission-checklist.md). [Benchmark methodology](benchmarks/README.md) records the actual completed sample separately from the planned study.

MIT licensed. No real payment services are used.
