# Recovery 108 catalog-integrity counterexample follow-up

## Scope and evidence identity

This is a narrow, read-only follow-up to the independent Recovery 108 audit. It records a newly identified catalog-integrity counterexample. It does not repeat the full audit, execute PostgreSQL, call a provider, modify Git, or modify implementation source.

- Audited migration: `/Users/twoimo/.codex/worktrees/feature-completion-20261013/tzudong/backend/supabase/migrations/20261019130000_receipt_ocr_indeterminate_recovery.sql`
- Audited migration SHA-256: `abc1cb12005e84ad49e40e04c35ab388289772938ba4ccc8882c58a6c61687ed`
- Prior final audit: `final-candidate-audit-20261018T195954Z.md`
- Prior final audit SHA-256: `bc81d538f603cd3d27982ffe8c579b1228ca6ccc2b1801d25fc7abc081f9f099`
- Syntax-delta follow-up: `syntax-delta-followup-20261018T201149Z.md`
- Syntax-delta follow-up SHA-256: `d26324108f4a93480f6638497cbe557628dcd0802fb44f1238f1bf84c821f20d`
- Report preservation time: `2026-10-18T20:21:59Z`

The shared migration path had changed to SHA-256 `32daa6052c19b1ce14ba447af0b66d8f90d7b1e2dc589af566a6d79bbbcc5525` by report-preservation time because the implementation owner was editing concurrently. That later byte set was not re-audited here. The finding and line references below are bound to the observed `abc1cb12...` source.

## Decision

**P1 confirmed for the audited source.** `get_receipt_ocr_indeterminate_recovery_capability()` can report `ready` after behavior-critical function, trigger, or foreign-key drift. ACL admission proves who may execute existing objects. It does not prove what those objects execute or that the execution fencing remains enabled.

This is an actual source-contract defect, rather than only a missing test, because the application accepts this capability result as the execution gate in `apps/web/lib/ocr/admin-receipt-recovery.ts:95-108`.

## Source evidence

### Stored JSON is declarative metadata, not a catalog snapshot

At migration lines 308-313, `function_contract` stores `schemaVersion` plus four function-name labels (`preview`, `apply`, `authorize`, `capability`). It contains no signature-to-definition hash, language, volatility, security-definer, search path, owner, or ACL snapshot. It omits the claim and trigger functions entirely.

At the same location, `table_contract` stores six top-level declarative keys (`schemaVersion`, two table-name labels, `idempotency`, `cas`, and `executionBinding`). It contains no column definitions, nullability, check constraints, unique constraints, foreign-key definitions/actions, RLS state, policy definitions, trigger definitions, or trigger enabled state.

The successor compiler sealing predicate observed for this candidate only counted JSON keys and filled migration/ledger metadata. It did not replace those declarations with an actual PostgreSQL catalog snapshot.

### ACL admission does not bind behavior

Migration lines 1127-1235 enumerate 16 function signatures and three table names, then compare object existence, owner, and exact ACL sets. They do not compare `pg_get_functiondef`, `prosrc`, language, volatility, `prosecdef`, `proconfig`, function body hashes, table columns, constraints, foreign keys, RLS/policies, or triggers.

Consequently, PostgreSQL `CREATE OR REPLACE FUNCTION` can replace a listed function body while preserving its signature, owner, and ACL. The ACL predicate remains true.

### Capability does not compare stored JSON to current catalogs

Migration lines 1248-1307 check sealed-row metadata, a small set of object names, allowlist rows, two trigger rows, and the ACL predicate. There is no freshly computed function/table contract and no equality comparison with `function_contract` or `table_contract`.

The trigger checks at lines 1266-1281 compare relation, trigger function, trigger name, and `NOT tgisinternal`. They do not inspect `pg_trigger.tgenabled`, trigger timing/events/columns, or `pg_get_triggerdef`.

In contrast, the predecessor 107 capability computes `definition_sha256` from `pg_get_functiondef` and catalog attributes at migration `20261019120000_receipt_ocr_credential_release_acl_admission_v2.sql:552-602`, compares the recomputed objects to its sealed `function_contract` and `table_contract` at lines 709-719, and installs the catalog-derived snapshots at lines 950-1044. Its table snapshot is still narrower than a complete schema seal, but it demonstrates the missing equality pattern in 108.

