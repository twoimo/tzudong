-- Real RPC behavior against synthetic data only. Run by the owned Docker fixture.
-- No hosted endpoint, request body, provider payload or credential is retained.
BEGIN;
SET LOCAL statement_timeout = '15s';
CREATE TEMP TABLE home_kpi_cases (name text PRIMARY KEY);
CREATE FUNCTION pg_temp.home_kpi_assert(ok boolean, name text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'HOME_KPI_FIXTURE_%', name; END IF;
END $$;
CREATE FUNCTION pg_temp.home_kpi_envelope(value jsonb, status text, bucket_attempted boolean, rows_attempted boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE bucket_ms numeric; rows_ms numeric; total_ms numeric;
BEGIN
  PERFORM pg_temp.home_kpi_assert(
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(value) k)
      = ARRAY['rows','schemaVersion','status','timingValid','timings']::text[]
    AND value->'schemaVersion' = '1'::jsonb AND value->>'status' = status
    AND jsonb_typeof(value->'rows') = 'array' AND value->'timingValid' = 'true'::jsonb,
    'ENVELOPE');
  PERFORM pg_temp.home_kpi_assert(
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(value->'timings') k)
      = ARRAY['bucketMs','rowsMs','totalMs']::text[], 'TIMING_KEYS');
  bucket_ms := (value#>>'{timings,bucketMs}')::numeric;
  rows_ms := (value#>>'{timings,rowsMs}')::numeric;
  total_ms := (value#>>'{timings,totalMs}')::numeric;
  PERFORM pg_temp.home_kpi_assert(
    (bucket_ms IS NOT NULL) = bucket_attempted AND (rows_ms IS NOT NULL) = rows_attempted
    AND total_ms BETWEEN 0 AND 9007199254740991
    AND COALESCE(bucket_ms,0) >= 0 AND COALESCE(rows_ms,0) >= 0
    AND total_ms >= COALESCE(bucket_ms,0) + COALESCE(rows_ms,0), 'TIMING_CONSISTENCY');
END $$;

DO $test$
DECLARE value jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(NULL);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_envelope(value, 'ok', false, false);
  PERFORM pg_temp.home_kpi_assert(value->'rows' = '[]'::jsonb, 'NULL_INPUT');
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY[]::text[]);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_envelope(value, 'ok', false, false);
  PERFORM pg_temp.home_kpi_assert(value->'rows' = '[]'::jsonb, 'EMPTY_INPUT');
  INSERT INTO home_kpi_cases VALUES ('null_and_empty_input');

  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY['video_A']);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_envelope(value, 'ok', true, false);
  PERFORM pg_temp.home_kpi_assert(value->'rows' = '[]'::jsonb, 'EMPTY_TABLE');
  INSERT INTO home_kpi_cases VALUES ('empty_table_skips_rows');
END
$test$;

INSERT INTO public.youtube_video_kpi_snapshots
  (video_id,channel_id,title,bucket_started_at,published_at,duration_seconds,view_count,like_count,comment_count,fetched_at)
VALUES
  ('old_only','fixture','Old only','2026-01-01T00:00:00Z','2025-12-01T00:00:00Z',30,10,2,0,'2026-01-01T00:00:01Z'),
  ('video_A','fixture','Old A','2026-01-01T00:00:00Z','2025-12-01T00:00:00Z',30,20,3,1,'2026-01-01T00:00:01Z'),
  ('unrelated_new','fixture','Unrelated latest','2026-01-01T00:15:00Z',NULL,0,0,0,0,'2026-01-01T00:15:01Z');

DO $test$
DECLARE value jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY['old_only','video_A','missing']);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_envelope(value, 'ok', true, true);
  PERFORM pg_temp.home_kpi_assert(value->'rows' = '[]'::jsonb, 'GLOBAL_LATEST_NO_FALLBACK');
  INSERT INTO home_kpi_cases VALUES ('global_latest_no_older_row_fallback');
END
$test$;

INSERT INTO public.youtube_video_kpi_snapshots
  (video_id,channel_id,title,bucket_started_at,published_at,category_id,duration_seconds,view_count,like_count,comment_count,fetched_at)
VALUES
  ('video_A','fixture','Current A','2026-01-01T00:15:00Z','2025-12-02T00:00:00Z','24',93,1234,12,3,'2026-01-01T00:15:02Z'),
  ('video_B','fixture','Current B','2026-01-01T00:15:00Z',NULL,NULL,0,0,0,0,'2026-01-01T00:15:03Z');

DO $test$
DECLARE value jsonb; row_value jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY['video_B','missing','video_A','video_B','old_only']);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_envelope(value, 'ok', true, true);
  PERFORM pg_temp.home_kpi_assert(
    (SELECT jsonb_agg(row->'video_id') FROM jsonb_array_elements(value->'rows') row)
      = '["video_B","video_A"]'::jsonb, 'ORDER_DEDUPE_MISSING');
  row_value := value#>'{rows,1}';
  PERFORM pg_temp.home_kpi_assert(
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row_value) k)
      = ARRAY['bucket_started_at','category_id','comment_count','duration_seconds','fetched_at','like_count','published_at','title','video_id','view_count']::text[]
    AND row_value->>'title' = 'Current A' AND row_value->'view_count' = '1234'::jsonb
    AND row_value->'duration_seconds' = '93'::jsonb
    AND (row_value->>'bucket_started_at')::timestamptz = '2026-01-01T00:15:00Z'::timestamptz
    AND value#>'{rows,0,published_at}' = 'null'::jsonb, 'ROW_FIELDS');
  INSERT INTO home_kpi_cases VALUES ('order_dedupe_missing_and_exact_fields');
