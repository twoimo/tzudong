# Supabase duplicate index removal — 2026-11-12

This change removes eight redundant physical indexes from six public tables.
The inspected hosted target is `aqlcofblfxdrjhhdmarw`; the SQL still requires the
operator to select that authenticated project. Database name and role checks do
not authenticate a Supabase project ref.

The migration is
[`20261112111043_deduplicate_equivalent_public_indexes.sql`](../../backend/supabase/migrations/20261112111043_deduplicate_equivalent_public_indexes.sql).
Hosted application and a fresh catalog/ledger readback are confirmed below.
Final scoped metadata comparisons, advisor readback and the public health
response are also recorded below, with the limits of those checks stated.

## Exact scope

| Table | Remove | Preserve |
| --- | --- | --- |
| `profiles` | `profiles_user_id_idx` | `idx_profiles_user_id` |
| `restaurant_submission_items` | `restaurant_submission_items_submission_idx` | `idx_submission_items_submission_id` |
| `short_urls` | `idx_short_urls_code`, `short_urls_code_idx` | `short_urls_code_unique` UNIQUE constraint and index |
| `short_urls` | `short_urls_code_key` UNIQUE constraint and its index | `short_urls_code_unique` UNIQUE constraint and index |
| `transcript_embeddings_bge` | `idx_bge_embeddings_video_id` | `idx_transcript_embeddings_bge_video_id` |
| `user_bookmarks` | `user_bookmarks_restaurant_idx` | `idx_user_bookmarks_restaurant_id` |
| `user_roles` | `user_roles_user_id_role_idx` | `user_roles_user_id_role_key` UNIQUE constraint and index |

The seven standalone indexes plus the one constraint-owned index total eight
physical objects. The retained `short_urls(code)` UNIQUE B-tree also supports
the same lookups as its two nonunique B-trees. The before snapshot attributed
286,720 bytes (280 KiB) to the eight removed objects. That is an observed object
size total, not a measured billing reduction or a query speedup.

The three `notifications` indexes are excluded. They are recorded by name in
the G014 exact catalog manifest, so removing one without an explicitly reviewed
manifest transition would break the runtime contract. RLS policies, table ACLs,
owners, application rows, the G014 manifest, and producer freeze settings are
outside this migration's write scope.

## Execution and failure behavior

The file runs as one explicit transaction on PostgreSQL 17, database `postgres`,
with both current and session role `postgres`. `lock_timeout` is one second and
`statement_timeout` is 15 seconds. It obtains a transaction advisory lock and
locks the six tables in a fixed order before inspecting indexes. A lock conflict
fails before any index removal; these are ordinary transactional DDL operations,
not concurrent index drops.

Every present candidate is checked before the first DROP. The checks include:

- Exact table and index identity, ordinary permanent nonpartitioned relation
  shape, B-tree access method, and owner consistency.
- Exact key names and order, operator classes, collations and sort/null options;
  no expression, predicate, included column or custom index option.
- Expected uniqueness and NULL semantics, valid/ready/live/immediate state, and
  absence of primary, exclusion, cluster and replica-identity roles.
- Exact retained UNIQUE constraints, and the old short URL constraint's identity,
  keys, nondeferrable validated state and backing index.
- No FK or other incoming dependency on a removed index. The old constraint is
  allowed exactly its own backing index's internal dependency and no other
  dependent object. Extension/internal/partition ownership is rejected.

Only after the complete preflight succeeds are the seven indexes and the old
constraint removed with `RESTRICT`. There is no `CASCADE`, permission change or
implicit repair. The migration then compares every retained index and retained
constraint, including their OIDs, to its preimage and verifies all removals.
Any exception aborts the transaction.

An index already absent is an idempotent no-op, but its keeper is still required
to match the complete expected structure. A named old constraint whose index
has unexpectedly been renamed is rejected. No ledger history is rewritten.

The bounded precondition/readback errors are:

```text
public_index_dedup_executor_denied
public_index_dedup_table_denied
public_index_dedup_column_denied
public_index_dedup_keeper_missing
public_index_dedup_index_drift
public_index_dedup_constraint_drift
public_index_dedup_dependency_denied
public_index_dedup_readback_failed
```

