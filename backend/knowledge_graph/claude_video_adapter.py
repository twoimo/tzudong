"""Project-owned boundary around the pinned claude-video Gemini engine.

Upstream ``gemini.ask`` still builds and submits the video request. This adapter
adds the documented JSON response format, counts the same clipped input first,
and observes the response before upstream's text formatter discards metadata.
No upstream files, provider defaults, credentials or raw responses are persisted.
"""
from __future__ import annotations

import builtins
import hashlib
import json
import os
from pathlib import Path
import re
import types
from urllib.error import HTTPError

API = "https://generativelanguage.googleapis.com/v1beta"
ID = re.compile(r"[A-Za-z0-9_-]{8,512}\Z")
MAX_RESPONSE_BYTES = 1024 * 1024
USAGE_KEYS = {"total_input_tokens": "inputTokens", "total_output_tokens": "outputTokens",
              "total_thought_tokens": "thinkingTokens", "total_cached_tokens": "cachedTokens",
              "total_tool_use_tokens": "toolTokens", "total_tokens": "totalTokens"}


class AdapterError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def usage(value):
    """Validate counters independently; never copy arbitrary provider fields."""
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise AdapterError("WATCH_USAGE_INVALID")
    result = {label: None for label in USAGE_KEYS.values()}
    for key, label in USAGE_KEYS.items():
        if key in value:
            count = value[key]
            if type(count) is not int or not 0 <= count < 10 ** 12:
                raise AdapterError("WATCH_USAGE_INVALID")
            result[label] = count
    total = result["totalTokens"]
    if total is not None and any(count > total for count in result.values() if count is not None):
        raise AdapterError("WATCH_USAGE_INVALID")
    if total is not None and sum(result[key] or 0 for key in ("inputTokens", "outputTokens", "thinkingTokens")) > total:
        raise AdapterError("WATCH_USAGE_INVALID")
    return {**result, "rawUsageFields": {key: result[label] for key, label in USAGE_KEYS.items() if result[label] is not None},
            "usageCompleteness": "complete" if all(result[key] is not None for key in ("inputTokens", "outputTokens", "thinkingTokens", "totalTokens"))
            else "partial" if any(count is not None for count in result.values()) else "unavailable",
            "costVerified": False, "cost": None}


def schema(video_id, start, end):
    def obj(properties):
        return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}

    def array(items, maximum):
        return {"type": "array", "items": items, "maxItems": maximum}

    strings = array({"type": "string"}, 50)
    seconds = {"type": "number", "minimum": start, "maximum": end,
               "description": "Numeric seconds from the beginning of the ORIGINAL video, not the clip; never MM:SS text."}
    evidence = array(obj({"startSeconds": seconds, "endSeconds": seconds,
                          "modality": {"type": "string", "enum": ["audio", "visual", "both"]}}), 100)
    confidence = {"type": "number", "minimum": 0, "maximum": 1}
    facts = array(obj({"text": {"type": "string"}, "kind": {"type": "string", "enum": ["spoken", "visual", "inference"]},
                       "evidence": evidence, "confidence": confidence, "uncertainty": strings}), 100)
    return obj({"schemaVersion": {"type": "integer", "enum": [1]}, "videoId": {"type": "string", "enum": [video_id]},
                "coverage": obj({"startSeconds": {"type": "number", "enum": [start]},
                                 "endSeconds": {"type": "number", "enum": [end]},
                                 "complete": {"type": "boolean"}, "limitations": strings}),
                "summary": facts, "restaurants": array(obj({"name": {"type": "string"}, "evidence": evidence,
                         "confidence": confidence, "uncertainty": strings, "menus": facts, "claims": facts}), 100),
                "claims": facts, "uncertainty": strings})


