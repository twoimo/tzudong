# Recovery 108 final candidate independent audit

Observation boundary: `2026-10-18T19:59:54Z`  
Repository HEAD: `cfba8fbbf532c0337c8443c719e5b0d7bf9baf48`  
Mode: read-only source audit. No tests, database/provider/browser/network actions, Git mutations, or shared-source edits were performed.

The supplied canonical hashes matched the local bytes:

```text
c2c93eb5c605ae9191961b2eda2c37ed2ce285f4982cdd389b90fba0cb9c47c9  backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql
ecadbe4e6b29709d8e6b52b89eaa5e04278a43f994f9611ed96161c341c0cbd4  .github/receipt-ocr-recovery108-sql-successor.v1.json
740d03fd882fb8f74d89615ea3fe2279f67eee7cc98d507587148ba106f058ac  apps/web/scripts/receipt-ocr-recovery108-sql-successor.mjs
```

## Full source hash boundary

```text
4426abc96721bb401f1debc71559e3368d97d85dee95ccf5ea78211cfe656f62  apps/web/app/api/admin/ocr-receipts/rerun/route.ts
469231ef3697e72eeea459ffba7c562751534fc4477d7f723fa43d6ba900fe8b  apps/web/components/admin/SubmissionListView.tsx
4c37ff1aa59ac23bc7df4022a3c907784fb6cbe971ac44c0d15778aeaa643b18  apps/web/lib/admin/ocr-recovery-confirmation.ts
890f628bc4222a0bd68026ba6013985cb0b48ce6b05051ec6b19a14e87a4c70d  apps/web/lib/ocr/admin-receipt-recovery.ts
dcc5c502246e6521e2d19ed40b02b3b2a228077f734e15831d16c407b300e58f  apps/web/lib/ocr/workflow-dispatch.ts
d8753a793bd682f5a1d9f6045c58ea73c7e96433d81d1862ec2b3dc64e0563f2  apps/web/scripts/run-admin-receipt-ocr-workflow.ts
ae96e7c6dc6b886a109256f3f85d2343bc330fa0c9e5a6c7df7e186d5d7712a1  apps/web/lib/ocr/admin-receipt-batch.ts
5ce863fe85f5edb279c66605f99d68d15d4c63dd15229fa3fb8166c80ddbb6f1  apps/web/lib/ocr/admin-receipt-processor.ts
2551b9147fc0ee6a639823f745bd8530866a444d4812e60768e134fce589bc3f  apps/web/lib/ocr/durable-result.ts
9974c65adac49994b8ce95829ef50f9fbf1bf563cc144c20a0eef21fa7bccbbe  .github/workflows/ocr-review-receipts.yml
c2c93eb5c605ae9191961b2eda2c37ed2ce285f4982cdd389b90fba0cb9c47c9  backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql
ecadbe4e6b29709d8e6b52b89eaa5e04278a43f994f9611ed96161c341c0cbd4  .github/receipt-ocr-recovery108-sql-successor.v1.json
740d03fd882fb8f74d89615ea3fe2279f67eee7cc98d507587148ba106f058ac  apps/web/scripts/receipt-ocr-recovery108-sql-successor.mjs
6d1db4c79fe9060e07a1f40f3a9e1ba3fc690615b09c58aa8f155a96fe72c8d0  apps/web/tests-unit/admin-receipt-recovery.test.ts
4b6f89370b59d0bcc525af8118637e5bce8b1eca2c023d6cad5185b8317463a1  apps/web/tests-unit/admin-receipt-ocr-workflow.test.ts
095128056aa744abec6daf42d062cc2d2026673f18f7efb88855f580b47a4940  backend/supabase/tests/receipt_ocr_indeterminate_recovery.sql
```

## Finding decisions

