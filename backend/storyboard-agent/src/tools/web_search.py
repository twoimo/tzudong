"""Tavily 웹 검색"""

import sys
import os

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import log_tool_call
from langchain_teddynote.tools.tavily import TavilySearch

web_search = TavilySearch(max_results=5)

# 원본 invoke를 래핑하여 log.md에 기록
_original_invoke = web_search.invoke


def _logged_invoke(input, *args, **kwargs):
    query = input if isinstance(input, str) else str(input)
    log_tool_call("web_search", query=query)
    return _original_invoke(input, *args, **kwargs)


web_search.invoke = _logged_invoke


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        result = web_search.invoke(sys.argv[1])
        print(result)
