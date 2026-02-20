"""Researcher 에이전트 — 자료조사 (ReAct + Self-RAG 서브그래프)

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §3.2, §6
구현 파일: agents/researcher.py + prompts/researcher.py

흐름: think → tools(ToolNode, 병렬) → evaluate → think (최대 3턴)
- think: LLM이 도구 선택, tool_calls 반환
- tools: ToolNode가 병렬 실행
- evaluate: ToolMessage.name으로 결과 분류 + 충분성 판단 + request_new_tool 감지
- route_researcher: tool_calls 유무로 tools/END 분기
- route_eval: 충분성 + loop_count로 think/END 분기
"""

import json

from langgraph.graph import START, END, StateGraph
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool

from state.main import ResearcherState
from prompts.researcher import RESEARCHER_THINK_PROMPT, RESULT_EVALUATION_PROMPT
from tools import load_tools

memory = MemorySaver()
llm_researcher = ChatOpenAI(model="gpt-4o-mini")

MAX_LOOP = 3


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
    response = llm_researcher.bind_tools(all_tools).invoke(
        RESEARCHER_THINK_PROMPT.format(
            instruction=state["messages"][0].content,
            previous_scene_queries=prev.get("scene", []),
            previous_web_queries=prev.get("web", []),
            messages=state["messages"],
        )
    )
    result = {"messages": [response]}

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
            result["intern_request"] = msg.content.replace("도구 생성 요청 등록: ", "")
            result["researcher_context"] = state["messages"]
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

    result["research_results"] = {"transcripts": transcripts}

    # 3. loop_count 증가
    result["loop_count"] = state.get("loop_count", 0) + 1

    # 4. 충분성 판단
    has_enough_transcripts = len(transcripts) >= 3
    has_caption = any(doc.get("metadata", {}).get("caption") for doc in transcripts)

    if has_enough_transcripts and has_caption:
        # Rule: 충분
        result["messages"] = [
            AIMessage(content=f"충분: 자막 {len(transcripts)}건, 캡션 확보")
        ]
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
        result["messages"] = [response]
    else:
        # Rule: 부족
        missing = []
        if not has_enough_transcripts:
            missing.append(f"자막 {len(transcripts)}건 (최소 3건 필요)")
        if not has_caption:
            missing.append("is_peak 캡션 0건")
        result["messages"] = [AIMessage(content=f"부족: {', '.join(missing)}")]

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

    if state.get("loop_count", 0) >= MAX_LOOP:
        return END

    last_msg = state["messages"][-1]
    content = last_msg.content if hasattr(last_msg, "content") else ""
    if "충분" in content:
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
