"""조회수/게시일 등으로 필터링된 비디오 메타데이터 조회"""

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
def get_video_metadata_filtered(
    min_view_count: int = 0,
    limit: int = 5,
    order_by: str = "view_count",
) -> dict:
    """
    조회수/게시일 등으로 필터링된 비디오 메타데이터 조회

    Args:
        min_view_count: 최소 조회수 (기본값: 0)
        limit: 최대 반환 수 (기본값: 5)
        order_by: 정렬 기준 - "view_count", "published_at", "comment_count" (기본값: "view_count")

    Returns:
        필터링된 비디오 메타데이터 목록
    """
    log_tool_call(
        "get_video_metadata_filtered",
        min_view_count=min_view_count,
        limit=limit,
        order_by=order_by,
    )
    client = get_supabase()
    result = client.rpc(
        "get_video_metadata_filtered",
        {"min_view_count": min_view_count, "p_limit": limit, "p_order_by": order_by},
    ).execute()
    return {"videos": result.data}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = get_video_metadata_filtered.invoke(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
