-- Forward-only successor for an already applied durable OCR migration.
-- The earlier migrations remain immutable. This replacement tightens only the
-- private runtime capability predicate so drift in either Storage metadata
-- fence returns FEATURE_DATABASE_HELD before any admin mutation is admitted.
BEGIN;
SET LOCAL lock_timeout = '2s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:feature-runtime-storage-fence:v1', 0)
);

DO $prerequisites$
DECLARE
  capability_oid oid := pg_catalog.to_regprocedure(
    'ocr_private.get_feature_runtime_capability(uuid)'
  );
BEGIN
  IF current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR capability_oid IS NULL
    OR pg_catalog.to_regprocedure(
      'public.get_feature_runtime_capability(uuid)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'FEATURE_RUNTIME_STORAGE_FENCE_PREREQUISITE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = capability_oid
      AND function_row.proowner = 'postgres'::pg_catalog.regrole
      AND function_row.prosecdef
      AND function_row.proconfig = ARRAY['search_path=""']::text[]
      AND function_row.prokind = 'f'
      AND function_row.provolatile = 's'
      AND NOT function_row.proretset
      AND function_row.prorettype = 'jsonb'::pg_catalog.regtype
      AND function_row.prolang = (
        SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql'
      )
  ) THEN
    RAISE EXCEPTION 'FEATURE_RUNTIME_STORAGE_FENCE_CAPABILITY_DRIFT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS function_row
      ON function_row.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'storage.objects'::pg_catalog.regclass
      AND trigger_row.tgname = 'a01_review_verification_immutable_update'
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgtype = 19
      AND function_row.oid =
        'review_media_private.reject_verification_object_update()'::pg_catalog.regprocedure
      AND pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(function_row.prosrc, 'UTF8')),
        'hex'
      ) = 'aa1d4951b8d5fdd15249b090c6d6efba897f39eaceee86bf09221eb1d942d545'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS function_row
      ON function_row.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'storage.objects'::pg_catalog.regclass
      AND trigger_row.tgname = 'a01_review_verification_guard_delete'
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgtype = 11
      AND function_row.oid =
        'review_media_private.guard_verification_object_delete()'::pg_catalog.regprocedure
      AND pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(function_row.prosrc, 'UTF8')),
        'hex'
      ) = '24311fc7071597fbc78c4c54897690da5aaa70edb62c24f7912fd23fecf515b0'
  ) THEN
    RAISE EXCEPTION 'FEATURE_RUNTIME_STORAGE_FENCE_SOURCE_DRIFT';
  END IF;
END;
$prerequisites$;

