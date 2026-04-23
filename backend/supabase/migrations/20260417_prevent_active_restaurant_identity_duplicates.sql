-- Prevent duplicate active restaurant rows for the same YouTube video + resolved restaurant name.
-- This migration:
-- 1) normalizes the identity key helpers,
-- 2) soft-deletes lower-priority duplicate active rows after merging safe missing fields,
-- 3) adds a partial unique index so the duplicate cannot reappear in active rows.

create or replace function public.extract_youtube_video_id(raw_url text)
returns text
language sql
immutable
as $$
  select coalesce(
    (regexp_match(coalesce(raw_url, ''), '[?&]v=([A-Za-z0-9_-]{6,})'))[1],
    (regexp_match(coalesce(raw_url, ''), 'youtu\.be/([A-Za-z0-9_-]{6,})'))[1],
    (regexp_match(coalesce(raw_url, ''), 'youtube\.com/shorts/([A-Za-z0-9_-]{6,})'))[1],
    (regexp_match(coalesce(raw_url, ''), 'youtube\.com/embed/([A-Za-z0-9_-]{6,})'))[1],
    ''
  );
$$;

create or replace function public.resolve_restaurant_identity_name(
  p_approved_name text,
  p_origin_name text,
  p_naver_name text,
  p_google_name text
)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(p_approved_name), ''),
    nullif(btrim(p_origin_name), ''),
    nullif(btrim(p_naver_name), ''),
    nullif(btrim(p_google_name), ''),
    ''
  );
$$;

create or replace function public.normalize_restaurant_identity_name(raw_name text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(raw_name, ''))), '\s+', ' ', 'g'), '');
$$;

with identity_rows as (
  select
    r.id,
    r.status,
    r.updated_by_admin_id,
    r.created_at,
    r.updated_at,
    r.review_count,
    r.jibun_address,
    r.road_address,
    r.evaluation_results,
    r.youtube_meta,
    r.naver_name,
    r.reasoning_basis,
    public.extract_youtube_video_id(r.youtube_link) as video_id,
    public.normalize_restaurant_identity_name(
      public.resolve_restaurant_identity_name(r.approved_name, r.origin_name, r.naver_name, r.google_name)
    ) as identity_name,
    case when r.updated_by_admin_id is not null then 1 else 0 end as admin_lock_priority,
    case
      when r.status = 'approved' then 3
      when r.status = 'hold' then 2
      when r.status = 'pending' then 1
      else 0
    end as status_priority,
    (
      case when coalesce(r.jibun_address, r.road_address) is not null then 1 else 0 end +
      case when r.evaluation_results is not null and r.evaluation_results <> '{}'::jsonb then 1 else 0 end +
      case when r.youtube_meta is not null and r.youtube_meta <> '{}'::jsonb then 1 else 0 end +
      case when nullif(btrim(r.naver_name), '') is not null then 1 else 0 end +
      case when nullif(btrim(r.reasoning_basis), '') is not null then 1 else 0 end
    ) as completeness_score
  from public.restaurants r
  where r.status <> 'deleted'
),
ranked as (
  select
    identity_rows.*,
    row_number() over (
      partition by identity_rows.video_id, identity_rows.identity_name
      order by
        identity_rows.admin_lock_priority desc,
        identity_rows.status_priority desc,
        identity_rows.completeness_score desc,
        identity_rows.updated_at desc nulls last,
        identity_rows.created_at desc nulls last,
        identity_rows.id asc
    ) as survivor_rank
  from identity_rows
  where identity_rows.video_id <> ''
    and identity_rows.identity_name is not null
),
survivors as (
  select *
  from ranked
  where survivor_rank = 1
),
best_donor as (
  select distinct on (survivors.id)
    survivors.id as survivor_id,
    donors.id as donor_id
  from survivors
  join ranked donors
    on donors.video_id = survivors.video_id
   and donors.identity_name = survivors.identity_name
   and donors.id <> survivors.id
  order by
    survivors.id,
    donors.admin_lock_priority desc,
    donors.status_priority desc,
    donors.completeness_score desc,
    donors.updated_at desc nulls last,
    donors.created_at desc nulls last,
    donors.id asc
)
update public.restaurants target
set
  approved_name = coalesce(target.approved_name, donor.approved_name),
  origin_name = coalesce(target.origin_name, donor.origin_name),
  naver_name = coalesce(target.naver_name, donor.naver_name),
  google_name = coalesce(target.google_name, donor.google_name),
  phone = coalesce(target.phone, donor.phone),
  categories = case
    when target.categories is null or cardinality(target.categories) = 0 then donor.categories
    else target.categories
  end,
  road_address = coalesce(target.road_address, donor.road_address),
  jibun_address = coalesce(target.jibun_address, donor.jibun_address),
  english_address = coalesce(target.english_address, donor.english_address),
  address_elements = case
    when target.address_elements is null
      or target.address_elements = '{}'::jsonb
      or target.address_elements = '[]'::jsonb
    then donor.address_elements
    else target.address_elements
  end,
  lat = coalesce(target.lat, donor.lat),
  lng = coalesce(target.lng, donor.lng),
  youtube_link = coalesce(target.youtube_link, donor.youtube_link),
  youtube_meta = case
    when target.youtube_meta is null or target.youtube_meta = '{}'::jsonb then donor.youtube_meta
    else target.youtube_meta
  end,
  tzuyang_review = coalesce(target.tzuyang_review, donor.tzuyang_review),
  reasoning_basis = coalesce(target.reasoning_basis, donor.reasoning_basis),
  evaluation_results = case
    when target.evaluation_results is null or target.evaluation_results = '{}'::jsonb then donor.evaluation_results
    else target.evaluation_results
  end,
  source_type = coalesce(target.source_type, donor.source_type),
  geocoding_success = coalesce(target.geocoding_success, false) or coalesce(donor.geocoding_success, false),
  geocoding_false_stage = case
    when coalesce(target.geocoding_success, false) or coalesce(donor.geocoding_success, false) then null
    else coalesce(target.geocoding_false_stage, donor.geocoding_false_stage)
  end,
  is_missing = coalesce(target.is_missing, false) or coalesce(donor.is_missing, false),
  is_not_selected = coalesce(target.is_not_selected, false) or coalesce(donor.is_not_selected, false),
  review_count = greatest(coalesce(target.review_count, 0), coalesce(donor.review_count, 0)),
  origin_address = coalesce(target.origin_address, donor.origin_address),
  trace_id_name_source = coalesce(target.trace_id_name_source, donor.trace_id_name_source),
  channel_name = coalesce(target.channel_name, donor.channel_name),
  description_map_url = coalesce(target.description_map_url, donor.description_map_url),
  recollect_version = case
    when target.recollect_version is null or target.recollect_version = '{}'::jsonb then donor.recollect_version
    else target.recollect_version
  end,
  updated_at = now()
