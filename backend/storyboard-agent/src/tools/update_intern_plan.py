"""intern plan markdown 수정"""

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
def update_intern_plan(plan_markdown: str) -> dict:
    """
    intern plan markdown 파일 전체 내용을 갱신합니다.

    Args:
        plan_markdown: 저장할 전체 markdown 본문

    Returns:
        수정 결과(dict)
        - ok: 성공 여부
        - filename: 파일명
        - bytes: 저장 바이트 수
    """
    log_tool_call("update_intern_plan")
    if not isinstance(plan_markdown, str):
        return {"ok": False, "error": "[오류] plan_markdown은 문자열이어야 합니다."}

    path = _safe_plan_path()
    content = plan_markdown.rstrip() + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    return {
        "ok": True,
        "filename": os.path.basename(path),
        "bytes": len(content.encode("utf-8")),
    }


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        r = update_intern_plan.invoke(args)
        print(json.dumps(r, ensure_ascii=False, indent=2))