END
$test$;

UPDATE public.youtube_video_kpi_snapshots SET title = 'Corrected A', view_count = 240
WHERE video_id = 'video_A' AND bucket_started_at = '2026-01-01T00:15:00Z';
DO $test$
DECLARE value jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY['video_A']);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_assert(value#>>'{rows,0,title}' = 'Corrected A'
    AND value#>'{rows,0,view_count}' = '240'::jsonb, 'SAME_BUCKET_UPDATE');
  INSERT INTO home_kpi_cases VALUES ('same_bucket_update_has_no_result_cache');
END
$test$;

INSERT INTO public.youtube_video_kpi_snapshots
  (video_id,channel_id,title,bucket_started_at)
SELECT 'bulk_' || n, 'fixture', 'Synthetic bulk', '2026-01-01T00:15:00Z'::timestamptz
FROM generate_series(1,245) n;
DO $test$
DECLARE value jsonb; ids text[];
BEGIN
  SELECT array_agg('bulk_' || n ORDER BY n DESC) INTO ids FROM generate_series(1,245) n;
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ids);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_assert(jsonb_array_length(value->'rows') = 245
    AND value#>>'{rows,0,video_id}' = 'bulk_245' AND value#>>'{rows,244,video_id}' = 'bulk_1', 'LARGE_HELPER_INPUT');
  INSERT INTO home_kpi_cases VALUES ('helper_inputs_above_120_and_200');
END
$test$;

DO $test$
DECLARE role_name text; denied boolean;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','postgres'] LOOP
    denied := false;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', role_name);
      PERFORM public.get_home_youtube_kpi_metrics(ARRAY['video_A']);
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.home_kpi_assert(denied, 'NON_SERVICE_DENIED');
  END LOOP;
  PERFORM pg_temp.home_kpi_assert(
    NOT has_function_privilege('anon','public.get_home_youtube_kpi_metrics(text[])','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.get_home_youtube_kpi_metrics(text[])','EXECUTE')
    AND has_function_privilege('service_role','public.get_home_youtube_kpi_metrics(text[])','EXECUTE'), 'RPC_ACL');
  INSERT INTO home_kpi_cases VALUES ('anon_authenticated_and_owner_call_denied');
END
$test$;

-- Real permission failures reach each SELECT without a product fault hook.
REVOKE SELECT ON public.youtube_video_kpi_snapshots FROM service_role;
GRANT SELECT(bucket_started_at) ON public.youtube_video_kpi_snapshots TO service_role;
DO $test$
DECLARE value jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY['video_A']);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_envelope(value, 'rows_error', true, true);
  PERFORM pg_temp.home_kpi_assert(value->'rows' = '[]'::jsonb, 'ROWS_ERROR_EMPTY');
  INSERT INTO home_kpi_cases VALUES ('real_rows_permission_error_is_bounded');
END
$test$;
REVOKE SELECT(bucket_started_at) ON public.youtube_video_kpi_snapshots FROM service_role;
DO $test$
DECLARE value jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY['video_A']);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.home_kpi_envelope(value, 'bucket_error', true, false);
  PERFORM pg_temp.home_kpi_assert(value->'rows' = '[]'::jsonb, 'BUCKET_ERROR_EMPTY');
  INSERT INTO home_kpi_cases VALUES ('real_bucket_permission_error_is_bounded');
END
$test$;
GRANT SELECT ON public.youtube_video_kpi_snapshots TO service_role;

DO $test$
DECLARE before_rows jsonb; after_rows jsonb; value jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(r) ORDER BY id) INTO before_rows FROM public.youtube_video_kpi_snapshots r;
  EXECUTE 'SET LOCAL ROLE service_role';
  value := public.get_home_youtube_kpi_metrics(ARRAY['video_A']);
  EXECUTE 'RESET ROLE';
  SELECT jsonb_agg(to_jsonb(r) ORDER BY id) INTO after_rows FROM public.youtube_video_kpi_snapshots r;
  PERFORM pg_temp.home_kpi_assert(value->>'status' = 'ok' AND before_rows = after_rows, 'RPC_READ_ONLY');
  PERFORM pg_temp.home_kpi_assert(
    (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class
      WHERE oid = 'public.youtube_video_kpi_snapshots'::regclass)
    AND NOT has_table_privilege('anon','public.youtube_video_kpi_snapshots','SELECT')
    AND NOT has_table_privilege('authenticated','public.youtube_video_kpi_snapshots','SELECT'), 'TABLE_BOUNDARY');
  INSERT INTO home_kpi_cases VALUES ('no_row_mutations_or_table_boundary_change');
END
$test$;

SELECT jsonb_build_object('cases', (SELECT jsonb_agg(name ORDER BY name) FROM home_kpi_cases), 'count', (SELECT count(*) FROM home_kpi_cases));
ROLLBACK;
