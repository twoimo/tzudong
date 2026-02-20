"""Intern 에이전트 서브그래프.

그래프 구조:
START -> plan -> think
think --(create)--> review -(human)-> execute -> update_plan -> think
think --(delete)--> execute_delete -> update_plan -> think
think --(read/report)--> update_plan -> (report | think)
report -> END

상태 업데이트 핵심:
- plan: intern_plan + messages
- think: messages + intern_action
- execute/execute_delete: messages + created_artifacts + intern_reports + intern_result
- update_plan: intern_plan(last_updated 포함)
- report: intern_reports + messages

읽기 순서:
1) 공용 헬퍼
2) 노드/라우팅 함수 (plan -> think -> review -> execute -> update_plan -> report)
3) 그래프 조립
"""

import json
import os
from datetime import datetime

from langgraph.graph import START, END, StateGraph
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage, SystemMessage

from state.main import InternState
from prompts.intern import (
    INTERN_SYSTEM_PROMPT,
    INTERN_PLAN_PROMPT,
    INTERN_THINK_PROMPT,
    CODE_REVIEW_PROMPT,
)
from tools import load_tools


memory = MemorySaver()
llm_intern = ChatOpenAI(model="gpt-4o-mini")
llm_reviewer = ChatOpenAI(model="gpt-4o-mini")

_DELETE_ACTIONS = {"delete_tool", "delete_rpc_sql"}
_CREATE_ACTIONS = {"create_tool", "create_rpc_sql"}
_READ_ACTIONS = {"list_rpc_sql", "view_rpc_sql"}

_REPORTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".storyboard-agent",
    "intern-reports",
)


# ---------------------------------------------------------------------------
# 공용 헬퍼
# ---------------------------------------------------------------------------
# 이 섹션 함수들은 "state를 읽기 쉽게 정규화"하는 역할이다.
# 노드 함수에서는 가능하면 이 헬퍼를 조합만 하도록 유지한다.
def _extract_instruction(state: InternState) -> str:
    """Intern 작업 지시를 반환한다.

    우선순위:
    1) state.intern_request (Researcher/Supervisor가 전달한 요청)
    2) messages 내 첫 HumanMessage
    """
    # Supervisor가 전달한 intern_request가 있으면 항상 그것을 우선 사용한다.
    intern_request = state.get("intern_request")
    if isinstance(intern_request, str) and intern_request.strip():
        return intern_request.strip()

    for msg in state["messages"]:
        if isinstance(msg, HumanMessage):
            return msg.content
    return ""


def _stringify_recent_messages(state: InternState, limit: int = 8) -> str:
    """최근 대화를 프롬프트 주입용 문자열로 변환한다."""
    lines = []
    for msg in state["messages"][-limit:]:
        role = "user"
        if isinstance(msg, AIMessage):
            role = "assistant"
        elif isinstance(msg, ToolMessage):
            role = f"tool:{msg.name}"
        lines.append(f"[{role}] {msg.content}")
    return "\n".join(lines)


def _find_pending_tool_calls(state: InternState) -> list:
    """messages에서 마지막 AIMessage의 tool_calls를 찾는다."""
    for msg in reversed(state["messages"]):
        if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
            return msg.tool_calls
    return []


def _extract_codes(tool_calls: list) -> list[dict]:
    """코드 리뷰 대상(create_tool/create_rpc_sql) payload만 추출한다."""
    codes = []
    for tc in tool_calls:
        if tc["name"] == "create_tool":
            codes.append(
                {
                    "type": "python",
                    "tool_name": tc["args"].get("tool_name", "unknown"),
                    "code": tc["args"].get("code", ""),
                }
            )
        elif tc["name"] == "create_rpc_sql":
            codes.append(
                {
                    "type": "sql",
                    "function_name": tc["args"].get("function_name", "unknown"),
                    "code": tc["args"].get("sql_code", ""),
                }
            )
    return codes


