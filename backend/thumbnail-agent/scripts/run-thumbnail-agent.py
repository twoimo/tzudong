#!/usr/bin/env python3
"""Run thumbnail backend-agent orchestration and emit JSON.

Input: JSON from stdin first, then THUMBNAIL_AGENT_JSON.
Output: JSON with concept/layoutBrief/promptAddendum/safetyReview/nextActions.

The command never generates images and never treats `gpt-image-2` as a Codex
agent model. Exact image generation remains in the Next.js provider layer.
Default runtime is Codex CLI OAuth with `gpt-5.5` and low reasoning so chat
orchestration, canvas planning, and generation briefs are handled by the same
local Codex agent surface as the storyboard backend command.
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
if str(CANONICAL_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(CANONICAL_BACKEND_ROOT))

from utils.privacy_log import redact_log_text, safe_error_name

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parents[0]
SRC_ROOT = BACKEND_ROOT / "src"
DEFAULT_CODEX_MODEL = "gpt-5.5"
DEFAULT_CODEX_EFFORT = "low"
DEFAULT_TIMEOUT_SECONDS = 120


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


def codex_oauth_env() -> dict[str, str]:
    """Return a child environment that forces Codex CLI to use its OAuth login."""
    child_env = dict(os.environ)
    for key in (
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
    ):
        child_env.pop(key, None)
    return child_env


def read_payload() -> dict[str, Any]:
    stdin_text = ""
    try:
        if not sys.stdin.closed:
            stdin_text = sys.stdin.read().strip()
    except Exception:
        stdin_text = ""
    raw = stdin_text or os.environ.get("THUMBNAIL_AGENT_JSON", "").strip()
    if not raw:
        raise ValueError("missing thumbnail agent JSON payload")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("thumbnail agent payload must be a JSON object")
    return parsed


def clamp_timeout() -> float:
    raw = os.environ.get("THUMBNAIL_AGENT_TIMEOUT_MS") or os.environ.get("THUMBNAIL_AGENT_CODEX_TIMEOUT_MS")
    if raw:
        try:
            milliseconds = int(float(raw))
            return max(5.0, min(milliseconds / 1000.0, 600.0))
        except Exception:
            pass
    raw_seconds = os.environ.get("THUMBNAIL_AGENT_CODEX_TIMEOUT_SECONDS")
    if raw_seconds:
        try:
            return max(5.0, min(float(raw_seconds), 600.0))
        except Exception:
            pass
    return DEFAULT_TIMEOUT_SECONDS


def deterministic_plan(payload: dict[str, Any], runtime: str, reason: str | None = None) -> dict[str, Any]:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    refs = payload.get("referenceImages") if isinstance(payload.get("referenceImages"), list) else []
    retrieval_evidence = payload.get("retrievalEvidence") if isinstance(payload.get("retrievalEvidence"), list) else request.get("retrievalEvidence") if isinstance(request.get("retrievalEvidence"), list) else []
    retrieval_diagnostics = payload.get("retrievalDiagnostics") if isinstance(payload.get("retrievalDiagnostics"), dict) else request.get("retrievalDiagnostics") if isinstance(request.get("retrievalDiagnostics"), dict) else {}
    retrieval_titles = "; ".join(str(item.get("title") or item.get("id") or "reference")[:80] for item in retrieval_evidence[:4] if isinstance(item, dict)) or "no retrieval evidence"
    headline = str(request.get("headline") or "메인 문구")[:80]
    topic = str(request.get("topic") or "먹방 썸네일")[:180]
    sub = str(request.get("subHeadline") or "").strip()[:80]
    concept = f"{headline} 중심의 고대비 먹방 썸네일: {topic}을 검색 레퍼런스({retrieval_titles}) 기반 음식 클로즈업과 리액션 존으로 즉시 전달."
    layout = "하단 40~50%는 검색된 음식/구도 레퍼런스와 맞는 음식 클로즈업, 우측/좌상단은 리액션 존, 중앙/하단은 편집 가능한 한글 제목 안전 영역."
    if sub:
        layout += f" 보조 문구 '{sub}'는 작은 스티커처럼 분리."
    prompt_addendum = "\n".join([
        "Backend thumbnail agent orchestration brief:",
        f"Concept: {concept}",
        f"Layout: {layout}",
        f"Retrieved references: {retrieval_titles}",
        f"Retrieval diagnostics: {json.dumps(retrieval_diagnostics, ensure_ascii=False)[:800]}",
        "Quality gate: no real logos/signage/contact data/prices, no identifiable crowd faces, keep final Korean typography editable in canvas, and never treat automatic retrieval as host/person likeness permission.",
    ])
    warnings = ["thumbnail_agent_deterministic_fallback: emitted deterministic orchestration plan"]
    if reason:
        warnings.append("thumbnail_agent_graph_unavailable")
    return {
        "mode": "command",
        "runtime": runtime,
        "concept": concept,
        "layoutBrief": layout,
        "promptAddendum": prompt_addendum,
        "safetyReview": "사람 검수 전 업로드 금지: 과장 문구, 브랜드/가격/연락처, 실존 인물 식별성을 확인한다.",
        "nextActions": ["생성 이미지 검수", "캔버스 문구 조정", "경고 확인 후 PNG 저장"],
        "warnings": warnings,
        "diagnostics": {
            "runtime": runtime,
            "referenceImageCount": len(refs),
            "retrievalEvidenceCount": len(retrieval_evidence),
            "graphFallback": bool(reason),
        },
    }


def run_local_graph(payload: dict[str, Any]) -> dict[str, Any]:
    sys.path.insert(0, str(SRC_ROOT))
    from graph import build_graph  # type: ignore

    graph = build_graph()
    result = graph.invoke(payload)
    if not isinstance(result, dict):
        raise RuntimeError("thumbnail agent graph returned non-object")
    result.setdefault("mode", "command")
    result.setdefault("runtime", "local_graph")
    return result


def build_codex_prompt(payload: dict[str, Any]) -> str:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    refs = payload.get("referenceImages") if isinstance(payload.get("referenceImages"), list) else []
    retrieval_evidence = payload.get("retrievalEvidence") if isinstance(payload.get("retrievalEvidence"), list) else request.get("retrievalEvidence") if isinstance(request.get("retrievalEvidence"), list) else []
    retrieval_diagnostics = payload.get("retrievalDiagnostics") if isinstance(payload.get("retrievalDiagnostics"), dict) else request.get("retrievalDiagnostics") if isinstance(request.get("retrievalDiagnostics"), dict) else {}
    base_prompt = str(payload.get("basePrompt") or "")[:8000]
    target = payload.get("target") if isinstance(payload.get("target"), dict) else {"width": 1280, "height": 720}
    compact_request = json.dumps(request, ensure_ascii=False, indent=2)[:4000]
    compact_refs = json.dumps(refs[:8], ensure_ascii=False, indent=2)[:3000]
    compact_retrieval = json.dumps({"evidence": retrieval_evidence[:4], "diagnostics": retrieval_diagnostics}, ensure_ascii=False, indent=2)[:4000]
    return f"""You are the local thumbnail backend command for the tzudong admin app.

