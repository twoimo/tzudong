"""One-shot, hash-bound provider acceptance probe.

The exact historical input is recovered in memory from its existing journal
record and checked by hash. Raw input, response, headers, credentials, generated
text, and response identifiers are never written or returned.
"""
from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path("/Users/twoimo/.codex/worktrees/pipeline-continuity-20261009/tzudong")
RUN = ROOT / "apps/web/performance/continuity-recovery-20261009/gemini-schema/wire-schema-acceptance-20261009"
ADMISSION = RUN / "root-admission.json"
DISPATCH = RUN / "dispatch-journal.json"
PROOF = RUN / "proof.json"
WIRE = ROOT / "apps/web/performance/continuity-recovery-20261009/gemini-schema/local-contract-proposal/wire-schema.json"
SOURCE_MAP = ROOT / "apps/web/performance/continuity-recovery-20261009/gemini-schema/local-contract-proposal/implementation-artifact-map.json"
SANITIZER = ROOT / "apps/web/performance/continuity-recovery-20261009/gemini-schema/diagnostic-probe-proposal-20261009/sanitizer.py"
OLD_JOURNAL = Path("/Users/twoimo/.codex/sessions/2026/10/09/rollout-2026-10-09T15-36-35-01a11f60-bb0a-75e2-b508-35ca576d4e51.jsonl")
VAULT_ENV = Path("/Users/twoimo/Documents/projects/tzudong/backend/.env")
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
MODEL = "gemini-3.8-flash"
PROMPT_SHA = "81377b15578f67767fab3a8b4a72cede12c75a83544f103109ca4b437a4f671b"
PAYLOAD_SHA = "1bb888763dc647849967c89dc5eca5dcfec912245aa48e6246307f1cf5fba4a2"
SCHEMA_SHA = "e3f27356cdb188197c709fb607446f606fc250f60ef84bd7bd89062c2e71c360"
SOURCE_MAP_SHA = "3fa68ad4077577758f8a712116f4e1969366546ff991d594d1c92f7b6b695aea"
MAX_BODY = 64 * 1024
USAGE = {
    "total_input_tokens": "inputTokens",
    "total_output_tokens": "outputTokens",
    "total_thought_tokens": "thinkingTokens",
    "total_cached_tokens": "cachedTokens",
    "total_tool_use_tokens": "toolTokens",
    "total_tokens": "totalTokens",
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def atomic_create(path, value):
    data = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).encode() + b"\n"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def recover_prompt():
    record = json.loads(OLD_JOURNAL.read_text().splitlines()[1087])
    source = record["payload"]["input"]
    tick = chr(96)
    match = re.search(r"cmd\s*:\s*" + tick, source)
    if match is None:
        raise ValueError
    command = source[match.end():source.find(tick, match.end())]
    body = command.split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    tree = ast.parse(body)
    values = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "PROMPT" for target in node.targets):
            values.append(ast.literal_eval(node.value))
    if len(values) != 1 or not isinstance(values[0], str):
        raise ValueError
    prompt = values[0]
    if hashlib.sha256(prompt.encode()).hexdigest() != PROMPT_SHA:
        raise ValueError
    return prompt


