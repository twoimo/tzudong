# Catalog recovery — 2026-09-06

This is a source-candidate status record, not a hosted apply or production release receipt.
The operational-readiness checklist has 1,282 checked and 28 open entries out of 1,310.
Task 7.81 reflects the independently rehashed historical Advisor receipts only.

## Current independent readback

The read-only diagnostic at 2026-09-06T07:19:34.390272Z matched its exact catalog
snapshot and executor. All three global G014 assertions returned `contract_failed`.
It counted one missing allowlist identity, three owner memberships, 331 public
functions, and 358 unexpected application-role execution pairs. The planner rejected
rehearsal generation with `fresh_passed_g014_diagnostic_required`.

External receipt: `/Users/twoimo/.codex/artifacts/tzudong-readonly-g014-diagnostic-20260906/receipt.json`.
The independent rollback readback in
`/Users/twoimo/.codex/artifacts/tzudong-g016-allowlist-repair-v2-20260906/independent-rollback-readback.json`
matched the pre-rehearsal state with 51 ledger entries. No apply was admitted.
Spent attempts remain spent; a new corrective operation needs a new preview and receipt.

## Confirmed causes and source work

- The allowlist retains retired five-argument onboarding while the installed six-argument
  body matches the accepted source. The narrow allowlist change alone cannot close G014.
- The public vector extension contributes 354 unexpected role/function pairs. Blindly
  revoking these grants breaks operators, casts, indexed inserts and invoker search.
  Namespace relocation is being verified against PostgreSQL 17.6 and vector 0.8.0.
- Three identity helpers remain dependencies of the expression index and current writers.
  Their grants cannot be removed until all affected writers have transitioned and passed readback.
- PG17 creates bootstrap ADMIN-only grants that the PG15-era owner assertion rejects.
  The prepared PG17 correction retains those grants and removes only the self-INHERIT edge.
  Ten private PG17/PG15 tests passed; hosted application has not occurred.
- Removing inherited access changes installer and operator-diagnostic prerequisites.
  The first/group RPC installers and refresh allowlist update require explicit integration;
  restoring broad inheritance or only changing a snapshot pin is not a correction.
- The refresh route now has a tested atomic RPC/decision/audit/readback boundary in this
  candidate. Its unbound SQL is parked in `backend/supabase/candidates`, not the automatic
  migration stream. Do not deploy this route before the RPC is installed and independently read back.

## Verification scope

The integrated candidate passed 52 private DB tests, 20 additional admin-group tests,
13 route/source tests, TypeScript native/compatibility parity with zero diagnostics,
and targeted ESLint. Ten local Docker endpoint tests passed. These counts describe
specific executed suites, not full release coverage.

The first canonical replay stopped at unsupported Colima endpoint admission. The
validated current-account default Colima socket correction passed its tests. The next
replay stopped because isolated Docker configuration could not discover Compose.
Compose discovery and subsequent full replay remain in progress; neither attempt is
recorded as a successful canonical replay.

The historical Advisor `g014AssertionPassed` field refers only to
`assert_g014_catalog_manifest()`. It does not contradict the independently observed
failures of the three broader current assertions. The producer freeze remains active.
Missing legal, retention, location and other external evidence remains missing.
