"""Fail-closed Postgres pool. Heartbeats reuse connections; hosted DSNs never connect."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator
from urllib.parse import urlparse

from backend.pipeline_control.dsn_guard import (
    HOSTED_PROJECT_REF,
    DsnGuardError,
    admit_dsn,
    extract_project_ref,
    load_host_class_fixture,
)

_POOL: Any | None = None
_POOL_DSN: str | None = None


class PoolError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _load_psycopg2() -> Any:
    import psycopg2
    from psycopg2 import pool as psycopg2_pool

    return psycopg2, psycopg2_pool


def _admitted_dsn() -> str:
    dsn = os.environ.get("PIPELINE_CONTROL_DSN")
    if not dsn or not str(dsn).strip():
        raise PoolError("persist_dsn_required")
    admit_dsn(data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"), dsn=dsn)
    parsed = urlparse(str(dsn).strip())
    ref = extract_project_ref(parsed.hostname or "", parsed.username or "")
    forbidden = set(load_host_class_fixture()["forbiddenLocalProjectRefs"])
    if HOSTED_PROJECT_REF in str(dsn) or ref in forbidden or ref == HOSTED_PROJECT_REF:
        raise DsnGuardError("hosted_dsn_rejected")
    return str(dsn).strip()


def close_pool() -> None:
    global _POOL, _POOL_DSN
    if _POOL is not None:
        try:
            _POOL.closeall()
        except Exception:
            pass
    _POOL = None
    _POOL_DSN = None


def get_pool() -> Any:
    global _POOL, _POOL_DSN
    dsn = _admitted_dsn()
    if _POOL is not None and _POOL_DSN == dsn:
        return _POOL
    close_pool()
    try:
        _psycopg2, psycopg2_pool = _load_psycopg2()
    except ImportError as exc:
        raise PoolError("psycopg2_missing") from exc
    try:
        _POOL = psycopg2_pool.ThreadedConnectionPool(1, 8, dsn)
    except Exception as exc:
        raise PoolError("pool_connect_failed") from exc
    _POOL_DSN = dsn
    return _POOL


@contextmanager
def connection() -> Iterator[Any]:
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        pool.putconn(conn)
