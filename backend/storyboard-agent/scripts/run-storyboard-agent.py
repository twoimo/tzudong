#!/usr/bin/env python3
"""Run storyboard backend generation as a Next.js command bridge.

Default runtime: Codex CLI OAuth (`codex exec`) so local development does not
need a separate OpenAI API key. This wrapper intentionally does not treat
`gpt-image-2` as a Codex agent model; image generation is handled by the
separate storyboard image provider.

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

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parents[0]
DEFAULT_CODEX_MODEL = "gpt-5.5"
DEFAULT_CODEX_EFFORT = "high"
DEFAULT_TIMEOUT_SECONDS = 120
GRAPH_ENTRYPOINT = "backend/storyboard-agent/src/graph.py"
SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"sk-proj-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-.]{20,}"),
    re.compile(r"(?i)(OPENAI[_A-Z]*|SERVICE[_A-Z]*|SUPABASE[_A-Z]*|API[_A-Z]*KEY|TOKEN|SECRET)\s*[:=]\s*[^\s,;]+"),
    re.compile(r"https://[^\s]+(?:token|key|secret)[^\s]*", re.I),
]


def redact(value: Any) -> str:
    text = str(value or "")
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def eprint(message: str) -> None:
    print(redact(message), file=sys.stderr)


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


def apply_safe_env_aliases(runtime: str) -> None:
    if not os.environ.get("PUBLIC_SUPABASE_URL") and os.environ.get("NEXT_PUBLIC_SUPABASE_URL"):
        os.environ["PUBLIC_SUPABASE_URL"] = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    if runtime != "codex_cli_oauth" and not os.environ.get("OPENAI_API_KEY") and os.environ.get("NEXT_OPENAI_API_KEY_BYEON"):
        # Only for optional LangGraph/API-key mode. The default Codex CLI path
        # does not require this variable.
        os.environ["OPENAI_API_KEY"] = os.environ["NEXT_OPENAI_API_KEY_BYEON"]


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
        "NEXT_OPENAI_API_KEY_BYEON",
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
    "effort": "high",
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
        graph["fallbackReason"] = fallback_reason
    if fallback_detail:
        graph["fallbackDetail"] = redact(fallback_detail)[:600]
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
            nodes_visited=[*base_nodes, "researcher", "designer"],
            tools_called=["search_scene_data"],
            retrieval={
                "status": "used",
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

    return {
        "final_output": markdown,
        "markdown": markdown,
        "storyboard": fixture_storyboard(
            markdown or "LangGraph interrupted before final storyboard output.",
            "LangGraph fixture runner output",
        ),
        "backendAgent": {"graph": graph},
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
    return {
        "status": "used",
        "usedModels": {
            "embedding": "BAAI/bge-m3",
            "reranker": "BAAI/bge-reranker-v2-m3",
        },
        "operations": {
            "supabaseRpc": "match_documents_hybrid",
            "mmrApplied": True,
            "captionLookup": "get_video_captions_for_range",
        },
    }


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
                    "node": str(node),
                    "resumable": True,
                    "outputReady": bool(final_output.strip()),
                    "summary": redact(getattr(item, "value", "") or "LangGraph interrupt")[:300],
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
        stdout = redact(completed.stdout[-3000:])
        stderr = redact(completed.stderr[-3000:])
        answer = answer_path.read_text(encoding="utf-8", errors="ignore") if answer_path.exists() else ""
        if completed.returncode != 0:
            raise RuntimeError(
                f"codex_cli_oauth_failed exit={completed.returncode} model={model} stdout={stdout[-800:]} stderr={stderr[-1200:]}"
            )
        parsed = parse_codex_answer(answer or completed.stdout, model, effort)
        parsed.setdefault("diagnostics", {})
        parsed["diagnostics"].update(
            {
                "runtime": "codex_cli_oauth",
                "model": model,
                "effort": effort,
                "threadId": thread_id,
                "timeoutSeconds": timeout,
                "stdoutPreview": stdout[-800:],
                "stderrPreview": stderr[-800:],
            }
        )
        return parsed


def main() -> int:
    try:
        load_dotenv_file(BACKEND_ROOT / ".env")
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
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except subprocess.TimeoutExpired as exc:
        eprint(f"storyboard_agent_timeout: {exc}")
        return 124
    except Exception as exc:
        eprint(f"storyboard_agent_error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
