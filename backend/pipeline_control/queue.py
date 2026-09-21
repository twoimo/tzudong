"""Filesystem queue so API and worker processes share jobs without a second Postgres."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_QUEUE = Path(__file__).resolve().parents[1] / "log" / "cron" / "pipeline-queue.jsonl"


def _lock_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".lock")


def _restore_taken_queue(source: Path, taken: Path) -> None:
    """Put an interrupted drain back where the next worker can retry it."""

    if taken.exists() and not source.exists():
        taken.replace(source)


def _rollback_poison(path: Path, existed: bool, size: int) -> None:
    """Remove poison rows written by a drain that did not finish."""

    if not path.exists():
        return
    with path.open("r+b") as handle:
        handle.truncate(size)
    if not existed:
        path.unlink(missing_ok=True)


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
        poison_path = source.with_suffix(source.suffix + ".poison")
        poison_existed = poison_path.exists()
        poison_size = poison_path.stat().st_size if poison_existed else 0
        source.replace(tmp)
        rows: list[dict[str, Any]] = []
        poison_handle = None
        try:
            # Iterate the spool file instead of materialising the complete text
            # and split-lines list. Large retry queues now retain only parsed
            # rows and the current line in memory.
            with tmp.open("r", encoding="utf-8") as input_handle:
                for raw_line in input_handle:
                    line = raw_line.rstrip("\r\n")
                    if not line.strip():
                        continue
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError:
                        parsed = None

                    if isinstance(parsed, dict):
                        rows.append(parsed)
                        continue

                    if poison_handle is None:
                        poison_handle = poison_path.open("a", encoding="utf-8")
                    poison_handle.write(line + "\n")
        except BaseException:
            if poison_handle is not None:
                try:
                    poison_handle.close()
                except BaseException:
                    pass
            try:
                _rollback_poison(poison_path, poison_existed, poison_size)
            except BaseException:
                pass
            _restore_taken_queue(source, tmp)
            raise

        if poison_handle is not None:
            try:
                poison_handle.close()
            except BaseException:
                _restore_taken_queue(source, tmp)
                raise
        tmp.unlink(missing_ok=True)
        return rows
