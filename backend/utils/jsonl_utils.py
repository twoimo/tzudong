#!/usr/bin/env python3
"""Shared JSONL helpers for backend pipeline scripts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional


def read_last_non_empty_line(path: Path, chunk_size: int = 4096) -> Optional[str]:
    """Read the last non-empty line from a UTF-8 text file efficiently."""
    if not path.exists() or path.stat().st_size == 0:
        return None

    with path.open("rb") as fp:
        fp.seek(0, 2)
        file_size = fp.tell()
        buffer = b""
        position = file_size

        while position > 0:
            read_size = min(chunk_size, position)
            position -= read_size
            fp.seek(position)
            buffer = fp.read(read_size) + buffer

            lines = buffer.splitlines()
            if position > 0 and lines:
                buffer = lines[0]
                lines = lines[1:]

            for line in reversed(lines):
                text = line.decode("utf-8", errors="ignore").strip()
                if text:
                    return text

        text = buffer.decode("utf-8", errors="ignore").strip()
        return text or None


def load_last_jsonl_record(path: Path) -> Optional[Dict[str, Any]]:
    """Load the latest JSON object from a JSONL file."""
    last_line = read_last_non_empty_line(path)
    if not last_line:
        return None
    try:
        return json.loads(last_line)
    except json.JSONDecodeError:
        return None
