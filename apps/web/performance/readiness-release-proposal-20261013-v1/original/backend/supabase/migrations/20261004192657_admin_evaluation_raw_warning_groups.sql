-- Forward-only: preserve raw warning inputs; JS remains the classifier.
-- Apply atomically. No restaurant row is changed by the index repair.
BEGIN;
LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION pipeline_control.admin_eval_video_id(value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(
  substring(value COLLATE "C" FROM '[?&]v=([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtu\.be/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtube\.com/shorts/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtube\.com/embed/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtube\.com/live/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'));
$$;
UPDATE pipeline_control.admin_evaluation_read_index idx
 SET video=fixed.video,
 descriptor=jsonb_set(idx.descriptor,'{video}',coalesce(to_jsonb(fixed.video),'null'::jsonb))
 FROM (SELECT id,pipeline_control.admin_eval_video_id(youtube_link) video FROM public.restaurants) fixed
 WHERE idx.id=fixed.id AND (idx.video IS DISTINCT FROM fixed.video
  OR idx.descriptor->'video' IS DISTINCT FROM coalesce(to_jsonb(fixed.video),'null'::jsonb));
UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision=revision+1 WHERE singleton;

-- Exact SQL order; the older descriptor index deliberately truncates to JS ms
-- and therefore cannot be used for this transport cursor.
CREATE INDEX admin_evaluation_warning_source_order ON public.restaurants(created_at DESC NULLS FIRST,id ASC);
CREATE FUNCTION public.admin_evaluation_raw_warning_groups(
 page_ids uuid[], expected_revision text, after_cursor jsonb DEFAULT NULL, batch_size integer DEFAULT 1000
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
 current_revision text; videos text[]; payload jsonb; input_bytes bigint; largest_row integer;
 total_rows integer; total_groups integer; codec text; sorted_ids jsonb; after_order integer:=0;
 boundary_id uuid; boundary_created timestamptz; actual_offset integer;

BEGIN
 current_revision:=public.admin_evaluation_revision();
 IF expected_revision IS NULL OR expected_revision !~ '^[0-9]{1,20}$'
  OR page_ids IS NULL OR cardinality(page_ids) NOT BETWEEN 1 AND 200
  OR EXISTS(SELECT 1 FROM unnest(page_ids) id WHERE id IS NULL)
  OR (SELECT count(DISTINCT id) FROM unnest(page_ids) id)<>cardinality(page_ids)
  OR batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'EVALUATION_QUERY_INVALID';
 END IF;
 IF current_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'EVALUATION_CURSOR_STALE'; END IF;
 IF (SELECT count(*) FROM (SELECT 1 FROM public.restaurants LIMIT 50001) counted)>50000 THEN
  RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
 END IF;
 IF (SELECT count(*) FROM pipeline_control.admin_evaluation_read_index WHERE id=ANY(page_ids))<>cardinality(page_ids) THEN
  RAISE EXCEPTION 'EVALUATION_RECORDS_UNAVAILABLE';
 END IF;
 SELECT array_agg(DISTINCT video) FILTER(WHERE video IS NOT NULL) INTO videos
 FROM pipeline_control.admin_evaluation_read_index WHERE id=ANY(page_ids);
 SELECT jsonb_agg(id ORDER BY id) INTO sorted_ids FROM unnest(page_ids) id;
 SELECT count(*) INTO total_rows FROM pipeline_control.admin_evaluation_read_index WHERE video=ANY(videos);
 IF after_cursor IS NULL THEN
  -- Small catalogs never pay grouping cost. All permitted raw attributes are
  -- retained in positional tuples; field order is versioned by codecVersion.
  IF total_rows<=200 THEN codec:='flat';
  ELSE
   -- Plan only on the first data request. Binary canonical JSON equality is
   -- lossless; this is transport compression, not a warning classifier.
   SELECT count(DISTINCT attrs COLLATE "C"),coalesce(sum(octet_length(attrs)),0),coalesce(max(octet_length(attrs)),0)
   INTO total_groups,input_bytes,largest_row
   FROM (SELECT (to_jsonb(r)-ARRAY['id','created_at','video_id'])::text attrs
    FROM public.admin_evaluation_related_rows r WHERE video_id=ANY(videos)) projected;
   IF input_bytes>67108864 OR largest_row>1048576 THEN
    RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
   END IF;
   -- Conservative admission: at most 1% unique and at most 200 groups.
   -- The flat codec is exact for every other admitted dataset.
   codec:=CASE WHEN total_groups<=200 AND total_groups*100<=total_rows THEN 'grouped' ELSE 'flat' END;
  END IF;
 ELSE
  IF jsonb_typeof(after_cursor)<>'object' OR after_cursor->>'revision' IS DISTINCT FROM current_revision
   OR after_cursor->'pageIds' IS DISTINCT FROM sorted_ids
   OR coalesce(after_cursor->>'mode','') NOT IN ('flat','grouped')
   OR after_cursor->>'totalRows' IS DISTINCT FROM total_rows::text
   OR coalesce(after_cursor->>'offset','') !~ '^[0-9]{1,5}$'
   OR coalesce(after_cursor->>'afterId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR NOT after_cursor ? 'afterCreated' THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
  codec:=after_cursor->>'mode'; after_order:=(after_cursor->>'offset')::integer;
  boundary_id:=(after_cursor->>'afterId')::uuid;
  -- Resolve the boundary from the database; never parse a client timestamp
  -- through Date or trust a cursor's claimed row order/membership.
  SELECT r.created_at INTO boundary_created FROM public.restaurants r
   JOIN pipeline_control.admin_evaluation_read_index i USING(id)
   WHERE r.id=boundary_id AND i.video=ANY(videos);
  IF NOT FOUND OR to_jsonb(boundary_created) IS DISTINCT FROM nullif(after_cursor->'afterCreated','null'::jsonb)
   THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
  SELECT count(*) INTO actual_offset FROM public.restaurants r
   JOIN pipeline_control.admin_evaluation_read_index i USING(id) WHERE i.video=ANY(videos) AND
    (CASE WHEN boundary_created IS NULL THEN r.created_at IS NULL AND r.id<=boundary_id
     ELSE r.created_at IS NULL OR r.created_at>boundary_created OR (r.created_at=boundary_created AND r.id<=boundary_id) END);
  IF after_order<>actual_offset OR after_order NOT BETWEEN 1 AND total_rows
   THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 END IF;
 IF codec='grouped' AND after_cursor IS NOT NULL THEN
  SELECT coalesce(sum(bytes),0),coalesce(max(bytes),0) INTO input_bytes,largest_row
   FROM (SELECT octet_length((to_jsonb(r)-ARRAY['id','created_at','video_id'])::text) bytes
    FROM public.admin_evaluation_related_rows r WHERE video_id=ANY(videos)) sized;
  IF input_bytes>67108864 OR largest_row>1048576 THEN RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED'; END IF;
 END IF;
 IF codec='flat' THEN
  -- Bound the candidate materialization even for a fabricated service cursor.
  -- Size aggregation streams; it does not retain 1000 oversized JSON values.
  WITH keys AS MATERIALIZED (
   SELECT r.id FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index i USING(id)
    WHERE i.video=ANY(videos) AND (after_cursor IS NULL OR
     CASE WHEN boundary_created IS NULL THEN r.created_at IS NOT NULL OR r.id>boundary_id
      ELSE r.created_at<boundary_created OR (r.created_at=boundary_created AND r.id>boundary_id) END)
    ORDER BY r.created_at DESC NULLS FIRST,r.id ASC LIMIT CASE WHEN total_rows<=200 THEN 200 ELSE batch_size END
  ) SELECT coalesce(sum(bytes),0),coalesce(max(bytes),0) INTO input_bytes,largest_row
   FROM (SELECT octet_length(to_jsonb(r)::text) bytes FROM keys JOIN public.admin_evaluation_related_rows r USING(id)) sized;
  IF input_bytes>67108864 OR largest_row>1048576 THEN RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED'; END IF;
  WITH keys AS MATERIALIZED (
   SELECT r.id,r.created_at FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index i USING(id)
    WHERE i.video=ANY(videos) AND (after_cursor IS NULL OR
     CASE WHEN boundary_created IS NULL THEN r.created_at IS NOT NULL OR r.id>boundary_id
      ELSE r.created_at<boundary_created OR (r.created_at=boundary_created AND r.id>boundary_id) END)
    ORDER BY r.created_at DESC NULLS FIRST,r.id ASC LIMIT CASE WHEN total_rows<=200 THEN 200 ELSE batch_size END
  ), items AS MATERIALIZED (
   SELECT k.id,k.created_at,row_number() OVER(ORDER BY k.created_at DESC NULLS FIRST,k.id ASC)::integer+after_order AS ord,
    jsonb_build_array(r.id,r.created_at,r.video_id,r.approved_name,r.origin_name,r.naver_name,r.google_name,
     r.phone,r.status,r.road_address,r.jibun_address,r.youtube_link,r.updated_by_admin_id,r.lat,r.lng,r.evaluation_results,r.name) AS item
   FROM keys k JOIN public.admin_evaluation_related_rows r USING(id)
  ), packed AS (
   SELECT *,sum(octet_length(item::text)+2) OVER(ORDER BY ord) bytes FROM items
  ), selected AS MATERIALIZED (SELECT * FROM packed WHERE bytes<=2097152-16384)
  SELECT jsonb_build_object('codecVersion',1,'mode','flat','revision',current_revision,'pageIds',sorted_ids,
   'totalRows',total_rows,'rowOffset',after_order,'tuples',coalesce((SELECT jsonb_agg(item ORDER BY ord) FROM selected),'[]'::jsonb),
   'hasMore',coalesce((SELECT max(ord) FROM selected),after_order)<total_rows,
   'cursor',(SELECT jsonb_build_object('revision',current_revision,'pageIds',sorted_ids,'mode','flat','totalRows',total_rows,
    'offset',ord,'afterId',id,'afterCreated',created_at) FROM selected ORDER BY ord DESC LIMIT 1),
   'largestRow',coalesce((SELECT max(octet_length(item::text)) FROM items),0)) INTO payload;
  IF (payload->>'largestRow')::integer>1048576 OR octet_length(payload::text)>2097152
   OR (payload->>'hasMore'='true' AND (payload->'tuples'='[]'::jsonb OR total_rows<=200)) THEN
   RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
  END IF;
  RETURN payload-'largestRow';
 END IF;
 WITH ordered AS MATERIALIZED (
  SELECT id, (to_jsonb(r)-ARRAY['id','created_at','video_id'])::text COLLATE "C" AS attrs_key,
   row_number() OVER(ORDER BY created_at DESC,id ASC)::integer AS source_order
  FROM public.admin_evaluation_related_rows r WHERE video_id=ANY(videos)
 ), ranked AS (
  SELECT *,row_number() OVER(PARTITION BY attrs_key ORDER BY source_order) AS sample_rank FROM ordered
 ), grouped AS MATERIALIZED (
  -- No hash-only identity and no linguistic collation: byte-identical raw JSON.
  SELECT attrs_key,min(source_order) AS first_order,count(*)::integer AS row_count,
   array_agg(id ORDER BY id) FILTER(WHERE id=ANY(page_ids)) AS self_ids,
   array_agg(id ORDER BY source_order) FILTER(WHERE sample_rank<=4) AS sample_ids,
   array_agg(source_order ORDER BY source_order) FILTER(WHERE sample_rank<=4) AS sample_orders
  FROM ranked GROUP BY attrs_key
 ), candidates AS MATERIALIZED (
  SELECT * FROM grouped WHERE first_order>after_order ORDER BY first_order LIMIT batch_size
 ), items AS (
  -- Serialize only the bounded candidate batch, not all G groups on every
  -- request. Counts/offsets use the compact relational aggregate above.
  SELECT first_order,jsonb_build_object('attrs',attrs_key::jsonb,'count',row_count,'firstOrder',first_order,
   'selfIds',coalesce(to_jsonb(self_ids),'[]'::jsonb),
   'samples',(SELECT jsonb_agg(jsonb_build_object('id',id,'sourceOrder',source_order) ORDER BY source_order)
     FROM unnest(sample_ids,sample_orders) AS samples(id,source_order))) AS item FROM candidates
 ), packed AS (
  SELECT *,sum(octet_length(item::text)+2) OVER(ORDER BY first_order) AS bytes FROM items
 ), selected AS MATERIALIZED (
  SELECT * FROM packed WHERE bytes<=2097152-16384
 )
 SELECT jsonb_build_object('codecVersion',1,'mode','grouped','revision',current_revision,
  'pageIds',(SELECT jsonb_agg(id ORDER BY id) FROM unnest(page_ids) id),
  'totalRows',(SELECT count(*) FROM ordered),'totalGroups',(SELECT count(*) FROM grouped),
  'groupOffset',(SELECT count(*) FROM grouped WHERE first_order<=after_order),
  'rowOffset',coalesce((SELECT sum(row_count) FROM grouped WHERE first_order<=after_order),0),
  'cursorValid',after_order=0 OR EXISTS(SELECT 1 FROM grouped WHERE first_order=after_order),
  'groups',coalesce((SELECT jsonb_agg(item ORDER BY first_order) FROM selected),'[]'::jsonb),
  'hasMore',EXISTS(SELECT 1 FROM grouped WHERE first_order>coalesce((SELECT max(first_order) FROM selected),after_order)),
  'nextAfterOrder',coalesce((SELECT max(first_order) FROM selected),after_order)) INTO payload;
 IF (payload->>'totalGroups')::integer>200 OR (payload->>'totalGroups')::integer*100>total_rows THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 IF payload->>'cursorValid'<>'true' THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 payload:=payload-'cursorValid';
 SELECT payload||jsonb_build_object('cursor',jsonb_build_object('revision',current_revision,'pageIds',sorted_ids,'mode','grouped',
  'totalRows',total_rows,'offset',payload->'nextAfterOrder','afterId',r.id,'afterCreated',r.created_at)) INTO payload
 FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index i USING(id) WHERE i.video=ANY(videos)
 ORDER BY r.created_at DESC NULLS FIRST,r.id ASC OFFSET ((payload->>'nextAfterOrder')::integer-1) LIMIT 1;
 IF octet_length(payload::text)>2097152 OR (payload->>'hasMore'='true' AND payload->'groups'='[]'::jsonb) THEN
  RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
 END IF;
 RETURN payload;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer) TO service_role;
-- The immediately following invoker-contract migration registers the RPC as
-- privacy_workflow_owner, without granting permanent table/role privileges.
COMMIT;
