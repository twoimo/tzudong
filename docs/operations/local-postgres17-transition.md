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
- `_execution_body()` applies the replacement bodies from
  `_canonical_source_replay_bodies()` unconditionally. That mapping is wider than
  the seven `transform_*_pg15_replay` modules: it also loads
  `verify_g026_reconstruction_bundle`, `transform_advisor_replay`,
  `transform_registration_replay`, `transform_storyboard_owner_replay` and the
  `local_source_replay_windows.json` binding. Several PG15 ones reject any server
  major other than 15, so the whole mapping - not just the seven files - is the
  hand-maintained second copy of migration behaviour the transition has to retire.
- There is a second unconditional replacement path next to it:
  `_execution_body()`/`_apply_replay_verification` also serve
  `_load_replay_contract().supported_sources()`. Retiring only
  `_canonical_source_replay_bodies()` leaves those bodies rewritten on PG17.
- `AGENTS.md` keeps applied migrations immutable, so no workstream may edit a
  migration body that has already been applied.

## Measured baseline (2026-11-11)

Two disposable containers, same prerequisites file and the same 161 migrations, no
adapter layer, no GoTrue/storage bootstrap:

| Probe | Prerequisites role | Migration role | Result |
| --- | --- | --- | --- |
| `supabase/postgres:17.11.0.018` | `postgres` | `postgres` | prerequisites stop at `ALTER DEFAULT PRIVILEGES` (permission denied); chain 53 ok / 108 fail |
| `supabase/postgres:17.11.0.018` | `supabase_admin` | `supabase_admin` | chain 90 ok / 71 fail |
| `supabase/postgres:15.8.1.085` | `supabase_admin` | `postgres` | chain 54 ok / 107 fail |

The failures are the same class on both majors: `must be owner of table ...`,
`permission denied to alter role`, `role "privacy_workflow_owner" does not exist`,
`supported GoTrue session tables are unavailable`, and cascading `G014-xx
required ... dependencies are missing`. The PG15 and PG17 totals differ by one
migration, so **the server major is not the blocking axis**.

What the adapter layer actually supplies is the missing bootstrap and ownership
sequence, not PG15-versus-PG17 compatibility. That reorders the workstreams: the
role, ownership and bootstrap sequence has to be reproduced first, and the image
swap is the cheap step at the end.

## Target

Local apply runs the same role, server major, file set and order as hosted, so a
single chain produces a single catalog. `local-migrate.py verify` keeps its
digest contract; the PG15 replay layer disappears.

## Workstreams

Each workstream lands as its own pull request and is gated by a dispatched
`nightly-local-regression` run on `develop`, not by a local smoke test.

1. **Role, ownership and bootstrap sequence.** Reproduce what the pipeline
   supplies today: prerequisites as `supabase_admin`, migration bodies as
   `postgres`, the GoTrue/storage bootstrap bundles, and object ownership read
   back per object. Acceptance: the chain reaches the same object count and
   ownership profile it reaches on PG15 today.
2. **Server major and replay layer.** Pin `supabase/postgres:17.*` in
   `docker-compose.yml`, in `local-stack.py::_execute_volume_helper()` (which
   pins the same image independently) and rebind the compose hashes in
   `backend/supabase/local-inputs/manifest.v1.json`; `_stage_input_files()` copies
   that image's bundled initialisation scripts and migrations into the volumes,
   so the helper pin is part of the same change. Retire the whole
   `_canonical_source_replay_bodies()` mapping **and** the
   `_load_replay_contract()` verification replacements, not only the seven
   PG15-named modules. The nightly workflow pins the same image twice
   (`.github/workflows/nightly-local-regression.yml` prefetch and its readiness
   check) and `local-stack.py` pins it a third time, so all four pins move
   together or the acceptance run cannot even create the PG17 database. They must move
   together: the transforms are applied unconditionally and several reject a
   server major other than 15, so a standalone server bump cannot reach a green
   nightly. Acceptance: the stack starts, `local-migrate.py manifest`/`verify`
   pass, the 14 `current_user` migrations pass, nightly is green.
3. **Role parity with hosted.** Only after the sequence is reproduced, compare
   the statements that still run as `supabase_admin` against the hosted path,
   statement by statement, and align the ones that demonstrably differ.
   Acceptance: catalogue ownership and ACL grantors match the generator.
4. **File set.** `exclusions` is descriptive output, not a filter: `build_manifest()`
   enumerates `migration_files()` over `EXPECTED_SOURCE = backend/supabase/migrations`
   only, and `_reject_path_custody()` rejects app paths outright. Including the app
   directory therefore means changing the source enumeration and the custody rules,
   then regenerating the manifest - not editing the exclusion list. Fix any
   migration that only worked because it was skipped. Acceptance: local
   `migrationCount` equals the generator's, nightly green.
5. **Ordering.** Keep the applied SQL bytes untouched - editing an applied
   migration would leave existing databases on old bodies while a fresh replay
   executes new ones, destroying the parity this transition exists to create.

   The current splice is structurally required and stays: on a fresh replay
   `20260820040000_pipeline_batch_upsert.sql` revokes `service_role` access to the
   three identity helpers, and `20261003065736_g014_current_service_rpc_registry.sql`
   then checks those privileges and raises `G014_SERVICE_REGISTRY_*`. The
   restoration (`20261003095444_restore_service_identity_helpers.sql`) has to run
   between them, which a contract executed before the whole chain cannot do. The
   work here is to keep the splice explicit and validated (constant, fidelity
   check, receipt) and to document it as an ordering requirement rather than an
   accident. Acceptance: the splice is covered by a test that fails if either
   neighbour moves, generator parity holds, no applied migration body changes.

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
  - after workstream 3: restore the source enumeration, the custody rules and the
    manifest digest together - the exclusion entry alone does not describe the
    file set;
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
