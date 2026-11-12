-- Remove eight redundant physical indexes without changing row access or data.
-- Generated with Supabase CLI 3.1.0. See docs/operations/supabase-index-dedup-20261112.md.
-- Keep the G014-protected notifications indexes and its manifest unchanged.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = pg_catalog;

DO $public_index_dedup$
DECLARE
  target record;
  subject record;
  metadata record;
  constraint_metadata record;
  retained record;
  removal record;
  table_oid oid;
  index_oid oid;
  constraint_oid oid;
  column_numbers smallint[];
  operator_classes oid[];
  collations oid[];
  ascending_options smallint[];
  expected_unique boolean;
  expected_constraint text;
  observed jsonb;
  retained_indexes jsonb := '{}'::jsonb;
  removals jsonb := '[]'::jsonb;
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::integer / 10000 <> 17
     OR current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'public_index_dedup_executor_denied';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tzudong:public-index-dedup:20261112', 0));
  -- Acquire every table lock before inspecting any candidate. A busy table fails
  -- within one second; no earlier candidate has been removed at that point.
  LOCK TABLE public.profiles, public.restaurant_submission_items,
    public.short_urls, public.transcript_embeddings_bge,
    public.user_bookmarks, public.user_roles IN ACCESS EXCLUSIVE MODE;

  FOR target IN
    SELECT * FROM (VALUES
      ('profiles', 'profiles_user_id_idx', 'idx_profiles_user_id',
       ARRAY['user_id'], ARRAY['uuid_ops'], ARRAY['none'], false, false, NULL::text, NULL::text),
      ('restaurant_submission_items', 'restaurant_submission_items_submission_idx', 'idx_submission_items_submission_id',
       ARRAY['submission_id'], ARRAY['uuid_ops'], ARRAY['none'], false, false, NULL, NULL),
      ('short_urls', 'idx_short_urls_code', 'short_urls_code_unique',
       ARRAY['code'], ARRAY['text_ops'], ARRAY['default'], false, true, NULL, 'short_urls_code_unique'),
      ('short_urls', 'short_urls_code_idx', 'short_urls_code_unique',
       ARRAY['code'], ARRAY['text_ops'], ARRAY['default'], false, true, NULL, 'short_urls_code_unique'),
      ('transcript_embeddings_bge', 'idx_bge_embeddings_video_id', 'idx_transcript_embeddings_bge_video_id',
       ARRAY['video_id'], ARRAY['text_ops'], ARRAY['default'], false, false, NULL, NULL),
      ('user_bookmarks', 'user_bookmarks_restaurant_idx', 'idx_user_bookmarks_restaurant_id',
       ARRAY['restaurant_id'], ARRAY['uuid_ops'], ARRAY['none'], false, false, NULL, NULL),
      ('user_roles', 'user_roles_user_id_role_idx', 'user_roles_user_id_role_key',
       ARRAY['user_id', 'role'], ARRAY['uuid_ops', 'enum_ops'], ARRAY['none', 'none'], true, true, NULL, 'user_roles_user_id_role_key'),
      ('short_urls', 'short_urls_code_key', 'short_urls_code_unique',
       ARRAY['code'], ARRAY['text_ops'], ARRAY['default'], true, true, 'short_urls_code_key', 'short_urls_code_unique')
    ) AS plan(table_name, remove_name, retain_name, columns, opclasses,
              collation_names, remove_unique, retain_unique,
              remove_constraint, retain_constraint)
  LOOP
    table_oid := to_regclass(format('public.%I', target.table_name));
    IF table_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = table_oid AND n.nspname = 'public'
        AND c.relkind = 'r' AND c.relpersistence = 'p' AND NOT c.relispartition
    ) THEN
      RAISE EXCEPTION 'public_index_dedup_table_denied';
    END IF;

    SELECT array_agg(a.attnum ORDER BY k.position)
      INTO column_numbers
      FROM unnest(target.columns) WITH ORDINALITY AS k(column_name, position)
      JOIN pg_attribute a ON a.attrelid = table_oid AND a.attname = k.column_name
        AND a.attnum > 0 AND NOT a.attisdropped;
    SELECT array_agg(o.oid ORDER BY k.position)
      INTO operator_classes
      FROM unnest(target.opclasses) WITH ORDINALITY AS k(opclass_name, position)
      JOIN pg_opclass o ON o.opcname = k.opclass_name
      JOIN pg_namespace n ON n.oid = o.opcnamespace AND n.nspname = 'pg_catalog'
      JOIN pg_am am ON am.oid = o.opcmethod AND am.amname = 'btree';
    SELECT array_agg(CASE WHEN k.collation_name = 'none' THEN 0::oid ELSE c.oid END ORDER BY k.position)
      INTO collations
      FROM unnest(target.collation_names) WITH ORDINALITY AS k(collation_name, position)
      LEFT JOIN pg_collation c ON c.collname = k.collation_name
        AND c.collnamespace = 'pg_catalog'::regnamespace;
    ascending_options := array_fill(0::smallint, ARRAY[cardinality(target.columns)]);
    IF cardinality(column_numbers) IS DISTINCT FROM cardinality(target.columns)
       OR cardinality(operator_classes) IS DISTINCT FROM cardinality(target.columns)
       OR cardinality(collations) IS DISTINCT FROM cardinality(target.columns)
       OR array_position(collations, NULL::oid) IS NOT NULL THEN
      RAISE EXCEPTION 'public_index_dedup_column_denied';
    END IF;

    -- The keeper is always required, including an idempotent repeat after all
    -- eight removals. No missing or drifted keeper is repaired implicitly.
    FOR subject IN
      SELECT target.retain_name AS index_name, true AS is_keeper
      UNION ALL SELECT target.remove_name, false
    LOOP
      expected_unique := CASE WHEN subject.is_keeper THEN target.retain_unique ELSE target.remove_unique END;
      expected_constraint := CASE WHEN subject.is_keeper THEN target.retain_constraint ELSE target.remove_constraint END;
      index_oid := to_regclass(format('public.%I', subject.index_name));
      IF index_oid IS NULL THEN
        IF subject.is_keeper THEN
          RAISE EXCEPTION 'public_index_dedup_keeper_missing';
        END IF;
        IF expected_constraint IS NOT NULL AND EXISTS (
          SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = table_oid AND c.conname = expected_constraint
        ) THEN
          RAISE EXCEPTION 'public_index_dedup_constraint_drift';
        END IF;
        CONTINUE;
      END IF;

      SELECT i.*, c.relname AS index_name, c.relkind AS index_kind,
             c.relpersistence AS index_persistence, c.relispartition AS index_partition,
             c.relowner AS index_owner, c.reloptions AS index_options,
             n.nspname AS index_schema, am.amname AS access_method,
             t.relowner AS table_owner
        INTO metadata
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_am am ON am.oid = c.relam
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE i.indexrelid = index_oid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'public_index_dedup_index_drift';
      END IF;
      IF metadata.indrelid <> table_oid
         OR metadata.index_schema <> 'public' OR metadata.index_name <> subject.index_name
         OR metadata.index_kind <> 'i' OR metadata.index_persistence <> 'p'
         OR metadata.index_partition OR metadata.access_method <> 'btree'
         OR metadata.index_owner <> metadata.table_owner OR metadata.index_options IS NOT NULL
         OR metadata.indnatts <> cardinality(target.columns)
         OR metadata.indnkeyatts <> cardinality(target.columns)
         OR metadata.indkey::text <> array_to_string(column_numbers, ' ')
         OR metadata.indclass::text <> array_to_string(operator_classes, ' ')
         OR metadata.indcollation::text <> array_to_string(collations, ' ')
         OR metadata.indoption::text <> array_to_string(ascending_options, ' ')
         OR metadata.indexprs IS NOT NULL OR metadata.indpred IS NOT NULL
         OR metadata.indisunique IS DISTINCT FROM expected_unique
         OR metadata.indnullsnotdistinct OR metadata.indisprimary OR metadata.indisexclusion
         OR metadata.indisclustered OR metadata.indisreplident
         OR NOT metadata.indisvalid OR NOT metadata.indisready OR NOT metadata.indislive
         OR NOT metadata.indimmediate
         OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = index_oid OR inhparent = index_oid) THEN
        RAISE EXCEPTION 'public_index_dedup_index_drift';
      END IF;

      constraint_oid := NULL;
      observed := jsonb_build_object('index', to_jsonb(metadata), 'constraint', NULL);
      IF expected_constraint IS NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = index_oid) THEN
          RAISE EXCEPTION 'public_index_dedup_constraint_drift';
        END IF;
      ELSE
        SELECT c.* INTO constraint_metadata FROM pg_constraint c
          WHERE c.conrelid = table_oid AND c.conname = expected_constraint;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'public_index_dedup_constraint_drift';
        END IF;
        IF constraint_metadata.contype <> 'u' OR constraint_metadata.conindid <> index_oid
           OR constraint_metadata.conkey IS DISTINCT FROM column_numbers
           OR constraint_metadata.condeferrable OR constraint_metadata.condeferred
           OR NOT constraint_metadata.convalidated OR NOT constraint_metadata.conislocal
           OR constraint_metadata.coninhcount <> 0 OR constraint_metadata.conparentid <> 0 THEN
          RAISE EXCEPTION 'public_index_dedup_constraint_drift';
        END IF;
        constraint_oid := constraint_metadata.oid;
        observed := jsonb_build_object('index', to_jsonb(metadata), 'constraint', to_jsonb(constraint_metadata));
      END IF;

      IF subject.is_keeper THEN
        retained_indexes := retained_indexes || jsonb_build_object(subject.index_name, observed);
        CONTINUE;
      END IF;

      -- Reject every incoming dependency, including a foreign key using the
      -- candidate unique index. The constraint-owned index's sole internal
      -- dependency is checked in the opposite direction below.
      IF EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.contype = 'f' AND c.conindid = index_oid
      ) OR EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = index_oid
      ) OR EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = index_oid
          AND d.deptype IN ('i', 'e', 'P', 'S')
          AND NOT (constraint_oid IS NOT NULL AND d.refclassid = 'pg_constraint'::regclass
                   AND d.refobjid = constraint_oid AND d.objsubid = 0
                   AND d.refobjsubid = 0 AND d.deptype = 'i')
      ) THEN
        RAISE EXCEPTION 'public_index_dedup_dependency_denied';
      END IF;
      IF constraint_oid IS NOT NULL AND (
        (SELECT count(*) FROM pg_depend d
         WHERE d.classid = 'pg_class'::regclass AND d.objid = index_oid
           AND d.refclassid = 'pg_constraint'::regclass AND d.refobjid = constraint_oid
           AND d.objsubid = 0 AND d.refobjsubid = 0 AND d.deptype = 'i') <> 1
        OR EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.refclassid = 'pg_constraint'::regclass AND d.refobjid = constraint_oid
            AND NOT (d.classid = 'pg_class'::regclass AND d.objid = index_oid
                     AND d.objsubid = 0 AND d.refobjsubid = 0 AND d.deptype = 'i')
        )
      ) THEN
        RAISE EXCEPTION 'public_index_dedup_dependency_denied';
      END IF;
      removals := removals || jsonb_build_array(jsonb_build_object(
        'table_name', target.table_name, 'index_name', subject.index_name,
        'constraint_name', expected_constraint
      ));
    END LOOP;
  END LOOP;

  -- All preconditions for every present candidate have now passed while every
  -- affected table is locked. Ordinary DROP is transactional; never use CASCADE.
  FOR removal IN SELECT * FROM jsonb_to_recordset(removals)
    AS r(table_name text, index_name text, constraint_name text)
  LOOP
    IF removal.constraint_name IS NULL THEN
      EXECUTE format('DROP INDEX public.%I RESTRICT', removal.index_name);
    ELSE
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I RESTRICT',
                     removal.table_name, removal.constraint_name);
    END IF;
  END LOOP;

  FOR retained IN SELECT key, value FROM jsonb_each(retained_indexes)
  LOOP
    SELECT i.*, c.relname AS index_name, c.relkind AS index_kind,
           c.relpersistence AS index_persistence, c.relispartition AS index_partition,
           c.relowner AS index_owner, c.reloptions AS index_options,
           n.nspname AS index_schema, am.amname AS access_method,
           t.relowner AS table_owner
      INTO metadata
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_am am ON am.oid = c.relam
      JOIN pg_class t ON t.oid = i.indrelid
      WHERE i.indexrelid = to_regclass(format('public.%I', retained.key));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'public_index_dedup_readback_failed';
    END IF;
    observed := jsonb_build_object('index', to_jsonb(metadata), 'constraint', NULL);
    IF retained.value->'constraint' <> 'null'::jsonb THEN
      SELECT c.* INTO constraint_metadata FROM pg_constraint c
        WHERE c.oid = (retained.value->'constraint'->>'oid')::oid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'public_index_dedup_readback_failed';
      END IF;
      observed := jsonb_build_object('index', to_jsonb(metadata), 'constraint', to_jsonb(constraint_metadata));
    END IF;
    IF observed IS DISTINCT FROM retained.value THEN
      RAISE EXCEPTION 'public_index_dedup_readback_failed';
    END IF;
  END LOOP;
  FOR removal IN SELECT * FROM jsonb_to_recordset(removals)
    AS r(table_name text, index_name text, constraint_name text)
  LOOP
    IF to_regclass(format('public.%I', removal.index_name)) IS NOT NULL
       OR (removal.constraint_name IS NOT NULL AND EXISTS (
         SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = to_regclass(format('public.%I', removal.table_name))
           AND c.conname = removal.constraint_name
       )) THEN
      RAISE EXCEPTION 'public_index_dedup_readback_failed';
    END IF;
  END LOOP;
END;
$public_index_dedup$;
COMMIT;
