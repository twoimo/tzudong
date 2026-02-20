-- 1. 하이브리드 검색 함수 (Dense 0.6 + Sparse 0.4)
-- 설명: Dense 벡터 유사도와 Sparse 토큰 매칭을 결합한 하이브리드 검색을 수행합니다.
--       추가 기능: 각 video_id에 대해 가장 최신(MAX)의 recollect_id를 가진 데이터만 검색합니다. (중복 제거)
-- 인덱스: idx_transcript_embeddings_bge_video_id
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
