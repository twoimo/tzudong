"""Supabase RPC 함수 SQL 파일 생성"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_SQL_DIR = os.path.join(os.path.dirname(os.path.dirname(_dir)), "supabase")

from _shared import log_tool_call, review_sql_code
from langchain_core.tools import tool


@tool
def generate_rpc_sql(function_name: str, sql_code: str, overwrite: bool = False) -> str:
    """
    Supabase RPC 함수의 SQL 파일을 supabase/ 폴더에 생성합니다.
    이미 존재하는 경우 주의 문구를 반환합니다.
    supabase/ 폴더 외부에는 접근할 수 없습니다.

    Args:
        function_name: RPC 함수 이름 (파일명, 확장자 제외, 경로 문자 불가)
        sql_code: SQL 코드 전문
        overwrite: 이미 존재할 경우 덮어쓸지 여부 (기본값: False)

    Returns:
        생성 결과 메시지
    """
    log_tool_call("generate_rpc_sql", function_name=function_name, overwrite=overwrite)

    if (
        "/" in function_name
        or "\\" in function_name
        or ".." in function_name
        or os.path.isabs(function_name)
    ):
        return "[거부] 파일명에 경로 문자(/, \\, ..)를 사용할 수 없습니다."

    os.makedirs(_SQL_DIR, exist_ok=True)
    path = os.path.realpath(os.path.join(_SQL_DIR, f"{function_name}.sql"))
    if not path.startswith(os.path.realpath(_SQL_DIR) + os.sep):
        return "[거부] supabase/ 폴더 외부 접근이 차단되었습니다."

    exists = os.path.exists(path)
    if exists and not overwrite:
        return f"[주의] {function_name}.sql이 이미 존재합니다. 덮어쓰려면 overwrite=True로 다시 호출하세요."

    warnings = review_sql_code(sql_code)
    if warnings:
        return "[차단] 위험 패턴이 감지되어 파일을 생성하지 않았습니다.\n" + "\n".join(
            warnings
        )

    with open(path, "w", encoding="utf-8") as f:
        f.write(sql_code)

    action = "덮어쓰기" if exists else "생성"
    return f"{function_name}.sql {action} 완료 (위치: supabase/{function_name}.sql)"


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = generate_rpc_sql.invoke(args)
        print(result)
