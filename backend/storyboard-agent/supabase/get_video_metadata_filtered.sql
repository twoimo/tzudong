-- 4. 필터링된 비디오 메타데이터 조회 함수
-- 설명: 조회수, 게시일자 등을 기준으로 필터링/정렬하여 비디오 목록을 가져옵니다. "최신 영상", "인기 영상" 조회 시 사용합니다.
create or replace function get_video_metadata_filtered (
  min_view_count int default 0,
  p_limit int default 5,
  p_order_by text default 'view_count'
) returns setof videos language plpgsql stable as $$
begin
  return query
  select *
  from videos
  where view_count >= min_view_count
  order by
    case when p_order_by = 'view_count' then view_count end desc nulls last,
    case when p_order_by = 'published_at' then published_at end desc nulls last,
    case when p_order_by = 'comment_count' then comment_count end desc nulls last
  limit p_limit;
end;
$$;
