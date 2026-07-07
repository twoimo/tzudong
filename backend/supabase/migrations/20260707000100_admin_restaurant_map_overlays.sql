-- Admin-only restaurant map overlays for trend/seasonal map annotations.
-- Public clients must not receive direct table grants; access is mediated by guarded admin APIs.

create table if not exists public.admin_restaurant_map_overlays (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  overlay_type text not null check (overlay_type in ('trend', 'seasonal')),
  label text not null check (char_length(trim(label)) between 1 and 80),
  description text null check (description is null or char_length(description) <= 500),
  active_from timestamptz null,
  active_until timestamptz null,
  evidence jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by_admin_id uuid null references auth.users(id) on delete set null,
  updated_by_admin_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint admin_restaurant_map_overlays_active_window_check
    check (active_from is null or active_until is null or active_from <= active_until),
  primary key (restaurant_id, overlay_type)
);

create index if not exists admin_restaurant_map_overlays_active_idx
  on public.admin_restaurant_map_overlays (is_active, overlay_type, active_from, active_until);

create index if not exists admin_restaurant_map_overlays_updated_idx
  on public.admin_restaurant_map_overlays (updated_at desc);

alter table public.admin_restaurant_map_overlays enable row level security;

revoke all on table public.admin_restaurant_map_overlays from anon;
revoke all on table public.admin_restaurant_map_overlays from authenticated;
grant all on table public.admin_restaurant_map_overlays to service_role;

create or replace function public.set_admin_restaurant_map_overlays_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_admin_restaurant_map_overlays_updated_at on public.admin_restaurant_map_overlays;
create trigger set_admin_restaurant_map_overlays_updated_at
before update on public.admin_restaurant_map_overlays
for each row
execute function public.set_admin_restaurant_map_overlays_updated_at();
