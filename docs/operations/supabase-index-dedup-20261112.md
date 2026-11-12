# Supabase duplicate index removal — 2026-11-12

This change removes eight redundant physical indexes from six public tables.
The inspected hosted target is `aqlcofblfxdrjhhdmarw`; the SQL still requires the
operator to select that authenticated project. Database name and role checks do
not authenticate a Supabase project ref.

The migration is
[`20261112105200_deduplicate_equivalent_public_indexes.sql`](../../backend/supabase/migrations/20261112105200_deduplicate_equivalent_public_indexes.sql),
created with Supabase CLI 3.1.0. This document describes the implementation and
verification procedure; it is not a receipt that hosted execution has occurred.

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

## Local verification

An independent disposable PostgreSQL 17.6 fixture passed all five cases on
2026-11-12 using migration SHA-256
`600a236aa10eba6b3c5ab96932fb575867a12cf84bfc9ff03974746339fe59e1`.

| Case | Observed result |
| --- | --- |
| Apply once | Target index family reduced from 14 to 6; all eight intended objects removed; six keepers and six separate primary-key indexes retained with unchanged metadata/OIDs; rows and lookup results unchanged; both surviving UNIQUE constraints reject duplicates |
| Repeat | No-op with identical catalog and rows |
| Rollback | The test copy's final COMMIT was replaced with ROLLBACK; original catalog and rows restored |
| Keeper drift | A descending keeper fails with `public_index_dedup_index_drift` before any DROP attempt |
| FK dependency | A real FK depending on the old short URL index fails with `public_index_dedup_dependency_denied` before any DROP attempt |

The fixture used PostgreSQL single-user mode and synthetic rows. It verifies DDL,
catalog state, row results and constraints. It does not prove hosted application
behavior, RLS behavior, concurrent workload behavior or latency improvement.

## Read-only verification

Run the following on the intended authenticated project after transaction
completion. Expected counts are `remaining_removal_names = 0`,
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

Separately compare the pre/post metadata for the three `notifications` indexes,
G014 manifest, RLS policies and table grants. Re-run the relevant Supabase
performance advisor and check the live application. Local PostgreSQL tests do
not establish those hosted results or a measured latency improvement.

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
