-- Base metadata is independent of the optional sponsorship supplement.
-- Preserve existing function OIDs/owners/ACLs, guarded action admission, and RLS.
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION pipeline_control.admin_eval_valid_meta(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(value)='object'
  AND jsonb_typeof(value->'title')='string' AND jsonb_typeof(value->'publishedAt')='string'
  AND jsonb_typeof(value->'is_shorts')='boolean' AND jsonb_typeof(value->'duration')='number',false);
$$;

CREATE OR REPLACE FUNCTION pipeline_control.admin_record_compose(row_value jsonb, changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k text; meta jsonb; ads jsonb; incoming_meta jsonb;
BEGIN
 IF jsonb_typeof(changes) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(changes) x WHERE x<>ALL(ARRAY[
  'approved_name','phone','categories','youtube_link','tzuyang_review','road_address','jibun_address','english_address','address_elements','lat','lng','geocoding_success','youtube_meta']))
 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
 FOREACH k IN ARRAY ARRAY['approved_name','phone','youtube_link','tzuyang_review','road_address','jibun_address','english_address'] LOOP
  IF changes ? k AND (jsonb_typeof(changes->k) NOT IN ('string','null') OR length(changes->>k)>4000) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
 END LOOP;
 IF (changes ? 'approved_name' AND (nullif(btrim(changes->>'approved_name'),'') IS NULL OR length(changes->>'approved_name')>160))
  OR (changes ? 'phone' AND length(changes->>'phone')>80)
  OR (changes ? 'youtube_link' AND changes->'youtube_link'<>'null'::jsonb AND changes->>'youtube_link' !~ '^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$')
  OR (changes ? 'geocoding_success' AND jsonb_typeof(changes->'geocoding_success')<>'boolean')
  OR (changes ? 'youtube_meta' AND jsonb_typeof(changes->'youtube_meta')<>'object')
  OR (changes ? 'address_elements' AND jsonb_typeof(changes->'address_elements') NOT IN ('array','object','null'))
 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
 FOREACH k IN ARRAY ARRAY['lat','lng'] LOOP
  IF changes ? k THEN
   IF jsonb_typeof(changes->k)<>'number' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
   IF (changes->>k)::numeric NOT BETWEEN (CASE k WHEN 'lat' THEN -90 ELSE -180 END) AND (CASE k WHEN 'lat' THEN 90 ELSE 180 END) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
  END IF;
 END LOOP;
 IF changes ? 'categories' THEN
  IF jsonb_typeof(changes->'categories')<>'array' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
  IF jsonb_array_length(changes->'categories') NOT BETWEEN 1 AND 15 OR EXISTS(SELECT 1 FROM jsonb_array_elements(changes->'categories') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}'<>ALL(ARRAY['치킨','중식','돈까스·회','피자','패스트푸드','찜·탕','족발·보쌈','분식','카페·디저트','한식','고기','양식','아시안','야식','도시락'])) OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(changes->'categories') x) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
 END IF;
 IF changes ? 'youtube_meta' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(changes->'youtube_meta') meta_key WHERE meta_key<>ALL(ARRAY['title','published_at','duration','is_shorts','is_ads','what_ads','sponsorship_confirmation'])) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  incoming_meta:=changes->'youtube_meta';
  FOREACH k IN ARRAY ARRAY['title','published_at'] LOOP
   IF incoming_meta ? k AND (jsonb_typeof(incoming_meta->k)<>'string' OR length(incoming_meta->>k)>4000) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  END LOOP;
  IF incoming_meta ? 'duration' THEN
   IF jsonb_typeof(incoming_meta->'duration')<>'number' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   IF (incoming_meta->>'duration')::numeric<0 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  END IF;
  IF (incoming_meta ? 'is_shorts' AND jsonb_typeof(incoming_meta->'is_shorts')<>'boolean')
   OR (incoming_meta ? 'is_ads' AND jsonb_typeof(incoming_meta->'is_ads')<>'boolean') THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  IF incoming_meta ? 'what_ads' AND incoming_meta->'what_ads'<>'null'::jsonb THEN
   IF jsonb_typeof(incoming_meta->'what_ads')<>'array' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   IF jsonb_array_length(incoming_meta->'what_ads')>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(incoming_meta->'what_ads') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')>4000) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  END IF;
  -- An explicit manual decision is distinct from an automatic/legacy field projection.
  -- The caller cannot supply provenance or actor identity; the existing guarded
  -- operation binds actor/targets/payload/fingerprint and commits the audit.
  IF incoming_meta ? 'sponsorship_confirmation' THEN
   IF incoming_meta->>'sponsorship_confirmation' IS NULL
    OR incoming_meta->>'sponsorship_confirmation' NOT IN ('detected','confirmed_none')
    OR NOT (incoming_meta ? 'is_ads' AND incoming_meta ? 'what_ads')
    OR incoming_meta->'is_ads' IS DISTINCT FROM to_jsonb(incoming_meta->>'sponsorship_confirmation'='detected')
   THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   IF incoming_meta->>'sponsorship_confirmation'='confirmed_none' THEN
    IF incoming_meta->'what_ads' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   ELSE
    IF jsonb_typeof(incoming_meta->'what_ads') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
    IF jsonb_array_length(incoming_meta->'what_ads')=0 OR EXISTS(
     SELECT 1 FROM jsonb_array_elements_text(incoming_meta->'what_ads') x
     WHERE pipeline_control.admin_eval_js_trim(x)=''
    ) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   END IF;
  END IF;
  meta:=CASE WHEN jsonb_typeof(row_value->'youtube_meta')='object' THEN row_value->'youtube_meta' ELSE '{}'::jsonb END;
  ads:=CASE WHEN jsonb_typeof(meta->'ads_info')='object' THEN meta->'ads_info' ELSE '{}'::jsonb END;
  FOREACH k IN ARRAY ARRAY['title','duration','is_shorts'] LOOP
   IF incoming_meta ? k THEN meta:=meta||jsonb_build_object(k,incoming_meta->k); END IF;
  END LOOP;
  IF incoming_meta ? 'published_at' THEN meta:=meta||jsonb_build_object('publishedAt',incoming_meta->'published_at'); END IF;
  IF incoming_meta ? 'is_ads' THEN ads:=ads||jsonb_build_object('is_ads',incoming_meta->'is_ads'); END IF;
  IF incoming_meta ? 'what_ads' THEN
   -- Canonical consumers use nullable advertising text. A single wrapped text
   -- round-trips exactly; ordered names retain their text in a readable list.
   ads:=ads||jsonb_build_object('what_ads',CASE WHEN incoming_meta->'what_ads'='null'::jsonb THEN NULL::text ELSE
    (SELECT string_agg(value,', ' ORDER BY ordinal) FROM jsonb_array_elements_text(incoming_meta->'what_ads') WITH ORDINALITY a(value,ordinal)) END);
  END IF;
  IF incoming_meta ? 'sponsorship_confirmation' THEN
   -- Replace only stale sponsorship analysis. Other metadata and ads keys survive.
   ads:=ads||jsonb_build_object('sponsor_analysis',jsonb_build_object(
    'status','completed','outcome',incoming_meta->>'sponsorship_confirmation',
    'source','manual_admin','version','manual-sponsorship-v1',
    'reason','explicit_admin_confirmation','source_sha256',NULL));
  END IF;
  IF incoming_meta ? 'is_ads' OR incoming_meta ? 'what_ads' OR meta ? 'ads_info' THEN meta:=meta||jsonb_build_object('ads_info',ads); END IF;
  changes:=changes||jsonb_build_object('youtube_meta',meta);
 END IF;
 RETURN row_value||changes;
