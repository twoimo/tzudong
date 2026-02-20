"""Supabase RPC 함수 SQL 파일 삭제"""

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

# 시스템/인덱스 SQL 보호 목록
_PROTECTED_SQL = {
    "_indexes.sql",
    "idx_transcript_embeddings_bge_video_id.sql",
}


@tool
def delete_rpc_sql(function_name: str) -> str:
    """
    supabase/ 폴더에서 RPC 함수 SQL 파일(.sql)을 삭제합니다.
    시스템 SQL 파일 및 인덱스 SQL 파일(`_`/`idx_` 접두사)은 삭제할 수 없습니다.
    supabase/ 폴더 외부에는 접근할 수 없습니다.

    삭제 후 Supabase에서 DROP FUNCTION도 수동으로 실행해야 합니다.

    Args:
        function_name: RPC 함수 이름 (파일명, 확장자 제외, 경로 문자 불가)

    Returns:
        삭제 결과 메시지
    """
    log_tool_call("delete_rpc_sql", function_name=function_name)

    if (
        "/" in function_name
        or "\\" in function_name
        or ".." in function_name
        or os.path.isabs(function_name)
    ):
        return "[거부] 파일명에 경로 문자(/, \\, ..)를 사용할 수 없습니다."

    fname = f"{function_name}.sql"
    path = os.path.realpath(os.path.join(_SQL_DIR, fname))
    if not path.startswith(os.path.realpath(_SQL_DIR) + os.sep):
        return "[거부] supabase/ 폴더 외부 접근이 차단되었습니다."

    if fname in _PROTECTED_SQL:
        return f"[거부] {fname}은 시스템 파일이므로 삭제할 수 없습니다."
    if function_name.startswith("_") or function_name.startswith("idx_"):
        return (
            f"[거부] {fname}은 인덱스/시스템 SQL 파일 접두사(_/idx_)이므로 "
            f"delete_rpc_sql로 삭제할 수 없습니다."
        )

    if not os.path.exists(path):
        return f"[오류] {fname}이 존재하지 않습니다."

    os.remove(path)
    return (
        f"{fname} 삭제 완료 (위치: supabase/{fname}). "
        f"Supabase에서 DROP FUNCTION {function_name}도 수동으로 실행해주세요."
    )


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = delete_rpc_sql.invoke(args)
        print(result)
