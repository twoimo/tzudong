-- SOURCE CANDIDATE ONLY. Parent must replace this unconditional admission gate
-- with an independently reviewed exact catalog/ledger binding before integration.
-- Private tests remove only this exact block in their disposable fixture.
DO $catalog_binding_pending$
BEGIN
  RAISE EXCEPTION 'refresh_apply_catalog_binding_pending' USING ERRCODE = '55000';
END;
$catalog_binding_pending$;

-- No legacy identity-helper ACL changes. No role membership changes.
-- Required existing columns are checked before any persistent DDL.
DO $dependencies$
DECLARE d record;
BEGIN
  FOR d IN SELECT * FROM (VALUES
    ('restaurants','id','uuid'), ('restaurants','approved_name','text'),
    ('restaurants','phone','text'), ('restaurants','road_address','text'),
    ('restaurants','jibun_address','text'), ('restaurants','lat','numeric'),
    ('restaurants','lng','numeric'), ('restaurants','status','text'),
    ('restaurants','updated_at','timestamp with time zone'), ('restaurants','updated_by_admin_id','uuid'),
    ('restaurant_refresh_candidates','id','uuid'), ('restaurant_refresh_candidates','restaurant_id','uuid'),
    ('restaurant_refresh_candidates','candidate_status','text'), ('restaurant_refresh_candidates','detected_change_types','text[]'),
    ('restaurant_refresh_candidates','previous_snapshot','jsonb'), ('restaurant_refresh_candidates','candidate_snapshot','jsonb'),
    ('restaurant_refresh_candidates','operator_decision','text'), ('restaurant_refresh_candidates','operator_notes','text'),
    ('restaurant_refresh_candidates','decided_by_admin_id','uuid'), ('restaurant_refresh_candidates','decided_at','timestamp with time zone'),
    ('restaurant_refresh_candidates','applied_at','timestamp with time zone'),
    ('user_roles','user_id','uuid'), ('user_roles','role','app_role')
  ) AS expected(relation_name,column_name,type_name)
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=d.relation_name AND c.relkind='r'
        AND a.attname=d.column_name AND NOT a.attisdropped AND a.attnum>0
        AND pg_catalog.format_type(a.atttypid,a.atttypmod)=d.type_name) THEN
      RAISE EXCEPTION 'refresh_apply_dependency_denied' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('privacy_retention.g014_reject_audit_mutation()') IS NULL THEN
    RAISE EXCEPTION 'refresh_apply_dependency_denied' USING ERRCODE='55000';
  END IF;
END;
$dependencies$;

CREATE TABLE public.restaurant_refresh_apply_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE,
  restaurant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome='applied'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE public.restaurant_refresh_apply_receipts OWNER TO postgres;
ALTER TABLE public.restaurant_refresh_apply_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restaurant_refresh_apply_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER restaurant_refresh_apply_receipts_append_only
BEFORE UPDATE OR DELETE ON public.restaurant_refresh_apply_receipts
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_reject_audit_mutation();

