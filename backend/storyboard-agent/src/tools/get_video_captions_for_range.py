"""특정 비디오의 시간 범위에 해당하는 프레임 캡션 조회"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import get_supabase, log_tool_call


def get_video_captions_for_range(
    video_id: str,
    recollect_id: int,
    start_sec: int,
    end_sec: int,
) -> dict:
    """
    특정 비디오의 시간 범위에 해당하는 프레임 캡션 조회

    Args:
        video_id: 유튜브 비디오 ID
        recollect_id: 수집 ID
        start_sec: 시작 시간(초)
        end_sec: 종료 시간(초)

    Returns:
        해당 시간 범위의 캡션 목록
    """
    log_tool_call(
        "get_video_captions_for_range",
        video_id=video_id,
        recollect_id=recollect_id,
        start_sec=start_sec,
        end_sec=end_sec,
    )
    client = get_supabase()
    result = client.rpc(
        "get_video_captions_for_range",
        {
            "p_video_id": video_id,
            "p_recollect_id": recollect_id,
            "p_start_sec": start_sec,
            "p_end_sec": end_sec,
        },
    ).execute()
    return {"captions": result.data}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = get_video_captions_for_range(**args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
