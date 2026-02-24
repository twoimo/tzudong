"""Tavily 웹 검색"""

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
from langchain_teddynote.tools.tavily import TavilySearch

_tavily = TavilySearch(max_results=5)


@tool
def web_search(query: str) -> dict:
    """웹에서 최신 정보를 검색한다."""
    log_tool_call("web_search", query=query)
    result = _tavily.invoke(query)
    if isinstance(result, dict):
        return result
    return {"result": result}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        r = web_search.invoke({"query": sys.argv[1]})
        print(json.dumps(r, ensure_ascii=False, indent=2))
