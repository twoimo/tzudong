-- Home KPI enrichment: one server-only request, one chosen global latest bucket.
-- Clock observations make this VOLATILE. At READ COMMITTED its two SELECTs
-- have separate snapshots; this is not a single-snapshot consistency promise.
-- The migration executor owns the outer transaction (including its history
-- record). Do not embed BEGIN/COMMIT here; isolated psql uses --single-transaction.

DO $home_kpi_prerequisites$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR pg_catalog.to_regclass('public.youtube_video_kpi_snapshots') IS NULL
    OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_definer_contract()') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_catalog_contract()') IS NULL
  THEN RAISE EXCEPTION 'HOME_KPI_PREREQUISITE'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_home_youtube_kpi_metrics'
  ) THEN RAISE EXCEPTION 'HOME_KPI_IDENTITY_EXISTS'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.youtube_video_kpi_snapshots', 'SELECT')
    OR pg_catalog.has_table_privilege('anon', 'public.youtube_video_kpi_snapshots', 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.youtube_video_kpi_snapshots', 'SELECT')
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = 'public.youtube_video_kpi_snapshots'::pg_catalog.regclass
        AND relrowsecurity AND NOT relforcerowsecurity
    )
  THEN RAISE EXCEPTION 'HOME_KPI_TABLE_BOUNDARY'; END IF;
END
$home_kpi_prerequisites$;

CREATE FUNCTION public.get_home_youtube_kpi_metrics(p_video_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $home_kpi_function$
DECLARE
  v_started_at timestamptz := pg_catalog.clock_timestamp();
  v_stage_started_at timestamptz;
  v_bucket timestamptz;
  v_status text := 'ok';
  v_rows jsonb := '[]'::jsonb;
  v_bucket_ms numeric;
  v_rows_ms numeric;
  v_total_ms numeric;
  v_timing_valid boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'HOME_KPI_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- JavaScript trim/dedupe is authoritative, including Unicode whitespace.
  -- Do not cap this internal helper at the public route's independent 120 IDs.
  IF COALESCE(pg_catalog.cardinality(p_video_ids), 0) > 0 THEN
    v_stage_started_at := pg_catalog.clock_timestamp();
    BEGIN
      SELECT snapshot.bucket_started_at INTO v_bucket
      FROM public.youtube_video_kpi_snapshots AS snapshot
      ORDER BY snapshot.bucket_started_at DESC
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      -- No SQLSTATE, provider diagnostics or identifiers cross the API.
      -- OTHERS deliberately does not catch query cancellation.
      v_status := 'bucket_error';
    END;
    v_bucket_ms := EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - v_stage_started_at)) * 1000;

    IF v_status = 'ok' AND v_bucket IS NOT NULL THEN
      v_stage_started_at := pg_catalog.clock_timestamp();
      BEGIN
        SELECT COALESCE(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'video_id', snapshot.video_id,
            'title', snapshot.title,
            'published_at', snapshot.published_at,
            'category_id', snapshot.category_id,
            'duration_seconds', snapshot.duration_seconds,
            'view_count', snapshot.view_count,
            'like_count', snapshot.like_count,
            'comment_count', snapshot.comment_count,
            'bucket_started_at', snapshot.bucket_started_at,
            'fetched_at', snapshot.fetched_at
          ) ORDER BY pg_catalog.array_position(p_video_ids, snapshot.video_id)
        ), '[]'::jsonb) INTO v_rows
        FROM public.youtube_video_kpi_snapshots AS snapshot
        WHERE snapshot.bucket_started_at = v_bucket
          AND snapshot.video_id = ANY(p_video_ids);
      EXCEPTION WHEN OTHERS THEN
        v_status := 'rows_error';
        v_rows := '[]'::jsonb;
      END;
      v_rows_ms := EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - v_stage_started_at)) * 1000;
    END IF;
  END IF;

  -- This total ends before final envelope serialization. Wall-clock jumps are
  -- invalid observations, not zero-duration work and not a data failure.
  v_total_ms := EXTRACT(EPOCH FROM (pg_catalog.clock_timestamp() - v_started_at)) * 1000;
  v_timing_valid := v_total_ms BETWEEN 0 AND 9007199254740991
    AND (v_bucket_ms IS NULL OR v_bucket_ms BETWEEN 0 AND 9007199254740991)
    AND (v_rows_ms IS NULL OR v_rows_ms BETWEEN 0 AND 9007199254740991)
    AND v_total_ms >= COALESCE(v_bucket_ms, 0) + COALESCE(v_rows_ms, 0);
  IF NOT v_timing_valid THEN
    v_bucket_ms := NULL;
    v_rows_ms := NULL;
    v_total_ms := NULL;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'status', v_status, 'rows', v_rows,
    'timingValid', v_timing_valid,
    'timings', pg_catalog.jsonb_build_object(
      'bucketMs', v_bucket_ms, 'rowsMs', v_rows_ms, 'totalMs', v_total_ms
    )
  );
