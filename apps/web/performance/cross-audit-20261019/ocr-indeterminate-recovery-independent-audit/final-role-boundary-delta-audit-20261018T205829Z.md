# Recovery 108 final role-boundary delta audit

## Scope and pins

Independent read-only source audit of the final role split in the main Recovery 108 fixture. No PostgreSQL command, test, browser run, source edit, Git/index mutation, or external action was performed.

- main fixture SHA-256: `01766da42c73195925c4fdcf3dbbdcf1efb651b947e3087481306f86179e76c2`
- manifest SHA-256: `a239a64cd0b1e60442002d73ee50bed2c865a6ed275283207cbace7660f24571`
- raw migration SHA-256: `d3258b679cbf42ecd97edeab941a5bbaf30fa7b15d968081b60b8b600a3ecd1a`
- compiler SHA-256: `5a9154f51cfe19f25007ce1737eee969faa32c166698b977884218c370ad20f8`
- ACL fixture SHA-256: `76317420f3be8199fccfbf716ad024573dad324d6f906c3a811c70e4e28df66e`
- v7 source artifact-map SHA-256: `111b1da664908a5a92688de116a4a9b016ba94996e3e790a3ea819f5c75b295b`

## Decision

**No source-level role-boundary regression or scenario weakening was found in this delta.** The fixture now separates product behavior from privileged diagnostic/setup access: all Recovery 108 public product calls run as `service_role`; all direct `ocr_private` reads/writes run as `postgres`; each role-sensitive block asserts `current_user`; and cross-role opaque identifiers are transferred only as transaction-local UUID GUC values.

This is not a database-pass decision. The canonical plus main probe was still running when this report was written.

## Role structure

The fixture contains seven balanced `SET LOCAL ROLE service_role` / `RESET ROLE` pairs and 15 explicit `current_user` assertions. Each product section starts by requiring `service_role`; every direct private seed/readback section requires `postgres`; the final block also proves the transaction returned to `postgres` before rollback.

The v7 static audit records 25 `public.*` product RPC references under `service_role` and 11 direct `ocr_private.*` references under `postgres`. Independent line inspection confirmed that classification:

- service-role blocks call capability, generation, preview, recovery, authorization, normal/recovery claim, release, and publish RPCs;
- service-role blocks also perform the intended public `reviews` update/delete attempts that exercise the photo guard and lease FK;
- postgres blocks seed durable private rows and read operation receipts, execution leases, generations, and late-publish state;
- there is no direct `ocr_private` reference inside a service-role block and no private-schema privilege grant was added.

The first v13 failure at direct `service_role -> ocr_private.review_generations` is therefore removed at source. The replacement reads current generations through `public.get_review_receipt_ocr_generation(...)` as the product role, while separate postgres blocks retain private durable-state readback.

## UUID handoff through local GUCs

Five `pg_catalog.set_config(..., true)` writes carry only UUID text within the same outer transaction:

- claimed `result_ref`;
- `claim_token`;
- recovery `generation`;
- late-publish `old_generation`;
- late-publish `current_generation`.

Every consumer uses `pg_catalog.current_setting(...)::uuid`. The `true` flag keeps the settings transaction-local; role changes do not require private-table access, and no OCR payload, policy JSON, credential, provider diagnostic, or personal data is transferred through the GUCs.

The claim block writes result/claim/generation under `service_role`; postgres verifies the exact lease; service_role then releases with the same result/token; postgres verifies lease removal. The late-publish postgres seed writes old/current generations; service_role exercises public publish rejection with the old generation; postgres confirms the current generation remains intact.

## Scenario continuity and assertion strength

All 12 behavior markers from the failed v13 receipt remain present:

1. processing generation rotations remain zero;
2. acknowledgement-loss replay adds no generation;
3. administrator-switch replay adds no generation;
4. legacy recovery job is denied;
5. bound policy drift is denied;
6. old claim path is denied;
7. bound claim cardinality remains one;
8. active review deletion is blocked until claim release;
9. provider calls after deletion remain zero;
10. photo replacement is denied;
11. deleted-review claim is denied;
12. late publish is rejected as stale.

The role fix did not replace these with marker-only checks. The fixture still verifies:

- before/after processing generation equality plus absence of a recovery operation receipt;
- wrong snapshot conflict, exact first rotation, same-operation ACK-loss replay, admin-switch replay, and stale-operation conflict;
- original actor retention in the private operation receipt;
- legacy/null-operation rejection, photo guard rejection, exact authorization replay, policy mismatch rejection, normal-job admission, old claim rejection, one bound claim, and duplicate-claim processing readback;
- exact execution-lease row, delete FK behavior, public release result, and private lease removal;
- old-generation publish rejection and private current-generation preservation;
- deleted-review normal-claim rejection.

The new public generation reads test the actual product boundary instead of bypassing it. The retained postgres readbacks continue to test durable internal effects. No scenario or negative assertion was removed in the observed final fixture.

## v7 artifact-map validation

The v7 map is internally consistent and binds the exact final fixture/manifest/raw/compiler/ACL hashes above. Its supporting artifacts are:

- role-boundary audit SHA-256 `1293842d7ec3ded3d0320619c253c05320c2ac52a16c06ba623168331170107b`;
- compiler check SHA-256 `abe6764bbd9b3ca570c4266080b695c15f0b4c01e6c363619ef0360bbc9508c4`;
- focused compiler unit receipt SHA-256 `17b372821fe4641ba612c33a0a7e5148597f3da1e4ecb339a7d230f75651cd1f`, recording `3 pass / 0 fail / 59 expectations`;
- clean untracked whitespace receipt.

This closes the stale v6 fixture/manifest binding at source. It does not replace actual PG17 main-fixture execution.

## Remaining exact evidence

- Finish the in-progress canonical plus main PG17 probe against exactly `01766da4... / a239a64c...`.
- Require all 12 markers, zero stderr, exact ready readback after rollback, canonical-main continuity, repeat rejection with unchanged dump, role/membership restoration, and owned-resource cleanup.
- Preserve the earlier v13 permission-denied receipt as failure history; do not overwrite it.
- Do not accept an elevated-role fixture run or any grant of private-schema usage to `service_role` as a substitute.
- If either fixture or manifest bytes change again, the v7 map and focused `3/59` binding become historical and require refresh.

No DB PASS is claimed by this report.
