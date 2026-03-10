"""Researcher 서브그래프.

핵심 흐름:
- `think`: 최신 researcher instruction을 읽고 도구 호출 계획을 생성
- `tools`: ToolNode가 tool_calls를 실행
- `evaluate`: scene/web 결과를 누적하고 `research_sufficient`를 판정

핸드오프:
- 부족한 경우 `request_new_tool` 또는 정체(think 반복)로 `intern_request` 생성
- 충분한 경우 `research_sufficient=True`로 종료
"""

import json

from langgraph.graph import START, END, StateGraph
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool

from state.main import ResearcherState
from prompts.researcher import (
    RESEARCHER_THINK_PROMPT,
    RESULT_EVALUATION_PROMPT,
    WEB_RESULTS_SUMMARY_PROMPT,
    RESEARCH_STALL_SUMMARY_PROMPT,
)
from tools import load_tools

memory = MemorySaver()
llm_researcher = ChatOpenAI(model="gpt-4o")
llm_web_summary = ChatOpenAI(model="gpt-4o-mini")

MAX_THINK_VISITS = 5


def _build_intern_request(
    goal: str,
    reason: str,
    tool_hint: str,
    rpc_hint: str,
    done_criteria: str,
) -> str:
    """intern이 바로 실행할 수 있는 요청 포맷을 만든다."""
    return "\n".join(
        [
            f"1) 목표: {goal}",
            f"2) 현재 부족한 데이터/이유: {reason}",
            "3) 생성할 항목:",
            f"   - tool: {tool_hint}",
            f"   - rpc: {rpc_hint}",
            f"4) 완료 기준: {done_criteria}",
        ]
    )


def _summarize_web_results(instruction: str, web_queries: list[str], web_results: list[dict]) -> str:
    """웹검색 결과를 요청/쿼리 기준으로 간결 요약한다."""
    if not web_results:
        return ""
    prompt = WEB_RESULTS_SUMMARY_PROMPT.format(
        instruction=instruction,
        web_queries=web_queries,
        web_results=json.dumps(web_results, ensure_ascii=False)[:5000],
    )
    content = llm_web_summary.invoke(prompt).content
    return str(content or "").strip()


def _summarize_stall(
    instruction: str,
    think_count: int,
    previous_scene_queries: list[str],
    previous_web_queries: list[str],
    research_summary: str,
    missing_slots: list[str],
) -> str:
    """반복 정체 상태를 supervisor 전달용으로 요약한다."""
    prompt = RESEARCH_STALL_SUMMARY_PROMPT.format(
        instruction=instruction,
        think_count=think_count,
        scene_queries=previous_scene_queries,
        web_queries=previous_web_queries,
        research_summary=research_summary,
        missing_slots=missing_slots,
    )
    content = llm_web_summary.invoke(prompt).content
    return str(content or "").strip()


# ---------------------------------------------------------------------------
# request_new_tool — Intern에게 도구 생성 요청용 시그널 도구
# ---------------------------------------------------------------------------
@tool
def request_new_tool(
    description: str,
    required_input: str,
    expected_output: str,
) -> str:
    """기존 도구로 필요한 데이터를 가져올 수 없을 때 새 도구/RPC 생성을 요청합니다.

    Args:
        description: 필요한 도구의 기능 설명
        required_input: 입력 파라미터 설명
        expected_output: 기대하는 출력 형태
    """
    return f"도구 생성 요청 등록: {description}"


# ---------------------------------------------------------------------------
# researcher_think_node — 도구 선택 및 호출 결정
# ---------------------------------------------------------------------------
def researcher_think_node(state: ResearcherState) -> dict:
    """LLM이 도구를 선택하고 호출. intern_request 감지는 evaluate에서."""
    tools, _ = load_tools()
    all_tools = tools + [request_new_tool]

    prev = state.get("previous_queries", {})
    history = (state.get("agent_instructions") or {}).get("researcher") or []
    instruction = history[-1] if history else (state.get("research_instruction") or state["messages"][0].content)
    response = llm_researcher.bind_tools(all_tools).invoke(
        RESEARCHER_THINK_PROMPT.format(
            instruction=instruction,
            previous_scene_queries=prev.get("scene", []),
            previous_web_queries=prev.get("web", []),
            messages=state["messages"],
        )
    )
    result = {
        "messages": [response],
        "researcher_think_count": state.get("researcher_think_count", 0) + 1,
        "researcher_stall_summary": None,
        # 이전 턴의 intern 요청이 남아 다시 intern으로 분기되는 것을 방지한다.
        "intern_request": None,
    }

    # 쿼리 추출 → previous_queries 업데이트 (도구별 분리)
    if response.tool_calls:
        scene_queries = []
        web_queries = []
        for tc in response.tool_calls:
            q = tc["args"].get("query") or tc["args"].get("keyword")
            if not q or tc["name"] == "request_new_tool":
                continue
            if tc["name"] == "web_search":
                web_queries.append(q)
            else:
                scene_queries.append(q)

        pq = {}
        if scene_queries:
            pq["scene"] = scene_queries
        if web_queries:
            pq["web"] = web_queries
        if pq:
            result["previous_queries"] = pq

    return result


