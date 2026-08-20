"""Atomic Postgres control-plane store. AtomicMemoryStore mirrors SQL without a live DB."""

from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import asdict
from typing import Any

from backend.pipeline_control.dsn_guard import DsnGuardError
from backend.pipeline_control.metrics import record
from backend.pipeline_control.pool import PoolError, close_pool, connection, get_pool
from backend.pipeline_control.state_machine import (
    ACTIVE_LOCK_STATUSES,
    ADAPTER_STEPS,
    ControlPlaneError,
    Profile,
    RunRecord,
    TARGET_IDLE,
    heartbeat,
    lock_key,
    payload_hash,
)
from backend.pipeline_control.store import LEASE_TTL_SECONDS, OPERATOR_FAILURE_CAP, PUBLIC_LIST_KEYS

_STATUS_RANK = {"Inserting": 3, "Fetching": 2, "Queued": 1, "Paused": 0}
_PROFILE_RANK = {"heavy_local": 1, "lite_gha": 0}
_OPERATOR_PROFILES = ("heavy_local", "lite_gha")
_SQL_CODES = {
    "idempotency_payload_conflict": 409,
    "lock_held": 409,
    "illegal_transition": 409,
    "run_not_found": 404,
}


def run_from_job(payload: dict[str, Any]) -> RunRecord:
    checkpoint = payload.get("checkpoint") or {}
    if isinstance(checkpoint, str):
        checkpoint = json.loads(checkpoint)
    if not isinstance(checkpoint, dict):
        checkpoint = {}
    return RunRecord(
        id=str(payload["id"]),
        target=str(payload["target"]),
        profile=payload["profile"],  # type: ignore[arg-type]
        status=str(payload["status"]),
        idempotency_key=str(payload["idempotency_key"]),
        payload_hash=str(payload["payload_hash"]),
        actor=str(payload["actor"]),
        request_id=str(payload["request_id"]),
        lease_until=float(payload["lease_until"]),
        heartbeat_at=float(payload["heartbeat_at"]),
        adapter_index=int(payload.get("adapter_index") or 0),
        dry_run=bool(payload.get("dry_run", True)),
        error_code=payload.get("error_code"),
        pause_requested=bool(payload.get("pause_requested", False)),
        cancel_requested=bool(payload.get("cancel_requested", False)),
        claimed_by=payload.get("claimed_by"),
        checkpoint=dict(checkpoint),
    )


def raise_sql(exc: Exception) -> None:
    primary = ""
    diag = getattr(exc, "diag", None)
    if diag is not None and getattr(diag, "message_primary", None):
        primary = str(diag.message_primary)
    if not primary:
        primary = str(exc).split("\n", 1)[0]
    code = primary.strip()
    raise ControlPlaneError(code or "persist_divergence", _SQL_CODES.get(code, 500)) from exc


def _snapshot(runs: dict[str, RunRecord], locks: dict[str, str], now: float, admitted: list[dict[str, Any]]) -> dict[str, Any]:
    admitted_ids = [str(row["id"]) for row in admitted]
    admitted_set = set(admitted_ids)
    jobs: list[RunRecord] = []
    overlay: dict[str, str] = {target_id: TARGET_IDLE for target_id in admitted_ids}
    for target_id in admitted_ids:
        live: list[RunRecord] = []
        for profile in _OPERATOR_PROFILES:
            holder = locks.get(lock_key(target_id, profile))
            if not holder:
                continue
            run = runs.get(holder)
            if run is None or run.status not in ACTIVE_LOCK_STATUSES:
                continue
            if run.status != "Paused" and now > run.lease_until:
                continue
            live.append(run)
            jobs.append(run)
        if live:
            live.sort(
                key=lambda item: (
                    _STATUS_RANK.get(item.status, -1),
                    _PROFILE_RANK.get(item.profile, -1),
                ),
                reverse=True,
            )
            overlay[target_id] = live[0].status
    failures = [
        run
        for run in runs.values()
        if run.status == "Failed" and run.target in admitted_set
    ]
    jobs.sort(key=lambda run: (-run.heartbeat_at, run.id))
    failures.sort(key=lambda run: (-run.heartbeat_at, run.id))
    return {
        "targets": [{"id": target_id, "status": overlay[target_id]} for target_id in admitted_ids],
        "jobs": [{key: getattr(run, key) for key in PUBLIC_LIST_KEYS} for run in jobs],
        "failures": [
            {key: getattr(run, key) for key in PUBLIC_LIST_KEYS}
            for run in failures[:OPERATOR_FAILURE_CAP]
        ],
    }


