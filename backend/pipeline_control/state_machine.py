"""Run status, lock lease, and adapter step checkpoints."""

from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
from typing import Any, Literal

RUN_STATUSES = (
    "Queued",
    "Fetching",
    "Inserting",
    "Paused",
    "Cancelled",
    "Failed",
    "Succeeded",
)
ACTIVE_LOCK_STATUSES = frozenset({"Queued", "Fetching", "Inserting", "Paused"})
TARGET_IDLE = "Idle"
ILLEGAL_TRANSITION = "illegal_transition"
ADAPTER_STEPS = (
    "01-collect-urls",
    "02-collect-meta",
    "02-1-migrate",
    "02-5-cleanup",
    "03-transcript",
    "03-1-context",
    "04-frames",
    "06-1-enrich",
    "08-chunk",
    "09-target",
    "10-rule",
    "11-laaj",
    "12-transform",
    "13-supabase-insert",
)
PAUSE_FROM = frozenset({"Queued", "Fetching", "Inserting"})
CANCEL_FROM = frozenset({"Queued", "Fetching", "Inserting", "Paused"})

Profile = Literal["heavy_local", "lite_gha"]


class ControlPlaneError(Exception):
    def __init__(self, code: str, http_status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.http_status = http_status


def payload_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return sha256(canonical.encode("utf-8")).hexdigest()


def lock_key(target: str, profile: str) -> str:
    return f"{target}:{profile}"


@dataclass
class RunRecord:
    id: str
    target: str
    profile: Profile
    status: str
    idempotency_key: str
    payload_hash: str
    actor: str
    request_id: str
    lease_until: float
    heartbeat_at: float
    adapter_index: int = 0
    dry_run: bool = True
    error_code: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)


def can_pause(status: str) -> bool:
    return status in PAUSE_FROM


def can_cancel(status: str) -> bool:
    return status in CANCEL_FROM


def can_resume(status: str) -> bool:
    return status == "Paused"


def apply_transition(run: RunRecord, action: str, now: float, lease_ttl: float) -> RunRecord:
    if action == "pause":
        if not can_pause(run.status):
            raise ControlPlaneError(ILLEGAL_TRANSITION, 409)
        run.status = "Paused"
        run.lease_until = now + lease_ttl
        run.heartbeat_at = now
        return run
    if action == "resume":
        if not can_resume(run.status):
            raise ControlPlaneError(ILLEGAL_TRANSITION, 409)
        run.status = "Queued"
        run.lease_until = now + lease_ttl
        run.heartbeat_at = now
        return run
    if action == "cancel":
        if not can_cancel(run.status):
            raise ControlPlaneError(ILLEGAL_TRANSITION, 409)
        run.status = "Cancelled"
        return run
    raise ControlPlaneError(ILLEGAL_TRANSITION, 409)


def stale_reclaim_eligible(run: RunRecord, now: float) -> bool:
    if run.status == "Paused":
        return False
    if run.status not in {"Queued", "Fetching", "Inserting"}:
        return False
    return now > run.lease_until


def heartbeat(run: RunRecord, now: float, lease_ttl: float) -> RunRecord:
    if run.status not in ACTIVE_LOCK_STATUSES:
        raise ControlPlaneError(ILLEGAL_TRANSITION, 409)
    run.heartbeat_at = now
    run.lease_until = now + lease_ttl
    return run
