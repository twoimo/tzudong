"""새로운 도구 파일 생성"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import log_tool_call, review_python_code
from langchain_core.tools import tool


def _validate_name(name: str) -> str | None:
    """이름에 경로 탐색 문자가 포함되면 오류 메시지 반환, 정상이면 None"""
    if "/" in name or "\\" in name or ".." in name or os.path.isabs(name):
        return "[거부] 파일명에 경로 문자(/, \\, ..)를 사용할 수 없습니다."
    resolved = os.path.realpath(os.path.join(_dir, f"{name}.py"))
    if not resolved.startswith(os.path.realpath(_dir) + os.sep):
        return "[거부] tools/ 폴더 외부 접근이 차단되었습니다."
    return None


@tool
def create_tool(tool_name: str, code: str) -> str:
    """
    tools/ 폴더에 새로운 도구 파일(.py)을 생성합니다.
    이미 존재하는 경우 에러를 반환합니다. 수정하려면 먼저 delete_tool로 삭제 후 재생성하세요.
    tools/ 폴더 외부에는 접근할 수 없습니다.

    Args:
        tool_name: 도구 이름 (파일명, 확장자 제외, 경로 문자 불가)
        code: 도구 파일의 전체 Python 코드

    Returns:
        생성 결과 메시지
    """
    log_tool_call("create_tool", tool_name=tool_name)

    err = _validate_name(tool_name)
    if err:
        return err

    path = os.path.join(_dir, f"{tool_name}.py")
    if os.path.exists(path):
        return (
            f"[오류] {tool_name}.py가 이미 존재합니다. "
            f"덮어쓰기는 금지되어 있습니다. "
            f"먼저 delete_tool('{tool_name}')로 삭제한 후 다시 생성하세요."
        )

    warnings = review_python_code(code)
    if warnings:
        return "[차단] 위험 패턴이 감지되어 파일을 생성하지 않았습니다.\n" + "\n".join(
            warnings
        )

    with open(path, "w", encoding="utf-8") as f:
        f.write(code)

    return f"{tool_name}.py 생성 완료. 새 도구를 사용하려면 에이전트를 재시작하세요."


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = create_tool.invoke(args)
        print(result)