CREATE FUNCTION public.apply_restaurant_refresh_candidate(
  p_actor_user_id uuid,
  p_candidate_id uuid,
  p_expected_previous_snapshot jsonb,
  p_expected_candidate_snapshot jsonb,
  p_operator_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $function$
DECLARE
  c record;
  r record;
  after_row record;
  s jsonb;
  k text;
  name_value text;
  phone_value text;
  road_value text;
  jibun_value text;
  lat_value numeric;
  lng_value numeric;
  preview_hash text;
  audit_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR p_candidate_id IS NULL
     OR pg_catalog.jsonb_typeof(p_expected_previous_snapshot) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_expected_candidate_snapshot) IS DISTINCT FROM 'object'
     OR pg_catalog.octet_length(p_expected_previous_snapshot::text)>16384
     OR pg_catalog.octet_length(p_expected_candidate_snapshot::text)>16384
     OR pg_catalog.octet_length(COALESCE(p_operator_notes,''))>1024 THEN
    RAISE EXCEPTION 'refresh_apply_invalid' USING ERRCODE='22023';
  END IF;
  -- An explicit actor, bound by requireAdmin at the server, must still be an
  -- administrator at apply time. Hold the role row against concurrent removal.
  PERFORM 1 FROM public.user_roles u
  WHERE u.user_id=p_actor_user_id AND u.role='admin'::public.app_role FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refresh_apply_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT id,restaurant_id,candidate_status,detected_change_types,previous_snapshot,candidate_snapshot
  INTO c FROM public.restaurant_refresh_candidates WHERE id=p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refresh_apply_missing' USING ERRCODE='P0002'; END IF;
  IF c.candidate_status<>'needs_review'
     OR c.previous_snapshot IS DISTINCT FROM p_expected_previous_snapshot
     OR c.candidate_snapshot IS DISTINCT FROM p_expected_candidate_snapshot THEN
    RAISE EXCEPTION 'refresh_apply_stale' USING ERRCODE='40001';
  END IF;
  IF 'closure'=ANY(c.detected_change_types) THEN
    RAISE EXCEPTION 'refresh_apply_invalid' USING ERRCODE='22023';
  END IF;
  SELECT id,approved_name,phone,road_address,jibun_address,lat,lng,status,updated_at
  INTO r FROM public.restaurants WHERE id=c.restaurant_id FOR UPDATE;
  IF NOT FOUND OR r.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'refresh_apply_stale' USING ERRCODE='40001';
  END IF;
  -- Require all original preview fields; absence cannot compare equal to NULL.
  IF NOT (c.previous_snapshot ?& ARRAY['name','phone','road_address','jibun_address','lat','lng','updated_at'])
     OR (c.previous_snapshot->>'updated_at')::timestamptz IS DISTINCT FROM r.updated_at
     OR c.previous_snapshot->'name' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(r.approved_name),'null'::jsonb)
     OR c.previous_snapshot->'phone' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(r.phone),'null'::jsonb)
     OR c.previous_snapshot->'road_address' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(r.road_address),'null'::jsonb)
     OR c.previous_snapshot->'jibun_address' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(r.jibun_address),'null'::jsonb)
     OR c.previous_snapshot->'lat' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(r.lat),'null'::jsonb)
     OR c.previous_snapshot->'lng' IS DISTINCT FROM COALESCE(pg_catalog.to_jsonb(r.lng),'null'::jsonb) THEN
    RAISE EXCEPTION 'refresh_apply_stale' USING ERRCODE='40001';
  END IF;
  s:=c.candidate_snapshot;
  -- Only six named business fields can reach the UPDATE. Other stored candidate
  -- evidence is never expanded as SQL, column names, or a whole-row JSON patch.
  FOREACH k IN ARRAY ARRAY['name','approved_name','phone','road_address','jibun_address'] LOOP
    IF s ? k AND s->k <> 'null'::jsonb AND (
      pg_catalog.jsonb_typeof(s->k)<>'string' OR pg_catalog.octet_length(s->>k)>500) THEN
      RAISE EXCEPTION 'refresh_apply_invalid' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['lat','lng'] LOOP
    IF s ? k AND s->k <> 'null'::jsonb AND pg_catalog.jsonb_typeof(s->k)<>'number' THEN
      RAISE EXCEPTION 'refresh_apply_invalid' USING ERRCODE='22023';
    END IF;
  END LOOP;
  name_value:=NULLIF(pg_catalog.btrim(COALESCE(s->>'name',s->>'approved_name')),'');
  phone_value:=NULLIF(pg_catalog.btrim(s->>'phone'),'');
  road_value:=NULLIF(pg_catalog.btrim(s->>'road_address'),'');
  jibun_value:=NULLIF(pg_catalog.btrim(s->>'jibun_address'),'');
  lat_value:=(s->>'lat')::numeric;
  lng_value:=(s->>'lng')::numeric;
  IF lat_value NOT BETWEEN -90 AND 90 OR lng_value NOT BETWEEN -180 AND 180
     OR (name_value IS NULL AND phone_value IS NULL AND road_value IS NULL AND jibun_value IS NULL AND lat_value IS NULL AND lng_value IS NULL) THEN
    RAISE EXCEPTION 'refresh_apply_invalid' USING ERRCODE='22023';
  END IF;
  preview_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p_actor_user_id,p_candidate_id,c.restaurant_id,c.previous_snapshot,s)::text,'UTF8')),'hex');
  UPDATE public.restaurants SET approved_name=COALESCE(name_value,r.approved_name),
    phone=COALESCE(phone_value,r.phone), road_address=COALESCE(road_value,r.road_address),
    jibun_address=COALESCE(jibun_value,r.jibun_address), lat=COALESCE(lat_value,r.lat), lng=COALESCE(lng_value,r.lng),
    updated_by_admin_id=p_actor_user_id,updated_at=pg_catalog.clock_timestamp()
  WHERE id=r.id AND status='approved' AND updated_at IS NOT DISTINCT FROM r.updated_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'refresh_apply_stale' USING ERRCODE='40001'; END IF;
  SELECT approved_name,phone,road_address,jibun_address,lat,lng,updated_by_admin_id,status INTO after_row
    FROM public.restaurants WHERE id=r.id;
  IF NOT FOUND OR after_row.status IS DISTINCT FROM 'approved'
    OR after_row.updated_by_admin_id IS DISTINCT FROM p_actor_user_id
    OR after_row.approved_name IS DISTINCT FROM COALESCE(name_value,r.approved_name)
    OR after_row.phone IS DISTINCT FROM COALESCE(phone_value,r.phone)
    OR after_row.road_address IS DISTINCT FROM COALESCE(road_value,r.road_address)
    OR after_row.jibun_address IS DISTINCT FROM COALESCE(jibun_value,r.jibun_address)
    OR after_row.lat IS DISTINCT FROM COALESCE(lat_value,r.lat)
    OR after_row.lng IS DISTINCT FROM COALESCE(lng_value,r.lng) THEN
    RAISE EXCEPTION 'refresh_apply_readback_denied' USING ERRCODE='40001';
  END IF;
  UPDATE public.restaurant_refresh_candidates SET candidate_status='applied',operator_decision='approved',
    operator_notes=p_operator_notes,decided_by_admin_id=p_actor_user_id,
    decided_at=pg_catalog.clock_timestamp(),applied_at=pg_catalog.clock_timestamp()
    WHERE id=p_candidate_id AND candidate_status='needs_review';
  IF NOT FOUND THEN RAISE EXCEPTION 'refresh_apply_stale' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.restaurant_refresh_candidates x WHERE x.id=p_candidate_id
    AND x.candidate_status='applied' AND x.operator_decision='approved' AND x.decided_by_admin_id=p_actor_user_id
    AND x.operator_notes IS NOT DISTINCT FROM p_operator_notes AND x.decided_at IS NOT NULL AND x.applied_at IS NOT NULL) THEN
    RAISE EXCEPTION 'refresh_apply_readback_denied' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.restaurant_refresh_apply_receipts(candidate_id,restaurant_id,actor_user_id,preview_hash,outcome)
  VALUES(p_candidate_id,r.id,p_actor_user_id,preview_hash,'applied') RETURNING id INTO audit_id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'candidate_status','applied','candidate_id',p_candidate_id,
    'restaurant_id',r.id,'preview_hash',preview_hash,'audit_id',audit_id,'readback',true);
END;
$function$;
ALTER FUNCTION public.apply_restaurant_refresh_candidate(uuid,uuid,jsonb,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_restaurant_refresh_candidate(uuid,uuid,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_restaurant_refresh_candidate(uuid,uuid,jsonb,jsonb,text) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
SELECT 'public','apply_restaurant_refresh_candidate',p.proargtypes::text,'service_role',
  'public.apply_restaurant_refresh_candidate(uuid,uuid,jsonb,jsonb,text)'
FROM pg_catalog.pg_proc p WHERE p.oid='public.apply_restaurant_refresh_candidate(uuid,uuid,jsonb,jsonb,text)'::regprocedure;
-- Parent integration must bind the new receipt relation and RPC into the real
-- catalog contract and run all actual G014 assertions. The leading gate cannot
-- be removed solely because private tests pass.
NOTIFY pgrst, 'reload schema';
