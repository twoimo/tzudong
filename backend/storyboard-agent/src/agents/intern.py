"""Intern 에이전트 서브그래프.

그래프:
START -> plan -> think
think --(delete review 필요)--> execute_delete(interrupt_before)
think --(create 수정 필요)--> create_modify
think --(create review 필요)--> review_create(interrupt_after) -> create_review_decision
think --(실행 대기 call 존재)--> execute
execute / create_review_decision / execute_delete --(event 있으면)--> update_plan -> think
think --(tool call 없음)--> finish -> think -> END
"""

import json
import os
import uuid

from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ValidationError

from prompts.intern import (
    CODE_REVIEW_PROMPT,
    INTERN_BATCH_REVIEW_JSON_PROMPT,
    INTERN_BATCH_REVIEW_JSON_RETRY_PROMPT,
    INTERN_CREATE_MODIFY_PROMPT,
    INTERN_FINAL_RESULT_PROMPT,
    INTERN_PLAN_PROMPT,
    INTERN_SYSTEM_PROMPT,
    INTERN_THINK_PROMPT,
    INTERN_UPDATE_PLAN_PROMPT,
)
from state.main import InternState
from tools import load_tools


memory = MemorySaver()
llm_intern = ChatOpenAI(model="gpt-4o-mini")
llm_reviewer = ChatOpenAI(model="gpt-4o-mini")

_DELETE_ACTIONS = {"delete_tool", "delete_rpc_sql"}
_CREATE_ACTIONS = {"create_tool", "create_rpc_sql"}
_PLAN_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".storyboard-agent",
    "intern-reports",
    "plan",
    "active_plan.md",
)


class _ReviewPayload(BaseModel):
    """코드 리뷰 응답(JSON dict) 검증 모델."""

    reviews: dict[str, str]


def _is_delete_call(tc: dict) -> bool:
    """tool_call이 delete 계열인지 반환한다."""
    return tc.get("name") in _DELETE_ACTIONS


def _is_create_call(tc: dict) -> bool:
    """tool_call이 create 계열인지 반환한다."""
    return tc.get("name") in _CREATE_ACTIONS


def _call_target_name(tc: dict) -> str:
    """tool_call args에서 대상 이름(tool/function/sql)을 추출한다."""
    args = tc.get("args", {})
    return str(args.get("tool_name") or args.get("function_name") or args.get("sql_name") or "unknown")


def _call_key(tc: dict) -> str:
    """리뷰/상태 추적용 고유 키(tool:foo, rpc:bar)를 생성한다."""
    name = tc.get("name", "")
    target = _call_target_name(tc)
    if name in {"create_tool", "delete_tool"}:
        return f"tool:{target}"
    if name in {"create_rpc_sql", "delete_rpc_sql"}:
        return f"rpc:{target}"
    return f"{name}:{target}"


def _decision_from_human(text: str) -> str:
    """사람 입력을 approve/delete/modify 3가지로 단순 분류한다."""
    content = (text or "").strip()
    if content == "승인":
        return "approve"
    if content == "삭제":
        return "delete"
    return "modify"


def _is_error_result(raw: str) -> bool:
    """도구 실행 결과 문자열에 오류 토큰이 포함됐는지 검사한다."""
    return any(token in raw for token in ("[오류]", "[거부]", "[차단]"))


def _delete_review_prompt(tc: dict) -> str:
    """delete 대상 1건에 대한 사람 확인 프롬프트를 만든다."""
    key = _call_key(tc)
    return "\n".join(
        [
            "## Intern 삭제 리뷰",
            f"- 대상: {key}",
            "응답: 승인 / 삭제 / <수정 지시 텍스트>",
        ]
    )


def _create_review_prompt(tc: dict, review: str) -> str:
    """create 대상 1건에 대한 리뷰+사람 확인 프롬프트를 만든다."""
    key = _call_key(tc)
    return "\n".join(
        [
            "## Intern 생성 리뷰",
            f"- 대상: {key}",
            f"- 코드리뷰: {review}",
            "응답: 승인 / 삭제 / <수정 지시 텍스트>",
        ]
    )


def _cleanup_plan_file() -> None:
    """종료 시 active_plan.md를 삭제한다."""
    path = os.path.realpath(_PLAN_FILE)
    root = os.path.realpath(os.path.dirname(_PLAN_FILE))
    if path.startswith(root + os.sep) and os.path.exists(path):
        os.remove(path)


