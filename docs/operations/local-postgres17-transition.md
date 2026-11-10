# Local migration apply: PostgreSQL 17 transition plan

Tracks issue #3323. The local apply (`backend/supabase/scripts/local-migrate.py`
on the pinned Compose stack) does not replay migrations the way hosted does, so
a green local run does not by itself predict a hosted apply.

## Current divergence (verified on `develop` @ `acf9d37d`)

| Axis | Local | Hosted / generator |
| --- | --- | --- |
| Role | Migration bodies run as `postgres` (`executor.run(body, role="postgres")` in the apply loop, `local-migrate.py` ~L5036). The `supabase_admin` default on `_base()` covers ledger/setup statements only | `postgres`, non-superuser, for every statement |
| Version | `supabase/postgres:15.8.1.085` | PG17 (`server_version_num` 170006) |
| File set | `apps/web/supabase/migrations` is listed under `exclusions` in `build_manifest()` | included |
| Order | filename order | filename order plus a splice of `20261003095444_restore_service_identity_helpers.sql` before `20261003065736_g014_current_service_rpc_registry.sql` (`SERVICE_IDENTITY_PRECEDECESSOR`) |

Three supporting facts bound the design:

- 14 migrations assert `current_user`/`session_user = 'postgres'` or require
  `postgres`-owned objects. Because migration bodies already run as `postgres`,
  the remaining role work is narrower than the original issue states: it is the
  ledger and setup statements that still execute as `supabase_admin`. That
  difference has to be demonstrated statement by statement before it is changed,
  and making `postgres` a superuser locally stays off the table: the G014
  workflow owner contract migration requires `rolname = 'postgres' AND NOT
  rolsuper`.
- 7 `transform_*_pg15_replay.py` scripts exist only to make the PG15 replay
  match PG17 semantics, and `_execution_body()` applies them unconditionally -
  several of them reject any server major other than 15. They are a
  hand-maintained second copy of migration behaviour and must be deleted by this
  transition, not extended.
- `AGENTS.md` keeps applied migrations immutable, so no workstream may edit a
  migration body that has already been applied.

## Target

Local apply runs the same role, server major, file set and order as hosted, so a
single chain produces a single catalog. `local-migrate.py verify` keeps its
digest contract; the PG15 replay layer disappears.

## Workstreams

Each workstream lands as its own pull request and is gated by a dispatched
`nightly-local-regression` run on `develop`, not by a local smoke test.

1. **Server major and replay layer together.** Pin `supabase/postgres:17.*` in
   `docker-compose.yml`, rebind the compose hashes in
   `backend/supabase/local-inputs/manifest.v1.json`, and delete the seven PG15
   transform scripts plus their call sites in the same change. They must move
   together: the transforms are applied unconditionally and several reject a
   server major other than 15, so a standalone server bump cannot reach a green
   nightly. Acceptance: the stack starts, `local-migrate.py manifest`/`verify`
   pass, the 14 `current_user` migrations pass, nightly is green.
2. **Remaining role difference.** Only after the replay layer is gone, compare
   the ledger/setup statements that still run as `supabase_admin` against the
   hosted path, statement by statement, and align the ones that demonstrably
   differ. Acceptance: catalogue ownership and ACL grantors match the generator.
3. **File set.** Remove `apps/web/supabase/migrations` from the exclusions list,
   regenerate the manifest, and fix any migration that only worked because it was
   skipped. Acceptance: local `migrationCount` equals the generator's, nightly
   green.
4. **Ordering.** Keep the applied SQL bytes untouched. Replace the
   `SERVICE_IDENTITY_PREDECESSOR` splice with a separately versioned bootstrap or
   prerequisite contract that runs before the chain, then drop the constant from
   `local-migrate.py` and `materialize_migration_workspace.py`. Editing the
   already-applied migrations instead would leave existing databases on old
   bodies while a fresh replay executes new ones, which destroys the parity this
   transition exists to create. Acceptance: registry prerequisites apply without
   a filename splice, generator parity holds, no applied migration body changes.

## Verification and rollback

- Verification is the canonical nightly run (`workflow_dispatch`,
  `suite: all`) plus `local-migrate.py verify` digests; a local container smoke
  test is not sufficient evidence.
- Rollback is defined per stage, because the stages delete code:
  - after workstream 1: revert the pin, the manifest hashes **and restore the
    seven transform scripts with their call sites** - reverting the pin alone
    leaves a PG15 server without the adapters its replay needs;
  - after workstream 2: revert the role alignment together with the statement
    change that motivated it;
  - after workstream 3: restore the exclusion entry and the manifest digest;
  - after workstream 4: restore the splice constant, which is one line in each of
    `local-migrate.py` and `materialize_migration_workspace.py`.
  The PG15 image stays published, so every stage remains revertible to the
  previous chain.
- Do not split the server bump from the adapter deletion, and do not split a role
  change from the statement change that motivates it: both splits leave a window
  where two paths can pass and neither is proven.

## Known limit

Local apply still cannot prove hosted behaviour for extensions, ACL defaults or
role inheritance that the image configures differently. This plan removes the
structural divergence; it does not turn local runs into hosted evidence.
