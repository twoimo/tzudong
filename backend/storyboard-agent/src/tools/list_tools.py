"""tools/ 폴더에 있는 도구 목록 조회"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import log_tool_call
from langchain_core.tools import tool


@tool
def list_tools() -> dict:
    """
    tools/ 폴더에 있는 모든 도구 목록을 반환합니다.
    각 도구의 파일명과 설명(module docstring)을 포함합니다.

    Returns:
        tools: 도구 목록 [{name, description}]
    """
    log_tool_call("list_tools")
    result = []
    for fname in sorted(os.listdir(_dir)):
        if fname.startswith("_") or not fname.endswith(".py"):
            continue
        name = fname[:-3]
        desc = ""
        with open(os.path.join(_dir, fname), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith('"""') or line.startswith("'''"):
                    desc = line.strip("\"'").strip()
                    break
        result.append({"name": name, "description": desc})
    return {"tools": result, "count": len(result)}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        r = list_tools.invoke({})
        print(json.dumps(r, ensure_ascii=False, indent=2))