def _latest_ai_tool_calls(state: InternState) -> list[dict]:
    """messages에서 가장 최근 AIMessage의 tool_calls를 반환한다."""
    for msg in reversed(state["messages"]):
        if isinstance(msg, AIMessage) and msg.tool_calls:
            return msg.tool_calls
    return []


def _latest_intern_instruction(state: InternState) -> str:
    """intern 지시 history에서 최신 instruction을 읽는다."""
    history = (state.get("agent_instructions") or {}).get("intern") or []
    if history:
        return str(history[-1]).strip()
    req = state.get("intern_request")
    return req.strip() if isinstance(req, str) else ""


def _make_event_line(text: str) -> ToolMessage:
    """계획 자동 업데이트 입력용 이벤트 ToolMessage를 만든다."""
    return ToolMessage(
        id=f"plan_evt_{uuid.uuid4().hex}",
        content=text,
        tool_call_id=f"plan_event_{uuid.uuid4().hex}",
        name="plan_update_event",
    )


def _modified_entry(tc: dict, status: str = "pending", version: int = 1) -> dict:
    """modified_tool_calls에 저장할 표준 엔트리를 만든다."""
    return {"tool_call": tc, "status": status, "version": version}


def _find_first_modified(
    state: InternState,
    *,
    status_in: set[str],
    call_filter,
) -> tuple[str | None, dict | None]:
    """tool_call_order 순서대로 조건에 맞는 modified tool_call 1건을 찾는다."""
    order = state.get("tool_call_order") or []
    modified = state.get("modified_tool_calls") or {}
    for key in order:
        entry = modified.get(key) or {}
        tc = entry.get("tool_call")
        if not isinstance(tc, dict):
            continue
        if str(entry.get("status")) not in status_in:
            continue
        if not call_filter(tc):
            continue
        return key, entry
    return None, None


def _next_review_action(state: InternState) -> tuple[str | None, str | None]:
    """현재 modified_tool_calls 상태로 다음 리뷰 액션/대상을 계산한다."""
    key, _ = _find_first_modified(state, status_in={"needs_modify"}, call_filter=_is_create_call)
    if key:
        return "create_modify", key

    key, _ = _find_first_modified(state, status_in={"pending", "needs_modify"}, call_filter=_is_delete_call)
    if key:
        return "execute_delete", key

    key, _ = _find_first_modified(state, status_in={"pending"}, call_filter=_is_create_call)
    if key:
        return "review_create", key

    return None, None


def _format_original_tool_calls(state: InternState) -> str:
    """think 프롬프트용 원본 호출 요약 문자열."""
    calls = state.get("original_tool_calls") or []
    if not calls:
        return "- 없음"
    lines = []
    for tc in calls[-10:]:
        lines.append(f"- {_call_key(tc)} ({tc.get('name')})")
    return "\n".join(lines)


def _format_modified_tool_calls(state: InternState) -> str:
    """think 프롬프트용 수정본 상태 요약 문자열."""
    modified = state.get("modified_tool_calls") or {}
    order = state.get("tool_call_order") or []
    if not order:
        return "- 없음"
    lines = []
    for key in order:
        entry = modified.get(key) or {}
        tc = entry.get("tool_call") or {}
        status = entry.get("status", "unknown")
        version = entry.get("version", 1)
        lines.append(f"- {key}: {status} (v{version}, {tc.get('name', 'unknown')})")
    return "\n".join(lines)


def _review_create_call(tc: dict) -> str:
    """create 1건을 LLM 보안 리뷰하고 [REVIEW_PASS]/[REVIEW_REJECT] 문자열로 반환한다."""
    key = _call_key(tc)
    review_codes = [
        {
            "key": key,
            "type": "tool" if tc["name"] == "create_tool" else "rpc",
            "name": _call_target_name(tc),
            "code": tc.get("args", {}).get("code") or tc.get("args", {}).get("sql_code") or "",
        }
    ]
    codes_json = json.dumps(review_codes, ensure_ascii=False)
    keys_json = json.dumps([key], ensure_ascii=False)
    base = CODE_REVIEW_PROMPT.format(codes=codes_json)

    bad_output = ""
    bad_error = ""
    for attempt in range(3):
        prompt = (
            INTERN_BATCH_REVIEW_JSON_PROMPT.format(codes_json=codes_json, keys_json=keys_json)
            if attempt == 0
            else INTERN_BATCH_REVIEW_JSON_RETRY_PROMPT.format(
                bad_output=bad_output,
                error=bad_error,
                codes_json=codes_json,
                keys_json=keys_json,
            )
        )
        raw = (llm_reviewer.invoke([HumanMessage(content="\n".join([base, prompt]))]).content or "").strip()
        try:
            loaded = json.loads(raw)
            reviews = _ReviewPayload(reviews=loaded).reviews
            text = str(reviews.get(key, "")).strip()
            if text.startswith("[REVIEW_PASS]") or text.startswith("[REVIEW_REJECT]"):
                return text
            bad_output = raw
            bad_error = "값은 [REVIEW_PASS]/[REVIEW_REJECT]로 시작해야 함"
        except (json.JSONDecodeError, ValidationError) as e:
            bad_output = raw
            bad_error = str(e)

    return "[REVIEW_REJECT] 리뷰 JSON 검증 실패"


