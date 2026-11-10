# Local migration apply: PostgreSQL 17 transition plan

Tracks issue #3323. The local apply (`backend/supabase/scripts/local-migrate.py`
on the pinned Compose stack) does not replay migrations the way hosted does, so
a green local run does not by itself predict a hosted apply.

## Current divergence (verified on `develop` @ `acf9d37d`)

| Axis | Local | Hosted / generator |
| --- | --- | --- |
| Role | `LocalMigrationExecutor._base(...)` defaults to `role="supabase_admin"` (superuser); the allowlist is `{supabase_admin, postgres}` | `postgres`, non-superuser |
| Version | `supabase/postgres:15.8.1.085` | PG17 (`server_version_num` 170006) |
| File set | `apps/web/supabase/migrations` is listed under `exclusions` in `build_manifest()` | included |
| Order | filename order | filename order plus a splice of `20261003095444_restore_service_identity_helpers.sql` before `20261003065736_g014_current_service_rpc_registry.sql` (`SERVICE_IDENTITY_PRECEDECESSOR`) |

Two supporting facts bound the design:

- 14 migrations assert `current_user`/`session_user = 'postgres'` or require
  `postgres`-owned objects. Applying as a superuser cannot satisfy them, and
  making `postgres` a superuser locally is not an option: the G014 workflow
  owner contract migration requires `rolname = 'postgres' AND NOT rolsuper`.
- 7 `transform_*_pg15_replay.py` scripts exist only to make the PG15 replay
  match PG17 semantics. They are a hand-maintained second copy of migration
  behaviour and must be deleted by this transition, not extended.

## Target

Local apply runs the same role, server major, file set and order as hosted, so a
single chain produces a single catalog. `local-migrate.py verify` keeps its
digest contract; the PG15 replay layer disappears.

## Workstreams

Each workstream lands as its own pull request and is gated by a dispatched
`nightly-local-regression` run on `develop`, not by a local smoke test.

1. **Server major.** Pin `supabase/postgres:17.*` in `docker-compose.yml`, rebind
   the compose hashes in `backend/supabase/local-inputs/manifest.v1.json`, and
   confirm `local-stack.py render` still admits the stack. Acceptance: the stack
   starts, `local-migrate.py manifest`/`verify` pass, nightly is green.
2. **Role and replay layer.** Apply as `postgres`, then delete the seven PG15
   transform scripts and their call sites in the same change so no migration can
   silently fall back to the superuser path. Acceptance: the 14 `current_user`
   migrations pass, catalogue ownership matches the generator, nightly is green.
3. **File set.** Remove `apps/web/supabase/migrations` from the exclusions list,
   regenerate the manifest, and fix any migration that only worked because it was
   skipped. Acceptance: local `migrationCount` equals the generator's, nightly
   green.
4. **Ordering.** Replace the `SERVICE_IDENTITY_PREDECESSOR` splice with explicit
   prerequisites inside the migrations that need them, then drop the constant from
   `local-migrate.py` and `materialize_migration_workspace.py`. Acceptance: the
   registry prerequisites apply in plain filename order, generator parity holds.

## Verification and rollback

- Verification is the canonical nightly run (`workflow_dispatch`,
  `suite: all`) plus `local-migrate.py verify` digests; a local container smoke
  test is not sufficient evidence.
- Rollback is a single revert of the pin, the manifest hashes and the role
  default. The PG15 image stays published, so reverting workstream 1 restores the
  previous chain.
- Do not split workstream 2 across pull requests: keeping the role change and the
  transform deletion apart leaves a window where both paths can pass.

## Known limit

Local apply still cannot prove hosted behaviour for extensions, ACL defaults or
role inheritance that the image configures differently. This plan removes the
structural divergence; it does not turn local runs into hosted evidence.