Critical constraints:
- Use the existing local Codex OAuth session. Do not ask for or require an OpenAI API key.
- Do not run shell commands or inspect files. Use only the JSON context below.
- All thumbnail chat/work orchestration is performed by this Codex CLI agent.
- The actual image provider remains in the Next.js provider layer; never claim that this text agent generated the image.
- Do not expose secrets. Do not mention hidden credentials.
- Return ONLY valid compact JSON with keys: mode, runtime, concept, layoutBrief, promptAddendum, safetyReview, nextActions, warnings, diagnostics.
- The result should be practical Korean guidance for a YouTube mukbang thumbnail canvas and generation brief.

Target canvas: {target}
Request JSON:
{compact_request}
Reference image summaries:
{compact_refs}
Automatic retrieval/reranker evidence:
{compact_retrieval}
Base prompt/context:
{base_prompt}

JSON response requirements:
{{
  "mode": "command",
  "runtime": "codex_cli_oauth",
  "concept": "Korean concise concept",
  "layoutBrief": "Korean canvas/layout plan",
  "promptAddendum": "Backend thumbnail agent orchestration brief: ...",
  "safetyReview": "Korean safety/review checklist",
  "nextActions": ["생성 이미지 검수", "캔버스 문구 조정", "경고 확인 후 PNG 저장"],
  "warnings": ["thumbnail_agent_codex_cli_oauth: Codex CLI gpt-5.5 low generated orchestration brief only; exact image provider remains in Next.js."],
  "diagnostics": {{
    "runtime": "codex_cli_oauth",
    "model": "...",
    "effort": "low",
    "threadPolicy": "per-request noninteractive",
    "imageModelLabel": "gpt-image-2 is handled by the separate image provider, not this text command"
  }}
}}
"""


def parse_codex_answer(raw: str, model: str, effort: str, payload: dict[str, Any]) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            fallback = deterministic_plan(payload, "codex_cli_oauth")
            diagnostics = parsed.get("diagnostics") if isinstance(parsed.get("diagnostics"), dict) else {}
            diagnostics.update({"runtime": "codex_cli_oauth", "model": model, "effort": effort})
            return {
                "mode": "command",
                "runtime": "codex_cli_oauth",
                "concept": str(parsed.get("concept") or fallback["concept"])[:600],
                "layoutBrief": str(parsed.get("layoutBrief") or fallback["layoutBrief"])[:1200],
                "promptAddendum": str(parsed.get("promptAddendum") or fallback["promptAddendum"])[:4000],
                "safetyReview": str(parsed.get("safetyReview") or fallback["safetyReview"])[:1000],
                "nextActions": parsed.get("nextActions") if isinstance(parsed.get("nextActions"), list) else fallback["nextActions"],
                "warnings": parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else fallback["warnings"],
                "diagnostics": diagnostics,
            }
    except Exception:
        pass
    fallback = deterministic_plan(payload, "codex_cli_oauth", "codex output parse fallback")
    fallback["diagnostics"].update({"runtime": "codex_cli_oauth", "model": model, "effort": effort, "parseFallback": True})
    return fallback


def run_codex_oauth(payload: dict[str, Any]) -> dict[str, Any]:
    model = os.environ.get("THUMBNAIL_AGENT_CODEX_MODEL", DEFAULT_CODEX_MODEL).strip() or DEFAULT_CODEX_MODEL
    effort = os.environ.get("THUMBNAIL_AGENT_CODEX_EFFORT", DEFAULT_CODEX_EFFORT).strip() or DEFAULT_CODEX_EFFORT
    codex_bin = os.environ.get("THUMBNAIL_AGENT_CODEX_BIN", "codex")
    timeout = clamp_timeout()
    thread_id = f"thumbnail-admin-{int(time.time())}-{secrets.token_hex(4)}"
    prompt = build_codex_prompt(payload)
    with tempfile.TemporaryDirectory(prefix="thumbnail-agent-codex-") as tmp:
        answer_path = Path(tmp) / "answer.txt"
        # Equivalent command surface: codex exec --model gpt-5.5 -c model_reasoning_effort="low"
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
        parsed = parse_codex_answer(answer or completed.stdout, model, effort, payload)
        parsed.setdefault("diagnostics", {})
        parsed["diagnostics"].update({
            "runtime": "codex_cli_oauth",
            "model": model,
            "effort": effort,
            "threadId": thread_id,
            "timeoutSeconds": timeout,
            "stdoutPreview": "[SUPPRESSED]",
            "stderrPreview": "[SUPPRESSED]",
        })
        return parsed


def main() -> int:
    try:
        load_dotenv_file(BACKEND_ROOT / ".env")
        payload = read_payload()
        runtime = os.environ.get("THUMBNAIL_AGENT_RUNTIME", "codex_cli_oauth").strip() or "codex_cli_oauth"
        if runtime == "local_graph":
            result = run_local_graph(payload)
        elif runtime in {"codex_cli_oauth", "codex"}:
            result = run_codex_oauth(payload)
        else:
            result = deterministic_plan(payload, runtime, f"unsupported runtime {runtime}")
        print(json.dumps(result, ensure_ascii=False))  # lgtm[py/clear-text-logging-sensitive-data]
        return 0
    except subprocess.TimeoutExpired as exc:
        eprint(f"thumbnail_agent_timeout: {safe_error_name(exc)}")
        return 124
    except Exception as exc:
        eprint(f"thumbnail_agent_error: {safe_error_name(exc)}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