class AtomicMemoryStore:
    """In-process stand-in for enqueue_job/claim_job/control_job/checkpoint_job."""

    def __init__(self, clock: Any | None = None, worker_id: str = "worker") -> None:
        self._clock = clock or time.time
        self._gate = threading.Lock()
        self.worker_id = worker_id
        self.runs: dict[str, RunRecord] = {}
        self.locks: dict[str, str] = {}
        self.audit: list[dict[str, Any]] = []
        self.idempotency: dict[str, str] = {}
        self.job_steps: list[dict[str, Any]] = []
        self.control_requests: list[dict[str, Any]] = []

    def now(self) -> float:
        return float(self._clock())

    def _audit(self, *, actor: str, job_id: str, transition: str, request_id: str) -> None:
        self.audit.append(
            {
                "actor": actor,
                "job_id": job_id,
                "transition": transition,
                "X-Request-Id": request_id,
            }
        )

    def create_run(
        self,
        *,
        target: str,
        profile: Profile,
        idempotency_key: str,
        payload: dict[str, Any],
        actor: str,
        request_id: str,
        dry_run: bool = True,
    ) -> tuple[RunRecord, bool]:
        with self._gate:
            digest = payload_hash({"target": target, "profile": profile, **payload})
            existing_id = self.idempotency.get(idempotency_key)
            if existing_id:
                existing = self.runs[existing_id]
                if existing.payload_hash != digest:
                    raise ControlPlaneError("idempotency_payload_conflict", 409)
                return existing, False
            key = lock_key(target, profile)
            holder = self.locks.get(key)
            if holder:
                held = self.runs[holder]
                if held.status in ACTIVE_LOCK_STATUSES:
                    raise ControlPlaneError("lock_held", 409)
            now = self.now()
            run = RunRecord(
                id=str(uuid.uuid4()),
                target=target,
                profile=profile,
                status="Queued",
                idempotency_key=idempotency_key,
                payload_hash=digest,
                actor=actor,
                request_id=request_id,
                lease_until=now + LEASE_TTL_SECONDS,
                heartbeat_at=now,
                dry_run=dry_run,
            )
            self.runs[run.id] = run
            self.locks[key] = run.id
            self.idempotency[idempotency_key] = run.id
            self._audit(actor=actor, job_id=run.id, transition="enqueue", request_id=request_id)
            record("tzudong_pipeline_runs_enqueued_total")
            return run, True

    def get(self, run_id: str) -> RunRecord:
        with self._gate:
            if run_id not in self.runs:
                raise ControlPlaneError("run_not_found", 404)
            return self.runs[run_id]

    def control(self, run_id: str, action: str, *, actor: str, request_id: str) -> RunRecord:
        with self._gate:
            run = self.runs.get(run_id)
            if run is None:
                raise ControlPlaneError("run_not_found", 404)
            now = self.now()
            if action == "pause":
                if run.status not in {"Queued", "Fetching", "Inserting"}:
                    raise ControlPlaneError("illegal_transition", 409)
                run.pause_requested = True
                self.control_requests.append(
                    {"job_id": run.id, "action": "pause", "status": "requested", "actor": actor}
                )
                if run.status == "Queued":
                    run.status = "Paused"
                    self.control_requests[-1]["status"] = "approved"
                heartbeat(run, now, LEASE_TTL_SECONDS)
                self._audit(actor=actor, job_id=run.id, transition="pause_requested", request_id=request_id)
                return run
            if action == "cancel":
                if run.status not in {"Queued", "Fetching", "Inserting", "Paused"}:
                    raise ControlPlaneError("illegal_transition", 409)
                run.cancel_requested = True
                self.control_requests.append(
                    {"job_id": run.id, "action": "cancel", "status": "requested", "actor": actor}
                )
                if run.status in {"Queued", "Paused"}:
                    run.status = "Cancelled"
                    self.locks.pop(lock_key(run.target, run.profile), None)
                    self.control_requests[-1]["status"] = "approved"
                self._audit(actor=actor, job_id=run.id, transition="cancel_requested", request_id=request_id)
                return run
            if action == "resume":
                if run.status != "Paused" and not run.pause_requested:
                    raise ControlPlaneError("illegal_transition", 409)
                run.pause_requested = False
                if run.status == "Paused":
                    run.status = "Queued"
                heartbeat(run, now, LEASE_TTL_SECONDS)
                self._audit(actor=actor, job_id=run.id, transition="resume", request_id=request_id)
                return run
            raise ControlPlaneError("illegal_transition", 409)

    def beat(self, run_id: str) -> RunRecord:
        return self.checkpoint(run_id, apply_boundary=False)

    def checkpoint(
        self,
        run_id: str,
        *,
        adapter_index: int | None = None,
        apply_boundary: bool = True,
        worker_id: str | None = None,
    ) -> RunRecord:
        with self._gate:
            run = self.runs.get(run_id)
            if run is None:
                raise ControlPlaneError("run_not_found", 404)
            if run.status not in ACTIVE_LOCK_STATUSES:
                raise ControlPlaneError("illegal_transition", 409)
            now = self.now()
            if adapter_index is not None:
                run.adapter_index = adapter_index
            heartbeat(run, now, LEASE_TTL_SECONDS)
            if apply_boundary and run.cancel_requested:
                run.status = "Cancelled"
                self.locks.pop(lock_key(run.target, run.profile), None)
                self._audit(
                    actor=worker_id or self.worker_id,
                    job_id=run.id,
                    transition="cancel_approved",
                    request_id=run.request_id,
                )
            elif apply_boundary and run.pause_requested and run.status in {"Queued", "Fetching", "Inserting"}:
                run.status = "Paused"
                self._audit(
                    actor=worker_id or self.worker_id,
                    job_id=run.id,
                    transition="pause_approved",
                    request_id=run.request_id,
                )
            claimed = worker_id or self.worker_id
            if claimed:
                run.claimed_by = run.claimed_by or claimed
            self.job_steps.append(
                {"job_id": run.id, "step_index": run.adapter_index, "status": run.status}
            )
            self._audit(
                actor=claimed or "worker",
                job_id=run.id,
                transition="checkpoint",
                request_id=run.request_id,
            )
            return run

    def claim(self) -> RunRecord | None:
        with self._gate:
            for run in self.runs.values():
                if run.status == "Queued" and not run.pause_requested and not run.cancel_requested:
                    run.status = "Fetching"
                    run.claimed_by = self.worker_id
                    heartbeat(run, self.now(), LEASE_TTL_SECONDS)
                    self._audit(
                        actor=self.worker_id,
                        job_id=run.id,
                        transition="claim",
                        request_id=run.request_id,
                    )
                    record("tzudong_pipeline_runs_claimed_total")
                    return run
            return None

    def finish_dry_run(self, run_id: str) -> RunRecord:
        with self._gate:
            run = self.runs[run_id]
            if run.status in {"Cancelled", "Paused"}:
                return run
            run.adapter_index = len(ADAPTER_STEPS)
            run.status = "Succeeded"
            self.locks.pop(lock_key(run.target, run.profile), None)
            self._audit(actor=self.worker_id, job_id=run.id, transition="dry_run_succeeded", request_id=run.request_id)
            record("tzudong_pipeline_runs_succeeded_total")
            return run

    def finish_failed(self, run_id: str, error_code: str = "adapter_failed") -> RunRecord:
        with self._gate:
            run = self.runs[run_id]
            run.status = "Failed"
            run.error_code = error_code
            self.locks.pop(lock_key(run.target, run.profile), None)
            self._audit(actor=self.worker_id, job_id=run.id, transition="failed", request_id=run.request_id)
            record("tzudong_pipeline_runs_failed_total")
            return run

    def public_run(self, run: RunRecord) -> dict[str, Any]:
        body = asdict(run)
        body.pop("events", None)
        return body

    def list_run_view(self, run: RunRecord) -> dict[str, Any]:
        return {key: getattr(run, key) for key in PUBLIC_LIST_KEYS}

    def operator_snapshot(self, admitted: list[dict[str, Any]]) -> dict[str, Any]:
        with self._gate:
            return _snapshot(self.runs, self.locks, self.now(), admitted)


