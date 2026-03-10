"""intern 제안 보고서 markdown 저장"""

import json
import os
import sys
from datetime import datetime
from typing import Literal

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_REPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(_dir)), ".storyboard-agent", "intern-reports")
_REPORT_DIRS = {
    "tool-proposals": "tool-proposals",
    "metadata-proposal": "metadata-proposal",
}
ReportType = Literal["tool-proposals", "metadata-proposal"]

from _shared import log_tool_call
from langchain_core.tools import tool


def _safe_report_dir(report_type: ReportType) -> str:
    if report_type not in _REPORT_DIRS:
        raise ValueError("report_type must be 'tool-proposals' or 'metadata-proposal'")
    root = os.path.realpath(_REPORTS_DIR)
    target = os.path.realpath(os.path.join(_REPORTS_DIR, _REPORT_DIRS[report_type]))
    if not target.startswith(root + os.sep):
        raise ValueError("report path is outside reports directory")
    os.makedirs(target, exist_ok=True)
    return target


@tool
def write_intern_report(report_type: ReportType, request: str, lines: list[str]) -> dict:
    """
    Intern 제안 보고서를 markdown 파일로 저장합니다.

    사용 상황:
    - report 단계에서 "지금 당장 구현/생성이 어려운 항목"을 기록할 때:
      report_type="tool-proposals"
    - report 단계에서 "향후 메타데이터 확장 아이디어"를 기록할 때:
      report_type="metadata-proposal"

    사용하지 않는 상황:
    - 일반 진행 로그
    - 도구 실행 결과 로그
    - 이미 create/delete로 실제 반영 완료된 항목

    Args:
        report_type: 보고서 종류
            - "tool-proposals": 구현 불가/추가 도구 제안
            - "metadata-proposal": 메타데이터 확장 제안
        request: 원본 intern_request (보고서 상단 Request 섹션에 기록)
        lines: 보고서 항목 목록(한 줄당 1개 항목 권장)

    Returns:
        저장 결과(dict)
        - ok: 성공 여부
        - report_type: 보고서 유형
        - filename: 저장 파일명
        - items: 항목 수
        - bytes: 저장 바이트 수
    """
    log_tool_call("write_intern_report", report_type=report_type)

    if not isinstance(lines, list) or any(not isinstance(x, str) for x in lines):
        return {"ok": False, "error": "[오류] lines는 문자열 리스트여야 합니다."}

    clean_lines = [x.strip() for x in lines if x and x.strip()]
    if not clean_lines:
        return {"ok": False, "error": "[오류] 저장할 항목이 없습니다."}

    try:
        report_dir = _safe_report_dir(report_type)
    except ValueError as e:
        return {"ok": False, "error": f"[오류] {e}"}

    title = "Infeasible / Tool Proposals" if report_type == "tool-proposals" else "Metadata Proposals"
    request_text = request.strip() if isinstance(request, str) and request.strip() else "-"
    content_lines = ["## Request", request_text, "", f"## {title}"]
    content_lines.extend(f"- {x}" for x in clean_lines)
    content = "\n".join(content_lines).rstrip() + "\n"

    filename = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    path = os.path.join(report_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    return {
        "ok": True,
        "report_type": report_type,
        "filename": filename,
        "items": len(clean_lines),
        "bytes": len(content.encode("utf-8")),
    }


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        r = write_intern_report.invoke(args)
        print(json.dumps(r, ensure_ascii=False, indent=2))
