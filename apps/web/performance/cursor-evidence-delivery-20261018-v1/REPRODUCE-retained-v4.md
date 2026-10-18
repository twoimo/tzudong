# Retained marker projection reproduction

Candidate: 9a63f25f2f3884c2062fde6f22cacfb4f352078c, tree f05fd25b3af24c22513efb2f0be7db4c7cbb5e16. Application map code equals built candidate2210f9e2; only2source-contract strings changed afterward. Exact equality is retained-contract-correction-v1.json, complete source identity delivery-source-manifest-v4.json. Prior v3 documents the schema2 membership implementation.

In an isolated checkout with pinned project dependencies, from apps/web run:

```sh
bun test tests-unit/naver-retained-publication.test.ts tests-unit/public-popularity-publication.test.ts tests-unit/naver-map-marker-visuals.test.ts tests-unit/expanded-cluster-flow-invariants.test.ts tests-unit/home-detail-route-state.test.ts tests-unit/user-submitted-marker-visibility.test.ts
```

The retained test extracts the real component variable declarations in source order and runs them in an isolated VM with actual swipe/signature helpers and injected approved publication. Raw/history selection outside an empty result must produce the approved marker grade AND guard signature; unknown/new members stay standard; frozen source input remains unchanged; user-submission visibility/dedup remain. It is not a mounted whole-map or real SDK tier activation test. Before1pass/2fail; after related23/23 and history/cluster16/16; visibility-contract+retained6/6 overlaps3already-counted tests. Do not sum those runs as independent samples.

The first corrected-source test attempt had an incorrect assertion demanding no data-popularity-tier attribute for standard; standard intentionally has a wrapper. after-v1.log is preserved, after-v2 asserts the real wrapper rather than matching CSS strings. First CI at2210 had3474general pass/21skip/1fail due old raw-variable source assertions. Those2expectations now name projected inputs; no assertion or test was removed. New-head CI must be observed separately, not inferred from these facts.

Local lint, TS native/compat parity0, production build/CSS and offline Chromium3/3(4.8s) passed. Build dist .next-retained-publication-20261018-v1. Only its two Next-generated include entries were removed from tsconfig after build; no shared config reset. Existing badge rendering and cleanup evidence is reused only because its source did not change.

For live final SHA, follow REPRODUCE-publication-v3.md and run-production-verification-v1.py. Additionally run public-alias and map-only visual scripts, then inspect screenshots. Execute strict run-live-history-readback-v1.mjs after SHA and diagnosticv2 independently; do not overwrite existing outputs or turn the strict failure into a diagnostic pass. Baseline strict desktop failed at original marker visibility. Diagnostic all3sizes restored the same detail, with0individual markers/16clusters. The stored HomeRestoreSnapshotV1 contains no viewport zoom/bounds; this is source evidence, not a proved SDK root cause. Keep this limitation visible after recheck.

All browser runs use fresh anonymous contexts, no account or DB writes, and no saved row bodies/query URLs/session headers. These are synthetic functional checks, not physical Samsung Internet, memory or field evidence. Publication remains empty/unpublished; no actual restaurant grade is activated.
