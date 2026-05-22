-- Store auditable popular-search rank snapshots so the UI can show movement
-- only when there is historical evidence. The public table is read-only to
-- client roles; writes stay in trusted server/ops contexts.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

do $$
begin
  if to_regclass('public.restaurants') is null then
    raise notice 'Skipping restaurant_popular_rank_snapshots because public.restaurants is missing.';
    return;
  end if;

  create table if not exists public.restaurant_popular_rank_snapshots (
    id uuid primary key default gen_random_uuid(),
    scope_key text not null,
    period_start date not null,
    period_end date not null,
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    rank integer not null check (rank > 0),
    weekly_search_count integer not null default 0 check (weekly_search_count >= 0),
    captured_at timestamptz not null default timezone('utc', now()),
    constraint restaurant_popular_rank_snapshots_period_check check (period_end > period_start),
    constraint restaurant_popular_rank_snapshots_restaurant_unique unique (scope_key, period_start, restaurant_id),
    constraint restaurant_popular_rank_snapshots_rank_unique unique (scope_key, period_start, rank)
  );

  create index if not exists restaurant_popular_rank_snapshots_lookup_idx
    on public.restaurant_popular_rank_snapshots (scope_key, period_start desc, rank asc);

  create index if not exists restaurant_popular_rank_snapshots_restaurant_idx
    on public.restaurant_popular_rank_snapshots (restaurant_id, period_start desc);

  alter table public.restaurant_popular_rank_snapshots enable row level security;

  drop policy if exists "Public can read popular rank snapshots" on public.restaurant_popular_rank_snapshots;
  create policy "Public can read popular rank snapshots"
    on public.restaurant_popular_rank_snapshots
    for select
    using (true);

  revoke all on table public.restaurant_popular_rank_snapshots from public;
  revoke all on table public.restaurant_popular_rank_snapshots from anon;
  revoke all on table public.restaurant_popular_rank_snapshots from authenticated;
  grant select on table public.restaurant_popular_rank_snapshots to anon;
  grant select on table public.restaurant_popular_rank_snapshots to authenticated;
end $$;

create or replace function private.capture_restaurant_popular_rank_snapshot(
  p_scope_key text default 'domestic:all',
  p_selected_region text default null,
  p_is_korean_only boolean default true,
  p_limit integer default 20,
  p_period_start date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_inserted integer := 0;
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;

  if to_regclass('public.restaurant_popular_rank_snapshots') is null then
    raise exception 'public.restaurant_popular_rank_snapshots does not exist';
  end if;

  delete from public.restaurant_popular_rank_snapshots
  where scope_key = p_scope_key
    and period_start = p_period_start;

  with ranked_restaurants as (
    select
      r.id as restaurant_id,
      row_number() over (
        order by coalesce(r.weekly_search_count, 0) desc, r.updated_at desc, r.id
      )::integer as rank,
      coalesce(r.weekly_search_count, 0)::integer as weekly_search_count
    from public.restaurants r
    where r.status = 'approved'
      and coalesce(r.weekly_search_count, 0) > 0
      and (
        p_selected_region is null
        or coalesce(r.road_address, r.jibun_address, r.english_address, '') ilike '%' || p_selected_region || '%'
      )
      and (
        not p_is_korean_only
        or coalesce(r.road_address, r.jibun_address, r.english_address, '') ~
          '(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)'
      )
    order by coalesce(r.weekly_search_count, 0) desc, r.updated_at desc, r.id
    limit p_limit
  )
  insert into public.restaurant_popular_rank_snapshots (
    scope_key,
    period_start,
    period_end,
    restaurant_id,
    rank,
    weekly_search_count
  )
  select
    p_scope_key,
    p_period_start,
    p_period_start + 1,
    restaurant_id,
    rank,
    weekly_search_count
  from ranked_restaurants;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function private.capture_restaurant_popular_rank_snapshot(text, text, boolean, integer, date) from public;
revoke all on function private.capture_restaurant_popular_rank_snapshot(text, text, boolean, integer, date) from anon;
revoke all on function private.capture_restaurant_popular_rank_snapshot(text, text, boolean, integer, date) from authenticated;
grant usage on schema private to service_role;
grant execute on function private.capture_restaurant_popular_rank_snapshot(text, text, boolean, integer, date) to service_role;
