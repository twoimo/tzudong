"""Provider implementations for peak-frame visual captioning.

The default provider remains `llava_next_video` so existing offline behavior is
preserved. OpenAI/Codex providers are opt-in and fail closed when credentials or
local trust flags are missing.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

DEFAULT_LLAVA_MODEL = "llava-hf/LLaVA-NeXT-Video-7B-hf"
DEFAULT_OPENAI_VISION_MODEL = "gpt-5.5"
DEFAULT_CODEX_VISION_MODEL = "gpt-5.5"
DEFAULT_PROMPT = "이 장면의 촬영 구도와 상황(누가, 무엇을, 어떻게)을 한국어로 자세하게 설명해주세요."
PROVIDER_ENV = "STORYBOARD_CAPTION_PROVIDER"
DISABLE_REMOTE_ENV = "STORYBOARD_CAPTION_DISABLE_REMOTE"
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"
CODEX_LOCAL_FLAG_ENV = "STORYBOARD_CAPTION_ALLOW_CODEX_CLI"
TRUSTED_LOCAL_FLAG_ENV = "STORYBOARD_CAPTION_TRUSTED_LOCAL"
MAX_FRAMES_ENV = "STORYBOARD_CAPTION_MAX_FRAMES"
MAX_IMAGE_BYTES_ENV = "STORYBOARD_CAPTION_MAX_IMAGE_BYTES"
TIMEOUT_ENV = "STORYBOARD_CAPTION_TIMEOUT_SECONDS"

_PROVIDER_IDS = {"llava_next_video", "openai_vision_gpt55", "codex_cli_vision_gpt55"}
_SECRET_PATTERNS = [
    re.compile(r"sk-proj-[A-Za-z0-9_-]{12,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"eyJ[A-Za-z0-9_.-]{20,}"),
    re.compile(r"(?i)(OPENAI[_A-Z]*|SERVICE[_A-Z]*|SUPABASE[_A-Z]*|API[_A-Z]*KEY|TOKEN|SECRET)\s*[:=]\s*[^\s,;{}]+"),
    re.compile(r"(?i)(?:^|[/\\])auth\.json"),
]
_CODEX_CHILD_ENV_ALLOWLIST = {
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "COLORTERM",
    "NO_COLOR",
    "FORCE_COLOR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
}


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _redact(value: Any) -> str:
    text = str(value or "")
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="ignore")).hexdigest()[:16]


def _hash_file_name(path: str | Path) -> str:
    p = Path(path)
    return _hash_text(p.name)


def _clamp_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(float(os.environ.get(name, "")))
    except Exception:
        return default
    return max(minimum, min(maximum, parsed))


def _timeout() -> float:
    try:
        parsed = float(os.environ.get(TIMEOUT_ENV, ""))
    except Exception:
        parsed = 120.0
    return max(5.0, min(600.0, parsed))


@dataclass(frozen=True)
class CaptionRequest:
    video_id: str
    recollect_id: int
    rank: int
    start_sec: int
    end_sec: int
    duration: int | None
    frame_paths: list[str]
    prompt: str = DEFAULT_PROMPT
    locale: str = "ko-KR"


@dataclass
class CaptionResult:
    video_id: str
    recollect_id: int
    start_sec: int
    end_sec: int
    duration: int | None
    rank: int
    raw_caption: str
    chronological_analysis: str
    highlight_keywords: list[str]
    caption_provider: str
    caption_model: str
    caption_auth_mode: str
    caption_generated_at: str
    caption_schema_version: int = 2
    caption_provenance: dict[str, Any] = field(default_factory=dict)

    def to_jsonl_record(self) -> dict[str, Any]:
        parsed_json = {
            "chronological_analysis": self.chronological_analysis,
            "highlight_keywords": self.highlight_keywords,
        }
        return {
            "video_id": self.video_id,
            "recollect_id": self.recollect_id,
            "start_sec": self.start_sec,
            "end_sec": self.end_sec,
            "duration": self.duration,
            "rank": self.rank,
            "caption": self.raw_caption,
            "parsed_json": parsed_json,
            "raw_caption": self.raw_caption,
            "caption_provider": self.caption_provider,
            "caption_model": self.caption_model,
            "caption_auth_mode": self.caption_auth_mode,
            "caption_provenance": self.caption_provenance,
            "caption_generated_at": self.caption_generated_at,
            "caption_schema_version": self.caption_schema_version,
        }


class CaptionProviderError(RuntimeError):
    """Caption provider failed after being selected."""


class CaptionProviderUnavailable(CaptionProviderError):
    """Caption provider cannot run because required auth/local trust is absent."""


class CaptionProvider(Protocol):
    provider_id: str
    model: str
    auth_mode: str

    def generate(self, request: CaptionRequest) -> CaptionResult:
        ...


def resolve_provider_id(env: dict[str, str] | None = None) -> str:
    source = env if env is not None else os.environ
    if _truthy(source.get(DISABLE_REMOTE_ENV)):
        return "llava_next_video"
    provider = (source.get(PROVIDER_ENV) or "llava_next_video").strip()
    if provider not in _PROVIDER_IDS:
        raise CaptionProviderUnavailable(f"unsupported_caption_provider={provider}")
    return provider


def _select_frames(frame_paths: list[str]) -> tuple[list[str], int, list[str]]:
    max_frames = _clamp_int_env(MAX_FRAMES_ENV, 12, 1, 48)
    max_bytes = _clamp_int_env(MAX_IMAGE_BYTES_ENV, 4_000_000, 64_000, 20_000_000)
    selected: list[str] = []
    skipped = 0
    for raw in frame_paths:
        if len(selected) >= max_frames:
            skipped += 1
            continue
        path = Path(raw)
        try:
            if path.stat().st_size > max_bytes:
                skipped += 1
                continue
        except OSError:
            skipped += 1
            continue
        selected.append(str(path))
    return selected, skipped, [_hash_file_name(p) for p in selected]


def _base_provenance(request: CaptionRequest, provider_id: str, model: str, auth_mode: str, started: float) -> dict[str, Any]:
    selected, truncated, hashes = _select_frames(request.frame_paths)
    return {
        "providerId": provider_id,
        "model": model,
        "authMode": auth_mode,
        "schemaVersion": 2,
        "requestHash": _hash_text(json.dumps({
            "video_id": request.video_id,
            "recollect_id": request.recollect_id,
            "rank": request.rank,
            "start_sec": request.start_sec,
            "end_sec": request.end_sec,
            "frame_hashes": hashes,
            "prompt_hash": _hash_text(request.prompt),
        }, sort_keys=True, ensure_ascii=False)),
        "frameCount": len(selected),
        "truncatedFrames": truncated,
        "fileNameHashes": hashes,
        "latencyMs": int((time.monotonic() - started) * 1000),
    }


def _parse_caption_json(raw: str) -> tuple[str, list[str], str]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("caption JSON must be an object")
        analysis = str(data.get("chronological_analysis") or data.get("analysis") or "").strip()
        keywords_raw = data.get("highlight_keywords") or data.get("keywords") or []
        keywords = [str(item).strip()[:80] for item in keywords_raw if str(item).strip()] if isinstance(keywords_raw, list) else []
        if not analysis:
            raise ValueError("chronological_analysis is required")
        return analysis, keywords[:20], "strict_json"
    except Exception:
        return text[:4000], [], "caption_parse_fallback"


class OpenAIVisionProvider:
    provider_id = "openai_vision_gpt55"
    auth_mode = "platform_api_key"

    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("STORYBOARD_CAPTION_OPENAI_MODEL", DEFAULT_OPENAI_VISION_MODEL)

    def generate(self, request: CaptionRequest) -> CaptionResult:
        if not os.environ.get(OPENAI_API_KEY_ENV):
            raise CaptionProviderUnavailable("openai_vision_gpt55 requires OPENAI_API_KEY")
        selected, truncated, _ = _select_frames(request.frame_paths)
        if not selected:
            raise CaptionProviderUnavailable("no readable frame images for OpenAI vision captioning")
        started = time.monotonic()
        try:
            from openai import OpenAI  # type: ignore
        except Exception as exc:  # pragma: no cover - environment-specific
            raise CaptionProviderUnavailable(f"openai python package unavailable: {_redact(exc)}") from exc

        content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": (
                    "Return only JSON with keys chronological_analysis:string and highlight_keywords:string[]. "
                    f"Locale: {request.locale}. Task: {request.prompt}"
                ),
            }
        ]
        for frame in selected:
            encoded = base64.b64encode(Path(frame).read_bytes()).decode("ascii")
            content.append({"type": "input_image", "image_url": f"data:image/jpeg;base64,{encoded}"})
        try:
            client = OpenAI()
            response = client.responses.create(
                model=self.model,
                input=[{"role": "user", "content": content}],
                max_output_tokens=_clamp_int_env("STORYBOARD_CAPTION_MAX_OUTPUT_TOKENS", 600, 128, 2000),
                timeout=_timeout(),
            )
            raw = getattr(response, "output_text", "") or str(response)
            response_id = getattr(response, "id", None)
        except Exception as exc:  # pragma: no cover - live API only
            raise CaptionProviderError(f"openai_vision_failed: {_redact(exc)}") from exc
        analysis, keywords, parser_status = _parse_caption_json(raw)
        provenance = _base_provenance(request, self.provider_id, self.model, self.auth_mode, started)
        provenance.update({"parserStatus": parser_status, "responseId": response_id, "truncatedFrames": truncated})
        return _result_from_parts(request, raw, analysis, keywords, self.provider_id, self.model, self.auth_mode, provenance)


class CodexCliVisionProvider:
    provider_id = "codex_cli_vision_gpt55"
    auth_mode = "codex_cli_oauth_local"

    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("STORYBOARD_CAPTION_CODEX_MODEL", DEFAULT_CODEX_VISION_MODEL)
        self.codex_bin = os.environ.get("STORYBOARD_CAPTION_CODEX_BIN", "codex")

    def _require_local_trust(self) -> None:
        if not (_truthy(os.environ.get(CODEX_LOCAL_FLAG_ENV)) or _truthy(os.environ.get(TRUSTED_LOCAL_FLAG_ENV))):
            raise CaptionProviderUnavailable("codex_cli_vision_gpt55 requires trusted local flag")
        try:
            status = subprocess.run(
                [self.codex_bin, "login", "status"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=min(_timeout(), 20.0),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise CaptionProviderUnavailable(f"codex login status unavailable: {_redact(exc)}") from exc
        if status.returncode != 0:
            raise CaptionProviderUnavailable(f"codex login status failed: {_redact(status.stderr or status.stdout)}")

    def generate(self, request: CaptionRequest) -> CaptionResult:
        self._require_local_trust()
        selected, truncated, _ = _select_frames(request.frame_paths)
        if not selected:
            raise CaptionProviderUnavailable("no readable frame images for Codex CLI vision captioning")
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="storyboard-caption-codex-") as tmp:
            answer_path = Path(tmp) / "answer.txt"
            prompt = "\n".join([
                "You are captioning YouTube peak-scene frames for storyboard planning.",
                "Inspect the listed local image files and return ONLY JSON with chronological_analysis:string and highlight_keywords:string[].",
                f"Task: {request.prompt}",
                "Frame files:",
                *[str(Path(p).resolve()) for p in selected],
            ])
            command = [
                self.codex_bin,
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--model",
                self.model,
                "--output-last-message",
                str(answer_path),
                prompt,
            ]
            completed = subprocess.run(
                command,
                text=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=_timeout(),
                check=False,
                env=_codex_child_env(),
            )
            if completed.returncode != 0:
                raise CaptionProviderError(f"codex_cli_vision_failed: {_redact(completed.stderr or completed.stdout)}")
            raw = answer_path.read_text(encoding="utf-8", errors="ignore") if answer_path.exists() else completed.stdout
        analysis, keywords, parser_status = _parse_caption_json(raw)
        provenance = _base_provenance(request, self.provider_id, self.model, self.auth_mode, started)
        provenance.update({"parserStatus": parser_status, "truncatedFrames": truncated})
        return _result_from_parts(request, raw, analysis, keywords, self.provider_id, self.model, self.auth_mode, provenance)


def _codex_child_env() -> dict[str, str]:
    """Return a minimal env for nested Codex captioning.

    OAuth credentials are discovered by the Codex CLI from its normal config
    files (for example under HOME/CODEX_HOME). Service-role keys, API keys,
    DB URLs, and other ambient app secrets must not be inherited by the child
    process.
    """
    return {
        key: value
        for key, value in os.environ.items()
        if key in _CODEX_CHILD_ENV_ALLOWLIST or key.startswith("LC_")
    }


class LlavaNextVideoProvider:
    provider_id = "llava_next_video"
    auth_mode = "offline_local"

    def __init__(self, model: str | None = None, device: str | None = None):
        self.model = model or os.environ.get("STORYBOARD_CAPTION_LLAVA_MODEL", DEFAULT_LLAVA_MODEL)
        self.device = device
        self._model: Any | None = None
        self._processor: Any | None = None

    def _load(self) -> tuple[Any, Any]:
        # Heavy imports stay inside this method by design.
        import torch  # type: ignore
        from transformers import LlavaNextVideoForConditionalGeneration, LlavaNextVideoProcessor  # type: ignore

        device = self.device
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        processor = LlavaNextVideoProcessor.from_pretrained(self.model)
        if device == "cuda":
            model = LlavaNextVideoForConditionalGeneration.from_pretrained(
                self.model, torch_dtype=torch.float16, device_map="auto"
            )
        elif device == "mps":
            model = LlavaNextVideoForConditionalGeneration.from_pretrained(
                self.model, torch_dtype=torch.float16, low_cpu_mem_usage=True
            ).to(device)
        else:
            model = LlavaNextVideoForConditionalGeneration.from_pretrained(
                self.model, torch_dtype=torch.float32, low_cpu_mem_usage=True
            )
        return model, processor

    def generate(self, request: CaptionRequest) -> CaptionResult:
        started = time.monotonic()
        if self._model is None or self._processor is None:
            self._model, self._processor = self._load()
        # Reuse the legacy frame loading/generation shape without importing PIL at package import time.
        import torch  # type: ignore
        from PIL import Image  # type: ignore

        selected, truncated, _ = _select_frames(request.frame_paths)
        frames = [Image.open(path).convert("RGB") for path in selected]
        if not frames:
            raise CaptionProviderUnavailable("no readable frame images for LLaVA captioning")
        conversation = [{"role": "user", "content": [{"type": "video"}, {"type": "text", "text": request.prompt}]}]
        formatted_prompt = self._processor.apply_chat_template(conversation, add_generation_prompt=True)
        dtype = torch.float16 if str(getattr(self._model, "device", "")) != "cpu" else torch.float32
        inputs = self._processor(text=formatted_prompt, videos=[frames], return_tensors="pt", padding=True).to(self._model.device, dtype=dtype)
        with torch.no_grad():
            output_ids = self._model.generate(**inputs, max_new_tokens=256, do_sample=True, temperature=0.7)
        raw = self._processor.batch_decode(output_ids, skip_special_tokens=True, clean_up_tokenization_spaces=True)[0].strip()
        analysis, keywords, parser_status = _parse_caption_json(raw)
        provenance = _base_provenance(request, self.provider_id, self.model, self.auth_mode, started)
        provenance.update({"parserStatus": parser_status, "truncatedFrames": truncated})
        return _result_from_parts(request, raw, analysis, keywords, self.provider_id, self.model, self.auth_mode, provenance)


def _result_from_parts(
    request: CaptionRequest,
    raw: str,
    analysis: str,
    keywords: list[str],
    provider_id: str,
    model: str,
    auth_mode: str,
    provenance: dict[str, Any],
) -> CaptionResult:
    return CaptionResult(
        video_id=request.video_id,
        recollect_id=request.recollect_id,
        start_sec=request.start_sec,
        end_sec=request.end_sec,
        duration=request.duration,
        rank=request.rank,
        raw_caption=raw,
        chronological_analysis=analysis,
        highlight_keywords=keywords,
        caption_provider=provider_id,
        caption_model=model,
        caption_auth_mode=auth_mode,
        caption_generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        caption_provenance=provenance,
    )


def get_provider(provider_id: str | None = None, *, device: str | None = None) -> CaptionProvider:
    resolved = provider_id or resolve_provider_id()
    if resolved == "openai_vision_gpt55":
        return OpenAIVisionProvider()
    if resolved == "codex_cli_vision_gpt55":
        return CodexCliVisionProvider()
    if resolved == "llava_next_video":
        return LlavaNextVideoProvider(device=device)
    raise CaptionProviderUnavailable(f"unsupported_caption_provider={resolved}")