A lost response is not proof of rollback. Read current catalog and migration
ledger state before deciding whether any further execution is needed.

## Hosted application and migration identity reconciliation

The root operator completed Supabase `apply_migration` and observed the following
fresh readback at **2026-11-12 11:11:18.059802 UTC (20:11:18 KST)**.

| Item | Observed value |
| --- | --- |
| Project ref | `aqlcofblfxdrjhhdmarw` |
| Supabase project status | `ACTIVE_HEALTHY` |
| Migration ledger count | 101 |
| Applied migration version | `20261112111043` |
| Applied migration name | `deduplicate_equivalent_public_indexes` |
| Stored statement count | 1 |
| Applied SQL bytes | 14,263 |
| Applied SQL SHA-256 | `600a236aa10eba6b3c5ab96932fb575867a12cf84bfc9ff03974746339fe59e1` |
| Remaining removal names | Empty: all eight intended objects absent |
| Retained valid/ready indexes | 6 |
| Retained valid UNIQUE constraints | 2 |

Supabase CLI 3.1.0 originally generated version **`20261112105200`**, which was
the filename used by the local PostgreSQL tests. The provider assigned
**`20261112111043`** when applying the identical SQL. The fresh hosted ledger's
version, exact SQL hash, byte count and statement count establish that identity.
The repository file was then renamed to the actual hosted version without
changing a single SQL byte. No historical migration content or hosted ledger
row was edited, and no migration repair was performed.

The combined local-test and hosted-application evidence is retained in
[`supabase-index-dedup-tests-20261112.json`](evidence/supabase-index-dedup-tests-20261112.json).
This readback establishes migration application and the scoped index/constraint
poststate. The separate final observations are retained in
[`supabase-index-dedup-hosted-20261112.json`](evidence/supabase-index-dedup-hosted-20261112.json).

## Final hosted verification

| Check | Observed result |
| --- | --- |
| Six retained indexes and three protected `notifications` indexes | Nine metadata/OID comparisons; zero differences |
| Policies captured before the migration | All 36 baseline policies compared; zero differences |
| Wider after-query policy result | 65 policies returned; 29 are outside the baseline snapshot and have no before/after equality claim |
| Relation owners | Seven relations compared; zero owner differences |
| G014 manifest readback | 1,964 rows after application; `g014_catalog_manifest_immutable` trigger remains enabled (`O`) |
| Duplicate Index advisor | Eight findings before, one after; the remaining finding is the deliberately preserved `public.notifications` group |
| Other security advisor findings | The recorded before/after category counts are unchanged; this does not assert that every individual finding or ACL is identical |
| Health advisor | Zero findings after application |
| Supabase project | `ACTIVE_HEALTHY` |
| Public application health | `https://www.tzudong.app/api/health` returned `ok: true` for `tzudong-web`, Git SHA `36a6a3b507dbdbef9afd11dafe73c0efc4e29c80`, deployment `dpl_FHYEeE4Ev5CAfYPfhqzxhE9CYsGK` |

These are scoped checks. The policy result establishes equality only for the 36
policies captured in the baseline, not all 65 policies returned by the later
query. The time at which the other 29 policies were created is not established.
The seven owner comparisons and policy checks do not constitute a full ACL audit.

The exact SELECT serialization for the baseline whole-security and whole-manifest
aggregate fingerprints was not retained, so equality of those full fingerprints
is not asserted. The migration has no policy, grant, owner, manifest,
producer-freeze or application-row mutation; the nine index comparisons and
enabled manifest trigger provide the narrower recorded evidence.

The public health response proves that endpoint's response, not authenticated
end-to-end database workflows. No latency, throughput or billing reduction was
measured. The local tests below used synthetic data and do not establish RLS or
concurrent-load behavior.

## Local verification

An independent disposable PostgreSQL 17.6 fixture passed all five cases on
2026-11-12 using migration SHA-256
`600a236aa10eba6b3c5ab96932fb575867a12cf84bfc9ff03974746339fe59e1`.

