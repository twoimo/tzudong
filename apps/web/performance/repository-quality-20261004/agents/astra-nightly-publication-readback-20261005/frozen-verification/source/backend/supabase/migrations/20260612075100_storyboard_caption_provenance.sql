-- Storyboard peak-frame caption provider provenance.
-- Backward-compatible: existing LLaVA rows remain readable and are marked as legacy/offline.

alter table public.video_frame_captions
  add column if not exists caption_provider text,
  add column if not exists caption_model text,
  add column if not exists caption_auth_mode text,
  add column if not exists caption_provenance jsonb not null default '{}'::jsonb,
  add column if not exists caption_generated_at timestamptz,
  add column if not exists caption_schema_version integer not null default 1;

update public.video_frame_captions
set
  caption_provider = coalesce(caption_provider, 'llava_next_video'),
  caption_auth_mode = coalesce(caption_auth_mode, 'unknown_legacy'),
  caption_schema_version = coalesce(caption_schema_version, 1),
  caption_provenance = coalesce(caption_provenance, '{}'::jsonb)
where
  caption_provider is null
  or caption_auth_mode is null
  or caption_schema_version is null
  or caption_provenance is null;

alter table public.video_frame_captions
  alter column caption_provider set default 'llava_next_video',
  alter column caption_auth_mode set default 'unknown_legacy',
  alter column caption_schema_version set default 1,
  alter column caption_provenance set default '{}'::jsonb;

comment on column public.video_frame_captions.caption_provider is
  'Caption provider id: llava_next_video, openai_vision_gpt55, or codex_cli_vision_gpt55.';
comment on column public.video_frame_captions.caption_auth_mode is
  'Sanitized auth mode class only: platform_api_key, codex_cli_oauth_local, offline_local, or unknown_legacy.';
comment on column public.video_frame_captions.caption_provenance is
  'Hash-only/public-safe caption provenance. Do not store secrets or absolute local paths.';
comment on column public.video_frame_captions.caption_schema_version is
  'Caption schema version. Legacy LLaVA rows are version 1; provider-aware rows are version 2.';
