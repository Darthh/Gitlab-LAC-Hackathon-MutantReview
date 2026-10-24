# Submission checklist

## Local implementation

- [ ] Install with the committed lockfile from a clean checkout.
- [ ] Run automated tests and TypeScript/build checks.
- [ ] Run `npm run demo`; preserve the actual coverage, raw report, normalized report, logs, and local proof receipt.
- [ ] Confirm `npm run gate` fails for the intentional surviving boundary mutation.
- [ ] Inspect the dashboard's local/pending/inconclusive labels and evidence downloads.
- [ ] Review failure-case coverage: stale/replayed/unauthorized approvals, scope filtering, invalid baseline, malformed model output, and failed verification.

## GitLab and assisted workflow

- [x] Create public MIT GitLab project: https://gitlab.com/Darthh2/mutant-review (ID 88030103).
- [x] Push the implementation to GitLab and preserve visible pipeline history, including actual [MR pipeline 2984952053](https://gitlab.com/Darthh2/mutant-review/-/pipelines/2984952053).
- [x] Run the real MR baseline and bounded mutation review at exact head `c6d5ae3d101660a2ef5cc28ab35b4e65994b7c91`: complete source lines 4–5, 100% branch coverage, three kills and one survivor, 75% score.
- [x] Record operator-bot provenance for the bounded manual execution; do not treat it as human patch approval.
- [x] Activate the separate public trial group `mutant-review1` (`145666501`); Ultimate trial expires November 23, 2026.
- [ ] Obtain explicit transfer approval before moving personal-namespace project `88030103`; Secrets Manager provisioning/count is unknown and the UI warns of permanent deletion. No transfer has occurred.
- [ ] Obtain approval for and issue the separate Reporter/read_api console credential; the prepared form is not an issued token.
- [ ] Confirm tenant schema acceptance, Duo access, runner tools, and actual service-account handle.
- [ ] Capture a Duo session producing a structured proposal grounded in measured evidence and the contract.
- [ ] Exercise current-diff discussion creation with at most three inline findings.
- [ ] Exercise trusted operator CLI note re-fetching and durable approval reservation against the live tenant; add automatic event ingestion only if needed.
- [ ] Have an authorized human approve the exact visible proposal/hash.
- [ ] Commit the exact approved tests, integrate them into the MR through a separate human action, and verify the resulting SHA.
- [ ] Capture separate verification approval and fresh original-pass/exact-mutant-assertion-fail/clean-rerun evidence.
- [x] Confirm required successful pipelines, actual failed [mutation gate 17440247403](https://gitlab.com/Darthh2/mutant-review/-/jobs/17440247403), and MR `ci_must_pass` state. No merge was attempted.
- [ ] Verify the independent repair diagnostic remains usable while the gate fails.
- [ ] Have a human approve the verified lesson and save it with its receipt.
- [ ] Demonstrate a later Duo task retrieving and successfully applying that lesson to the separate discount contract.

## Submission and optional release

- [ ] Publish actual benchmark sample and every exclusion, or clearly state it was not performed.
- [ ] Record a public YouTube demonstration shorter than three minutes.
- [ ] Complete Devpost fields with only demonstrated claims and links.
- [ ] If pursuing Cloud Run: build/publish a digest, obtain separate deployment approval, deploy through workload identity, and record a revision/contract smoke check.
- [ ] Keep the submitted version available through judging.

Read [setup](setup.md), [architecture](architecture.md), and [limitations](limitations.md) before presenting the project as complete.