def _activate_next_pending_step(steps: list[dict]) -> None:
    """첫 pending step을 in_progress로 바꾼다."""
    for step in steps:
        if step.get("status") == "pending":
            step["status"] = "in_progress"
            return


def _get_active_step(steps: list[dict]) -> dict | None:
    """현재 active step을 찾는다. 우선순위: in_progress > pending."""
    for step in steps:
        if step.get("status") == "in_progress":
            return step
    for step in steps:
        if step.get("status") == "pending":
            return step
    return None


def _parse_plan(raw_plan: dict | str | None, fallback_instruction: str) -> dict:
    """plan JSON을 정규화한다.

    - 파싱 실패 시 기본 plan 사용
    - 잘못된 status 보정
    - in_progress step은 최대 1개 유지
    """
    default = {
        "goal": fallback_instruction or "Intern 작업 완료",
        "steps": [
            {
                "id": 1,
                "task": "list_rpc_sql로 현재 RPC/인덱스 현황 확인",
                "status": "in_progress",
            },
            {"id": 2, "task": "필요한 도구 또는 RPC SQL 생성/삭제 수행", "status": "pending"},
            {"id": 3, "task": "실행 결과를 검토하고 최종 보고", "status": "pending"},
        ],
        "notes": "",
        "last_updated": datetime.now().isoformat(),
    }

    # 1) 입력을 dict로 통일
    if isinstance(raw_plan, dict):
        plan = raw_plan
    elif isinstance(raw_plan, str):
        text = raw_plan.strip()
        if "```" in text:
            text = text.replace("```json", "").replace("```", "").strip()
        try:
            plan = json.loads(text)
        except json.JSONDecodeError:
            return default
    else:
        return default

    if not isinstance(plan, dict):
        return default

    # 2) 최소 필드(goal/steps) 보정
    goal = plan.get("goal") or default["goal"]
    steps_raw = plan.get("steps")
    if not isinstance(steps_raw, list) or not steps_raw:
        steps = default["steps"]
    else:
        steps = []
        for i, step in enumerate(steps_raw, start=1):
            if not isinstance(step, dict):
                continue
            status = step.get("status", "pending")
            if status not in {"pending", "in_progress", "completed", "blocked"}:
                status = "pending"
            steps.append(
                {
                    "id": step.get("id", i),
                    "task": step.get("task", f"step {i}"),
                    "status": status,
                    "result": step.get("result", ""),
                }
            )
        if not steps:
            steps = default["steps"]

    # 3) active step은 하나만 유지 (여러 개면 첫 번째만 살림)
    in_progress = [s for s in steps if s.get("status") == "in_progress"]
    if len(in_progress) == 0:
        _activate_next_pending_step(steps)
    elif len(in_progress) > 1:
        keep_id = in_progress[0].get("id")
        for step in steps:
            if step.get("status") == "in_progress" and step.get("id") != keep_id:
                step["status"] = "pending"

    return {
        "goal": goal,
        "steps": steps,
        "notes": plan.get("notes", ""),
        "last_updated": plan.get("last_updated", datetime.now().isoformat()),
    }


def _format_plan(plan: dict | None) -> str:
    """plan을 사람이 읽기 좋은 텍스트로 변환한다."""
    parsed = _parse_plan(plan, fallback_instruction="")
    lines = [f"goal: {parsed['goal']}"]
    for step in parsed["steps"]:
        lines.append(f"- [{step['status']}] ({step['id']}) {step['task']}")
    if parsed.get("notes"):
        lines.append(f"notes: {parsed['notes']}")
    return "\n".join(lines)


def _recent_tool_messages(state: InternState, limit: int = 5) -> list[ToolMessage]:
    """최근 n개 message에서 ToolMessage만 추린다."""
    return [m for m in state["messages"][-limit:] if isinstance(m, ToolMessage)]


def _is_success_tool_result(content: str) -> bool:
    """툴 결과 문자열에서 성공/실패를 판정한다."""
    blocked = ("[오류]", "[거부]", "[차단]")
    return "완료" in content and not any(token in content for token in blocked)


