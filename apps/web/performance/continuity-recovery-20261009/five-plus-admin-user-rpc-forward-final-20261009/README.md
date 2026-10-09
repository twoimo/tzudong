# Final five-stage plus admin user RPC forward replay

Status: passed. This directory is the fresh terminal evidence for the final M5 bytes plus the admin user-management RPC forward. Earlier five-stage and forward proof directories remain unchanged.

## Source-only PostgreSQL 15 compatibility

The raw forward is deliberately operating-only: it requires `server_version_num=170006`, exact post-five ledger count 85, target absence and the protected role/catalog preimage. It also reads the PostgreSQL 16+ `pg_auth_members.inherit_option` and `set_option` columns and uses the corresponding membership `GRANT` options. Direct raw replay in the pinned PostgreSQL 15 source-reconstruction job would therefore fail before it could represent the intended operating admission.

The project already supports this class through `local_replay_contract.py`. The minimal integration classifies the forward as `verified-existing` and runs a hash-bound `REPEATABLE READ READ ONLY` verifier. The verifier proves that the forward's `DEPENDENCY` and `TARGET` guard sections are byte-identical to the accepted `20260906053936_admin_management_group_catalog_slice.sql` source and that the accepted source, its canonical predecessor, planner and G037 parser still match their pins. It emits `operating_sql_executed=false`, keeps the exact operating requirements `170006` and ledger 85, and does not execute or exclude the raw forward. The generate job validates the exact receipt and chains the verifier, generated SQL and receipt into its evidence.

`source-only-compatibility.json` binds the integration sources. Twenty verifier/replay-contract tests, seven held-forward planner tests and `bash -n` for the generator passed. The full pinned PG15 generate remains a clean-checkout CI gate because the generator intentionally rejects dirty relevant sources; the current authorized files are uncommitted. This is the only remaining source-only integration check.

## Exact runtime source bindings

The five ordered sources are:

1. `20261004190259_admin_record_guarded_actions.sql`: `b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95`, 39 statements, vector `5038d14ce704d494889562f04d33cacae7bd7a117bf4cd2341752bd3b40f12af`.
2. `20261004192657_admin_evaluation_raw_warning_groups.sql`: `66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a`, 10 statements, vector `082fec2c22c8588e262bbe6cd936cb30f6b100c3f5b2ffec489ff144bbdfc5f8`.
3. `20261004194715_admin_evaluation_raw_warning_invoker_contract.sql`: `e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020`, 4 statements, vector `f211b61f0959413d40783cd62b4221e9ec30d92792ad86b61ca186f504c6c0e1`.
4. `20261009022915_restaurant_review_manual_preview_eligibility.sql`: `8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3`, 4 statements, vector `ab55e1704f6b54134d7153603d55f948b19ab2c8ac9dfdf31d7ea1ef82d43958`.
5. Final `20261009091342_admin_record_private_verification_cleanup.sql`: `03c8ebabaaf7255e1c5ab5dedf59a95782b78dbc960668870ea80fc8780ab3af`, 12195 bytes, 13 statements, vector `147414379f4eebdc1274257419629107a80be59ec3203a064f29c82472760003`.

The five-stage manifest is `a7ed53ed124576039e1d49ae62f46626e9747c2c2a0d4711e93c4fc5f1b24140` with source root `fecccabd16de11d37e54d28517331ba8fcd7fa177859844d8490af7a221cc732`. The forward is `b96126240399e580ed6b7198edbd3d0af44b26ec5cab66073c037b331ec8eb26`, 40392 bytes, 2 statements, vector `949cbb0862da3e62c190cdeafd23051198178440584b9ebf3f96cec1f062d9c6`.

## Runtime outcome

The native binary path was admitted as PostgreSQL `17.6` / `170006` in an owned socket-only cluster and then removed. That installation exposes only `plpgsql` from the required extension set, so the synthetic full-schema reconstruction ran on the already-cached, digest-pinned Supabase PostgreSQL `17.6` image `sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab`, with `--pull=never`, network mode `none` and no published ports. The image server independently read back `17.6` / `170006`.

All five migrations were compiled and applied as one outer transaction with exact source vectors. The post-five ledger had the three synthetic prefix rows plus five exact migration rows. The forward then ran with explicit `psql --single-transaction --file=-`.

- Injected terminal mismatch returned `P0001 / MIGRATION_TERMINAL_READBACK_FAILED`, left schema/data/roles/membership byte-equivalent and reconciled as `not_applied`.
- Revoked post-five `admin_record_action` ACL returned `admin_user_forward_post_five_function_drift`; the ACL mutation and forward both rolled back, with no target installed.
- Success preserved the three-row prefix and post-five catalog, stored the exact forward vector, produced ledger `3 + 5 + 1 = 9`, installed exactly three functions and three allowlist rows, and passed four G014 assertions.
- Metadata preserved request order, missing-profile null behavior, the admin projection and the 200-ID bound. Audit read returned 50 of 52 rows in descending timestamp/id order with the minimized projection.
- Three invalid metadata inputs, two invalid audit limits and three invalid append variants were denied. Fifty-two positive appends were visible inside the fixture transaction, and the complete fixture rolled back exactly.

`attempt-1` records the pre-database relative-path failure (`ENOENT`) and complete cleanup. The terminal run dropped all four replay databases and removed the owned native cluster, container, volume and temporary scripts. No hosted or operating database write occurred, no user row or hosted ledger row was copied, and no manifest/controller was changed by this evidence run.

## Integration boundary

The dedicated forward manifest remains held. Integration still requires the clean pinned PG15 generate job, then an authorized protected-source and operating readback proving the actual 80 to 85 five-stage state, exact target absence and protected revision. The operating apply remains a separate 85 to 86 action; deployment and authenticated browser validation remain separate gates.
