"""In-process Slice 0 store. Durable rows land in schema pipeline_control."""

from __future__ import annotations

from dataclasses import asdict
import time
import uuid
from typing import Any

from backend.pipeline_control.state_machine import (
    ACTIVE_LOCK_STATUSES,
    ADAPTER_STEPS,
    ControlPlaneError,
    Profile,
    RunRecord,
    apply_transition,
    heartbeat,
    lock_key,
    payload_hash,
    stale_reclaim_eligible,
)
from backend.pipeline_control.persist import upsert_job

LEASE_TTL_SECONDS = 30.0


class MemoryStore:
    def __init__(self, clock: Any | None = None) -> None:
        self._clock = clock or time.time
        self.runs: dict[str, RunRecord] = {}
        self.locks: dict[str, str] = {}
        self.audit: list[dict[str, Any]] = []
        self.idempotency: dict[str, str] = {}

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

    def _reclaim(self) -> None:
        now = self.now()
        for key, run_id in list(self.locks.items()):
            run = self.runs[run_id]
            if stale_reclaim_eligible(run, now):
                run.status = "Failed"
                run.error_code = "lease_expired"
                self.locks.pop(key, None)
                self._audit(
                    actor="system",
                    job_id=run.id,
                    transition="lease_reclaim",
                    request_id=run.request_id,
                )
                upsert_job(run)

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
        self._reclaim()
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
        upsert_job(run)
        return run, True

    def get(self, run_id: str) -> RunRecord:
        if run_id not in self.runs:
            raise ControlPlaneError("run_not_found", 404)
        return self.runs[run_id]

    def control(self, run_id: str, action: str, *, actor: str, request_id: str) -> RunRecord:
        self._reclaim()
        run = self.get(run_id)
        apply_transition(run, action, self.now(), LEASE_TTL_SECONDS)
        if run.status == "Cancelled":
            self.locks.pop(lock_key(run.target, run.profile), None)
        self._audit(actor=actor, job_id=run.id, transition=action, request_id=request_id)
        upsert_job(run)
        return run

    def beat(self, run_id: str) -> RunRecord:
        run = self.get(run_id)
        heartbeat(run, self.now(), LEASE_TTL_SECONDS)
        upsert_job(run)
        return run

    def claim(self) -> RunRecord | None:
        self._reclaim()
        for run in self.runs.values():
            if run.status == "Queued":
                run.status = "Fetching"
                heartbeat(run, self.now(), LEASE_TTL_SECONDS)
                self._audit(
                    actor="worker",
                    job_id=run.id,
                    transition="claim",
                    request_id=run.request_id,
                )
                upsert_job(run)
                return run
        return None

    def finish_dry_run(self, run_id: str) -> RunRecord:
        run = self.get(run_id)
        if run.status == "Cancelled":
            return run
        if run.status == "Paused":
            return run
        run.adapter_index = len(ADAPTER_STEPS)
        run.status = "Succeeded"
        self.locks.pop(lock_key(run.target, run.profile), None)
        self._audit(
            actor="worker",
            job_id=run.id,
            transition="dry_run_succeeded",
            request_id=run.request_id,
        )
        upsert_job(run)
        return run

    def finish_failed(self, run_id: str, error_code: str = "adapter_failed") -> RunRecord:
        run = self.get(run_id)
        run.status = "Failed"
        run.error_code = error_code
        self.locks.pop(lock_key(run.target, run.profile), None)
        self._audit(
            actor="worker",
            job_id=run.id,
            transition="failed",
            request_id=run.request_id,
        )
        upsert_job(run)
        return run

    def public_run(self, run: RunRecord) -> dict[str, Any]:
        body = asdict(run)
        body.pop("events", None)
        return body