def _is_action_success(tool_name: str, content: str) -> bool:
    """도구 종류별 성공 판정.

    - read(list/view): 오류 태그가 없으면 성공
    - create/delete: '완료' 포함 + 오류 태그 없음
    """
    blocked = ("[오류]", "[거부]", "[차단]")
    has_blocked = any(token in content for token in blocked)
    if tool_name in _READ_ACTIONS:
        return not has_blocked
    return "완료" in content and not has_blocked


def _build_intern_result_summary(
    request: str,
    completed_actions: list[dict],
    failed_actions: list[dict],
) -> str:
    """Supervisor 전달용 intern_result 문자열을 만든다."""
    done = ", ".join(
        f"{item.get('tool')}({item.get('target')})" for item in completed_actions
    )
    fail = ", ".join(
        f"{item.get('tool')}({item.get('target')})" for item in failed_actions
    )

    # Supervisor가 파싱하기 쉽게 status를 고정 문자열로 만든다.
    if completed_actions and not failed_actions:
        status = "completed"
    elif completed_actions and failed_actions:
        status = "partial"
    elif failed_actions:
        status = "failed"
    else:
        status = "no_op"

    parts = [f"request={request}", f"status={status}"]
    if done:
        parts.append(f"done=[{done}]")
    if fail:
        parts.append(f"failed=[{fail}]")
    return " | ".join(parts)