| Case | Observed result |
| --- | --- |
| Apply once | Target index family reduced from 14 to 6; all eight intended objects removed; six keepers and six separate primary-key indexes retained with unchanged metadata/OIDs; rows and lookup results unchanged; both surviving UNIQUE constraints reject duplicates |
| Repeat | No-op with identical catalog and rows |
| Rollback | The test copy's final COMMIT was replaced with ROLLBACK; original catalog and rows restored |
| Keeper drift | A descending keeper produces `public_index_dedup_index_drift`; before/after catalog and rows are unchanged |
| FK dependency | A real FK depending on the old short URL index produces `public_index_dedup_dependency_denied`; before/after catalog and rows are unchanged |

The fixture used PostgreSQL single-user mode and synthetic rows. It verifies DDL,
catalog state, row results and constraints. It does not prove hosted application
behavior, RLS behavior, concurrent workload behavior or latency improvement.

The original fixture report inferred zero DROP attempts from an event-trigger
notice. PostgreSQL disables event triggers in standalone single-user mode, so
those attempt counts have been corrected to unknown in the evidence JSON.
Both observed errors are raised in the reviewed SQL preflight before its DROP
loop; that control-flow conclusion is separate from runtime attempt counting.
The five cases' catalog, row, uniqueness and rollback results remain valid.

## PostgreSQL 15 catalog replay compatibility

The first Catalog CI run for PR #3808 failed at this migration with
`public_index_dedup_executor_denied`. The isolated canonical catalog generator
is intentionally pinned to PostgreSQL 15.8.1.085, whereas the hosted migration
requires PostgreSQL 17. Its execution role and database already matched. This
was a replay-environment mismatch, not a failed hosted migration.

`transform_public_index_dedup_pg15_replay.py` follows the existing hash-bound
compatibility adapter pattern. It accepts only the final migration filename,
its exact 14,263-byte source and SHA-256. The generated private replay copy
changes exactly one byte: the single PostgreSQL-major predicate changes from
17 to 15. Reverse replacement must reproduce the immutable source bytes.
The expected PG15 replay SHA-256 is
`c97bd16d4336c92e7c3252fb08999f0f3fd2ba3936b9f66e8e7718732acfcd8c`.

Database/current-user/session-user/read-only checks, transaction boundaries,
locks, all catalog and dependency checks, every DROP and the final readback
remain byte-identical. The generated copy only admits PG15; it is not placed
in the migration directory or sent to the hosted project. The catalog driver
records source, adapter and replay hashes and executes the whole replay body
inside its existing isolated PG15 environment. The local PG15 replay registry
uses the same adapter. No image, role, isolation or application-mode selection
is changed.

The next Catalog replay passed the version check and stopped before any DROP
with `public_index_dedup_keeper_missing`. Source inspection found that the
historical reconstruction inputs create five of the six keeper indexes, but
omit `idx_transcript_embeddings_bge_video_id`. The runtime error does not name
the missing index; that identification comes from the source comparison.

The canonical generator first restored that prerequisite from the
already pinned `baselines/local/application-prerequisites.sql`, following the
existing bounded prerequisite-recovery pattern. The 210,720-byte input has
SHA-256 `c4fce4f7ddaf6315474cb3a3d408eef1fb7ff538af7f39183ebdc46828630356`.
Exactly one 112-byte index definition, including its final LF, is selected:

```sql
CREATE INDEX idx_transcript_embeddings_bge_video_id ON public.transcript_embeddings_bge USING btree (video_id);
```

Its SHA-256 is
`cb2c3de6ec909e758c0a791404c406cad4f622123f180be4b29ddc46beb29ed2`.
The original keeper CREATE statement is preserved without `IF NOT EXISTS`;
unexpected existing state must fail.

