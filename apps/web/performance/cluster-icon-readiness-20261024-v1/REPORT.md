# Cluster expansion image readiness — local candidate

**Not deployed. External delta review and real SDK/preview/production comparison remain incomplete.** The operating alias was re-read on 2026-10-24 at approximately 04:48 UTC: `https://www.tzudong.app/` -> `dpl_FiHvmpQdmnDLNYXL9dquSFTFMpoB`, READY/production, SHA `1b5230ac93021c72499f4950bff6cda24e2515e5`. That is the previous release, without this primer. No release authorization, operating alias, guard, account or provider setting changed in this task.

## Cause and candidate

The visible picture HTML first requests categories when it is inserted. In a fresh browser, an initial cluster can have loaded only its own category; expansion introduces unseen category resources. Calling those pending images “decode delay” conflated transfer and readiness. The controlled reproduction records 17 of 18 resource responses completing after expansion in the baseline, versus zero in the candidate. The source change starts the finite shared inventory at domestic map mount, uses the browser's existing WebP/PNG picture selection, requests low priority async decode and disposes its hidden, inaccessible pictures on unmount. It never waits before opening a cluster or writes MarkerPool/SDK icons asynchronously.

The source WebP inventory is 18 unique files, 85,402 bytes; the initial fixture category is 5,662 bytes. The primer can therefore move 79,740 additional source bytes before this fixture's first interaction. All 18 are needed eventually by this test workload; that does not prove they are all needed by a real user's session. Dimensions are at most 128x128; total pixel area times four is 1,026,048 bytes. This is a storage/area calculation, **not measured wire bytes or browser resident/GPU memory**. The browser may evict decoded images. Immediate interaction and memory pressure remain best-effort cases.

## Matched local experiment

Fresh Chromium 154 process/profile for every trial, 6 alternating baseline/candidate pairs per viewport, 76 visible marker images, unchanged source assets, fixed 80ms routed response delay, expansion at the same initial-image-ready condition. No candidate-only warm-up wait. `raw.json` retains all 36 trials; `score.py` derives `scored.json`. These are real browser image/picture boundaries with a substituted network and fixture map; they are not the Naver SDK, physical devices or production.

| Viewport | Baseline median (range) | Candidate median (range) | Reduction | MAD before/after |
|---|---:|---:|---:|---:|
| PC 1440x1000 | 96.80ms (96.30–109.10) | 40.10ms (38.40–41.70) | 56.70ms / 58.57% | 0.40 / 1.05ms |
| Mobile 390x844 | 96.60ms (95.10–97.10) | 41.80ms (37.60–44.40) | 54.80ms / 56.73% | 0.30 / 1.60ms |
| Tablet 820x1180 | 95.80ms (95.30–97.50) | 41.60ms (37.00–42.20) | 54.20ms / 56.58% | 0.45 / 0.45ms |

Metric: first rAF observation with every visible image `complete && naturalWidth > 0`. This is a readiness metric, **not isolated codec CPU time or a pixel/compositor proof**. Absolute budget: all images within 250ms, no zero visible-unit sample, at most 18 primer pictures and no duplicate category transfer. Relative budget: >=30ms and >=25% median reduction; noise: >max(16.7ms, 2x either arm MAD). All three local slices pass; **production improvement admission: zero slices**.

Including expansion-to-first-rAF, maximum observed frame gaps before/after were PC 40.70/41.70ms, mobile 46.60/44.40ms, tablet 46.70/42.20ms. No frame-timing or no-flicker improvement is established. Initial-image-ready median differences were -16.60/+3.45/+6.60ms respectively; these small fixture values do not establish startup non-regression under real network contention.

`decode-trace-summary.json` contains six separate diagnostic traces. The complete `Decode Image` event duration sums before/after were PC 3.977/5.144ms, mobile 4.242/4.341ms, tablet 4.304/4.223ms. Candidate decode events were before expansion; baseline after-expansion sums were 3.698/3.840/4.012ms. `ImageDecodeTask` wraps/overlaps decoder events, so do not add the two event families or interpret sums as elapsed interaction latency. One trace per arm/viewport cannot establish codec CPU improvement. `decode()` after images were already ready also cannot isolate decoder CPU work.

The original first measurement, its source harness and scores are preserved under `historical-first-run/`. The final JS harness removes an accidental requirement for Bun types in the application compiler and reads retained baseline bytes, allowing shallow CI checkout. A partially executed intermediate measurement was stopped when it overlapped compiler checking; it produced no admitted raw artifact. The final 36-trial series ran after those checks, not alongside them.

## Verification and delivery gate

- 40 existing marker pool/visual/mask tests: pass, 1,273 assertions.
- 3 real Chromium regression cases: pass, 15 assertions (selected WebP only once, image failure plus early disposal, unsupported source type selecting PNG). CI without the installed Chrome binary explicitly skips these browser cases.
- Scoped lint and diff whitespace check: pass.
- Compiler parity: pass, 0 diagnostics, 3,228 logical inputs in this clean candidate (no previous checkout's generated Next artifacts). The initial symlinked dependency path was rejected by the source guard; private copied dependencies passed without weakening the guard.
- No package/lockfile, public asset, MarkerPool, mask/observer, review/frame data or publication change.

The actual shared coordinator has an occupied Pro operation and another owner's uncertain Gemini dispatch. No new external send, account change, force-release, duplicate old audit or new monitor occurred. Prepare only this material delta for ordinary Pro thesis -> Gemini maximum adversarial -> Pro reverse. The old completed formal reports remain valid and unchanged for their original scope.

Normal feature -> develop -> data -> main promotion must follow those review results, real READY preview and all three real SDK/UI comparisons. The latest develop also contains the already completed README PR #3502; preserve it, exclude README files from this candidate's patch, and do not merge main history back into develop. Read current production immediately before any future release and retain its actual rollback target; this report's operating SHA is not a future fixed rollback authorization.

## Fixes, rollback and Nightly

Product candidate: finite map-owned category primer only. Tooling fixes: local source-readiness harness uses JS and retained baseline bytes, private dependency copy satisfies the existing path integrity guard. No new production deployment and no operating rollback were performed. Previous completed formal/scene-navigation release remains separate.

Nightly `39457197351`: separate historical failure, not rerun, not made successful by these checks.
