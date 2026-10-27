# MutantReview working video demo

A two-minute recording of MutantReview actually running, captured and delivered in UHD 3840 × 2160 at 30 fps. The real dark Front Desk and local command output remain on screen. English subtitles explain the actions. There is no voiceover or presenter.

The soundtrack is the user-supplied aruarian dance.mp3, played at 30% linear volume, with short fades and no loudness normalization.

## What executes in the recording

1. The recording controls launch the existing CLI in an isolated local checkout. The real Vitest baseline passes four tests at 100% branch coverage. Stryker finds one surviving mutation out of five, giving 80%; the actual gate command fails below the 90% policy.
2. The Findings page shows subtotalCents >= 10_000 becoming subtotalCents > 10_000, plus the written shipping contract.
3. verifyDraft executes a proposed $100.01 test. It passes on both implementations and is rejected.
4. verifyDraft executes the exact $100 boundary test. It passes on the original and kills the exact mutation. Verification restores the file afterwards.
5. The demo applies that verified assertion to its actual local test file, reruns the full review, and runs the gate command again. Five tests pass, all five mutations are detected, the score is 100%, and the gate returns passed with exit code zero.

No score or approval is animated into place. No GitLab API is simulated. This is a local demonstration of the real engine; it does not show a live Duo drafting session or remote GitLab approval. Proposed tests are supplied by the recording script. Local controls are recording helpers, separate from the read-only Front Desk app.

## Edit and render

Requires Node 22+, FFmpeg, and HyperFrames 0.8.207. Footage and user-provided audio are local media artifacts included in the delivered editable archive rather than committed to the public repository.

Run npm run build to regenerate the timeline, npm run dev for Studio, npm run check to validate, and npm run render for a 4K export.

working-cut.json records source ranges, edit times and the two labeled speed-ups. Other footage plays at recorded speed; idle gaps are removed. npm run edit reconstructs the cut from the untrimmed local recordings. working-subtitles.srt is the subtitle track. Captions are grouped in compositions/working-captions.html; index.html holds the footage, captions host and soundtrack.

The 4K source is assets/working-recording.mp4. The faded track is assets/aruarian-demo.wav; the composition applies a single 0.30 gain. See CREDITS.md.

## Reproduce the local demonstration

Create a separate checkout with access to installed dependencies. Start the unchanged Front Desk there with PORT=4184. From this video project run node scripts/working-demo-server.mjs followed by the absolute checkout path.

Open http://127.0.0.1:4185. The four allowlisted controls run the actual CLI and verifyDraft. The apply action changes the demo checkout only after successful verification and leaves the real repaired test available for inspection.

## Evidence

capture/proof/working-before.json, working-after.json, the four command transcripts and working-events.json preserve actual execution results. The production application and evaluator are unchanged by this video task.