def intern_plan_node(state: InternState) -> dict:
    """intern_request를 기반으로 초기 계획 markdown을 생성/저장한다."""
    _, admin_tools = load_tools()
    tool_map = {tool.name: tool for tool in admin_tools}
    update_plan_tool = tool_map["update_intern_plan"]

    instruction = _latest_intern_instruction(state)
    plan_md = (
        llm_intern.invoke(
            [
                SystemMessage(content=INTERN_SYSTEM_PROMPT),
                HumanMessage(content=INTERN_PLAN_PROMPT.format(instruction=instruction)),
            ]
        ).content
        or ""
    ).strip()
    if not plan_md:
        return {
            "intern_result": f"request={instruction} | request_check=unmet | summary=초기 계획 생성 실패",
            "messages": [AIMessage(content="[오류] 초기 계획 생성 실패")],
        }

    result = update_plan_tool.invoke({"plan_markdown": plan_md})
    return {"messages": [AIMessage(content=f"초기 계획 수립 완료\n{result}")]}


def route_after_plan(state: InternState) -> str:
    """계획 생성 실패 시 종료, 아니면 think로 이동한다."""
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and "[오류] 초기 계획 생성 실패" in (last.content or ""):
        return "end"
    return "think"


def intern_think_node(state: InternState) -> dict:
    """요청/이력/수정 피드백을 보고 다음 작업을 결정한다."""
    # 1) 실행 대기 큐가 있으면 먼저 실행한다.
    pending_exec = state.get("pending_execute_calls") or []
    if pending_exec:
        return {"intern_action": "execute"}

    # 2) 수정본 상태(modified_tool_calls)에서 다음 리뷰 대상을 결정한다.
    next_action, next_key = _next_review_action(state)
    if next_action and next_key:
        update = {"intern_action": next_action, "current_tool_key": next_key}
        if next_action == "execute_delete":
            entry = (state.get("modified_tool_calls") or {}).get(next_key) or {}
            tc = entry.get("tool_call")
            if isinstance(tc, dict):
                update["messages"] = [AIMessage(content=_delete_review_prompt(tc))]
        return update

    # 3) 계획 업데이트 이벤트가 있으면 반영한다.
    pending_events = [msg for msg in (state.get("plan_update_events") or []) if isinstance(msg, ToolMessage)]
    if pending_events:
        return {"intern_action": "update_plan"}

    # 4) finish 이후에는 think에서만 END로 분기한다.
    if state.get("intern_ready_to_end"):
        return {"intern_action": "end"}

    _, admin_tools = load_tools()
    think_tools = [tool for tool in admin_tools if tool.name != "update_intern_plan"]

    instruction = _latest_intern_instruction(state)

    recent = []
    for msg in state["messages"][-8:]:
        role = "assistant" if isinstance(msg, AIMessage) else "user"
        if isinstance(msg, ToolMessage):
            role = f"tool:{msg.name}"
        recent.append(f"[{role}] {msg.content}")

    modified = state.get("pending_modified_feedback") or {}
    modified_lines = [f"- {k}: {v}" for k, v in modified.items() if isinstance(v, str) and v.strip()]
    modified_text = "\n".join(modified_lines) if modified_lines else "- 없음"

    artifact_states = state.get("artifact_statuses") or {}
    artifact_lines = [f"- {k}: {v}" for k, v in artifact_states.items()]
    artifact_text = "\n".join(artifact_lines) if artifact_lines else "- 없음"

    response = llm_intern.bind_tools(think_tools).invoke(
        [SystemMessage(content=INTERN_SYSTEM_PROMPT)]
        + [
            HumanMessage(
                content=INTERN_THINK_PROMPT.format(
                    instruction=instruction,
                    messages="\n".join(recent),
                    modified_feedback=modified_text,
                    artifact_statuses=artifact_text,
                    original_tool_calls=_format_original_tool_calls(state),
                    modified_tool_calls=_format_modified_tool_calls(state),
                )
            )
        ]
    )

    tool_calls = response.tool_calls or []
    if not tool_calls:
        return {
            "intern_action": "finish",
            "pending_execute_calls": [],
            "pending_review_notes": {},
        }

    modified = dict(state.get("modified_tool_calls") or {})
    existing_order = list(state.get("tool_call_order") or [])
    added_order = []
    review_calls = []
    review_calls = [tc for tc in tool_calls if tc["name"] in (_CREATE_ACTIONS | _DELETE_ACTIONS)]
    execute_calls = [tc for tc in tool_calls if tc["name"] not in (_CREATE_ACTIONS | _DELETE_ACTIONS)]
    for tc in review_calls:
        key = _call_key(tc)
        prev = modified.get(key) or {}
        version = int(prev.get("version", 0)) + 1
        modified[key] = _modified_entry(tc=tc, status="pending", version=version)
        if key not in existing_order and key not in added_order:
            added_order.append(key)

    temp_state = {
        **state,
        "modified_tool_calls": modified,
        "tool_call_order": [*existing_order, *added_order],
    }
    next_action, next_key = _next_review_action(temp_state) if review_calls else (None, None)
    if execute_calls and not next_action:
        next_action = "execute"

    update = {
        "messages": [AIMessage(content=response.content, tool_calls=execute_calls)],
        "intern_action": next_action or "think",
        "pending_execute_calls": execute_calls,
        "original_tool_calls": tool_calls,
        "modified_tool_calls": modified,
        "tool_call_order": added_order,
        "current_tool_key": next_key,
        "intern_ready_to_end": False,
    }
    if next_action == "execute_delete" and next_key:
        entry = modified.get(next_key) or {}
        tc = entry.get("tool_call")
        if isinstance(tc, dict):
            update["messages"] = [AIMessage(content=_delete_review_prompt(tc))]
    elif next_action == "review_create":
        update["messages"] = [AIMessage(content="create 리뷰 시작")]
    return update


