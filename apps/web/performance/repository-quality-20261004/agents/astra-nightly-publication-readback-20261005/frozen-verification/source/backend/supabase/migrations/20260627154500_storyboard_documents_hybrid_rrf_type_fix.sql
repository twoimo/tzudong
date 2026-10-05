-- Fix storyboard hybrid RPC return type casts for RRF score.
-- Keeps v1 and v2 live and callable; route rollback remains STORYBOARD_RAG_SEARCH_RPC_VERSION=v1.

create or replace function public.match_storyboard_documents_hybrid(
  p_user_id uuid,
  p_query_embedding vector(1024),
  p_query_sparse jsonb,
  p_dense_weight double precision default 0.65,
  p_match_count integer default 10,
  p_candidate_count integer default 50,
  p_metadata_filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  title text,
  content text,
  metadata jsonb,
  dense_score double precision,
  sparse_score double precision,
  rrf_score double precision,
  weighted_score double precision
)
language plpgsql
stable
security invoker
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_match_count < 1 or p_match_count > 50 then
    raise exception 'p_match_count must be between 1 and 50';
  end if;
  if p_candidate_count < p_match_count or p_candidate_count > 200 then
    raise exception 'p_candidate_count must be between p_match_count and 200';
  end if;
  if jsonb_typeof(p_metadata_filter) is distinct from 'object' then
    raise exception 'p_metadata_filter must be a JSON object';
  end if;

  return query
  with dense_candidates as (
    select
      d.id,
      1 - (d.embedding <=> p_query_embedding) as dense_score,
      row_number() over (order by d.embedding <=> p_query_embedding) as dense_rank
    from public.documents d
    where d.user_id = p_user_id
      and d.metadata @> p_metadata_filter
    order by d.embedding <=> p_query_embedding
    limit p_candidate_count
  ),
  sparse_candidates as (
    select
      d.id,
      public.storyboard_sparse_dot_product(d.sparse_lexical_weights, p_query_sparse) as sparse_score,
      row_number() over (
        order by public.storyboard_sparse_dot_product(d.sparse_lexical_weights, p_query_sparse) desc
      ) as sparse_rank
    from public.documents d
    where d.user_id = p_user_id
      and d.metadata @> p_metadata_filter
      and jsonb_typeof(p_query_sparse) = 'object'
      and p_query_sparse <> '{}'::jsonb
    order by sparse_score desc
    limit p_candidate_count
  ),
  fused as (
    select
      coalesce(dc.id, sc.id) as id,
      coalesce(dc.dense_score, 0.0) as dense_score,
      coalesce(sc.sparse_score, 0.0) as sparse_score,
      (coalesce(1.0 / (60 + dc.dense_rank), 0.0) + coalesce(1.0 / (60 + sc.sparse_rank), 0.0))::double precision as rrf_score
    from dense_candidates dc
    full outer join sparse_candidates sc on sc.id = dc.id
  )
  select
    d.id,
    d.title,
    d.content,
    d.metadata,
    f.dense_score,
    f.sparse_score,
    f.rrf_score,
    ((f.dense_score * p_dense_weight) + (f.sparse_score * (1.0 - p_dense_weight)) + f.rrf_score)::double precision as weighted_score
  from fused f
  join public.documents d on d.id = f.id
  where d.user_id = p_user_id
    and d.metadata @> p_metadata_filter
  order by weighted_score desc
  limit p_match_count;
end;
$$;

create or replace function public.match_storyboard_documents_hybrid_v2(
  p_user_id uuid,
  p_query_embedding vector(1024),
  p_query_sparse jsonb,
  p_dense_weight double precision default 0.65,
  p_match_count integer default 10,
  p_candidate_count integer default 50,
  p_metadata_filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  title text,
  content text,
  metadata jsonb,
  dense_score double precision,
  sparse_score double precision,
  rrf_score double precision,
  weighted_score double precision
)
language plpgsql
stable
security invoker
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_match_count < 1 or p_match_count > 50 then
    raise exception 'p_match_count must be between 1 and 50';
  end if;
  if p_candidate_count < p_match_count or p_candidate_count > 200 then
    raise exception 'p_candidate_count must be between p_match_count and 200';
  end if;
  if jsonb_typeof(p_metadata_filter) is distinct from 'object' then
    raise exception 'p_metadata_filter must be a JSON object';
  end if;
  if jsonb_typeof(p_query_sparse) is not null and jsonb_typeof(p_query_sparse) <> 'object' then
    raise exception 'p_query_sparse must be a JSON object';
  end if;

  return query
  with query_terms as (
    select array_agg(key) as keys
    from jsonb_object_keys(coalesce(p_query_sparse, '{}'::jsonb)) as key
  ),
  dense_candidates as (
    select
      d.id,
      1 - (d.embedding <=> p_query_embedding) as dense_score,
      row_number() over (order by d.embedding <=> p_query_embedding) as dense_rank
    from public.documents d
    where d.user_id = p_user_id
      and d.metadata @> p_metadata_filter
    order by d.embedding <=> p_query_embedding
    limit p_candidate_count
  ),
  sparse_candidates as (
    select
      d.id,
      public.storyboard_sparse_dot_product(d.sparse_lexical_weights, p_query_sparse) as sparse_score,
      row_number() over (
        order by public.storyboard_sparse_dot_product(d.sparse_lexical_weights, p_query_sparse) desc
      ) as sparse_rank
    from public.documents d
    cross join query_terms qt
    where d.user_id = p_user_id
      and d.metadata @> p_metadata_filter
      and coalesce(array_length(qt.keys, 1), 0) > 0
      and d.sparse_lexical_weights ?| qt.keys
    order by sparse_score desc
    limit p_candidate_count
  ),
  fused as (
    select
      coalesce(dc.id, sc.id) as id,
      coalesce(dc.dense_score, 0.0) as dense_score,
      coalesce(sc.sparse_score, 0.0) as sparse_score,
      (coalesce(1.0 / (60 + dc.dense_rank), 0.0) + coalesce(1.0 / (60 + sc.sparse_rank), 0.0))::double precision as rrf_score
    from dense_candidates dc
    full outer join sparse_candidates sc on sc.id = dc.id
  )
  select
    d.id,
    d.title,
    d.content,
    d.metadata,
    f.dense_score,
    f.sparse_score,
    f.rrf_score,
    ((f.dense_score * p_dense_weight) + (f.sparse_score * (1.0 - p_dense_weight)) + f.rrf_score)::double precision as weighted_score
  from fused f
  join public.documents d on d.id = f.id
  where d.user_id = p_user_id
    and d.metadata @> p_metadata_filter
  order by weighted_score desc
  limit p_match_count;
end;
$$;

revoke all on function public.match_storyboard_documents_hybrid(uuid, vector(1024), jsonb, double precision, integer, integer, jsonb) from public, anon;
grant execute on function public.match_storyboard_documents_hybrid(uuid, vector(1024), jsonb, double precision, integer, integer, jsonb) to authenticated, service_role;

revoke all on function public.match_storyboard_documents_hybrid_v2(uuid, vector(1024), jsonb, double precision, integer, integer, jsonb) from public, anon;
grant execute on function public.match_storyboard_documents_hybrid_v2(uuid, vector(1024), jsonb, double precision, integer, integer, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
