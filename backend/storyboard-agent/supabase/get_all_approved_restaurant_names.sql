-- 7. 승인된 모든 음식점명 조회
-- 설명: LLM이 사용자 입력과 매칭할 음식점명 목록을 가져옵니다.
-- 사용법: LLM은 이 목록을 참조하여 사용자 입력에서 음식점명을 추출한 후, search_restaurants_by_name을 호출합니다.
create or replace function get_all_approved_restaurant_names ()
returns table (
  name text,
  categories text[]
) language sql stable as $$
  select
    r.approved_name as name,
    r.categories
  from restaurants r
  where r.status = 'approved'
  order by r.approved_name;
$$;