def route_think(state: InternState) -> str:
    """think 결과(intern_action)에 따라 다음 노드로 이동한다."""
    action = state.get("intern_action")
    if action == "end":
        return END
    if action == "create_modify":
        return "create_modify"
    if action == "execute_delete":
        return "execute_delete"
    if action == "review_create":
        return "review_create"
    if action == "execute":
        return "execute"
    if action == "update_plan":
        return "update_plan"
    if action == "finish":
        return "finish"
    return "think"


def intern_create_modify_node(state: InternState) -> dict:
    """수정 요청된 create 호출 1건을 다시 생성한다."""
    key = state.get("current_tool_key")
    modified = dict(state.get("modified_tool_calls") or {})
    if not key:
        key, _ = _find_first_modified(state, status_in={"needs_modify"}, call_filter=_is_create_call)
        if not key:
            return {"intern_action": "think"}

    entry = modified.get(key) or {}
    tc = entry.get("tool_call")
    if not isinstance(tc, dict) or not _is_create_call(tc):
        return {"intern_action": "think"}

    note = str((state.get("pending_modified_feedback") or {}).get(key) or "").strip()
    if not note:
        return {"intern_action": "review_create", "current_tool_key": key}

    _, admin_tools = load_tools()
    tool_map = {tool.name: tool for tool in admin_tools}
    target_tool = tool_map.get(tc["name"])
    if not target_tool:
        return {
            "intern_action": "think",
            "messages": [AIMessage(content=f"[오류] 수정 대상 도구를 찾을 수 없습니다: {tc.get('name')}")],
        }

    response = llm_intern.bind_tools([target_tool]).invoke(
        [
            SystemMessage(content=INTERN_SYSTEM_PROMPT),
            HumanMessage(
                content=INTERN_CREATE_MODIFY_PROMPT.format(
                    target_key=key,
                    current_tool_call=json.dumps(tc, ensure_ascii=False),
                    modify_feedback=note,
                )
            ),
        ]
    )
    regenerated = response.tool_calls or []
    if len(regenerated) != 1:
        return {
            "intern_action": "review_create",
            "current_tool_key": key,
            "messages": [AIMessage(content=f"[경고] {key} 수정본 생성 실패. 기존 호출로 리뷰를 계속합니다.")],
        }

    new_tc = regenerated[0]
    if new_tc.get("name") != tc.get("name") or _call_key(new_tc) != key:
        return {
            "intern_action": "review_create",
            "current_tool_key": key,
            "messages": [AIMessage(content=f"[경고] {key} 수정본이 대상과 불일치합니다. 기존 호출로 리뷰를 계속합니다.")],
        }

    version = int(entry.get("version", 1)) + 1
    modified[key] = _modified_entry(tc=new_tc, status="pending", version=version)
    return {
        "intern_action": "review_create",
        "current_tool_key": key,
        "modified_tool_calls": {key: modified[key]},
        "pending_review_notes": {},
        "pending_modified_feedback": {key: ""},
        "messages": [AIMessage(content=f"{key} 수정본 생성 완료(v{version}). 다시 리뷰합니다.")],
    }


