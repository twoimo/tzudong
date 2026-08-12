-- G026 canonical repair definitions. Source-only empty-clean-replay synthesis; never historical evidence.
-- Run the checkpoint and this exact definition section once in phase B, immediately before
-- 20260713002000_g014_public_api_private_boundary.sql so G014 owns final hardening.

DO $$
BEGIN
  IF current_setting('check_function_bodies') <> 'on' THEN
    RAISE EXCEPTION 'G026 pre-body checkpoint failed: function body validation is off' USING ERRCODE = 'P0001';
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='restaurants' AND column_name IN ('approved_name','trace_id','google_name','origin_name','naver_name','youtube_link') GROUP BY table_schema,table_name HAVING count(*)=6) THEN
    RAISE EXCEPTION 'G026 pre-body checkpoint failed: restaurants identity projection is missing' USING ERRCODE = 'P0001';
  ELSIF to_regclass('public.restaurants_backup') IS NULL OR to_regclass('public.restaurant_submissions') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='restaurant_submission_items' AND column_name='target_restaurant_id') THEN
    RAISE EXCEPTION 'G026 pre-body checkpoint failed: approval relations are missing' USING ERRCODE = 'P0001';
  ELSIF to_regprocedure('extensions.similarity(text,text)') IS NULL OR to_regprocedure('public.generate_unique_id(text,text,text)') IS NULL OR to_regprocedure('public.is_user_admin(uuid)') IS NULL OR to_regprocedure('public.extract_youtube_video_id(text)') IS NULL OR to_regprocedure('public.resolve_restaurant_identity_name(text,text,text,text)') IS NULL OR to_regprocedure('public.normalize_restaurant_identity_name(text)') IS NULL OR to_regprocedure('public.canonicalize_youtube_link(text)') IS NULL THEN
    RAISE EXCEPTION 'G026 pre-body checkpoint failed: approval helper identity is missing' USING ERRCODE = 'P0001';
  ELSIF to_regclass('public.idx_restaurants_active_video_identity') IS NULL THEN
    RAISE EXCEPTION 'G026 pre-body checkpoint failed: active identity index is missing' USING ERRCODE = 'P0001';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='restaurant_submission_items_target_restaurant_id_fkey') OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='items_approved_target_restaurant_check') OR to_regclass('public.idx_submission_items_target_restaurant_id') IS NULL THEN
    RAISE EXCEPTION 'G026 pre-body checkpoint failed: submission backup target contract is missing' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- G026 source-only, fail-closed policy identity shells. The archived replay
-- establishes the relations but omits these seven historical policy identities.
-- Later immutable migration 20260812000200 replaces every false predicate and
-- narrows each policy to authenticated; these shells grant no interim access.
DO $g026_policy_shell_precondition$
DECLARE
  v_existing_count integer;
BEGIN
  IF to_regclass('public.restaurant_requests') IS NULL
     OR to_regclass('public.restaurant_submission_items') IS NULL
     OR to_regclass('public.restaurant_submissions') IS NULL
     OR to_regclass('public.short_urls') IS NULL THEN
    RAISE EXCEPTION 'G026 policy shell relation precondition failed' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
    INTO v_existing_count
    FROM pg_catalog.pg_policy AS policy_row
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = policy_row.polrelid
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
    JOIN (VALUES
      ('restaurant_requests', 'Restaurant requests select policy'),
      ('restaurant_submission_items', 'Admins can delete submission items'),
      ('restaurant_submission_items', 'Admins can update submission items'),
      ('restaurant_submission_items', 'Submission items insert policy'),
      ('restaurant_submission_items', 'Submission items select policy'),
      ('restaurant_submissions', 'Restaurant submissions select policy'),
      ('short_urls', 'Admins can delete short URLs')
    ) AS expected_policy(relation_name, policy_name)
      ON expected_policy.relation_name = relation_row.relname
     AND expected_policy.policy_name = policy_row.polname
   WHERE namespace_row.nspname = 'public';

  IF v_existing_count <> 0 THEN
    RAISE EXCEPTION 'G026 policy shell identity already exists' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy_row
      JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = policy_row.polrelid
      JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
     WHERE namespace_row.nspname = 'public'
       AND relation_row.relname = 'restaurant_submissions'
       AND policy_row.polname = 'Admins can view all submissions'
       AND policy_row.polcmd = 'r'
       AND policy_row.polroles = ARRAY[0::oid]
       AND pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid, false)
           = 'is_user_admin(( SELECT auth.uid() AS uid))'
       AND policy_row.polwithcheck IS NULL
       AND (
         SELECT count(*)
           FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid = 'pg_policy'::regclass
            AND dependency.objid = policy_row.oid
            AND dependency.refclassid = 'pg_proc'::regclass
            AND dependency.refobjid = 'public.is_user_admin(uuid)'::regprocedure
       ) = 1
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy_row
      JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = policy_row.polrelid
      JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
     WHERE namespace_row.nspname = 'public'
       AND relation_row.relname = 'restaurant_submission_items'
       AND policy_row.polname = 'Admins can manage all submission items'
       AND policy_row.polcmd = '*'
       AND policy_row.polroles = ARRAY[0::oid]
       AND pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid, false)
           = 'is_user_admin(( SELECT auth.uid() AS uid))'
       AND policy_row.polwithcheck IS NULL
       AND (
         SELECT count(*)
           FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid = 'pg_policy'::regclass
            AND dependency.objid = policy_row.oid
            AND dependency.refclassid = 'pg_proc'::regclass
            AND dependency.refobjid = 'public.is_user_admin(uuid)'::regprocedure
       ) = 1
  ) THEN
    RAISE EXCEPTION 'G026 obsolete policy identity precondition failed' USING ERRCODE = 'P0001';
  END IF;
