---
format: 1920x1080
output: 3840x2160
duration: 128s
mode: autonomous
message: Tests should notice code breaking. Prove the repair before a human approves it.
arc: Question → real finding → verified test → human approval → lasting protection
audience: hackathon judges and developers
music: Cipher, instrumental excerpt
captions: English, burned in and SRT
---

## Frame 1 — The green check is only the start
- duration: 7s
- scene: Mutant M branding, passing tests, and a question about a broken boundary.
- status: animated
- asset_candidates: assets/mutant-m.svg, assets/overview.png
- blueprint: kinetic-type-beats
- transition_in: cut

0–3s: opening question. 3–7s: reveal the measured coverage/score contrast and product name.

## Frame 2 — Real local review
- duration: 15s
- scene: The actual dark Front Desk overview, then a focused view of its gate and metrics.
- status: animated
- asset_candidates: assets/overview.png, assets/console-tour.mp4
- blueprint: compose
- transition_in: cut

Native 4K capture. Subtitle explains four passing baseline tests, 100% branch coverage, five mutations and the 80% score below 90% policy. Label: actual local execution.

## Frame 3 — Inspect the surviving mutation
- duration: 13s
- scene: Recorded interaction switches between Mutation, Contract and Proposed test tabs.
- status: animated
- asset_candidates: assets/finding-interaction.mp4, assets/mutation-close.png
- blueprint: cursor-ui-demo
- transition_in: cut

Show the inclusive comparison changing to exclusive and the missed order of exactly $100.

## Frame 4 — The missing assertion
- duration: 14s
- scene: Real proposed-test capture next to the exact contract-derived assertion.
- status: animated
- asset_candidates: assets/test-close.png, assets/contract-close.png
- blueprint: compose
- transition_in: cut

Expose `expect(shippingFee(10_000)).toBe(0)` in large type. Explain dollars are represented as cents. Proposal in this console is a local deterministic fixture; GitLab Duo drafting is not shown as live.

## Frame 5 — Execution is the proof
- duration: 14s
- scene: Actual Verification page; baseline passes, exact mutant fails, clean rerun confirms.
- status: animated
- asset_candidates: assets/verification.png, capture/raw/before.json
- blueprint: grid-card-assemble
- transition_in: cut

Use the executed sandbox result: original 5/5 tests, mutant 4/5 tests. No claim of live approval or a committed repair.

## Frame 6 — Reject convincing but ineffective tests
- duration: 14s
- scene: Readable e2e proof and contrasting exact-boundary and above-boundary inputs.
- status: animated
- asset_candidates: capture/raw/e2e.log, assets/proof-data.json
- blueprint: compose
- transition_in: cut

Only show results from the completed real Vitest/Stryker e2e run. Explain $100.01 cannot distinguish >= from >. Source code is inspected, never represented as a live model response.

## Frame 7 — A human decides
- duration: 17s
- scene: Clearly labeled approval-flow illustration using the real e2e-tested command and score change.
- status: animated
- asset_candidates: assets/proof-data.json, packages/cli/src/flow.e2e.ts
- blueprint: compose
- transition_in: cut

Persistent label: local e2e demonstration, GitLab API simulated. Animate approval command, checks, test/ledger/AGENTS.md outputs and measured 80% → 100% score. No live GitLab write.

## Frame 8 — Catch weakened tests too
- duration: 13s
- scene: Actual Test changes page, showing lost protection after a test edit.
- status: animated
- asset_candidates: assets/protection.png
- blueprint: compose
- transition_in: cut

Label as a separate local scenario. Show that changing tests can remove protection even when those tests remain green.

## Frame 9 — Keep review focused
- duration: 11s
- scene: The real Footprint page and the recorded benchmark scope counts.
- status: animated
- asset_candidates: assets/footprint.png, assets/overview.png
- blueprint: compose
- transition_in: cut

Changed-line scope, three-comment cap and transparent execution evidence. No unmeasured money, token or carbon savings claims.

## Frame 10 — Tests that notice
- duration: 10s
- scene: Green mutant M lockup, project link and readable music credit.
- status: animated
- asset_candidates: assets/mutant-m.svg
- blueprint: logo-assemble-lockup
- transition_in: cut

Hold the project identity and final promise. Credit Cipher by Kevin MacLeod, incompetech.com, CC BY 4.0; excerpt/fades. End on branding, not black.
