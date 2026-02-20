-- 8. 쿼리 기반 video_id 검색 (하이브리드 검색 + 중복 제거)
-- 설명: 쿼리로 관련 video_id 목록을 검색합니다. 각 video_id별로 가장 높은 점수의 결과만 반환합니다.
-- 인덱스: idx_transcript_embeddings_bge_video_id
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
