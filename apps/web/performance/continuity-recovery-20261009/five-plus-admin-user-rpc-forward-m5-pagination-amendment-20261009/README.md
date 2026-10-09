# Five-stage plus admin-user RPC forward M5 pagination amendment

Status: passed. This is a new exact PostgreSQL 17.6 replay for the M5 `cleanup_read` 25-row bound and its dependent admin-user RPC forward. The earlier five-stage and forward proof directories are frozen and unchanged.

## Exact source binding

The ordered five-stage manifest is `.github/admin-record-sql-successor.v1.json`, SHA-256 `02b6c26ea482b3c1689fb7538f47c53b00ade0fa0023dfb596007b556a9e0f26`, source root `15da876acc3c544fef42ca3fe00c9a260c490d683a7d33593b53aac881f273f3`.

The changed M5 source is `backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql`: 13185 bytes, SHA-256 `b596b200e52c6813a4cfa1b0a2818625f067864549e8854f3497afdcdab706da`, 13 statements, statement-vector SHA-256 `c7b5ae6c7c64b00a31658bbf42165dd9e25ac41f794a1149c62d47f39cf33f4d`. It adds the guarded `cleanup_read` `LIMIT 25` pagination bound.

The new M5 changes the accepted post-five body hash of `public.admin_record_action` to `a18fad1f748d736371a9ab549a1ca483a5b2f321674fabe71b2411b7e58b3fc9`. The unapplied forward was therefore refreshed to bind that actual preimage. `backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql` is 40392 bytes, SHA-256 `2067538f89c9f90d28e784672c7a1288306ba22d5ae92b087c8692503da9b1ae`, 2 statements, statement-vector SHA-256 `b8eb5902bb5996cffa5cca2f564c1c1c29593dd0a345f2ffbcaca2f86e3f7a3a`. Its statement hashes are `811ffa9547794fbcbb61e73fcbe809bb2193b32ed1fb16a120d2b56d835b7141` and `f76bab06a710e371d8f42a9307e0cc442a631023edec26310a5370ec5f43d713`.

The forward held manifest is `.github/admin-user-rpc-forward-successor.v1.json`, SHA-256 `12cb67ed7e30acc7238370f0ad054bbef3d235b85982545e2ba028a7570d3f99`. It pins the same five-stage manifest and source root.

The PostgreSQL 15 source-only verifier was refreshed because it hash-binds the forward while executing only its accepted dependency/target overlap in a read-only transaction. `verify_admin_user_management_rpc_forward_replay.py` is `edf65e557363d16f7c3fcf1359fe880999e275924fcf57d46abd2edb956d9c53`; its generated verifier SQL is `d40a19e1a3564a6a22b92d857e6aece7968a097311cf37a8a7782d917266dbb7`. `local_replay_contract.py` is `e6e44d085ac93232121ca0b5bad44270ac591c9a802cbd93b829601a572779cf` and binds both hashes. The generator integration source is `724840e9934ede460266b9637e8ff0b309b363778ba7d40e83e111c83f2cd9f6`.

## Exact runtime result

The local native binary root `/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-17.6/installed/bin` read back PostgreSQL `17.6` / `170006` in a socket-only owned cluster, then was stopped and removed. Its extension set is insufficient for the full Supabase schema, so the full-schema run used the already-cached exact PostgreSQL 17.6 Supabase image `sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab` with pull policy `never`, network `none`, and no published ports.

The five exact SQL files applied as one outer transaction with exact statement vectors. The synthetic three-row ledger prefix was preserved and the post-five ledger contained eight rows. The forward used `psql --single-transaction --file=-`.

- Injected terminal mismatch returned `P0001 / MIGRATION_TERMINAL_READBACK_FAILED`; schema, data, roles, and memberships rolled back exactly, and reconciliation was `not_applied`.
- Revoking the required post-five `admin_record_action` service-role ACL returned `P0001 / admin_user_forward_post_five_function_drift`; the mutation and forward rolled back, and no forward target was installed.
- Success preserved the three-row prefix and post-five bindings, stored the exact original forward vector, produced ledger `3 + 5 + 1 = 9`, installed exactly three RPCs and three allowlist rows, and passed four G014 assertions.
- The RPC fixture verified ordered and bounded metadata (200 IDs), ordered minimized audit readback (50 returned of 52 stored), three invalid metadata denials, two invalid audit-limit denials, three invalid append denials, 52 positive appends, and rollback-contained positive writes with exact rollback.
- The pagination fixture created 26 synthetic cleanup jobs. Repeated first reads returned the same ordered 25 IDs; after claim, Storage-contract deletion/absence completion, the next read returned the one distinct remaining job; final read returned zero, all 26 jobs were `done`, and `mediaCleanupPending=false`. The 26 jobs represented 25 synthetic objects because the verification key deliberately creates both private and legacy-public bucket jobs.

The Storage deletion fixture followed the frozen schema's server contract by setting transaction-local `storage.allow_delete_query=true`; it made zero external Storage calls. No personal rows or hosted ledger rows were copied. No hosted or operating database call or write occurred.

All five replay databases were dropped. The native cluster, owned container, owned volume, and temporary scripts were removed. A final process/container/volume inventory found no owned resource remaining.

## Preserved attempts

- `attempt-1` proves the old forward preimage failed closed after the new M5 changed the `admin_record_action` body hash; exact state rollback and cleanup completed.
- `attempt-2` reached the refreshed forward and stopped at the first pagination fixture because its synthetic Storage buckets had not been seeded (`23503`).
- `attempt-3` seeded buckets and stopped at the frozen Storage direct-delete guard (`42501`), proving the fixture had to use the server deletion contract.
- `attempt-4` completed the cleanup path but its harness counted the visible `set_config` output as part of the deletion count. The final harness uses output-free `SET LOCAL` and passed.

These attempts are retained as raw diagnostics. They do not weaken or replace the terminal passing receipt.

## Integration boundary

The M5 source, five-stage manifest, forward source, forward manifest, and forward hash-bound verifier/test pins must land together. The earlier PostgreSQL 15 dual source-only generate receipts predate the one-line forward preimage refresh and remain historical evidence only; mandatory pinned PostgreSQL 15 source reconstruction must run again for the final committed source.

The held planner remains launch-disabled. Launch still needs fresh clean protected-source and operating readback for the exact project, server `170006`, five-stage transition `80 -> 85`, target absence, serialized apply, and then forward transition `85 -> 86`. This local evidence does not authorize deployment or hosted writes.
