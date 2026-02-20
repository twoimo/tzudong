"""Intern 에이전트 서브그래프.

그래프:
START -> plan -> think
think --(delete review 필요)--> execute_delete(interrupt_before)
think --(create review 필요)--> review_create(interrupt_after) -> create_review_decision
think --(일반 tool call)--> execute
execute / create_review_decision / execute_delete --(event 있으면)--> update_plan -> think
think --(tool call 없음)--> finish -> END
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


def _next_action_from_pending(pending: list[dict]) -> str:
    """리뷰 큐의 첫 항목 타입으로 다음 액션(review_create/execute_delete/think)을 고른다."""
    if not pending:
        return "think"
    return "execute_delete" if _is_delete_call(pending[0]) else "review_create"


def _make_event_line(text: str) -> ToolMessage:
    """계획 자동 업데이트 입력용 이벤트 ToolMessage를 만든다."""
    return ToolMessage(
        id=f"plan_evt_{uuid.uuid4().hex}",
        content=text,
        tool_call_id=f"plan_event_{uuid.uuid4().hex}",
        name="plan_update_event",
    )


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

    req = state.get("intern_request")
    instruction = req.strip() if isinstance(req, str) else ""
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
    # 1) 기존 리뷰 큐가 남아 있으면 리뷰를 우선 처리한다.
    pending = state.get("pending_review_calls") or []
    if pending:
        # 래퍼: 리뷰 큐 첫 항목 타입으로 분기 액션을 계산한다.
        return {"intern_action": _next_action_from_pending(pending)}
    # 2) 기존 실행 큐가 남아 있으면 바로 실행한다.
    pending_exec = state.get("pending_execute_calls") or []
    if pending_exec:
        return {"intern_action": "execute"}

    _, admin_tools = load_tools()
    think_tools = [tool for tool in admin_tools if tool.name != "update_intern_plan"]

    req = state.get("intern_request")
    instruction = req.strip() if isinstance(req, str) else ""

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
                )
            )
        ]
    )

    tool_calls = response.tool_calls or []
    if not tool_calls:
        return {
            "intern_action": "finish",
            "pending_execute_calls": [],
            "pending_review_calls": [],
            "pending_review_notes": {},
        }

    review_calls = [tc for tc in tool_calls if tc["name"] in (_CREATE_ACTIONS | _DELETE_ACTIONS)]
    execute_calls = [tc for tc in tool_calls if tc["name"] not in (_CREATE_ACTIONS | _DELETE_ACTIONS)]

    if review_calls:
        deletes = [tc for tc in review_calls if _is_delete_call(tc)]
        creates = [tc for tc in review_calls if _is_create_call(tc)]
        ordered = [*deletes, *creates]

        # create/delete 리뷰가 끝난 뒤 실행할 나머지 호출도 큐에 보존한다.
        update = {
            "pending_review_calls": ordered,
            "pending_review_notes": {},
            "pending_execute_calls": execute_calls,
            # 래퍼: delete 우선 처리 규칙을 액션으로 변환한다.
            "intern_action": _next_action_from_pending(ordered),
        }
        if ordered and _is_delete_call(ordered[0]):
            update["messages"] = [AIMessage(content=_delete_review_prompt(ordered[0]))]
        else:
            update["messages"] = [AIMessage(content="create 리뷰 시작")]
        return update

    return {
        "messages": [AIMessage(content=response.content, tool_calls=execute_calls)],
        "intern_action": "execute",
        "pending_execute_calls": execute_calls,
    }


def route_think(state: InternState) -> str:
    """think 결과(intern_action)에 따라 다음 노드로 이동한다."""
    action = state.get("intern_action")
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


def intern_review_create_node(state: InternState) -> dict:
    """현재 create 1건의 코드 리뷰를 보여주고 사람 결정을 기다린다."""
    pending = state.get("pending_review_calls") or []
    if not pending:
        return {"intern_action": "think"}

    current = pending[0]
    if _is_delete_call(current):
        return {"intern_action": "execute_delete", "messages": [AIMessage(content=_delete_review_prompt(current))]}

    key = _call_key(current)
    notes = dict(state.get("pending_review_notes") or {})
    if key not in notes:
        notes[key] = _review_create_call(current)

    return {
        "pending_review_notes": notes,
        "messages": [AIMessage(content=_create_review_prompt(current, notes[key]))],
    }


def route_after_review_create(state: InternState) -> str:
    """create 리뷰 후 사람 응답이 들어오면 결정 노드로 이동한다."""
    return "create_review_decision" if isinstance(state["messages"][-1], HumanMessage) else "review_create"


def intern_create_review_decision_node(state: InternState) -> dict:
    """create 리뷰 응답(승인/삭제/수정)을 처리한다."""
    last = state["messages"][-1]
    pending = state.get("pending_review_calls") or []
    if not isinstance(last, HumanMessage) or not pending:
        return {"intern_action": "review_create"}

    current = pending[0]
    rest = pending[1:]
    if _is_delete_call(current):
        return {"intern_action": "execute_delete", "messages": [AIMessage(content=_delete_review_prompt(current))]}

    key = _call_key(current)
    # 래퍼: 사람 입력을 승인/삭제/수정으로 통일해 후속 분기 단순화.
    decision = _decision_from_human(last.content or "")
    notes = dict(state.get("pending_review_notes") or {})
    notes.pop(key, None)
    existing_exec = list(state.get("pending_execute_calls") or [])
    messages = []
    events = []
    review_statuses = {key: decision}
    modified_update = {}

    if decision == "approve":
        messages.append(AIMessage(content=f"{key} 승인됨. 실행합니다."))
        return {
            "intern_action": "execute",
            "messages": messages,
            "pending_review_calls": rest,
            "pending_review_notes": notes,
            "pending_execute_calls": [*existing_exec, current],
            "review_statuses": review_statuses,
            "pending_modified_feedback": {key: ""},
        }

    if decision == "delete":
        messages.append(AIMessage(content=f"{key}는 사람 요청으로 실행 없이 제거했습니다."))
        events.append(_make_event_line(f"- {key}: 리뷰 삭제(실행 안함)"))
    else:
        feedback = (last.content or "").strip()
        messages.append(AIMessage(content=f"{key} 수정 요청 저장. think에서 반영하세요."))
        events.append(_make_event_line(f"- {key}: 수정 요청 - {feedback}"))
        modified_update[key] = feedback

    if rest:
        # 래퍼: 남은 리뷰 큐 첫 항목을 다음 노드 액션으로 매핑한다.
        next_action = _next_action_from_pending(rest)
    elif existing_exec:
        next_action = "execute"
    elif events:
        next_action = "update_plan"
    else:
        next_action = "think"
    if next_action == "execute_delete" and rest:
        messages.append(AIMessage(content=_delete_review_prompt(rest[0])))

    update = {
        "intern_action": next_action,
        "messages": messages,
        "pending_review_calls": rest,
        "pending_review_notes": notes,
        "pending_execute_calls": existing_exec,
        "review_statuses": review_statuses,
    }
    if events:
        update["plan_update_events"] = events
    if modified_update:
        update["pending_modified_feedback"] = modified_update
    return update


def route_after_create_review_decision(state: InternState) -> str:
    """create 리뷰 결정 결과(intern_action)를 다음 노드로 매핑한다."""
    action = state.get("intern_action")
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
    pending = state.get("pending_review_calls") or []
    if not pending:
        return {"intern_action": "think"}

    current = pending[0]
    rest = pending[1:]
    if not _is_delete_call(current):
        return {"intern_action": "review_create"}

    last = state["messages"][-1]
    if not isinstance(last, HumanMessage):
        return {"intern_action": "execute_delete", "messages": [AIMessage(content=_delete_review_prompt(current))]}

    key = _call_key(current)
    # 래퍼: 사람 입력을 승인/삭제/수정으로 통일해 후속 분기 단순화.
    decision = _decision_from_human(last.content or "")
    existing_exec = list(state.get("pending_execute_calls") or [])
    messages = []
    events = []
    review_statuses = {key: decision}
    modified_update = {}

    if decision == "approve":
        messages.append(AIMessage(content=f"{key} 승인됨. 실행합니다."))
        return {
            "intern_action": "execute",
            "messages": messages,
            "pending_review_calls": rest,
            "pending_execute_calls": [*existing_exec, current],
            "review_statuses": review_statuses,
            "pending_modified_feedback": {key: ""},
        }

    if decision == "delete":
        messages.append(AIMessage(content=f"{key}는 사람 요청으로 실행 없이 제거했습니다."))
        events.append(_make_event_line(f"- {key}: 삭제 취소(실행 안함)"))
    else:
        feedback = (last.content or "").strip()
        messages.append(AIMessage(content=f"{key} 수정 요청 저장. think에서 반영하세요."))
        events.append(_make_event_line(f"- {key}: 수정 요청 - {feedback}"))
        modified_update[key] = feedback

    if rest:
        # 래퍼: 남은 리뷰 큐 첫 항목을 다음 노드 액션으로 매핑한다.
        next_action = _next_action_from_pending(rest)
    elif existing_exec:
        next_action = "execute"
    elif events:
        next_action = "update_plan"
    else:
        next_action = "think"
    if next_action == "execute_delete" and rest:
        messages.append(AIMessage(content=_delete_review_prompt(rest[0])))

    update = {
        "intern_action": next_action,
        "messages": messages,
        "pending_review_calls": rest,
        "pending_execute_calls": existing_exec,
        "review_statuses": review_statuses,
    }
    if events:
        update["plan_update_events"] = events
    if modified_update:
        update["pending_modified_feedback"] = modified_update
    return update


def route_after_execute_delete(state: InternState) -> str:
    """delete 리뷰 결정 후 다음 동작으로 이동한다."""
    action = state.get("intern_action")
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
        # 래퍼: 실행할 항목이 없으면 리뷰 큐 기준으로 다음 액션 결정.
        return {"intern_action": _next_action_from_pending(state.get("pending_review_calls") or [])}

    messages = []
    events = []
    artifacts = []
    artifact_status_updates = {}
    modified_clear = {}

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
            if status in {"created", "deleted"}:
                modified_clear[key] = ""

    pending = state.get("pending_review_calls") or []
    # 래퍼: 실행 후에는 리뷰 큐 우선 정책으로 다음 액션을 계산한다.
    next_action = _next_action_from_pending(pending)
    if not pending and events:
        next_action = "update_plan"

    if next_action == "execute_delete" and pending:
        messages.append(AIMessage(content=_delete_review_prompt(pending[0])))

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
    pending = state.get("pending_review_calls") or []
    pending_exec = state.get("pending_execute_calls") or []
    if pending:
        # 래퍼: 리뷰 큐가 남아 있으면 큐 첫 항목 기준으로 다음 액션을 정한다.
        default_action = _next_action_from_pending(pending)
    elif pending_exec:
        default_action = "execute"
    else:
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

    req = state.get("intern_request")
    instruction = req.strip() if isinstance(req, str) else ""
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

    req = state.get("intern_request")
    instruction = req.strip() if isinstance(req, str) else ""

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
        "intern_result": intern_result,
        "messages": [AIMessage(content=f"Intern 보고 완료\n{intern_result}")],
    }


def build_intern_subgraph():
    """Intern 서브그래프를 구성하고 interrupt 정책을 적용한다."""
    builder = StateGraph(InternState)
    builder.add_node("plan", intern_plan_node)
    builder.add_node("think", intern_think_node)
    builder.add_node("review_create", intern_review_create_node)
    builder.add_node("create_review_decision", intern_create_review_decision_node)
    builder.add_node("execute", intern_execute_node)
    builder.add_node("execute_delete", intern_execute_delete_node)
    builder.add_node("update_plan", intern_update_plan_node)
    builder.add_node("finish", intern_finish_node)

    builder.add_edge(START, "plan")
    builder.add_conditional_edges("plan", route_after_plan, {"think": "think", "end": END})
    builder.add_conditional_edges("think", route_think)
    builder.add_conditional_edges("review_create", route_after_review_create)
    builder.add_conditional_edges("create_review_decision", route_after_create_review_decision)
    builder.add_conditional_edges("execute", route_after_execute)
    builder.add_conditional_edges("execute_delete", route_after_execute_delete)
    builder.add_conditional_edges("update_plan", route_after_update_plan)
    builder.add_edge("finish", END)

    return builder.compile(
        checkpointer=memory,
        interrupt_after=["review_create"],
        interrupt_before=["execute_delete"],
    )