def load_engine(checkout):
    """Execute exact installed bytes in private modules, without bytecode writes."""
    scripts = Path(checkout) / "skills/watch/scripts"
    runtime = types.ModuleType("tzudong_pinned_watch_runtime")
    runtime.__file__ = str(scripts / "runtime.py")
    exec(compile((scripts / "runtime.py").read_bytes(), runtime.__file__, "exec"), runtime.__dict__)
    engine = types.ModuleType("tzudong_pinned_watch_gemini")
    engine.__file__ = str(scripts / "gemini.py")
    original_import = builtins.__import__

    def scoped_import(name, *args, **kwargs):
        return runtime if name == "runtime" else original_import(name, *args, **kwargs)

    engine.__dict__["__builtins__"] = {**vars(builtins), "__import__": scoped_import}
    exec(compile((scripts / "gemini.py").read_bytes(), engine.__file__, "exec"), engine.__dict__)
    return engine


def request_payload(engine, model, video_id, start, end, prompt, output_limit):
    # The exact prompt passed by upstream ask is checked before dispatch.
    processing, _ = engine._processing((start, end))
    # Preserve fractional source boundaries; upstream rounds clip offsets.
    processing.update(start_offset=f"{start:g}s", end_offset=f"{end:g}s")
    return {"model": model, "input": [{"type": "video", "uri": f"https://www.youtube.com/watch?v={video_id}", "processing": processing},
                                       {"type": "text", "text": engine.build_prompt(prompt)}],
            "response_format": {"type": "text", "mime_type": "application/json", "schema": schema(video_id, start, end)},
            "generation_config": {"max_output_tokens": output_limit}}


def count_payload(payload):
    video, text = payload["input"]
    processing = video["processing"]
    return {"generateContentRequest": {"model": "models/" + payload["model"], "contents": [{"role": "user", "parts": [
        {"fileData": {"fileUri": video["uri"], "mimeType": "video/mp4"},
         "videoMetadata": {"startOffset": processing["start_offset"], "endOffset": processing["end_offset"]}},
        {"text": text["text"]}]}], "generationConfig": {"responseMimeType": "application/json",
        "responseJsonSchema": payload["response_format"]["schema"], "maxOutputTokens": payload["generation_config"]["max_output_tokens"]}}}


def observe_response(data, model, observation):
    if not isinstance(data, dict):
        raise AdapterError("WATCH_RESPONSE_INVALID")
    opaque_id = data.get("id")
    if isinstance(opaque_id, str) and ID.fullmatch(opaque_id):
        observation["responseId"] = opaque_id
    observation["usage"] = usage(data.get("usage"))
    if not isinstance(opaque_id, str) or not ID.fullmatch(opaque_id):
        raise AdapterError("WATCH_RESPONSE_ID_REQUIRED")
    if data.get("model") not in (model, "models/" + model):
        raise AdapterError("WATCH_RESPONSE_MODEL_MISMATCH")
    if data.get("status") != "completed":
        raise AdapterError("WATCH_RESPONSE_NOT_COMPLETED")