END;
$g026_policy_shell_precondition$;

DROP POLICY "Admins can view all submissions" ON public.restaurant_submissions;
DROP POLICY "Admins can manage all submission items" ON public.restaurant_submission_items;

CREATE POLICY "Restaurant requests select policy"
  ON public.restaurant_requests FOR SELECT USING (false);
CREATE POLICY "Admins can delete submission items"
  ON public.restaurant_submission_items FOR DELETE USING (false);
CREATE POLICY "Admins can update submission items"
  ON public.restaurant_submission_items FOR UPDATE USING (false);
CREATE POLICY "Submission items insert policy"
  ON public.restaurant_submission_items FOR INSERT WITH CHECK (false);
CREATE POLICY "Submission items select policy"
  ON public.restaurant_submission_items FOR SELECT USING (false);
CREATE POLICY "Restaurant submissions select policy"
  ON public.restaurant_submissions FOR SELECT USING (false);
CREATE POLICY "Admins can delete short URLs"
  ON public.short_urls FOR DELETE USING (false);

DROP FUNCTION IF EXISTS public.approve_restaurant(uuid);
DROP FUNCTION IF EXISTS public.create_user_notification(uuid, public.notification_type, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.g026_upsert_restaurant_backup(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE r public.restaurants%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.restaurants WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'G026 backup source restaurant is missing' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.restaurants_backup (id,name,phone,categories,lat,lng,road_address,jibun_address,english_address,address_elements,origin_address,youtube_meta,unique_id,reasoning_basis,evaluation_results,source_type,geocoding_success,geocoding_false_stage,status,is_missing,is_not_selected,review_count,created_by,updated_by_admin_id,db_error_message,db_error_details,tzuyang_review,youtube_link,created_at,updated_at,search_count,weekly_search_count)
 VALUES (r.id,r.approved_name,r.phone,r.categories,r.lat,r.lng,r.road_address,r.jibun_address,r.english_address,r.address_elements,r.origin_address,r.youtube_meta,r.trace_id,r.reasoning_basis,r.evaluation_results,r.source_type,r.geocoding_success,CASE WHEN r.geocoding_success THEN NULL ELSE r.geocoding_false_stage END,r.status,r.is_missing,r.is_not_selected,r.review_count,r.created_by,r.updated_by_admin_id,r.db_error_message,r.db_error_details,r.tzuyang_review,r.youtube_link,r.created_at,r.updated_at,r.search_count,r.weekly_search_count)
 ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,categories=EXCLUDED.categories,lat=EXCLUDED.lat,lng=EXCLUDED.lng,road_address=EXCLUDED.road_address,jibun_address=EXCLUDED.jibun_address,english_address=EXCLUDED.english_address,address_elements=EXCLUDED.address_elements,origin_address=EXCLUDED.origin_address,youtube_meta=EXCLUDED.youtube_meta,unique_id=EXCLUDED.unique_id,reasoning_basis=EXCLUDED.reasoning_basis,evaluation_results=EXCLUDED.evaluation_results,source_type=EXCLUDED.source_type,geocoding_success=EXCLUDED.geocoding_success,geocoding_false_stage=EXCLUDED.geocoding_false_stage,status=EXCLUDED.status,is_missing=EXCLUDED.is_missing,is_not_selected=EXCLUDED.is_not_selected,review_count=EXCLUDED.review_count,created_by=EXCLUDED.created_by,updated_by_admin_id=EXCLUDED.updated_by_admin_id,db_error_message=EXCLUDED.db_error_message,db_error_details=EXCLUDED.db_error_details,tzuyang_review=EXCLUDED.tzuyang_review,youtube_link=EXCLUDED.youtube_link,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,search_count=EXCLUDED.search_count,weekly_search_count=EXCLUDED.weekly_search_count;
END; $$;
ALTER FUNCTION public.g026_upsert_restaurant_backup(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.g026_upsert_restaurant_backup(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_submission_item(p_item_id uuid,p_admin_user_id uuid,p_restaurant_data jsonb)
RETURNS TABLE(success boolean,message text,created_restaurant_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_item public.restaurant_submission_items%ROWTYPE; v_submission public.restaurant_submissions%ROWTYPE; v_new_restaurant_id uuid; v_name text; v_trace text; v_key text; v_role text;
BEGIN
 IF p_restaurant_data IS NULL OR jsonb_typeof(p_restaurant_data) <> 'object' THEN RAISE EXCEPTION 'approval data must be an object' USING ERRCODE='22023'; END IF;
 SELECT key INTO v_key FROM jsonb_each(p_restaurant_data) WHERE key NOT IN ('name','phone','categories','tzuyang_review','youtube_link','jibun_address','road_address','english_address','address_elements','lat','lng','youtube_meta') OR (key IN ('name','phone','tzuyang_review','youtube_link','jibun_address','road_address','english_address') AND jsonb_typeof(value) NOT IN ('string','null')) OR (key='categories' AND jsonb_typeof(value) NOT IN ('array','null')) OR (key IN ('lat','lng') AND jsonb_typeof(value) NOT IN ('number','null')) OR (key IN ('address_elements','youtube_meta') AND jsonb_typeof(value) NOT IN ('object','null')) ORDER BY key LIMIT 1;
 IF v_key IS NOT NULL THEN RAISE EXCEPTION 'invalid approval field: %',v_key USING ERRCODE='22023'; END IF;
 v_role:=current_setting('request.jwt.claim.role',true);
 IF v_role IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR auth.uid()<>p_admin_user_id) THEN RETURN QUERY SELECT false,'관리자 인증 정보가 일치하지 않습니다.',NULL::uuid; RETURN; END IF;
 IF NOT public.is_user_admin(p_admin_user_id) THEN RETURN QUERY SELECT false,'관리자 권한이 필요합니다.',NULL::uuid; RETURN; END IF;
 SELECT s.* INTO v_submission FROM public.restaurant_submissions s JOIN public.restaurant_submission_items i ON i.submission_id=s.id WHERE i.id=p_item_id FOR UPDATE OF s;
 IF NOT FOUND THEN RETURN QUERY SELECT false,'처리할 항목이 없거나 이미 처리되었습니다.',NULL::uuid; RETURN; END IF;
 SELECT * INTO v_item FROM public.restaurant_submission_items WHERE id=p_item_id AND submission_id=v_submission.id AND item_status='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT false,'처리할 항목이 없거나 이미 처리되었습니다.',NULL::uuid; RETURN; END IF;
 IF p_restaurant_data->>'jibun_address' IS NULL OR p_restaurant_data->>'lat' IS NULL OR p_restaurant_data->>'lng' IS NULL THEN RETURN QUERY SELECT false,'지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).',NULL::uuid; RETURN; END IF;
 v_name:=nullif(btrim(p_restaurant_data->>'name'),'');
 IF v_name IS NULL THEN RETURN QUERY SELECT false,'이름이 없습니다. trace_id 생성 불가',NULL::uuid; RETURN; END IF;
 v_trace:=public.generate_unique_id(public.canonicalize_youtube_link(coalesce(p_restaurant_data->>'youtube_link',v_item.youtube_link)),v_name,nullif(p_restaurant_data->>'tzuyang_review',''));
 IF v_trace IS NULL OR v_trace='' THEN RETURN QUERY SELECT false,'trace_id 생성에 실패했습니다.',NULL::uuid; RETURN; END IF;
 BEGIN
  INSERT INTO public.restaurants(trace_id,approved_name,phone,categories,tzuyang_review,youtube_link,jibun_address,road_address,english_address,address_elements,lat,lng,youtube_meta,status,source_type,geocoding_success,created_by,updated_by_admin_id)
  VALUES(v_trace,v_name,p_restaurant_data->>'phone',CASE WHEN jsonb_typeof(p_restaurant_data->'categories')='array' THEN ARRAY(SELECT jsonb_array_elements_text(p_restaurant_data->'categories')) END,p_restaurant_data->>'tzuyang_review',public.canonicalize_youtube_link(coalesce(p_restaurant_data->>'youtube_link',v_item.youtube_link)),p_restaurant_data->>'jibun_address',p_restaurant_data->>'road_address',p_restaurant_data->>'english_address',coalesce(p_restaurant_data->'address_elements','{}'::jsonb),(p_restaurant_data->>'lat')::numeric,(p_restaurant_data->>'lng')::numeric,coalesce(p_restaurant_data->'youtube_meta','{}'::jsonb),'approved','user_submission_new',true,v_item.user_id,p_admin_user_id) RETURNING id INTO v_new_restaurant_id;
  IF v_new_restaurant_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='음식점 생성/재사용에 실패했습니다.'; END IF;
  PERFORM public.g026_upsert_restaurant_backup(v_new_restaurant_id);
  UPDATE public.restaurant_submission_items SET item_status='approved',target_restaurant_id=v_new_restaurant_id WHERE id=p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='submission item 업데이트 실패'; END IF;
  UPDATE public.restaurant_submissions SET resolved_by_admin_id=p_admin_user_id,reviewed_at=now() WHERE id=v_item.submission_id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN QUERY SELECT false,SQLERRM,NULL::uuid; RETURN; WHEN unique_violation THEN RETURN QUERY SELECT false,'이미 동일 영상/식당 조합 또는 trace_id가 존재합니다.',NULL::uuid; RETURN;
 END;
 RETURN QUERY SELECT true,'승인이 완료되었습니다.',v_new_restaurant_id;
END; $$;
ALTER FUNCTION public.approve_submission_item(uuid,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_submission_item(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_submission_item(uuid,uuid,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_restaurant(restaurant_id uuid,admin_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_id uuid;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required' USING ERRCODE='42501'; END IF;
 IF NOT public.is_user_admin(admin_user_id) THEN RAISE EXCEPTION 'administrator privileges required' USING ERRCODE='42501'; END IF;
 BEGIN
  SELECT id INTO v_id FROM public.restaurants WHERE id=restaurant_id AND status='pending' FOR UPDATE;
  IF v_id IS NULL THEN RETURN false; END IF;
  UPDATE public.restaurants SET status='approved',updated_at=now(),updated_by_admin_id=admin_user_id WHERE id=v_id RETURNING id INTO v_id;
  PERFORM public.g026_upsert_restaurant_backup(v_id);
 EXCEPTION WHEN OTHERS THEN RAISE; END;
 RETURN true;
END; $$;
ALTER FUNCTION public.approve_restaurant(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_restaurant(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_restaurant(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_edit_submission_item(p_item_id uuid,p_admin_user_id uuid,p_updated_data jsonb)
RETURNS TABLE(success boolean,message text,restaurant_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_item public.restaurant_submission_items%ROWTYPE; v_id uuid; v_key text;
BEGIN
 IF p_updated_data IS NULL OR jsonb_typeof(p_updated_data)<>'object' THEN RAISE EXCEPTION 'approval data must be an object' USING ERRCODE='22023'; END IF;
 SELECT key INTO v_key FROM jsonb_each(p_updated_data) WHERE key NOT IN ('name','phone','categories','tzuyang_review','youtube_link','jibun_address','road_address','english_address','address_elements','lat','lng','youtube_meta') OR (key IN ('name','phone','tzuyang_review','youtube_link','jibun_address','road_address','english_address') AND jsonb_typeof(value) NOT IN ('string','null')) OR (key='categories' AND jsonb_typeof(value) NOT IN ('array','null')) OR (key IN ('lat','lng') AND jsonb_typeof(value) NOT IN ('number','null')) OR (key IN ('address_elements','youtube_meta') AND jsonb_typeof(value) NOT IN ('object','null')) ORDER BY key LIMIT 1;
 IF v_key IS NOT NULL THEN RAISE EXCEPTION 'invalid approval field: %',v_key USING ERRCODE='22023'; END IF;
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR auth.uid()<>p_admin_user_id) THEN RETURN QUERY SELECT false,'관리자 인증 정보가 일치하지 않습니다.',NULL::uuid; RETURN; END IF;
 IF NOT public.is_user_admin(p_admin_user_id) THEN RETURN QUERY SELECT false,'관리자 권한이 필요합니다.',NULL::uuid; RETURN; END IF;
 SELECT * INTO v_item FROM public.restaurant_submission_items WHERE id=p_item_id AND item_status='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT false,'처리할 항목이 없거나 이미 처리되었습니다.',NULL::uuid; RETURN; END IF;
 IF v_item.target_restaurant_id IS NULL THEN RETURN QUERY SELECT false,'수정 대상 레스토랑 정보가 없습니다.',NULL::uuid; RETURN; END IF;
 BEGIN
  UPDATE public.restaurants SET approved_name=coalesce(nullif(p_updated_data->>'name',''),approved_name),phone=coalesce(p_updated_data->>'phone',phone),road_address=coalesce(p_updated_data->>'road_address',road_address),jibun_address=coalesce(p_updated_data->>'jibun_address',jibun_address),english_address=coalesce(p_updated_data->>'english_address',english_address),lat=coalesce((p_updated_data->>'lat')::numeric,lat),lng=coalesce((p_updated_data->>'lng')::numeric,lng),updated_at=now(),updated_by_admin_id=p_admin_user_id WHERE id=v_item.target_restaurant_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='대상 레스토랑이 존재하지 않습니다.'; END IF;
  PERFORM public.g026_upsert_restaurant_backup(v_id);
  UPDATE public.restaurant_submission_items SET item_status='approved' WHERE id=p_item_id;
  UPDATE public.restaurant_submissions SET resolved_by_admin_id=p_admin_user_id,reviewed_at=now() WHERE id=v_item.submission_id;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN QUERY SELECT false,SQLERRM,NULL::uuid; RETURN; END;
 RETURN QUERY SELECT true,'수정 승인이 완료되었습니다.',v_id;
END; $$;
ALTER FUNCTION public.approve_edit_submission_item(uuid,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_edit_submission_item(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_edit_submission_item(uuid,uuid,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_new_restaurant_submission(p_submission_id uuid,p_admin_user_id uuid,p_geocoded_data jsonb)
RETURNS TABLE(success boolean,message text,created_restaurant_ids uuid[]) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_item record; v_result record; v_ids uuid[]:=ARRAY[]::uuid[]; v_supplied_ids uuid[]:=ARRAY[]::uuid[]; v_pending_ids uuid[]; v_payload_item jsonb; v_item_id_text text; v_item_id uuid; v_distinct_count integer;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required' USING ERRCODE='42501'; END IF;
 IF NOT public.is_user_admin(p_admin_user_id) THEN RAISE EXCEPTION 'administrator privileges required' USING ERRCODE='42501'; END IF;
 IF p_geocoded_data IS NULL OR jsonb_typeof(p_geocoded_data)<>'object' THEN RETURN QUERY SELECT false,'신규 제보 승인 요청 형식이 올바르지 않습니다. (new submission approval request must be an object)',ARRAY[]::uuid[]; RETURN; END IF;
 IF NOT p_geocoded_data ? 'items' OR jsonb_typeof(p_geocoded_data->'items')<>'array' OR (SELECT count(*) FROM jsonb_object_keys(p_geocoded_data))<>1 THEN RETURN QUERY SELECT false,'신규 제보 승인 요청 키가 올바르지 않습니다. (new submission approval request keys must be items)',ARRAY[]::uuid[]; RETURN; END IF;
 IF jsonb_array_length(p_geocoded_data->'items')=0 THEN RETURN QUERY SELECT false,'승인할 신규 제보 항목이 없습니다. (no new submission items were supplied)',ARRAY[]::uuid[]; RETURN; END IF;
 FOR v_payload_item IN SELECT value FROM jsonb_array_elements(p_geocoded_data->'items') LOOP
  IF jsonb_typeof(v_payload_item)<>'object' THEN RETURN QUERY SELECT false,'신규 제보 승인 항목이 객체가 아닙니다. (new submission item must be an object)',ARRAY[]::uuid[]; RETURN; END IF;
  IF NOT v_payload_item ? 'item_id' OR NOT v_payload_item ? 'restaurant_data' OR (SELECT count(*) FROM jsonb_object_keys(v_payload_item))<>2 OR jsonb_typeof(v_payload_item->'item_id')<>'string' THEN RETURN QUERY SELECT false,'신규 제보 항목 ID 형식이 올바르지 않습니다. (new submission item id must be a UUID)',ARRAY[]::uuid[]; RETURN; END IF;
  v_item_id_text:=v_payload_item->>'item_id';
  IF v_item_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN QUERY SELECT false,'신규 제보 항목 ID 형식이 올바르지 않습니다. (new submission item id must be a UUID)',ARRAY[]::uuid[]; RETURN; END IF;
  v_item_id:=v_item_id_text::uuid;
  IF v_item_id::text<>v_item_id_text THEN RETURN QUERY SELECT false,'신규 제보 항목 ID 형식이 올바르지 않습니다. (new submission item id must be a UUID)',ARRAY[]::uuid[]; RETURN; END IF;
  v_supplied_ids:=array_append(v_supplied_ids,v_item_id);
 END LOOP;
 SELECT count(DISTINCT supplied.id) INTO v_distinct_count FROM unnest(v_supplied_ids) AS supplied(id);
 IF v_distinct_count<>cardinality(v_supplied_ids) THEN RETURN QUERY SELECT false,'신규 제보 항목 ID가 중복되었습니다. (new submission item ids must be unique)',ARRAY[]::uuid[]; RETURN; END IF;
 SELECT array_agg(supplied.id ORDER BY supplied.id) INTO v_supplied_ids FROM unnest(v_supplied_ids) AS supplied(id);
 PERFORM 1 FROM public.restaurant_submissions WHERE id=p_submission_id FOR UPDATE;
 SELECT array_agg(pending.id ORDER BY pending.id) INTO v_pending_ids FROM (SELECT id FROM public.restaurant_submission_items WHERE submission_id=p_submission_id AND item_status='pending' ORDER BY id FOR UPDATE) AS pending;
 IF v_pending_ids IS NULL OR v_supplied_ids<>v_pending_ids THEN RETURN QUERY SELECT false,'모든 대기 신규 제보 항목을 포함해야 합니다. (all pending new submission items are required)',ARRAY[]::uuid[]; RETURN; END IF;
 FOR v_item IN SELECT data.item_id, data.restaurant_data FROM jsonb_to_recordset(p_geocoded_data->'items') AS data(item_id uuid,restaurant_data jsonb) ORDER BY data.item_id LOOP
  SELECT * INTO v_result FROM public.approve_submission_item(v_item.item_id,p_admin_user_id,v_item.restaurant_data);
  IF NOT v_result.success THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE=v_result.message; END IF;
  v_ids:=array_append(v_ids,v_result.created_restaurant_id);
 END LOOP;
 RETURN QUERY SELECT true,'신규 맛집 제보가 승인되었습니다.',v_ids;
EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN QUERY SELECT false,SQLERRM,ARRAY[]::uuid[]; END; $$;
ALTER FUNCTION public.approve_new_restaurant_submission(uuid,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_new_restaurant_submission(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_new_restaurant_submission(uuid,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.insert_restaurant_from_jsonl(jsonl_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_id uuid; v_key text;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required' USING ERRCODE='42501'; END IF;
 IF jsonl_data IS NULL OR jsonb_typeof(jsonl_data)<>'object' THEN RAISE EXCEPTION 'jsonl record must be object' USING ERRCODE='22023'; END IF;
 SELECT key INTO v_key FROM jsonb_object_keys(jsonl_data) key WHERE key NOT IN ('trace_id','approved_name','phone','road_address','jibun_address','english_address','categories','lat','lng','address_elements','origin_address','youtube_meta','evaluation_results','recollect_version','status','geocoding_success','geocoding_false_stage','is_missing','is_not_selected','review_count','search_count','weekly_search_count','reasoning_basis','source_type','origin_name','naver_name','trace_id_name_source','channel_name','description_map_url','tzuyang_review','youtube_link') ORDER BY key LIMIT 1;
 IF v_key IS NOT NULL THEN RAISE EXCEPTION 'unsupported jsonl key: %',v_key USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(jsonl_data->'trace_id')<>'string' OR nullif(btrim(jsonl_data->>'trace_id'),'') IS NULL THEN RAISE EXCEPTION 'invalid jsonl field: trace_id' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(jsonl_data->'approved_name')<>'string' OR nullif(btrim(jsonl_data->>'approved_name'),'') IS NULL THEN RAISE EXCEPTION 'invalid jsonl field: approved_name' USING ERRCODE='22023'; END IF;
 INSERT INTO public.restaurants(trace_id,approved_name,phone,road_address,jibun_address,english_address,address_elements,lat,lng,status,updated_at)
 VALUES(btrim(jsonl_data->>'trace_id'),btrim(jsonl_data->>'approved_name'),jsonl_data->>'phone',jsonl_data->>'road_address',jsonl_data->>'jibun_address',jsonl_data->>'english_address',coalesce(jsonl_data->'address_elements','{}'::jsonb),(jsonl_data->>'lat')::numeric,(jsonl_data->>'lng')::numeric,coalesce(jsonl_data->>'status','pending'),now())
 ON CONFLICT ON CONSTRAINT restaurants_trace_id_key DO UPDATE SET approved_name=EXCLUDED.approved_name,phone=EXCLUDED.phone,road_address=EXCLUDED.road_address,jibun_address=EXCLUDED.jibun_address,english_address=EXCLUDED.english_address,address_elements=EXCLUDED.address_elements,lat=EXCLUDED.lat,lng=EXCLUDED.lng,status=EXCLUDED.status,updated_at=now() RETURNING id INTO v_id;
 RETURN v_id;
END; $$;
ALTER FUNCTION public.insert_restaurant_from_jsonl(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.insert_restaurant_from_jsonl(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_restaurant_from_jsonl(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.batch_insert_restaurants_from_jsonl(jsonl_array jsonb[])
RETURNS TABLE(inserted_count integer,updated_count integer,failed_count integer,failed_records jsonb[]) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE i integer; v_record jsonb; v_failed jsonb[]:=ARRAY[]::jsonb[]; v_inserted integer:=0; v_updated integer:=0; v_failed_count integer:=0;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required' USING ERRCODE='42501'; END IF;
 IF jsonl_array IS NULL OR cardinality(jsonl_array)=0 THEN RETURN QUERY SELECT 0,0,0,ARRAY[]::jsonb[]; RETURN; END IF;
 FOR i IN array_lower(jsonl_array,1)..array_upper(jsonl_array,1) LOOP
  v_record:=jsonl_array[i];
  BEGIN
   IF EXISTS(SELECT 1 FROM public.restaurants WHERE trace_id=btrim(v_record->>'trace_id')) THEN v_updated:=v_updated+1; ELSE v_inserted:=v_inserted+1; END IF;
   PERFORM public.insert_restaurant_from_jsonl(v_record);
  EXCEPTION WHEN OTHERS THEN v_inserted:=greatest(v_inserted-CASE WHEN NOT EXISTS(SELECT 1 FROM public.restaurants WHERE trace_id=btrim(v_record->>'trace_id')) THEN 1 ELSE 0 END,0); v_failed_count:=v_failed_count+1; v_failed:=array_append(v_failed,jsonb_build_object('index',i,'data',v_record,'error_code',SQLSTATE,'error',SQLERRM)); END;
 END LOOP;
 RETURN QUERY SELECT v_inserted,v_updated,v_failed_count,v_failed;
END; $$;
ALTER FUNCTION public.batch_insert_restaurants_from_jsonl(jsonb[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.batch_insert_restaurants_from_jsonl(jsonb[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_insert_restaurants_from_jsonl(jsonb[]) TO service_role;
-- G026 reviewed non-historical synthesized compatibility body.
-- approve_edit_restaurant_submission(uuid, uuid, uuid[]).
CREATE OR REPLACE FUNCTION public.approve_edit_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_approved_unique_ids uuid[]) RETURNS TABLE(success boolean, message text, updated_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_submission_record public.restaurant_submissions;
    v_restaurant_item JSONB;
    v_updated_count INTEGER := 0;
    v_total_count INTEGER := 0;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, 0;
        RETURN;
    END IF;

    -- 2. 제보 조회
    SELECT * INTO v_submission_record
    FROM public.restaurant_submissions
    WHERE id = p_submission_id
      AND submission_type = 'edit'
      AND status = 'pending';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '처리할 수정 요청이 없거나 이미 처리되었습니다.'::TEXT, 0;
        RETURN;
    END IF;

    -- 3. user_restaurants_submission 배열의 각 항목 처리
    SELECT jsonb_array_length(v_submission_record.user_restaurants_submission) INTO v_total_count;

    FOR v_restaurant_item IN SELECT * FROM jsonb_array_elements(v_submission_record.user_restaurants_submission)
    LOOP
        -- 관리자가 승인한 항목만 처리
        IF (v_restaurant_item->>'unique_id')::UUID = ANY(p_approved_unique_ids) THEN
            -- restaurants 테이블 업데이트
            UPDATE public.restaurants
            SET
                approved_name = COALESCE(v_restaurant_item->>'name', approved_name),
                categories = COALESCE(
                    ARRAY(SELECT jsonb_array_elements_text(v_restaurant_item->'categories')),
                    categories
                ),
                phone = COALESCE(v_restaurant_item->>'phone', phone),
                road_address = COALESCE(v_restaurant_item->>'address', road_address),
                youtube_link = COALESCE(v_restaurant_item->>'youtube_link', youtube_link),
                tzuyang_review = COALESCE(v_restaurant_item->>'tzuyang_review', tzuyang_review),
                source_type = 'user_submission_edit',
                updated_by_admin_id = p_admin_user_id,
                updated_at = now()
            WHERE trace_id = v_restaurant_item->>'unique_id';

            IF FOUND THEN
                v_updated_count := v_updated_count + 1;
            END IF;
        END IF;
    END LOOP;

    -- 4. 제보 상태 업데이트
    IF v_updated_count = v_total_count THEN
        -- 모두 승인
        UPDATE public.restaurant_submissions
        SET
            status = 'all_approved',
            resolved_by_admin_id = p_admin_user_id,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = p_submission_id;
    ELSIF v_updated_count > 0 THEN
        -- 부분 승인
        UPDATE public.restaurant_submissions
        SET
            status = 'partially_approved',
            resolved_by_admin_id = p_admin_user_id,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = p_submission_id;
    ELSE
        -- 모두 거부
        UPDATE public.restaurant_submissions
        SET
            status = 'all_deleted',
            resolved_by_admin_id = p_admin_user_id,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = p_submission_id;
    END IF;

    RETURN QUERY SELECT TRUE, format('수정 요청이 처리되었습니다. (승인: %s/%s)', v_updated_count, v_total_count)::TEXT, v_updated_count;
END;
$$;
ALTER FUNCTION public.approve_edit_restaurant_submission(uuid,uuid,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_edit_restaurant_submission(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_edit_restaurant_submission(uuid,uuid,uuid[]) TO service_role;
-- G026 reviewed non-historical synthesized compatibility body; approved_name substitutions are declared in the bundle allowlist.
CREATE OR REPLACE FUNCTION public.approve_restaurant_submission(submission_id uuid, admin_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    submission_record public.restaurant_submissions;
    is_admin BOOLEAN;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(admin_user_id) INTO is_admin;
    IF NOT is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 2. 처리할 제보 조회 (pending 상태, 관리자가 입력한 최종 데이터 기준)
    SELECT * INTO submission_record
    FROM public.restaurant_submissions
    WHERE id = submission_id AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION '처리할 제보가 없거나 이미 처리된 제보입니다.';
    END IF;

    -- 3. [관리자 검증] 필수 항목이 채워졌는지 확인 (지오코딩/수동입력 완료 여부)
    IF submission_record.name IS NULL OR
       submission_record.lat IS NULL OR
       submission_record.lng IS NULL OR
       submission_record.categories IS NULL OR
       (submission_record.road_address IS NULL AND submission_record.jibun_address IS NULL)
    THEN
        RAISE EXCEPTION '승인 실패: 필수 항목(이름, 좌표, 카테고리, 주소)이 누락되었습니다. 지오코딩 또는 수동 입력 후 승인하세요.';
    END IF;

    -- 4. 제보 유형에 따라 분기
    IF submission_record.submission_type = 'new' THEN

        -- 4-1. 신규 제보 승인 (INSERT into restaurants)
        INSERT INTO public.restaurants (
            approved_name, phone, categories,
            lat, lng, road_address, jibun_address, english_address, address_elements,
            status, -- 'approved'로 즉시 승인
            source_type, -- 'user_submission_new'
            created_by, -- 제보한 사용자 ID
            updated_by_admin_id -- 승인한 관리자 ID
        )
        VALUES (
            submission_record.name, submission_record.phone, submission_record.categories,
            submission_record.lat, submission_record.lng, submission_record.road_address,
            submission_record.jibun_address, submission_record.english_address, submission_record.address_elements,
            'approved',
            'user_submission_new', -- 요청하신 source_type
            submission_record.user_id,
            admin_user_id
        );

    ELSIF submission_record.submission_type = 'edit' THEN

        -- 4-2. 수정 제보 승인 (UPDATE restaurants)

        IF submission_record.restaurant_id IS NULL THEN
            RAISE EXCEPTION '승인 실패: 수정할 대상 맛집(restaurant_id)이 지정되지 않았습니다.';
        END IF;

        UPDATE public.restaurants r
        SET
            -- 관리자가 제보 테이블에 수정한 값으로 덮어쓰기
            -- (COALESCE 사용: 제보에 값이 있으면 그 값으로, 없으면(NULL) 기존 값 유지)
            approved_name = COALESCE(submission_record.name, r.approved_name),
            phone = COALESCE(submission_record.phone, r.phone),
            categories = COALESCE(submission_record.categories, r.categories),
            lat = COALESCE(submission_record.lat, r.lat),
            lng = COALESCE(submission_record.lng, r.lng),
            road_address = COALESCE(submission_record.road_address, r.road_address),
            jibun_address = COALESCE(submission_record.jibun_address, r.jibun_address),
            english_address = COALESCE(submission_record.english_address, r.english_address),
            address_elements = COALESCE(submission_record.address_elements, r.address_elements),

            status = 'approved', -- 'approved' 상태 보장
            source_type = 'user_submission_edit', -- 'modifying' 대신 'edit' 사용 (수정 가능)
            updated_by_admin_id = admin_user_id,
            updated_at = now()
        WHERE
            r.id = submission_record.restaurant_id;

        IF NOT FOUND THEN
             RAISE EXCEPTION '승인 실패: 수정할 대상 맛집(ID: %)을 찾을 수 없습니다.', submission_record.restaurant_id;
        END IF;

    END IF;

    -- 5. 제보 테이블 상태 'approved'로 변경
    UPDATE public.restaurant_submissions
    SET
        status = 'approved',
        resolved_by_admin_id = admin_user_id,
        updated_at = now()
    WHERE
        id = submission_id;

    RETURN TRUE;
END;
$$;
ALTER FUNCTION public.approve_restaurant_submission(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_restaurant_submission(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_restaurant_submission(uuid,uuid) TO service_role;

-- G026 source-provenanced non-historical compatibility shell: historical behavior is intentionally disabled.
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications(days_to_keep integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RAISE EXCEPTION 'cleanup_old_notifications is disabled; use the versioned retention workflow' USING ERRCODE='0A000';
END;
$$;
ALTER FUNCTION public.cleanup_old_notifications(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cleanup_old_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications(integer) TO service_role;

-- G026 source-provenanced non-historical compatibility shell: historical behavior is intentionally disabled.
CREATE OR REPLACE FUNCTION public.make_user_admin(target_email text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RAISE EXCEPTION 'make_user_admin is disabled; use apply_admin_user_db_mutation' USING ERRCODE='0A000';
END;
$$;
ALTER FUNCTION public.make_user_admin(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.make_user_admin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.make_user_admin(text) TO service_role;

-- G026 source-provenanced non-historical compatibility shell: source refresh semantics made transaction-safe.
CREATE OR REPLACE FUNCTION public.refresh_materialized_views() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW public.mv_restaurant_stats;
    REFRESH MATERIALIZED VIEW public.mv_user_leaderboard;
    REFRESH MATERIALIZED VIEW public.mv_popular_reviews;
END;
$$;
ALTER FUNCTION public.refresh_materialized_views() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_materialized_views() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_materialized_views() TO service_role;

-- G026 source-provenanced non-historical compatibility shell: historical behavior is intentionally disabled.
CREATE OR REPLACE FUNCTION public.reject_restaurant(restaurant_id uuid, admin_user_id uuid, reject_reason text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RAISE EXCEPTION 'legacy review is disabled; use the versioned review workflow' USING ERRCODE='0A000';
END;
$$;
ALTER FUNCTION public.reject_restaurant(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_restaurant(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_restaurant(uuid,uuid,text) TO service_role;

-- G026 source-provenanced non-historical compatibility shell: historical behavior is intentionally disabled.
CREATE OR REPLACE FUNCTION public.reject_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RAISE EXCEPTION 'legacy review is disabled; use the versioned review workflow' USING ERRCODE='0A000';
END;
$$;
ALTER FUNCTION public.reject_restaurant_submission(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_restaurant_submission(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_restaurant_submission(uuid,uuid,text) TO service_role;

-- G026 source-provenanced non-historical compatibility shell: historical behavior is intentionally disabled.
CREATE OR REPLACE FUNCTION public.reject_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RAISE EXCEPTION 'legacy review is disabled; use the versioned review workflow' USING ERRCODE='0A000';
END;
$$;
ALTER FUNCTION public.reject_submission(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_submission(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_submission(uuid,uuid,text) TO service_role;

-- G026 source-provenanced non-historical compatibility shell: historical behavior is intentionally disabled.
CREATE OR REPLACE FUNCTION public.reject_submission_item(p_item_id uuid, p_admin_user_id uuid, p_rejection_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RAISE EXCEPTION 'legacy review is disabled; use the versioned review workflow' USING ERRCODE='0A000';
END;
$$;
ALTER FUNCTION public.reject_submission_item(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_submission_item(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_submission_item(uuid,uuid,text) TO service_role;
