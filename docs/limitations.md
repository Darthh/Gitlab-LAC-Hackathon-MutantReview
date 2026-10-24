# Evidence boundaries and open work

The current implementation is a local executable vertical slice plus prepared GitLab integration. It is not yet the completed hackathon acceptance chain.

| Claim                                                   | Current evidence boundary                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Original shipping logic and explicit contracts          | Repository source and Vitest tests                                                                                                  |
| Baseline tests, coverage, and mutation outcomes         | Real generated local artifacts; inspect `evidence/latest.json`                                                                      |
| Exact missing assertion on original and targeted mutant | Temporary local sandbox receipts when `npm run demo` completes                                                                      |
| Approved repair in the MR                               | Not completed; local sandbox execution is not approval or a committed repair                                                        |
| GitLab project and read API                             | Public project `Darthh2/mutant-review`, ID `88030103`, created in the signed-in browser; public project API probe succeeded         |
| GitLab pipeline and merge blocking                      | CI definition prepared; required-successful-pipeline setting enabled in signed-in UI; actual failing-gate merge block not exercised |
| GitLab Duo interpretation                               | Flow configuration prepared from official schema; tenant acceptance and execution unverified                                        |
| Approval safety checks                                  | Unit-tested deterministic validators and scoped adapter; authenticated event receiver not yet wired                                 |
| Exact repair commit                                     | Adapter supports separately approved isolated repair branch; live write not yet exercised                                           |
| Verified human-approved lesson                          | None saved initially                                                                                                                |
| Later Duo task applies a lesson                         | Not demonstrated                                                                                                                    |
| Historical evaluation                                   | Not started; zero attempted, zero completed                                                                                         |
| Model tokens or savings                                 | Unavailable; no estimated savings                                                                                                   |
| Deployment and monitoring                               | Not implemented or claimed                                                                                                          |

The second discount feature has its own contract and boundary tests for a future held-out lesson task. Its presence is not evidence of lesson reuse. Versioned lessons cannot be labeled verified until linked to a successful repair and separate approval.

Only TypeScript on Node with the pinned Vitest/Stryker toolchain is supported. The demonstration is intentionally small. Preflight is heuristic advice, not proof of meaningful tests. Equivalent-mutant judgments are advisory and do not alter gate counts. A survivor establishes a test's failure to detect a specific artificial change; it does not establish a production defect.

The same untrusted MR can modify its CI and evaluator unless the tenant separately protects the authoritative gate. The code detects protected-path changes and rejects a clean pass, but that is not hardened hostile-repository enforcement. Require Maintainer review and trusted policy execution before broad use.

The GitLab commit adapter deliberately leaves the original source branch untouched and creates a separate branch at the approved SHA. This is a stricter safety boundary than a best-effort head recheck followed by a racy existing-branch API commit. A human still needs to integrate that exact patch and run verification at the new MR head. End-to-end event ingestion, signed trigger authentication, approval UI wiring, lesson-save workflow, and live pipeline checks remain open work.