def invoke(*, checkout, model, video_id, start, end, prompt, input_limit, output_limit,
           timeout, key, budget, observe, response_id=None, request_digest=None, counted_input_tokens=None):
    """One count + one create, or one GET of the original ID. Never retry."""
    engine = load_engine(checkout)
    payload = request_payload(engine, model, video_id, start, end, prompt, output_limit)
    expected_digest = digest(payload)
    if request_digest is not None and request_digest != expected_digest:
        raise AdapterError("WATCH_REQUEST_MISMATCH")
    observation = {"operation": "readback" if response_id else "count", "httpOutcome": "not_sent",
                   "responseId": response_id, "requestSha256": expected_digest, "usage": usage(None), "countedInputTokens": counted_input_tokens}
    if response_id is not None and (not isinstance(response_id, str) or not ID.fullmatch(response_id)):
        raise AdapterError("WATCH_RESPONSE_ID_REQUIRED")
    if counted_input_tokens is not None and (type(counted_input_tokens) is not int or not 0 <= counted_input_tokens <= input_limit):
        raise AdapterError("WATCH_COUNT_INVALID")
    original_call, original_open = engine._call, engine.urlopen
    http_errors = []

    def tracked_open(request, **kwargs):
        try:
            response = original_open(request, **kwargs)
        except HTTPError as error:
            http_errors.append(error)
            observation["httpOutcome"] = "http_rejected" if 400 <= error.code < 500 else "http_server_error"
            observe(dict(observation))
            raise
        observation["httpOutcome"] = "http_success" if 200 <= response.status < 300 else "http_unexpected"
        return response

    engine.urlopen = tracked_open

    def call(method, url, *, data=None, operation):
        observation.update(operation=operation, httpOutcome="not_sent")
        observe(dict(observation))
        lease = budget.acquire(os.getpid(), timeout=60)
        try:
            observation["httpOutcome"] = "transport_uncertain"
            observe(dict(observation))
            _, _, raw = original_call(method, url, key, data=data, headers={"Content-Type": "application/json"}, timeout=timeout)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise AdapterError("WATCH_RESPONSE_INVALID")
            try:
                body = json.loads(raw)
            except (ValueError, UnicodeError):
                raise AdapterError("WATCH_RESPONSE_INVALID") from None
            if operation in ("generate", "readback"):
                if operation == "readback" and (not isinstance(body, dict) or body.get("id") != response_id):
                    raise AdapterError("WATCH_RESPONSE_ID_MISMATCH")
                observe_response(body, model, observation)
                observe(dict(observation))
            return raw, body
        except SystemExit:
            if observation["httpOutcome"] == "http_success":
                observation["httpOutcome"] = "transport_uncertain"
            raise AdapterError("WATCH_HTTP_REJECTED" if observation["httpOutcome"] == "http_rejected" else "WATCH_TRANSPORT_UNCERTAIN") from None
        finally:
            observe(dict(observation))
            for error in http_errors:
                error.close()
            http_errors.clear()
            budget.release(lease)

    if response_id:
        try:
            raw, body = call("GET", API + "/interactions/" + response_id + "?include_input=false", operation="readback")
            observe_response(body, model, observation)
            if body.get("id") != response_id:
                raise AdapterError("WATCH_RESPONSE_ID_MISMATCH")
            parts = [part["text"] for step in body.get("steps", []) if step.get("type") == "model_output"
                     for part in step.get("content", []) if part.get("type") == "text" and isinstance(part.get("text"), str)]
            if not parts:
                raise AdapterError("WATCH_RESPONSE_INVALID")
            return {"text": "\n".join(parts), "observation": observation, "responseSha256": hashlib.sha256(raw).hexdigest()}
        finally:
            observe(dict(observation))

    _, counted = call("POST", API + "/models/" + model + ":countTokens", data=canonical(count_payload(payload)), operation="count")
    count = counted.get("totalTokens") if isinstance(counted, dict) else None
    if type(count) is not int or not 0 <= count < 10 ** 12:
        raise AdapterError("WATCH_COUNT_INVALID")
    observation["countedInputTokens"] = count
    observe(dict(observation))
    if count > input_limit:
        raise AdapterError("WATCH_INPUT_LIMIT_EXCEEDED")
    response_hash = None

    def structured_call(method, url, passed_key, **kwargs):
        nonlocal response_hash
        upstream = json.loads(kwargs["data"])
        if (method != "POST" or url != engine.INTERACTIONS or passed_key != key
                or upstream.get("model") != model or upstream.get("input", [{}])[-1] != payload["input"][-1]):
            raise AdapterError("WATCH_REQUEST_MISMATCH")
        try:
            raw, body = call("POST", url, data=canonical(payload), operation="generate")
            observe_response(body, model, observation)
            response_hash = hashlib.sha256(raw).hexdigest()
            return 200, {}, raw
        finally:
            observe(dict(observation))

    engine._call = structured_call
    try:
        result = engine.ask({"uri": payload["input"][0]["uri"]}, prompt, model=model, key=key, clip=(start, end), timeout=timeout)
    except SystemExit:
        raise AdapterError("WATCH_RESPONSE_INVALID") from None
    return {"text": result["text"], "observation": observation, "responseSha256": response_hash}
