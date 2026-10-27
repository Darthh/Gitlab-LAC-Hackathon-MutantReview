# MutantReview video demo

A 2:08 caption-led demo using the dark Front Desk and the original green mutant M logo. UHD 3840 × 2160, 30 fps, instrumental soundtrack, English burned-in captions and a separate SRT. No narration or avatar.

## View and render

Requires Node 22+, FFmpeg and a Chromium browser managed by HyperFrames. From this directory:

```sh
npm run dev
npm run check
npm run render
```

The composition is authored at 1920 × 1080 and rendered at 2× pixel density. Application screenshots and the two video clips were captured at 3840 × 2160. HyperFrames 0.8.207 is pinned in the scripts. `index.html` is the editable timeline. `scripts/build.mjs` regenerates it and `subtitles.srt` from the preserved execution summaries in `capture/proof/`.

## What the viewer sees

| Time | Demonstration |
|---|---|
| 0:00 | Passing tests can still miss behavior |
| 0:07 | Actual dark Front Desk: 100% branch coverage, 80% mutation score, blocked gate |
| 0:22 | Recorded interaction: surviving mutation, written contract, proposed test |
| 0:35 | The exact $100 boundary assertion |
| 0:49 | Executed sandbox proof: original passes, mutant fails, clean rerun confirms |
| 1:03 | Ineffective $100.01 test rejected; eight real e2e tests pass |
| 1:17 | Labeled approval-flow illustration; locally tested 80% → 100% repair |
| 1:34 | Separate local scenario: weakened tests lose protection |
| 1:47 | Focused scope and inspectable execution footprint |
| 1:58 | Project link and soundtrack credit |

The baseline review and draft verification are actual local execution. The proposed repair displayed by the local console is a deterministic fixture. The approval-flow illustration is backed by the real Vitest/Stryker end-to-end tests, whose GitLab API is simulated. No live GitLab comment, repair approval, merge or deployment was performed for this video. Those distinctions are shown in the subtitles and on-screen labels.

## Validation

- Fresh `npm run demo`: four passing baseline tests, 100% branch coverage, five mutations, one survivor, 80% mutation score, failed 90% gate.
- `npm run test:e2e`: three suites, eight tests passed; actual Vitest and Stryker execution.
- HyperFrames check: no lint errors, runtime errors, layout errors, motion errors, contrast failures or audio errors. Informational structure/readability recommendations remain; close-ups and large captions carry the explanation.
- Inspected scene snapshots and corrected a source-recording padding issue before delivery.

See `STORYBOARD.md`, `assets/proof-data.json` and `capture/proof/` for the edit plan and execution provenance. Music attribution is in `CREDITS.md` and in the video end card. Keep the credit with any upload.