def route_after_create_modify(state: InternState) -> str:
    """create_modify 이후 intern_action 기준으로 이동한다."""
    action = state.get("intern_action")
    if action == "review_create":
        return "review_create"
    if action == "update_plan":
        return "update_plan"
    return "think"


def intern_review_create_node(state: InternState) -> dict:
    """현재 create 1건의 코드 리뷰를 보여주고 사람 결정을 기다린다."""
    key = state.get("current_tool_key")
    if key:
        entry = (state.get("modified_tool_calls") or {}).get(key) or {}
        tc = entry.get("tool_call")
        if not isinstance(tc, dict) or not (_is_create_call(tc) and str(entry.get("status")) == "pending"):
            key = None

    if not key:
        key, entry = _find_first_modified(state, status_in={"pending"}, call_filter=_is_create_call)
        if not key:
            return {
                "intern_action": "think",
                "messages": [
                    AIMessage(
                        content="[안내] 리뷰할 create 대상이 없습니다. 생성 요청이 반영되지 않았거나 이미 처리되었습니다."
                    )
                ],
            }
        tc = entry.get("tool_call")
    else:
        entry = (state.get("modified_tool_calls") or {}).get(key) or {}
        tc = entry.get("tool_call")

    if not isinstance(tc, dict):
        return {"intern_action": "think"}

    version = int(entry.get("version", 1))
    note_key = f"{key}@{version}"
    notes = dict(state.get("pending_review_notes") or {})
    if note_key not in notes:
        notes[note_key] = _review_create_call(tc)

    return {
        "current_tool_key": key,
        "pending_review_notes": notes,
        "messages": [AIMessage(content=_create_review_prompt(tc, notes[note_key]))],
    }


def route_after_review_create(state: InternState) -> str:
    """create 리뷰 후 사람 응답이 들어오면 결정 노드로 이동한다."""
    return "create_review_decision" if isinstance(state["messages"][-1], HumanMessage) else "review_create"


def intern_create_review_decision_node(state: InternState) -> dict:
    """create 리뷰 응답(승인/삭제/수정)을 처리한다."""
    last = state["messages"][-1]
    if not isinstance(last, HumanMessage):
        return {"intern_action": "review_create"}

    key = state.get("current_tool_key")
    if not key:
        key, _ = _find_first_modified(state, status_in={"pending"}, call_filter=_is_create_call)
        if not key:
            return {"intern_action": "think"}

    modified = dict(state.get("modified_tool_calls") or {})
    entry = modified.get(key) or {}
    current = entry.get("tool_call")
    if not isinstance(current, dict) or not _is_create_call(current):
        return {"intern_action": "think"}

    # 래퍼: 사람 입력을 승인/삭제/수정으로 통일해 후속 분기 단순화.
    decision = _decision_from_human(last.content or "")
    notes = dict(state.get("pending_review_notes") or {})
    for nk in list(notes.keys()):
        if nk.startswith(f"{key}@"):
            notes.pop(nk, None)
    existing_exec = list(state.get("pending_execute_calls") or [])
    messages = []
    events = []
    review_statuses = {key: decision}
    modified_update = {}

    if decision == "approve":
        messages.append(AIMessage(content=f"{key} 승인됨. 실행 대기열에 추가합니다."))
        modified[key] = _modified_entry(tc=current, status="approved", version=int(entry.get("version", 1)))
        events.append(_make_event_line(f"- {key}: 승인(실행 대기)"))
        next_action, next_key = _next_review_action({**state, "modified_tool_calls": modified})
        if not next_action and [*existing_exec, current]:
            next_action = "execute"
        return {
            "intern_action": next_action or "think",
            "current_tool_key": next_key,
            "messages": messages,
            "pending_review_notes": notes,
            "pending_execute_calls": [*existing_exec, current],
            "review_statuses": review_statuses,
            "modified_tool_calls": {key: modified[key]},
            "pending_modified_feedback": {key: ""},
            "plan_update_events": events,
        }

    if decision == "delete":
        messages.append(AIMessage(content=f"{key}는 사람 요청으로 실행 없이 제거했습니다."))
        modified[key] = _modified_entry(tc=current, status="rejected", version=int(entry.get("version", 1)))
        events.append(_make_event_line(f"- {key}: 리뷰 삭제(실행 안함)"))
    else:
        feedback = (last.content or "").strip()
        messages.append(AIMessage(content=f"{key} 수정 요청 저장. think에서 반영하세요."))
        modified[key] = _modified_entry(tc=current, status="needs_modify", version=int(entry.get("version", 1)))
        events.append(_make_event_line(f"- {key}: 수정 요청 - {feedback}"))
        modified_update[key] = feedback

    update = {
        "intern_action": "update_plan",
        "messages": messages,
        "pending_review_notes": notes,
        "pending_execute_calls": existing_exec,
        "review_statuses": review_statuses,
        "modified_tool_calls": {key: modified[key]},
    }
    if events:
        update["plan_update_events"] = events
    if modified_update:
        update["pending_modified_feedback"] = modified_update
    return update