def read_key():
    found = None
    with VAULT_ENV.open(encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            if "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() != "GEMINI_API_KEY":
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            found = value
    if not found or any(char in found for char in "\r\n"):
        raise ValueError
    return found


def wire_valid(value):
    return (
        isinstance(value, dict)
        and set(value) == {"schemaVersion", "videoId", "coverage", "summary", "restaurants", "claims", "uncertainty"}
        and type(value["schemaVersion"]) is int
        and isinstance(value["videoId"], str)
        and isinstance(value["coverage"], dict)
        and isinstance(value["summary"], list)
        and isinstance(value["restaurants"], list)
        and isinstance(value["claims"], list)
        and isinstance(value["uncertainty"], list)
    )


fixed_unknown = {
    "terminalResponse": False,
    "httpStatus": None,
    "officialCode": None,
    "category": "unknown",
    "schemaPath": None,
    "schemaPathSource": None,
    "schemaKeyword": None,
    "payloadSha256": PAYLOAD_SHA,
    "schemaSha256": SCHEMA_SHA,
}
result = dict(fixed_unknown)
lease = None
budget = None
raw_body = None
generated = None
key = None
dispatched = False
started = None
try:
    if DISPATCH.exists() or PROOF.exists():
        raise FileExistsError
    admission = json.loads(ADMISSION.read_text())
    source_map = json.loads(SOURCE_MAP.read_text())
    harness_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if (
        admission.get("admission") != "admitted"
        or admission.get("executionAuthorized") is not True
        or admission.get("request", {}).get("payloadSha256") != PAYLOAD_SHA
        or admission.get("request", {}).get("promptSha256") != PROMPT_SHA
        or admission.get("schema", {}).get("sha256") != SCHEMA_SHA
        or admission.get("continuity", {}).get("priorExactProbeEvidenceCount") != 0
        or admission.get("continuity", {}).get("fixedImplementationArtifactsMatched") is not True
        or admission.get("continuity", {}).get("probeHarnessSha256") != harness_sha
        or hashlib.sha256(SOURCE_MAP.read_bytes()).hexdigest() != SOURCE_MAP_SHA
    ):
        raise ValueError
    for entry in source_map["artifacts"]:
        path = ROOT / entry["path"]
        if path.stat().st_size != entry["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError

    prompt = recover_prompt()
    wire = json.loads(WIRE.read_text())
    payload = {
        "model": MODEL,
        "input": [{"type": "text", "text": prompt}],
        "response_format": {"type": "text", "mime_type": "application/json", "schema": wire},
        "generation_config": {"max_output_tokens": 65536},
        "store": False,
    }
    payload_bytes = canonical(payload)
    if (
        len(canonical(wire)) != 365
        or hashlib.sha256(canonical(wire)).hexdigest() != SCHEMA_SHA
        or len(payload_bytes) != 914
        or hashlib.sha256(payload_bytes).hexdigest() != PAYLOAD_SHA
    ):
        raise ValueError

    sanitizer_spec = importlib.util.spec_from_file_location("wire_acceptance_sanitizer", SANITIZER)
    sanitizer = importlib.util.module_from_spec(sanitizer_spec)
    sanitizer_spec.loader.exec_module(sanitizer)

    sys.path.insert(0, str(ROOT))
    from backend.utils.provider_budget import ProjectBudget, budget_path
    from backend.knowledge_graph import claude_video_adapter as adapter
    from backend.knowledge_graph import longform_analysis as analysis

    key = read_key()
    budget = ProjectBudget(
        budget_path(),
        os.getenv("GEMINI_BUDGET_PROJECT", "configured-project"),
        rpm=1,
        concurrency=1,
    )
    lease = budget.acquire(os.getpid(), timeout=120)

    dispatch = {
        "dispatchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": MODEL,
        "payloadSha256": PAYLOAD_SHA,
        "schemaSha256": SCHEMA_SHA,
        "providerPostOrdinal": 1,
        "retries": 0,
        "readbacks": 0,
        "redirects": 0,
        "hasVideo": False,
    }
    atomic_create(DISPATCH, dispatch)
    dispatched = True

    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    request = Request(
        ENDPOINT,
        data=payload_bytes,
        method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    started = time.monotonic()
    try:
        with build_opener(NoRedirect).open(request, timeout=120) as response:
            status = int(response.status)
            raw_body = response.read(MAX_BODY + 1)
        elapsed = round(time.monotonic() - started, 6)
        success = {
            "terminalResponse": True,
            "httpStatus": status if 100 <= status <= 599 else None,
            "completed": False,
            "modelMatch": False,
            "schemaValidation": False,
            "wireSchemaValidation": False,
            "originalSchemaConstraintPass": False,
            "fullValidatorPass": False,
            "expectedVideoId": False,
            "usage": {label: None for label in USAGE.values()},
            "usageTotalMatchesParts": None,
            "elapsedSeconds": elapsed,
            "responseDtoSha256": None,
            "payloadSha256": PAYLOAD_SHA,
            "schemaSha256": SCHEMA_SHA,
        }
        if status == 200 and len(raw_body) <= MAX_BODY:
            try:
                data = json.loads(raw_body)
                if not isinstance(data, dict):
                    raise ValueError
                success["completed"] = data.get("status") == "completed"
                success["modelMatch"] = data.get("model") in (MODEL, "models/" + MODEL)
                usage = data.get("usage")
                if usage is not None and not isinstance(usage, dict):
                    raise ValueError
                if isinstance(usage, dict):
                    for provider_name, output_name in USAGE.items():
                        if provider_name in usage:
                            count = usage[provider_name]
                            if type(count) is not int or not 0 <= count < 10 ** 12:
                                raise ValueError
                            success["usage"][output_name] = count
                    total = success["usage"]["totalTokens"]
                    if total is not None:
                        parts_total = sum(success["usage"][name] or 0 for name in
                                          ("inputTokens", "outputTokens", "thinkingTokens", "cachedTokens", "toolTokens"))
                        success["usageTotalMatchesParts"] = total == parts_total
                parts = [
                    part["text"]
                    for step in data.get("steps", [])
                    if isinstance(step, dict) and step.get("type") == "model_output"
                    for part in step.get("content", [])
                    if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str)
                ]
                if parts:
                    generated = json.loads("\n".join(parts))
                    success["wireSchemaValidation"] = wire_valid(generated)
                    success["schemaValidation"] = success["wireSchemaValidation"]
                    success["expectedVideoId"] = isinstance(generated, dict) and generated.get("videoId") == "-D43ezc57z8"
                    success["responseDtoSha256"] = hashlib.sha256(canonical(generated)).hexdigest()
                    try:
                        verifier_spec = importlib.util.spec_from_file_location(
                            "wire_acceptance_equivalence",
                            ROOT / "apps/web/performance/continuity-recovery-20261009/gemini-schema/local-contract-proposal/verify_equivalence.py",
                        )
                        verifier = importlib.util.module_from_spec(verifier_spec)
                        verifier_spec.loader.exec_module(verifier)
                        success["originalSchemaConstraintPass"] = bool(
                            verifier.ajv_results(adapter.schema("-D43ezc57z8", 0, 835), [generated])[0]
                        )
                    except Exception:
                        success["originalSchemaConstraintPass"] = False
                    try:
                        analysis.validate_analysis(
                            generated,
                            {
                                "videoId": "-D43ezc57z8",
                                "durationSeconds": 835,
                                "segmentStartSeconds": 0,
                                "segmentEndSeconds": 835,
                            },
                        )
                        success["fullValidatorPass"] = True
                    except analysis.AnalysisError:
                        success["fullValidatorPass"] = False
                del parts, data
            except (UnicodeError, ValueError, TypeError, KeyError, RecursionError):
                pass
        result = success
    except HTTPError as exc:
        status = int(exc.code) if type(exc.code) is int else None
        raw_body = exc.read(MAX_BODY + 1)
        exc.close()
        elapsed = round(time.monotonic() - started, 6)
        result = {
            "terminalResponse": True,
            **sanitizer.sanitize_error(status, raw_body, wire),
            "elapsedSeconds": elapsed,
            "payloadSha256": PAYLOAD_SHA,
            "schemaSha256": SCHEMA_SHA,
        }
    except (URLError, TimeoutError, OSError):
        elapsed = round(time.monotonic() - started, 6)
        result = {**fixed_unknown, "elapsedSeconds": elapsed}
except FileExistsError:
    result = {**fixed_unknown, "category": "duplicate_prevented"}
except Exception:
    result = dict(fixed_unknown)
finally:
    if lease is not None and budget is not None:
        try:
            budget.release(lease)
        except Exception:
            pass
    if generated is not None:
        del generated
    if raw_body is not None:
        del raw_body
    if key is not None:
        del key

if dispatched:
    atomic_create(PROOF, result)
print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
