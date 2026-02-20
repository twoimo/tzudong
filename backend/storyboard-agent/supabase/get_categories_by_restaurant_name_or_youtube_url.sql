-- 5. 음식점명 또는 video_id로 카테고리 조회
-- 설명: 특정 음식점의 카테고리를 가져옵니다. 카테고리 확장 검색에 사용됩니다.
create or replace function get_categories_by_restaurant_name_or_youtube_url (
  p_restaurant_name text default null,
  p_video_id text default null
) returns text[] language sql stable as $$
  select array_agg(distinct c)
  from restaurants r, unnest(r.categories) as c
  where r.status = 'approved'
    and (p_restaurant_name is null or r.approved_name = p_restaurant_name)
    and (p_video_id is null or substring(r.youtube_link from 'v=([^&]+)') = p_video_id);
$$;
