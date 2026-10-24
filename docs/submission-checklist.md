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
- [ ] Push the implementation to GitLab and preserve visible pipeline history.
- [ ] Confirm tenant schema acceptance, Duo access, runner tools, and actual service-account handle.
- [ ] Capture a Duo session producing a structured proposal grounded in measured evidence and the contract.
- [ ] Exercise current-diff discussion creation with at most three inline findings.
- [ ] Wire authenticated note/event ingestion and trusted durable approval reservation.
- [ ] Have an authorized human approve the exact visible proposal/hash.
- [ ] Commit the exact approved tests, integrate them into the MR through a separate human action, and verify the resulting SHA.
- [ ] Capture separate verification approval and fresh original-pass/exact-mutant-assertion-fail/clean-rerun evidence.
- [ ] Turn on required successful pipelines and prove a failed mutation gate blocks the MR.
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
