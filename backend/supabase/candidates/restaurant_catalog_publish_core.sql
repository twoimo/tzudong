-- Uninstalled private single-record candidate; no public API or release authority.
-- Envelope keys are exact. selection is an ordered array of explicitly selected
-- review field names. review_sha256 is the caller's artifact hash, never a DB hash.
-- A DB preview must be carried unchanged from prepare to apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE SCHEMA admin_catalog_publish;
REVOKE ALL ON SCHEMA admin_catalog_publish FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA admin_catalog_publish TO service_role, privacy_workflow_owner;

CREATE TABLE admin_catalog_publish.operation_receipts (
  operation_id uuid PRIMARY KEY REFERENCES admin_catalog_edit.audit_events(operation_id),
  actor_user_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  envelope_sha256 text NOT NULL CHECK (envelope_sha256 ~ '^[a-f0-9]{64}$'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  preview_sha256 text NOT NULL CHECK (preview_sha256 ~ '^[a-f0-9]{64}$'),
  core_request_sha256 text NOT NULL CHECK (core_request_sha256 ~ '^[a-f0-9]{64}$'),
  after_sha256 text NOT NULL CHECK (after_sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE admin_catalog_publish.operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_catalog_publish.operation_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON admin_catalog_publish.operation_receipts TO service_role, privacy_workflow_owner;
CREATE POLICY publish_receipt_read ON admin_catalog_publish.operation_receipts FOR SELECT
  TO service_role, privacy_workflow_owner USING (true);
CREATE POLICY publish_receipt_insert ON admin_catalog_publish.operation_receipts FOR INSERT
  TO service_role, privacy_workflow_owner WITH CHECK (true);
CREATE FUNCTION admin_catalog_publish.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'catalog_publish_receipt_immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER immutable_publish_receipt BEFORE UPDATE OR DELETE ON admin_catalog_publish.operation_receipts
  FOR EACH ROW EXECUTE FUNCTION admin_catalog_publish.reject_mutation();
CREATE TRIGGER immutable_publish_receipt_truncate BEFORE TRUNCATE ON admin_catalog_publish.operation_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION admin_catalog_publish.reject_mutation();

CREATE FUNCTION admin_catalog_publish.validate_envelope(p_envelope jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  fields text[] := ARRAY['approved_name','categories','lat','lng','road_address',
    'jibun_address','english_address','tzuyang_review','youtube_link'];
  location_fields text[] := ARRAY['lat','lng','road_address','jibun_address','english_address'];
  selected text[];
  actor uuid;
BEGIN
  IF p_envelope IS NULL OR jsonb_typeof(p_envelope) <> 'object'
     OR octet_length(p_envelope::text) > 98304
     OR NOT p_envelope ?& ARRAY['actor_user_id','restaurant_id','review_sha256','selection',
       'patch','expected_hosted_review_values','operation_id']
     OR (SELECT count(*) FROM jsonb_object_keys(p_envelope)) <> 7 THEN
    RAISE EXCEPTION 'catalog_publish_envelope_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    actor := (p_envelope->>'actor_user_id')::uuid;
    IF actor IS NULL OR (p_envelope->>'restaurant_id')::uuid IS NULL
       OR (p_envelope->>'operation_id')::uuid IS NULL THEN
      RAISE EXCEPTION 'invalid_uuid' USING ERRCODE = '22P02';
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'catalog_publish_envelope_invalid' USING ERRCODE = '22023';
  END;
  PERFORM admin_catalog_edit.require_actor(actor);
  IF jsonb_typeof(p_envelope->'review_sha256') <> 'string'
     OR (p_envelope->>'review_sha256') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_envelope->'selection') <> 'array'
     OR jsonb_typeof(p_envelope->'expected_hosted_review_values') <> 'object' THEN
    RAISE EXCEPTION 'catalog_publish_envelope_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(value) INTO selected FROM jsonb_array_elements_text(p_envelope->'selection');
  IF COALESCE(cardinality(selected),0) = 0 OR NOT selected <@ fields
     OR cardinality(selected) <> (SELECT count(DISTINCT value) FROM unnest(selected) value)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_envelope->'selection') v WHERE jsonb_typeof(v) <> 'string') THEN
    RAISE EXCEPTION 'catalog_publish_selection_invalid' USING ERRCODE = '22023';
  END IF;
  IF selected && location_fields AND NOT location_fields <@ selected THEN
    RAISE EXCEPTION 'catalog_publish_location_selection_incomplete' USING ERRCODE = '22023';
  END IF;
  PERFORM admin_catalog_edit.validate_patch(p_envelope->'patch');
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_envelope->'patch') f WHERE NOT f = ANY(selected)) THEN
    RAISE EXCEPTION 'catalog_publish_unselected_field' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_envelope->'expected_hosted_review_values') ?& (fields || ARRAY['status'])
     OR (SELECT count(*) FROM jsonb_object_keys(p_envelope->'expected_hosted_review_values')) <> 10
     OR (p_envelope #>> '{expected_hosted_review_values,status}') IS NULL
     OR (p_envelope #>> '{expected_hosted_review_values,status}') NOT IN ('approved','pending') THEN
    RAISE EXCEPTION 'catalog_publish_expected_values_invalid' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE FUNCTION admin_catalog_publish.prepare(p_envelope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  live_row jsonb;
  prepared jsonb;
BEGIN
  PERFORM admin_catalog_publish.validate_envelope(p_envelope);
  SELECT to_jsonb(r) INTO live_row FROM public.restaurants r
    WHERE id = (p_envelope->>'restaurant_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog_publish_not_found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_envelope->'expected_hosted_review_values') e
             WHERE (live_row->e.key) IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'catalog_publish_review_stale' USING ERRCODE = '40001';
  END IF;
  prepared := admin_catalog_edit.prepare((p_envelope->>'actor_user_id')::uuid,
    (p_envelope->>'restaurant_id')::uuid,p_envelope->'patch');
  RETURN prepared || jsonb_build_object(
    'core_preview_sha256',prepared->>'preview_sha256',
    'preview_sha256',admin_catalog_edit.digest(jsonb_build_object(
      'envelope',p_envelope,'core_preview_sha256',prepared->>'preview_sha256')),
    'envelope_sha256',admin_catalog_edit.digest(p_envelope),
    'review_sha256',p_envelope->>'review_sha256','operation_id',p_envelope->>'operation_id',
    'selection',p_envelope->'selection','derived_fields',
    jsonb_build_array('updated_by_admin_id','updated_at') ||
    CASE WHEN (p_envelope->'patch') ? 'lat' THEN
      jsonb_build_array('geocoding_success','geocoding_false_stage') ELSE '[]'::jsonb END);
END;
$$;

CREATE FUNCTION admin_catalog_publish.readback(p_actor uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  receipt admin_catalog_publish.operation_receipts%ROWTYPE;
  core admin_catalog_edit.audit_events%ROWTYPE;
  result jsonb;
BEGIN
  PERFORM admin_catalog_edit.require_actor(p_actor);
  SELECT * INTO receipt FROM admin_catalog_publish.operation_receipts WHERE operation_id = p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalog_publish_operation_not_found' USING ERRCODE = 'P0002'; END IF;
  IF receipt.actor_user_id <> p_actor THEN RAISE EXCEPTION 'catalog_publish_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO core FROM admin_catalog_edit.audit_events WHERE operation_id = p_operation;
  IF NOT FOUND OR core.actor_user_id <> receipt.actor_user_id OR core.restaurant_id <> receipt.restaurant_id
     OR core.request_sha256 <> receipt.core_request_sha256 OR core.after_sha256 <> receipt.after_sha256 THEN
    RAISE EXCEPTION 'catalog_publish_receipt_link_invalid' USING ERRCODE = '55000';
  END IF;
  result := admin_catalog_edit.readback(p_actor,p_operation);
  RETURN result || jsonb_build_object('envelope_sha256',receipt.envelope_sha256,
    'review_sha256',receipt.review_sha256,'preview_sha256',receipt.preview_sha256,'link_matches',true);
END;
$$;

CREATE FUNCTION admin_catalog_publish.apply(p_envelope jsonb,p_preview_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid;
  restaurant uuid;
  operation uuid;
  envelope_hash text;
  prepared jsonb;
  edited jsonb;
  receipt admin_catalog_publish.operation_receipts%ROWTYPE;
  core_request text;
BEGIN
  PERFORM admin_catalog_publish.validate_envelope(p_envelope);
  IF p_preview_sha256 IS NULL OR p_preview_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'catalog_publish_preview_invalid' USING ERRCODE = '22023';
  END IF;
  actor := (p_envelope->>'actor_user_id')::uuid;
  restaurant := (p_envelope->>'restaurant_id')::uuid;
  operation := (p_envelope->>'operation_id')::uuid;
  envelope_hash := admin_catalog_edit.digest(p_envelope);
  -- Same lock as edit.apply: serializes publish retries and direct-core collisions.
  PERFORM pg_advisory_xact_lock(hashtextextended(operation::text,0));
  SELECT * INTO receipt FROM admin_catalog_publish.operation_receipts WHERE operation_id = operation;
  IF FOUND THEN
    IF receipt.envelope_sha256 <> envelope_hash OR receipt.preview_sha256 <> p_preview_sha256 THEN
      RAISE EXCEPTION 'catalog_publish_operation_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN admin_catalog_publish.readback(actor,operation) || jsonb_build_object('replayed',true);
  END IF;
  IF EXISTS (SELECT 1 FROM admin_catalog_edit.audit_events WHERE operation_id = operation) THEN
    RAISE EXCEPTION 'catalog_publish_operation_conflict' USING ERRCODE = '40001';
  END IF;
  prepared := admin_catalog_publish.prepare(p_envelope);
  IF prepared->>'preview_sha256' <> p_preview_sha256 THEN
    RAISE EXCEPTION 'catalog_publish_preview_stale' USING ERRCODE = '40001';
  END IF;
  edited := admin_catalog_edit.apply(actor,restaurant,p_envelope->'patch',prepared->>'core_preview_sha256',operation);
  SELECT request_sha256 INTO STRICT core_request FROM admin_catalog_edit.audit_events WHERE operation_id = operation;
  INSERT INTO admin_catalog_publish.operation_receipts(operation_id,actor_user_id,restaurant_id,
    envelope_sha256,review_sha256,preview_sha256,core_request_sha256,after_sha256)
    VALUES(operation,actor,restaurant,envelope_hash,p_envelope->>'review_sha256',p_preview_sha256,
      core_request,edited->>'after_sha256');
  RETURN admin_catalog_publish.readback(actor,operation) || jsonb_build_object('replayed',false);
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA admin_catalog_publish FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION admin_catalog_publish.validate_envelope(jsonb),
  admin_catalog_publish.prepare(jsonb),admin_catalog_publish.apply(jsonb,text),
  admin_catalog_publish.readback(uuid,uuid) TO service_role,privacy_workflow_owner;
-- Existing edit-core/restaurant permissions for a future definer owner are a
-- prerequisite of that exposure, deliberately not widened by this candidate.
COMMIT;
