-- 2. 비디오 캡션 조회 함수 (시간 범위 기준)
-- 설명: 특정 비디오의 특정 시간 범위에 겹치는 캡션(시각적 묘사)을 조회합니다. 식당 방문 증거 등으로 활용 가능합니다.
-- 수정: video_frame_captions 테이블의 duration 필드를 사용하여 동일 duration의 가장 최신 recollect_id를 찾습니다.
create or replace function get_video_captions_for_range (
  p_video_id text,
  p_recollect_id int,
  p_start_sec int,
  p_end_sec int
) returns setof video_frame_captions language plpgsql stable as $$
declare
  v_target_recollect_id int;
  v_target_duration int;
begin
  -- 1. 요청받은 recollect_id에 해당하는 캡션 데이터가 있는지 확인
  perform 1 from video_frame_captions
  where video_id = p_video_id and recollect_id = p_recollect_id
  limit 1;

  if found then
    v_target_recollect_id := p_recollect_id;
  else
    -- 2. 없다면, video_frame_captions에서 해당 video_id의 duration을 확인
    select duration into v_target_duration
    from video_frame_captions
    where video_id = p_video_id
    limit 1;

    -- 3. 같은 duration을 가진 것 중 가장 최신(큰) recollect_id 찾기
    --    duration 매칭이 안 되면 결과 없음 (fallback 없음)
    if v_target_duration is not null then
      select max(recollect_id) into v_target_recollect_id
      from video_frame_captions
      where video_id = p_video_id and duration = v_target_duration;
    end if;
  end if;

  return query
  select *
  from video_frame_captions
  where video_id = p_video_id
    and recollect_id = v_target_recollect_id
    -- overlaps 연산자 (start1, end1) overlaps (start2, end2) 대체
    -- 조건: r.start_sec < p_end_sec AND p_start_sec < r.end_sec
    and start_sec < p_end_sec 
    and p_start_sec < end_sec
  order by rank asc;
end;
$$;
