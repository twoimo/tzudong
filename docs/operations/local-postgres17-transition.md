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

## Role probe (2026-11-11)

`backend/supabase/scripts/chain_role_probe.py` reproduces a role sequence against a
disposable container and records the applied/failed counts plus an ownership
profile. Two PG15 baselines are committed:

| Profile | Prerequisite role | Applied / failed | Owners |
| --- | --- | --- | --- |
| `pg15-chain-role-probe-20261111.json` | `supabase_admin` | 54 / 107 | postgres 87, supabase_admin 38 |
| `pg15-chain-role-probe-prereq-postgres-20261111.json` | `postgres` (continue on error) | 70 / 91 | postgres 129, supabase_admin 5 |
| `pg15-chain-role-probe-mixed-20261111.json` | `postgres`, `SUPERUSER` files as `supabase_admin`, grant normalisation after each | 87 / 74 | see baseline |
| `pg15-chain-role-probe-staged-20261111.json` | staged order: GoTrue bootstrap, mixed roles, grant normalisation before each body once the schema exists | **91 / 70** | see baseline |
| ownership-transfer probe (rejected) | staged order plus transferring every privileged-created object to `postgres` | 89 / 72 | not committed: net-negative |

Applying the prerequisite bundle as `postgres` fails on exactly one statement
(`ALTER DEFAULT PRIVILEGES`, `must be member of role "supabase_admin"`) and moves
sixteen more migrations through, because the objects it creates are then owned by
the role that later alters them. The probe replays that one statement as
`supabase_admin` afterwards (`privilegedReplay` in the baseline), which leaves the
bundle complete and `postgres` owning everything it created.

The remaining 91 failures break down by root cause, not by surface:

| Root cause | Migrations |
| --- | --- |
| Privileged role statements inside migration bodies (`permission denied to alter role`, `role "privacy_workflow_owner" does not exist`) | 24 |
| Missing GoTrue bootstrap (`supported GoTrue session tables are unavailable`) | 1 |
| Cascade from those two (`G014-xx required ... dependencies are missing` and friends) | 65 |
| Ownership or permission | 1 |

Twenty-five statements are the whole problem; the other sixty-five clear themselves
once those succeed. The list of the 24 is what the adapter ledger in
`backend/supabase/baselines/local/PG15_REPLAY_ADAPTERS.v1.json` describes, so the
two can be reconciled directly. The remaining failures cluster as follows, and
nothing else:

1. privileged role statements the migration bodies issue themselves
   (`permission denied to alter role`, `role "privacy_workflow_owner" does not exist`);
2. the GoTrue bootstrap (`supported GoTrue session tables are unavailable`);
3. cascade from those (`G014-03/04/05/09 required ... dependencies are missing`,
   `function public.extract_youtube_video_id(text) does not exist`).

So the step-1 target is concrete: split the prerequisite bundle at the privileged
statement, apply the rest as `postgres`, supply the GoTrue bootstrap, and move the
handful of privileged role statements out of the migration bodies (that is what the
adapter ledger lists). The image swap then has nothing left to compensate for.

## Role model and privileged pre-pass

`backend/supabase/baselines/local/LOCAL_ROLE_MODEL.v1.json` records what the chain
assumes, with each rule tied to the measurement that established it:

| Rule | Statement | Evidence |
| --- | --- | --- |
| R1 | Statements that mention `SUPERUSER` run as `supabase_admin`. `postgres` is refused even when it created the role and holds `CREATEROLE`. | probe 2026-11-11 |
| R2 | Object DDL runs as `postgres`. Objects created by a privileged run are owned by `supabase_admin`, and the following `postgres` migrations cannot use them. | mixed-role probe 2026-11-11: 74 applied, then `permission denied for schema privacy_retention` |
| R3 | The privileged pre-pass creates and normalizes roles only: no schemas, tables, functions or grants. | R2 |
| R4 | A migration that mixes role statements with object DDL keeps a replacement body until it is split - exactly the list in `PG15_REPLAY_ADAPTERS.v1.json`. | adapter ledger |
| R5 | `privacy_retention` is owned by `privacy_workflow_owner`; `postgres` reaches it through explicit grants only, because the g013/g014 guards reject any membership on that role. | mixed probe: 87 applied, `privacy_workflow_owner` reports 0 memberships |
| R6 | Migrations that `SET ROLE privacy_workflow_owner` belong to the privileged set - running them as `postgres` needs the forbidden membership. | mixed probe: `must be member of role "privacy_workflow_owner"` |

Four migrations contain `SUPERUSER` (`20260713000450`, `20260713002000`,
`20260713002400`, `20260804000500`) and five contain `CREATE ROLE`/`ALTER ROLE`;
a test keeps those lists equal to the sources.

The pre-pass this model implies, which is what the adapters already do, is:

1. run the prerequisite bundle as `postgres` and replay its single
   `ALTER DEFAULT PRIVILEGES` statement as `supabase_admin`;
