-- Candidate atomic edit core. Not a canonical migration or a hosted receipt.
-- Public API wrappers, catalog allowlisting and UI integration are separate work.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA admin_catalog_edit;
REVOKE ALL ON SCHEMA admin_catalog_edit FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA admin_catalog_edit TO service_role;

CREATE TABLE admin_catalog_edit.audit_events (
  operation_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  before_sha256 text NOT NULL CHECK (before_sha256 ~ '^[a-f0-9]{64}$'),
  after_sha256 text NOT NULL CHECK (after_sha256 ~ '^[a-f0-9]{64}$'),
  changed_fields text[] NOT NULL CHECK (cardinality(changed_fields) > 0
    AND changed_fields <@ ARRAY['approved_name','categories','lat','lng','road_address',
      'jibun_address','english_address','youtube_link','tzuyang_review']::text[]),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE admin_catalog_edit.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_catalog_edit.audit_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON admin_catalog_edit.audit_events TO service_role;
CREATE POLICY service_edit_audit_read ON admin_catalog_edit.audit_events FOR SELECT TO service_role USING (true);
CREATE POLICY service_edit_audit_insert ON admin_catalog_edit.audit_events FOR INSERT TO service_role WITH CHECK (true);

CREATE FUNCTION admin_catalog_edit.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'catalog_edit_audit_immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER immutable_edit_audit BEFORE UPDATE OR DELETE ON admin_catalog_edit.audit_events
FOR EACH ROW EXECUTE FUNCTION admin_catalog_edit.reject_audit_mutation();
CREATE TRIGGER immutable_edit_audit_truncate BEFORE TRUNCATE ON admin_catalog_edit.audit_events
FOR EACH STATEMENT EXECUTE FUNCTION admin_catalog_edit.reject_audit_mutation();

CREATE FUNCTION admin_catalog_edit.digest(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value::text, 'UTF8')), 'hex');
$$;

