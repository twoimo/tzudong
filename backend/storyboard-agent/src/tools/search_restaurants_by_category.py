"""카테고리별 음식점 검색"""

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
def search_restaurants_by_category(
    category: str,
    limit: int = 10,
) -> dict:
    """
    특정 카테고리에 해당하는 음식점 검색 (예: "냉면", "치킨")

    Args:
        category: 검색할 카테고리명
        limit: 최대 반환 수 (기본값: 10)

    Returns:
        해당 카테고리의 승인된 음식점 목록
    """
    log_tool_call("search_restaurants_by_category", category=category, limit=limit)
    client = get_supabase()
    result = client.rpc(
        "search_restaurants_by_category",
        {"p_category": category, "p_limit": limit},
    ).execute()
    return {"restaurants": result.data}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = search_restaurants_by_category.invoke(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
