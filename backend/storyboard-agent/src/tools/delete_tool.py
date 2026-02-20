"""도구 파일 삭제"""

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

_PROTECTED = {
    "_shared.py",
    "__init__.py",
    "list_tools.py",
    "create_tool.py",
    "delete_tool.py",
    "create_rpc_sql.py",
    "delete_rpc_sql.py",
    "list_rpc_sql.py",
    "view_rpc_sql.py",
}


@tool
def delete_tool(tool_name: str) -> str:
    """
    tools/ 폴더에서 도구 파일(.py)을 삭제합니다.
    시스템 도구는 삭제할 수 없습니다.
    tools/ 폴더 외부에는 접근할 수 없습니다.

    Args:
        tool_name: 삭제할 도구 이름 (파일명, 확장자 제외, 경로 문자 불가)

    Returns:
        삭제 결과 메시지
    """
    log_tool_call("delete_tool", tool_name=tool_name)

    if (
        "/" in tool_name
        or "\\" in tool_name
        or ".." in tool_name
        or os.path.isabs(tool_name)
    ):
        return "[거부] 파일명에 경로 문자(/, \\, ..)를 사용할 수 없습니다."

    fname = f"{tool_name}.py"
    path = os.path.realpath(os.path.join(_dir, fname))
    if not path.startswith(os.path.realpath(_dir) + os.sep):
        return "[거부] tools/ 폴더 외부 접근이 차단되었습니다."

    if fname in _PROTECTED:
        return f"[거부] {fname}은 시스템 도구이므로 삭제할 수 없습니다."

    if not os.path.exists(path):
        return f"[오류] {fname}이 존재하지 않습니다."

    os.remove(path)
    return f"{fname} 삭제 완료. 변경 사항을 반영하려면 에이전트를 재시작하세요."


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = delete_tool.invoke(args)
        print(result)