END
$home_kpi_function$;

REVOKE ALL ON FUNCTION public.get_home_youtube_kpi_metrics(text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_home_youtube_kpi_metrics(text[]) TO service_role;

-- The registration bridge follows the existing owner-custody migration path.
-- Its temporary membership is removed before invocation, its exact ACL admits
-- only postgres and its owner, and it drops itself before this transaction ends.
-- An error rolls back the function, registry row, source edits and role lease.
DO $home_kpi_registration$
DECLARE
  v_members_before jsonb;
  v_members_after jsonb;
  v_helper oid;
  v_lease text;
  v_major integer := pg_catalog.current_setting('server_version_num')::integer / 10000;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' OR v_major NOT IN (15, 17)
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'privacy_workflow_owner'
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit
    )
  THEN RAISE EXCEPTION 'HOME_KPI_EXECUTOR'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY roleid, member, grantor), '[]'::jsonb)
    INTO v_members_before FROM pg_catalog.pg_auth_members m;
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    IF v_major = 17 THEN
      IF pg_catalog.pg_has_role('postgres', 'privacy_workflow_owner', 'SET')
        OR pg_catalog.pg_has_role('postgres', 'privacy_workflow_owner', 'USAGE')
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members
          WHERE roleid = 'privacy_workflow_owner'::pg_catalog.regrole
            AND member = 'postgres'::pg_catalog.regrole AND grantor = 'postgres'::pg_catalog.regrole
        )
        OR NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members
          WHERE roleid = 'privacy_workflow_owner'::pg_catalog.regrole AND member = 'postgres'::pg_catalog.regrole
            AND admin_option AND NOT inherit_option AND NOT set_option
        )
      THEN RAISE EXCEPTION 'HOME_KPI_MEMBERSHIP'; END IF;
      EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
      v_lease := 'pg17';
    ELSIF NOT pg_catalog.pg_has_role('postgres', 'privacy_workflow_owner', 'MEMBER') THEN
      IF NOT (SELECT rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user)
      THEN RAISE EXCEPTION 'HOME_KPI_MEMBERSHIP'; END IF;
      EXECUTE 'GRANT privacy_workflow_owner TO postgres';
      v_lease := 'pg15';
    END IF;
  END IF;
  IF pg_catalog.to_regprocedure('pg_temp.home_kpi_registration()') IS NOT NULL
  THEN RAISE EXCEPTION 'HOME_KPI_HELPER'; END IF;
  EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
  EXECUTE $home_kpi_bridge_definition$
  CREATE FUNCTION pg_temp.home_kpi_registration() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $home_kpi_bridge_body$
  DECLARE
    v_name text;
    v_target oid;
    v_definition text;
    v_source text;
    v_metadata jsonb;
    v_expected text[];
    v_anchor text;
    v_addition text;
    v_rewritten text;
    v_invoker_addition text := $home_kpi_invoker$    IF v_signature = 'public.get_home_youtube_kpi_metrics(text[])' THEN
      IF v_is_definer OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid
          AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prokind = 'f' AND NOT p.proretset
          AND p.pronargs = 1 AND p.proargnames = ARRAY['p_video_ids']::text[]
          AND p.prorettype = 'jsonb'::pg_catalog.regtype AND NOT p.proisstrict AND NOT p.proleakproof
          AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
          AND p.provolatile = 'v' AND p.proconfig = ARRAY['search_path=""']::text[]
          AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
            WHERE acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole) OR acl.is_grantable
          )
      ) OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist
        WHERE source_signature = v_signature AND grantee = 'service_role') <> 1
        OR EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
          WHERE source_signature = v_signature AND grantee <> 'service_role')
      THEN RAISE EXCEPTION 'G014 home KPI SECURITY INVOKER contract mismatch'; END IF;
      CONTINUE;
    END IF;
