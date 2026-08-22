"""Admitted crawler targets come only from backend/config/channels.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any

CHANNELS_PATH = Path(__file__).resolve().parents[1] / "config" / "channels.yaml"
REQUIRED_FIELDS = (
    "channel_id",
    "handle",
    "name",
    "data_path",
    "evaluation_data_path",
    "enabled",
)
PATH_FIELDS = ("data_path", "evaluation_data_path")
ALLOWED_CAPABILITIES = frozenset({"collect", "evaluate", "insert", "heavy_compute"})


class TargetSchemaError(ValueError):
    def __init__(self, code: str = "target_schema_invalid") -> None:
        super().__init__(code)
        self.code = code


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _parse_scalar(raw: str) -> Any:
    value = _unquote(raw.strip())
    if value == "true":
        return True
    if value == "false":
        return False
    return value


def _parse_channels_document(text: str) -> dict[str, dict[str, Any]]:
    channels: dict[str, dict[str, Any]] = {}
    in_channels = False
    current: str | None = None
    list_key: str | None = None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        line = raw.rstrip()
        if line == "channels:":
            in_channels = True
            current = None
            list_key = None
            continue
        if not in_channels:
            continue
        if line and not line.startswith(" ") and not line.startswith("\t") and line.endswith(":"):
            break
        if line.startswith("  ") and not line.startswith("    ") and line.strip().endswith(":"):
            current = line.strip().rstrip(":")
            if not current or current.startswith("#"):
                raise TargetSchemaError()
            channels[current] = {}
            list_key = None
            continue
        if current is None:
            raise TargetSchemaError()
        stripped = line.strip()
        if stripped.startswith("- "):
            if list_key is None:
                raise TargetSchemaError()
            channels[current].setdefault(list_key, [])
            if not isinstance(channels[current][list_key], list):
                raise TargetSchemaError()
            channels[current][list_key].append(_parse_scalar(stripped[2:]))
            continue
        if ":" not in stripped:
            raise TargetSchemaError()
        key, rest = stripped.split(":", 1)
        key = key.strip()
        rest = rest.strip()
        if not key:
            raise TargetSchemaError()
        if rest == "":
            list_key = key
            channels[current][key] = []
            continue
        list_key = None
        channels[current][key] = _parse_scalar(rest)
    if not channels:
        raise TargetSchemaError()
    return channels


def _validate_channel(channel_id: str, body: dict[str, Any], *, root: Path) -> dict[str, Any]:
    missing = [field for field in REQUIRED_FIELDS if field not in body]
    if missing:
        raise TargetSchemaError()
    if not isinstance(body["enabled"], bool):
        raise TargetSchemaError()
    handle = body["handle"]
    if not isinstance(handle, str) or not handle.startswith("@") or ".." in handle:
        raise TargetSchemaError()
    capabilities = body.get("capabilities", ["collect", "evaluate", "insert", "heavy_compute"])
    if not isinstance(capabilities, list) or not capabilities:
        raise TargetSchemaError()
    if any(item not in ALLOWED_CAPABILITIES for item in capabilities):
        raise TargetSchemaError()
    for field in PATH_FIELDS:
        rel = Path(str(body[field]))
        if rel.is_absolute() or ".." in rel.parts:
            raise TargetSchemaError()
        # Paths are repo-relative under backend/.
        candidate = root / "backend" / rel
        try:
            candidate.resolve().relative_to((root / "backend").resolve())
        except (OSError, ValueError) as exc:
            raise TargetSchemaError() from exc
    return {
        "id": channel_id,
        "handle": handle,
        "name": body["name"],
        "data_path": body["data_path"],
        "evaluation_data_path": body["evaluation_data_path"],
        "enabled": body["enabled"],
        "capabilities": [str(item) for item in capabilities],
        "status": "Idle",
    }


def load_targets(path: Path | None = None) -> list[dict[str, Any]]:
    source = path or CHANNELS_PATH
    root = Path(__file__).resolve().parents[2]
    parsed = _parse_channels_document(source.read_text(encoding="utf-8"))
    return [_validate_channel(key, body, root=root) for key, body in parsed.items()]


def admitted_target(target: str) -> dict[str, Any]:
    admitted = {item["id"]: item for item in load_targets()}
    record = admitted.get(target)
    if record is None or not record["enabled"]:
        raise ValueError("target_not_admitted")
    return record


def assert_admitted(target: str) -> str:
    return admitted_target(target)["id"]
