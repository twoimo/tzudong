# Recovery 108 v13 testdata and evidence-reuse audit

## Scope

Read-only audit of the v13 main fixture/manifest delta and existing local evidence. No suite, PostgreSQL command, browser run, Git/index mutation, or shared-source edit was performed.

The requested v13 bindings were:

- main fixture: `26895e1c7fe159ad00b22e7c41ce08c9c8d45963aeb437666ae544ed65358b31`
- manifest: `c3537fd0049e127190115cb356f18132ad7847fcd92bc826ccf5678ce6df8627`
- raw migration: `d3258b679cbf42ecd97edeab941a5bbaf30fa7b15d968081b60b8b600a3ecd1a`
- compiler: `5a9154f51cfe19f25007ce1737eee969faa32c166698b977884218c370ad20f8`

During this audit, actual PG17 v13 evidence reported a service-role/private-schema boundary failure. The source owner began correcting the fixture and manifest. At `2026-10-18T20:56:07Z`, the shared paths were already interim hashes `01766da42c73195925c4fdcf3dbbdcf1efb651b947e3087481306f86179e76c2` for the fixture and `a239a64cd0b1e60442002d73ee50bed2c865a6ed275283207cbace7660f24571` for the manifest. They are not audited here and are not final pins.

## v13 source-verification artifact map

`ocr-indeterminate-recovery-source-verification-v6/artifact-map.json` is internally hash-consistent at SHA-256 `976fdbf0800873eddb2bcd51c65c365fbdaea9a9e0613738bed119bdb50c8b8c` and binds:

- the requested v13 fixture and manifest hashes;
- unchanged raw and compiler hashes;
- a compiler `--check` receipt showing held state and the exact 107/108 roots;
- three Recovery 108 compiler tests, `3 pass / 0 fail / 59 expectations`;
- a source check and clean untracked whitespace check;
- the exact v12-to-v13 delta.

The recorded v12-to-v13 delta removes only the redundant `public.restaurants_backup` seed row and updates `manifest.fixture.sha256`; the two `content='fixture content'` values and two `visited_at=now()` values remain. This source-only result was correct for those bytes.

The map does not contain a database-execution receipt. Its `fixture-source-check.txt` cannot establish role-correct fixture execution. Because the live fixture/manifest have since changed, v6 is now historical evidence for the failed v13 candidate, not a current source-verification map.

## Actual PG17 v13 failure evidence

Public proof SHA-256: `479607940671ce4237f222b1717460a6cab6f13c72b5da2c101c2afbf130ab6c`.

Public checkpoint SHA-256: `ffaf1ebad52f5ed9984191a8cafae59619fd42e724ed2d0220f6eb6a75d7d4ab`.

The evidence distinguishes the stages correctly:

- the v13 seed and length/time/relation prerequisites passed;
- the canonical 105-to-108 install passed;
- the terminal contract was ready;
- repeat migration was rejected as `MIGRATION_ALREADY_APPLIED` with unchanged dump;
- role/membership restoration passed;
- failure rollback restored canonical ready state;
- the main application fixture failed before emitting any behavior markers.

The first failure was `permission denied for schema ocr_private` while active role was `service_role`, at the first direct read of `ocr_private.review_generations` around fixture lines 112-121. Other private direct checks remained under the same role. The canonical-main continuity case therefore also remained failed even though installation and idempotency passed.

This is a real fixture role-boundary defect. Running the fixture under an elevated role would hide it and is not valid evidence. The correction must keep private schema privileges closed: service-role behavior should use public RPCs, while an explicitly delimited `postgres` section may perform private diagnostic readback only where the test is verifying internal state rather than application authority.

## Reuse decision: app 140 / 1070

The final-v3 app artifact map is SHA-256 `851030d9656afe96b4d784da8fcd376e2b68e7ac5713a1a2a64479a416fbb3fa`; its verification record is `2ea02e4c46cdbe398a9135116e67ec9d5c7a20aadc40b0c4ecc060e61c375c31`.

The original total was `140 pass / 0 fail / 1070 expectations`. Of that total, the Recovery 108 compiler file contributes `3 tests / 59 expectations`; the remaining `137 tests / 1011 expectations` are source-bound to files that still matched during this audit and do not consume the SQL fixture data.

For the requested v13 bytes, source verification v6 validly replaced the stale Recovery 108 compiler slice with a new `3/59` pass, so `140/1070` could be composed without rerunning the unrelated 137 tests. The subsequent fixture/manifest correction invalidates that replacement slice. The large app suite still need not be repeated if its 137-test source hash set remains unchanged, but the final corrected fixture requires:

1. a new exact manifest binding;
2. a fresh Recovery 108 compiler check;
3. the same focused `3 tests / 59 expectations` rerun;
4. a new artifact map that explicitly links the reused `137/1011` evidence and the fresh `3/59` evidence.

Until those exist, `140/1070` is historical/conditionally reusable rather than current-final evidence.

## Reuse decision: UI 39 / 39

The Node 24 browser report `final-simple-confirmation-node24-20261019/report.json` is SHA-256 `55a332b12e776c965cfda0bfa2b4eb05cf85b3e5738515116f0dd216c12349ae` and records `39/39`, no unexpected local/network/page/console errors, no provider calls, and no hosted DB mutations.

All eight sourceStart/sourceEnd files in that report still matched their recorded hashes during this audit. Neither the SQL fixture nor the successor manifest is in its source set. The UI `39/39` evidence is therefore reusable across the fixture-only correction without another browser run, provided the correction remains limited to the fixture and manifest.

Its original limitations remain: loopback synthetic endpoints, request/UI contract only, no real route handler, SQL RPC, GitHub dispatch, provider, hosted database, or deployment validation.

## Reuse decision: PostgreSQL 15 source-only replay

The preserved PG15 public receipt is SHA-256 `46135cbf45b451c107a463b1076ba0487d09ac19c8f006e99e0521195c57a8e6`; its fixture-only continuity receipt is `113ed8294ab454bfcf04c26798e34f12072cca8ae7f289e4788d12adf121f73a`.

That evidence explicitly excludes the main fixture, manifest, and compiler from generator closure and proves dual-clean PG15 schema replay against the unchanged raw migration and adapter. Because the current correction changes testdata/manifest only and raw/compiler remain unchanged, the PG15 dual-clean schema replay remains reusable. It does not prove the corrected main fixture's behavior and must not be cited as a replacement for the failed PG17 application fixture.

After the corrected fixture freezes, only the compiler/static fixture binding needs refreshing for PG15 continuity unless a generator-relevant source, raw migration, adapter, or reconstruction input also changes.

## Exact remaining evidence

1. Freeze the corrected main fixture and manifest; record their exact SHA-256 values.
2. Prove the fixture contains no service-role direct access to `ocr_private` and no private-schema grant expansion.
3. Produce a fresh source-verification map binding the corrected bytes and the unchanged raw/compiler/vector/root.
4. Rerun the focused Recovery 108 compiler `3/59` slice; reuse app `137/1011` only after its source hashes are rechecked.
5. Reuse UI `39/39` only while all eight bound UI/app hashes remain identical.
6. Reuse PG15 dual-clean only as source/schema replay; refresh its static fixture/manifest continuity receipt.
7. Complete actual PG17 main application fixture with every expected behavior marker, under the intended service-role/public-RPC boundary.
8. Complete canonical-main continuity against that successful fixture, including repeat rejection, dump identity, role restoration, and cleanup.
9. Preserve the current v13 failure receipts as stage evidence; do not overwrite or relabel them as passing.

No final fixture-pass verdict is available at this checkpoint.
