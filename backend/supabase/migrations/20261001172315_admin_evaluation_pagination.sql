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
  categories OR DELETE OR TRUNCATE ON public.restaurants
FOR EACH STATEMENT EXECUTE FUNCTION pipeline_control.bump_admin_evaluation_revision();

CREATE FUNCTION public.admin_evaluation_revision()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT revision::text FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_revision() TO service_role;

CREATE FUNCTION public.admin_evaluation_catalog_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'revision', (SELECT revision::text FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton),
    'records', COALESCE((SELECT jsonb_agg(projected.record) FROM (
      SELECT jsonb_set((SELECT jsonb_object_agg(field.key, field.value)
        FROM jsonb_each(to_jsonb(r)) AS field
        WHERE field.key = ANY(ARRAY[
          'id','approved_name','origin_name','naver_name','google_name','status',
          'lat','lng','phone','road_address','jibun_address','origin_address',
          'is_missing','is_not_selected','geocoding_success','geocoding_false_stage',
          'youtube_link','youtube_meta','created_at','updated_at','updated_by_admin_id',
          'db_error_details','db_error_message','reasoning_basis','description_map_url',
          'trace_id_name_source','evaluation_results','categories'
        ])), '{name}', COALESCE(to_jsonb(r.approved_name), 'null'::jsonb)) AS record
      FROM public.restaurants r ORDER BY r.id LIMIT 50001
    ) projected), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_catalog_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_catalog_snapshot() TO service_role;

COMMENT ON FUNCTION public.admin_evaluation_catalog_snapshot() IS
  'Service-only revision-bound index input. API rejects overflow; no silent truncation.';
