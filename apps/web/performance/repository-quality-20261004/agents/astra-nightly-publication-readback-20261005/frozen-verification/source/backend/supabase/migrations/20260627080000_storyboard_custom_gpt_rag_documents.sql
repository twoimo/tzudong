-- Storyboard Custom GPT Actions RAG document store.
-- Heavy BGE-M3 embedding/reranking is performed by the Python FastAPI worker;
-- Postgres stores dense vectors and sparse lexical weights, then fuses scores.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null,
  title text not null check (char_length(trim(title)) > 0),
  content text not null check (char_length(trim(content)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1024) not null,
  sparse_lexical_weights jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_user_created_idx
  on public.documents(user_id, created_at desc);

create unique index if not exists documents_user_external_id_idx
  on public.documents(user_id, external_id);

create index if not exists documents_metadata_gin_idx
  on public.documents using gin(metadata);

create index if not exists documents_sparse_lexical_weights_gin_idx
  on public.documents using gin(sparse_lexical_weights jsonb_path_ops);

create index if not exists documents_embedding_hnsw_idx
  on public.documents using hnsw (embedding vector_cosine_ops);

create or replace function public.set_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row execute function public.set_documents_updated_at();

alter table public.documents enable row level security;

create policy "documents_select_own"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "documents_insert_own"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "documents_update_own"
  on public.documents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "documents_delete_own"
  on public.documents for delete
  using (auth.uid() = user_id);

create or replace function public.storyboard_sparse_dot_product(
  document_weights jsonb,
  query_weights jsonb
)
returns double precision
language sql
immutable
as $$
  select coalesce(
    sum(
      coalesce((document_weights ->> key)::double precision, 0.0)
      * coalesce((query_weights ->> key)::double precision, 0.0)
    ),
    0.0
  )
  from jsonb_object_keys(query_weights) as key
  where document_weights ? key;
$$;

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

revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;
grant execute on function public.match_storyboard_documents_hybrid(uuid, vector(1024), jsonb, double precision, integer, integer, jsonb) to authenticated;
