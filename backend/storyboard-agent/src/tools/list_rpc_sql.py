"""supabase/ 폴더에 있는 RPC 함수 SQL 파일 목록 조회"""

import json
import os
import re
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
def list_rpc_sql() -> dict:
    """
    supabase/ 폴더에 있는 RPC 함수 SQL 파일 목록을 반환합니다.
    각 파일의 이름과 첫 줄 주석(설명)을 포함합니다.
    인덱스 파일은 RPC 함수와 분리하여 반환합니다.
    - `idx_*.sql`: 개별 인덱스 파일
    - `_*.sql`: 시스템/묶음 인덱스 파일 (RPC 목록에서 제외)

    Returns:
        rpc_functions: RPC 함수 목록 [{name, description}]
        indexes: 인덱스 파일 목록 [{name, description, index_count, indexes}]
    """
    log_tool_call("list_rpc_sql")

    if not os.path.isdir(_SQL_DIR):
        return {"rpc_functions": [], "indexes": [], "count": 0}

    functions = []
    indexes = []

    for fname in sorted(os.listdir(_SQL_DIR)):
        if not fname.endswith(".sql"):
            continue
        name = fname[:-4]  # .sql 제거
        desc = ""
        filepath = os.path.join(_SQL_DIR, fname)
        with open(filepath, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("--"):
                    desc = line.lstrip("- ").strip()
                    break

        entry = {"name": name, "description": desc}
        sql_text = _read_file(filepath)

        if _is_index_sql(name):
            defs = _extract_index_definitions(sql_text)
            entry["index_count"] = len(defs)
            entry["indexes"] = defs
            indexes.append(entry)
        else:
            functions.append(entry)

    return {
        "rpc_functions": functions,
        "indexes": indexes,
        "count": len(functions) + len(indexes),
    }


def _read_file(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _is_index_sql(name: str) -> bool:
    return name.startswith("idx_") or name.startswith("_")


def _extract_index_definitions(sql_text: str) -> list[dict]:
    pattern = re.compile(
        r"create\s+(?P<unique>unique\s+)?index\s+"
        r"(?:if\s+not\s+exists\s+)?(?P<index_name>[a-zA-Z0-9_]+)\s+"
        r"on\s+(?P<table_name>[a-zA-Z0-9_]+)\s*"
        r"(?:using\s+(?P<method>[a-zA-Z0-9_]+)\s*)?"
        r"\((?P<columns>[^)]+)\)",
        flags=re.IGNORECASE | re.MULTILINE,
    )
    defs = []
    for m in pattern.finditer(sql_text):
        cols = [c.strip() for c in m.group("columns").split(",") if c.strip()]
        defs.append(
            {
                "index_name": m.group("index_name"),
                "table": m.group("table_name"),
                "columns": cols,
                "method": (m.group("method") or "btree").lower(),
                "unique": bool(m.group("unique")),
            }
        )
    return defs


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        r = list_rpc_sql.invoke({})
        print(json.dumps(r, ensure_ascii=False, indent=2))