## Concrete counterexamples

### 1. Same-owner and same-ACL function body replacement

Trigger: replace the body of `ocr_private.authorize_review_receipt_ocr_execution(...)`, `ocr_private.claim_receipt_ocr_recovery_result(...)`, `ocr_private.claim_receipt_ocr_result_core(...)`, or `ocr_private.guard_receipt_ocr_recovery_photo_update()` with `CREATE OR REPLACE FUNCTION`, preserving signature, owner, and ACL.

Observed predicate result from source logic: all signature/owner/ACL checks can remain true, stored JSON remains unchanged, and capability can remain `ready`.

Consequence: authorization, claim binding, same-generation fencing, or photo mutation protection can change while the application still admits recovery execution.

### 2. Disabled critical trigger

Trigger: run either of the following as an appropriately privileged database actor:

```sql
ALTER TABLE public.reviews
  DISABLE TRIGGER receipt_ocr_recovery_photo_update_guard;

ALTER TABLE ocr_private.receipt_results
  DISABLE TRIGGER receipt_ocr_recovery_execution_lease_release;
```

Observed predicate result from source logic: the `pg_trigger` row, name, relation, function OID, and non-internal flag remain present. Because `tgenabled` is not checked, capability can remain `ready`.

Consequence: the photo guard can cease rejecting protected photo changes. The lease-release trigger can cease terminal-state cleanup, producing a liveness/fail-closed lease leak. The photo-guard case is the stronger safety counterexample.

### 3. Foreign-key action or constraint drift

Trigger: remove or replace the execution-lease foreign key at migration lines 239-247, especially the `review_id REFERENCES public.reviews(id) ON DELETE RESTRICT` fence, while preserving table names, owners, and ACLs. Recreating it with `ON DELETE CASCADE` is one concrete drift.

Observed predicate result from source logic: table-name existence and ACL checks remain true; the declarative `table_contract` is not recomputed or compared; capability can remain `ready`.

Consequence: an active execution lease may no longer block review deletion, reopening the claim-to-delete-to-provider race that the lease was introduced to close.

## Required closure and actual PostgreSQL regressions

Closure requires a catalog-derived, equality-checked seal for all behavior-critical objects. The exact canonicalization must avoid a self-referential capability-definition cycle, but the resulting ready predicate must at least bind:

- all public/private recovery, authorization, claim/core, lease-release, photo-guard, ACL, and capability function definitions and security attributes;
- critical tables, columns, constraints, unique keys, foreign keys including delete actions, RLS/force-RLS state, and policies;
- critical trigger definitions and expected enabled state, including `tgenabled = 'O'` where ordinary enabled operation is required;
- the sealed row to a freshly recomputed canonical catalog contract by exact equality or an equivalent collision-resistant digest comparison.

Required real-DB regressions on both supported PostgreSQL versions:

1. Seal the exact candidate and prove capability is `ready`.
2. Replace one critical authorize/claim/guard function body while preserving signature, owner, and ACL; prove capability becomes `held`; restore the exact definition and prove `ready`.
3. Disable each critical trigger separately; prove capability becomes `held`; re-enable and prove `ready`.
4. Drop or change the execution-lease `ON DELETE RESTRICT` foreign key; prove capability becomes `held`; restore the exact foreign key and prove `ready`.
5. Confirm the same mutations cannot pass through any public wrapper, private helper, legacy claim wrapper, or alternate capability path.

No database mutation or regression was executed during this follow-up. Passing compiler/unit tests alone cannot close the finding; the catalog mutations and readbacks above must be observed on actual PostgreSQL.

## Relationship to the prior final audit

The earlier `final-candidate-audit-20261018T195954Z.md` closure was correct only for the counterexamples evaluated there and for its then-inspected candidate. This new counterexample limits that closure: the earlier statement that no remaining P1 was found must not be used as evidence that the 108 capability detects post-install catalog drift. Other prior findings and their decisions remain preserved; they are not rewritten by this follow-up.

The syntax-delta follow-up remains valid as a record of the two-byte parser correction. Parser validity and catalog-integrity readiness are independent gates.
