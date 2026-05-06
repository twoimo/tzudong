-- Cover the high-traffic PostgREST query shapes used by home, feed, detail,
-- stamp, bookmarks, submissions, short links, and announcement UI paths.
-- Guards keep the migration portable across older local schemas.

create or replace function pg_temp.has_public_columns(p_table_name text, p_columns text[])
returns boolean
language sql
stable
as $$
  select count(*) = cardinality(p_columns)
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table_name
    and c.column_name = any(p_columns);
$$;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

do $$
declare
  v_trgm_schema text;
begin
  select n.nspname
    into v_trgm_schema
  from pg_opclass oc
  join pg_namespace n on n.oid = oc.opcnamespace
  where oc.opcname = 'gin_trgm_ops'
  limit 1;

  if pg_temp.has_public_columns('restaurants', array['status', 'approved_name']) then
    execute 'create index if not exists restaurants_status_approved_name_idx on public.restaurants (status, approved_name)';
  end if;

  if v_trgm_schema is not null and pg_temp.has_public_columns('restaurants', array['approved_name']) then
    execute format(
      'create index if not exists restaurants_approved_name_trgm_idx on public.restaurants using gin (approved_name %I.gin_trgm_ops)',
      v_trgm_schema
    );
  end if;

  if pg_temp.has_public_columns('restaurants', array['status', 'review_count']) then
    execute 'create index if not exists restaurants_status_review_count_idx on public.restaurants (status, review_count desc)';
  end if;

  if pg_temp.has_public_columns('restaurants', array['status', 'weekly_search_count']) then
    execute 'create index if not exists restaurants_status_weekly_search_count_idx on public.restaurants (status, weekly_search_count desc) where weekly_search_count > 0';
  end if;

  if pg_temp.has_public_columns('restaurants', array['status', 'lat', 'lng']) then
    execute 'create index if not exists restaurants_status_lat_lng_idx on public.restaurants (status, lat, lng)';
  end if;

  if pg_temp.has_public_columns('restaurants', array['categories']) then
    execute 'create index if not exists restaurants_categories_gin_idx on public.restaurants using gin (categories)';
  end if;

  if pg_temp.has_public_columns('reviews', array['is_verified', 'created_at']) then
    execute 'create index if not exists reviews_verified_created_idx on public.reviews (is_verified, created_at desc)';
  end if;

  if pg_temp.has_public_columns('reviews', array['restaurant_id', 'is_verified', 'is_pinned', 'created_at']) then
    execute 'create index if not exists reviews_restaurant_verified_created_idx on public.reviews (restaurant_id, is_verified, is_pinned desc, created_at desc)';
  end if;

  if pg_temp.has_public_columns('reviews', array['user_id', 'is_verified', 'created_at']) then
    execute 'create index if not exists reviews_user_verified_created_idx on public.reviews (user_id, is_verified, created_at desc)';
  end if;

  if pg_temp.has_public_columns('review_likes', array['review_id', 'user_id']) then
    execute 'create index if not exists review_likes_review_user_idx on public.review_likes (review_id, user_id)';
    execute 'create index if not exists review_likes_user_review_idx on public.review_likes (user_id, review_id)';
  end if;

  if pg_temp.has_public_columns('user_bookmarks', array['user_id', 'restaurant_id']) then
    execute 'create index if not exists user_bookmarks_user_restaurant_idx on public.user_bookmarks (user_id, restaurant_id)';
    execute 'create index if not exists user_bookmarks_restaurant_idx on public.user_bookmarks (restaurant_id)';
  end if;

  if pg_temp.has_public_columns('restaurant_submissions', array['user_id', 'status', 'created_at']) then
    execute 'create index if not exists restaurant_submissions_user_status_created_idx on public.restaurant_submissions (user_id, status, created_at desc)';
  end if;

  if pg_temp.has_public_columns('restaurant_submissions', array['status', 'created_at']) then
    execute 'create index if not exists restaurant_submissions_status_created_idx on public.restaurant_submissions (status, created_at desc)';
  end if;

  if pg_temp.has_public_columns('restaurant_submission_items', array['submission_id']) then
    execute 'create index if not exists restaurant_submission_items_submission_idx on public.restaurant_submission_items (submission_id)';
  end if;

  if pg_temp.has_public_columns('restaurant_requests', array['user_id', 'created_at']) then
    execute 'create index if not exists restaurant_requests_user_created_idx on public.restaurant_requests (user_id, created_at desc)';
  end if;

  if pg_temp.has_public_columns('announcements', array['is_active', 'show_on_banner', 'priority', 'created_at']) then
    execute 'create index if not exists announcements_active_banner_priority_created_idx on public.announcements (is_active, show_on_banner, priority desc, created_at desc)';
  end if;

  if pg_temp.has_public_columns('notifications', array['user_id', 'created_at']) then
    execute 'create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc)';
  end if;

  if pg_temp.has_public_columns('ad_banners', array['is_active', 'priority']) then
    execute 'create index if not exists ad_banners_active_priority_idx on public.ad_banners (is_active, priority desc)';
  end if;

  if pg_temp.has_public_columns('ad_banners', array['display_target']) then
    execute 'create index if not exists ad_banners_display_target_gin_idx on public.ad_banners using gin (display_target)';
  end if;

  if pg_temp.has_public_columns('server_costs', array['monthly_cost']) then
    execute 'create index if not exists server_costs_monthly_cost_idx on public.server_costs (monthly_cost desc)';
  end if;

  if pg_temp.has_public_columns('ocr_logs', array['user_id', 'success', 'created_at']) then
    execute 'create index if not exists ocr_logs_user_success_created_idx on public.ocr_logs (user_id, success, created_at desc)';
  end if;

  if pg_temp.has_public_columns('reviews', array['ocr_processed_at', 'verification_photo']) then
    execute 'create index if not exists reviews_ocr_pending_idx on public.reviews (ocr_processed_at) where verification_photo is not null';
  end if;

  if pg_temp.has_public_columns('reviews', array['is_duplicate']) then
    execute 'create index if not exists reviews_duplicate_idx on public.reviews (is_duplicate)';
  end if;

  if pg_temp.has_public_columns('short_urls', array['code']) then
    execute 'create index if not exists short_urls_code_idx on public.short_urls (code)';
  end if;

  if pg_temp.has_public_columns('short_urls', array['target_url']) then
    execute 'create index if not exists short_urls_target_url_idx on public.short_urls (target_url)';
  end if;
end $$;
