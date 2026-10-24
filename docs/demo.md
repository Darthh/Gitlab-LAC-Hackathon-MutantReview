# Demonstration script: under three minutes

Do not record the complete acceptance story until the GitLab and Duo stages in `submission-checklist.md` have actual evidence. The local console can presently demonstrate baseline, mutation, and sandbox verification, with the remaining stages shown honestly as pending.

| Time      | Screen and narration                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Open the shipping contract and measured baseline. “Both sides of the threshold are tested. The exact boundary is not.” Show measured coverage; say 100% only if the artifact measures it.                       |
| 0:20–0:45 | Open the surviving `>=` to `>` mutation. “An order of exactly $100 loses free shipping without a failing test.” Show the actual killed/survived counts.                                                         |
| 0:45–1:10 | Once available, open the real Duo session and its contract-grounded test diff. Until then label the deterministic fixture proposal as such.                                                                     |
| 1:10–1:40 | Show the exact patch/hash and separate human approval. Then the repair commit and fresh original-pass/mutant-assertion-fail receipt. A local sandbox proof must be described as a local experiment.             |
| 1:40–2:10 | Once approved and saved, open the lesson and source receipt. Show a later Duo task retrieving that lesson, deriving its new expected value from the discount contract, and passing fresh mutation verification. |
| 2:10–2:40 | Show Front Desk's evidence links, the actual failed-then-passed GitLab gate, approval trail, and recorded costs. Unknown tokens stay unavailable.                                                               |
| 2:40–2:55 | If deployment has actually run, show approved revision, image digest, URL, and contract smoke check. Otherwise finish with the proven local result and current limits.                                          |

Submission description draft: “Mutant Review helps a reviewer see what green tests missed. It pairs changed-source mutation evidence with contract-grounded GitLab Duo repair proposals, exact human approvals, fresh execution receipts, and approved lessons that future agent tasks can retrieve. The original checkout example makes the gap visible: tests cover both outcomes while omitting an inclusive monetary boundary.” Edit this description to match completed live evidence before submission.
