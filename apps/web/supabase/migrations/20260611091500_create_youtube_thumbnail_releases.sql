-- Durable current-release registry for the admin YouTube thumbnail generator.
-- Browser clients never access this table/storage bucket directly; admin API
-- routes use the service role and return only redacted proxy URLs.

create table if not exists public.youtube_thumbnail_releases (
  id uuid primary key default gen_random_uuid(),
  release_key text not null default 'youtube-thumbnail-generator/current',
  status text not null default 'active' check (status in ('active', 'superseded', 'revoked')),
  candidate_id text not null,
  source_manifest_id text not null,
  source_image_id text not null,
  storage_bucket text not null default 'youtube-thumbnail-releases' check (storage_bucket = 'youtube-thumbnail-releases'),
  storage_object_path text not null,
  browser_image_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  width integer not null default 1280 check (width = 1280),
  height integer not null default 720 check (height = 720),
  mime_type text not null default 'image/png' check (mime_type = 'image/png'),
  provider_id text not null default 'local-codex' check (provider_id = 'local-codex'),
  model text not null default 'gpt-image-2' check (model = 'gpt-image-2'),
  model_provenance text not null default 'exact' check (model_provenance = 'exact'),
  score numeric not null check (score >= 90),
  issue_tags jsonb not null default '["none"]'::jsonb,
  text_layers jsonb not null default '[]'::jsonb,
  canvas jsonb not null default '{"width":1280,"height":720}'::jsonb,
  source_quality_gate jsonb not null default '{}'::jsonb,
  published_by uuid null references auth.users(id) on delete set null,
  published_at timestamptz not null default timezone('utc', now()),
  superseded_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint youtube_thumbnail_releases_issue_tags_exact check (issue_tags = '["none"]'::jsonb),
  constraint youtube_thumbnail_releases_browser_proxy check (browser_image_path ~ '^/api/admin/youtube-thumbnail-generator/releases/assets/[0-9a-f-]{36}$'),
  constraint youtube_thumbnail_releases_storage_object_path check (storage_object_path ~ '^youtube-thumbnail-generator/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$'),
  constraint youtube_thumbnail_releases_no_raw_paths check (
    storage_object_path not like '%.omx/%'
    and storage_object_path not like '%/public/%'
    and browser_image_path not like '%.omx/%'
    and browser_image_path not like '%/public/%'
  )
);

create unique index if not exists youtube_thumbnail_releases_active_key_idx
  on public.youtube_thumbnail_releases (release_key)
  where status = 'active';

create index if not exists youtube_thumbnail_releases_key_published_idx
  on public.youtube_thumbnail_releases (release_key, published_at desc);

create index if not exists youtube_thumbnail_releases_candidate_idx
  on public.youtube_thumbnail_releases (candidate_id);

alter table public.youtube_thumbnail_releases enable row level security;

revoke all on table public.youtube_thumbnail_releases from public;
revoke all on table public.youtube_thumbnail_releases from anon;
revoke all on table public.youtube_thumbnail_releases from authenticated;
grant select, insert, update, delete on table public.youtube_thumbnail_releases to service_role;

create or replace function public.publish_youtube_thumbnail_release(
  p_id uuid,
  p_release_key text,
  p_candidate_id text,
  p_source_manifest_id text,
  p_source_image_id text,
  p_storage_bucket text,
  p_storage_object_path text,
  p_browser_image_path text,
  p_sha256 text,
  p_score numeric,
  p_issue_tags jsonb,
  p_text_layers jsonb,
  p_canvas jsonb,
  p_source_quality_gate jsonb,
  p_published_by uuid,
  p_published_at timestamptz
)
returns public.youtube_thumbnail_releases
language plpgsql
set search_path = public
as $$
declare
  v_release public.youtube_thumbnail_releases;
begin
  update public.youtube_thumbnail_releases
     set status = 'superseded',
         superseded_at = p_published_at,
         updated_at = p_published_at
   where release_key = p_release_key
     and status = 'active';

  insert into public.youtube_thumbnail_releases (
    id,
    release_key,
    status,
    candidate_id,
    source_manifest_id,
    source_image_id,
    storage_bucket,
    storage_object_path,
    browser_image_path,
    sha256,
    width,
    height,
    mime_type,
    provider_id,
    model,
    model_provenance,
    score,
    issue_tags,
    text_layers,
    canvas,
    source_quality_gate,
    published_by,
    published_at,
    created_at,
    updated_at
  )
  values (
    p_id,
    p_release_key,
    'active',
    p_candidate_id,
    p_source_manifest_id,
    p_source_image_id,
    p_storage_bucket,
    p_storage_object_path,
    p_browser_image_path,
    p_sha256,
    1280,
    720,
    'image/png',
    'local-codex',
    'gpt-image-2',
    'exact',
    p_score,
    p_issue_tags,
    p_text_layers,
    p_canvas,
    p_source_quality_gate,
    p_published_by,
    p_published_at,
    p_published_at,
    p_published_at
  )
  returning * into v_release;

  return v_release;
end;
$$;

revoke all on function public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('youtube-thumbnail-releases', 'youtube-thumbnail-releases', false, 10485760, array['image/png'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = timezone('utc', now());

notify pgrst, 'reload schema';
