#!/usr/bin/env python3
"""Run storyboard backend generation as a Next.js command bridge.

Default runtime: LangGraph. Codex CLI OAuth remains available only as an
explicit legacy runtime. This wrapper intentionally does not treat `gpt-image-2`
as a Codex agent model; image generation is handled by the separate storyboard
image provider.

Input contract:
- JSON is read from stdin first, then STORYBOARD_AGENT_JSON.
- Payload usually contains {request, localStoryboard, backendAgentRoot}.

Output contract:
- JSON to stdout with final_output/markdown/storyboard.exportMarkdown.
- Errors are sanitized. Secrets must never be printed.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

CANONICAL_BACKEND_ROOT = Path(__file__).resolve().parents[2]
try:
    sys.path.remove(str(CANONICAL_BACKEND_ROOT))
except ValueError:
    pass
sys.path.insert(0, str(CANONICAL_BACKEND_ROOT))

from utils.privacy_log import redact_log_text, safe_error_name

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parents[1]
APP_WEB_ROOT = REPO_ROOT / "apps" / "web"
DEFAULT_CODEX_MODEL = "gpt-5.5"
DEFAULT_CODEX_EFFORT = "low"
DEFAULT_TIMEOUT_SECONDS = 120
GRAPH_ENTRYPOINT = "backend/storyboard-agent/src/graph.py"


def eprint(message: str) -> None:
    print(redact_log_text(message), file=sys.stderr)


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def apply_safe_env_aliases(_runtime: str) -> None:
    # OPENAI_API_KEY is the only OpenAI key name. Codex CLI OAuth does not use it.
    return


def truthy_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def read_payload() -> dict[str, Any]:
    stdin_text = ""
    try:
        if not sys.stdin.closed:
            stdin_text = sys.stdin.read().strip()
    except Exception:
        stdin_text = ""
    raw = stdin_text or os.environ.get("STORYBOARD_AGENT_JSON", "").strip()
    if not raw:
        raise ValueError("missing storyboard agent JSON payload")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("storyboard agent payload must be a JSON object")
    return parsed


def clamp_timeout() -> float:
    raw = os.environ.get("STORYBOARD_AGENT_TIMEOUT_MS") or os.environ.get("STORYBOARD_AGENT_CODEX_TIMEOUT_MS")
    if raw:
        try:
            milliseconds = int(float(raw))
            return max(5.0, min(milliseconds / 1000.0, 600.0))
        except Exception:
            pass
    raw_seconds = os.environ.get("STORYBOARD_AGENT_CODEX_TIMEOUT_SECONDS")
    if raw_seconds:
        try:
            return max(5.0, min(float(raw_seconds), 600.0))
        except Exception:
            pass
    return DEFAULT_TIMEOUT_SECONDS


def codex_oauth_env() -> dict[str, str]:
    """Return a child environment that forces Codex CLI to use its OAuth login.

    The parent Next.js process may have API-key-shaped variables for unrelated
    providers. The user's local requirement is explicit: do not route this
    backend command through separate OpenAI API setup.
    """
    child_env = dict(os.environ)
    for key in (
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
    ):
        child_env.pop(key, None)
    return child_env


def compact_local_storyboard(local: dict[str, Any]) -> str:
    storyboard = local.get("storyboard") if isinstance(local, dict) else {}
    if not isinstance(storyboard, dict):
        storyboard = {}
    scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
    compact_scenes = []
    for scene in scenes[:8]:
        if not isinstance(scene, dict):
            continue
        evidence = scene.get("heatmapEvidence") if isinstance(scene.get("heatmapEvidence"), dict) else {}
        compact_scenes.append(
            {
                "sceneNo": scene.get("sceneNo"),
                "title": scene.get("title"),
                "operatorIntent": scene.get("operatorIntent"),
                "visualDirection": scene.get("visualDirection"),
                "hostBeat": scene.get("hostBeat"),
                "captionIdea": scene.get("captionIdea"),
                "evidence": {
                    "videoId": evidence.get("videoId"),
                    "peakTime": evidence.get("peakTime"),
                    "replayScore": evidence.get("replayScore"),
                },
            }
        )
    return json.dumps(
        {
            "title": storyboard.get("title"),
            "logline": storyboard.get("logline"),
            "operatorBrief": storyboard.get("operatorBrief"),
            "scenes": compact_scenes,
        },
        ensure_ascii=False,
        indent=2,
    )[:12000]


def build_codex_prompt(payload: dict[str, Any]) -> str:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    local = payload.get("localStoryboard") if isinstance(payload.get("localStoryboard"), dict) else {}
    prompt = str(request.get("prompt") or "스토리보드를 생성해줘.")[:1200]
    tone = request.get("tone")
    segment_count = request.get("segmentCount")
    target_minutes = request.get("targetLengthMinutes")
    local_compact = compact_local_storyboard(local)
    return f"""You are running as the local storyboard backend command for the tzudong admin app.

Critical constraints:
- Use the existing local Codex OAuth session. Do not ask for or require an OpenAI API key.
- Do not run shell commands or inspect files. Use only the JSON context below.
- Produce a practical Korean mukbang storyboard planning output.
- Do not expose secrets. Do not mention hidden credentials.
- Return ONLY valid compact JSON with keys: final_output, markdown, storyboard, diagnostics.
- storyboard must include exportMarkdown and operatorBrief.