def route_after_create_review_decision(state: InternState) -> str:
    """create 리뷰 결정 결과(intern_action)를 다음 노드로 매핑한다."""
    action = state.get("intern_action")
    if action == "create_modify":
        return "create_modify"
    if action == "execute":
        return "execute"
    if action == "execute_delete":
        return "execute_delete"
    if action == "review_create":
        return "review_create"
    if action == "update_plan":
        return "update_plan"
    return "think"


def intern_execute_delete_node(state: InternState) -> dict:
    """삭제 1건에 대한 사람 결정(승인/삭제/수정)을 처리한다.

    이 노드는 interrupt_before로 멈춘 뒤 들어온 HumanMessage를 기준으로 동작한다.
    """
    key = state.get("current_tool_key")
    if key:
        entry = (state.get("modified_tool_calls") or {}).get(key) or {}
        current = entry.get("tool_call")
        if not (isinstance(current, dict) and _is_delete_call(current) and str(entry.get("status")) in {"pending", "needs_modify"}):
            key = None

    if not key:
        key, entry = _find_first_modified(state, status_in={"pending", "needs_modify"}, call_filter=_is_delete_call)
        if not key:
            return {"intern_action": "think"}
        current = entry.get("tool_call")

    if not isinstance(current, dict):
        return {"intern_action": "think"}

    last = state["messages"][-1]
    if not isinstance(last, HumanMessage):
        return {"intern_action": "execute_delete", "messages": [AIMessage(content=_delete_review_prompt(current))]}

    modified = dict(state.get("modified_tool_calls") or {})
    entry = modified.get(key) or {}
    # 래퍼: 사람 입력을 승인/삭제/수정으로 통일해 후속 분기 단순화.
    decision = _decision_from_human(last.content or "")
    existing_exec = list(state.get("pending_execute_calls") or [])
    messages = []
    events = []
    review_statuses = {key: decision}
    modified_update = {}

    if decision == "approve":
        messages.append(AIMessage(content=f"{key} 승인됨. 실행 대기열에 추가합니다."))
        modified[key] = _modified_entry(tc=current, status="approved", version=int(entry.get("version", 1)))
        events.append(_make_event_line(f"- {key}: 승인(실행 대기)"))
        next_action, next_key = _next_review_action({**state, "modified_tool_calls": modified})
        if not next_action and [*existing_exec, current]:
            next_action = "execute"
        return {
            "intern_action": next_action or "think",
            "current_tool_key": next_key,
            "messages": messages,
            "pending_execute_calls": [*existing_exec, current],
            "review_statuses": review_statuses,
            "modified_tool_calls": {key: modified[key]},
            "pending_modified_feedback": {key: ""},
            "plan_update_events": events,
        }

    if decision == "delete":
        messages.append(AIMessage(content=f"{key}는 사람 요청으로 실행 없이 제거했습니다."))
        modified[key] = _modified_entry(tc=current, status="rejected", version=int(entry.get("version", 1)))
        events.append(_make_event_line(f"- {key}: 삭제 취소(실행 안함)"))
    else:
        feedback = (last.content or "").strip()
        messages.append(AIMessage(content=f"{key} 수정 요청 저장. think에서 반영하세요."))
        modified[key] = _modified_entry(tc=current, status="needs_modify", version=int(entry.get("version", 1)))
        events.append(_make_event_line(f"- {key}: 수정 요청 - {feedback}"))
        modified_update[key] = feedback

    update = {
        "intern_action": "update_plan",
        "messages": messages,
        "pending_execute_calls": existing_exec,
        "review_statuses": review_statuses,
        "modified_tool_calls": {key: modified[key]},
    }
    if events:
        update["plan_update_events"] = events
    if modified_update:
        update["pending_modified_feedback"] = modified_update
    return update


