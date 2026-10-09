#!/usr/bin/env python3
"""Generate storyboard cut images through Codex OAuth + Responses image_generation.

This bridge intentionally does not read or use OPENAI_API_KEY.  It reads the
local Codex/ChatGPT OAuth file (`~/.codex/auth.json` by default), sends a
Responses payload whose image_generation tool is pinned to `gpt-image-2`, and
only reports success after the response contains a completed
`image_generation_call` result.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import http.client
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional

PROVIDER_ID = "local-codex"
AUTH_MODE = "codex_oauth"
AGENT_MODEL_DEFAULT = "gpt-5.5"
IMAGE_TOOL_TYPE = "image_generation"
IMAGE_MODEL = "gpt-image-2"
MODEL_PROVENANCE = "exact"
OAUTH_BASE_URL = "https://chatgpt.com/backend-api/codex"
RESPONSES_ENDPOINT = OAUTH_BASE_URL.rstrip("/") + "/responses"
OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
DEFAULT_SIZE = "1536x864"
DEFAULT_FORMAT = "png"
DEFAULT_BACKGROUND = "opaque"
DEFAULT_REASONING_EFFORT = "high"
DEFAULT_INSTRUCTIONS = (
    "Use the image_generation tool to create exactly one safe full-bleed single-scene storyboard cut image. "
    "The full canvas must be one continuous composition; do not create storyboard sheets, comic pages, "
    "multi-panel layouts, split-screens, inset panels, internal borders, blank quadrants, placeholder boxes, "
    "X-mark empty panels, or embedded 2x2 grids. "
    "Never use other image models or fallback image paths."
)


class BridgeError(Exception):
    def __init__(self, code: str, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


def _optional_str(value: Any) -> Optional[str]:
    return value if isinstance(value, str) and value else None


def _auth_file_path(auth_file: Optional[str]) -> Path:
    if auth_file:
        return Path(auth_file).expanduser()
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        return Path(codex_home).expanduser() / "auth.json"
    return Path.home() / ".codex" / "auth.json"


def _load_json_file(path: Path) -> Dict[str, Any]:
    try:
        payload = json.loads(path.read_text("utf-8"))
    except FileNotFoundError as exc:
        raise BridgeError("codex_auth_missing", f"Codex auth file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise BridgeError("codex_auth_invalid", f"Codex auth file is not valid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise BridgeError("codex_auth_invalid", f"Codex auth file must contain a JSON object: {path}")
    return payload


def _write_json_file(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _jwt_claims(token: Optional[str]) -> Dict[str, Any]:
    if not token or "." not in token:
        return {}
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    padded = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        claims = json.loads(decoded)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _account_id_from_id_token(id_token: Optional[str]) -> Optional[str]:
    auth_claim = _jwt_claims(id_token).get("https://api.openai.com/auth")
    if isinstance(auth_claim, Mapping):
        return _optional_str(auth_claim.get("chatgpt_account_id"))
    return None


def _should_refresh(access_token: Optional[str], last_refresh: Optional[str]) -> bool:
    if not access_token:
        return True
    exp = _jwt_claims(access_token).get("exp")
    if isinstance(exp, (int, float)) and exp <= time.time() + 300:
        return True
    if not last_refresh:
        return False
    try:
        refreshed_at = datetime.fromisoformat(last_refresh.replace("Z", "+00:00"))
    except ValueError:
        return True
    if refreshed_at.tzinfo is None:
        refreshed_at = refreshed_at.replace(tzinfo=timezone.utc)
    return refreshed_at.timestamp() <= time.time() - 55 * 60


def _refresh_tokens(refresh_token: str) -> Dict[str, str]:
    body = json.dumps(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": OAUTH_CLIENT_ID,
            "scope": "openid profile email offline_access",
        },
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        OAUTH_TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise BridgeError("codex_oauth_refresh_failed", f"OAuth refresh HTTP {exc.code}: {body_text[:1000]}", exc.code) from exc
    except urllib.error.URLError as exc:
        raise BridgeError("codex_oauth_refresh_failed", f"OAuth refresh failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise BridgeError("codex_oauth_refresh_failed", "OAuth refresh returned invalid JSON") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("access_token"), str):
        raise BridgeError("codex_oauth_refresh_failed", "OAuth refresh did not return access_token")
    return payload  # type: ignore[return-value]


def _oauth_headers(auth_file: Optional[str]) -> Dict[str, str]:
    path = _auth_file_path(auth_file)
    auth = _load_json_file(path)
    tokens = auth.get("tokens")
    if not isinstance(tokens, dict):
        raise BridgeError("codex_auth_invalid", "Codex auth file does not contain OAuth tokens")

    access_token = _optional_str(tokens.get("access_token"))
    refresh_token = _optional_str(tokens.get("refresh_token"))
    id_token = _optional_str(tokens.get("id_token"))
    account_id = _optional_str(tokens.get("account_id")) or _account_id_from_id_token(id_token)

    if refresh_token and _should_refresh(access_token, _optional_str(auth.get("last_refresh"))):
        refreshed = _refresh_tokens(refresh_token)
        id_token = _optional_str(refreshed.get("id_token")) or id_token
        access_token = _optional_str(refreshed.get("access_token"))
        refresh_token = _optional_str(refreshed.get("refresh_token")) or refresh_token
        account_id = _account_id_from_id_token(id_token) or account_id
        auth["tokens"] = {
            "id_token": id_token,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "account_id": account_id,
        }
        auth["last_refresh"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        _write_json_file(path, auth)

    if not access_token:
        raise BridgeError("codex_auth_missing", "Codex OAuth access token not found; run `codex login`")
    if not account_id:
        raise BridgeError("codex_auth_missing", "Codex OAuth account id not found; run `codex login`")

    return {
        "Authorization": "Bearer " + access_token,
        "chatgpt-account-id": account_id,
        "OpenAI-Beta": "responses=experimental",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }


def _build_payload(
    prompt: str,
    *,
    agent_model: str,
    size: str,
    output_format: str,
    background: str,
    reasoning_effort: str,
    instructions: str,
) -> Dict[str, Any]:
    if output_format not in {"png", "jpeg", "webp"}:
        raise BridgeError("invalid_output_format", "outputFormat must be png, jpeg, or webp")
    if background == "transparent":
        raise BridgeError("invalid_background", "gpt-image-2 does not support transparent backgrounds")
    tool = {
        "type": IMAGE_TOOL_TYPE,
        "model": IMAGE_MODEL,
        "size": size,
        "output_format": output_format,
        "background": background,
    }
    payload: Dict[str, Any] = {
        "model": agent_model,
        "instructions": instructions,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            }
        ],
        "tools": [tool],
        "tool_choice": {"type": IMAGE_TOOL_TYPE},
        "stream": True,
        "store": False,
        "reasoning": {"effort": reasoning_effort},
        "text": {"verbosity": "low"},
    }
    return payload


def _parse_responses_stream(stdout: str) -> Dict[str, Any]:
    events: List[Dict[str, Any]] = []
    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("event:"):
            continue
        if line.startswith("data:"):
            line = line[len("data:") :].strip()
        if line == "[DONE]":
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            raise BridgeError("codex_response_invalid", "Responses bridge returned invalid streaming JSON") from exc
        if isinstance(event, dict):
            events.append(event)
    if not events:
        raise BridgeError("codex_response_empty", "Responses bridge returned no JSON events")

    raw_response: Dict[str, Any] = {"output": [], "_events": events}
    partial_images: List[Dict[str, Any]] = []
    for event in events:
        event_type = event.get("type")
        if event_type == "response.output_item.done":
            item = event.get("item")
            if isinstance(item, dict):
                raw_response["output"].append(item)
        elif event_type == "response.image_generation_call.partial_image":
            partial_images.append(event)
        elif event_type == "response.completed":
            response = event.get("response")
            if isinstance(response, dict):
                output = raw_response.get("output")
                raw_response.update(response)
                if not raw_response.get("output") and output:
                    raw_response["output"] = output
    if partial_images:
        raw_response["_partial_images"] = partial_images
    return raw_response


def _run_oauth_responses(payload: Mapping[str, Any], *, timeout: int, auth_file: Optional[str]) -> Dict[str, Any]:
    request = urllib.request.Request(
        RESPONSES_ENDPOINT,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers=_oauth_headers(auth_file),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            try:
                body = response.read().decode(charset)
            except http.client.IncompleteRead as exc:
                partial = exc.partial or b""
                if not partial:
                    raise BridgeError(
                        "codex_responses_incomplete_read",
                        "Responses bridge stream ended before any body bytes were received",
                    ) from exc
                body = partial.decode(charset, errors="replace")
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise BridgeError("codex_responses_http_error", f"Responses bridge HTTP {exc.code}: {body_text[:1600]}", exc.code) from exc
    except urllib.error.URLError as exc:
        raise BridgeError("codex_responses_network_error", f"Responses bridge request failed: {exc.reason}") from exc

    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        return _parse_responses_stream(body)
    raise BridgeError("codex_response_invalid", "Responses bridge JSON must be an object")


def _raw_output_item_types(raw_response: Mapping[str, Any]) -> List[Any]:
    output = raw_response.get("output")
    if not isinstance(output, list):
        return []
    return [item.get("type") for item in output if isinstance(item, dict)]


def _extract_generated_image(raw_response: Mapping[str, Any], output_format: str) -> Dict[str, Any]:
    output = raw_response.get("output")
    if not isinstance(output, list):
        raise BridgeError("image_generation_missing", "response did not contain output items")
    raw_item_types = _raw_output_item_types(raw_response)
    image_items = [
        item for item in output
        if isinstance(item, dict) and item.get("type") == IMAGE_TOOL_TYPE + "_call"
    ]
    for item in image_items:
        result = item.get("result")
        if not isinstance(result, str) or not result:
            continue
        try:
            data = base64.b64decode(result, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise BridgeError("image_generation_invalid_base64", "image_generation_call.result is not valid base64") from exc
        mime_format = item.get("output_format") if isinstance(item.get("output_format"), str) else output_format
        mime = "image/" + ("jpeg" if mime_format == "jpg" else mime_format)
        return {
            "data": data,
            "mime": mime,
            "callId": item.get("id") if isinstance(item.get("id"), str) else None,
            "revisedPrompt": item.get("revised_prompt") if isinstance(item.get("revised_prompt"), str) else None,
            "imageItemCount": len(image_items),
            "imageItemTypes": [item.get("type") for item in image_items],
            "rawImageItemTypes": raw_item_types,
        }
    raise BridgeError("image_generation_missing", "response did not contain a completed image_generation_call result")


def _sha256_json(payload: Mapping[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hmac.new(b"tzudong:imagegen:v1", canonical.encode("utf-8"), hashlib.sha256).hexdigest()  # lgtm[py/weak-sensitive-data-hashing]


def _redacted_raw_response(raw_response: Mapping[str, Any]) -> Dict[str, Any]:
    redacted = dict(raw_response)
    output = []
    for item in raw_response.get("output", []) if isinstance(raw_response.get("output"), list) else []:
        if not isinstance(item, dict):
            continue
        copy = dict(item)
        if isinstance(copy.get("result"), str):
            copy["result"] = "<base64 image redacted>"
        output.append(copy)
    redacted["output"] = output
    redacted.pop("_events", None)
    return redacted


def _generate(payload: Mapping[str, Any]) -> Dict[str, Any]:
    prompt = _optional_str(payload.get("prompt"))
    if not prompt:
        raise BridgeError("invalid_payload", "prompt is required")
    output_path_value = _optional_str(payload.get("outputPath"))
    if not output_path_value:
        raise BridgeError("invalid_payload", "outputPath is required")
    output_path = Path(output_path_value).expanduser().resolve()

    agent_model = _optional_str(payload.get("agentModel")) or os.environ.get("CODEX_IMAGEGEN_AGENT_MODEL") or AGENT_MODEL_DEFAULT
    size = _optional_str(payload.get("size")) or DEFAULT_SIZE
    output_format = _optional_str(payload.get("outputFormat")) or DEFAULT_FORMAT
    background = _optional_str(payload.get("background")) or DEFAULT_BACKGROUND
    reasoning_effort = _optional_str(payload.get("reasoningEffort")) or os.environ.get("CODEX_IMAGEGEN_AGENT_EFFORT") or DEFAULT_REASONING_EFFORT
    instructions = _optional_str(payload.get("instructions")) or os.environ.get("CODEX_IMAGEGEN_INSTRUCTIONS") or DEFAULT_INSTRUCTIONS
    timeout = int(payload.get("timeout") if isinstance(payload.get("timeout"), int) else 300)
    auth_file = _optional_str(payload.get("authFile")) or os.environ.get("CODEX_AUTH_FILE")

    request_payload = _build_payload(
        prompt,
        agent_model=agent_model,
        size=size,
        output_format=output_format,
        background=background,
        reasoning_effort=reasoning_effort,
        instructions=instructions,
    )
    raw_response = _run_oauth_responses(request_payload, timeout=timeout, auth_file=auth_file)
    image = _extract_generated_image(raw_response, output_format)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(image["data"])

    raw_response_path = output_path.with_suffix(".response.redacted.json")
    redacted_response = _redacted_raw_response(raw_response)
    raw_response_path.write_text(json.dumps(redacted_response, ensure_ascii=False, indent=2) + "\n", "utf-8")
    request_hash = _sha256_json({"endpoint": RESPONSES_ENDPOINT, "payload": request_payload})
    response_hash = _sha256_json(redacted_response)

    response_id = raw_response.get("id") if isinstance(raw_response.get("id"), str) else None
    return {
        "ok": True,
        "providerId": PROVIDER_ID,
        "authMode": AUTH_MODE,
        "endpoint": RESPONSES_ENDPOINT,
        "agentModel": agent_model,
        "requestToolType": IMAGE_TOOL_TYPE,
        "requestToolModel": IMAGE_MODEL,
        "model": IMAGE_MODEL,
        "modelProvenance": MODEL_PROVENANCE,
        "responseId": response_id,
        "imageCallId": image["callId"],
        "imageItemCount": image["imageItemCount"],
        "generatedImageItemTypes": image["imageItemTypes"],
        "rawImageItemTypes": image["rawImageItemTypes"],
        "requestHash": request_hash,
        "responseHash": response_hash,
        "mime": image["mime"],
        "bytes": len(image["data"]),
        "outputPath": str(output_path),
        "rawResponsePath": str(raw_response_path),
        "hasOpenAIAPIKey": False,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def _print_json(payload: Mapping[str, Any]) -> None:
    print(json.dumps({"ok": True, "keys": sorted(str(key) for key in payload.keys())}, ensure_ascii=False), flush=True)  # lgtm[py/clear-text-logging-sensitive-data]


def _read_stdin_json() -> Dict[str, Any]:
    try:
        payload = json.loads(os.sys.stdin.read())
    except json.JSONDecodeError as exc:
        raise BridgeError("invalid_payload", "stdin must contain JSON") from exc
    if not isinstance(payload, dict):
        raise BridgeError("invalid_payload", "stdin JSON must be an object")
    return payload


def _prove(args: argparse.Namespace) -> Dict[str, Any]:
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    proof = _generate(
        {
            "prompt": args.prompt,
            "outputPath": str(output_dir / "proof.png"),
            "agentModel": args.agent_model,
            "size": args.size,
            "outputFormat": "png",
            "background": DEFAULT_BACKGROUND,
            "reasoningEffort": args.reasoning_effort,
            "timeout": args.timeout,
            "authFile": args.auth_file,
        }
    )
    if args.proof_file:
        _write_json_file(Path(args.proof_file).expanduser().resolve(), proof)
    return proof


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Codex OAuth gpt-image-2 storyboard provider")
    parser.add_argument("--prove", action="store_true", help="generate a small proof image and write provenance")
    parser.add_argument("--proof-file", default="", help="where to write proof provenance JSON")
    parser.add_argument("--output-dir", default=".omx/artifacts/gpt-image-2-provenance/manual-proof", help="proof output directory")
    parser.add_argument("--prompt", default="Create one safe full-bleed single-scene Korean food storyboard cut image: one continuous steaming noodles and chopsticks scene, no internal panels, no blank quadrants, no face, no logo, no readable text.")
    parser.add_argument("--agent-model", default=os.environ.get("CODEX_IMAGEGEN_AGENT_MODEL", AGENT_MODEL_DEFAULT))
    parser.add_argument("--reasoning-effort", default=os.environ.get("CODEX_IMAGEGEN_AGENT_EFFORT", DEFAULT_REASONING_EFFORT))
    parser.add_argument("--size", default=os.environ.get("STORYBOARD_LOCAL_CODEX_IMAGE_SIZE", DEFAULT_SIZE))
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--auth-file", default=os.environ.get("CODEX_AUTH_FILE", ""))
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        result = _prove(args) if args.prove else _generate(_read_stdin_json())
        _print_json(result)
        return 0
    except BridgeError as exc:
        _print_json(
            {
                "ok": False,
                "providerId": PROVIDER_ID,
                "authMode": AUTH_MODE,
                "requestToolType": IMAGE_TOOL_TYPE,
                "requestToolModel": IMAGE_MODEL,
                "model": IMAGE_MODEL,
                "modelProvenance": "unverified",
                "code": exc.code,
                "error": str(exc),
                "status": exc.status,
                "hasOpenAIAPIKey": False,
            }
        )
        return 1
    except Exception as exc:  # pragma: no cover - last-resort CLI guard
        _print_json(
            {
                "ok": False,
                "providerId": PROVIDER_ID,
                "authMode": AUTH_MODE,
                "requestToolType": IMAGE_TOOL_TYPE,
                "requestToolModel": IMAGE_MODEL,
                "model": IMAGE_MODEL,
                "modelProvenance": "unverified",
                "code": "unexpected_bridge_error",
                "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
                "hasOpenAIAPIKey": False,
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
