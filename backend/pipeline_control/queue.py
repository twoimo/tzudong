"""Filesystem queue so API and worker processes share jobs without a second Postgres."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_QUEUE = Path(__file__).resolve().parents[1] / "log" / "cron" / "pipeline-queue.jsonl"


def _lock_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".lock")



class _Lock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle = None

    def __enter__(self):
        lock = _lock_path(self.path)
        lock.parent.mkdir(parents=True, exist_ok=True)
        self.handle = lock.open("a+")
        import fcntl

        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return self.handle

    def __exit__(self, *exc: object) -> None:
        if self.handle is not None:
            import fcntl

            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()


def enqueue(payload: dict[str, Any], path: Path | None = None) -> Path:
    destination = path or DEFAULT_QUEUE
    destination.parent.mkdir(parents=True, exist_ok=True)
    with _Lock(destination):
        with destination.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, sort_keys=True) + "\n")
    return destination


def drain(path: Path | None = None) -> list[dict[str, Any]]:
    source = path or DEFAULT_QUEUE
    if not source.exists():
        return []
    with _Lock(source):
        if not source.exists():
            return []
        tmp = source.with_suffix(source.suffix + ".taking")
        source.replace(tmp)
        rows: list[dict[str, Any]] = []
        poison: list[str] = []
        for line in tmp.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                poison.append(line)
                continue
            if isinstance(parsed, dict):
                rows.append(parsed)
            else:
                poison.append(line)
        if poison:
            poison_path = source.with_suffix(source.suffix + ".poison")
            with poison_path.open("a", encoding="utf-8") as handle:
                handle.write("\n".join(poison) + "\n")
        tmp.unlink(missing_ok=True)
        return rows
