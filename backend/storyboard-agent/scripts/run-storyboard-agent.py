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
        runtime = os.environ.get("STORYBOARD_AGENT_RUNTIME", "codex_cli_oauth").strip()
        apply_safe_env_aliases(runtime)
        if runtime not in {"codex_cli_oauth", "codex"}:
            raise RuntimeError(
                f"unsupported_storyboard_agent_runtime={runtime}; default local runtime is codex_cli_oauth"
            )
        result = run_codex_oauth(payload)
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
