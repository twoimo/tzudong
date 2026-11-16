"""Run status, lock lease, and adapter step checkpoints.

Run lifecycle::

    Queued --claim--> Fetching --all steps pass--> Succeeded
    Queued --pause--> Paused --resume--> Queued
    Fetching | Inserting --pause, then the next step boundary--> Paused
    Queued | Paused --cancel--> Cancelled
    Fetching | Inserting --cancel, then the next step boundary--> Cancelled
    Fetching | Inserting | Paused --step or worker failure--> Failed
    Queued | Fetching | Inserting --lease lapsed--> Failed (lease_expired)

``Succeeded``, ``Failed``, and ``Cancelled`` are terminal. A terminal run does
not change again and does not hold its target lock.

A worker holds a ``Fetching`` or ``Inserting`` run until its next step
boundary. A pause or a cancel of that run waits for the boundary, so the run
never returns to the queue and never frees its target while its step runs. A
resume before the boundary withdraws the pause. A cancel cannot be withdrawn.

A run that ends before the boundary ends ``Succeeded`` or ``Failed``, and the
pending pause or cancel does not apply. A dead worker reaches no boundary, so
the lapsed lease ends its run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
from typing import Any, Literal

from backend.pipeline_control.graph import ADAPTER_STEPS
from backend.pipeline_control.impl_selector import rust_dispatch, runtime_function

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
EXECUTING_STATUSES = frozenset({"Fetching", "Inserting"})
TERMINAL_STATUSES = frozenset(RUN_STATUSES) - ACTIVE_LOCK_STATUSES
TARGET_IDLE = "Idle"
ILLEGAL_TRANSITION = "illegal_transition"
PAUSE_FROM = frozenset({"Queued", "Fetching", "Inserting"})
CANCEL_FROM = frozenset({"Queued", "Fetching", "Inserting", "Paused"})

Profile = Literal["heavy_local", "lite_gha"]


class ControlPlaneError(Exception):
    def __init__(self, code: str, http_status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.http_status = http_status


@rust_dispatch("R3-upsert-payload")
def payload_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return sha256(canonical.encode("utf-8")).hexdigest()


@rust_dispatch("R5-pipeline-graph")
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
    pause_requested: bool = False
    cancel_requested: bool = False
    claimed_by: str | None = None
    checkpoint: dict[str, Any] = field(default_factory=dict)


@rust_dispatch("R5-pipeline-graph")
def can_pause(status: str) -> bool:
    return status in PAUSE_FROM


@rust_dispatch("R5-pipeline-graph")
def can_cancel(status: str) -> bool:
    return status in CANCEL_FROM


@rust_dispatch("R5-pipeline-graph")
def can_resume(status: str) -> bool:
    return status == "Paused"


def apply_transition(run: RunRecord, action: str, now: float, lease_ttl: float) -> RunRecord:
    if run.status not in EXECUTING_STATUSES:
        return _transition_status(run, action, now, lease_ttl)
    if action == "cancel":
        run.cancel_requested = True
    elif action == "pause":
        run.pause_requested = True
    elif action == "resume" and run.pause_requested:
        run.pause_requested = False
    else:
        raise ControlPlaneError(ILLEGAL_TRANSITION, 409)
    return run


def step_boundary(run: RunRecord, now: float, lease_ttl: float) -> RunRecord:
    heartbeat(run, now, lease_ttl)
    if run.status not in EXECUTING_STATUSES:
        return run
    if run.cancel_requested:
        _transition_status(run, "cancel", now, lease_ttl)
    elif run.pause_requested:
        run.pause_requested = False
        _transition_status(run, "pause", now, lease_ttl)
    return run


def _transition_status(run: RunRecord, action: str, now: float, lease_ttl: float) -> RunRecord:
    native = runtime_function("R5-pipeline-graph", "apply_transition_status")
    if native is not None:
        try:
            next_status = native(run.status, action)
        except ValueError:
            raise ControlPlaneError(ILLEGAL_TRANSITION, 409) from None
        if next_status not in {"Paused", "Queued", "Cancelled"}:
            raise ControlPlaneError(ILLEGAL_TRANSITION, 409)
        run.status = next_status
        if action in {"pause", "resume"}:
            run.lease_until = now + lease_ttl
            run.heartbeat_at = now
        return run
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
    native = runtime_function("R5-pipeline-graph", "stale_reclaim_eligible")
    if native is not None:
        return native(run.status, now, run.lease_until)
    if run.status == "Paused":
        return False
    if run.status not in {"Queued", "Fetching", "Inserting"}:
        return False
    return now > run.lease_until


def heartbeat(run: RunRecord, now: float, lease_ttl: float) -> RunRecord:
    native = runtime_function("R5-pipeline-graph", "heartbeat_allowed")
    allowed = native(run.status) if native is not None else run.status in ACTIVE_LOCK_STATUSES
    if not allowed:
        raise ControlPlaneError(ILLEGAL_TRANSITION, 409)
    run.heartbeat_at = now
    run.lease_until = now + lease_ttl
    return run
