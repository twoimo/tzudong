-- 인덱스 생성 (성능 최적화)
create index if not exists idx_transcript_embeddings_bge_video_id on transcript_embeddings_bge(video_id);

-- 1.5 하이브리드 검색 함수 (Dense 0.6 + Sparse 0.4)
-- 설명: Dense 벡터 유사도와 Sparse 토큰 매칭을 결합한 하이브리드 검색을 수행합니다.
--       추가 기능: 각 video_id에 대해 가장 최신(MAX)의 recollect_id를 가진 데이터만 검색합니다. (중복 제거)
create or replace function match_documents_hybrid (
  query_embedding vector(1024),   -- 검색어의 Dense 임베딩 (1024차원)
  query_sparse jsonb,             -- 검색어의 Sparse 임베딩 (토큰:가중치 맵)
  dense_weight float default 0.6, -- Dense 점수 반영 비율 (0.0 ~ 1.0)
  match_threshold float default 0.5, -- 최소 유사도 기준
  match_count int default 20      -- 반환할 결과 개수
) returns table (
  id bigint,
  video_id text,
  chunk_index int,
  recollect_id int,
  page_content text,
  metadata jsonb,
  embedding vector(1024),
  dense_score float,
  sparse_score float,
  hybrid_score float
) language plpgsql stable as $$
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



-- 2. 비디오 캡션 조회 함수 (시간 범위 기준)
-- 설명: 특정 비디오의 특정 시간 범위에 겹치는 캡션(시각적 묘사)을 조회합니다. 식당 방문 증거 등으로 활용 가능합니다.
-- 수정: video_frame_captions 테이블의 duration 필드를 사용하여 동일 duration의 가장 최신 recollect_id를 찾습니다.
create or replace function get_video_captions_for_range (
  p_video_id text,
  p_recollect_id int,
  p_start_sec int,
  p_end_sec int
) returns setof video_frame_captions language plpgsql stable as $$
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


-- 3. 카테고리별 음식점 검색 함수
-- 설명: categories 배열에 특정 키워드가 포함된 음식점을 검색합니다. (approved 된 음식점만 조회, 이름은 approved_name 사용)
create or replace function search_restaurants_by_category (
  p_category text,
  p_limit int default 10
) returns table (
  id uuid,
  name text,
  categories text[],
  youtube_link text,
  description_map_url text,
  video_id text
) language sql stable as $$
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


-- 4. 필터링된 비디오 메타데이터 조회 함수
-- 설명: 조회수, 게시일자 등을 기준으로 필터링/정렬하여 비디오 목록을 가져옵니다. "최신 영상", "인기 영상" 조회 시 사용합니다.
create or replace function get_video_metadata_filtered (
  min_view_count int default 0,
  p_limit int default 5,
  p_order_by text default 'view_count'
) returns setof videos language plpgsql stable as $$
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


-- 5. 음식점명 또는 video_id로 카테고리 조회
-- 설명: 특정 음식점의 카테고리를 가져옵니다. 카테고리 확장 검색에 사용됩니다.
create or replace function get_categories_by_restaurant_name_or_youtube_url (
  p_restaurant_name text default null,
  p_video_id text default null
) returns text[] language sql stable as $$
  select array_agg(distinct c)
  from restaurants r, unnest(r.categories) as c
  where r.status = 'approved'
    and (p_restaurant_name is null or r.approved_name = p_restaurant_name)
    and (p_video_id is null or substring(r.youtube_link from 'v=([^&]+)') = p_video_id);
$$;


-- 6. 음식점 이름 검색
-- 설명: 사용자가 특정 식당 이름을 직접 언급했을 때("엽기떡볶이 어디 나왔어?") 검색합니다.
-- LLM이 get_all_approved_restaurant_names로 먼저 목록을 받아온 후, 매칭된 이름으로 이 함수를 호출합니다.
create or replace function search_restaurants_by_name (
  keyword text,
  p_limit int default 5
) returns table (
  id uuid,
  name text,
  categories text[],
  youtube_link text,
  video_id text,
  tzuyang_review text
) language sql stable as $$
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


-- 7. 승인된 모든 음식점명 조회
-- 설명: LLM이 사용자 입력과 매칭할 음식점명 목록을 가져옵니다.
-- 사용법: LLM은 이 목록을 참조하여 사용자 입력에서 음식점명을 추출한 후, search_restaurants_by_name을 호출합니다.
create or replace function get_all_approved_restaurant_names ()
returns table (
  name text,
  categories text[]
) language sql stable as $$
  select
    r.approved_name as name,
    r.categories
  from restaurants r
  where r.status = 'approved'
  order by r.approved_name;
$$;


-- 8. 쿼리 기반 video_id 검색 (하이브리드 검색 + 중복 제거)
-- 설명: 쿼리로 관련 video_id 목록을 검색합니다. 각 video_id별로 가장 높은 점수의 결과만 반환합니다.
create or replace function search_video_ids_by_query (
  query_embedding vector(1024),
  query_sparse jsonb,
  dense_weight float default 0.6,
  match_threshold float default 0.5,
  match_count int default 10
) returns table (
  video_id text,
  recollect_id int,
  best_score float,
  sample_content text,
  has_peak boolean
) language plpgsql stable as $$
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
