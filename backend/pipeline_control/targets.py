"""Admitted crawler targets come only from backend/config/channels.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any

CHANNELS_PATH = Path(__file__).resolve().parents[1] / "config" / "channels.yaml"


def _parse_channel_keys(text: str) -> list[str]:
    keys: list[str] = []
    in_channels = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("channels:"):
            in_channels = True
            continue
        if in_channels:
            if line and not line.startswith(" ") and not line.startswith("\t") and line.endswith(":"):
                break
            if line.startswith("  ") and not line.startswith("    ") and line.strip().endswith(":"):
                key = line.strip().rstrip(":")
                if key and not key.startswith("#"):
                    keys.append(key)
    return keys


def load_targets(path: Path | None = None) -> list[dict[str, Any]]:
    source = path or CHANNELS_PATH
    keys = _parse_channel_keys(source.read_text(encoding="utf-8"))
    return [{"id": key, "status": "Idle"} for key in keys]


def assert_admitted(target: str) -> str:
    admitted = {item["id"] for item in load_targets()}
    if target not in admitted:
        raise ValueError("target_not_admitted")
    return target