def route_after_execute_delete(state: InternState) -> str:
    """delete 리뷰 결정 후 다음 동작으로 이동한다."""
    action = state.get("intern_action")
    if action == "create_modify":
        return "create_modify"
    if action == "execute":
        return "execute"
    if action == "execute_delete":
        return "execute_delete"
    if action == "review_create":
        return "review_create"
    if action == "update_plan":
        return "update_plan"
    return "think"


def intern_execute_node(state: InternState) -> dict:
    """승인된 호출(pending_execute_calls) 또는 일반 호출을 실행한다."""
    _, admin_tools = load_tools()
    tool_map = {tool.name: tool for tool in admin_tools}

    calls = state.get("pending_execute_calls") or _latest_ai_tool_calls(state)
    if not calls:
        return {"intern_action": "think"}

    messages = []
    events = []
    artifacts = []
    artifact_status_updates = {}
    modified_clear = {}
    modified_updates = {}

    for tc in calls:
        name = tc["name"]
        tool = tool_map.get(name)
        if not tool:
            raw = f"[오류] 도구 '{name}'을 찾을 수 없습니다."
        else:
            raw = str(tool.invoke(tc.get("args", {})))
        messages.append(ToolMessage(content=raw, tool_call_id=tc.get("id", f"tc_{uuid.uuid4().hex}"), name=name))

        if name in (_CREATE_ACTIONS | _DELETE_ACTIONS):
            key = _call_key(tc)
            status = "failed" if _is_error_result(raw) else ("deleted" if name in _DELETE_ACTIONS else "created")
            events.append(_make_event_line(f"- {key}: {status} | {raw}"))
            artifacts.append({"type": name, "name": _call_target_name(tc), "status": status})
            artifact_status_updates[key] = status
            entry = (state.get("modified_tool_calls") or {}).get(key) or {}
            next_modified_status = "failed" if status == "failed" else "executed"
            modified_updates[key] = _modified_entry(
                tc=entry.get("tool_call") if isinstance(entry.get("tool_call"), dict) else tc,
                status=next_modified_status,
                version=int(entry.get("version", 1)),
            )
            if status in {"created", "deleted"}:
                modified_clear[key] = ""

    next_action = "update_plan" if events else "think"

    update = {
        "messages": messages + [AIMessage(content="도구 실행 완료")],
        "intern_action": next_action,
        "pending_execute_calls": [],
    }
    if events:
        update["plan_update_events"] = events
    if artifacts:
        update["created_artifacts"] = artifacts
    if artifact_status_updates:
        update["artifact_statuses"] = artifact_status_updates
    if modified_clear:
        update["pending_modified_feedback"] = modified_clear
    if modified_updates:
        update["modified_tool_calls"] = modified_updates
    return update


def route_after_execute(state: InternState) -> str:
    """execute 이후 intern_action 기준으로 다음 노드를 선택한다."""
    action = state.get("intern_action")
    if action == "execute_delete":
        return "execute_delete"
    if action == "review_create":
        return "review_create"
    if action == "update_plan":
        return "update_plan"
    return "think"


def intern_update_plan_node(state: InternState) -> dict:
    """plan_update_events를 반영해 계획 markdown을 1회 갱신한다."""
    pending_events = [msg for msg in (state.get("plan_update_events") or []) if isinstance(msg, ToolMessage)]
    default_action = "think"

    if not pending_events:
        return {"intern_action": default_action}

    _, admin_tools = load_tools()
    tool_map = {tool.name: tool for tool in admin_tools}
    view_result = tool_map["view_intern_plan"].invoke({})
    current_plan = str(view_result.get("plan_markdown", "")) if isinstance(view_result, dict) else ""
    if not current_plan:
        consumed = [RemoveMessage(id=msg.id) for msg in pending_events if msg.id]
        return {"plan_update_events": consumed, "intern_action": default_action}

    instruction = _latest_intern_instruction(state)
    event_text = "\n".join([(msg.content or "") for msg in pending_events])
    updated_plan = (
        llm_intern.invoke(
            [
                SystemMessage(content=INTERN_SYSTEM_PROMPT),
                HumanMessage(
                    content=INTERN_UPDATE_PLAN_PROMPT.format(
                        instruction=instruction,
                        current_plan=current_plan,
                        source_name="review_and_execute",
                        event_content=event_text,
                    )
                ),
            ]
        ).content
        or ""
    ).strip()

    if updated_plan:
        tool_map["update_intern_plan"].invoke({"plan_markdown": updated_plan})

    consumed = [RemoveMessage(id=msg.id) for msg in pending_events if msg.id]
    return {
        "messages": [AIMessage(content="계획 업데이트 완료")],
        "plan_update_events": consumed,
        "intern_action": default_action,
    }