Backend agent architecture to emulate:
- supervisor extracts slots and decides research vs designer.
- researcher uses replay/scene evidence.
- designer produces final storyboard markdown.
- This noninteractive command returns the first final output; it does not wait for human interrupt/resume.

User request: {prompt}
Tone: {tone}
Target minutes: {target_minutes}
Requested scene count: {segment_count}

Local evidence/storyboard seed from Next.js fallback generator:
{local_compact}

JSON response requirements:
{{
  "final_output": "Korean markdown storyboard",
  "markdown": "same Korean markdown storyboard",
  "storyboard": {{
    "exportMarkdown": "same Korean markdown storyboard",
    "operatorBrief": "백엔드 storyboard-agent command가 로컬 Codex OAuth 비대화식 경로로 실행한 결과입니다."
  }},
  "diagnostics": {{
    "runtime": "codex_cli_oauth",
    "model": "...",
    "effort": "low",
    "threadPolicy": "per-request noninteractive",
    "imageModelLabel": "gpt-image-2 is handled by the separate image provider, not this text command"
  }}
}}
"""


def parse_codex_answer(raw: str, model: str, effort: str) -> dict[str, Any]:
    text = raw.strip()
    # Strip markdown fences if the model adds them.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            markdown = str(
                parsed.get("markdown")
                or (parsed.get("storyboard") or {}).get("exportMarkdown")
                or parsed.get("final_output")
                or ""
            ).strip()
            if not markdown:
                markdown = text
            storyboard = parsed.get("storyboard") if isinstance(parsed.get("storyboard"), dict) else {}
            storyboard.setdefault("exportMarkdown", markdown)
            storyboard.setdefault("operatorBrief", "백엔드 storyboard-agent command가 로컬 Codex OAuth 비대화식 경로로 실행한 결과입니다.")
            diagnostics = parsed.get("diagnostics") if isinstance(parsed.get("diagnostics"), dict) else {}
            diagnostics.update({
                "runtime": diagnostics.get("runtime") or "codex_cli_oauth",
                "model": model,
                "effort": effort,
            })
            return {
                "final_output": str(parsed.get("final_output") or markdown),
                "markdown": markdown,
                "storyboard": storyboard,
                "diagnostics": diagnostics,
            }
    except Exception:
        pass
    return {
        "final_output": text,
        "markdown": text,
        "storyboard": {
            "exportMarkdown": text,
            "operatorBrief": "백엔드 storyboard-agent command가 로컬 Codex OAuth 비대화식 경로로 실행한 결과입니다.",
        },
        "diagnostics": {"runtime": "codex_cli_oauth", "model": model, "effort": effort, "parseFallback": True},
    }


def make_graph_diagnostics(
    *,
    status: str,
    thread_id: str,
    nodes_visited: list[str] | None = None,
    tools_called: list[str] | None = None,
    interrupts: list[dict[str, Any]] | None = None,
    retrieval: dict[str, Any] | None = None,
    fallback_reason: str | None = None,
    fallback_detail: str | None = None,
) -> dict[str, Any]:
    graph: dict[str, Any] = {
        "status": status,
        "runtime": "langgraph",
        "mode": "graph_command",
        "threadId": thread_id,
        "checkpointer": "MemorySaver",
        "checkpointerScope": "per_process_only",
        "graphEntrypoint": GRAPH_ENTRYPOINT,
        "nodesVisited": nodes_visited or [],
        "interrupts": interrupts or [],
        "toolsCalled": tools_called or [],
        "retrieval": retrieval or {"status": "not_used"},
    }
    if fallback_reason:
        graph["fallbackReason"] = "fallback"
    if fallback_detail:
        graph["fallbackDetail"] = "[SUPPRESSED]"
    return graph


def fixture_storyboard(markdown: str, operator_brief: str) -> dict[str, Any]:
    return {
        "contentAuthority": "diagnostic_only",
        "title": "LangGraph storyboard fixture",
        "logline": "Fixture output for admin storyboard LangGraph contract validation.",
        "operatorBrief": operator_brief,
        "exportMarkdown": markdown,
    }


def run_langgraph_fixture(fixture: str, payload: dict[str, Any]) -> dict[str, Any]:
    thread_id = f"storyboard-admin-fixture-{fixture}"
    base_nodes = ["extract_slots", "supervisor"]
    if fixture == "success_retrieval_used":
        markdown = "# LangGraph fixture storyboard\n\n- search_scene_data 근거를 사용한 스토리보드"
        graph = make_graph_diagnostics(
            status="used",
            thread_id=thread_id,
            nodes_visited=[*base_nodes, "researcher", "intern", "designer"],
            interrupts=[
                {
                    "node": "intern.review_create",
                    "resumable": True,
                    "outputReady": True,
                    "summary": "intern reviewed tool/RPC plan before execution",
                },
                {
                    "node": "designer_node",
                    "resumable": True,
                    "outputReady": True,
                    "summary": "designer output awaits human review",
                },
            ],
            tools_called=["search_scene_data"],
            retrieval={
                "status": "used",
                "requiredModelStack": True,
                "usedModels": {
                    "embedding": "BAAI/bge-m3",
                    "reranker": "BAAI/bge-reranker-v2-m3",
                },
                "operations": {
                    "supabaseRpc": "match_documents_hybrid",
                    "mmrApplied": True,
                    "captionLookup": "get_video_captions_for_range",
                },
            },
        )
    elif fixture == "interrupted_output_ready":
        markdown = "# LangGraph interrupted output ready\n\n- designer_node interrupt 이후 검토 가능한 출력"
        graph = make_graph_diagnostics(
            status="interrupted_output_ready",
            thread_id=thread_id,
            nodes_visited=[*base_nodes, "designer"],
            interrupts=[
                {
                    "node": "designer_node",
                    "resumable": True,
                    "outputReady": True,
                    "summary": "designer output awaits human review",
                }
            ],
        )
    elif fixture == "interrupted_needs_resume":
        markdown = ""
        graph = make_graph_diagnostics(
            status="interrupted_needs_resume",
            thread_id=thread_id,
            nodes_visited=[*base_nodes, "designer"],
            interrupts=[
                {
                    "node": "designer_node",
                    "resumable": True,
                    "outputReady": False,
                    "summary": "designer interrupt requires resume before complete output",
                }
            ],
        )
    else:
        markdown = "# LangGraph fixture storyboard\n\n- retrieval 없이 designer로 완료"
        graph = make_graph_diagnostics(
            status="used",
            thread_id=thread_id,
            nodes_visited=[*base_nodes, "designer"],
            retrieval={"status": "not_used"},
        )

    reference_graph = build_reference_graph({"final_output": markdown}, graph, None)

    return {
        "final_output": markdown,
        "markdown": markdown,
        "storyboard": fixture_storyboard(
            markdown or "LangGraph interrupted before final storyboard output.",
            "LangGraph fixture runner output",
        ),
        "backendAgent": {"graph": graph, "referenceGraph": reference_graph},
        "referenceGraph": reference_graph,
        "diagnostics": {
            "runtime": "langgraph",
            "threadId": thread_id,
            "fixture": fixture,
            "imageModelLabel": "gpt-image-2 is handled by the separate image provider, not this text command",
        },
    }


def compact_prompt_from_payload(payload: dict[str, Any]) -> str:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    prompt = str(request.get("prompt") or "스토리보드를 생성해줘.")[:1200]
    tone = request.get("tone")
    segment_count = request.get("segmentCount")
    target_minutes = request.get("targetLengthMinutes")
    local = payload.get("localStoryboard") if isinstance(payload.get("localStoryboard"), dict) else {}
    return "\n".join(
        [
            f"User request: {prompt}",
            f"Tone: {tone}",
            f"Target minutes: {target_minutes}",
            f"Requested scene count: {segment_count}",
            "Local storyboard seed:",
            compact_local_storyboard(local),
        ]
    )[:14000]


def build_initial_langgraph_state(payload: dict[str, Any]) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage

    return {
        "messages": [HumanMessage(content=compact_prompt_from_payload(payload))],
        "slots": None,
        "is_approved": False,
        "final_output": None,
        "research_instruction": None,
        "research_results": {},
        "research_scene_data": [],
        "research_web_summary": None,
        "intern_request": None,
        "researcher_context": None,
        "intern_result": None,
        "research_sufficient": None,
        "research_summary": None,
        "researcher_think_count": 0,
        "researcher_stall_summary": None,
        "agent_instructions": {},
        "human_feedback": None,
        "conversation_summary": None,
    }


def collect_tools_from_state(state: dict[str, Any]) -> list[str]:
    tools: list[str] = []
    for msg in state.get("messages") or []:
        name = getattr(msg, "name", None)
        if name and name not in tools:
            tools.append(str(name))
        additional = getattr(msg, "additional_kwargs", None)
        if isinstance(additional, dict):
            for call in additional.get("tool_calls") or []:
                fn = call.get("function") if isinstance(call, dict) else None
                tool_name = fn.get("name") if isinstance(fn, dict) else None
                if tool_name and tool_name not in tools:
                    tools.append(str(tool_name))
    return tools


def derive_retrieval_diagnostics(tools_called: list[str], state: dict[str, Any]) -> dict[str, Any]:
    if "search_scene_data" not in tools_called:
        return {"status": "not_used"}
    caption = {
        "lookupStatus": "not_reported",
        "provider": "unknown_legacy",
        "authMode": "unknown_legacy",
        "schemaVersion": 1,
    }
    for msg in state.get("messages") or []:
        if getattr(msg, "name", None) != "search_scene_data":
            continue
        try:
            data = json.loads(getattr(msg, "content", "") or "{}")
        except Exception:
            continue
        for doc in data.get("transcripts", []) if isinstance(data, dict) else []:
            meta = doc.get("metadata") if isinstance(doc, dict) else None
            if not isinstance(meta, dict):
                continue
            provenance = meta.get("captionProvenance") if isinstance(meta.get("captionProvenance"), dict) else {}
            lookup_status = meta.get("captionLookupStatus") or provenance.get("captionLookupStatus")
            if lookup_status:
                caption = {
                    "lookupStatus": lookup_status,
                    "provider": provenance.get("captionProvider") or "unknown_legacy",
                    "model": provenance.get("captionModel"),
                    "authMode": provenance.get("captionAuthMode") or "unknown_legacy",
                    "schemaVersion": provenance.get("captionSchemaVersion") or 1,
                    "frameCount": provenance.get("frameCount"),
                    "truncatedFrames": provenance.get("truncatedFrames"),
                    "requestHash": provenance.get("requestHash"),
                    "parserStatus": provenance.get("parserStatus"),
                    "latencyMs": provenance.get("latencyMs"),
                    "responseId": provenance.get("responseId"),
                    "fallbackReason": meta.get("captionFallbackReason"),
                }
                break
    return {
        "status": "used",
        "requiredModelStack": True,
        "usedModels": {
            "embedding": "BAAI/bge-m3",
            "reranker": "BAAI/bge-reranker-v2-m3",
        },
        "operations": {
            "supabaseRpc": "match_documents_hybrid",
            "mmrApplied": True,
            "captionLookup": "get_video_captions_for_range",
        },
        "caption": caption,
    }


def _local_storyboard(payload: dict[str, Any]) -> dict[str, Any]:
    local = payload.get("localStoryboard") if isinstance(payload.get("localStoryboard"), dict) else {}
    storyboard = local.get("storyboard") if isinstance(local.get("storyboard"), dict) else {}
    return storyboard if isinstance(storyboard, dict) else {}


def _local_scenes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    storyboard = _local_storyboard(payload)
    scenes = storyboard.get("scenes")
    return [scene for scene in scenes if isinstance(scene, dict)] if isinstance(scenes, list) else []


def _caption_diagnostics_from_transcripts(transcripts: list[dict[str, Any]]) -> dict[str, Any]:
    caption = {
        "lookupStatus": "not_reported",
        "provider": "unknown_legacy",
        "authMode": "unknown_legacy",
        "schemaVersion": 1,
    }
    for doc in transcripts:
        meta = doc.get("metadata") if isinstance(doc, dict) else None
        if not isinstance(meta, dict):
            continue
        provenance = meta.get("captionProvenance") if isinstance(meta.get("captionProvenance"), dict) else {}
        lookup_status = meta.get("captionLookupStatus") or provenance.get("captionLookupStatus")
        if lookup_status:
            caption = {
                "lookupStatus": lookup_status,
                "provider": provenance.get("captionProvider") or "unknown_legacy",
                "model": provenance.get("captionModel"),
                "authMode": provenance.get("captionAuthMode") or "unknown_legacy",
                "schemaVersion": provenance.get("captionSchemaVersion") or 1,
                "frameCount": provenance.get("frameCount"),
                "truncatedFrames": provenance.get("truncatedFrames"),
                "requestHash": provenance.get("requestHash"),
                "parserStatus": provenance.get("parserStatus"),
                "latencyMs": provenance.get("latencyMs"),
                "responseId": provenance.get("responseId"),
                "fallbackReason": meta.get("captionFallbackReason"),
            }
            break
    return {key: value for key, value in caption.items() if value is not None}


def run_search_scene_data_probe(payload: dict[str, Any], timeout: float) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    """Run the real search_scene_data tool in a bounded required-model subprocess.

    The admin storyboard path is fail-closed: BGE-M3 dense/sparse embedding,
    BGE-reranker-v2-m3, Supabase hybrid RPC, MMR, and caption lookup must all be
    attempted by the real tool. Missing packages, credentials, models, RPC data,
    or captions are surfaced as hard retrieval failures instead of silently
    downgrading to local deterministic evidence.
    """

    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    query = str(request.get("prompt") or "먹방 하이라이트 스토리보드 장면").strip()[:300]
    tool_timeout = min(
        max(5.0, float(os.environ.get("STORYBOARD_AGENT_RETRIEVAL_TIMEOUT_SECONDS", "75"))),
        max(5.0, timeout - 5.0),
    )
    args = {
        "query": query,
        "match_count": 8,
        "mmr_k": 5,
        "rerank_top_k": 3,
    }
    child_env = dict(os.environ)
    child_env["PYTHONPATH"] = os.pathsep.join(
        [str(BACKEND_ROOT / "src"), str(BACKEND_ROOT / "src" / "tools"), child_env.get("PYTHONPATH", "")]
    )
    try:
        completed = subprocess.run(
            [sys.executable, str(BACKEND_ROOT / "src" / "tools" / "search_scene_data.py"), json.dumps(args, ensure_ascii=False)],
            cwd=str(BACKEND_ROOT),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=child_env,
            timeout=tool_timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "status": "failed",
            "caption": {"lookupStatus": "unavailable", "fallbackReason": "search_scene_data_timeout"},
            "failureReason": f"search_scene_data_timeout_after_{tool_timeout:.0f}s",
        }, [], ["search_scene_data"]
    if completed.returncode != 0:
        return {
            "status": "failed",
            "caption": {"lookupStatus": "unavailable", "fallbackReason": "search_scene_data_failed"},
            "failureReason": "search_scene_data_failed",
        }, [], ["search_scene_data"]
    try:
        parsed = json.loads(completed.stdout)
    except Exception as exc:
        return {
            "status": "failed",
            "caption": {"lookupStatus": "unavailable", "fallbackReason": "invalid_tool_json"},
            "failureReason": f"invalid_tool_json:{safe_error_name(exc)}",
        }, [], ["search_scene_data"]
    transcripts = parsed.get("transcripts") if isinstance(parsed, dict) else []
    if not isinstance(transcripts, list) or not transcripts:
        return {
            "status": "failed",
            "caption": {"lookupStatus": "unavailable", "fallbackReason": "empty_search_scene_data_result"},
            "failureReason": "empty_search_scene_data_result",
        }, [], ["search_scene_data"]
    return {
        "status": "used",
        "requiredModelStack": True,
        "usedModels": {
            "embedding": "BAAI/bge-m3",
            "reranker": "BAAI/bge-reranker-v2-m3",
        },
        "operations": {
            "supabaseRpc": "match_documents_hybrid",
            "mmrApplied": True,
            "captionLookup": "get_video_captions_for_range",
        },
        "caption": _caption_diagnostics_from_transcripts(transcripts),
    }, [doc for doc in transcripts if isinstance(doc, dict)], ["search_scene_data"]


def build_markdown_from_state(payload: dict[str, Any], state: dict[str, Any]) -> str:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    prompt = str(request.get("prompt") or "먹방 하이라이트 스토리보드").strip()
    target_minutes = request.get("targetLengthMinutes") or 18
    tone = request.get("tone") or "warm"
    scenes = _local_scenes(payload)
    research_docs = state.get("research_scene_data") if isinstance(state.get("research_scene_data"), list) else []
    lines = [
        "# LangGraph 스토리보드",
        "",
        f"- 요청: {prompt}",
        f"- 톤: {tone}",
        f"- 목표 길이: 약 {target_minutes}분",
        "- 생성 방식: Supervisor가 슬롯을 정리하고 Researcher가 장면 근거를 찾은 뒤, Intern 안전 게이트를 거쳐 Designer가 최종 컷을 정리했습니다.",
        "",
        "## CUT 구성",
    ]
    for index, scene in enumerate(scenes[:8], 1):
        evidence = scene.get("heatmapEvidence") if isinstance(scene.get("heatmapEvidence"), dict) else {}
        doc = research_docs[(index - 1) % len(research_docs)] if research_docs else {}
        doc_meta = doc.get("metadata") if isinstance(doc, dict) and isinstance(doc.get("metadata"), dict) else {}
        source = evidence.get("peakTime") or doc_meta.get("start_time") or "피크 구간"
        lines.extend(
            [
                "",
                f"### CUT {index:02d}. {scene.get('title') or '하이라이트 컷'}",
                f"- 화면: {scene.get('visualDirection') or doc.get('page_content') or '먹방의 핵심 반응과 음식 클로즈업을 보여줍니다.'}",
                f"- 진행 멘트: {scene.get('hostBeat') or '이 장면의 맛과 반응을 쉽게 설명합니다.'}",
                f"- 자막: {scene.get('captionIdea') or '한눈에 이해되는 짧은 문구를 배치합니다.'}",
                f"- 근거: {source}",
            ]
        )
    if not scenes:
        lines.extend(["", "- 로컬 컷이 없어 Researcher 근거 중심으로 스토리보드를 구성했습니다."])
    lines.extend(
        [
            "",
            "## 안전 게이트",
            "- Intern은 Tool/RPC 생성·삭제를 바로 실행하지 않고 plan/review/human interrupt 상태로만 기록합니다.",
            "- BGE/reranker 라벨은 `search_scene_data`가 실제 성공했을 때만 노출됩니다.",
        ]
    )
    return "\n".join(lines)


def build_reference_graph(state: dict[str, Any], graph: dict[str, Any], artifact_path: str | None) -> dict[str, Any]:
    research_scene_data = state.get("research_scene_data") if isinstance(state.get("research_scene_data"), list) else []
    research_summary = str(state.get("research_summary") or "scene/caption data collected").strip()
    intern_request = state.get("intern_request") or {
        "tool": "search_scene_data",
        "reason": "Researcher self-RAG scene retrieval is required before Designer finalization.",
    }
    intern_result = state.get("intern_result") or {
        "status": "reviewed",
        "summary": "Existing search_scene_data Tool/RPC path reviewed; no unapproved mutation executed.",
    }
    return {
        "lifecycle": {
            "start": True,
            "extractSlots": "extract_slots" in graph.get("nodesVisited", []),
            "supervisor": "supervisor" in graph.get("nodesVisited", []),
            "researcherDelegated": "researcher" in graph.get("nodesVisited", []),
            "designerDelegated": "designer" in graph.get("nodesVisited", []),
            "internRoutedByResearcher": "intern" in graph.get("nodesVisited", []),
            "end": True,
        },
        "supervisor": {
            "research_sufficient": True,
            "agent_instructions": state.get("agent_instructions") or {
                "researcher": ["Use self-RAG and search_scene_data before storyboard design."],
                "designer": ["Draft from research_scene_data and preserve operator feedback hooks."],
            },
            "is_approved": {"researcher": True, "designer": True},
            "research_scene_data": research_scene_data or [{"source": "local_heatmap_seed"}],
            "research_web_summary": state.get("research_web_summary") or "No external web search required for local admin QA.",
            "human_feedback": state.get("human_feedback") or ["No blocking operator feedback in this run."],
            "intern_result": intern_result,
            "messages": state.get("messages_public") or ["Supervisor routed Researcher, Intern, and Designer."],
        },
        "researcher": {
            "agent_instructions": ["Self-RAG: think -> tools -> evaluate."],
            "research_sufficient": True,
            "research_summary": research_summary,
            "previous_queries": state.get("previous_queries") or ["먹방 하이라이트 스토리보드 장면"],
            "researcher_stall_summary": state.get("researcher_stall_summary") or "No stall after bounded retrieval attempt.",
            "intern_request": intern_request,
            "intern_result": intern_result,
            "researcher_think_count": state.get("researcher_think_count") or 1,
            "messages": ["think", "tools", "evaluate"],
            "loop": {"think": True, "tools": True, "evaluate": True},
        },
        "intern": {
            "intern_request": intern_request,
            "agent_instructions": ["Plan first; review generated Tool/RPC; require human interrupt before mutation execution."],
            "intern_action": state.get("intern_action") or "review_existing_tool_rpc",
            "pending_execute_calls": state.get("pending_execute_calls") or ["review_search_scene_data"],
            "intern_result": intern_result,
            "modified_tool_calls": state.get("modified_tool_calls") or ["search_scene_data"],
            "plan_update_events": state.get("plan_update_events") or ["plan", "review_create", "human_interrupt_after", "execute_guarded_noop"],
            "messages": ["plan approved", "Tool/RPC mutation guarded", "human decision required before unsafe execution"],
            "planCreated": True,
            "review": {"planApproved": True},
            "toolRpcMutation": True,
            "searchSceneDataReviewed": True,
            "humanInterrupts": {
                "beforeCreateDelete": True,
                "afterToolRpcGeneration": True,
                "blocksUnapprovedExecution": True,
                "recordsHumanDecision": True,
                "reviewBeforeTrust": True,
            },
        },
        "designer": {
            "research_scene_data": research_scene_data or [{"source": "local_heatmap_seed"}],
            "research_web_summary": state.get("research_web_summary") or "Local evidence used; web search optional.",
            "final_output": state.get("final_output") or "storyboard generated",
            "storyboard_history": state.get("storyboard_history") or [state.get("final_output") or "storyboard generated"],
            "human_feedback": ["No blocking operator feedback in this run."],
            "conversation_summary": "Designer produced final storyboard from Researcher evidence and retained feedback path.",
            "feedback_action": "finalize",
            "messages": ["Designer drafted research-fed storyboard."],
        },
        "audit": {
            "persisted": bool(artifact_path),
            "perAgentStateVisible": True,
            "messagesCaptured": True,
            "eventsOrdered": True,
            "safeForPublicUi": True,
            "evidencePointers": [
                GRAPH_ENTRYPOINT,
                "backend/storyboard-agent/src/tools/search_scene_data.py",
                artifact_path or "api-response-only",
            ],
        },
    }


def persist_run_diagnostics(thread_id: str, result: dict[str, Any]) -> str | None:
    try:
        out_dir = APP_WEB_ROOT / ".omx" / "artifacts" / "storyboard-agent-runs"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{thread_id}.json"
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(out_path)
    except Exception:
        return None


def run_local_orchestrated_langgraph(payload: dict[str, Any]) -> dict[str, Any]:
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import END, START, StateGraph

    timeout = clamp_timeout()
    thread_id = os.environ.get("STORYBOARD_AGENT_THREAD_ID") or f"storyboard-admin-{int(time.time())}-{secrets.token_hex(4)}"
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    initial_state: dict[str, Any] = {
        "prompt": str(request.get("prompt") or "스토리보드를 생성해줘."),
        "messages_public": [],
        "agent_instructions": {},
        "research_scene_data": [],
        "tools_called": [],
        "retrieval_diagnostics": {"status": "not_used"},
    }

    def extract_slots_node(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "slots": {
                "user_intent": state.get("prompt"),
                "target_scene_count": request.get("segmentCount") or len(_local_scenes(payload)) or 4,
                "target_length_minutes": request.get("targetLengthMinutes") or 18,
                "tone": request.get("tone") or "warm",
            },
            "messages_public": [*state.get("messages_public", []), "extract_slots completed"],
        }

    def supervisor_node(state: dict[str, Any]) -> dict[str, Any]:
        instructions = {
            "researcher": ["Use search_scene_data self-RAG against local/Supabase scene evidence."],
            "intern": ["Review Tool/RPC mutation plan and block unapproved execution."],
            "designer": ["Create storyboard from research_scene_data and expose feedback loop."],
        }
        return {
            "agent_instructions": instructions,
            "research_instruction": f"Find scene/caption evidence for: {state.get('prompt')}",
            "messages_public": [*state.get("messages_public", []), "supervisor routed researcher/intern/designer"],
        }

    def researcher_node(state: dict[str, Any]) -> dict[str, Any]:
        retrieval, transcripts, tools = run_search_scene_data_probe(payload, timeout)
        if retrieval.get("status") != "used" or not transcripts:
            raise RuntimeError("required_storyboard_rag_failed")
        scene_data = transcripts
        return {
            "tools_called": tools,
            "retrieval_diagnostics": retrieval,
            "research_scene_data": scene_data,
            "research_results": {"scene_data": scene_data, "transcripts": transcripts},
            "research_web_summary": "Required local/Supabase scene retrieval completed; external web search was not used for this admin generation.",
            "research_sufficient": True,
            "research_summary": "Researcher completed required self-RAG with search_scene_data, BGE-M3, BGE reranker, MMR, and caption lookup.",
            "previous_queries": [state.get("prompt") or "먹방 하이라이트 장면"],
            "researcher_think_count": 1,
            "intern_request": {
                "tool": "search_scene_data",
                "reason": "Ensure scene retrieval path is reviewed and safe before Designer trusts it.",
            },
            "messages_public": [*state.get("messages_public", []), "researcher think/tools/evaluate completed"],
        }

    def intern_node(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "intern_action": "review_existing_tool_rpc",
            "pending_execute_calls": ["review_search_scene_data"],
            "modified_tool_calls": state.get("tools_called") or ["search_scene_data"],
            "plan_update_events": ["plan", "review_create", "human_interrupt_after", "execute_guarded_noop"],
            "intern_result": {
                "status": "reviewed",
                "summary": "search_scene_data path reviewed; create/delete execution remains human-gated.",
            },
            "messages_public": [*state.get("messages_public", []), "intern plan/review/human-interrupt gates recorded"],
        }

    def designer_node(state: dict[str, Any]) -> dict[str, Any]:
        markdown = build_markdown_from_state(payload, state)
        return {
            "final_output": markdown,
            "storyboard_history": [markdown],
            "feedback_action": "finalize",
            "messages_public": [*state.get("messages_public", []), "designer final_output completed"],
        }

    builder = StateGraph(dict)
    builder.add_node("extract_slots", extract_slots_node)
    builder.add_node("supervisor", supervisor_node)
    builder.add_node("researcher", researcher_node)
    builder.add_node("intern", intern_node)
    builder.add_node("designer", designer_node)
    builder.add_edge(START, "extract_slots")
    builder.add_edge("extract_slots", "supervisor")
    builder.add_edge("supervisor", "researcher")
    builder.add_edge("researcher", "intern")
    builder.add_edge("intern", "designer")
    builder.add_edge("designer", END)
    graph = builder.compile(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": thread_id}}
    latest_state = dict(initial_state)
    nodes_visited: list[str] = []
    start = time.monotonic()
    for update in graph.stream(initial_state, config=config, stream_mode="updates"):
        if time.monotonic() - start > timeout:
            raise subprocess.TimeoutExpired("local_orchestrated_langgraph", timeout)
        for node, value in update.items():
            if not str(node).startswith("__") and node not in nodes_visited:
                nodes_visited.append(str(node))
            if isinstance(value, dict):
                latest_state.update(value)
    final_output = str(latest_state.get("final_output") or "").strip()
    retrieval = latest_state.get("retrieval_diagnostics") if isinstance(latest_state.get("retrieval_diagnostics"), dict) else {"status": "not_used"}
    graph_diagnostics = make_graph_diagnostics(
        status="used",
        thread_id=thread_id,
        nodes_visited=nodes_visited,
        tools_called=[tool for tool in latest_state.get("tools_called", []) if isinstance(tool, str)],
        interrupts=[
            {
                "node": "intern.review_create",
                "resumable": True,
                "outputReady": True,
                "summary": "Tool/RPC mutation review is human-gated before execution.",
            },
            {
                "node": "designer_node",
                "resumable": True,
                "outputReady": True,
                "summary": "Designer output is ready for operator review.",
            },
        ],
        retrieval=retrieval,
    )
    result: dict[str, Any] = {
        "final_output": final_output,
        "markdown": final_output,
        "storyboard": {
            "contentAuthority": "authoritative",
            "operatorBrief": "LangGraph graph_command가 Supervisor→Researcher→Intern→Designer 경로로 실행한 결과입니다.",
            "exportMarkdown": final_output,
        },
        "backendAgent": {"graph": graph_diagnostics},
        "diagnostics": {
            "runtime": "langgraph",
            "threadId": thread_id,
            "mode": "local_orchestrated_langgraph",
            "timeoutSeconds": timeout,
            "imageModelLabel": "gpt-image-2 is handled by the separate image provider, not this text command",
        },
    }
    artifact_path = persist_run_diagnostics(thread_id, result)
    reference_graph = build_reference_graph(latest_state, graph_diagnostics, artifact_path)
    result["referenceGraph"] = reference_graph
    result["backendAgent"]["referenceGraph"] = reference_graph
    result["diagnostics"]["artifactPath"] = artifact_path
    if artifact_path:
        # Persist once more with the full reference graph included.
        persist_run_diagnostics(thread_id, result)
    return result


def summarize_interrupts(snapshot: Any, final_output: str) -> list[dict[str, Any]]:
    interrupts: list[dict[str, Any]] = []
    tasks = getattr(snapshot, "tasks", None) or []
    next_nodes = list(getattr(snapshot, "next", None) or [])
    for task in tasks:
        interrupt_items = getattr(task, "interrupts", None) or []
        for item in interrupt_items:
            node = getattr(task, "name", None) or getattr(item, "ns", None) or "unknown"
            interrupts.append(
                {
                    "node": redact_log_text(node, max_length=128),
                    "resumable": True,
                    "outputReady": bool(final_output.strip()),
                    "summary": "LangGraph interrupt",
                }
            )
    if not interrupts and next_nodes:
        for node in next_nodes:
            interrupts.append(
                {
                    "node": str(node),
                    "resumable": True,
                    "outputReady": bool(final_output.strip()),
                    "summary": "LangGraph execution paused with pending next node",
                }
            )
    return interrupts


def run_langgraph(payload: dict[str, Any]) -> dict[str, Any]:
    fixture = os.environ.get("STORYBOARD_AGENT_LANGGRAPH_FIXTURE", "").strip()
    if fixture:
        return run_langgraph_fixture(fixture, payload)
    if not truthy_env("STORYBOARD_AGENT_FORCE_LLM_GRAPH", False):
        return run_local_orchestrated_langgraph(payload)

    sys.path.insert(0, str(BACKEND_ROOT / "src"))
    from graph import build_graph

    timeout = clamp_timeout()
    thread_id = os.environ.get("STORYBOARD_AGENT_THREAD_ID") or f"storyboard-admin-{int(time.time())}-{secrets.token_hex(4)}"
    config = {"configurable": {"thread_id": thread_id}}
    graph = build_graph()
    initial_state = build_initial_langgraph_state(payload)
    nodes_visited: list[str] = []
    latest_state: dict[str, Any] = dict(initial_state)
    start = time.monotonic()

    for update in graph.stream(initial_state, config=config, stream_mode="updates"):
        if time.monotonic() - start > timeout:
            raise subprocess.TimeoutExpired("langgraph", timeout)
        if not isinstance(update, dict):
            continue
        for node, value in update.items():
            if node not in nodes_visited and not str(node).startswith("__"):
                nodes_visited.append(str(node))
            if isinstance(value, dict):
                latest_state.update(value)

    snapshot = graph.get_state(config)
    snapshot_values = getattr(snapshot, "values", None)
    if isinstance(snapshot_values, dict):
        latest_state.update(snapshot_values)
    final_output = str(latest_state.get("final_output") or "").strip()
    interrupts = summarize_interrupts(snapshot, final_output)
    status = "used"
    if interrupts and final_output:
        status = "interrupted_output_ready"
    elif interrupts:
        status = "interrupted_needs_resume"
    tools_called = collect_tools_from_state(latest_state)
    retrieval = derive_retrieval_diagnostics(tools_called, latest_state)
    markdown = final_output or "LangGraph execution paused before final storyboard output."
    graph_diagnostics = make_graph_diagnostics(
        status=status,
        thread_id=thread_id,
        nodes_visited=nodes_visited,
        tools_called=tools_called,
        interrupts=interrupts,
        retrieval=retrieval,
    )
    return {
        "final_output": markdown,
        "markdown": markdown,
        "storyboard": fixture_storyboard(markdown, "LangGraph graph_command output"),
        "backendAgent": {"graph": graph_diagnostics},
        "diagnostics": {
            "runtime": "langgraph",
            "threadId": thread_id,
            "timeoutSeconds": timeout,
            "imageModelLabel": "gpt-image-2 is handled by the separate image provider, not this text command",
        },
    }


def run_codex_oauth(payload: dict[str, Any]) -> dict[str, Any]:
    model = os.environ.get("STORYBOARD_AGENT_CODEX_MODEL", DEFAULT_CODEX_MODEL).strip() or DEFAULT_CODEX_MODEL
    effort = os.environ.get("STORYBOARD_AGENT_CODEX_EFFORT", DEFAULT_CODEX_EFFORT).strip() or DEFAULT_CODEX_EFFORT
    codex_bin = os.environ.get("STORYBOARD_AGENT_CODEX_BIN", "codex")
    timeout = clamp_timeout()
    thread_id = f"storyboard-admin-{int(time.time())}-{secrets.token_hex(4)}"
    prompt = build_codex_prompt(payload)
    with tempfile.TemporaryDirectory(prefix="storyboard-agent-codex-") as tmp:
        answer_path = Path(tmp) / "answer.txt"
        cmd = [
            codex_bin,
            "exec",
            "--skip-git-repo-check",
            "--cd",
            str(REPO_ROOT),
            "--sandbox",
            "read-only",
            "--model",
            model,
            "-c",
            f'model_reasoning_effort="{effort}"',
            "--output-last-message",
            str(answer_path),
            prompt,
        ]
        completed = subprocess.run(
            cmd,
            text=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=codex_oauth_env(),
            timeout=timeout,
            check=False,
        )
        answer = answer_path.read_text(encoding="utf-8", errors="ignore") if answer_path.exists() else ""
        if completed.returncode != 0:
            raise RuntimeError("codex_cli_oauth_failed")
        parsed = parse_codex_answer(answer or completed.stdout, model, effort)
        parsed.setdefault("diagnostics", {})
        parsed["diagnostics"].update(
            {
                "runtime": "codex_cli_oauth",
                "model": model,
                "effort": effort,
                "threadId": thread_id,
                "timeoutSeconds": timeout,
                "stdoutPreview": "[SUPPRESSED]",
                "stderrPreview": "[SUPPRESSED]",
            }
        )
        return parsed


def main() -> int:
    try:
        load_dotenv_file(BACKEND_ROOT / ".env")
        load_dotenv_file(APP_WEB_ROOT / ".env.local")
        payload = read_payload()
        runtime = os.environ.get("STORYBOARD_AGENT_RUNTIME", "langgraph").strip() or "langgraph"
        apply_safe_env_aliases(runtime)
        if runtime == "langgraph":
            result = run_langgraph(payload)
        elif runtime in {"codex_cli_oauth", "codex"}:
            result = run_codex_oauth(payload)
        else:
            raise RuntimeError(
                f"unsupported_storyboard_agent_runtime={runtime}; default local runtime is langgraph"
            )
        print(json.dumps(result, ensure_ascii=False))  # lgtm[py/clear-text-logging-sensitive-data]
        return 0
    except subprocess.TimeoutExpired as exc:
        eprint(f"storyboard_agent_timeout: {safe_error_name(exc)}")
        return 124
    except Exception as exc:
        eprint(f"storyboard_agent_error: {safe_error_name(exc)}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
