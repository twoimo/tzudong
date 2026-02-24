-- 3. 카테고리별 음식점 검색 함수
-- 설명: categories 배열에 특정 키워드가 포함된 음식점을 검색합니다. (approved 된 음식점만 조회, 이름은 approved_name 사용)
create or replace function search_restaurants_by_category (
  p_category text,
  p_limit int default 10
) returns table (
  id uuid,
  name text,
  categories text[],
  youtube_link text,
  description_map_url text,
  video_id text
) language sql stable as $$
  select
    r.id,
    r.approved_name as name,
    r.categories,
    r.youtube_link,
    r.description_map_url,
    -- youtube_link에서 video_id 추출 (간단한 파싱, Regex 필요시 조정)
    substring(r.youtube_link from 'v=([^&]+)') as video_id
  from restaurants r
  where r.status = 'approved'
    and r.categories @> array[p_category]
  limit p_limit;
$$;
