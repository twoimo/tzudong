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



JOB_READBACK_FIELDS = (
    "id",
    "target",
    "profile",
    "status",
    "idempotency_key",
    "payload_hash",
    "actor",
    "request_id",
    "adapter_index",
    "dry_run",
    "error_code",
)


def _field_equal(got: Any, expected: Any) -> bool:
    if expected is None:
        return got is None
    if isinstance(expected, bool):
        return bool(got) is expected
    if isinstance(expected, int) and not isinstance(expected, bool):
        try:
            return int(got) == expected
        except (TypeError, ValueError):
            return False
    return str(got) == str(expected)


def verify_persisted(cur: Any, run: RunRecord, *, lock_held: bool, lock_key: str) -> None:
    """Read back jobs+locks and compare to the FileStore RunRecord. GET stays FileStore."""
    try:
        cur.execute(
            """
            SELECT id, target, profile, status, idempotency_key, payload_hash,
                   actor, request_id, adapter_index, dry_run, error_code
            FROM pipeline_control.jobs
            WHERE id = %s
            """,
            (run.id,),
        )
        job_row = cur.fetchone()
        cur.execute(
            "SELECT job_id FROM pipeline_control.locks WHERE lock_key = %s",
            (lock_key,),
        )
        lock_row = cur.fetchone()
    except PersistError:
        raise
    except Exception as exc:
        raise PersistError("persist_divergence") from exc

    expected = tuple(getattr(run, name) for name in JOB_READBACK_FIELDS)
    if job_row is None:
        raise PersistError("persist_divergence")
    got = tuple(job_row)
    if len(got) != len(expected):
        raise PersistError("persist_divergence")
    if any(not _field_equal(left, right) for left, right in zip(got, expected)):
        raise PersistError("persist_divergence")
    if lock_held:
        if lock_row is None or not _field_equal(lock_row[0], run.id):
            raise PersistError("persist_divergence")
    elif lock_row is not None:
        raise PersistError("persist_divergence")


def persist_mutation(
    run: RunRecord,
    *,
    lock_held: bool,
    lock_key: str,
    audit: dict[str, Any] | None,
) -> None:
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
    if not str(lock_key).strip():
        raise PersistError("persist_lock_key_required")
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
            if lock_held:
                cur.execute(
                    """
                    INSERT INTO pipeline_control.locks (lock_key, job_id)
                    VALUES (%s, %s)
                    ON CONFLICT (lock_key) DO UPDATE SET
                        job_id = EXCLUDED.job_id
                    """,
                    (lock_key, run.id),
                )
            else:
                cur.execute(
                    "DELETE FROM pipeline_control.locks WHERE lock_key = %s",
                    (lock_key,),
                )
            if audit is not None:
                cur.execute(
                    """
                    INSERT INTO pipeline_control.audit (
                        actor, job_id, transition, request_id
                    ) VALUES (%s, %s, %s, %s)
                    """,
                    (
                        audit["actor"],
                        audit["job_id"],
                        audit["transition"],
                        audit.get("X-Request-Id") or audit.get("request_id"),
                    ),
                )
            verify_persisted(cur, run, lock_held=lock_held, lock_key=lock_key)
        try:
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    except PersistError:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()
