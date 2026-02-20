"""intern plan markdown 조회"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_REPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(_dir)), ".storyboard-agent", "intern-reports")
_PLAN_DIR = os.path.join(_REPORTS_DIR, "plan")
_PLAN_FILE = os.path.join(_PLAN_DIR, "active_plan.md")

from _shared import log_tool_call
from langchain_core.tools import tool


def _safe_plan_path() -> str:
    os.makedirs(_PLAN_DIR, exist_ok=True)
    root = os.path.realpath(_PLAN_DIR)
    path = os.path.realpath(_PLAN_FILE)
    if not path.startswith(root + os.sep):
        raise ValueError("plan path is outside plan directory")
    return path


@tool
def view_intern_plan() -> dict:
    """
    intern plan markdown 파일 내용을 조회합니다.

    Returns:
        조회 결과(dict)
        - ok: 성공 여부
        - filename: 파일명
        - exists: 파일 존재 여부
        - plan_markdown: 계획 본문(markdown)
    """
    log_tool_call("view_intern_plan")
    path = _safe_plan_path()
    if not os.path.exists(path):
        return {
            "ok": True,
            "filename": os.path.basename(path),
            "exists": False,
            "plan_markdown": "",
        }
    with open(path, encoding="utf-8") as f:
        plan_markdown = f.read()
    return {
        "ok": True,
        "filename": os.path.basename(path),
        "exists": True,
        "plan_markdown": plan_markdown,
    }


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        r = view_intern_plan.invoke({})
        print(json.dumps(r, ensure_ascii=False, indent=2))
