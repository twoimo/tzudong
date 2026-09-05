"""Bounded restaurant upsert via postgres RPC. Never per-row REST writes."""

from __future__ import annotations

import json
from typing import Any

from backend.pipeline_control.pool import PoolError, connection
from backend.pipeline_control.impl_selector import runtime_function

BATCH_LIMIT = 200
COMPARE_AND_SET_CONFLICT = "compare_and_set_conflict"
CONDITIONAL_WRITE_FAILED = "conditional_write_failed"
BATCH_UPSERT_LIMIT = "batch_upsert_limit"
BATCH_UPSERT_INVALID = "batch_upsert_invalid"

_RPC_SQL = "SELECT pipeline_control.batch_upsert_restaurants(%s::jsonb)"


class BatchUpsertError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _load_psycopg2() -> Any:
    import psycopg2
    from psycopg2.extras import Json

    return psycopg2, Json


def _decode_result(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise BatchUpsertError(CONDITIONAL_WRITE_FAILED)
    readback = value.get("readback")
    if isinstance(readback, str):
        value = dict(value)
        value["readback"] = json.loads(readback)
    return value


def _map_db_error(exc: BaseException) -> BatchUpsertError:
    pgcode = getattr(exc, "pgcode", None)
    message = str(getattr(exc, "pgerror", None) or exc)
    native = runtime_function("R3-upsert-payload", "map_db_error")
    if native is not None:
        code = native(message, pgcode)
        if code not in {COMPARE_AND_SET_CONFLICT, BATCH_UPSERT_LIMIT, BATCH_UPSERT_INVALID, CONDITIONAL_WRITE_FAILED}:
            code = CONDITIONAL_WRITE_FAILED
        return BatchUpsertError(code)
    if "compare_and_set_conflict" in message:
        return BatchUpsertError(COMPARE_AND_SET_CONFLICT)
    if "batch_upsert_limit" in message:
        return BatchUpsertError(BATCH_UPSERT_LIMIT)
    if "batch_upsert_invalid" in message:
        return BatchUpsertError(BATCH_UPSERT_INVALID)
    if "conditional_write_failed" in message:
        return BatchUpsertError(CONDITIONAL_WRITE_FAILED)
    if pgcode == "40001":
        return BatchUpsertError(COMPARE_AND_SET_CONFLICT)
    return BatchUpsertError(CONDITIONAL_WRITE_FAILED)


def apply_restaurant_batch(operations: list[dict[str, Any]]) -> dict[str, Any]:
    native = runtime_function("R3-upsert-payload", "check_batch_limit")
    if native is not None:
        code = native(len(operations))
        if code is not None:
            raise BatchUpsertError(BATCH_UPSERT_LIMIT if code == BATCH_UPSERT_LIMIT else BATCH_UPSERT_INVALID)
    elif len(operations) > BATCH_LIMIT:
        raise BatchUpsertError(BATCH_UPSERT_LIMIT)
    try:
        with connection() as conn:
            try:
                _psycopg2, Json = _load_psycopg2()
            except ImportError as exc:
                raise PoolError("psycopg2_missing") from exc
            with conn.cursor() as cur:
                cur.execute(_RPC_SQL, (Json(operations),))
                row = cur.fetchone()
    except PoolError:
        raise
    except Exception as exc:
        raise _map_db_error(exc) from exc
    if not row:
        raise BatchUpsertError(CONDITIONAL_WRITE_FAILED)
    return _decode_result(row[0])