CREATE OR REPLACE FUNCTION ocr_private.get_feature_runtime_capability(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ready boolean;
  v_contracts_ready boolean;
  v_review_ocr_columns_ready boolean;
  v_review_ocr_indexes_ready boolean;
  v_trigger_helper_oid oid := pg_catalog.to_regprocedure(
    'ocr_private.register_review_ocr_generation()'
  );
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users AS user_row WHERE user_row.id = p_user_id
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'held',
      'code', 'FEATURE_DATABASE_HELD',
      'capability_version', 'review-media-feature-v1'
    );
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.mark_receipt_ocr_dispatched(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.complete_receipt_ocr_result(uuid,uuid,jsonb)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.mark_receipt_ocr_result_indeterminate(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.release_receipt_ocr_claim(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text)', 'jsonb'::pg_catalog.regtype, false, 's'::"char"),
        ('public.get_review_receipt_ocr_generation(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 's'::"char"),
        ('public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.get_feature_runtime_capability(uuid)', 'jsonb'::pg_catalog.regtype, false, 's'::"char"),
        ('public.get_owned_review_storage_objects(uuid,uuid,text,text[])', 'record'::pg_catalog.regtype, true, 'v'::"char"),
        ('public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb)', 'uuid'::pg_catalog.regtype, false, 'v'::"char")
    ) AS required(signature, return_type, returns_set, volatility)
    LEFT JOIN pg_catalog.pg_proc AS procedure_row
      ON procedure_row.oid = pg_catalog.to_regprocedure(required.signature)
    WHERE procedure_row.oid IS NULL
      OR procedure_row.proowner <> 'privacy_workflow_owner'::pg_catalog.regrole
      OR NOT procedure_row.prosecdef
      OR procedure_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR procedure_row.prokind <> 'f'
      OR procedure_row.provolatile <> required.volatility
      OR procedure_row.prorettype <> required.return_type
      OR procedure_row.proretset IS DISTINCT FROM required.returns_set
      OR procedure_row.prolang <> (
        SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'sql'
      )
      OR NOT pg_catalog.has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
  ) INTO v_contracts_ready;

  -- Keep the runtime decision tied to the same exact review-column contract
  -- that the migration and successor controller admit. A later same-name
  -- column with a different type, default, nullability, identity or generated
  -- shape must put the feature back on hold.
  SELECT pg_catalog.count(*) = 4
    AND pg_catalog.bool_and(
      NOT attribute.attnotnull
      AND attribute.atttypmod = -1
      AND attribute.attidentity = ''
      AND attribute.attgenerated = ''
      AND CASE attribute.attname
        WHEN 'receipt_hash' THEN
          attribute.atttypid = 'text'::pg_catalog.regtype
          AND default_value.oid IS NULL
        WHEN 'receipt_data' THEN
          attribute.atttypid = 'jsonb'::pg_catalog.regtype
          AND default_value.oid IS NULL
        WHEN 'is_duplicate' THEN
          attribute.atttypid = 'boolean'::pg_catalog.regtype
          AND pg_catalog.pg_get_expr(
            default_value.adbin,
            default_value.adrelid
          ) = 'false'
        WHEN 'ocr_processed_at' THEN
          attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
          AND default_value.oid IS NULL
        ELSE false
      END
    )
  INTO v_review_ocr_columns_ready
  FROM pg_catalog.pg_attribute AS attribute
  LEFT JOIN pg_catalog.pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
  WHERE attribute.attrelid = 'public.reviews'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attname = ANY (ARRAY[
      'receipt_hash',
      'receipt_data',
      'is_duplicate',
      'ocr_processed_at'
    ]::name[]);

  -- Index identity is not enough: method, key, predicate and online-validity
  -- flags are all part of the runtime contract.
  SELECT pg_catalog.count(*) = 3
    AND pg_catalog.bool_and(
      index_relation.relkind = 'i'
      AND index_row.indrelid = 'public.reviews'::regclass
      AND access_method.amname = 'btree'
      AND index_row.indnkeyatts = 1
      AND index_row.indnatts = 1
      AND index_row.indexprs IS NULL
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indislive
      AND NOT index_row.indisprimary
      AND NOT index_row.indisexclusion
      AND CASE index_relation.relname
        WHEN 'idx_reviews_receipt_hash' THEN
          index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'receipt_hash'
          AND pg_catalog.pg_get_expr(
            index_row.indpred,
            index_row.indrelid
          ) = '(receipt_hash IS NOT NULL)'
        WHEN 'reviews_ocr_pending_idx' THEN
          NOT index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'ocr_processed_at'
          AND pg_catalog.pg_get_expr(
            index_row.indpred,
            index_row.indrelid
          ) = '(verification_photo IS NOT NULL)'
        WHEN 'reviews_duplicate_idx' THEN
          NOT index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'is_duplicate'
          AND index_row.indpred IS NULL
        ELSE false
      END
    )
  INTO v_review_ocr_indexes_ready
  FROM pg_catalog.pg_class AS index_relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = index_relation.relnamespace
  JOIN pg_catalog.pg_index AS index_row
    ON index_row.indexrelid = index_relation.oid
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = index_relation.relam
  WHERE namespace.nspname = 'public'
    AND index_relation.relname = ANY (ARRAY[
      'idx_reviews_receipt_hash',
      'reviews_ocr_pending_idx',
      'reviews_duplicate_idx'
    ]::name[]);

  SELECT EXISTS (
    SELECT 1
    FROM ocr_private.feature_runtime_capability AS capability
    WHERE capability.capability_version = 'review-media-feature-v1'
      AND capability.schema_version = 1
  )
  AND v_contracts_ready
  AND coalesce(v_review_ocr_columns_ready, false)
  AND coalesce(v_review_ocr_indexes_ready, false)
  AND pg_catalog.to_regprocedure('public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS table_row
    WHERE table_row.oid = 'ocr_private.receipt_results'::pg_catalog.regclass
      AND table_row.relowner = 'postgres'::pg_catalog.regrole
      AND table_row.relrowsecurity
      AND table_row.relforcerowsecurity
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS table_row
    WHERE table_row.oid = 'ocr_private.review_generations'::pg_catalog.regclass
      AND table_row.relowner = 'postgres'::pg_catalog.regrole
      AND table_row.relrowsecurity
      AND table_row.relforcerowsecurity
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS helper
    WHERE helper.oid = v_trigger_helper_oid
      AND helper.proowner = 'postgres'::pg_catalog.regrole
      AND helper.prosecdef
      AND helper.proconfig = ARRAY['search_path=""']::text[]
      AND helper.prorettype = 'trigger'::pg_catalog.regtype
      AND helper.prolang = (
        SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql'
      )
      AND NOT pg_catalog.has_function_privilege('anon', helper.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', helper.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', helper.oid, 'EXECUTE')
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.reviews'::pg_catalog.regclass
      AND trigger_row.tgfoid = v_trigger_helper_oid
      AND trigger_row.tgname IN (
        'review_ocr_generation_on_insert',
        'review_ocr_generation_on_reset'
      )
      AND NOT trigger_row.tgisinternal
    GROUP BY trigger_row.tgfoid
    HAVING pg_catalog.count(*) = 2
  )
  -- The metadata fence is operational only while both installed triggers and
  -- their implementation functions retain the exact audited contract. A
  -- disabled, retargeted, redefined or newly exposed helper holds the feature.
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS function_row
      ON function_row.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'storage.objects'::pg_catalog.regclass
      AND trigger_row.tgname = 'a01_review_verification_immutable_update'
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgtype = 19
      AND pg_catalog.pg_get_triggerdef(trigger_row.oid, false) =
        'CREATE TRIGGER a01_review_verification_immutable_update BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION review_media_private.reject_verification_object_update()'
      AND function_row.oid =
        'review_media_private.reject_verification_object_update()'::pg_catalog.regprocedure
      AND NOT function_row.prosecdef
      AND function_row.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
      AND function_row.proconfig = ARRAY['search_path=""']::text[]
      AND function_row.prokind = 'f'
      AND function_row.provolatile = 'v'
      AND NOT function_row.proretset
      AND function_row.prorettype = 'trigger'::pg_catalog.regtype
      AND function_row.prolang = (
        SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql'
      )
      AND pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(function_row.prosrc, 'UTF8')),
        'hex'
      ) = 'aa1d4951b8d5fdd15249b090c6d6efba897f39eaceee86bf09221eb1d942d545'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(ARRAY[
          'anon',
          'authenticated',
          'service_role',
          'supabase_storage_admin',
          'postgres'
        ]) AS role_name
        WHERE pg_catalog.has_function_privilege(
          role_name,
          function_row.oid,
          'EXECUTE'
        )
      )
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS function_row
      ON function_row.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'storage.objects'::pg_catalog.regclass
      AND trigger_row.tgname = 'a01_review_verification_guard_delete'
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgtype = 11
      AND pg_catalog.pg_get_triggerdef(trigger_row.oid, false) =
        'CREATE TRIGGER a01_review_verification_guard_delete BEFORE DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION review_media_private.guard_verification_object_delete()'
      AND function_row.oid =
        'review_media_private.guard_verification_object_delete()'::pg_catalog.regprocedure
      AND function_row.prosecdef
      AND function_row.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
      AND function_row.proconfig = ARRAY['search_path=""']::text[]
      AND function_row.prokind = 'f'
      AND function_row.provolatile = 'v'
      AND NOT function_row.proretset
      AND function_row.prorettype = 'trigger'::pg_catalog.regtype
      AND function_row.prolang = (
        SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql'
      )
      AND pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(function_row.prosrc, 'UTF8')),
        'hex'
      ) = '24311fc7071597fbc78c4c54897690da5aaa70edb62c24f7912fd23fecf515b0'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(ARRAY[
          'anon',
          'authenticated',
          'service_role',
          'supabase_storage_admin',
          'postgres'
        ]) AS role_name
        WHERE pg_catalog.has_function_privilege(
          role_name,
          function_row.oid,
          'EXECUTE'
        )
      )
  )
  INTO v_ready;

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN v_ready THEN 'ready' ELSE 'held' END,
    'code', CASE WHEN v_ready THEN 'FEATURE_DATABASE_READY' ELSE 'FEATURE_DATABASE_HELD' END,
    'capability_version', 'review-media-feature-v1'
  );
