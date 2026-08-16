#!/usr/bin/env python3
"""Generate a YouTube thumbnail through the local Codex OAuth image bridge.

This CLI is the default provider command for the admin local-bridge thumbnail
endpoint. It intentionally delegates the OAuth/Responses transport to the
existing Codex image-generation bridge and only passes a thumbnail-specific
instruction contract. It never reads or uses OPENAI_API_KEY.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, Optional

IMAGE_MODEL = "gpt-image-2"
PROVIDER_ID = "local-codex"
AUTH_MODE = "codex_oauth"
DEFAULT_SIZE = "1536x864"
DEFAULT_FORMAT = "png"
DEFAULT_BACKGROUND = "opaque"
DEFAULT_REASONING_EFFORT = "high"
THUMBNAIL_INSTRUCTIONS = (
    "Use the image_generation tool to create exactly one safe 16:9 Korean YouTube thumbnail base image. "
    "The image must be a single full-bleed thumbnail composition, not a storyboard sheet, not a comic page, "
    "not a split-screen with internal borders, and not UI chrome. Preserve negative space for later editable text overlays; "
    "do not bake readable final typography into the image. Never use other image models or fallback image paths."
)


class ThumbnailProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _optional_str(value: Any) -> Optional[str]:
    return value if isinstance(value, str) and value else None


def _print_json(payload: Mapping[str, Any]) -> None:
    print(json.dumps({"ok": True, "keys": sorted(str(key) for key in payload.keys())}, ensure_ascii=False), flush=True)  # lgtm[py/clear-text-logging-sensitive-data]


def _script_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_storyboard_provider_script() -> Path:
    return _script_dir() / "codex-imagegen-storyboard-provider.py"


def _read_prompt(path: Path) -> str:
    try:
        prompt = path.read_text("utf-8").strip()
    except FileNotFoundError as exc:
        raise ThumbnailProviderError("prompt_file_missing", f"Prompt file not found: {path}") from exc
    if not prompt:
        raise ThumbnailProviderError("prompt_file_empty", "Prompt file is empty")
    return prompt


def _parse_last_json_line(stdout: str) -> Dict[str, Any]:
    for line in reversed([item.strip() for item in stdout.splitlines() if item.strip()]):
        if not (line.startswith("{") and line.endswith("}")):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ThumbnailProviderError("provider_json_invalid", "Storyboard provider returned invalid JSON") from exc
        if isinstance(parsed, dict):
            return parsed
    raise ThumbnailProviderError("provider_json_missing", "Storyboard provider did not return JSON")


def _write_json_file(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")


def _run_storyboard_provider(args: argparse.Namespace, prompt: str, output_path: Path) -> Dict[str, Any]:
    provider_script = Path(args.storyboard_provider_script).expanduser().resolve()
    if not provider_script.exists():
        raise ThumbnailProviderError("provider_script_missing", f"Storyboard provider script not found: {provider_script}")
    payload: Dict[str, Any] = {
        "prompt": prompt,
        "instructions": THUMBNAIL_INSTRUCTIONS,
        "outputPath": str(output_path),
        "agentModel": args.agent_model,
        "size": args.size,
        "outputFormat": DEFAULT_FORMAT,
        "background": DEFAULT_BACKGROUND,
        "reasoningEffort": args.reasoning_effort,
        "timeout": args.timeout,
    }
    auth_file = _optional_str(args.auth_file) or os.environ.get("CODEX_AUTH_FILE")
    if auth_file:
        payload["authFile"] = auth_file
    if args.reference_manifest:
        payload["referenceManifest"] = str(Path(args.reference_manifest).expanduser().resolve())
    env = {**os.environ, "OPENAI_API_KEY": ""}
    try:
        completed = subprocess.run(
            [sys.executable, str(provider_script)],
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            capture_output=True,
            cwd=str(provider_script.parent.parent),
            env=env,
            timeout=max(args.timeout + 15, args.timeout),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ThumbnailProviderError("provider_timeout", "Thumbnail provider timed out") from exc
    result = _parse_last_json_line(completed.stdout)
    if completed.returncode != 0:
        raise ThumbnailProviderError(
            str(result.get("code") or "provider_failed"),
            str(result.get("error") or completed.stderr[-1000:] or "Storyboard provider failed"),
        )
    return result


def _assert_exact_thumbnail_result(result: Mapping[str, Any], output_path: Path) -> Dict[str, Any]:
    if (
        result.get("ok") is not True or
        result.get("providerId") != PROVIDER_ID or
        result.get("authMode") != AUTH_MODE or
        result.get("requestToolType") != "image_generation" or
        result.get("requestToolModel") != IMAGE_MODEL or
        result.get("model") != IMAGE_MODEL or
        result.get("modelProvenance") != "exact" or
        result.get("hasOpenAIAPIKey") is not False or
        result.get("outputPath") != str(output_path)
    ):
        raise ThumbnailProviderError(
            "untrusted_provider_result",
            "Provider result did not satisfy exact local-codex gpt-image-2 provenance",
        )
    trusted = dict(result)
    trusted["thumbnailProvider"] = "codex-imagegen-thumbnail-provider.py"
    return trusted


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Codex OAuth gpt-image-2 YouTube thumbnail provider")
    parser.add_argument("--prompt-file", required=True, help="prompt text written by the local bridge")
    parser.add_argument("--output", required=True, help="absolute output PNG path")
    parser.add_argument("--json-output", default="", help="optional provenance JSON output path")
    parser.add_argument("--model", default=IMAGE_MODEL, help="must be gpt-image-2")
    parser.add_argument("--reference-manifest", default="", help="optional browser-uploaded reference manifest")
    parser.add_argument("--storyboard-provider-script", default=str(_default_storyboard_provider_script()))
    parser.add_argument("--agent-model", default=os.environ.get("CODEX_IMAGEGEN_AGENT_MODEL", "gpt-5.5"))
    parser.add_argument("--reasoning-effort", default=os.environ.get("CODEX_IMAGEGEN_AGENT_EFFORT", DEFAULT_REASONING_EFFORT))
    parser.add_argument("--size", default=os.environ.get("THUMBNAIL_LOCAL_CODEX_IMAGE_SIZE", DEFAULT_SIZE))
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--auth-file", default=os.environ.get("CODEX_AUTH_FILE", ""))
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        if args.model != IMAGE_MODEL:
            raise ThumbnailProviderError("invalid_model", "Thumbnail provider only supports gpt-image-2")
        prompt = _read_prompt(Path(args.prompt_file).expanduser().resolve())
        output_path = Path(args.output).expanduser().resolve()
        result = _assert_exact_thumbnail_result(_run_storyboard_provider(args, prompt, output_path), output_path)
        if args.json_output:
            _write_json_file(Path(args.json_output).expanduser().resolve(), result)
        _print_json(result)
        return 0
    except ThumbnailProviderError as exc:
        _print_json({
            "ok": False,
            "providerId": PROVIDER_ID,
            "authMode": AUTH_MODE,
            "requestToolType": "image_generation",
            "requestToolModel": IMAGE_MODEL,
            "model": IMAGE_MODEL,
            "modelProvenance": "unverified",
            "code": exc.code,
            "error": str(exc),
            "hasOpenAIAPIKey": False,
        })
        return 1
    except Exception as exc:  # pragma: no cover - last-resort CLI guard
        _print_json({
            "ok": False,
            "providerId": PROVIDER_ID,
            "authMode": AUTH_MODE,
            "requestToolType": "image_generation",
            "requestToolModel": IMAGE_MODEL,
            "model": IMAGE_MODEL,
            "modelProvenance": "unverified",
            "code": "unexpected_thumbnail_provider_error",
            "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
            "hasOpenAIAPIKey": False,
        })
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
