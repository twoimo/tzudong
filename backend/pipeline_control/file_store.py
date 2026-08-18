"""Process-shared JSON store so API and worker see the same runs/locks."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any

from backend.pipeline_control.queue import _Lock
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore

DEFAULT_STORE = Path(__file__).resolve().parents[1] / "log" / "cron" / "pipeline-store.json"


def store_path() -> Path:
    raw = os.environ.get("PIPELINE_CONTROL_STORE_PATH", "").strip()
    return Path(raw) if raw else DEFAULT_STORE


class FileStore(MemoryStore):
    def __init__(self, path: Path | None = None, clock: Any | None = None) -> None:
        super().__init__(clock=clock)
        self.path = path or store_path()
        self._gate = threading.RLock()
        self._tls = threading.local()
        self._load_unlocked()

    def _nested(self) -> bool:
        return bool(getattr(self._tls, "depth", 0))

    def _load_unlocked(self) -> None:
        if not self.path.exists():
            self.runs = {}
            self.locks = {}
            self.audit = []
            self.idempotency = {}
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self.runs = {key: RunRecord(**value) for key, value in raw.get("runs", {}).items()}
        self.locks = dict(raw.get("locks", {}))
        self.audit = list(raw.get("audit", []))
        self.idempotency = dict(raw.get("idempotency", {}))

    def _save_unlocked(self) -> None:
        payload = {
            "runs": {key: asdict(run) for key, run in self.runs.items()},
            "locks": self.locks,
            "audit": self.audit,
            "idempotency": self.idempotency,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        tmp.replace(self.path)

    def _mutate(self, fn):
        if self._nested():
            return fn()
        with self._gate:
            with _Lock(self.path):
                self._load_unlocked()
                self._tls.depth = getattr(self._tls, "depth", 0) + 1
                try:
                    result = fn()
                    self._save_unlocked()
                    return result
                finally:
                    self._tls.depth -= 1

    def create_run(self, **kwargs):  # type: ignore[no-untyped-def]
        return self._mutate(lambda: super(FileStore, self).create_run(**kwargs))

    def get(self, run_id: str) -> RunRecord:
        if self._nested():
            return super().get(run_id)
        with self._gate:
            with _Lock(self.path):
                self._load_unlocked()
                return super().get(run_id)

    def operator_snapshot(self, admitted: list[dict[str, Any]]) -> dict[str, Any]:
        if self._nested():
            return super().operator_snapshot(admitted)
        with self._gate:
            with _Lock(self.path):
                self._load_unlocked()
                return super().operator_snapshot(admitted)

    def control(self, run_id: str, action: str, *, actor: str, request_id: str) -> RunRecord:
        return self._mutate(
            lambda: super(FileStore, self).control(
                run_id, action, actor=actor, request_id=request_id
            )
        )

    def beat(self, run_id: str) -> RunRecord:
        return self._mutate(lambda: super(FileStore, self).beat(run_id))

    def claim(self) -> RunRecord | None:
        return self._mutate(lambda: super(FileStore, self).claim())

    def finish_dry_run(self, run_id: str) -> RunRecord:
        return self._mutate(lambda: super(FileStore, self).finish_dry_run(run_id))

    def finish_failed(self, run_id: str, error_code: str = "adapter_failed") -> RunRecord:
        return self._mutate(lambda: super(FileStore, self).finish_failed(run_id, error_code))