END;
$$;

ALTER FUNCTION ocr_private.get_feature_runtime_capability(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION ocr_private.get_feature_runtime_capability(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ocr_private.get_feature_runtime_capability(uuid)
  TO privacy_workflow_owner;

DO $readback$
DECLARE
  capability_oid oid := pg_catalog.to_regprocedure(
    'ocr_private.get_feature_runtime_capability(uuid)'
  );
  capability_source text;
BEGIN
  SELECT function_row.prosrc
  INTO STRICT capability_source
  FROM pg_catalog.pg_proc AS function_row
  WHERE function_row.oid = capability_oid
    AND function_row.proowner = 'postgres'::pg_catalog.regrole
    AND function_row.prosecdef
    AND function_row.proconfig = ARRAY['search_path=""']::text[]
    AND function_row.prokind = 'f'
    AND function_row.provolatile = 's'
    AND NOT function_row.proretset
    AND function_row.prorettype = 'jsonb'::pg_catalog.regtype
    AND function_row.prolang = (
      SELECT language.oid
      FROM pg_catalog.pg_language AS language
      WHERE language.lanname = 'plpgsql'
    );

  IF pg_catalog.strpos(
      capability_source,
      'a01_review_verification_guard_delete'
    ) = 0
    OR pg_catalog.strpos(
      capability_source,
      '24311fc7071597fbc78c4c54897690da5aaa70edb62c24f7912fd23fecf515b0'
    ) = 0
    OR pg_catalog.strpos(
      capability_source,
      'pg_catalog.pg_get_triggerdef(trigger_row.oid, false)'
    ) = 0
    OR NOT pg_catalog.has_function_privilege(
      'privacy_workflow_owner',
      capability_oid,
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege('anon', capability_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'authenticated',
      capability_oid,
      'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role',
      capability_oid,
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'FEATURE_RUNTIME_STORAGE_FENCE_READBACK_DRIFT';
  END IF;
END;
$readback$;

COMMIT;

