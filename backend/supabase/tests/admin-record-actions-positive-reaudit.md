# Independent positive re-audit — 2026-10-05

## Result and scope

**15 tests executed, 15 passed, 0 skipped, 0 failed (0.697s)** against the received source-ready migration SHA `97af1726a2e2b399388fcb617266378237893bbe868c25ffa19ee748b2c4833f`. The nine manifest-owned source/test/document files matched `/tmp/tzudong-record-server-ready-20261005.json` before and after execution. The SQL and UI hashes were checked again inside the suite before each test.

These are positive acceptance assertions for the changed implementation. They are separate from `admin-record-actions-independent-audit.md` and `test_admin_record_actions_independent_audit.py`, whose earlier successful runs intentionally reproduced defects in SQL SHA `12402ec314acab475a0be6e0678933665f8c9a69bb519630a3b6bd966905d6cd`. An old reproduction passing is not a positive regression passing. The old reproduction class was not discovered or executed in this positive run.

This establishes the tested local SQL/DTO/RLS/metadata behavior only. It does not establish browser rendering, every administrator button, full canonical migration replay, deployed catalog compatibility, or physical Storage deletion safety. No hosted writes, provider calls, credential reads, commits, or pushes occurred. No production/server/UI files were edited by this auditor.

## Fixture dependencies

- Disposable auditor-owned PostgreSQL **17.11**, real `pg_trgm` **1.6** and `pgcrypto`; no equality-only similarity or digest stub remains during assertions.
- The author's minimal fixture plus the actual canonical YouTube identity functions and active identity unique index from `20260417_prevent_active_restaurant_identity_duplicates.sql`.
- Actual legacy approval/edit/merge bodies, actual G041 claim-user transformation, legacy workflow ownership `privacy_workflow_owner`, and service-only legacy RPC execution privileges.
- **JSON JWT claims only** for guarded calls. The obsolete `request.jwt.claim.role` is initially empty; successful submission calls restore it to empty.
- Actual baseline review INSERT/SELECT RLS, and actual `update_user_stats_on_review()` body and trigger with its minimal `user_stats` table dependency. Other baseline policies/triggers/tables are not a complete hosted replica.
- Synthetic `storage.objects` metadata rows, including object version; the new object/reference triggers execute for real. No Storage HTTP/S3 server was invoked.
- Actual `submissionApprovalInput()` and DTO parser; the actual `AdminRestaurantModal` submit handler and `EditRestaurantModal` change builder are extracted and run through the audit Bun adapter. Synthetic metadata replaces provider I/O. Merge and cleanup fixtures use explicit contract-valid DTOs, not rendered modal interaction.

The fixture database was dropped after the suite. Readback found **0 fixture databases remaining**, and the audit-owned cluster was stopped. The original d44d and Documents project worktrees were not changed.

## Positive cases

| Case | Observed result |
| --- | --- |
| Normal new/edit submission UI payloads with JSON JWT | Applied and read back; phone, existing unknown metadata and evaluation evidence preserved; legacy claim GUC restored |
| Omitted edit field versus explicit clear | Omitted phone preserved; explicit null clears it; existing admin metadata retained |
| Actual partial edit modal on incomplete legacy row | Phone-only edit succeeds without requiring unrelated missing name/coordinates or rewriting its legacy link |
| Crawler row approval using actual edit modal changes | Null `approved_name` can be resolved from origin name and approved |
| Actual grouped modal video swap | Empty common changes plus two per-target edits succeeds atomically under the real identity index |
| Actual create modal with three videos | Three created IDs returned and read back; same operation replay makes no duplicate rows and retains one audit row |
| Cross-video merge with incoming reviewed changes | Both video rows, appropriate statuses and evaluation evidence retained; common restaurant identity reconciled |
| Merge into missing target fields | Video/review/category/metadata supplemented; existing target administrator title retained |
| Review count parity | Two pending reviews count as two; approve/reject keep total two; deleting one gives one, matching actual baseline trigger semantics |
| Changed object after preview | Apply returns stale and preserves the review |
| Claim then new review reference / object replacement | Actual authenticated RLS insert and metadata replacement are rejected by the tombstone; uncertain claim cannot be resent |
| Two-session reference versus claim race | Writer observed blocked via `pg_blocking_pids`; after claim commit, waiting insert sees tombstone and fails; no reference admitted |
| Two-session object replacement versus claim race | Claim waits for earlier metadata replacement; after replacement commit it declines removal, reports unmanaged/not pending, and retains new version |
| Real fuzzy neighbor | Actual high trigram similarity returns domain duplicate-review conflict with no mutation/audit, rather than a false normal-success test |
| CAS/idempotency/actor controls | Changed payload/actor/stale snapshots rejected; lost ACK replay and concurrent same UUID give one mutation/audit; authenticated direct actor forgery denied |

