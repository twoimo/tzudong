"""음식점명 또는 video_id로 카테고리 조회"""

import json
import os
import sys
from typing import Optional

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import get_supabase, log_tool_call
from langchain_core.tools import tool


@tool
def get_categories_by_restaurant(
    restaurant_name: Optional[str] = None,
    video_id: Optional[str] = None,
) -> dict:
    """
    음식점명 또는 video_id로 해당 음식점의 카테고리 조회

    Args:
        restaurant_name: 음식점명 (선택)
        video_id: 유튜브 비디오 ID (선택)

    Returns:
        해당 음식점의 카테고리 배열
    """
    log_tool_call(
        "get_categories_by_restaurant",
        restaurant_name=restaurant_name,
        video_id=video_id,
    )
    client = get_supabase()
    result = client.rpc(
        "get_categories_by_restaurant_name_or_youtube_url",
        {"p_restaurant_name": restaurant_name, "p_video_id": video_id},
    ).execute()
    return {"categories": result.data}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = get_categories_by_restaurant.invoke(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