| Finding | Current decision | Source evidence | Verification boundary |
| --- | --- | --- | --- |
| Queued legacy workflow can consume a recovery generation | Closed in source | Workflow carries the opaque operation; authorization binds review, generation, path hash, image hash, context, policy and versions; legacy claim rejects both expected and recovery generations; bound claim is required for the recovery generation. | No live GitHub/provider run in this audit. |
| Action-less pending rerun bypasses recovery operation | Closed in source | The server previews every action-less pending rerun and rejects processing, eligible, recovery-in-progress and conflict before preflight/dispatch. | Route source and unit fixtures only; this audit did not execute them. |
| Cancelled cost confirmation becomes reusable | Closed in source | `retainConfirmedOcrRecoveryOperation` inserts into the map only after successful confirmation. | UI source and unit fixture only; browser verification is separate evidence. |
| Initial/default ACL leak on 108 objects | Closed in source | Exact owner/ACL comparison covers 16 functions and 3 private tables, including the execution lease; capability requires that predicate. | Actual default-ACL PG17 replay is outside this audit. |
| Rotated readback generation mismatch | Closed in source | TypeScript requires `previous_generation === expectedGeneration`, rejects equal new generation, and validates exact keys and snapshot. | Fake-RPC unit fixture present; not executed here. |
| First apply returns a different policy/thinking level | Closed in source | For `idempotent:false`, returned ordered model policy and thinking level must exactly equal the request. For `idempotent:true`, the persisted first operation may correctly override changed runtime configuration. | Fake-RPC fixture covers the distinction; not executed here. |
| Claim then delete then provider | Closed in source | Bound claim creates an execution lease in the same transaction as the durable claim. The lease references review and operation with `ON DELETE RESTRICT`; any failure to create the exact lease rolls the claim transaction back. Result terminal transition deletes the lease in the same transaction; result deletion cascades it. | Sequential SQL fixture demonstrates active-delete rejection and release cleanup. Actual two-session PG17 verification is delegated separately. |
| DB photo path changes during recovery | Closed in source | A current recovery generation blocks `verification_photo` updates; authorization and bound claim also compare the stored path hash. | Same-transaction/source reasoning plus fixture; external storage is separate. |
| Same-path object bytes change | Closed in source | The operation stores the prior canonical image hash; the worker recomputes it and authorization/bound claim require equality before provider dispatch. | No live storage mutation in this audit. |
| Deleted review is reclassified as ordinary admin claim | Closed in source | Legacy claim rejects admin prompt claims whose review generation no longer exists, and active bound claims prevent review deletion until terminal/released. | The prompt-prefix compatibility rule remains an intentional app contract. |
| ACK-loss or administrator switch rotates twice | Closed in source | Same operation returns the persisted generation and policy, ignores later caller policy drift, preserves the original audit actor, and dispatches the same bound operation. | No live transport-loss run in this audit. |

## Lock and lifecycle audit

No lock-order inversion was found in the reviewed source.

- Recovery apply: review advisory lock, review update lock, generation update lock, durable-result update locks, then operation insert.
- Authorization: same review advisory lock, review update lock, generation update lock, operation update lock.
- Bound claim: initial non-locking operation lookup only to obtain the review id, same advisory lock, review share lock, generation share lock, operation update lock, durable-result core claim/update, then execution-lease insert.
- Publish: review update lock, generation share lock, durable-result share lock.
- Result completion/release: durable-result update/delete, then the status trigger or result FK removes the lease. It does not acquire the review lock.
- Review deletion waits on or is rejected by the lease's `ON DELETE RESTRICT`; the bound-claim transaction already holds a review share lock before creating the lease, so there is no uncovered commit boundary between claim and deletion protection.

The original private claim was renamed to a core with no non-owner execution. The new private legacy wrapper and bound-recovery wrapper are `SECURITY DEFINER` owners in the exact ACL predicate. The public legacy signature is preserved and recreated under `privacy_workflow_owner`; the public bound claim is service-role only. No direct service-role path to the private core was found.

## Remaining boundaries

No remaining P1 source defect was identified at this hash boundary.

- A hard process death after a bound claim intentionally leaves a processing row and lease, blocking review deletion until a reviewed recovery/cleanup path resolves the uncertain provider state. Time alone must not release it.
- The capability verifies trigger identity and ACL presence; actual PostgreSQL concurrency, RI action ordering, trigger execution and owner-lease restoration still require the separate PG17 run.
- A code-version change can make a persisted operation fail closed if prompt/preprocess/normalization versions no longer match. The candidate does not silently substitute a different implementation.
- Source review and fixture presence do not prove hosted application, migration application, provider behavior, browser behavior, or deployment.
