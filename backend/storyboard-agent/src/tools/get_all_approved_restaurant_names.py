"""승인된 모든 음식점명 목록 조회"""

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
def get_all_approved_restaurant_names() -> dict:
    """
    승인된 모든 음식점명 목록 조회 (LLM 참조용)

    LLM이 사용자 입력에서 음식점명을 추출할 때 참조합니다.

    Returns:
        승인된 음식점명과 카테고리 목록
    """
    log_tool_call("get_all_approved_restaurant_names")
    client = get_supabase()
    result = client.rpc("get_all_approved_restaurant_names", {}).execute()
    return {"restaurants": result.data}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        result = get_all_approved_restaurant_names.invoke({})
        print(json.dumps(result, ensure_ascii=False, indent=2))
