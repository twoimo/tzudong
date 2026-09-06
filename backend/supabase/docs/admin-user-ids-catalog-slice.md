# One admin-ID RPC catalog slice

Prepared from main `eddef9a456ce0225c27cc203b9c434624234ee3f`. This source is a
new candidate, not hosted approval or execution. Advisor is already current51;
never replay it. This slice creates only
`public.read_admin_user_ids_for_management()` and its service-role allowlist tuple.
No generated types change is needed: source already declares the intended RPC.
No other missing RPC, table, policy, retention approval or role is added.

## Source and admission

The exact function body comes from
`20260812000300_local_admin_data_boundary_convergence.sql:145` (file SHA256
`b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf`).
It returns sorted admin UUIDs, permits zero rows and raises SQLSTATE 54000 above
200 rows. It is STABLE, SECURITY DEFINER, empty search_path, owned by
privacy_workflow_owner. PUBLIC/anon/authenticated cannot execute; service_role can.
The web consumer in `apps/web/app/api/admin/users/[userId]/route.ts:129` additionally
rejects empty/duplicate responses. This does not complete that route's other RPC dependencies.

Parent's retained `admin-ids-hosted-prerequisites.json` establishes owner column
SELECT and schema USAGE/CREATE, unconditional permissive SELECT with no nontrivial
restrictive SELECT policy, and no target overload. Current51 and the runner's
two-row membership was independently read back. Strict admission requires exactly:
foreign grantor ADMIN=true/INHERIT=false/SET=false, and self grantor
ADMIN=false/INHERIT=true/SET=false. Each temporary window changes only SET on the
existing self-granted row with explicit GRANTED BY postgres, then restores SET=false.
Neither row is deleted. All original membership rows including OIDs, grantors and
flags must compare equal. Earlier separate-lease/revoke drafts are superseded.
No permanent membership or schema privilege change is made. The fixed execution
role is postgres; test fixtures use a non-superuser postgres with the same admin options.

Two short SET windows create a pg_temp assertion bridge and the target function.
G014 allowlist/definer/catalog assertions run before and after the persistent slice,
after SET is restored. The bridge follows the temporary assertion mechanism
in local profile convergence. It is dropped before success. Actual existing G014
functions are called, never replaced. Existing public/privacy_retention function
metadata, role attributes/memberships, relevant schemas, tables, columns, constraints,
policies, and all other allowlist tuples must remain equal inside the transaction.
Temporary schema privilege or role changes are not assumed to disappear: restoration
is checked explicitly. Errors abort the containing DO/transaction; reruns deny existing
function/allowlist state rather than silently replacing it.

## Exact whole-file plans

The pinned CLI 2.115.0 `supabase migration new admin_user_ids_catalog_slice` generated
version `20260906040116`. The migration has no internal COMMIT. The offline planner
uses the unchanged canonical G037 SplitAndTrim parser (SHA256
`398e3945c0d0fb656daef0d0a42409dbdeb45a9bb1f6f8c03445e4436d4db0bd`) to bind the
exact two-statement vector: DO and NOTIFY. It does not apply or repair history.

Run the offline planner with `--project-ref aqlcofblfxdrjhhdmarw --snapshot PATH`
and one of `--mode preview`, `--mode rehearse`, `--mode readback`.
`--mode apply` additionally requires `--rehearsal PATH` containing the exact
externally retained successful rollback receipt. Receipt JSON is a binding, not
proof of custody or authorization; parent verifies its actual origin.

The snapshot input is the fresh existing advisor immutable snapshot before this
RPC (51 ordered entries). The planner compares the entire snapshot inside the
transaction after locking the ledger; it executes canonical statement bytes and
inserts the explicit source version/name/vector. Post-state must equal the prior
snapshot with exactly the new ledger tuple appended. Empty historical vectors remain
observed empty. No apply_migration timestamp generation, db push, replay or ledger repair.

Rehearsal executes the whole slice plus canonical ledger insertion in a subtransaction,
verifies the candidate and deliberately rolls it back, then compares the original
snapshot again before returning the fixed receipt. The outer transaction ends in
ROLLBACK. A completion flag rejects a matching rollback error code raised before
the full installation and postcheck finish. Apply verifies inside the transaction and commits once. Its returned
`verified_before_commit` object is explicitly not a commit receipt. An ambiguous
transport outcome requires independent readback; never retry automatically.

Parent transport: pinned CLI 2.115.0
`db query --linked --project-ref aqlcofblfxdrjhhdmarw --file PLAN.sql --output-format json`.
Use one whole-file request. SQL cannot attest Management API routing, so parent binds
the official target, source/plan/preview hashes, retained rehearsal, and execution
scope externally. Do not overlap G037/G038 controller windows or remove their freeze.
The previous advisor exception is not an authorization token for this separate slice.

Readback runs the immutable broad comparison in READ ONLY, then SET LOCAL ROLE
service_role and emits only nonempty/within_limit/uuid_nonnull/distinct_ids booleans.
Before calling the RPC, the same snapshot rechecks owner attributes, SELECT rights,
and complete RLS visibility; a nonempty but policy-filtered admin subset is denied.
Runner SET permission on service_role is required; do not add a grant to obtain it.
No user UUID leaves that query. The readback does not invoke any deletion route.
After commit, reversal is a separately reviewed compensating migration, not deleting
history or running an automatic rollback. No backup/full-recovery claim is made.

## Validation limits

`TZUDONG_ADMIN_IDS_LOCAL_PG=1 PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest backend.supabase.tests.test_admin_user_ids_catalog_slice -v`
starts an isolated local PostgreSQL 17 container with no network or published ports.
Tests execute the migration unchanged with real roles, privileges, RLS, functions,
transactions and ledger insertion. The small G014 fixture deliberately models the
membership/owner/ACL invariants and injects pre/post failure; it is not a reconstruction
of the entire hosted G014 catalog. Harness tests substitute only the broad advisor
snapshot SELECT with a fixture projection; the reused full advisor snapshot retains
its independent existing tests and must pass on parent's exact hosted readback.
Local tests prove this slice's execution/rollback/denial behavior, not hosted closure.
