create table if not exists public.admin_ai_settings (
  id text primary key,
  routing_mode text not null default 'automatic' check (routing_mode in ('automatic', 'manual')),
  manual_provider text null check (manual_provider in ('gemini', 'openai', 'nvidia_nim')),
  manual_model text null,
  candidate_models jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by_admin_id uuid null references auth.users(id) on delete set null,
  constraint admin_ai_settings_id_check check (id = 'ocr')
);

create table if not exists public.admin_ai_provider_keys (
  provider text primary key check (provider in ('gemini', 'openai', 'nvidia_nim')),
  -- Stored as an AES-GCM encrypted blob by the web admin API.
  -- Legacy plaintext rows are read for backward compatibility but new writes are encrypted.
  api_key text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by_admin_id uuid null references auth.users(id) on delete set null
);

create or replace function public.set_admin_ai_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_admin_ai_settings_updated_at on public.admin_ai_settings;
create trigger set_admin_ai_settings_updated_at
before update on public.admin_ai_settings
for each row
execute function public.set_admin_ai_updated_at();

drop trigger if exists set_admin_ai_provider_keys_updated_at on public.admin_ai_provider_keys;
create trigger set_admin_ai_provider_keys_updated_at
before update on public.admin_ai_provider_keys
for each row
execute function public.set_admin_ai_updated_at();

alter table public.admin_ai_settings enable row level security;
alter table public.admin_ai_provider_keys enable row level security;
