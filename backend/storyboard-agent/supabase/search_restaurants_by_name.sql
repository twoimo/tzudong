-- 6. 음식점 이름 검색
-- 설명: 사용자가 특정 식당 이름을 직접 언급했을 때("엽기떡볶이 어디 나왔어?") 검색합니다.
-- LLM이 get_all_approved_restaurant_names로 먼저 목록을 받아온 후, 매칭된 이름으로 이 함수를 호출합니다.
create or replace function search_restaurants_by_name (
  keyword text,
  p_limit int default 5
) returns table (
  id uuid,
  name text,
  categories text[],
  youtube_link text,
  video_id text,
  tzuyang_review text
) language sql stable as $$
  select
    r.id,
    r.approved_name as name,
    r.categories,
    r.youtube_link,
    substring(r.youtube_link from 'v=([^&]+)') as video_id,
    r.tzuyang_review
  from restaurants r
  where r.status = 'approved'
    and (r.approved_name ilike '%' || keyword || '%')
  limit p_limit;
$$;
