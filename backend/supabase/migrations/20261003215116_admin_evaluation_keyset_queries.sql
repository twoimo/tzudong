-- DB-side query descriptors and bounded keyset reads. Read-only projections
-- are never used as approval authority; full current rows remain authoritative.
BEGIN;
CREATE FUNCTION pipeline_control.admin_eval_js_trim(value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT btrim(value,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
CREATE FUNCTION pipeline_control.admin_eval_filter_number(value text,allow_fraction boolean)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE text_value text:=pipeline_control.admin_eval_js_trim(value); digits text; numeric_value numeric:=0; sign_value integer:=1; position integer; digit integer;
BEGIN
 IF allow_fraction THEN
  digits:=substring(text_value FROM '^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)');
 ELSIF text_value ~ '^[+-]?0[xX]' THEN
  IF left(text_value,1)='-' THEN sign_value:=-1; END IF;
  digits:=substring(text_value FROM '^[+-]?0[xX]([0-9a-fA-F]+)');
  IF digits IS NULL THEN RETURN NULL; END IF;
  FOR position IN 1..length(digits) LOOP
   digit:=strpos('0123456789abcdef',lower(substr(digits,position,1)))-1;
   numeric_value:=numeric_value*16+digit;
  END LOOP;
  RETURN (sign_value*numeric_value)::double precision;
 ELSE digits:=substring(text_value FROM '^([+-]?[0-9]+)');
 END IF;
 IF digits IS NULL THEN RETURN NULL; END IF;
 RETURN digits::double precision;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END;
$$;
CREATE FUNCTION pipeline_control.admin_eval_valid_meta(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND jsonb_typeof(value->'ads_info')='object'
  AND jsonb_typeof(value->'title')='string' AND jsonb_typeof(value->'publishedAt')='string'
  AND jsonb_typeof(value->'is_shorts')='boolean' AND jsonb_typeof(value->'duration')='number'
  AND jsonb_typeof(value#>'{ads_info,is_ads}')='boolean'
  AND jsonb_typeof(value#>'{ads_info,what_ads}') IN ('string','null'),false);
$$;
CREATE FUNCTION pipeline_control.admin_eval_epoch(value text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' SET timezone='UTC' SET datestyle='ISO, MDY' AS $$
DECLARE parsed numeric;
BEGIN
 IF value IS NULL OR btrim(value)='' THEN RETURN 0; END IF;
 -- Relative/special Postgres timestamps are not dates in Date.parse and would
 -- make an IMMUTABLE projection depend on the time of the write.
 IF value ~* '\m(now|today|tomorrow|yesterday|infinity|epoch)\M' THEN RETURN 0; END IF;
 parsed:=trunc(extract(epoch FROM value::timestamptz)*1000);
 IF parsed NOT BETWEEN -8640000000000000 AND 8640000000000000 THEN RETURN 0; END IF;
 RETURN parsed;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN 0;
END;
$$;
CREATE FUNCTION pipeline_control.admin_eval_video_id(value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(substring(value FROM '[?&]v=([A-Za-z0-9_-]{6,})'),
 substring(value FROM 'youtu\.be/([A-Za-z0-9_-]{6,})'),
 substring(value FROM 'youtube\.com/shorts/([A-Za-z0-9_-]{6,})'),
 substring(value FROM 'youtube\.com/embed/([A-Za-z0-9_-]{6,})'),
 substring(value FROM 'youtube\.com/live/([A-Za-z0-9_-]{6,})'));
$$;
CREATE FUNCTION pipeline_control.admin_eval_address_status(value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE flags jsonb:=pipeline_control.admin_eval_flags(value); metrics jsonb:=pipeline_control.admin_eval_metrics(value->'evaluation_results');
 location jsonb:=metrics->'location_match_TF'; details jsonb:=value->'db_error_details'; review jsonb;
 status text:=flags->>'status'; reason text:=location->>'pending_reason'; geo boolean:=coalesce(value->'geocoding_success'='true'::jsonb,false);
 origin text; candidate text; a text; b text; score numeric; label text; families text[]:='{}'; texts text[]; item text;
BEGIN
 IF status IN ('deleted','not_selected','missing') OR value->'is_missing'='true'::jsonb OR value->'is_not_selected'='true'::jsonb THEN RETURN 'not_applicable'; END IF;
 IF reason IN ('ambiguous_chain','multi_candidate') OR (geo AND reason='insufficient_evidence') THEN RETURN 'review'; END IF;
 IF geo THEN RETURN 'true'; END IF;
 IF jsonb_typeof(value->'geocoding_false_stage') IS DISTINCT FROM 'number' THEN RETURN 'failed'; END IF;
 IF jsonb_typeof(details)='object' AND jsonb_typeof(details->'address_consistency_review')='object' THEN review:=details->'address_consistency_review'; END IF;
 IF jsonb_typeof(review->'ahp_score')='number' THEN score:=least(100,greatest(0,(review->>'ahp_score')::numeric)); END IF;
 label:=CASE WHEN btrim(review->>'ahp_label') IN ('정정 승인 후보','주소 후보 검토','재수집 필요','영업상태 확인','원천 품질 문제','AHP 미산정') THEN btrim(review->>'ahp_label') ELSE CASE WHEN score>=98 THEN '정정 승인 후보' ELSE '' END END;
 origin:=coalesce(nullif(btrim(value->>'origin_name'),''),pipeline_control.admin_eval_display_name(value));
 candidate:=coalesce(nullif(btrim(value->>'approved_name'),''),nullif(btrim(value->>'naver_name'),''),nullif(btrim(value->>'google_name'),''),nullif(btrim(location->>'matched_name'),''),nullif(btrim(location->>'naver_name'),''),nullif(btrim(location->>'google_name'),''));
 a:=pipeline_control.admin_eval_name_key(origin);b:=pipeline_control.admin_eval_name_key(candidate);
 IF jsonb_typeof(review->'evidence_families')='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(review->'evidence_families')='array' THEN review->'evidence_families' ELSE '[]'::jsonb END) v WHERE jsonb_typeof(v)<>'string') THEN
  SELECT array_agg(v) INTO families FROM jsonb_array_elements_text(review->'evidence_families') v WHERE btrim(v)<>'';
 END IF;
 SELECT coalesce(families,'{}')||coalesce(array_agg(v),'{}') INTO families FROM jsonb_array_elements_text(coalesce(location->'evidence_families','[]')) v WHERE btrim(v)<>'';
 texts:=ARRAY[CASE WHEN pipeline_control.admin_eval_valid_meta(value->'youtube_meta') THEN value#>>'{youtube_meta,title}' END,
 value->>'reasoning_basis',value->>'description_map_url',value->>'trace_id_name_source',value->>'db_error_message',review->>'reason_ko',location->>'falseMessage'];
 SELECT texts||coalesce(array_agg(v),'{}') INTO texts FROM jsonb_array_elements_text(coalesce(location->'evidence_summary','[]')) v;
 IF score>=98 AND label='정정 승인 후보' AND nullif(value->>'updated_by_admin_id','') IS NULL
  AND status<>'db_conflict' AND details->>'error_type' IS DISTINCT FROM 'duplicate'
  AND NOT coalesce((jsonb_typeof(details->'conflicting_restaurant')='object' AND jsonb_typeof(details#>'{conflicting_restaurant,id}')='string' AND jsonb_typeof(details#>'{conflicting_restaurant,name}')='string' AND jsonb_typeof(details#>'{conflicting_restaurant,jibun_address}')='string' AND (NOT (details->'conflicting_restaurant') ? 'road_address' OR jsonb_typeof(details#>'{conflicting_restaurant,road_address}')='string')),false)
  AND NOT coalesce((jsonb_typeof(details->'similarity_score')='number' AND (details->>'similarity_score')::numeric>=0.85),false)
  AND coalesce(reason NOT IN ('cross_country_mismatch','ambiguous_chain','multi_candidate'),true)
  AND (a='' OR b='' OR a=b OR (length(a)>=3 AND strpos(b,a)>0) OR (length(b)>=3 AND strpos(a,b)>0))
  AND 'provider_candidate'=ANY(families) AND families && ARRAY['source_geo','cross_provider','browser_verification']
  AND NOT EXISTS(SELECT 1 FROM unnest(texts) v WHERE v ~ '폐업|휴업|영업\s*종료|이전|상호\s*변경|구상호|옛\s*상호') THEN RETURN 'candidate'; END IF;
 IF nullif(review->>'queue','') IS NOT NULL THEN RETURN 'review'; END IF;
 RETURN 'false';
END;
$$;

CREATE FUNCTION pipeline_control.admin_eval_descriptor(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE display text:=pipeline_control.admin_eval_display_name(value); flags jsonb:=pipeline_control.admin_eval_flags(value);
 metrics jsonb:=pipeline_control.admin_eval_metrics(value->'evaluation_results'); vals jsonb:='{}'; key text; title text;
 latest numeric; created numeric:=pipeline_control.admin_eval_epoch(value->>'created_at'); reason text; not_reason text;
BEGIN
 IF pipeline_control.admin_eval_valid_meta(value->'youtube_meta') THEN title:=value#>>'{youtube_meta,title}'; END IF;
 latest:=CASE WHEN pipeline_control.admin_eval_valid_meta(value->'youtube_meta') AND btrim(value#>>'{youtube_meta,publishedAt}')<>'' THEN pipeline_control.admin_eval_epoch(value#>>'{youtube_meta,publishedAt}') ELSE created END;
 FOREACH key IN ARRAY ARRAY['visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF','category_TF','category_validity_TF'] LOOP
  vals:=vals||jsonb_build_object(key,metrics#>ARRAY[key,'eval_value']);
 END LOOP;
 IF metrics->'location_match_TF' IS NOT NULL AND metrics->'location_match_TF'<>'null'::jsonb AND metrics#>'{location_match_TF,eval_value}' IS DISTINCT FROM 'true'::jsonb THEN
  reason:=CASE WHEN btrim(metrics#>>'{location_match_TF,falseMessage}')<>'' THEN metrics#>>'{location_match_TF,falseMessage}'
    WHEN btrim(metrics#>>'{location_match_TF,pending_reason}')<>'' THEN 'location_match pending ('||(metrics#>>'{location_match_TF,pending_reason}')||')'
    ELSE 'location_match 실패(사유 없음)' END;
 END IF;
 not_reason:=CASE WHEN value->'is_not_selected' IS DISTINCT FROM 'true'::jsonb THEN '평가 미대상(기타)'
  WHEN value->'is_missing'='true'::jsonb THEN '평가 미대상(missing target)'
  WHEN value->'geocoding_false_stage'='0'::jsonb THEN '평가 미대상(address null 등)'
  WHEN value->'geocoding_false_stage'='1'::jsonb THEN '평가 미대상(지오코딩 1단계 실패)'
  WHEN value->'geocoding_false_stage'='2'::jsonb THEN '평가 미대상(지오코딩 2단계 실패)'
  WHEN value->'geocoding_success' IS DISTINCT FROM 'true'::jsonb THEN '평가 미대상(지오코딩 실패)' ELSE '평가 미대상(기타)' END;
 RETURN jsonb_build_object('flags',flags,'metrics',vals,'address',pipeline_control.admin_eval_address_status(value),
  'latest',latest,'created',created,'video',pipeline_control.admin_eval_video_id(value->>'youtube_link'),
  'search',jsonb_build_array(coalesce(nullif(btrim(title),''),CASE WHEN display<>'이름 없음' THEN display ELSE '영상 제목 없음' END),
    display,value->>'origin_name',value->>'approved_name',value->>'naver_name',value->>'youtube_link'),
  'notSelection',coalesce(value->'is_not_selected'='true'::jsonb,false),'notReason',not_reason,'ruleReason',reason,
  'laajGap',(coalesce(metrics->'category_validity_TF','null')<>'null'::jsonb OR coalesce(metrics->'location_match_TF','null')<>'null'::jsonb)
    AND coalesce(metrics->'visit_authenticity','null')='null'::jsonb AND coalesce(metrics->'rb_inference_score','null')='null'::jsonb
    AND coalesce(metrics->'rb_grounding_TF','null')='null'::jsonb AND coalesce(metrics->'review_faithfulness_score','null')='null'::jsonb AND coalesce(metrics->'category_TF','null')='null'::jsonb);
END;
$$;

CREATE TABLE pipeline_control.admin_evaluation_read_index (
 id uuid PRIMARY KEY,
 descriptor jsonb NOT NULL,
 latest numeric NOT NULL,
 created numeric NOT NULL,
 video text
);
ALTER TABLE pipeline_control.admin_evaluation_read_index ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.admin_evaluation_read_index FROM PUBLIC,anon,authenticated;
GRANT SELECT ON pipeline_control.admin_evaluation_read_index TO service_role;
CREATE INDEX admin_evaluation_read_keyset ON pipeline_control.admin_evaluation_read_index(latest DESC,created DESC,id DESC);
CREATE INDEX admin_evaluation_read_video ON pipeline_control.admin_evaluation_read_index(video,created DESC,id);

CREATE FUNCTION pipeline_control.update_admin_eval_read_index()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb;
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM pipeline_control.admin_evaluation_read_index WHERE id=OLD.id;RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN DELETE FROM pipeline_control.admin_evaluation_read_index WHERE id=OLD.id; END IF;
 d:=pipeline_control.admin_eval_descriptor(to_jsonb(NEW)||jsonb_build_object('name',NEW.approved_name));
 INSERT INTO pipeline_control.admin_evaluation_read_index(id,descriptor,latest,created,video)
 VALUES(NEW.id,d,(d->>'latest')::numeric,(d->>'created')::numeric,d->>'video')
 ON CONFLICT(id) DO UPDATE SET descriptor=EXCLUDED.descriptor,latest=EXCLUDED.latest,created=EXCLUDED.created,video=EXCLUDED.video;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.update_admin_eval_read_index() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER admin_eval_read_index_row AFTER INSERT OR UPDATE OF id,approved_name,origin_name,naver_name,google_name,
 status,geocoding_success,geocoding_false_stage,is_missing,is_not_selected,youtube_link,youtube_meta,created_at,
 updated_by_admin_id,db_error_details,db_error_message,reasoning_basis,description_map_url,trace_id_name_source,evaluation_results
 OR DELETE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION pipeline_control.update_admin_eval_read_index();

CREATE FUNCTION pipeline_control.clear_admin_eval_read_index()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN DELETE FROM pipeline_control.admin_evaluation_read_index;RETURN NULL;END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.clear_admin_eval_read_index() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER admin_eval_read_index_truncate AFTER TRUNCATE ON public.restaurants
 FOR EACH STATEMENT EXECUTE FUNCTION pipeline_control.clear_admin_eval_read_index();

INSERT INTO pipeline_control.admin_evaluation_read_index(id,descriptor,latest,created,video)
 SELECT id,d,(d->>'latest')::numeric,(d->>'created')::numeric,d->>'video'
 FROM public.restaurants r CROSS JOIN LATERAL(SELECT pipeline_control.admin_eval_descriptor(to_jsonb(r)||jsonb_build_object('name',r.approved_name)) d) computed;

CREATE FUNCTION pipeline_control.admin_eval_matches(d jsonb,q jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE f jsonb:=q->'evalFilters'; deep jsonb:=q->'deepLinkFilter'; needle text:=lower(pipeline_control.admin_eval_js_trim(coalesce(q->>'searchQuery','')));
 status text:=f->>'status'; key text; wanted text; number_value double precision;
BEGIN
 IF needle<>'' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'search') text_value WHERE strpos(lower(text_value),needle)>0) THEN RETURN false; END IF;
 IF status IS NOT NULL AND status<>'' THEN
  IF status IN ('missing','not_selected','ready_for_approval','unconfirmed_map') THEN
   IF d#>ARRAY['flags',status] IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  ELSIF d#>>'{flags,status}' IS DISTINCT FROM status THEN RETURN false; END IF;
 END IF;
 FOREACH key IN ARRAY ARRAY['visit_authenticity','rb_inference_score','review_faithfulness_score'] LOOP
  wanted:=f->>key;
  IF wanted IS NULL OR wanted='' THEN CONTINUE; END IF;
  number_value:=pipeline_control.admin_eval_filter_number(wanted,key='review_faithfulness_score');
  IF number_value IS NULL THEN RETURN false; END IF;
  BEGIN
   IF (d#>>ARRAY['metrics',key])::double precision IS DISTINCT FROM number_value THEN RETURN false; END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false; END;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['rb_grounding_TF','category_validity_TF','category_TF'] LOOP
  wanted:=f->>key;
  IF wanted IS NOT NULL AND wanted<>'' AND d#>ARRAY['metrics',key] IS DISTINCT FROM to_jsonb(wanted='True') THEN RETURN false; END IF;
 END LOOP;
 wanted:=f->>'geocoding_success';
 IF wanted='true' AND d->>'address'<>'true' THEN RETURN false; END IF;
 IF wanted='false_match' AND d->>'address'<>'false' THEN RETURN false; END IF;
 IF wanted='false_geocode' AND d->>'address'<>'failed' THEN RETURN false; END IF;
 IF wanted='review' AND d->>'address' NOT IN ('review','candidate') THEN RETURN false; END IF;
 IF coalesce(deep->>'videoId','')<>'' AND d->>'video' IS DISTINCT FROM deep->>'videoId' THEN RETURN false; END IF;
 IF deep->>'issue'='notSelection' THEN
  IF d->'notSelection' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  IF coalesce(deep->>'reason','')<>'' AND d->>'notReason' IS DISTINCT FROM deep->>'reason' THEN RETURN false; END IF;
 ELSIF deep->>'issue'='ruleFalse' THEN
  IF d->>'ruleReason' IS NULL OR d->>'ruleReason'='' THEN RETURN false; END IF;
  IF coalesce(deep->>'reason','')<>'' AND d->>'ruleReason' IS DISTINCT FROM deep->>'reason' THEN RETURN false; END IF;
 ELSIF deep->>'issue'='laajGap' AND d->'laajGap' IS DISTINCT FROM 'true'::jsonb THEN RETURN false;
 END IF;
 RETURN true;
END;
$$;

CREATE FUNCTION pipeline_control.admin_eval_row(r public.restaurants)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object(
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
 );
$$;
REVOKE ALL ON FUNCTION pipeline_control.admin_eval_row(public.restaurants) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_eval_row(public.restaurants) TO service_role;

CREATE FUNCTION public.admin_evaluation_page(page_query jsonb,page_size integer,after_id uuid,expected_revision text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE revision text; anchor pipeline_control.admin_evaluation_read_index; ids uuid[]; result jsonb; stats jsonb; total bigint; payload_size bigint;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 200 OR jsonb_typeof(page_query) IS DISTINCT FROM 'object'
  OR octet_length(page_query::text)>8192 THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 IF jsonb_typeof(page_query->'evalFilters') IS DISTINCT FROM 'object'
  OR jsonb_typeof(page_query->'searchQuery') IS DISTINCT FROM 'string'
  OR length(page_query->>'searchQuery')>1024
  OR (page_query->'deepLinkFilter' IS NOT NULL AND page_query->'deepLinkFilter'<>'null'::jsonb AND jsonb_typeof(page_query->'deepLinkFilter') IS DISTINCT FROM 'object')
  THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(page_query) key WHERE key NOT IN ('searchQuery','evalFilters','deepLinkFilter'))
  OR EXISTS(SELECT 1 FROM jsonb_each(page_query->'evalFilters') field WHERE field.key NOT IN
    ('status','visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF','category_validity_TF','category_TF','geocoding_success') OR jsonb_typeof(field.value)<>'string')
  THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 IF jsonb_typeof(page_query->'deepLinkFilter')='object' AND EXISTS(SELECT 1 FROM jsonb_each(page_query->'deepLinkFilter') field
  WHERE field.key NOT IN ('videoId','issue','reason') OR jsonb_typeof(field.value)<>'string') THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 revision:=public.admin_evaluation_revision();
 IF expected_revision IS NOT NULL AND expected_revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'EVALUATION_CURSOR_STALE'; END IF;
 IF after_id IS NOT NULL THEN
  SELECT * INTO anchor FROM pipeline_control.admin_evaluation_read_index WHERE id=after_id;
  IF NOT FOUND OR NOT pipeline_control.admin_eval_matches(anchor.descriptor,page_query) THEN RAISE EXCEPTION 'EVALUATION_CURSOR_STALE'; END IF;
 END IF;
 SELECT jsonb_build_object('total',count(*),'pending',count(*) FILTER(WHERE descriptor#>>'{flags,status}'='pending'),
  'approved',count(*) FILTER(WHERE descriptor#>>'{flags,status}'='approved'),'hold',count(*) FILTER(WHERE descriptor#>>'{flags,status}'='hold'),
  'deleted',count(*) FILTER(WHERE descriptor#>>'{flags,status}'='deleted'),'db_conflict',count(*) FILTER(WHERE descriptor#>>'{flags,status}'='db_conflict'),
  'missing',count(*) FILTER(WHERE descriptor#>'{flags,missing}'='true'::jsonb),'not_selected',count(*) FILTER(WHERE descriptor#>'{flags,not_selected}'='true'::jsonb),
  'ready_for_approval',count(*) FILTER(WHERE descriptor#>'{flags,ready_for_approval}'='true'::jsonb),
  'unconfirmed_map',count(*) FILTER(WHERE descriptor#>'{flags,unconfirmed_map}'='true'::jsonb)) INTO stats FROM pipeline_control.admin_evaluation_read_index;
 IF (stats->>'total')::bigint>50000 THEN RAISE EXCEPTION 'EVALUATION_CATALOG_CAPACITY_EXCEEDED'; END IF;
 SELECT count(*) INTO total FROM pipeline_control.admin_evaluation_read_index WHERE pipeline_control.admin_eval_matches(descriptor,page_query);
 SELECT coalesce(array_agg(id ORDER BY latest DESC,created DESC,id DESC),'{}') INTO ids FROM (
  SELECT * FROM pipeline_control.admin_evaluation_read_index WHERE pipeline_control.admin_eval_matches(descriptor,page_query)
    AND (after_id IS NULL OR (latest,created,id)<(anchor.latest,anchor.created,anchor.id))
  ORDER BY latest DESC,created DESC,id DESC LIMIT page_size+1
 ) selected;
 SELECT coalesce(sum(octet_length(pipeline_control.admin_eval_row(r)::text)+2),0)+1024 INTO payload_size FROM public.restaurants r WHERE id=ANY(ids[1:page_size]);
 IF payload_size>33554432 THEN RAISE EXCEPTION 'EVALUATION_CATALOG_CAPACITY_EXCEEDED'; END IF;
 SELECT coalesce(jsonb_agg(pipeline_control.admin_eval_row(r) ORDER BY idx.latest DESC,idx.created DESC,idx.id DESC),'[]') INTO result
  FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index idx ON idx.id=r.id WHERE r.id=ANY(ids[1:page_size]);
 RETURN jsonb_build_object('records',result,'revision',revision,'stats',stats,'filteredTotal',total,
  'hasMore',cardinality(ids)>page_size,'afterId',CASE WHEN cardinality(ids)>page_size THEN ids[page_size] END);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_page(jsonb,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_page(jsonb,integer,uuid,text) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
 SELECT n.nspname,p.proname,p.proargtypes::text,'service_role'::name,'public.admin_evaluation_page(jsonb,integer,uuid,text)'
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid='public.admin_evaluation_page(jsonb,integer,uuid,text)'::regprocedure;

CREATE VIEW public.admin_evaluation_related_rows WITH(security_invoker=true) AS
 SELECT r.id,r.approved_name,r.origin_name,r.naver_name,r.google_name,r.phone,r.status,r.road_address,r.jibun_address,
  r.youtube_link,r.updated_by_admin_id,r.lat,r.lng,r.created_at,idx.video AS video_id,
  jsonb_build_object('location_match_TF',jsonb_build_object('eval_value',r.evaluation_results#>'{location_match_TF,eval_value}',
    'match_status',r.evaluation_results#>'{location_match_TF,match_status}','naver_name',r.evaluation_results#>'{location_match_TF,naver_name}',
    'matched_provider',r.evaluation_results#>'{location_match_TF,matched_provider}','matched_name',r.evaluation_results#>'{location_match_TF,matched_name}')) AS evaluation_results,
  r.approved_name AS name
 FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index idx ON idx.id=r.id;
REVOKE ALL ON public.admin_evaluation_related_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.admin_evaluation_related_rows TO service_role;
REVOKE ALL ON FUNCTION pipeline_control.admin_eval_valid_meta(jsonb),pipeline_control.admin_eval_epoch(text),
 pipeline_control.admin_eval_js_trim(text),pipeline_control.admin_eval_filter_number(text,boolean),
 pipeline_control.admin_eval_video_id(text),pipeline_control.admin_eval_address_status(jsonb),pipeline_control.admin_eval_descriptor(jsonb),
 pipeline_control.admin_eval_matches(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_eval_valid_meta(jsonb),pipeline_control.admin_eval_epoch(text),
 pipeline_control.admin_eval_js_trim(text),pipeline_control.admin_eval_filter_number(text,boolean),
 pipeline_control.admin_eval_video_id(text),pipeline_control.admin_eval_address_status(jsonb),pipeline_control.admin_eval_descriptor(jsonb),
 pipeline_control.admin_eval_matches(jsonb,jsonb) TO service_role;
COMMIT;