END $$;

-- Serialize against restaurant writers so the derived snapshot cannot overwrite
-- a concurrent trigger's newer descriptor. This lock changes no business row.
LOCK TABLE public.restaurants IN SHARE MODE;
WITH affected AS MATERIALIZED (
 SELECT r.id,pipeline_control.admin_eval_descriptor(to_jsonb(r)||jsonb_build_object('name',r.approved_name)) AS d
 FROM public.restaurants r
 WHERE pipeline_control.admin_eval_valid_meta(r.youtube_meta)
  AND NOT coalesce(jsonb_typeof(r.youtube_meta->'ads_info')='object'
   AND jsonb_typeof(r.youtube_meta#>'{ads_info,is_ads}')='boolean'
   AND jsonb_typeof(r.youtube_meta#>'{ads_info,what_ads}') IN ('string','null'),false)
)
INSERT INTO pipeline_control.admin_evaluation_read_index AS saved(id,descriptor,latest,created,video)
 SELECT id,d,(d->>'latest')::numeric,(d->>'created')::numeric,d->>'video' FROM affected
 ON CONFLICT(id) DO UPDATE SET descriptor=EXCLUDED.descriptor,latest=EXCLUDED.latest,
  created=EXCLUDED.created,video=EXCLUDED.video
 WHERE saved.descriptor IS DISTINCT FROM EXCLUDED.descriptor;
