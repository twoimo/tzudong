---
name: tzudong-formal-map-check
description: Check Tzudong marker reuse, callback ownership and evidence arithmetic with bounded native exploration and mutation controls when these contracts change or a proof is requested. Does not verify the live map provider, deployment, Nightly or unrelated app flows.
---

# Tzudong bounded map and evidence checks

The promise: after a marker request returns, its static appearance and click refer to the current restaurant; releasing its object removes the old click authority. A stale flame or callback can misrepresent a place. Supporting checks reject nonfinite score outputs, unsafe frame-window endpoints and unsupported scalar comparisons.

From `apps/web`, with Bun **1.4.0**, installed project dependencies and Google Chrome or project Playwright Chromium:

```sh
bun scripts/verify-marker-formal.mjs --out /tmp/tzudong-formal-check.json
```

The command fails if the browser is missing. It does not download a browser, change settings, contact the map provider or silently skip. It runs the actual TypeScript pool inside Chromium with a substituted SDK, checks twelve deliberately broken source copies, removes only its scratch directories, verifies the original source hashes and checks the original again. A module/import/browser error is not successful mutation detection. Inspect `baseline`, every `mutations[].detected`, `restored` and `sourceHashes` in the JSON.

The browser fixture imports `wrapNaverMarkerContentWithReviewBubble` from the same module as NaverMapView. It does not hand-copy the review wrapper. Review states are none, existing text and refreshed text with a photo; adding/removing the outer wrapper is a structural update.

## Coverage and synchronization

Sync commit: `a1dd40016ff7cf23055073c8637d5b3ee00d6781`.

| Actual source | Promise checked |
| --- | --- |
| `apps/web/lib/marker-pool.ts`: `acquire`, `release`, `clear`, review-bubble patch | Current tier/flame, image description, visit badge and exactly one current review bubble at its existing anchor; callback ownership across reuse |
| `apps/web/components/map/NaverMapView.tsx` and `apps/web/lib/visible-marker-review-bubbles.ts`: wrapper import/calls and `wrapNaverMarkerContentWithReviewBubble` | Real caller/markup correspondence, current sibling review text and invalidation of same-object field updates |
| `apps/web/lib/evidence-engineering/popularity-marker.ts`: `wrapMarkerWithPopularityTier` | Real marker HTML consumed by the pool |
| `apps/web/lib/evidence-engineering/scoring.ts`: `hyperbolicHalfLifeDays`, `visitsMultiplier`, `compareCohortShadow` | Overflow fails closed; a signal vector has no scalar difference or write authority |
| `apps/web/lib/evidence-engineering/frames.ts`: `planFrameSamplingWindow` | Addition preserves safe integer timestamp bounds |
| `apps/web/scripts/build-public-popularity.ts` and shared `guards.ts`: `safeCount` | Malformed counts remain missing; conflicting video observations fail in either order |

Harnesses: `apps/web/tests-formal/marker-state-model.test.mjs`, `apps/web/tests-unit/evidence-numeric-bounds.test.ts`, `popularity-input-boundary.test.ts`, `evidence-cohort-shadow.test.ts`, `visible-marker-review-bubbles.test.ts`. Read the actual code and its relevant callers before interpreting a failure. Existing marker-pool and foundation unit tests remain useful companion checks.

Bounds: review fixtures include a photo URL/DOM branch with network blocked; photo pixels, layout and provider internals are outside this exploration. Targeted traces additionally cover cloned icon descriptors, hidden-root preservation, viewport clamp, changed anchors, failed detach, cluster update/reacquire and one next-microtask root replacement with genuine DOM observation. 48 visual variants, with fresh or in-place-mutated review objects, produce 9,216 ordered active/reacquired transitions. Eight pool/click actions are enumerated through depth four: 4,681 traces and 18,056 executed steps. Public operations are synchronous action boundaries; SDK reentrancy within an operation is excluded. The single deferred-root fixture does not enumerate arbitrary provider event/paint ordering. Recycled physical handles belong to their **current** restaurant: an old variable name is not evidence that a click belongs to its former ID.

These are bounded checks against real TS and DOM behavior with a synthetic provider, not an unbounded theorem or a TLA+ refinement proof. They establish neither eventual progress nor real SDK/network/device/production behavior. The arithmetic cases are regressions at named boundaries, not exhaustive floating-point verification.

## On a changed contract

Diff the covered files from the sync commit. Inspect any new state writer/callback or changed guard. Reproduce a counterexample through `MarkerPool` or the actual exported arithmetic function; do not fix a model-only trace by changing product code. Preserve an intended product change by revising its stated promise and oracle explicitly. Do not weaken assertions or bounds to obtain green output.

Re-run mutation sensitivity after changing the harness. An anchor-drift error requires source review; it is not permission to delete the mutation. Move the sync commit forward only after checking code correspondence and running the relevant check. Use pstack's `maintain-formal-verification-skill` workflow for later drift; no global skill installation is required.

Findings, mathematics and the reader-facing statechart are retained in [the audit](../../../docs/evidence/formal-map-invariants-20261023-v1/AUDIT.md). Preserve external cross-audit, Vercel, protected-promotion and Nightly gates separately. This skill grants no deployment, external send, account change or extra capacity authority.