from best_donor
join public.restaurants donor on donor.id = best_donor.donor_id
where target.id = best_donor.survivor_id;

with identity_rows as (
  select
    r.id,
    r.status,
    public.extract_youtube_video_id(r.youtube_link) as video_id,
    public.normalize_restaurant_identity_name(
      public.resolve_restaurant_identity_name(r.approved_name, r.origin_name, r.naver_name, r.google_name)
    ) as identity_name,
    case when r.updated_by_admin_id is not null then 1 else 0 end as admin_lock_priority,
    case
      when r.status = 'approved' then 3
      when r.status = 'hold' then 2
      when r.status = 'pending' then 1
      else 0
    end as status_priority,
    (
      case when coalesce(r.jibun_address, r.road_address) is not null then 1 else 0 end +
      case when r.evaluation_results is not null and r.evaluation_results <> '{}'::jsonb then 1 else 0 end +
      case when r.youtube_meta is not null and r.youtube_meta <> '{}'::jsonb then 1 else 0 end +
      case when nullif(btrim(r.naver_name), '') is not null then 1 else 0 end +
      case when nullif(btrim(r.reasoning_basis), '') is not null then 1 else 0 end
    ) as completeness_score,
    r.updated_at,
    r.created_at
  from public.restaurants r
  where r.status <> 'deleted'
),
ranked as (
  select
    identity_rows.*,
    row_number() over (
      partition by identity_rows.video_id, identity_rows.identity_name
      order by
        identity_rows.admin_lock_priority desc,
        identity_rows.status_priority desc,
        identity_rows.completeness_score desc,
        identity_rows.updated_at desc nulls last,
        identity_rows.created_at desc nulls last,
        identity_rows.id asc
    ) as survivor_rank
  from identity_rows
  where identity_rows.video_id <> ''
    and identity_rows.identity_name is not null
),
duplicate_donors as (
  select
    survivors.id as survivor_id,
    donors.id as donor_id
  from ranked survivors
  join ranked donors
    on donors.video_id = survivors.video_id
   and donors.identity_name = survivors.identity_name
   and donors.id <> survivors.id
  where survivors.survivor_rank = 1
)
update public.restaurants donor
set
  status = 'deleted',
  updated_at = now(),
  db_error_message = case
    when nullif(btrim(coalesce(donor.db_error_message, '')), '') is null
      then format('Auto-deduplicated into %s by video/name identity', duplicate_donors.survivor_id)
    else donor.db_error_message || ' | ' || format('Auto-deduplicated into %s by video/name identity', duplicate_donors.survivor_id)
  end,
  db_error_details = null
from duplicate_donors
where donor.id = duplicate_donors.donor_id;

create unique index if not exists idx_restaurants_active_video_identity
on public.restaurants (
  public.extract_youtube_video_id(youtube_link),
  public.normalize_restaurant_identity_name(
    public.resolve_restaurant_identity_name(approved_name, origin_name, naver_name, google_name)
  )
)
where status <> 'deleted'
  and public.extract_youtube_video_id(youtube_link) <> ''
  and public.normalize_restaurant_identity_name(
    public.resolve_restaurant_identity_name(approved_name, origin_name, naver_name, google_name)
  ) is not null;
