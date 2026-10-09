-- Private, revision-bound read index. No applied migration is changed.
-- Full rows remain in restaurants; projections never become approval authority.
CREATE SCHEMA IF NOT EXISTS pipeline_control;
CREATE TABLE pipeline_control.admin_evaluation_catalog_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1
);
INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);
ALTER TABLE pipeline_control.admin_evaluation_catalog_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.admin_evaluation_catalog_revision FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA pipeline_control TO service_role;
GRANT SELECT ON pipeline_control.admin_evaluation_catalog_revision TO service_role;

CREATE FUNCTION pipeline_control.bump_admin_evaluation_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision = revision + 1;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.bump_admin_evaluation_revision() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER admin_evaluation_revision_after_write
AFTER INSERT OR UPDATE OF id, approved_name, origin_name, naver_name, google_name,
  status, lat, lng, phone, road_address, jibun_address, origin_address, is_missing,
  is_not_selected, geocoding_success, geocoding_false_stage, youtube_link,
  youtube_meta, created_at, updated_by_admin_id, db_error_details, db_error_message,
  reasoning_basis, description_map_url, trace_id_name_source, evaluation_results,
  categories, source_type, tzuyang_review, trace_id, english_address, address_elements,
  created_by, channel_name, recollect_version OR DELETE OR TRUNCATE ON public.restaurants
FOR EACH STATEMENT EXECUTE FUNCTION pipeline_control.bump_admin_evaluation_revision();

CREATE FUNCTION public.admin_evaluation_revision()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT revision::text FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_revision() TO service_role;

CREATE FUNCTION public.admin_evaluation_catalog_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  payload jsonb;
BEGIN
  IF (SELECT count(*) FROM (SELECT 1 FROM public.restaurants LIMIT 50001) counted) > 50000 THEN
    RAISE EXCEPTION 'EVALUATION_CATALOG_CAPACITY_EXCEEDED' USING ERRCODE = '54000';
  END IF;
  WITH projected AS NOT MATERIALIZED (
      SELECT r.id AS row_id, jsonb_build_object(
          'id', r.id,
          'approved_name', r.approved_name,
          'origin_name', r.origin_name,
          'naver_name', r.naver_name,
          'google_name', r.google_name,
          'status', r.status,
          'lat', r.lat,
          'lng', r.lng,
          'phone', r.phone,
          'road_address', r.road_address,
          'jibun_address', r.jibun_address,
          'english_address', r.english_address,
          'address_elements', r.address_elements,
          'origin_address', r.origin_address,
          'is_missing', r.is_missing,
          'is_not_selected', r.is_not_selected,
          'geocoding_success', r.geocoding_success,
          'geocoding_false_stage', r.geocoding_false_stage,
          'youtube_link', r.youtube_link,
          'youtube_meta', r.youtube_meta,
          'created_at', r.created_at,
          'updated_at', r.updated_at,
          'updated_by_admin_id', r.updated_by_admin_id,
          'created_by', r.created_by,
          'db_error_details', r.db_error_details,
          'db_error_message', r.db_error_message,
          'reasoning_basis', r.reasoning_basis,
          'description_map_url', r.description_map_url,
          'trace_id', r.trace_id,
          'trace_id_name_source', r.trace_id_name_source,
          'evaluation_results', r.evaluation_results,
          'categories', r.categories,
          'source_type', r.source_type,
          'tzuyang_review', r.tzuyang_review,
          'channel_name', r.channel_name,
          'recollect_version', r.recollect_version,
          'review_count', r.review_count,
          'name', r.approved_name
      ) AS record
      FROM public.restaurants r
  ), capacity AS (
    SELECT COALESCE(sum(octet_length(record::text) + 2), 0) + 128 AS bytes FROM projected
  )
  SELECT CASE WHEN bytes <= 33554432 THEN jsonb_build_object(
    'revision', (SELECT revision::text FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton),
    'records', COALESCE((SELECT jsonb_agg(record ORDER BY row_id) FROM projected), '[]'::jsonb)
  ) ELSE NULL END INTO payload FROM capacity;
  IF payload IS NULL THEN
    RAISE EXCEPTION 'EVALUATION_CATALOG_CAPACITY_EXCEEDED' USING ERRCODE = '54000';
  END IF;
  RETURN payload;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_catalog_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_catalog_snapshot() TO service_role;

COMMENT ON FUNCTION public.admin_evaluation_catalog_snapshot() IS
  'Service-only revision-bound index input. Rejects over 50000 rows or 32MiB before aggregate; no silent truncation.';

-- Preserve the deployed G014 service-only public RPC catalog contract.
WITH expected(signature) AS (VALUES
  ('public.admin_evaluation_revision()'),
  ('public.admin_evaluation_catalog_snapshot()')
)
INSERT INTO privacy_retention.g014_public_rpc_allowlist
  (function_schema,function_name,identity_arguments,grantee,source_signature)
SELECT n.nspname,p.proname,p.proargtypes::text,'service_role'::name,expected.signature
FROM expected JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
ON CONFLICT (source_signature,grantee) DO UPDATE SET
  function_schema=EXCLUDED.function_schema,function_name=EXCLUDED.function_name,
  identity_arguments=EXCLUDED.identity_arguments;