def _save_report(report: dict, report_type: str) -> None:
    """보고서를 .storyboard-agent/intern-reports/<type>/ 에 저장한다."""
    report_dir = os.path.join(_REPORTS_DIR, report_type)
    os.makedirs(report_dir, exist_ok=True)

    # path traversal 방지: reports root 하위만 허용
    resolved = os.path.realpath(report_dir)
    if not resolved.startswith(os.path.realpath(_REPORTS_DIR)):
        return

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(report_dir, f"{ts}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 1) plan 노드
# ---------------------------------------------------------------------------
def intern_plan_node(state: InternState) -> dict:
    """첫 진입에서만 intern_plan을 생성한다."""
    # 이미 계획이 있으면 재생성하지 않는다(루프 중 plan 오염 방지).
    existing = state.get("intern_plan")
    if existing and existing.get("steps"):
        return {}

    instruction = _extract_instruction(state)
    prompt = INTERN_PLAN_PROMPT.format(instruction=instruction)
    # plan은 tool_call이 아니라 "텍스트(JSON)"로만 받는다.
    response = llm_intern.invoke(
        [SystemMessage(content=INTERN_SYSTEM_PROMPT), HumanMessage(content=prompt)]
    )
    plan = _parse_plan(response.content, fallback_instruction=instruction)

    state_update = {
        "intern_plan": plan,
        "messages": [AIMessage(content=f"초기 계획 수립 완료\n{_format_plan(plan)}")],
        "intern_result": None,  # 새 요청 처리 시작 시 이전 결과 초기화
    }
    return state_update


# ---------------------------------------------------------------------------
# 2) think 노드 + 라우팅
# ---------------------------------------------------------------------------
def intern_think_node(state: InternState) -> dict:
    """계획/대화 기반으로 다음 행동(tool_call or report)을 결정한다."""
    _, admin_tools = load_tools()
    instruction = _extract_instruction(state)
    plan_text = _format_plan(state.get("intern_plan"))

    messages = (
        [SystemMessage(content=INTERN_SYSTEM_PROMPT)]
        + list(state["messages"])
        + [
            HumanMessage(
                content=INTERN_THINK_PROMPT.format(
                    instruction=instruction,
                    intern_plan=plan_text,
                    messages=_stringify_recent_messages(state),
                )
            )
        ]
    )

    # think 단계는 ADMIN 도구를 bind해서 실제 tool_call을 유도한다.
    response = llm_intern.bind_tools(admin_tools).invoke(messages)
    result = {"messages": [response]}

    if response.tool_calls:
        names = [tc["name"] for tc in response.tool_calls]
        # 삭제는 사람 승인 흐름(interrupt_before)이 있으므로 우선 분기한다.
        if any(name in _DELETE_ACTIONS for name in names):
            result["intern_action"] = next(name for name in names if name in _DELETE_ACTIONS)
        elif any(name in _CREATE_ACTIONS for name in names):
            result["intern_action"] = next(name for name in names if name in _CREATE_ACTIONS)
        elif any(name in _READ_ACTIONS for name in names):
            result["intern_action"] = next(name for name in names if name in _READ_ACTIONS)
        else:
            result["intern_action"] = names[0]
    else:
        result["intern_action"] = "report"

    return result


def route_think(state: InternState) -> str:
    """think 결과를 다음 노드로 연결한다."""
    action = state.get("intern_action")
    if action in _DELETE_ACTIONS:
        return "execute_delete"
    if action in _CREATE_ACTIONS:
        return "review"
    if action in _READ_ACTIONS:
        # list/view는 코드 리뷰가 필요 없으므로 바로 execute로 보낸다.
        return "execute"
    return "update_plan"


# ---------------------------------------------------------------------------
# 3) review 노드 + human 이후 라우팅
# ---------------------------------------------------------------------------
def intern_review_node(state: InternState) -> dict:
    """create 코드 보안 리뷰 후 human 확인용 요약을 만든다."""
    tool_calls = _find_pending_tool_calls(state)
    codes_to_review = _extract_codes(tool_calls)
    has_code = any(c.get("code") for c in codes_to_review)

    if has_code:
        # create 계열만 코드 리뷰 대상이다.
        review_input = json.dumps(codes_to_review, ensure_ascii=False, indent=2)
        review_response = llm_reviewer.invoke(
            CODE_REVIEW_PROMPT.format(codes=review_input)
        )
        review_result = review_response.content
    else:
        review_result = "[REVIEW_PASS] 코드 없는 작업, 보안 리뷰 불필요"

    # human interrupt에서 바로 판단할 수 있도록 코드 원문 + 리뷰결과를 함께 보여준다.
    action = state.get("intern_action", "unknown")
    summary_parts = ["## Intern 코드 리뷰 결과\n", f"**작업 유형**: {action}\n"]

    for code_item in codes_to_review:
        if code_item["type"] == "python":
            summary_parts.append(f"### 도구: {code_item['tool_name']}")
            summary_parts.append("**목적**: tools/ 폴더에 새 도구 생성")
            summary_parts.append(f"```python\n{code_item['code']}\n```\n")
        elif code_item["type"] == "sql":
            summary_parts.append(f"### RPC 함수: {code_item['function_name']}")
            summary_parts.append("**목적**: supabase/ 폴더에 SQL RPC 함수 생성")
            summary_parts.append(f"```sql\n{code_item['code']}\n```\n")

    summary_parts.append(f"**보안 검토 결과**: {review_result}\n")

    # SQL 함수는 파일 생성과 DB 반영이 분리되어 있으므로 안내를 넣는다.
    has_rpc = any(code_item["type"] == "sql" for code_item in codes_to_review)
    if has_rpc and "[REVIEW_PASS]" in review_result:
        summary_parts.append(
            "> 문제가 없다면 이 RPC 함수를 Supabase SQL Editor에서 직접 실행해주세요.\n"
            "> 실행 완료 후 알려주세요.\n"
        )

    summary_parts.append("---")
    summary_parts.append("**선택지**: 승인(진행) / 수정 사항 전달 / 삭제(취소)")
    return {"messages": [AIMessage(content="\n".join(summary_parts))]}


def route_after_human(state: InternState) -> str:
    """review interrupt_after 이후 human 의도를 해석해 분기한다."""
    last_msg = state["messages"][-1]
    if not isinstance(last_msg, HumanMessage):
        return "think"

    content = last_msg.content.lower()
    if any(keyword in content for keyword in ("승인", "진행", "계속", "실행", "완료")):
        return "execute"
    if any(keyword in content for keyword in ("삭제", "취소", "중단")):
        return END
    return "think"


# ---------------------------------------------------------------------------
# 4) execute 노드
# ---------------------------------------------------------------------------
def intern_execute_node(state: InternState) -> dict:
    """create/read 계열 tool_calls를 실행한다."""
    return _run_tool_calls(state)


def intern_execute_delete_node(state: InternState) -> dict:
    """delete 계열 tool_calls를 실행한다."""
    return _run_tool_calls(state)


def _run_tool_calls(state: InternState) -> dict:
    """마지막 AI tool_calls를 ADMIN 도구로 실행하고 결과 메시지를 적재한다."""
    _, admin_tools = load_tools()
    tool_map = {tool.name: tool for tool in admin_tools}

    tool_calls = _find_pending_tool_calls(state)
    if not tool_calls:
        return {"messages": [AIMessage(content="실행할 도구가 없습니다.")]}

    results = []  # ToolMessage 누적
    artifacts = []  # create/delete 성공 산출물
    completed_actions = []  # intern_result용 성공 액션
    failed_actions = []  # intern_result용 실패 액션

    for tc in tool_calls:
        tool = tool_map.get(tc["name"])
        if not tool:
            fail_entry = {
                "tool": tc["name"],
                "target": tc["args"].get("tool_name")
                or tc["args"].get("function_name")
                or tc["args"].get("sql_name")
                or "unknown",
                "reason": "tool_not_found",
            }
            failed_actions.append(fail_entry)
            results.append(
                ToolMessage(
                    content=f"[오류] 도구 '{tc['name']}'을 찾을 수 없습니다.",
                    tool_call_id=tc["id"],
                    name=tc["name"],
                )
            )
            continue

        # 각 tool은 자체 보안검사를 수행하고 문자열 결과를 반환한다.
        result_str = str(tool.invoke(tc["args"]))
        results.append(
            ToolMessage(
                content=result_str,
                tool_call_id=tc["id"],
                name=tc["name"],
            )
        )

        artifact_name = tc["args"].get("tool_name") or tc["args"].get("function_name") or "unknown"
        action_ok = _is_action_success(tc["name"], result_str)
        if action_ok:
            completed_actions.append(
                {
                    "tool": tc["name"],
                    "target": artifact_name,
                    "result": result_str,
                }
            )
        else:
            failed_actions.append(
                {
                    "tool": tc["name"],
                    "target": artifact_name,
                    "result": result_str,
                }
            )

        # created_artifacts는 "생성/삭제"만 추적한다. read 도구는 포함하지 않는다.
        if tc["name"] in _CREATE_ACTIONS | _DELETE_ACTIONS and action_ok:
            status = "deleted" if tc["name"] in _DELETE_ACTIONS else "created"
            artifacts.append({"type": tc["name"], "name": artifact_name, "status": status})

    summary_lines = ["## 실행 결과"]
    for item in artifacts:
        summary_lines.append(f"- **{item['name']}** ({item['type']}): {item['status']}")

    state_update = {
        "messages": results + [AIMessage(content="\n".join(summary_lines))],
    }
    if artifacts:
        state_update["created_artifacts"] = artifacts

    # 사람 확인/디버깅용 리포트는 기존대로 파일에도 남긴다.
    report = {
        "timestamp": datetime.now().isoformat(),
        "type": "tool_execution",
        "artifacts": artifacts,
    }
    state_update["intern_reports"] = [report]
    _save_report(report, "tool-execution")

    # Supervisor 전달용 결과는 문자열 한 줄로 단순화한다.
    request_text = state.get("intern_request") or _extract_instruction(state)
    state_update["intern_result"] = _build_intern_result_summary(
        request=request_text,
        completed_actions=completed_actions,
        failed_actions=failed_actions,
    )

    return state_update


# ---------------------------------------------------------------------------
# 5) update_plan 노드 + 라우팅
# ---------------------------------------------------------------------------
def intern_update_plan_node(state: InternState) -> dict:
    """최근 실행 결과를 plan step 상태(completed/blocked)로 반영한다."""
    plan = _parse_plan(state.get("intern_plan"), fallback_instruction=_extract_instruction(state))
    steps = plan.get("steps", [])
    if not steps:
        return {"intern_plan": plan}

    current = _get_active_step(steps)
    action = state.get("intern_action")

    if action in _READ_ACTIONS:
        # read 성공/실패도 step 완료/차단에 반영한다.
        tool_msgs = _recent_tool_messages(state)
        if current and tool_msgs:
            last_tool_msg = tool_msgs[-1]
            if _is_action_success(last_tool_msg.name or "", last_tool_msg.content):
                current["status"] = "completed"
                current["result"] = last_tool_msg.content
                _activate_next_pending_step(steps)
            else:
                current["status"] = "blocked"
                current["result"] = last_tool_msg.content
        elif current and current.get("status") == "pending":
            current["status"] = "in_progress"

    elif action in _CREATE_ACTIONS | _DELETE_ACTIONS:
        # create/delete는 "완료" 키워드 기반 성공 판정
        tool_msgs = _recent_tool_messages(state)
        last_tool_msg = tool_msgs[-1] if tool_msgs else None
        if last_tool_msg:
            if _is_success_tool_result(last_tool_msg.content):
                if current:
                    current["status"] = "completed"
                    current["result"] = last_tool_msg.content
                _activate_next_pending_step(steps)
            elif current:
                current["status"] = "blocked"
                current["result"] = last_tool_msg.content

    elif action == "report":
        # 텍스트 보고 경로에서는 현재 진행중 step만 완료 처리
        if current and current.get("status") == "in_progress":
            current["status"] = "completed"

    plan["last_updated"] = datetime.now().isoformat()
    return {"intern_plan": plan}


def route_after_update_plan(state: InternState) -> str:
    """update_plan 이후 분기: report면 종료, 아니면 think 루프."""
    if state.get("intern_action") == "report":
        return "report"
    return "think"


# ---------------------------------------------------------------------------
# 6) report 노드
# ---------------------------------------------------------------------------
def intern_report_node(state: InternState) -> dict:
    """텍스트 응답 경로에서 최종 보고를 기록한다."""
    last_ai = None
    for msg in reversed(state["messages"]):
        if isinstance(msg, AIMessage):
            last_ai = msg
            break

    content = last_ai.content if last_ai else ""
    action = state.get("intern_action", "report")

    report = {
        "timestamp": datetime.now().isoformat(),
        "type": action,
        "content": content,
    }
    _save_report(report, action)

    return {
        "intern_reports": [report],
        "messages": [AIMessage(content=f"Intern 보고 완료: {action}")],
    }


# ---------------------------------------------------------------------------
# 그래프 조립
# ---------------------------------------------------------------------------
def build_intern_subgraph():
    """Intern 서브그래프를 조립하고 인터럽트 정책을 부여한다."""
    builder = StateGraph(InternState)

    builder.add_node("plan", intern_plan_node)
    builder.add_node("think", intern_think_node)
    builder.add_node("review", intern_review_node)
    builder.add_node("execute", intern_execute_node)
    builder.add_node("execute_delete", intern_execute_delete_node)
    builder.add_node("update_plan", intern_update_plan_node)
    builder.add_node("report", intern_report_node)

    # START -> plan -> think 기본 루프
    builder.add_edge(START, "plan")
    builder.add_edge("plan", "think")
    builder.add_conditional_edges("think", route_think)
    builder.add_conditional_edges("review", route_after_human)
    # execute 계열은 항상 계획 갱신을 거친다.
    builder.add_edge("execute", "update_plan")
    builder.add_edge("execute_delete", "update_plan")
    builder.add_conditional_edges("update_plan", route_after_update_plan)
    builder.add_edge("report", END)

    # create는 review 이후 human 확인, delete는 실행 전에 human 확인
    return builder.compile(
        checkpointer=memory,
        interrupt_after=["review"],
        interrupt_before=["execute_delete"],
    )