[Catalog run 43213090094](https://github.com/twoimo/tzudong/actions/runs/43213090094)
then passed the 271-test unit stage (204 passed, 67 skipped), executed the keeper recovery, and
stopped in the first full replay at `public_index_dedup_index_drift`, before the
dedup DROP phase. The runtime error does not identify an index or field. A full
source comparison found two additional reconstruction differences:

| Index | Historical canonical input | Intended source definition |
| --- | --- | --- |
| `idx_bge_embeddings_video_id` | The January archive creates it on `document_embeddings_bge`; G026 creates `transcript_embeddings_bge` separately | The pinned prerequisite defines it on `public.transcript_embeddings_bge(video_id)` |
| `user_roles_user_id_role_idx` | The May 6 web migration creates a nonunique index; the May 14 backend `CREATE UNIQUE INDEX IF NOT EXISTS` skips that existing name | The May 14 backend migration requires a unique index on `public.user_roles(user_id, role)` |

The canonical-only recovery therefore also normalizes these two known legacy
indexes before running the unchanged dedup body. It validates all legacy
definitions, absence of constraints/dependencies and exclusion from the exact
source-bound declared protected-relation list, then uses
`DROP INDEX ... RESTRICT` and the exact intended source CREATE
statements. The BGE definition comes from the same pinned prerequisite. The
roles definition comes from the separately pinned 7,436-byte
`20260514_00_admin_user_management_hardening.sql`, SHA-256
`da60b7b3fdcd623213d204d076a26dba41d4d1d60486afe62d7a84e077e1445b`.
It is not attributed to the prerequisite file, which does not define that index.

All preconditions are checked before the first DDL in a single bounded
transaction. An unexpected definition, dependency, protected relation, existing
keeper or non-isolated executor state aborts instead of accepting drift. Both
source files, individual definitions, recovery code, generated SQL and receipt
participate in the evidence chain. The receipt is included in both clean replay
artifact manifests and their comparison.

The protected-list check uses public `pg_catalog` metadata, following the
existing `local_catalog_readback.sql` pattern. It binds the function's exact
3,673-byte body SHA-256
`20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2`
and its signature, owner, language, volatility, security mode and search path.
The fixed 61-relation list excludes the three normalization tables. The helper
also checks the manifest's owner, forced RLS and immutable trigger metadata.
It does not invoke the private function, read manifest rows, grant privileges or
switch roles. Manifest row absence or whole-manifest content equality is not
asserted by this check; the generator's existing final G014 assertion gate
remains in place.

Recovery runs only in the isolated PG15 canonical generator immediately before
this migration. The local replay applier uses the full prerequisite first and
only the backend migration directory, so the earlier web nonunique-index
creation is absent from that path. Its BGE index already belongs to transcript,
and the May 14 backend migration creates the roles index as UNIQUE. The extra
canonical recovery is not registered with the local applier. The production
migration, its one-byte PG15 adapter, original source inputs, and original
keeper/dependency checks remain unchanged.

The final normalization code passed 10 source/generator tests, and the driver
integration plus artifact-comparison modules passed 31 tests. An independent
review verified the source bindings, protection boundary and preflight order.
The separate
[`supabase-index-dedup-pg15-tests-20261112.json`](evidence/supabase-index-dedup-pg15-tests-20261112.json)
records 13/13 real PostgreSQL 15.8 synthetic single-user cases: full recovery
followed by the unchanged adapter and idempotent repeat, transaction rollback,
and rejection of drifted indexes, protection metadata, an actual extension
dependency, a hosted migration schema, or a PostgreSQL 17 executor. The positive
case preserves 21 synthetic rows, retained index/primary-key metadata and both
UNIQUE constraints. These tests do not establish role privileges, RLS execution,
concurrency, full canonical replay or hosted results. Event-trigger attempt
counts are not measured in single-user mode.

PG15 reconstruction, the original PG17.6 five-case fixture, and the hosted
apply/readback are separate evidence. A passing PG15 catalog check must not be
reported as PG17 permission, workload or production verification. Current CI
results are attached to the exact head of
[PR #3808](https://github.com/twoimo/tzudong/pull/3808).

This change does not regenerate the separate committed PG17 application
baseline. Its drift gate compares table/view/sequence names and role counts,
not index definitions; it is not evidence that every restored local index
matches the newly optimized hosted schema.

## Read-only verification

The following query can reproduce the scoped catalog readback on the intended
authenticated project. The observed poststate is `remaining_removal_names = 0`,
`retained_valid_ready_indexes = 6`, `retained_unique_constraints = 2`, and
`old_short_url_constraint_absent = true`. The full index definitions provide a
metadata-only readback; they contain no application rows or credentials.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH removed(name) AS (
  VALUES ('profiles_user_id_idx'), ('restaurant_submission_items_submission_idx'),
         ('idx_short_urls_code'), ('short_urls_code_idx'),
         ('idx_bge_embeddings_video_id'), ('user_bookmarks_restaurant_idx'),
         ('user_roles_user_id_role_idx'), ('short_urls_code_key')
), retained(name) AS (
  VALUES ('idx_profiles_user_id'), ('idx_submission_items_submission_id'),
         ('short_urls_code_unique'), ('idx_transcript_embeddings_bge_video_id'),
         ('idx_user_bookmarks_restaurant_id'), ('user_roles_user_id_role_key')
)
SELECT
  (SELECT count(*) FROM removed
   WHERE to_regclass(format('public.%I', name)) IS NOT NULL) AS remaining_removal_names,
  (SELECT count(*) FROM retained r JOIN pg_index i
   ON i.indexrelid = to_regclass(format('public.%I', r.name))
   WHERE i.indisvalid AND i.indisready AND i.indislive) AS retained_valid_ready_indexes,
  (SELECT count(*) FROM pg_constraint c
   WHERE c.contype = 'u' AND c.convalidated AND NOT c.condeferrable
     AND ((c.conrelid = 'public.short_urls'::regclass AND c.conname = 'short_urls_code_unique')
       OR (c.conrelid = 'public.user_roles'::regclass AND c.conname = 'user_roles_user_id_role_key'))
  ) AS retained_unique_constraints,
  NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.short_urls'::regclass AND conname = 'short_urls_code_key'
  ) AS old_short_url_constraint_absent,
  (SELECT jsonb_agg(jsonb_build_object('name', name,
       'definition', pg_get_indexdef(to_regclass(format('public.%I', name)))) ORDER BY name)
   FROM retained) AS retained_definitions;
COMMIT;
```

The final hosted section records the completed index, baseline-policy, owner,
advisor and public-health checks. A full ACL audit and whole-manifest aggregate
fingerprint equality were not established by these checks. Local PostgreSQL
tests are separate evidence and do not establish hosted results or a measured
latency improvement.

## Rollback

Before commit, ordinary transaction rollback restores the removed objects. A
failed migration must not be followed by migration-ledger repair.

After a successful commit, a separately reviewed **forward migration** can
recreate the redundant objects with the SQL below. Verify that the completed
poststate above still holds first. Keep the successful original migration ledger
entry. These statements intentionally omit `IF NOT EXISTS`: unexpected partial
state aborts rather than accepting a conflicting definition. Rebuilt indexes
have new OIDs and statistics; this is structural restoration, not restoration of
their old physical pages or measured sizes.

```sql
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = pg_catalog;
LOCK TABLE public.profiles, public.restaurant_submission_items,
  public.short_urls, public.transcript_embeddings_bge,
  public.user_bookmarks, public.user_roles IN ACCESS EXCLUSIVE MODE;
CREATE INDEX profiles_user_id_idx ON public.profiles USING btree (user_id pg_catalog.uuid_ops);
CREATE INDEX restaurant_submission_items_submission_idx
  ON public.restaurant_submission_items USING btree (submission_id pg_catalog.uuid_ops);
CREATE INDEX idx_short_urls_code
  ON public.short_urls USING btree (code COLLATE pg_catalog."default" pg_catalog.text_ops);
CREATE INDEX short_urls_code_idx
  ON public.short_urls USING btree (code COLLATE pg_catalog."default" pg_catalog.text_ops);
CREATE INDEX idx_bge_embeddings_video_id
  ON public.transcript_embeddings_bge USING btree (video_id COLLATE pg_catalog."default" pg_catalog.text_ops);
CREATE INDEX user_bookmarks_restaurant_idx
  ON public.user_bookmarks USING btree (restaurant_id pg_catalog.uuid_ops);
CREATE UNIQUE INDEX user_roles_user_id_role_idx
  ON public.user_roles USING btree (user_id pg_catalog.uuid_ops, role pg_catalog.enum_ops);
ALTER TABLE public.short_urls ADD CONSTRAINT short_urls_code_key UNIQUE (code);
COMMIT;
```

The rollback statements are a recovery plan and have not been executed on the
hosted project by this source change.
