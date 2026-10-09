-- Private read normalization mirrors the existing TypeScript consumer contract.
-- It does not update restaurants or turn summaries into approval authority.
BEGIN;
CREATE FUNCTION pipeline_control.admin_eval_metrics(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb:='{}'; metric jsonb; normalized jsonb; key text; field text; kind text;
  location jsonb; nested jsonb; fields jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  FOREACH key IN ARRAY ARRAY['visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF','category_TF','category_validity_TF'] LOOP
    metric:=value->key; normalized:='null';
    kind:=CASE WHEN key IN ('visit_authenticity','rb_inference_score','review_faithfulness_score') THEN 'number' ELSE 'boolean' END;
    IF jsonb_typeof(metric)='object' AND jsonb_typeof(metric->'eval_value')=kind
      AND (key<>'category_TF' OR (
        (NOT metric ? 'category_revision' OR jsonb_typeof(metric->'category_revision') IN ('string','null'))
        AND (NOT metric ? 'eval_basis' OR jsonb_typeof(metric->'eval_basis')='string'))) THEN
      normalized:=jsonb_build_object('name',CASE WHEN jsonb_typeof(metric->'name')='string' THEN metric->>'name' ELSE '' END,'eval_value',metric->'eval_value');
      IF key IN ('visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF') THEN
        normalized:=normalized||jsonb_build_object('eval_basis',CASE WHEN jsonb_typeof(metric->'eval_basis')='string' THEN metric->>'eval_basis' ELSE '' END);
      ELSIF key='category_TF' THEN
        normalized:=normalized||jsonb_build_object('category_revision',CASE WHEN jsonb_typeof(metric->'category_revision') IN ('string','null') THEN metric->'category_revision' ELSE 'null'::jsonb END);
        IF jsonb_typeof(metric->'eval_basis')='string' THEN normalized:=normalized||jsonb_build_object('eval_basis',metric->'eval_basis'); END IF;
      END IF;
    END IF;
    result:=result||jsonb_build_object(key,normalized);
  END LOOP;
  location:=value->'location_match_TF'; normalized:='null';
  IF jsonb_typeof(location)='object' THEN
    normalized:='{}';
    FOREACH field IN ARRAY ARRAY['name','origin_address'] LOOP
      IF jsonb_typeof(location->field)='string' THEN normalized:=normalized||jsonb_build_object(field,location->field); END IF;
    END LOOP;
    FOREACH field IN ARRAY ARRAY['origin_name','matched_name','naver_name','google_name','falseMessage'] LOOP
      IF jsonb_typeof(location->field) IN ('string','null') THEN normalized:=normalized||jsonb_build_object(field,location->field); END IF;
    END LOOP;
    IF jsonb_typeof(location->'eval_value')='boolean' THEN normalized:=normalized||jsonb_build_object('eval_value',location->'eval_value'); END IF;
    IF location->>'match_status' IN ('matched','pending','failed') THEN normalized:=normalized||jsonb_build_object('match_status',location->'match_status'); END IF;
    IF location->>'matched_provider' IN ('naver','google','playwright','gemini','ncp_geocode') OR location->'matched_provider'='null'::jsonb THEN normalized:=normalized||jsonb_build_object('matched_provider',location->'matched_provider'); END IF;
    IF location->>'pending_reason' IN ('insufficient_evidence','cross_country_mismatch','ambiguous_chain','multi_candidate','timeout','rate_limited') OR location->'pending_reason'='null'::jsonb THEN normalized:=normalized||jsonb_build_object('pending_reason',location->'pending_reason'); END IF;
    IF jsonb_typeof(location->'evidence_summary')='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(location->'evidence_summary')='array' THEN location->'evidence_summary' ELSE '[]'::jsonb END) item WHERE jsonb_typeof(item)<>'string') THEN normalized:=normalized||jsonb_build_object('evidence_summary',location->'evidence_summary'); END IF;
    IF jsonb_typeof(location->'evidence_families')='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(location->'evidence_families')='array' THEN location->'evidence_families' ELSE '[]'::jsonb END) item WHERE jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('provider_candidate','source_geo','cross_provider','browser_verification','llm_verification','geocode_provider')) THEN normalized:=normalized||jsonb_build_object('evidence_families',location->'evidence_families'); END IF;
    IF location->'naver_address'='null'::jsonb OR (jsonb_typeof(location->'naver_address')='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(location->'naver_address')='array' THEN location->'naver_address' ELSE '[]'::jsonb END) item WHERE jsonb_typeof(item)<>'object')) THEN normalized:=normalized||jsonb_build_object('naver_address',location->'naver_address'); END IF;
    IF location->'matched_address'='null'::jsonb THEN normalized:=normalized||jsonb_build_object('matched_address','null'::jsonb);
    ELSIF jsonb_typeof(location->'matched_address')='object' THEN
      nested:=location->'matched_address';fields:='{}';
      FOREACH field IN ARRAY ARRAY['roadAddress','jibunAddress','englishAddress','x','y'] LOOP
        IF jsonb_typeof(nested->field) IN ('string','null') THEN fields:=fields||jsonb_build_object(field,nested->field); END IF;
      END LOOP;
      normalized:=normalized||jsonb_build_object('matched_address',fields);
    END IF;
    IF location->'second_pass'='null'::jsonb THEN normalized:=normalized||jsonb_build_object('second_pass','null'::jsonb);
    ELSIF jsonb_typeof(location->'second_pass')='object' THEN
      nested:=location->'second_pass';fields:='{}';
      FOREACH field IN ARRAY ARRAY['attempted','timed_out','rate_limited'] LOOP
        IF jsonb_typeof(nested->field)='boolean' THEN fields:=fields||jsonb_build_object(field,nested->field); END IF;
      END LOOP;
      IF jsonb_typeof(nested->'provider') IN ('string','null') THEN fields:=fields||jsonb_build_object('provider',nested->'provider'); END IF;
      IF jsonb_typeof(nested->'duration_ms') IN ('number','null') THEN fields:=fields||jsonb_build_object('duration_ms',nested->'duration_ms'); END IF;
      normalized:=normalized||jsonb_build_object('second_pass',fields);
    END IF;
  END IF;
  RETURN result||jsonb_build_object('location_match_TF',normalized);
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.admin_eval_metrics(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_eval_metrics(jsonb) TO service_role;

CREATE FUNCTION pipeline_control.admin_eval_flags(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE status text; metrics jsonb; reason text; missing boolean; not_selected boolean; geo boolean; ready boolean; unconfirmed boolean;
BEGIN
  status:=CASE WHEN value->>'status' IN ('pending','approved','rejected','hold','deleted','missing','db_conflict','geocoding_failed','address_review_geocode_recovered','not_selected') THEN value->>'status' ELSE 'pending' END;
  metrics:=pipeline_control.admin_eval_metrics(value->'evaluation_results');
  reason:=metrics#>>'{location_match_TF,pending_reason}';
  missing:=coalesce(value->'is_missing'='true'::jsonb,false);
  not_selected:=coalesce(value->'is_not_selected'='true'::jsonb,false);
  geo:=coalesce(value->'geocoding_success'='true'::jsonb,false);
  ready:=coalesce(status IN ('pending','hold') AND geo
    AND metrics#>'{visit_authenticity,eval_value}'='1'::jsonb
    AND metrics#>'{rb_inference_score,eval_value}'='1'::jsonb
    AND metrics#>'{rb_grounding_TF,eval_value}'='true'::jsonb
    AND metrics#>'{review_faithfulness_score,eval_value}'='1'::jsonb
    AND metrics#>'{category_validity_TF,eval_value}'='true'::jsonb
    AND metrics#>'{category_TF,eval_value}'='true'::jsonb
    AND coalesce(reason NOT IN ('ambiguous_chain','multi_candidate','insufficient_evidence'),true),false);
  unconfirmed:=coalesce(status NOT IN ('deleted','approved') AND NOT missing AND NOT not_selected
    AND reason IN ('insufficient_evidence','ambiguous_chain','multi_candidate'),false);
  RETURN jsonb_build_object('status',status,'missing',missing OR status IN ('missing','geocoding_failed'),
    'not_selected',not_selected OR status='not_selected','ready_for_approval',ready,'unconfirmed_map',unconfirmed);
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.admin_eval_flags(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_eval_flags(jsonb) TO service_role;

CREATE FUNCTION pipeline_control.admin_eval_name_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT btrim(regexp_replace(regexp_replace(regexp_replace(lower(normalize(coalesce(value,''),NFKC)),
   '\([^)]*\)|\[[^\]]*\]|（[^）]*）',' ','g'),
   '(^|\s)(구|현|전)(\s|$)',' ','g'),
   '[\s·・ㆍ._\-–—,，()（）\[\]{}<>《》"''`´’‘“”:：]','','g'));
$$;
CREATE FUNCTION pipeline_control.admin_eval_name_tokens(value text)
RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT pipeline_control.admin_eval_name_key(regexp_replace(token,'점$',''))),'{}')
 FROM regexp_split_to_table(regexp_replace(regexp_replace(normalize(coalesce(value,''),NFKC),
   '\(([^)]*)\)|（([^）]*)）',' \1\2 ','g'),
   '[·・ㆍ._\-–—,，\[\]{}<>《》"''`´’‘“”:：]',' ','g'),'\s+') token
 WHERE length(btrim(token))>=2 AND token NOT IN ('구','현','전','내','본점');
$$;
CREATE FUNCTION pipeline_control.admin_eval_names_compatible(origin text,candidate text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE a text:=pipeline_control.admin_eval_name_key(origin); b text:=pipeline_control.admin_eval_name_key(candidate);
BEGIN
 IF a='' OR b='' OR a=b OR (length(a)>=3 AND strpos(b,a)>0) OR (length(b)>=3 AND strpos(a,b)>0) THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM unnest(pipeline_control.admin_eval_name_tokens(origin)) left_token
   CROSS JOIN unnest(pipeline_control.admin_eval_name_tokens(candidate)) right_token
   WHERE left_token<>'' AND right_token<>'' AND (left_token=right_token
     OR (length(left_token)>=3 AND strpos(right_token,left_token)>0)
     OR (length(right_token)>=3 AND strpos(left_token,right_token)>0)));
END;
$$;
CREATE FUNCTION pipeline_control.admin_eval_display_name(value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE candidate text; location jsonb:=pipeline_control.admin_eval_metrics(value->'evaluation_results')->'location_match_TF';
BEGIN
 IF jsonb_typeof(value->'approved_name')='string' AND btrim(value->>'approved_name')<>'' THEN RETURN btrim(value->>'approved_name'); END IF;
 IF location->'eval_value'='true'::jsonb OR location->>'match_status'='matched' THEN
   FOREACH candidate IN ARRAY ARRAY[value->>'naver_name',location->>'naver_name',
     CASE WHEN location->>'matched_provider'='naver' THEN location->>'matched_name' END] LOOP
     IF candidate IS NOT NULL AND btrim(candidate)<>'' AND pipeline_control.admin_eval_names_compatible(value->>'origin_name',candidate)
       THEN RETURN btrim(candidate); END IF;
   END LOOP;
 END IF;
 FOREACH candidate IN ARRAY ARRAY[value->>'restaurant_name',value->>'name',value->>'origin_name'] LOOP
   IF candidate IS NOT NULL AND btrim(candidate)<>'' THEN RETURN btrim(candidate); END IF;
 END LOOP;
 RETURN '이름 없음';
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.admin_eval_name_key(text),pipeline_control.admin_eval_name_tokens(text),
 pipeline_control.admin_eval_names_compatible(text,text),pipeline_control.admin_eval_display_name(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_eval_name_key(text),pipeline_control.admin_eval_name_tokens(text),
 pipeline_control.admin_eval_names_compatible(text,text),pipeline_control.admin_eval_display_name(jsonb) TO service_role;
COMMIT;