2. run the role statements of the four privileged migrations as `supabase_admin`
   before their bodies;
3. run every body as `postgres`, with the privileged statements removed from the
   body (replacement body) so nothing is applied twice;
4. keep the objects those bodies create owned by `postgres`.

### Bootstraps

The GoTrue bootstrap is reproducible: `backend/supabase/scripts/render_gotrue_migrations.py`
renders the image's 65 `text/template` migrations (their only variable is
`{{ index .Options "Namespace" }}`) into plain SQL, and applying them as
`supabase_auth_admin` creates `auth.sessions` and `auth.refresh_tokens`. Verified
65/65 on PG15.

### Staged order (best measured profile)

Running the stages in order - prerequisite as the migration role, privileged
prerequisite replay, GoTrue bootstrap, then per migration a conditional grant
normalisation followed by the body - reaches **91 applied / 70 failed**, the best
of four profiles (54, 70, 87, 91). The probe implements that order behind
`--gotrue-migrations`, `--mixed-privileged`, `--staged-grants` and `--grant-file`.

### Baseline restore instead of an adapter rewrite

Rewriting the ~24 migrations the adapters replace collides with applied-migration
immutability, so the transition has a cheaper candidate: keep the working schema
and move it to PG17 as a baseline.

`backend/supabase/scripts/pg17_baseline_probe.py` measures exactly that inside the
nightly local regression - it dumps the live schema read-only, restores it into a
disposable `supabase/postgres:17.11.0.018` container, counts objects on both sides
and reports the restore errors. It is gated behind the `pg17_baseline` dispatch
input (default `false`), so the nightly is unchanged unless it is requested.

### Measured: the working schema does restore on PG17

Two nightly runs of `pg17_baseline_probe.py` (record:
`backend/supabase/baselines/local/pg17-baseline-restore-20261111.json`):

| Run | Restore role | Source | Restored | Missing | Errors |
| --- | --- | --- | --- | --- | --- |
| 43023085171 | `postgres` | 260 | 14 | - | 2603, all `permission denied for database` |
| 43029324112 | `supabase_admin` | 260 | 259 | - | 172, all `already exists` |
| 43062413888 | `supabase_admin` | 260 | 260 | **0** | 120 |
| 43072708471 | `supabase_admin` | 260 | 260 | **0** | 119, all one role reference |
| 43091959049 | `supabase_admin` | 260 | 260 | **0** | **0 - restored** |

The first run is not a schema result: that image gives `postgres` no DDL rights, so
every statement failed. Once the restore runs as `supabase_admin` the schema lands,
and every remaining error names an object the image seeds itself (`auth`, `storage`,
`vault`, `extensions`, `graphql`, `realtime`, `pgbouncer`).

So the transition does not need the ~24 migrations rewritten. It needs the adapter
layer kept, and the last version of the probe lands **260 of 260 objects with none
missing** - the residual is one role the schema dump names but does not create, which
is a role reference rather than a schema problem.

The path to that number is worth keeping, because three of the four failures looked
like version incompatibility and were not:

* restoring as `postgres` fails everything - that image gives it no DDL rights;
* the image seeds `auth`, `storage`, `vault`, `extensions`, `graphql`, `realtime` and
  `pgbouncer`, so a naive restore reports 172 `already exists` errors;
* a schema-only dump carries no `CREATE ROLE`, and the role statements were joined
  without semicolons, so `psql` read them as one broken statement and created nothing.

Two workflow fixes came out of this and apply beyond the probe: the Chromium install
now retries (six dispatches died on runner DNS before the stack was ever started),
and the probe runs before the regression lanes so a lane failure cannot consume the
measurement.

### Baseline provisioning exists and is measured

`backend/supabase/scripts/local_baseline.py` owns both halves of the move:

| Command | What it does |
| --- | --- |
| `capture` | writes `schema.sql`, `objects.txt`, `roles.sql` and a manifest hashing all three |
| `provision` | creates the roles the dump names, resets the image-seeded schemas, restores, and proves object parity |
| `verify` | validates a baseline directory against its manifest |

The PG17 probe is a thin wrapper over that module, so the nightly exercises the real
provisioning path. Nightly run 43152892877 produced a complete baseline and reported
`restored: true`: 260 objects captured, 260 restored, no setup error, no restore
error, no missing object, 7 roles, `schemaSha256 ef155948...`, 2,323,008 bytes.

Two properties matter more than the number. `provision` refuses to report success
without object parity, and the manifest hashes the schema, the object names and the
roles, so a baseline cannot be used after any of them changed.

### The baseline is committed, and drift fails the nightly

`backend/supabase/baselines/local/schema/` holds the captured baseline: `schema.sql`
(2.3MB), `objects.txt`, `roles.sql` and `manifest.json`, which hashes all three. It is
the artifact a provisioned stack boots from, so it lives with the code instead of in a
CI upload nobody can point at.