class PostgresStore:
    """PostgreSQL SoT via atomic RPCs and a reused connection pool."""

    def __init__(self, worker_id: str = "worker") -> None:
        self.worker_id = worker_id
        get_pool()

    def _execute(self, sql: str, params: tuple[Any, ...] = ()) -> Any:
        try:
            with connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(sql, params)
                    if cur.description is None:
                        return None
                    return cur.fetchall()
        except (DsnGuardError, PoolError, ControlPlaneError):
            raise
        except Exception as exc:
            raise_sql(exc)

    def create_run(
        self,
        *,
        target: str,
        profile: Profile,
        idempotency_key: str,
        payload: dict[str, Any],
        actor: str,
        request_id: str,
        dry_run: bool = True,
    ) -> tuple[RunRecord, bool]:
        digest = payload_hash({"target": target, "profile": profile, **payload})
        rows = self._execute(
            "SELECT run, created FROM pipeline_control.enqueue_job(%s,%s,%s,%s,%s,%s,%s)",
            (target, profile, idempotency_key, digest, actor, request_id, dry_run),
        )
        run_payload, created = rows[0]
        if isinstance(run_payload, str):
            run_payload = json.loads(run_payload)
        run = run_from_job(run_payload)
        if created:
            record("tzudong_pipeline_runs_enqueued_total")
        return run, bool(created)

    def get(self, run_id: str) -> RunRecord:
        rows = self._execute(
            """
            SELECT pipeline_control._job_json(j)
            FROM pipeline_control.jobs j
            WHERE j.id = %s
            """,
            (run_id,),
        )
        if not rows:
            raise ControlPlaneError("run_not_found", 404)
        payload = rows[0][0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return run_from_job(payload)

    def control(self, run_id: str, action: str, *, actor: str, request_id: str) -> RunRecord:
        rows = self._execute(
            "SELECT pipeline_control.control_job(%s::uuid, %s, %s, %s)",
            (run_id, action, actor, request_id),
        )
        payload = rows[0][0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return run_from_job(payload)

    def beat(self, run_id: str) -> RunRecord:
        return self.checkpoint(run_id, apply_boundary=False)

    def checkpoint(
        self,
        run_id: str,
        *,
        adapter_index: int | None = None,
        apply_boundary: bool = True,
        worker_id: str | None = None,
    ) -> RunRecord:
        if not apply_boundary:
            rows = self._execute(
                """
                UPDATE pipeline_control.jobs
                SET heartbeat_at = now(),
                    lease_until = now() + interval '30 seconds',
                    adapter_index = COALESCE(%s, adapter_index),
                    updated_at = now()
                WHERE id = %s
                RETURNING pipeline_control._job_json(pipeline_control.jobs)
                """,
                (adapter_index, run_id),
            )
            if not rows:
                raise ControlPlaneError("run_not_found", 404)
            payload = rows[0][0]
            if isinstance(payload, str):
                payload = json.loads(payload)
            return run_from_job(payload)
        rows = self._execute(
            "SELECT pipeline_control.checkpoint_job(%s::uuid, %s, %s, '{}'::jsonb)",
            (run_id, adapter_index, worker_id or self.worker_id),
        )
        payload = rows[0][0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return run_from_job(payload)

    def claim(self) -> RunRecord | None:
        rows = self._execute("SELECT pipeline_control.claim_job(%s)", (self.worker_id,))
        payload = rows[0][0] if rows else None
        if payload is None:
            return None
        if isinstance(payload, str):
            payload = json.loads(payload)
        record("tzudong_pipeline_runs_claimed_total")
        return run_from_job(payload)

    def finish_dry_run(self, run_id: str) -> RunRecord:
        run = self.get(run_id)
        if run.status in {"Cancelled", "Paused"}:
            return run
        rows = self._execute(
            """
            UPDATE pipeline_control.jobs
            SET status = 'Succeeded',
                adapter_index = %s,
                next_step = %s,
                updated_at = now()
            WHERE id = %s
            RETURNING pipeline_control._job_json(pipeline_control.jobs)
            """,
            (len(ADAPTER_STEPS), len(ADAPTER_STEPS), run_id),
        )
        self._execute(
            "DELETE FROM pipeline_control.locks WHERE job_id = %s",
            (run_id,),
        )
        self._execute(
            """
            INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
            VALUES (%s, %s, 'dry_run_succeeded', %s)
            """,
            (self.worker_id, run_id, run.request_id),
        )
        record("tzudong_pipeline_runs_succeeded_total")
        payload = rows[0][0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return run_from_job(payload)

    def finish_failed(self, run_id: str, error_code: str = "adapter_failed") -> RunRecord:
        run = self.get(run_id)
        rows = self._execute(
            """
            UPDATE pipeline_control.jobs
            SET status = 'Failed',
                error_code = %s,
                updated_at = now()
            WHERE id = %s
            RETURNING pipeline_control._job_json(pipeline_control.jobs)
            """,
            (error_code, run_id),
        )
        self._execute(
            "DELETE FROM pipeline_control.locks WHERE job_id = %s",
            (run_id,),
        )
        self._execute(
            """
            INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
            VALUES (%s, %s, 'failed', %s)
            """,
            (self.worker_id, run_id, run.request_id),
        )
        record("tzudong_pipeline_runs_failed_total")
        payload = rows[0][0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return run_from_job(payload)

    def public_run(self, run: RunRecord) -> dict[str, Any]:
        body = asdict(run)
        body.pop("events", None)
        return body

    def list_run_view(self, run: RunRecord) -> dict[str, Any]:
        return {key: getattr(run, key) for key in PUBLIC_LIST_KEYS}

    def operator_snapshot(self, admitted: list[dict[str, Any]]) -> dict[str, Any]:
        rows = self._execute(
            """
            SELECT pipeline_control._job_json(j), l.lock_key
            FROM pipeline_control.jobs j
            LEFT JOIN pipeline_control.locks l ON l.job_id = j.id
            """
        )
        runs: dict[str, RunRecord] = {}
        locks: dict[str, str] = {}
        now = time.time()
        for payload, lock_name in rows or []:
            if isinstance(payload, str):
                payload = json.loads(payload)
            run = run_from_job(payload)
            runs[run.id] = run
            if lock_name:
                locks[str(lock_name)] = run.id
        return _snapshot(runs, locks, now, admitted)

    def close(self) -> None:
        close_pool()
