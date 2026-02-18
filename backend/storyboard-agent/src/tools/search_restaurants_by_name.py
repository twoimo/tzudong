"""음식점 이름으로 검색 (부분 일치)"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import get_supabase, log_tool_call
from langchain_core.tools import tool


@tool
def search_restaurants_by_name(
    keyword: str,
    limit: int = 5,
) -> dict:
    """
    음식점 이름으로 검색 (부분 일치)

    Args:
        keyword: 검색 키워드 (예: "엽기떡볶이")
        limit: 최대 반환 수 (기본값: 5)

    Returns:
        매칭된 음식점 목록 (id, name, categories, youtube_link, video_id, tzuyang_review)
    """
    log_tool_call("search_restaurants_by_name", keyword=keyword, limit=limit)
    client = get_supabase()
    result = client.rpc(
        "search_restaurants_by_name",
        {"keyword": keyword, "p_limit": limit},
    ).execute()
    return {"restaurants": result.data}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = search_restaurants_by_name.invoke(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