The final control test reuses three author assertions while running them against the strengthened independent fixture. The other tests add independent UI payload, legacy-function, preservation, real similarity, counter and concurrency assertions. This is 15 unittest cases, not a count of every assertion or all administrative workflows.

## Remaining Storage boundary — keep external cleanup fail-closed

The former database reference race is closed in the tested paths: review references and storage metadata replacements use the same per-path transaction advisory lock as cleanup claim, and the committed cleanup state is a durable admission fence. Claim also rechecks references and the object's metadata fingerprint. A changed object is preserved and becomes unmanaged, rather than repeatedly pending deletion. External/unmanaged references are not a reason to reject the review's database moderation itself.

However, the source-ready `apps/web/app/api/admin/record-actions/media-cleanup/route.ts` still calls `.remove([path])` at line 27 once the service claims a job. It has no default-disabled integration/release gate. Its existence read uses the Storage metadata list API; this is not a physical S3 readback. This audit cannot recommend enabling that route for production physical deletion yet. Keep external deletion closed until exact deployed Storage integration and catalog/trigger privilege preflight provide the missing evidence. Database-only review deletion may still complete and report unresolved cleanup.

This is an evidence boundary, not a reproduced new S3 deletion bug. The SQL fixture proves neither that physical objects are deleted nor that every upload implementation observes the fence. Supabase documents `storage` as metadata with physical objects in an object backend and cautions that custom schema changes can conflict with service upgrades: [official Storage schema design](https://supabase.com/docs/guides/storage/schema/design).

The repository's nightly fixture pins Storage API `v1.33.0`. In that tagged primary source, [uploader.ts](https://github.com/supabase/storage/blob/v1.33.0/src/storage/uploader.ts) uploads a versioned physical object before completing the metadata transaction; [object.ts](https://github.com/supabase/storage/blob/v1.33.0/src/storage/object.ts) deletes metadata and the selected backend object versions within its deletion flow. Therefore a direct metadata fixture cannot establish full upload/upsert/resumable/copy/delete and lost-ACK behavior. Versioned backend keys also mean it would be incorrect to assume every in-flight upload overwrites the old physical object. These are source-derived observations, not Storage runtime passes.

Before external cleanup is enabled, verify the actual supported service version, permissions and trigger installation; exercise real standard/upsert/resumable/copy uploads competing with claim/delete; and verify lost ACK readback without resending deletion. Page cache invalidation, legacy-route retirement and rendered admin flows remain owned by the page auditor and were not retested here.

## Reproduction

Start a disposable task-owned PG17 cluster on a unique `/tmp/tz-rec-audit-*` Unix socket with TCP disabled. Then set its actual socket and port, and run from the candidate repository:

```sh
TZUDONG_RECORD_POSITIVE_REAUDIT=1 \
TZUDONG_RECORD_READY_SQL_SHA=97af1726a2e2b399388fcb617266378237893bbe868c25ffa19ee748b2c4833f \
TZUDONG_ADMIN_RECORD_LOCAL_PG=1 \
TZUDONG_TEST_PG_SOCKET=/tmp/tz-rec-audit-mt3csgeu \
TZUDONG_TEST_PG_PORT=18843 \
/Users/twoimo/Documents/projects/tzudong/.venv/bin/python3 -m unittest -v \
  backend.supabase.tests.test_admin_record_actions_positive_reaudit.PositiveReaudit
```

The recorded socket is now stopped; it is not an operating dependency. The SHA gate must be refreshed from a new authorized source-ready receipt after source changes, not bypassed. Python compilation of the two new Python audit modules passed. No full web build/lint/browser run is represented by this receipt.

## Frozen input and audit artifact hashes

| Path | SHA-256 |
| --- | --- |
| `backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql` | `97af1726a2e2b399388fcb617266378237893bbe868c25ffa19ee748b2c4833f` |
| `apps/web/lib/admin/record-action-contract.ts` | `80c0d8fd63b943e32803e171580dcab01537177c9239be7d55725f79bf043ca8` |
| `apps/web/components/admin/AdminRestaurantModal.tsx` | `2b8dda58bf212970ae0548da1c7d0a6ab1889f30939895d485cf219c4c622f22` |
| `apps/web/components/admin/EditRestaurantModal.tsx` | `7c5c755239d49798c11c5e0f9b34938bb4d247598e331bf04e089191a0dd55b5` |
| `apps/web/lib/admin/evaluation-record-actions.ts` | `7161a3b1d3c9c86ddb3917d5dfe92cfa16ba41189f7e92760a9b4af020c56eab` |
| `apps/web/scripts/audit-admin-record-action-payloads.ts` | `720082b242a15cd092701a172e87fdb61a8da250bc9980e4b0734e4469b8baa4` |
| `backend/supabase/tests/test_admin_record_actions_positive_reaudit.py` | `ff90a5bbc5c0eba6e7a26019cd8b2f66ac175fdcf1be1306db1f22a5b76c9e0a` |