def route_after_update_plan(state: InternState) -> str:
    """update_plan 이후 intern_action에 따라 이동한다."""
    action = state.get("intern_action")
    if action == "execute_delete":
        return "execute_delete"
    if action == "review_create":
        return "review_create"
    return "think"


def intern_finish_node(state: InternState) -> dict:
    """최종 intern_result를 생성하고 plan 파일을 정리한다."""
    _, admin_tools = load_tools()
    tool_map = {tool.name: tool for tool in admin_tools}

    instruction = _latest_intern_instruction(state)

    artifacts = state.get("created_artifacts") or []
    artifact_lines = [f"- {x.get('type')}:{x.get('name')}:{x.get('status')}" for x in artifacts]

    artifact_states = state.get("artifact_statuses") or {}
    state_lines = [f"- {k}:{v}" for k, v in artifact_states.items()]

    modified = state.get("pending_modified_feedback") or {}
    modified_lines = [f"- {k}:{v}" for k, v in modified.items() if isinstance(v, str) and v.strip()]

    artifacts_text = "\n".join(artifact_lines + ["-- current --"] + state_lines + ["-- modified --"] + modified_lines)
    if not artifacts_text.strip():
        artifacts_text = "- 없음"

    view_result = tool_map["view_intern_plan"].invoke({})
    plan_md = str(view_result.get("plan_markdown", "")) if isinstance(view_result, dict) else ""

    intern_result = (
        llm_intern.invoke(
            [
                SystemMessage(content=INTERN_SYSTEM_PROMPT),
                HumanMessage(
                    content=INTERN_FINAL_RESULT_PROMPT.format(
                        instruction=instruction,
                        artifacts_text=artifacts_text,
                        plan_md=plan_md,
                    )
                ),
            ]
        ).content
        or ""
    ).strip()
    if not intern_result:
        intern_result = f"request={instruction} | request_check=unmet | summary=결과 생성 실패"

    _cleanup_plan_file()
    return {
        "intern_action": "think",
        "intern_ready_to_end": True,
        "intern_result": intern_result,
        "messages": [AIMessage(content=f"Intern 보고 완료\n{intern_result}")],
    }


def route_after_finish(state: InternState) -> str:
    """finish 이후에는 think로 복귀해 END 조건을 한 곳에서만 판단한다."""
    return "think"


def build_intern_subgraph():
    """Intern 서브그래프를 구성하고 interrupt 정책을 적용한다."""
    builder = StateGraph(InternState)
    builder.add_node("plan", intern_plan_node)
    builder.add_node("think", intern_think_node)
    builder.add_node("create_modify", intern_create_modify_node)
    builder.add_node("review_create", intern_review_create_node)
    builder.add_node("create_review_decision", intern_create_review_decision_node)
    builder.add_node("execute", intern_execute_node)
    builder.add_node("execute_delete", intern_execute_delete_node)
    builder.add_node("update_plan", intern_update_plan_node)
    builder.add_node("finish", intern_finish_node)

    builder.add_edge(START, "plan")
    builder.add_conditional_edges("plan", route_after_plan, {"think": "think", "end": END})
    builder.add_conditional_edges("think", route_think)
    builder.add_conditional_edges("create_modify", route_after_create_modify)
    builder.add_conditional_edges("review_create", route_after_review_create)
    builder.add_conditional_edges("create_review_decision", route_after_create_review_decision)
    builder.add_conditional_edges("execute", route_after_execute)
    builder.add_conditional_edges("execute_delete", route_after_execute_delete)
    builder.add_conditional_edges("update_plan", route_after_update_plan)
    builder.add_conditional_edges("finish", route_after_finish)

    return builder.compile(
        checkpointer=memory,
        interrupt_after=["review_create"],
        interrupt_before=["execute_delete"],
    )
