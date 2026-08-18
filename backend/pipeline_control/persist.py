"""Optional durable persist into schema pipeline_control. Off by default."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

from backend.pipeline_control.dsn_guard import (
    HOSTED_PROJECT_REF,
    DsnGuardError,
    admit_dsn,
    extract_project_ref,
    load_host_class_fixture,
)
from backend.pipeline_control.state_machine import RunRecord


class PersistError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def persist_enabled() -> bool:
    return os.environ.get("TZUDONG_PIPELINE_PERSIST", "").strip() in {"1", "true", "TRUE", "yes"}


def _load_psycopg2() -> Any:
    import psycopg2

    return psycopg2


def upsert_job(run: RunRecord) -> None:
    if not persist_enabled():
        return
    dsn = os.environ.get("PIPELINE_CONTROL_DSN")
    if not dsn or not str(dsn).strip():
        raise PersistError("persist_dsn_required")
    admit_dsn(data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"), dsn=dsn)
    parsed = urlparse(str(dsn).strip())
    ref = extract_project_ref(parsed.hostname or "", parsed.username or "")
    forbidden = set(load_host_class_fixture()["forbiddenLocalProjectRefs"])
    if HOSTED_PROJECT_REF in str(dsn) or ref in forbidden or ref == HOSTED_PROJECT_REF:
        raise DsnGuardError("hosted_dsn_rejected")
    try:
        psycopg2 = _load_psycopg2()
    except ImportError as exc:
        raise PersistError("psycopg2_missing") from exc
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_control.jobs (
                    id, target, profile, status, idempotency_key, payload_hash,
                    actor, request_id, lease_until, heartbeat_at, adapter_index,
                    dry_run, error_code
                ) VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s, to_timestamp(%s), to_timestamp(%s), %s, %s, %s
                )
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    lease_until = EXCLUDED.lease_until,
                    heartbeat_at = EXCLUDED.heartbeat_at,
                    adapter_index = EXCLUDED.adapter_index,
                    error_code = EXCLUDED.error_code,
                    updated_at = now()
                """,
                (
                    run.id,
                    run.target,
                    run.profile,
                    run.status,
                    run.idempotency_key,
                    run.payload_hash,
                    run.actor,
                    run.request_id,
                    run.lease_until,
                    run.heartbeat_at,
                    run.adapter_index,
                    run.dry_run,
                    run.error_code,
                ),
            )
        conn.commit()
    finally:
        conn.close()
