-- Whole-catalog warning counts and bounded top candidates. No restaurant writes.
BEGIN;
-- Intl.Collator performs canonical normalization, including non-FCD combining
-- sequences. ICU's default kk=false would reorder some canonically equal names.
CREATE COLLATION pipeline_control.admin_warning_order (provider=icu,locale='en-US-u-kk-true',deterministic=false);
CREATE COLLATION pipeline_control.admin_warning_case (provider=icu,locale='und',deterministic=true);

-- Compatibility domain: Node ICU 78 / Unicode 17 versus PostgreSQL Unicode 15.1.
-- UnicodeData 17.0 SHA256 2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c.
-- The 37 new single-ASCII compatibility mappings are applied BEFORE NFKC so
-- adjacent combining marks still compose. All other post-15.1/unassigned input
-- fails closed (including new combining classes/composition pairs), never drops
-- a warning. U+1CCD6 followed by U+0301 therefore becomes U+00C1, then lowercases.
CREATE FUNCTION pipeline_control.admin_warning_nfkc(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE s text:=coalesce(value,'');
BEGIN
 IF octet_length(s)>8192 THEN RAISE EXCEPTION 'EVALUATION_WARNING_CAPACITY_EXCEEDED';END IF;
 s:=translate(s,'꟱𜳖𜳗𜳘𜳙𜳚𜳛𜳜𜳝𜳞𜳟𜳠𜳡𜳢𜳣𜳤𜳥𜳦𜳧𜳨𜳩𜳪𜳫𜳬𜳭𜳮𜳯𜳰𜳱𜳲𜳳𜳴𜳵𜳶𜳷𜳸𜳹','SABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
 IF NOT unicode_assigned(s) THEN RAISE EXCEPTION 'EVALUATION_WARNING_UNICODE_UNSUPPORTED';END IF;
 RETURN normalize(s,NFKC);
END;
$$;

CREATE FUNCTION pipeline_control.admin_warning_utf16(value text) RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE units integer[]:='{}';position integer;point integer;
BEGIN
 FOR position IN 1..length(coalesce(value,'')) LOOP
  point:=ascii(substr(value,position,1));
  IF point>65535 THEN units:=units||ARRAY[55296+(point-65536)/1024,56320+(point-65536)%1024];
  ELSE units:=array_append(units,point);END IF;
 END LOOP;
 RETURN units;
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_key(value text,identity boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE s text:=lower(pipeline_control.admin_warning_nfkc(value) COLLATE pipeline_control.admin_warning_case);
 spaces text:=E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
 IF identity THEN
  s:=regexp_replace(s,'\([^)]*\)|\[[^\]]*\]|（[^）]*）',' ','g');
  s:=regexp_replace(s,'(^|['||spaces||'])(구|현|전)(['||spaces||']|$)',' ','g');
 ELSE s:=regexp_replace(s,'\[[^\]]+\]|\([^)]*추정[^)]*\)|\([^)]*또는[^)]*\)',' ','g');END IF;
 s:=translate(s,spaces||'·・ㆍ._-–—,，()（）[]{}<>《》"''`´’‘“”'||CASE WHEN identity THEN ':：' ELSE '' END,'');
 IF NOT identity THEN s:=regexp_replace(s,'본점$|점$|입구$','','g');END IF;
 IF length(s)>256 OR cardinality(pipeline_control.admin_warning_utf16(s))>256 THEN RAISE EXCEPTION 'EVALUATION_WARNING_CAPACITY_EXCEEDED';END IF;
 RETURN pipeline_control.admin_eval_js_trim(s);
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_tokens(value text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE token text;result text[]:='{}';s text:=pipeline_control.admin_warning_nfkc(value);
 spaces text:=E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
 s:=regexp_replace(s,'\(([^)]*)\)|（([^）]*)）',' \1 \2 ','g');
 s:=regexp_replace(s,'[·・ㆍ._\-–—,，\[\]{}<>《》"''`´’‘“”:：]',' ','g');
 FOR token IN SELECT pipeline_control.admin_eval_js_trim(v) FROM regexp_split_to_table(s,'['||spaces||']+') v LOOP
  IF cardinality(pipeline_control.admin_warning_utf16(token))>=2 AND token NOT IN ('구','현','전','내','본점') THEN
   token:=pipeline_control.admin_warning_key(regexp_replace(token,'점$',''),true);
   IF token<>'' AND NOT token=ANY(result) THEN result:=array_append(result,token);END IF;
  END IF;
 END LOOP;RETURN result;
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_names_compatible(origin text,candidate text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE a text:=pipeline_control.admin_warning_key(origin,true);b text:=pipeline_control.admin_warning_key(candidate,true);
BEGIN
 IF a='' OR b='' OR a=b OR (cardinality(pipeline_control.admin_warning_utf16(a))>=3 AND strpos(b,a)>0)
  OR (cardinality(pipeline_control.admin_warning_utf16(b))>=3 AND strpos(a,b)>0) THEN RETURN true;END IF;
 RETURN EXISTS(SELECT 1 FROM unnest(pipeline_control.admin_warning_tokens(origin)) l CROSS JOIN unnest(pipeline_control.admin_warning_tokens(candidate)) r
  WHERE l=r OR (cardinality(pipeline_control.admin_warning_utf16(l))>=3 AND strpos(r,l)>0)
  OR (cardinality(pipeline_control.admin_warning_utf16(r))>=3 AND strpos(l,r)>0));
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_display(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE name text;location jsonb:=value#>'{evaluation_results,location_match_TF}';
BEGIN
 name:=pipeline_control.admin_eval_js_trim(value->>'approved_name');IF coalesce(name,'')<>'' THEN RETURN name;END IF;
 IF location->'eval_value'='true'::jsonb OR location->>'match_status'='matched' THEN
  FOREACH name IN ARRAY ARRAY[value->>'naver_name',CASE WHEN jsonb_typeof(location->'naver_name')='string' THEN location->>'naver_name' END,
    CASE WHEN location->>'matched_provider'='naver' AND jsonb_typeof(location->'matched_name')='string' THEN location->>'matched_name' END] LOOP
   name:=pipeline_control.admin_eval_js_trim(name);
   IF coalesce(name,'')<>'' AND pipeline_control.admin_warning_names_compatible(value->>'origin_name',name) THEN RETURN name;END IF;
  END LOOP;
 END IF;
 FOREACH name IN ARRAY ARRAY[value->>'restaurant_name',value->>'name',value->>'origin_name'] LOOP
  name:=pipeline_control.admin_eval_js_trim(name);IF coalesce(name,'')<>'' THEN RETURN name;END IF;
 END LOOP;RETURN '이름 없음';
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_info(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE display text:=pipeline_control.admin_warning_display(value);candidate text;
 identity text:=coalesce(nullif(pipeline_control.admin_eval_js_trim(value->>'approved_name'),''),display);
 address text:=coalesce(nullif(value->>'jibun_address',''),nullif(value->>'road_address',''));
BEGIN
 candidate:=coalesce(nullif(pipeline_control.admin_eval_js_trim(value->>'approved_name'),''),nullif(pipeline_control.admin_eval_js_trim(value->>'naver_name'),''),
  nullif(pipeline_control.admin_eval_js_trim(value->>'google_name'),''),display,'이름 없음');
 RETURN jsonb_build_object('id',value->>'id','name',candidate,'status',CASE WHEN value->>'status' IN ('pending','approved','rejected','hold','deleted','missing','db_conflict','geocoding_failed','address_review_geocode_recovered','not_selected') THEN value->>'status' ELSE 'pending' END,
  'address',address,'adminTouched',coalesce(nullif(value->>'updated_by_admin_id','') IS NOT NULL,false),
  'origin_name',value->>'origin_name','candidate_name',candidate,
  'originKey',pipeline_control.admin_warning_key(value->>'origin_name',true),'candidateKey',pipeline_control.admin_warning_key(candidate,true),
  'shape',jsonb_build_object('identity',pipeline_control.admin_warning_key(identity),'address',pipeline_control.admin_warning_key(address),
   'phone',regexp_replace(coalesce(value->>'phone',''),'[^0-9]','','g'),
   'lat',CASE WHEN jsonb_typeof(value->'lat')='number' THEN value->'lat' END,'lng',CASE WHEN jsonb_typeof(value->'lng')='number' THEN value->'lng' END));
END;
$$;
-- Exact UTF-16 Levenshtein result above the required threshold; 0 below it.
-- The cutoff is adjusted with the same floating-point comparison as JavaScript.
CREATE FUNCTION pipeline_control.admin_warning_similarity(a text,b text,minimum_score double precision DEFAULT 0) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE l integer[]:=pipeline_control.admin_warning_utf16(a);r integer[]:=pipeline_control.admin_warning_utf16(b);
 previous integer[];current integer[];i integer;j integer;n integer:=cardinality(l);m integer:=cardinality(r);
 cutoff integer;row_min integer;lo integer;hi integer;
BEGIN
 IF n>256 OR m>256 THEN RAISE EXCEPTION 'EVALUATION_WARNING_CAPACITY_EXCEEDED';END IF;
 IF n=0 OR m=0 THEN RETURN 0;END IF;IF a=b THEN RETURN 1;END IF;
 IF (n>=4 AND strpos(b,a)>0) OR (m>=4 AND strpos(a,b)>0) THEN RETURN 0.96;END IF;
 cutoff:=floor((1-minimum_score)*greatest(n,m));
 WHILE 1-(cutoff+1)::double precision/greatest(n,m)>=minimum_score LOOP cutoff:=cutoff+1;END LOOP;
 WHILE 1-cutoff::double precision/greatest(n,m)<minimum_score LOOP cutoff:=cutoff-1;END LOOP;
 IF abs(n-m)>cutoff THEN RETURN 0;END IF;
 SELECT array_agg(least(v,cutoff+1)) INTO previous FROM generate_series(0,m) v;
 FOR i IN 1..n LOOP
  current:=array_fill(cutoff+1,ARRAY[m+1]);current[1]:=i;row_min:=cutoff+1;
  lo:=greatest(1,i-cutoff);hi:=least(m,i+cutoff);
  FOR j IN lo..hi LOOP
   current[j+1]:=least(previous[j+1]+1,current[j]+1,previous[j]+CASE WHEN l[i]=r[j] THEN 0 ELSE 1 END);
   row_min:=least(row_min,current[j+1]);
  END LOOP;
  IF row_min>cutoff THEN RETURN 0;END IF;
  previous:=current;
 END LOOP;
 IF previous[m+1]>cutoff THEN RETURN 0;END IF;
 RETURN 1-previous[m+1]/greatest(n,m)::double precision;
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_distance(a jsonb,b jsonb) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE lat1 double precision;lat2 double precision;lng1 double precision;lng2 double precision;x double precision;dlat double precision;dlng double precision;
BEGIN
 IF a->'lat'='null'::jsonb OR a->'lng'='null'::jsonb OR b->'lat'='null'::jsonb OR b->'lng'='null'::jsonb THEN RETURN NULL;END IF;
 lat1:=(a->>'lat')::double precision;lat2:=(b->>'lat')::double precision;lng1:=(a->>'lng')::double precision;lng2:=(b->>'lng')::double precision;
 dlat:=(lat2-lat1)*pi()/180;dlng:=(lng2-lng1)*pi()/180;
 x:=sin(dlat/2)^2+cos(lat1*pi()/180)*cos(lat2*pi()/180)*sin(dlng/2)^2;
 IF x>1 OR x<0 THEN RETURN NULL;END IF;RETURN 2*6371000*asin(sqrt(x));
EXCEPTION WHEN numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_evidence(a jsonb,b jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE same_phone boolean:=coalesce(length(a->>'phone')>=7 AND a->>'phone'=b->>'phone',false);
 same_address boolean:=coalesce(a->>'address'<>'' AND a->>'address'=b->>'address',false);
 distance double precision;similarity double precision;
BEGIN
 IF a->>'identity'<>'' AND a->>'identity'=b->>'identity' THEN RETURN jsonb_build_object('rule','exact_identity','confidence',1);END IF;
 IF NOT same_phone AND NOT same_address THEN
  distance:=pipeline_control.admin_warning_distance(a,b);IF distance IS NULL OR distance>20 THEN RETURN NULL;END IF;
 END IF;
 similarity:=pipeline_control.admin_warning_similarity(a->>'identity',b->>'identity',CASE WHEN same_phone THEN 0.72 WHEN same_address THEN 0.82 ELSE 0.86 END);
 IF same_phone AND similarity>=0.72 THEN RETURN jsonb_build_object('rule','same_phone_similar_name','confidence',0.98);END IF;
 IF same_address AND similarity>=0.82 THEN RETURN jsonb_build_object('rule','same_address_similar_name','confidence',0.97);END IF;
 distance:=coalesce(distance,pipeline_control.admin_warning_distance(a,b));
 IF distance<=20 AND similarity>=0.86 THEN RETURN jsonb_build_object('rule','near_coordinate_similar_name','confidence',0.96);END IF;
 RETURN NULL;
END;
$$;

-- Unit-sphere cells are a conservative candidate gate, never distance evidence.
-- For admitted coordinates distance<=20m implies every xyz delta<3.14e-6;
-- width 4e-6 and 27 adjacent cells include poles and the antimeridian. Inputs
-- outside the ordinary latitude/longitude domain fail closed, rather than
-- silently changing JavaScript's periodic behavior on corrupt coordinates.
CREATE FUNCTION pipeline_control.admin_warning_cell(shape jsonb) RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE lat double precision:=(shape->>'lat')::double precision;lng double precision:=(shape->>'lng')::double precision;
BEGIN
 IF lat IS NULL OR lng IS NULL THEN RETURN NULL;END IF;
 IF lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'EVALUATION_WARNING_COORDINATE_UNSUPPORTED';END IF;
 RETURN ARRAY[floor(cos(lat*pi()/180)*cos(lng*pi()/180)/0.000004)::integer,
  floor(cos(lat*pi()/180)*sin(lng*pi()/180)/0.000004)::integer,floor(sin(lat*pi()/180)/0.000004)::integer];
END;
$$;
CREATE FUNCTION pipeline_control.admin_warning_budget(pair_count bigint,edit_cells bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF pair_count>25000 OR edit_cells>2000000 THEN RAISE EXCEPTION 'EVALUATION_WARNING_CAPACITY_EXCEEDED';END IF;
 RETURN true;
END;
$$;

CREATE FUNCTION public.admin_evaluation_warning_groups(page_ids uuid[],expected_revision text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE revision text;result jsonb;groups jsonb;source_bytes bigint;largest_row integer;
BEGIN
 IF page_ids IS NULL OR cardinality(page_ids)>200 OR cardinality(page_ids)<>(SELECT count(DISTINCT id) FROM unnest(page_ids) id)
  OR expected_revision IS NULL OR expected_revision!~'^[0-9]{1,20}$' THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID';END IF;
 revision:=public.admin_evaluation_revision();
 IF revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'EVALUATION_CURSOR_STALE';END IF;
 -- Check the server family before resolving version-specific Unicode helpers.
 -- An explicit opt-in on another family can then use the JS admission fallback.
 IF current_setting('server_version_num')::integer/10000<>17 THEN RAISE EXCEPTION 'EVALUATION_WARNING_UNICODE_UNSUPPORTED';END IF;
 IF unicode_version()<>'15.1' OR EXISTS(SELECT 1 FROM pg_collation WHERE oid IN
  ('pipeline_control.admin_warning_order'::regcollation,'pipeline_control.admin_warning_case'::regcollation)
  AND pg_collation_actual_version(oid) IS DISTINCT FROM '153.136') THEN RAISE EXCEPTION 'EVALUATION_WARNING_UNICODE_UNSUPPORTED';END IF;
 IF (SELECT count(*) FROM pipeline_control.admin_evaluation_read_index)>50000 THEN RAISE EXCEPTION 'EVALUATION_RECORDS_UNAVAILABLE';END IF;
 IF (SELECT count(*) FROM public.restaurants WHERE id=ANY(page_ids))<>cardinality(page_ids) THEN RAISE EXCEPTION 'EVALUATION_CURSOR_STALE';END IF;
 -- Bound materialization before normalization/sorting, not only the final JSON.
 SELECT coalesce(sum(octet_length(to_jsonb(r)::text)),0),coalesce(max(octet_length(to_jsonb(r)::text)),0)
 INTO source_bytes,largest_row FROM public.admin_evaluation_related_rows r
 WHERE r.id=ANY(page_ids) OR r.video_id IN (SELECT video FROM pipeline_control.admin_evaluation_read_index WHERE id=ANY(page_ids));
 IF source_bytes>33554432 OR largest_row>8192 THEN RAISE EXCEPTION 'EVALUATION_WARNING_CAPACITY_EXCEEDED';END IF;
 WITH targets AS MATERIALIZED (
  SELECT r.id,r.video_id AS video,pipeline_control.admin_warning_info(to_jsonb(r)) AS info
  FROM public.admin_evaluation_related_rows r WHERE r.id=ANY(page_ids)
 ), related AS MATERIALIZED (
  SELECT r.id,r.created_at,r.video_id AS video,pipeline_control.admin_warning_info(to_jsonb(r)) AS info
  FROM public.admin_evaluation_related_rows r WHERE r.video_id IN (SELECT video FROM targets WHERE video IS NOT NULL)
 ), ranked AS MATERIALIZED (
  SELECT id,created_at,video,info->'shape' AS shape,info->>'name' AS name,row_number() OVER(PARTITION BY video,info->'shape' ORDER BY (info->>'name') COLLATE pipeline_control.admin_warning_order,created_at DESC,id ASC) AS position,
   row_number() OVER(PARTITION BY video,info#>>'{shape,identity}' ORDER BY (info->>'name') COLLATE pipeline_control.admin_warning_order,created_at DESC,id ASC) AS identity_position
  FROM related WHERE info->>'status'<>'deleted'
 ), related_groups AS MATERIALIZED (
  SELECT row_number() OVER() AS gid,video,shape,count(*) AS total,
   array_agg(id ORDER BY position) FILTER(WHERE position<=4) AS candidates
  FROM ranked GROUP BY video,shape
 ), identity_groups AS MATERIALIZED (
  SELECT video,shape->>'identity' AS identity,count(*) AS total,
   array_agg(id ORDER BY identity_position) FILTER(WHERE identity_position<=4) AS candidates
  FROM ranked WHERE shape->>'identity'<>'' GROUP BY video,shape->>'identity'
 ), target_shapes AS MATERIALIZED (
  SELECT row_number() OVER() AS tid,video,shape FROM
   (SELECT DISTINCT video,info->'shape' AS shape FROM targets WHERE video IS NOT NULL AND info->>'status'<>'deleted') d
 ), t_keys AS MATERIALIZED (
  SELECT *,shape->>'identity' AS identity,shape->>'phone' AS phone,shape->>'address' AS address,cardinality(pipeline_control.admin_warning_utf16(shape->>'identity')) AS name_length,pipeline_control.admin_warning_cell(shape) AS cell FROM target_shapes
 ), r_keys AS MATERIALIZED (
  SELECT *,shape->>'identity' AS identity,shape->>'phone' AS phone,shape->>'address' AS address,cardinality(pipeline_control.admin_warning_utf16(shape->>'identity')) AS name_length,pipeline_control.admin_warning_cell(shape) AS cell FROM related_groups
 ), t_cells AS MATERIALIZED (
  SELECT t.tid,t.video,t.identity,ARRAY[t.cell[1]+x,t.cell[2]+y,t.cell[3]+z] AS cell
  FROM t_keys t CROSS JOIN generate_series(-1,1) x CROSS JOIN generate_series(-1,1) y CROSS JOIN generate_series(-1,1) z WHERE t.cell IS NOT NULL
 ), t_gates AS MATERIALIZED (
  SELECT video,'phone' AS kind,phone AS key,identity,array_agg(tid) AS ids FROM t_keys
   WHERE length(phone)>=7 AND identity<>'' GROUP BY video,phone,identity
  UNION ALL
  SELECT video,'address',address,identity,array_agg(tid) FROM t_keys
   WHERE address<>'' AND identity<>'' GROUP BY video,address,identity
  UNION ALL
  SELECT video,'cell',cell::text,identity,array_agg(tid) FROM t_cells WHERE identity<>'' GROUP BY video,cell,identity
 ), r_gates AS MATERIALIZED (
  SELECT video,'phone' AS kind,phone AS key,identity,array_agg(gid) AS ids FROM r_keys
   WHERE length(phone)>=7 AND identity<>'' GROUP BY video,phone,identity
  UNION ALL
  SELECT video,'address',address,identity,array_agg(gid) FROM r_keys
   WHERE address<>'' AND identity<>'' GROUP BY video,address,identity
  UNION ALL
  SELECT video,'cell',cell::text,identity,array_agg(gid) FROM r_keys WHERE cell IS NOT NULL AND identity<>'' GROUP BY video,cell,identity
 ), gate_pairs AS MATERIALIZED (
  -- Coalesce each gate AND identity before comparing. Otherwise 200 different
  -- physical shapes sharing one name/phone still scan 10m equal-name pairs.
  SELECT t.ids AS tids,r.ids AS gids FROM t_gates t JOIN r_gates r ON r.video=t.video AND r.kind=t.kind AND r.key=t.key
  WHERE t.identity<>r.identity LIMIT 25001
 ), raw_pairs AS MATERIALIZED (
  -- Stop at limit+1 before deduplication; never construct the full dense pair set.
  SELECT tid,gid FROM gate_pairs p CROSS JOIN LATERAL unnest(p.tids) tid CROSS JOIN LATERAL unnest(p.gids) gid LIMIT 25001
 ), pairs AS MATERIALIZED (SELECT DISTINCT tid,gid FROM raw_pairs),
 budget AS MATERIALIZED (
  SELECT pipeline_control.admin_warning_budget((SELECT count(*) FROM raw_pairs),coalesce(sum(
   t.name_length*r.name_length),0)::bigint) AS admitted
  FROM pairs p JOIN t_keys t ON t.tid=p.tid JOIN r_keys r ON r.gid=p.gid
 ), matches AS MATERIALIZED (
  SELECT t.video,t.shape,r.total,r.candidates,pipeline_control.admin_warning_evidence(t.shape,r.shape) AS evidence
  FROM pairs p JOIN t_keys t ON t.tid=p.tid JOIN r_keys r ON r.gid=p.gid WHERE (SELECT admitted FROM budget)
 ), matched AS MATERIALIZED (
  SELECT * FROM matches WHERE evidence IS NOT NULL
  UNION ALL
  SELECT t.video,t.shape,r.total,r.candidates,jsonb_build_object('rule','exact_identity','confidence',1)
  FROM t_keys t JOIN identity_groups r ON r.video=t.video AND r.identity=t.identity WHERE (SELECT admitted FROM budget)
 ), counts AS (SELECT video,shape,sum(total) AS total FROM matched GROUP BY video,shape),
 candidate_pool AS MATERIALIZED (
  SELECT m.video,m.shape,id,m.evidence FROM matched m CROSS JOIN LATERAL unnest(m.candidates) id
 ), tops AS MATERIALIZED (
  SELECT p.*,row_number() OVER(PARTITION BY p.video,p.shape ORDER BY (p.evidence->>'confidence')::double precision DESC,
   (r.info->>'name') COLLATE pipeline_control.admin_warning_order,r.created_at DESC,r.id ASC) AS position
  FROM candidate_pool p JOIN related r ON r.id=p.id
 ), top_groups AS (
  SELECT t.video,t.shape,jsonb_agg((r.info-ARRAY['origin_name','candidate_name','originKey','candidateKey','shape'])||t.evidence ORDER BY t.position) AS candidates
  FROM tops t JOIN related r ON r.id=t.id WHERE t.position<=4 GROUP BY t.video,t.shape
 ), deleted_shapes AS MATERIALIZED (
  SELECT row_number() OVER() AS did,video,origin_key,candidate_key FROM (
   SELECT DISTINCT video,info->>'originKey' AS origin_key,info->>'candidateKey' AS candidate_key FROM targets
   WHERE video IS NOT NULL AND info->>'status'<>'deleted') d
 ), deleted_ranked AS MATERIALIZED (
  SELECT id,created_at,video,info->>'originKey' AS origin_key,info->>'candidateKey' AS candidate_key,row_number() OVER(PARTITION BY video,info->>'originKey' ORDER BY created_at DESC,id ASC) AS origin_position,
   row_number() OVER(PARTITION BY video,info->>'candidateKey' ORDER BY created_at DESC,id ASC) AS candidate_position
  FROM related WHERE info->>'status'='deleted'
 ), deleted_origin AS MATERIALIZED (
  SELECT video,origin_key AS key,count(*) AS total,array_agg(id ORDER BY origin_position) FILTER(WHERE origin_position<=3) AS samples
  FROM deleted_ranked WHERE origin_key<>'' GROUP BY video,origin_key
 ), deleted_candidate AS MATERIALIZED (
  SELECT video,candidate_key AS key,count(*) AS total,array_agg(id ORDER BY candidate_position) FILTER(WHERE candidate_position<=3) AS samples
  FROM deleted_ranked WHERE candidate_key<>'' GROUP BY video,candidate_key
 ), deleted_overlap AS MATERIALIZED (
  SELECT video,origin_key,candidate_key,count(*) AS total
  FROM deleted_ranked GROUP BY video,origin_key,candidate_key
 ), deleted_groups AS (
  -- Inclusion/exclusion counts each deleted row once. Only six sample IDs per
  -- target survive; 200 different names sharing one deleted-name group do not
  -- materialize 200 x 50,000 deleted rows.
  SELECT d.video,d.origin_key,d.candidate_key,
   coalesce(o.total,0)+coalesce(c.total,0)-CASE WHEN d.origin_key<>'' AND d.candidate_key<>'' THEN coalesce(b.total,0) ELSE 0 END AS total,
   (SELECT jsonb_agg(jsonb_build_object('id',r.info->>'id','origin_name',r.info->>'origin_name','candidate_name',r.info->>'candidate_name') ORDER BY r.created_at DESC,r.id)
    FROM (SELECT item.id FROM (SELECT DISTINCT unnest(coalesce(o.samples,'{}'::uuid[])||coalesce(c.samples,'{}'::uuid[])) AS id) item
     JOIN related x ON x.id=item.id ORDER BY x.created_at DESC,x.id LIMIT 3) samples JOIN related r ON r.id=samples.id) AS samples
  FROM deleted_shapes d LEFT JOIN deleted_origin o ON o.video=d.video AND o.key=d.origin_key
   LEFT JOIN deleted_candidate c ON c.video=d.video AND c.key=d.candidate_key
   LEFT JOIN deleted_overlap b ON b.video=d.video AND b.origin_key=d.origin_key AND b.candidate_key=d.candidate_key
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,
   'sameVideo',jsonb_build_object('count',greatest(0,coalesce(c.total,0)-CASE WHEN own.info->>'status'<>'deleted' AND pipeline_control.admin_warning_evidence(t.info->'shape',own.info->'shape') IS NOT NULL THEN 1 ELSE 0 END),
    'candidates',coalesce((SELECT jsonb_agg(item.value ORDER BY item.ordinality) FROM (
      SELECT value,ordinality FROM jsonb_array_elements(coalesce(g.candidates,'[]')) WITH ORDINALITY
       WHERE value->>'id'<>t.id::text ORDER BY ordinality LIMIT 3) item),'[]')),
   'deleted',jsonb_build_object('count',coalesce(d.total,0),'samples',coalesce(d.samples,'[]'))
  ) ORDER BY t.id),'[]') INTO groups
 FROM targets t LEFT JOIN counts c ON t.info->>'status'<>'deleted' AND c.video=t.video AND c.shape=t.info->'shape'
 LEFT JOIN top_groups g ON t.info->>'status'<>'deleted' AND g.video=t.video AND g.shape=t.info->'shape'
 LEFT JOIN related own ON own.id=t.id
 LEFT JOIN deleted_groups d ON t.info->>'status'<>'deleted' AND d.video=t.video AND d.origin_key=t.info->>'originKey' AND d.candidate_key=t.info->>'candidateKey';
 result:=jsonb_build_object('revision',revision,'groups',groups);
 IF octet_length(result::text)>8*1024*1024 THEN RAISE EXCEPTION 'EVALUATION_RECORDS_UNAVAILABLE';END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_warning_groups(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_warning_groups(uuid[],text) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
 SELECT n.nspname,p.proname,p.proargtypes::text,'service_role'::name,'public.admin_evaluation_warning_groups(uuid[],text)'
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid='public.admin_evaluation_warning_groups(uuid[],text)'::regprocedure
 ON CONFLICT(source_signature,grantee) DO UPDATE SET identity_arguments=EXCLUDED.identity_arguments;
DO $permissions$
DECLARE signature text;
BEGIN
 FOR signature IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pipeline_control' AND p.proname LIKE 'admin_warning_%' LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO service_role';
 END LOOP;
END;
$permissions$;
COMMIT;