$home_kpi_invoker$;
  BEGIN
    IF session_user <> 'postgres' OR current_user <> 'privacy_workflow_owner'
    THEN RAISE EXCEPTION 'HOME_KPI_EXECUTOR'; END IF;
    IF EXISTS (
      SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
      WHERE function_schema = 'public' AND function_name = 'get_home_youtube_kpi_metrics'
    ) THEN RAISE EXCEPTION 'HOME_KPI_ALLOWLIST_DRIFT'; END IF;
    FOREACH v_name IN ARRAY ARRAY['definer', 'catalog'] LOOP
      v_target := pg_catalog.to_regprocedure('privacy_retention.assert_g014_' || v_name || '_contract()');
      SELECT pg_catalog.pg_get_functiondef(p.oid), p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
        INTO v_definition, v_source, v_metadata FROM pg_catalog.pg_proc p
        WHERE p.oid = v_target AND p.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
          AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::text[];
      -- Exact current hosted bodies and the canonical predecessor reconstruction.
      -- All previous source bytes are retained; an unrecognized body fails closed.
      v_expected := CASE WHEN v_name = 'definer' THEN ARRAY[
        'e879e3d3083f969cee5968b4064703bd7cc8227cc78e1950c78b06a8a0e5ddfa',
        '0f952ddc2eed4f592a5809cbb3371a1531c206b4152c34f3dca44f603e0c3e25'
      ] ELSE ARRAY[
        'ef150f03928a8dfaeaa4365558408afe38454786f3965863219ba879b0d3ca05',
        '2321fb4ecf9c7857b400ca2face09875bbd00852c54860b758c636106834069c'
      ] END;
      IF v_definition IS NULL OR NOT (
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')), 'hex') = ANY(v_expected)
      ) THEN RAISE EXCEPTION 'HOME_KPI_SOURCE_DRIFT'; END IF;
      v_anchor := '    IF ' || CASE WHEN v_name = 'definer' THEN 'v_signature' ELSE 'v_expected.source_signature' END
        || E' IN (\n      ''public.match_storyboard_documents_hybrid';
      v_addition := CASE WHEN v_name = 'definer' THEN v_invoker_addition
        ELSE pg_catalog.replace(pg_catalog.replace(v_invoker_addition, 'v_signature', 'v_expected.source_signature'), 'v_oid', 'v_procedure') END;
      IF (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, ''))) <> pg_catalog.length(v_anchor)
        OR pg_catalog.strpos(v_source, v_addition) > 0
      THEN RAISE EXCEPTION 'HOME_KPI_SOURCE_DRIFT'; END IF;
      v_rewritten := pg_catalog.replace(v_source, v_anchor, v_addition || v_anchor);
      IF pg_catalog.replace(v_rewritten, v_addition || v_anchor, v_anchor) IS DISTINCT FROM v_source
      THEN RAISE EXCEPTION 'HOME_KPI_SOURCE_DRIFT'; END IF;
      EXECUTE pg_catalog.replace(v_definition, v_source, v_rewritten);
      IF (SELECT pg_catalog.to_jsonb(p) - 'prosrc' FROM pg_catalog.pg_proc p WHERE p.oid = v_target) IS DISTINCT FROM v_metadata
        OR (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = v_target) IS DISTINCT FROM v_rewritten
      THEN RAISE EXCEPTION 'HOME_KPI_METADATA_DRIFT'; END IF;
    END LOOP;
    INSERT INTO privacy_retention.g014_public_rpc_allowlist
      (function_schema, function_name, identity_arguments, grantee, source_signature)
    SELECT n.nspname, p.proname, p.proargtypes::text, 'service_role', 'public.get_home_youtube_kpi_metrics(text[])'
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = 'public.get_home_youtube_kpi_metrics(text[])'::pg_catalog.regprocedure;
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    DROP FUNCTION pg_temp.home_kpi_registration();
  END
  $home_kpi_bridge_body$;
  $home_kpi_bridge_definition$;
  EXECUTE 'REVOKE ALL ON FUNCTION pg_temp.home_kpi_registration() FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION pg_temp.home_kpi_registration() TO postgres';
  EXECUTE 'RESET ROLE';
  IF v_lease = 'pg17' THEN
    EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres';
  ELSIF v_lease = 'pg15' THEN
    EXECUTE 'REVOKE privacy_workflow_owner FROM postgres';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY roleid, member, grantor), '[]'::jsonb)
    INTO v_members_after FROM pg_catalog.pg_auth_members m;
  IF v_members_after IS DISTINCT FROM v_members_before THEN RAISE EXCEPTION 'HOME_KPI_MEMBERSHIP_DRIFT'; END IF;
  v_helper := pg_catalog.to_regprocedure('pg_temp.home_kpi_registration()');
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_helper
      AND p.proowner = 'privacy_workflow_owner'::pg_catalog.regrole AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[]
      AND (SELECT count(*) FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)))) = 2
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        WHERE acl.grantee NOT IN ('privacy_workflow_owner'::pg_catalog.regrole, 'postgres'::pg_catalog.regrole) OR acl.is_grantable
      )
  ) THEN RAISE EXCEPTION 'HOME_KPI_HELPER'; END IF;
  PERFORM pg_temp.home_kpi_registration();
  IF pg_catalog.to_regprocedure('pg_temp.home_kpi_registration()') IS NOT NULL
  THEN RAISE EXCEPTION 'HOME_KPI_HELPER'; END IF;
END
$home_kpi_registration$;

NOTIFY pgrst, 'reload schema';