CREATE FUNCTION admin_catalog_edit.require_actor(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (current_user <> 'service_role' AND NOT (
        current_user = 'privacy_workflow_owner' AND current_setting('role', true) = 'service_role'
      )) OR p_actor IS NULL THEN
    RAISE EXCEPTION 'catalog_edit_forbidden' USING ERRCODE = '42501';
  END IF;
  -- G014 intentionally denies service_role direct access to role/account tables.
  -- Reuse its existing, allowlisted metadata RPC instead of widening table grants.
  IF NOT EXISTS (SELECT 1 FROM public.read_admin_user_management_metadata(ARRAY[p_actor]) metadata
                 WHERE metadata.user_id = p_actor AND metadata.is_admin
                   AND metadata.account_status = 'active') THEN
    RAISE EXCEPTION 'catalog_edit_forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION admin_catalog_edit.validate_patch(p_patch jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  field text;
  value jsonb;
  allowed text[] := ARRAY['approved_name','categories','lat','lng','road_address',
    'jibun_address','english_address','youtube_link','tzuyang_review'];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb
     OR octet_length(p_patch::text) > 32768 THEN
    RAISE EXCEPTION 'catalog_edit_patch_invalid' USING ERRCODE = '22023';
  END IF;
  FOR field, value IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF NOT field = ANY(allowed) THEN
      RAISE EXCEPTION 'catalog_edit_field_invalid' USING ERRCODE = '22023';
    END IF;
    IF field IN ('lat','lng') THEN
      IF jsonb_typeof(value) <> 'number'
         OR (field = 'lat' AND (value::text)::numeric NOT BETWEEN -90 AND 90)
         OR (field = 'lng' AND (value::text)::numeric NOT BETWEEN -180 AND 180) THEN
        RAISE EXCEPTION 'catalog_edit_coordinates_invalid' USING ERRCODE = '22023';
      END IF;
    ELSIF field = 'categories' THEN
      IF jsonb_typeof(value) <> 'array' THEN
        RAISE EXCEPTION 'catalog_edit_categories_invalid' USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(value) > 30 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(value) item
        WHERE jsonb_typeof(item) <> 'string' OR length(item #>> '{}') NOT BETWEEN 1 AND 64
      ) THEN
        RAISE EXCEPTION 'catalog_edit_categories_invalid' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF jsonb_typeof(value) NOT IN ('string','null')
         OR length(value #>> '{}') > (CASE WHEN field = 'tzuyang_review' THEN 20000 ELSE 1000 END) THEN
        RAISE EXCEPTION 'catalog_edit_text_invalid' USING ERRCODE = '22023';
      END IF;
      IF field = 'approved_name' AND (value = 'null'::jsonb OR length(btrim(value #>> '{}')) NOT BETWEEN 1 AND 300) THEN
        RAISE EXCEPTION 'catalog_edit_name_invalid' USING ERRCODE = '22023';
      END IF;
      IF field = 'youtube_link' AND value <> 'null'::jsonb
         AND (value #>> '{}') !~ '^https://(www\.)?(youtube\.com/(watch\?|shorts/|live/)|youtu\.be/)' THEN
        RAISE EXCEPTION 'catalog_edit_video_invalid' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  IF (p_patch ? 'lat') <> (p_patch ? 'lng') OR
     (p_patch ?| ARRAY['road_address','jibun_address','english_address'] AND NOT p_patch ? 'lat') THEN
    RAISE EXCEPTION 'catalog_edit_address_coordinates_required' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE FUNCTION admin_catalog_edit.prepare(p_actor uuid, p_restaurant uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  old_row public.restaurants%ROWTYPE;
  before_values jsonb := '{}'::jsonb;
  after_values jsonb := '{}'::jsonb;
  before_hash text;
  field text;
  value jsonb;
BEGIN
  PERFORM admin_catalog_edit.require_actor(p_actor);
  PERFORM admin_catalog_edit.validate_patch(p_patch);
  SELECT * INTO old_row FROM public.restaurants WHERE id = p_restaurant;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog_edit_not_found' USING ERRCODE = 'P0002'; END IF;
  IF old_row.status = 'deleted' THEN
    RAISE EXCEPTION 'catalog_edit_deleted_record' USING ERRCODE = '22023';
  END IF;
  FOR field, value IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF (to_jsonb(old_row) -> field) IS DISTINCT FROM value THEN
      before_values := before_values || jsonb_build_object(field, to_jsonb(old_row) -> field);
      after_values := after_values || jsonb_build_object(field, value);
    END IF;
  END LOOP;
  IF after_values = '{}'::jsonb THEN RAISE EXCEPTION 'catalog_edit_no_changes' USING ERRCODE = '22023'; END IF;
  before_hash := admin_catalog_edit.digest(to_jsonb(old_row));
  RETURN jsonb_build_object('before', before_values, 'after', after_values,
    'before_sha256', before_hash, 'preview_sha256', admin_catalog_edit.digest(
      jsonb_build_object('actor',p_actor,'restaurant',p_restaurant,'before',before_hash,'patch',p_patch)));
END;
$$;

CREATE FUNCTION admin_catalog_edit.apply(p_actor uuid, p_restaurant uuid, p_patch jsonb,
  p_preview_sha256 text, p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  prepared jsonb;
  request_hash text;
  old_audit admin_catalog_edit.audit_events%ROWTYPE;
  updated_row public.restaurants%ROWTYPE;
  after_hash text;
  fields text[];
BEGIN
  PERFORM admin_catalog_edit.require_actor(p_actor);
  PERFORM admin_catalog_edit.validate_patch(p_patch);
  IF p_operation IS NULL OR p_preview_sha256 IS NULL OR p_preview_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'catalog_edit_confirmation_invalid' USING ERRCODE = '22023';
  END IF;
  request_hash := admin_catalog_edit.digest(jsonb_build_object('actor',p_actor,'restaurant',p_restaurant,
    'preview',p_preview_sha256,'patch',p_patch));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation::text, 0));
  SELECT * INTO old_audit FROM admin_catalog_edit.audit_events WHERE operation_id = p_operation;
  IF FOUND THEN
    IF old_audit.request_sha256 <> request_hash THEN
      RAISE EXCEPTION 'catalog_edit_operation_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object('operation_id',p_operation,'after_sha256',old_audit.after_sha256,
      'changed_fields',old_audit.changed_fields,'replayed',true);
  END IF;
  PERFORM 1 FROM public.restaurants WHERE id = p_restaurant FOR UPDATE;
  prepared := admin_catalog_edit.prepare(p_actor, p_restaurant, p_patch);
  IF prepared ->> 'preview_sha256' <> p_preview_sha256 THEN
    RAISE EXCEPTION 'catalog_edit_preview_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.restaurants r SET
    approved_name = CASE WHEN p_patch ? 'approved_name' THEN p_patch ->> 'approved_name' ELSE r.approved_name END,
    categories = CASE WHEN p_patch ? 'categories' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'categories')) ELSE r.categories END,
    lat = CASE WHEN p_patch ? 'lat' THEN (p_patch ->> 'lat')::numeric ELSE r.lat END,
    lng = CASE WHEN p_patch ? 'lng' THEN (p_patch ->> 'lng')::numeric ELSE r.lng END,
    road_address = CASE WHEN p_patch ? 'road_address' THEN p_patch ->> 'road_address' ELSE r.road_address END,
    jibun_address = CASE WHEN p_patch ? 'jibun_address' THEN p_patch ->> 'jibun_address' ELSE r.jibun_address END,
    english_address = CASE WHEN p_patch ? 'english_address' THEN p_patch ->> 'english_address' ELSE r.english_address END,
    youtube_link = CASE WHEN p_patch ? 'youtube_link' THEN p_patch ->> 'youtube_link' ELSE r.youtube_link END,
    tzuyang_review = CASE WHEN p_patch ? 'tzuyang_review' THEN p_patch ->> 'tzuyang_review' ELSE r.tzuyang_review END,
    geocoding_success = CASE WHEN p_patch ? 'lat' THEN true ELSE r.geocoding_success END,
    geocoding_false_stage = CASE WHEN p_patch ? 'lat' THEN NULL ELSE r.geocoding_false_stage END,
    updated_by_admin_id = p_actor, updated_at = clock_timestamp()
  WHERE r.id = p_restaurant RETURNING * INTO updated_row;
  after_hash := admin_catalog_edit.digest(to_jsonb(updated_row));
  SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_object_keys(prepared -> 'after') key;
  INSERT INTO admin_catalog_edit.audit_events(operation_id,actor_user_id,restaurant_id,
    request_sha256,before_sha256,after_sha256,changed_fields)
  VALUES(p_operation,p_actor,p_restaurant,request_hash,prepared ->> 'before_sha256',after_hash,fields);
  RETURN jsonb_build_object('operation_id',p_operation,'after_sha256',after_hash,'changed_fields',fields,'replayed',false);
END;
$$;

CREATE FUNCTION admin_catalog_edit.readback(p_actor uuid, p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  audit_row admin_catalog_edit.audit_events%ROWTYPE;
  current_row jsonb;
  current_hash text;
  visible_values jsonb;
BEGIN
  PERFORM admin_catalog_edit.require_actor(p_actor);
  SELECT * INTO audit_row FROM admin_catalog_edit.audit_events WHERE operation_id = p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog_edit_operation_not_found' USING ERRCODE = 'P0002'; END IF;
  IF audit_row.actor_user_id <> p_actor THEN
    RAISE EXCEPTION 'catalog_edit_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(r) INTO current_row FROM public.restaurants r WHERE r.id = audit_row.restaurant_id;
  current_hash := admin_catalog_edit.digest(current_row);
  SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO visible_values
    FROM jsonb_each(current_row) WHERE key = ANY(audit_row.changed_fields);
  RETURN jsonb_build_object('operation_id',p_operation,'restaurant_id',audit_row.restaurant_id,'after_sha256',audit_row.after_sha256,
    'current_sha256',current_hash,'matches',COALESCE(current_hash = audit_row.after_sha256,false),
    'changed_fields',audit_row.changed_fields,'values',visible_values);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA admin_catalog_edit FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_catalog_edit.digest(jsonb),
  admin_catalog_edit.require_actor(uuid), admin_catalog_edit.validate_patch(jsonb),
  admin_catalog_edit.prepare(uuid,uuid,jsonb), admin_catalog_edit.apply(uuid,uuid,jsonb,text,uuid),
  admin_catalog_edit.readback(uuid,uuid)
  TO service_role;
COMMIT;
