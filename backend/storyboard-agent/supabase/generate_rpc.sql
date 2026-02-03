-- 1. 유사도 검색 함수 (BGE-M3 모델용, 1024차원)
-- 설명: 자막 임베딩을 벡터 검색하여 유사한 자막 청크를 반환합니다. embedding 벡터도 반환하여 MMR 알고리즘 적용이 가능합니다.
create or replace function match_documents_bge (
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  filter jsonb default '{}'
) returns table (
  id bigint,
  video_id text,
  chunk_index int,
  recollect_id int,
  page_content text,
  metadata jsonb,
  embedding vector(1024),
  similarity float
) language plpgsql stable as $$
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


-- 2. 비디오 캡션 조회 함수 (시간 범위 기준)
-- 설명: 특정 비디오의 특정 시간 범위에 겹치는 캡션(시각적 묘사)을 조회합니다. 식당 방문 증거 등으로 활용 가능합니다.
create or replace function get_video_captions_for_range (
  p_video_id text,
  p_recollect_id int,
  p_start_sec int,
  p_end_sec int
) returns setof video_frame_captions language sql stable as $$
  select *
  from video_frame_captions
  where video_id = p_video_id
    and recollect_id = p_recollect_id
    and (start_sec, end_sec) overlaps (p_start_sec, p_end_sec)
  order by rank asc, start_sec asc;
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





-- 6. 음식점 이름 검색 [추가됨]
-- 설명: 사용자가 특정 식당 이름을 직접 언급했을 때("엽기떡볶이 어디 나왔어?") 검색합니다.
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
    and (r.approved_name ilike '%' || keyword || '%' or r.origin_name ilike '%' || keyword || '%')
  limit p_limit;
$$;