# ---------------------------------------------------------------------------
# researcher_evaluate_node — 결과 누적 + 충분성 판단
# ---------------------------------------------------------------------------
def researcher_evaluate_node(state: ResearcherState) -> dict:
    """ToolMessage.name으로 결과 분류 + 충분성 판단.
    - 자막≥3 + 캡션≥1 → rule 충분
    - 부족 + web_search 결과 있음 → LLM 주관적 판단
    - 부족 + web_search 없음 → rule 부족
    필드 정리(rerank_score 등)는 Designer에서 처리.
    """
    result = {}

    # 1. request_new_tool 감지
    for msg in state["messages"]:
        if isinstance(msg, ToolMessage) and msg.name == "request_new_tool":
            reason = msg.content.replace("도구 생성 요청 등록: ", "").strip()
            intern_request = _build_intern_request(
                goal="researcher 검색에 필요한 누락 데이터를 확보할 도구/RPC 보강",
                reason=reason or "기존 도구만으로 데이터 확보 불가",
                tool_hint="SceneDataBooster | 목적: 장면/캡션 데이터 보강 | 입력: query/video_ids | 출력: transcripts[]",
                rpc_hint="SearchBackfillRpc | 목적: 누락 레코드 조회 | 입력: query/filter | 출력: rows[]",
                done_criteria="동일 요청 재실행 시 scene_data/caption 근거가 반환되고 research_sufficient 판단이 가능할 것",
            )
            result["intern_request"] = intern_request
            result["agent_instructions"] = {"intern": [intern_request]}
            result["researcher_context"] = state["messages"]
            result["research_sufficient"] = False
            result["research_summary"] = "기존 도구로 부족하여 Intern 요청"
            result["researcher_stall_summary"] = None
            return result

    # 2. ToolMessage.name으로 결과 분류
    transcripts = []
    seen = set()
    web_results = []

    for msg in state["messages"]:
        if not isinstance(msg, ToolMessage):
            continue

        if msg.name == "search_scene_data":
            try:
                data = json.loads(msg.content)
                for doc in data.get("transcripts", []):
                    key = (
                        doc.get("video_id"),
                        doc.get("metadata", {}).get("start_time"),
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    transcripts.append(doc)
            except (json.JSONDecodeError, TypeError):
                pass

        elif msg.name == "web_search":
            try:
                web_results.append(json.loads(msg.content))
            except (json.JSONDecodeError, TypeError):
                web_results.append({"raw": msg.content})

    # 이미 상태에 누적된 transcript는 제외하고 신규분만 append되게 만든다.
    existing = (state.get("research_results") or {}).get("scene_data") or (state.get("research_results") or {}).get("transcripts", [])
    existing_keys = {
        (
            doc.get("video_id"),
            doc.get("metadata", {}).get("start_time"),
        )
        for doc in existing
    }
    new_transcripts = [
        doc
        for doc in transcripts
        if (
            doc.get("video_id"),
            doc.get("metadata", {}).get("start_time"),
        )
        not in existing_keys
    ]

    # web_search 결과도 연구 결과 상태에 누적한다(중복 제외).
    existing_web = (state.get("research_results") or {}).get("web_results", [])
    existing_web_sigs = set()
    for item in existing_web:
        try:
            existing_web_sigs.add(json.dumps(item, ensure_ascii=False, sort_keys=True))
        except (TypeError, ValueError):
            existing_web_sigs.add(str(item))

    new_web_results = []
    for item in web_results:
        try:
            sig = json.dumps(item, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError):
            sig = str(item)
        if sig in existing_web_sigs:
            continue
        existing_web_sigs.add(sig)
        new_web_results.append(item)

    web_queries = (state.get("previous_queries") or {}).get("web", [])
    combined_web_results = existing_web + new_web_results
    web_summary = _summarize_web_results(
        instruction=str(state["messages"][0].content),
        web_queries=web_queries,
        web_results=combined_web_results,
    )

    result["research_results"] = {
        "scene_data": new_transcripts,
        "transcripts": new_transcripts,  # 하위 호환
        "web_results": new_web_results,
        "web_summary": web_summary,
    }

    # 3. loop_count 증가
    result["loop_count"] = state.get("loop_count", 0) + 1

    # 4. 충분성 판단
    has_enough_transcripts = len(transcripts) >= 3
    has_caption = any(doc.get("metadata", {}).get("caption") for doc in transcripts)

    if has_enough_transcripts and has_caption:
        # Rule: 충분
        summary = f"충분: 자막 {len(transcripts)}건, 캡션 확보"
        result["research_sufficient"] = True
        result["intern_request"] = None
        result["research_summary"] = summary
        result["researcher_stall_summary"] = None
        result["messages"] = [AIMessage(content=summary)]
    elif web_results:
        # LLM: 자막/캡션 부족하지만 웹검색 결과 있으므로 주관적 판단
        response = llm_researcher.invoke(
            RESULT_EVALUATION_PROMPT.format(
                instruction=state["messages"][0].content,
                transcript_count=len(transcripts),
                has_caption=has_caption,
                web_results=json.dumps(web_results, ensure_ascii=False)[:2000],
            )
        )
        content = str(response.content or "").strip()
        result["research_sufficient"] = content.startswith("충분")
        if result["research_sufficient"]:
            result["intern_request"] = None
        result["research_summary"] = content
        result["researcher_stall_summary"] = None if result["research_sufficient"] else state.get("researcher_stall_summary")
        result["messages"] = [response]
    else:
        # Rule: 부족
        missing = []
        if not has_enough_transcripts:
            missing.append(f"자막 {len(transcripts)}건 (최소 3건 필요)")
        if not has_caption:
            missing.append("is_peak 캡션 0건")
        summary = f"부족: {', '.join(missing)}"
        result["research_sufficient"] = False
        result["research_summary"] = summary
        result["messages"] = [AIMessage(content=summary)]

    # 5) think 노드가 5회 이상 반복되면 카운트를 리셋하고 정체 요약을 supervisor로 전달
    think_count = state.get("researcher_think_count", 0)
    if not result.get("research_sufficient") and think_count >= MAX_THINK_VISITS:
        missing_slots = []
        if not has_enough_transcripts:
            missing_slots.append("scene_data")
        if (state.get("previous_queries") or {}).get("web") and not web_summary:
            missing_slots.append("web_summary")

        prev = state.get("previous_queries") or {}
        stall_summary = _summarize_stall(
            instruction=str(
                ((state.get("agent_instructions") or {}).get("researcher") or [state.get("research_instruction") or state["messages"][0].content])[-1]
            ),
            think_count=think_count,
            previous_scene_queries=prev.get("scene", []),
            previous_web_queries=prev.get("web", []),
            research_summary=str(result.get("research_summary") or ""),
            missing_slots=missing_slots,
        )
        result["researcher_think_count"] = 0
        result["researcher_stall_summary"] = stall_summary
        result["research_summary"] = f"[정체] {stall_summary}"
        result["researcher_context"] = state["messages"]
        result["messages"] = [AIMessage(content=result["research_summary"])]
        intern_request = _build_intern_request(
            goal="반복 정체를 해결하기 위한 researcher 전용 보강 도구/RPC 추가",
            reason=stall_summary,
            tool_hint="SceneDataFallbackTool | 목적: 검색 실패 쿼리 보완 | 입력: query, previous_queries | 출력: transcripts[]",
            rpc_hint="CaptionCoverageRpc | 목적: 캡션 누락 구간 조회 | 입력: video_ids/query | 출력: caption_rows[]",
            done_criteria="재시도 시 누락된 scene_data/caption이 채워져 research_sufficient=True 또는 명확한 부족 근거를 반환할 것",
        )
        result["intern_request"] = intern_request
        result["agent_instructions"] = {"intern": [intern_request]}

    return result


# ---------------------------------------------------------------------------
# route_researcher — think 후 라우팅
# ---------------------------------------------------------------------------
def route_researcher(state: ResearcherState) -> str:
    """tool_calls 유무로 tools/END 분기."""
    last_msg = state["messages"][-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return END


# ---------------------------------------------------------------------------
# route_eval — evaluate 후 라우팅
# ---------------------------------------------------------------------------
def route_eval(state: ResearcherState) -> str:
    """충분성 + loop_count로 think/END 분기."""
    if state.get("intern_request"):
        return END

    if state.get("research_sufficient") is True:
        return END

    if state.get("researcher_stall_summary"):
        return END

    return "think"


# ---------------------------------------------------------------------------
# build_researcher_subgraph — 서브그래프 빌드
# ---------------------------------------------------------------------------
def build_researcher_subgraph():
    """Researcher 서브그래프 생성. 도구는 think 내부에서 동적 로딩."""
    tools, _ = load_tools()
    all_tools = tools + [request_new_tool]

    builder = StateGraph(ResearcherState)
    builder.add_node("think", researcher_think_node)
    builder.add_node("tools", ToolNode(all_tools))
    builder.add_node("evaluate", researcher_evaluate_node)

    builder.add_edge(START, "think")
    builder.add_conditional_edges("think", route_researcher)
    builder.add_edge("tools", "evaluate")
    builder.add_conditional_edges("evaluate", route_eval)

    return builder.compile(checkpointer=memory)
