# Submission checklist (deadline Oct 27, 2026, 6:00 AM PDT)

## Done in the repository

- [x] Changed-line mutation review, arid triage, ≤3 findings, gate with audited override and test-debt issue
- [x] Duo flow: deterministic prepare, one drafting agent, verify-by-execution and publish; `apply 1 and 3`
- [x] AGENTS.md memory, repair ledger, Front Desk ledger and compute-saved tiles
- [x] CI: SAST, secret detection, e2e hallucination check, package, Cloud Run deploy with rollback, monitor
- [x] Benchmark harness and results in `benchmarks/`
- [x] SCI footprint per review (evidence, MR comment, metrics widget, Front Desk Footprint page) and `docs/sustainability.md`
- [x] Code Quality and metrics MR widgets; interruptible jobs; docs-only MRs skip mutation; gate warns instead of blocking when nothing is mutable
- [x] MCP pre-push server (`mutation_check`, `verify_test`) with `.gitlab/duo/mcp.json` and `.mcp.json`; `npm run check`
- [x] MIT license, README, setup, deploy, demo script, Devpost text

## You need to do on GitLab (docs/setup.md)

- [ ] Push `main` to the GitLab project
- [ ] Create the Reporter/api project token and add it as masked CI variable `MUTANT_REVIEW_TOKEN` (the previous operator token expired Oct 24, 5 PM PT)
- [ ] Replace the flow definition with `.gitlab/duo/mutant-review.yml`; enable Mention + Assign reviewer; confirm the service-account handle
- [ ] Merge `main` into `demo/shipping-boundary`; mention the flow on !1; reply `apply 1`; confirm the gate turns green
- [ ] Merge !1 so the release path runs on `main`

- [ ] Group owner: Settings > GitLab Duo > Change configuration > **Allow external MCP tools**, so Duo Agentic Chat can use `.gitlab/duo/mcp.json` (record it for the video)
- [ ] On the next MR pipeline, confirm the Code Quality and metrics widgets appear on the MR
- [ ] Optional: Build > Pipelines > Run pipeline on `main` with `RUN_ENERGY_BENCHMARK=1`; commit `benchmarks/energy/es-toolkit.json` and `benchmarks/ENERGY.md` from the job artifacts, then quote the energy number in Devpost

## Google Cloud bonus (docs/deploy.md)

- [ ] Workload Identity setup and the four `GCP_*` variables
- [ ] Confirm `deploy:cloud-run` and `monitor:smoke` pass; copy the public URL from Operate > Environments
- [ ] Add a pipeline schedule (hourly) for `monitor:smoke`

## Submission

- [ ] Record the video from `docs/demo.md` (under 3 minutes, public on YouTube, no copyrighted music); use `docs/images/cover.png` as the thumbnail
- [ ] Fill Devpost from `docs/devpost.md` with the benchmark headline and the Cloud Run URL
- [ ] **Opt in to Most Environmentally Impactful** on the Devpost form and paste the Sustainability section (link `docs/sustainability.md`)
- [ ] Update the README Status table with the live run links
- [ ] Keep the Cloud Run service and GitLab project public until Nov 16
