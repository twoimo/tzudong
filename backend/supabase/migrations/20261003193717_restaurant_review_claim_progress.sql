-- Six sequential 480-second commands allow 48 minutes; a 60-minute lease covers
-- that unchanged execution budget and the bounded control RPCs.
BEGIN;
CREATE OR REPLACE FUNCTION public.restaurant_review_automation_worker(action text,item_id uuid,token uuid,result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; item pipeline_control.restaurant_review_items;
  restaurant public.restaurants; fields text[]:=ARRAY['evaluation_results','geocoding_success','geocoding_false_stage','lat','lng','road_address','jibun_address','english_address','address_elements','naver_name','google_name','categories'];
BEGIN
  IF token IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
  IF NOT policy.enabled THEN RETURN jsonb_build_object('disabled',true); END IF;
  PERFORM pipeline_control.assert_restaurant_review_operator(policy.operator_id);
  IF action='claim' THEN
    -- Expired provider work becomes uncertain, never silently dispatched again.
    UPDATE pipeline_control.restaurant_review_items SET state='failed',reason='worker_lease_expired',finished_at=now()
      WHERE state='running' AND lease_until<now();
    IF EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE state='running') THEN RETURN NULL; END IF;
    -- Bounded cleanup is separate from eligibility: any number of stale entries
    -- cannot hide an eligible item behind them. The provider is still called once.
    UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='source_changed',finished_at=now()
    WHERE id IN (
      SELECT queued.id FROM pipeline_control.restaurant_review_items queued
      LEFT JOIN public.restaurants candidate ON candidate.id=queued.restaurant_id
      WHERE queued.state='queued' AND (candidate.id IS NULL OR candidate.status<>'pending'
        OR candidate.updated_by_admin_id IS NOT NULL
        OR pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))<>queued.fingerprint)
      ORDER BY queued.created_at,queued.id LIMIT 200
    );
    SELECT queued.* INTO item FROM pipeline_control.restaurant_review_items queued
    JOIN public.restaurants candidate ON candidate.id=queued.restaurant_id
    WHERE queued.state='queued' AND candidate.status='pending' AND candidate.updated_by_admin_id IS NULL
      AND pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))=queued.fingerprint
    ORDER BY queued.created_at,queued.id LIMIT 1 FOR UPDATE OF queued,candidate SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE pipeline_control.restaurant_review_items SET state='running',worker_token=token,lease_until=now()+interval '60 minutes' WHERE id=item.id;
    SELECT * INTO restaurant FROM public.restaurants WHERE id=item.restaurant_id;
    IF NOT FOUND OR pipeline_control.restaurant_review_fingerprint(to_jsonb(restaurant))<>item.fingerprint
      OR restaurant.updated_by_admin_id IS NOT NULL OR restaurant.status<>'pending' THEN
      UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='source_changed',finished_at=now() WHERE id=item.id;
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('id',item.id,'restaurant',to_jsonb(restaurant));
  END IF;
  SELECT * INTO item FROM pipeline_control.restaurant_review_items WHERE id=item_id FOR UPDATE;
  IF NOT FOUND OR item.worker_token IS DISTINCT FROM token THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
  IF item.state IN ('succeeded','failed','cancelled') THEN RETURN jsonb_build_object('state',item.state); END IF;
  IF item.state<>'running' OR item.lease_until<now() THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
  IF action='fail' THEN
    IF result->>'code' NOT IN ('source_unavailable','evaluation_failed','evaluation_incomplete','worker_timeout','result_invalid')
      OR result->>'code' IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
    UPDATE pipeline_control.restaurant_review_items SET state='failed',reason=result->>'code',finished_at=now() WHERE id=item.id;
    RETURN jsonb_build_object('state','failed');
  ELSIF action<>'complete' OR jsonb_typeof(result) IS DISTINCT FROM 'object' OR octet_length(result::text)>131072
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(result) key WHERE NOT key=ANY(fields)) THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
  SELECT * INTO restaurant FROM public.restaurants WHERE id=item.restaurant_id FOR UPDATE;
  IF NOT FOUND OR pipeline_control.restaurant_review_fingerprint(to_jsonb(restaurant))<>item.fingerprint
    OR restaurant.updated_by_admin_id IS NOT NULL OR restaurant.status<>'pending' THEN
    UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='source_changed',finished_at=now() WHERE id=item.id;
    RETURN jsonb_build_object('state','cancelled');
  END IF;
  IF jsonb_typeof(result->'evaluation_results') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
  -- Populate only allowlisted fields, keeping all identifiers, reviews and admin data.
  restaurant:=jsonb_populate_record(restaurant,result);
  UPDATE public.restaurants SET evaluation_results=restaurant.evaluation_results,geocoding_success=restaurant.geocoding_success,
    geocoding_false_stage=restaurant.geocoding_false_stage,lat=restaurant.lat,lng=restaurant.lng,road_address=restaurant.road_address,
    jibun_address=restaurant.jibun_address,english_address=restaurant.english_address,address_elements=restaurant.address_elements,
    naver_name=restaurant.naver_name,google_name=restaurant.google_name,categories=restaurant.categories,updated_at=now() WHERE id=item.restaurant_id;
  IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=item.restaurant_id AND evaluation_results=restaurant.evaluation_results)
    THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
  UPDATE pipeline_control.restaurant_review_items SET state='succeeded',finished_at=now() WHERE id=item.id;
  RETURN jsonb_build_object('state','succeeded');
END;
$$;
ALTER FUNCTION public.restaurant_review_automation_worker(text,uuid,uuid,jsonb) SET lock_timeout='2s';
COMMIT;
