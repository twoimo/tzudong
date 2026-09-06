# Restaurant refresh apply boundary — private source candidate

The admin refresh route previously updated `restaurants` and then recorded the candidate decision in separate requests. An intervening failure could leave an updated restaurant with an undecided candidate. Removing the identity helpers' service-role grants would also break that direct table write.

`public.apply_restaurant_refresh_candidate(uuid,uuid,jsonb,jsonb,text)` now performs the purpose-specific apply, decision, readback, and minimized receipt in one transaction. The route retains `requireAdmin`, same-origin validation, its 16 KiB request limit, explicit approved + apply confirmation, closure rejection, and the existing `{ok:true,candidate_status:"applied"}` response. A separate committed candidate readback must pass before HTTP success. An uncertain apply is never retried automatically.

## Scope and admission

- Base: freshly fetched `origin/main`, `535ff5e27c2e7c27f385e862a824a58d0cc30b92`.
- Migration created by Supabase CLI 2.115.0 `migration new admin_restaurant_refresh_apply_boundary`: `20260906064459_admin_restaurant_refresh_apply_boundary.sql`.
- The migration starts with an **unconditional `refresh_apply_catalog_binding_pending` exception**. It is intentionally not deployable. Private tests remove only that exact block in a disposable database. No environment flag, session setting, or production bypass is supplied.
- Parent integration must supply an independently reviewed exact ledger/catalog binding, update the real catalog manifest for the receipt relation and RPC, verify creator/default ACLs/RLS/trigger/identity-index contracts, and run the unchanged real G014 assertions. Do not remove the gate just because private tests pass.
- No historical migration, helper ACL, role membership, canonical assertion, generated hosted type, or source promotion workflow is changed. The source candidate does not claim hosted installation, legal retention approval, or full Kiro closure.

## RPC contract

Only `service_role` receives EXECUTE; PUBLIC, anon and authenticated do not. The owner is `postgres`, with empty search_path and a two-second lock timeout. This is an intentional narrow write boundary rather than elevating existing invoker functions. The private fixture proves operation with a non-superuser, non-BYPASSRLS owner that owns the affected tables; hosted ownership/full-visibility still requires binding.

The trusted server supplies the actor returned by `requireAdmin`, candidate ID, and both snapshots read from the candidate row. Client-supplied actors or arbitrary patches are ignored. The function independently requires an admin `user_roles` row, held FOR SHARE against concurrent removal. It locks the candidate and restaurant, requires `needs_review` and approved restaurant status, compares both candidate snapshots exactly, then compares all seven fields of the original restaurant preview (including updated_at) with the current restaurant. Stale data fails without writes.

This preserves the current UI's candidate confirmation flow and strengthens the database CAS. It does not invent a claim that the existing UI submitted a cryptographic preview token: the UI still submits a candidate ID and explicit apply decision. A SHA-256 of actor, candidate, restaurant and both locked snapshots is generated for the receipt. If parent requires an additional end-user preview-token protocol, that is a separate frontend/API contract change.

The UPDATE names only approved_name, phone, road_address, jibun_address, lat, lng and server-controlled attribution/time. No JSON wildcard expansion, dynamic SQL, client-selected columns or arbitrary SQL is used. Text fields are bounded to 500 bytes, notes to 1,024 bytes, each snapshot to 16 KiB, and coordinates to valid numeric latitude/longitude ranges. Null/omitted coordinates retain existing values, fixing the former `Number(null) === 0` conversion. Other candidate evidence cannot change status or attribution.

The real unique identity index remains in force. After UPDATE, the RPC re-selects all changed business fields and attribution, checks them, updates the candidate decision, checks that readback, and inserts a receipt. Any error rolls back all three. A second apply returns a conflict; it cannot add another receipt. Non-apply decisions also use `candidate_status=needs_review` CAS so a stale rejection cannot overwrite a concurrent apply.

## Dependencies and receipt

Existing column types are explicitly checked before persistent DDL:

- `restaurants`: id uuid; approved_name/phone/road_address/jibun_address/status text; lat/lng numeric; updated_at timestamptz; updated_by_admin_id uuid.
- `restaurant_refresh_candidates`: id/restaurant_id/decided_by_admin_id uuid; candidate_status/operator_decision/operator_notes text; detected_change_types text[]; previous_snapshot/candidate_snapshot jsonb; decided_at/applied_at timestamptz.
- `user_roles`: user_id uuid, role public.app_role (admin enum value).
- `privacy_retention.g014_public_rpc_allowlist`: canonical five-column identity/grantee tuple. One new service-role row only.
- Existing `privacy_retention.g014_reject_audit_mutation()` trigger function.

The new `restaurant_refresh_apply_receipts` table contains only operation ID, candidate/restaurant/actor UUIDs, SHA-256 preview hash, fixed applied outcome and timestamp. Candidate ID is unique. It contains no snapshots, coordinates, notes, arbitrary bodies, provider diagnostics or credentials. RLS is enabled; all API roles have no direct table privileges. The canonical append-only trigger denies UPDATE/DELETE. No Auth foreign key is introduced. Parent must integrate this relation into catalog and operator-approved retention governance; no period is invented here.

## Verification

From the repository root:

```sh
TZUDONG_REFRESH_PRIVATE_PG=1 python3 -m unittest backend.supabase.tests.test_restaurant_refresh_apply_boundary
```

Thirteen tests pass: pending admission/dependency failures; exact retained helper grants; anon/authenticated/non-admin denial; successful atomic decision/readback/receipt; null-coordinate preservation; stale candidate/previous/restaurant; closure/invalid coordinates; unique-identity conflict; trigger-induced readback failure; append-only/private receipt; non-superuser owner; disallowed patch columns; receipt insertion failure rollback; lock timeout; duplicate apply. Tests use only synthetic rows in a network-isolated disposable PG17 container and remove their container even on setup failure.

From `apps/web`:

```sh
bun test tests-unit/admin-refresh-apply-route.test.ts tests-unit/admin-restaurant-refresh-history-source.test.ts tests-unit/admin-workflow-request-security.test.ts
npm run typecheck:parity
```

Sixteen route/source/request-security tests pass (184 assertions). Native TypeScript 7.0.2 and compatibility 6.0.2 parity passes with zero diagnostics. Targeted ESLint and `git diff --check` pass. No UI design/layout change or hosted synthetic-row test was performed.

## Parent integration order

1. Finish the separately owned role/extension catalog recovery; this patch does not relax canonical assertions.
2. Bind this source candidate to the resulting catalog, including grants/full-visibility of its owner, current trigger/index/helper definitions, receipt retention governance and all actual G014 assertions.
3. Run the complete corrected migration in exact-version private fixtures and protected source CI. Generate current types only after the intended hosted catalog has been independently read back; meanwhile the route treats the new RPC output as unknown and validates it.
4. Deploy database capability before enabling this route change. With the current pending gate there is no production admission. Apply only via parent's reviewed one-shot rehearsal/apply/readback workflow.
5. Keep all three legacy helper grants until both pipeline and admin writers are independently proven. This source commit alone does not admit their revocation.
