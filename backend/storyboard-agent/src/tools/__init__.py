"""Storyboard Agent Tools 패키지 — 동적 도구 로딩

다중 에이전트 구성 예시:
  tools, admin_tools = load_tools()
  research_agent  → ToolNode(tools)                    # interrupt 없음
  intern_subgraph → 내부에서 admin_tools 사용             # review/execute_delete에서 interrupt 처리
  LLM bind: 각 에이전트에 필요한 도구만 bind
"""

import os
import importlib

_dir = os.path.dirname(os.path.abspath(__file__))
_ADMIN_NAMES = {
    "create_tool",
    "delete_tool",
    "create_rpc_sql",
    "delete_rpc_sql",
    "list_rpc_sql",
    "view_rpc_sql",
}


def _is_tool(obj) -> bool:
    return hasattr(obj, "name") and hasattr(obj, "invoke") and callable(obj.invoke)


def load_tools() -> tuple[list, list]:
    """tools/ 폴더를 스캔하여 (TOOLS, ADMIN_TOOLS) 반환. 호출 시점의 폴더 상태를 반영."""
    tools = []
    admin_tools = []

    for fname in sorted(os.listdir(_dir)):
        if fname.startswith("_") or not fname.endswith(".py"):
            continue
        mod_name = fname[:-3]
        mod = importlib.import_module(f".{mod_name}", package=__name__)
        importlib.reload(mod)
        tool_obj = getattr(mod, mod_name, None)
        if tool_obj is not None and _is_tool(tool_obj):
            if mod_name in _ADMIN_NAMES:
                admin_tools.append(tool_obj)
            else:
                tools.append(tool_obj)

    return tools, admin_tools
