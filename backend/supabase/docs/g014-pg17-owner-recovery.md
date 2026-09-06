# G014 workflow owner on PostgreSQL 17

The deployed PG17 catalog has a G041 assertion written for the PG15 membership
model. The real assertion fails before unrelated RPC installations can finish.
The observed owner memberships include the auth bridge, the provider bootstrap
ADMIN grant to `postgres`, and an additional self-granted INHERIT row.

PostgreSQL 17 automatically grants a newly created role back to a nonsuperuser
creator with ADMIN, without INHERIT or SET. The bootstrap superuser is the
grantor, and the creator cannot revoke that grant. The creator can explicitly
grant itself access using ADMIN; absence of INHERIT/SET is an accident safeguard,
not isolation from the trusted database administrator. See the official
[PG17 role attributes](https://www.postgresql.org/docs/17/role-attributes.html).

## Proposed change

`20260906064252_g014_pg17_workflow_owner_contract.sql` accepts PG17 only. It pins
the old assertion body to SHA-256
`5515d2269ddf0ffa26a414f21989b60dce1a41002440f0a81d3c646b34774b40` and preserves
its ownership, invoker status, empty search path and ACL. The replacement keeps
all owner and bridge attribute checks and requires exactly:

- the original `privacy_auth_bridge` → `privacy_workflow_owner` inheritance;
- one bootstrap ADMIN-only grant from OID 10, named `supabase_admin`, to
  `postgres` for each workflow role;
- no effective INHERIT or SET access from `postgres` to either workflow role;
- no extra inbound or outbound memberships involving either workflow role.

It removes only the existing self-granted owner INHERIT row. The bootstrap rows
and bridge membership remain byte-for-byte unchanged. No application role gets
an additional privilege. A temporary owner execution window replaces the
assertion; its one-shot private temporary function checks the final role state
and removes itself. Every other public/private function, schema and role
attribute is compared inside the same transaction. An unexpected state aborts
the whole operation.

## Replay and verification

The canonical clean replay uses PG15. Its adapter is read-only and verifies the
unchanged legacy assertion body, owner, ACL, role attributes and one-membership
contract. It does not execute PG17 DDL, grant privileges, or claim a PG17 apply.
Both source and adapter are included in the replay artifact chain.

Private PG17 tests cover rollback, exact removal, retained bootstrap grants,
app-role denial, repeat-apply rejection, extra memberships, active SET leases,
bridge self-access, privileged role attributes and reintroduced access. Private
PG15 tests cover the unchanged legacy contract, no schema-access grant, extra
membership/ACL denial and byte-bound source verification.

## Execution status and remaining prerequisites

This file records source preparation, not a hosted migration or release. The
current hosted ledger was still 51 after the bounded diagnostics. All attempts
in `tzudong-admin-rpc-apply-v3-20260906`, the G016 data-repair directories and
their diagnostic directories remain spent and must not be reused.

This role correction alone does not fix the retired onboarding allowlist
identity, public vector extension exposure, identity-helper writer dependency,
missing application RPCs, generated-type parity, or legal/operator evidence.
The complete production catalog checks remain mandatory. In particular, do not
revoke vector/helper execution blindly: private tests demonstrate broken vector
operators, casts, inserts and indexed restaurant writes after that action.

Before hosted execution, retain a new exact catalog/ledger preview, protected
source and rollback plan; validate the complete recovery in private exact-version
fixtures; perform a separate rollback rehearsal and independent restoration
readback; then admit a single apply and independent committed readback. Keep
producer freeze and external release gates active throughout.
