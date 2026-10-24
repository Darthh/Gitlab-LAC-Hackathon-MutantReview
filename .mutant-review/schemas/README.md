# Evidence contracts

`triage.schema.json` is generated from the runtime Zod schema in `packages/review-core/src/triage.ts`. Model output is untrusted: runtime validation additionally requires every fingerprint to exist in the current evidence bundle. An equivalence classification never changes the raw mutation denominator.

`approval.schema.json` describes the pure core validator's record. GitLab transport records are adapted to it by the server-side integration. A well-formed JSON approval is not authorization: the workflow must re-read project membership and the current MR head, compare the exact proposal hash, and atomically reserve the event ID before committing. The adapter uses a durable journal for reservation; the pure core validator does not persist state.

Only additive changes to explicitly approved `*.test.ts` / `*.spec.ts` files pass the default patch policy. Other legitimate repair shapes require a new, explicit implementation policy rather than bypassing checks. Static checks are scoped safeguards for this demonstration, not a sandbox for arbitrary hostile code.
