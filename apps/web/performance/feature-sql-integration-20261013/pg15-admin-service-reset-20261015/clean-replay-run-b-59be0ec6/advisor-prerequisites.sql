SET LOCAL search_path = pg_catalog, public, extensions;

CREATE FUNCTION public.get_all_approved_restaurant_names() RETURNS TABLE(name text, categories text[])
    LANGUAGE sql STABLE
    AS $$
  select
    r.approved_name as name,
    r.categories
  from restaurants r
  where r.status = 'approved'
  order by r.approved_name;
$$;

ALTER FUNCTION public.get_all_approved_restaurant_names() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_all_approved_restaurant_names() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_categories_by_restaurant_name_or_youtube_url(p_restaurant_name text DEFAULT NULL::text, p_video_id text DEFAULT NULL::text) RETURNS text[]
    LANGUAGE sql STABLE
    AS $$
  select array_agg(distinct c)
  from restaurants r, unnest(r.categories) as c
  where r.status = 'approved'
    and (p_restaurant_name is null or r.approved_name = p_restaurant_name)
    and (p_video_id is null or substring(r.youtube_link from 'v=([^&]+)') = p_video_id);
$$;

ALTER FUNCTION public.get_categories_by_restaurant_name_or_youtube_url(text,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_categories_by_restaurant_name_or_youtube_url(text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_video_captions_for_range(p_video_id text, p_recollect_id integer, p_start_sec integer, p_end_sec integer) RETURNS SETOF public.video_frame_captions
    LANGUAGE plpgsql STABLE
    AS $$
declare
  v_target_recollect_id int;
  v_target_duration int;
begin
  -- 1. 요청받은 recollect_id에 해당하는 캡션 데이터가 있는지 확인
  perform 1 from video_frame_captions
  where video_id = p_video_id and recollect_id = p_recollect_id
  limit 1;

  if found then
    v_target_recollect_id := p_recollect_id;
  else
    -- 2. 없다면, video_frame_captions에서 해당 video_id의 duration을 확인
    select duration into v_target_duration
    from video_frame_captions
    where video_id = p_video_id
    limit 1;

    -- 3. 같은 duration을 가진 것 중 가장 최신(큰) recollect_id 찾기
    --    duration 매칭이 안 되면 결과 없음 (fallback 없음)
    if v_target_duration is not null then
      select max(recollect_id) into v_target_recollect_id
      from video_frame_captions
      where video_id = p_video_id and duration = v_target_duration;
    end if;
  end if;

  return query
  select *
  from video_frame_captions
  where video_id = p_video_id
    and recollect_id = v_target_recollect_id
    -- overlaps 연산자 (start1, end1) overlaps (start2, end2) 대체
    -- 조건: r.start_sec < p_end_sec AND p_start_sec < r.end_sec
    and start_sec < p_end_sec 
    and p_start_sec < end_sec
  order by rank asc;
end;
$$;

ALTER FUNCTION public.get_video_captions_for_range(text,integer,integer,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_video_captions_for_range(text,integer,integer,integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_video_metadata_filtered(min_view_count integer DEFAULT 0, p_limit integer DEFAULT 5, p_order_by text DEFAULT 'view_count'::text) RETURNS SETOF public.videos
    LANGUAGE plpgsql STABLE
    AS $$
begin
  return query
  select *
  from videos
  where view_count >= min_view_count
  order by
    case when p_order_by = 'view_count' then view_count end desc nulls last,
    case when p_order_by = 'published_at' then published_at end desc nulls last,
    case when p_order_by = 'comment_count' then comment_count end desc nulls last
  limit p_limit;
end;
$$;

ALTER FUNCTION public.get_video_metadata_filtered(integer,integer,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_video_metadata_filtered(integer,integer,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.match_documents_bge(query_embedding extensions.vector, match_threshold double precision, match_count integer, filter jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(id bigint, video_id text, chunk_index integer, recollect_id integer, page_content text, metadata jsonb, embedding extensions.vector, similarity double precision)
    LANGUAGE plpgsql STABLE
    AS $$
begin
  return query
  select
    t.id,
    t.video_id,
    t.chunk_index,
    t.recollect_id,
    t.page_content,
    t.metadata,
    t.embedding,
    1 - (t.embedding <=> query_embedding) as similarity
  from transcript_embeddings_bge as t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;

ALTER FUNCTION public.match_documents_bge(extensions.vector,double precision,integer,jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.match_documents_bge(extensions.vector,double precision,integer,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.match_documents_hybrid(query_embedding extensions.vector, query_sparse jsonb, dense_weight double precision DEFAULT 0.6, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 20) RETURNS TABLE(id bigint, video_id text, chunk_index integer, recollect_id integer, page_content text, metadata jsonb, embedding extensions.vector, dense_score double precision, sparse_score double precision, hybrid_score double precision)
    LANGUAGE plpgsql STABLE
    AS $$
#variable_conflict use_column
begin
  return query
  with 
  -- [Step 1] 벡터 검색으로 후보군 넉넉하게 추출 (인덱스 활용)
  candidates as (
    select
      teb.id, teb.video_id, teb.chunk_index, teb.recollect_id,
      teb.page_content, teb.metadata, teb.embedding, teb.sparse_embedding,
      1 - (teb.embedding <=> query_embedding) as dense_score
    from transcript_embeddings_bge teb
    where 1 - (teb.embedding <=> query_embedding) > match_threshold
    order by teb.embedding <=> query_embedding
    limit match_count * 5 -- 후보군 여유있게 (중복 및 구버전 필터링 대비)
  ),
  
  -- [Step 2] 최신 버전 필터링 (Subquery)
  -- 1차로 뽑힌 후보군에 대해서만 최신 버전인지 검증
  valid_candidates as (
    select c.*
    from candidates c
    where c.recollect_id = (
        select max(recollect_id) 
        from transcript_embeddings_bge 
        where video_id = c.video_id
    )
  ),

  -- [Step 3] Sparse 점수 계산 및 Hybrid 점수 산출
  scored as (
    select 
      vc.id, vc.video_id, vc.chunk_index, vc.recollect_id,
      vc.page_content, vc.metadata, vc.embedding,
      vc.dense_score,
      coalesce(
        (select sum((vc.sparse_embedding->>k)::float * (query_sparse->>k)::float)
         from jsonb_object_keys(query_sparse) k
         where vc.sparse_embedding ? k), 0
      ) as sparse_score
    from valid_candidates vc
  )
  
  -- [Step 4] 최종 점수 합산 및 반환
  select 
    s.id, s.video_id, s.chunk_index, s.recollect_id,
    s.page_content, s.metadata, s.embedding,
    s.dense_score::float,
    s.sparse_score::float,
    (s.dense_score * dense_weight + s.sparse_score * (1 - dense_weight))::float as hybrid_score
  from scored s
  order by hybrid_score desc
  limit match_count;
end;
$$;

ALTER FUNCTION public.match_documents_hybrid(extensions.vector,jsonb,double precision,double precision,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.match_documents_hybrid(extensions.vector,jsonb,double precision,double precision,integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.search_restaurants_by_category(p_category text, p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, name text, categories text[], youtube_link text, description_map_url text, video_id text)
    LANGUAGE sql STABLE
    AS $$
  select
    r.id,
    r.approved_name as name,
    r.categories,
    r.youtube_link,
    r.description_map_url,
    -- youtube_link에서 video_id 추출 (간단한 파싱, Regex 필요시 조정)
    substring(r.youtube_link from 'v=([^&]+)') as video_id
  from restaurants r
  where r.status = 'approved'
    and p_category = any(r.categories)
  limit p_limit;
$$;

ALTER FUNCTION public.search_restaurants_by_category(text,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.search_restaurants_by_category(text,integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.search_restaurants_by_name(keyword text, p_limit integer DEFAULT 5) RETURNS TABLE(id uuid, name text, categories text[], youtube_link text, video_id text, tzuyang_review text)
    LANGUAGE sql STABLE
    AS $$
  select
    r.id,
    r.approved_name as name,
    r.categories,
    r.youtube_link,
    substring(r.youtube_link from 'v=([^&]+)') as video_id,
    r.tzuyang_review
  from restaurants r
  where r.status = 'approved'
    and (r.approved_name ilike '%' || keyword || '%')
  limit p_limit;
$$;

ALTER FUNCTION public.search_restaurants_by_name(text,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.search_restaurants_by_name(text,integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.search_video_ids_by_query(query_embedding extensions.vector, query_sparse jsonb, dense_weight double precision DEFAULT 0.6, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10) RETURNS TABLE(video_id text, recollect_id integer, best_score double precision, sample_content text, has_peak boolean)
    LANGUAGE plpgsql STABLE
    AS $$
#variable_conflict use_column
begin
  return query
  with 
  candidates as (
    select
      teb.video_id, teb.recollect_id, teb.page_content, teb.metadata, teb.embedding, teb.sparse_embedding,
      1 - (teb.embedding <=> query_embedding) as dense_score
    from transcript_embeddings_bge teb
    where 1 - (teb.embedding <=> query_embedding) > match_threshold
    order by teb.embedding <=> query_embedding
    limit match_count * 5
  ),
  valid_candidates as (
    select c.*
    from candidates c
    where c.recollect_id = (
        select max(recollect_id) 
        from transcript_embeddings_bge 
        where video_id = c.video_id
    )
  ),
  scored as (
    select 
      vc.video_id,
      vc.recollect_id,
      vc.page_content,
      vc.metadata,
      (vc.dense_score * dense_weight) +
      coalesce(
        (select sum((vc.sparse_embedding->>k)::float * (query_sparse->>k)::float)
         from jsonb_object_keys(query_sparse) k
         where vc.sparse_embedding ? k), 0
      ) * (1 - dense_weight) as score
    from valid_candidates vc
  ),
  ranked as (
    select 
      s.video_id,
      s.recollect_id,
      s.score,
      s.page_content,
      s.metadata,
      row_number() over (partition by s.video_id order by s.score desc) as rn
    from scored s
  )
  select 
    r.video_id,
    r.recollect_id,
    r.score::float as best_score,
    left(r.page_content, 150) as sample_content,
    (r.metadata->>'is_peak')::boolean as has_peak
  from ranked r
  where r.rn = 1
  order by r.score desc
  limit match_count;
end;
$$;

ALTER FUNCTION public.search_video_ids_by_query(extensions.vector,jsonb,double precision,double precision,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.search_video_ids_by_query(extensions.vector,jsonb,double precision,double precision,integer) FROM PUBLIC, anon, authenticated, service_role;
