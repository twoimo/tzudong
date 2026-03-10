"""supabase/ 폴더의 RPC SQL 파일 본문 조회"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_SQL_DIR = os.path.join(os.path.dirname(os.path.dirname(_dir)), "supabase")

from _shared import log_tool_call
from langchain_core.tools import tool


@tool
def view_rpc_sql(sql_name: str) -> dict:
    """
    supabase/ 폴더의 SQL 파일 본문을 반환합니다.
    입력값은 `함수명` 또는 `파일명.sql` 형식 모두 허용합니다.

    Args:
        sql_name: 조회할 SQL 파일명 (예: "match_documents_hybrid" 또는 "match_documents_hybrid.sql")

    Returns:
        조회 결과(dict)
        - ok: 성공 여부
        - name: 파일명(.sql 제외)
        - filename: 실제 파일명
        - description: 첫 줄 주석(있으면)
        - sql_code: SQL 본문
    """
    log_tool_call("view_rpc_sql", sql_name=sql_name)

    if not sql_name:
        return {"ok": False, "error": "[오류] sql_name이 비어 있습니다."}

    if (
        "/" in sql_name
        or "\\" in sql_name
        or ".." in sql_name
        or os.path.isabs(sql_name)
    ):
        return {"ok": False, "error": "[거부] 파일명에 경로 문자(/, \\, ..)를 사용할 수 없습니다."}

    filename = sql_name if sql_name.endswith(".sql") else f"{sql_name}.sql"
    path = os.path.realpath(os.path.join(_SQL_DIR, filename))
    if not path.startswith(os.path.realpath(_SQL_DIR) + os.sep):
        return {"ok": False, "error": "[거부] supabase/ 폴더 외부 접근이 차단되었습니다."}

    if not os.path.exists(path):
        return {"ok": False, "error": f"[오류] {filename}이 존재하지 않습니다."}

    with open(path, encoding="utf-8") as f:
        sql_code = f.read()

    description = ""
    for line in sql_code.splitlines():
        striped = line.strip()
        if striped.startswith("--"):
            description = striped.lstrip("- ").strip()
            break
        if striped:
            break

    return {
        "ok": True,
        "name": filename[:-4],
        "filename": filename,
        "description": description,
        "sql_code": sql_code,
    }


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = view_rpc_sql.invoke(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