The nightly step *Verify the committed local baseline matches the stack* compares a
fresh capture against that manifest and fails with the regeneration command when the
object set moved:

    local_baseline.py capture --container <db> --output backend/supabase/baselines/local/schema

The gate reads the object set - count, names digest, role count - and not the dump
hash, because `pg_dump` output can differ without the schema differing and a gate that
fires on formatting gets switched off rather than fixed. Nightly run 43156573526
passed the gate against the committed baseline.

### The pins are split by lane

| Lane | PostgreSQL | Why |
| --- | --- | --- |
| application stack (`docker-compose.yml`, `local-stack.py` volume helper) | **17.11.0.018** | provisioned from `baselines/local/schema` |
| replay lane (`docker-compose.replay.yml`, nightly prefetch and readiness probe) | 15.8.1.085 | the historical chain only replays on 15 with the adapters |
| `BOOTSTRAP_SOURCES.v1.json` | 15.8.1.085 | it records the upstream sources the auth bootstrap was generated from |

Starting the stack a developer uses and provisioning it:

    python3 backend/supabase/scripts/local-stack.py start --repository-root .
    python3 backend/supabase/scripts/local_baseline.py provision \
        --container "$(docker ps --filter label=com.docker.compose.service=db --format '{{.Names}}')" \
        --baseline backend/supabase/baselines/local/schema

The nightly local job sets `LOCAL_STACK_REPLAY_STACK=1`, which adds the committed
replay override, so it keeps 15 and its migration coverage while the application
stack runs 17.

### What the pin actually requires

`backend/supabase/tests/test_local_postgres_image_pin.py` refuses a major above 15
while the adapter layer exists, and the adapters exist because the historical chain
replays at 91 of 161 migrations on 17. Those two facts make a pin swap on its own
wrong: `local-migrate.py apply` replays the chain, so moving the pin without changing
how the stack is provisioned turns a working local stack into a 91/161 stack.

The measured baseline restore gives the other order:

1. keep the replay adapters, and build a canonical baseline from a verified stack;
2. provision a new stack by creating the referenced roles and restoring the baseline
   instead of replaying 161 migrations;
3. retire the replay adapters, because nothing replays the chain any more;
4. only then move the pin, which the pin test permits once the adapters are gone.

Step 2 is the missing piece of machinery: the applier has no baseline mode. Until it
does, the pin stays at 15 and the adapters stay load-bearing, which is the current,
measured state rather than a stalled one.

### Applier support (default off)

`backend/supabase/scripts/local-migrate.py` can now run the migration bodies that
PostgreSQL refuses for the migration role as `supabase_admin`, driven by
`backend/supabase/baselines/local/LOCAL_PRIVILEGED_BODIES.v1.json` and gated by
`TZUDONG_LOCAL_PRIVILEGED_BODIES`. It stays off by default, so the local stack
keeps the adapter path and the nightly is unaffected until the switch is made on
purpose.

Turning the flag on before the adapters are gone fails closed with
`privileged_bodies_require_adapter_retirement`: the adapters replace the very
bodies the flag would run under another role, so the order is retirement first,
flag second.

The retirement itself is now a paired worklist rather than a guess:
`PG15_REPLAY_ADAPTERS.v1.json` carries a `retirement` section listing the 16 test
modules that assert each adapter, so deleting an adapter means deleting its listed
tests in the same change. Twenty-four test modules in total depend on the replay
layer, which is why this is a dedicated change and not a line in another one.

### Rejected: extending the privileged set

Widening the privileged bodies from the 4 `SUPERUSER` migrations to all 41 that also
`SET ROLE` changed nothing: 91 applied / 70 failed before and after, with zero churn
in the failing set. The `SET ROLE` bodies already behave correctly, so the remaining
failures are structural rather than role assignment.

That closes the role-assignment line of enquiry: privileged set (4 and 41),
`CREATEROLE`, pre-created roles and ownership transfer are all measured ineffective.
The remaining 70 failures are the semantics of the adapter replacement bodies
themselves.

### Rejected: ownership transfer

The obvious next lever - transfer every `supabase_admin`-created object to
`postgres` - was measured and rejected: **89 applied / 72 failed** against 91 / 70.
It fixed one migration and broke three, including `G014 SECURITY DEFINER owner
mismatch`, because the guards require ownership exactly as the migrations define
it. `privacy_retention` belongs to `privacy_workflow_owner` and that is not an
accident to be normalised away.

The same applies to granting `postgres` `CREATEROLE` (no effect at all: 70 / 91
before and after). The remaining 70 failures therefore need the privileged-set
expansion - the replacement bodies the adapter ledger lists - not another grant.

### The ordering is the open problem

Combining the pieces is not additive. Bootstrapping GoTrue first and then running
the mixed chain measured **78 applied**, against 87 without the bootstrap, because
the grant normalisation runs before `privacy_retention` exists in that order. The
replay engine therefore needs a defined order - bootstrap, privileged roles,
grant normalisation per schema as it appears, then bodies - instead of more probe
permutations. That is recorded as the first open question in the model file.

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
