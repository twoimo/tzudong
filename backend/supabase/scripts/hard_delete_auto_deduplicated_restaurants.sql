-- Hard-delete auto-deduplicated restaurant tombstones that are no longer referenced.
--
-- Safety rules:
-- - only rows previously soft-deleted by the video/name dedupe pass are eligible
-- - rows are deleted only when no known public-table references remain
--
-- Recommended workflow:
-- 1) Run the preview SELECT first.
-- 2) Review candidate ids.
-- 3) Run the DELETE block.

with candidate_rows as (
  select r.id
  from public.restaurants r
  where (
    r.db_error_message like 'Auto-deduplicated into % by video/name identity%'
    or r.db_error_message like '% | Auto-deduplicated into % by video/name identity%'
  )
    and not exists (
      select 1
      from public.restaurant_submission_items items
      where items.target_restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.reviews reviews
      where reviews.restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.search_logs search_logs
      where search_logs.restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.short_urls short_urls
      where short_urls.restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.user_bookmarks user_bookmarks
      where user_bookmarks.restaurant_id = r.id
    )
)
select r.id,
       r.approved_name,
       r.origin_name,
       r.youtube_link,
       r.trace_id,
       r.updated_at
from public.restaurants r
join candidate_rows c on c.id = r.id
order by r.updated_at desc, r.id;

-- Delete only after reviewing the preview output above.
with candidate_rows as (
  select r.id
  from public.restaurants r
  where (
    r.db_error_message like 'Auto-deduplicated into % by video/name identity%'
    or r.db_error_message like '% | Auto-deduplicated into % by video/name identity%'
  )
    and not exists (
      select 1
      from public.restaurant_submission_items items
      where items.target_restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.reviews reviews
      where reviews.restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.search_logs search_logs
      where search_logs.restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.short_urls short_urls
      where short_urls.restaurant_id = r.id
    )
    and not exists (
      select 1
      from public.user_bookmarks user_bookmarks
      where user_bookmarks.restaurant_id = r.id
    )
)
delete from public.restaurants r
using candidate_rows c
where r.id = c.id;
