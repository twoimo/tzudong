-- Add evidence identity binding without changing applied SQL or function ACLs.
BEGIN;
DO $patch$
DECLARE source text;before_meta jsonb;after_meta jsonb;anchor text;replacement text;function_oid oid;
BEGIN
 function_oid:='pipeline_control.restaurant_review_classify(jsonb)'::regprocedure;
 SELECT prosrc,jsonb_build_object('owner',proowner,'acl',proacl::text,'path',proconfig,'definer',prosecdef,'volatility',provolatile) INTO source,before_meta FROM pg_proc WHERE oid=function_oid;
 IF md5(source)<>'836d55098bf3123e5132bd97b5badbac' THEN RAISE EXCEPTION 'REVIEW_CLASSIFIER_SOURCE_DRIFT';END IF;
 anchor:=$anchor$  IF (SELECT count(DISTINCT family)$anchor$;
 replacement:=$replacement$  IF jsonb_typeof(evaluation#>'{location_match_TF,origin_name}') IS DISTINCT FROM 'string'
    OR lower(btrim(evaluation#>>'{location_match_TF,origin_name}')) IS DISTINCT FROM lower(btrim(row_data->>'origin_name'))
    THEN RETURN 'hold:location_identity_mismatch'; END IF;
  IF (SELECT count(DISTINCT family)$replacement$;
 IF length(source)-length(replace(source,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'REVIEW_CLASSIFIER_ANCHOR_DRIFT';END IF;
 EXECUTE replace(pg_get_functiondef(function_oid),anchor,replacement);
 SELECT jsonb_build_object('owner',proowner,'acl',proacl::text,'path',proconfig,'definer',prosecdef,'volatility',provolatile) INTO after_meta FROM pg_proc WHERE oid=function_oid;
 IF after_meta IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'REVIEW_CLASSIFIER_METADATA_DRIFT';END IF;
 function_oid:='pipeline_control.restaurant_review_decision(jsonb)'::regprocedure;
 SELECT prosrc,jsonb_build_object('owner',proowner,'acl',proacl::text,'path',proconfig,'definer',prosecdef,'volatility',provolatile) INTO source,before_meta FROM pg_proc WHERE oid=function_oid;
 IF md5(source)<>'12db45cac3d836c0c12c5fb1a5de2899' THEN RAISE EXCEPTION 'REVIEW_DECISION_SOURCE_DRIFT';END IF;
 anchor:=$anchor$WHERE other.id::text<>row_data->>'id' AND ($anchor$;
 replacement:=$replacement$WHERE other.id::text<>row_data->>'id' AND other.status IS DISTINCT FROM 'deleted' AND ($replacement$;
 IF length(source)-length(replace(source,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'REVIEW_DECISION_ANCHOR_DRIFT';END IF;
 EXECUTE replace(pg_get_functiondef(function_oid),anchor,replacement);
 SELECT jsonb_build_object('owner',proowner,'acl',proacl::text,'path',proconfig,'definer',prosecdef,'volatility',provolatile) INTO after_meta FROM pg_proc WHERE oid=function_oid;
 IF after_meta IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'REVIEW_DECISION_METADATA_DRIFT';END IF;
END;
$patch$;
COMMIT;
