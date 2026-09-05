"""Fixed-SQL adapter for the publication-only Postgres RPCs.

The adapter is deliberately connection-agnostic. A Backend_Runtime process may
inject an already-authorized SQL executor only after the external hosted gates
have passed; importing this module cannot read a DSN or open a connection.
Every target, selected column, cast, and RPC name is fixed in source. Database
diagnostics are reduced to the PublishWorker exception classes and are never
copied into a response or audit row.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence

from backend.pipeline_control.batch_upsert import BATCH_LIMIT
from backend.pipeline_control.publish_worker import (
    HostedApplyConflict,
    HostedApplyFailure,
    HostedBatchLimitError,
    PublicationSet,
)

ExecuteOne = Callable[[str, tuple[Any, ...]], Any]
ExecuteAll = Callable[[str, tuple[Any, ...]], Sequence[Mapping[str, Any]]]


@dataclass(frozen=True)
class _TablePlan:
    rpc_sql: str
    read_sql: str
    published_columns: frozenset[str]
    cas_keys: tuple[str, ...]
    required_insert_columns: frozenset[str]
    nullable_cas_keys: frozenset[str] = frozenset()


_RESTAURANT_COLUMNS = frozenset(
    {
        "approved_name",
        "origin_name",
        "naver_name",
        "google_name",
        "trace_id_name_source",
        "trace_id",
        "phone",
        "categories",
        "status",
        "source_type",
        "channel_name",
        "youtube_link",
        "youtube_meta",
        "description_map_url",
        "evaluation_results",
        "reasoning_basis",
        "tzuyang_review",
        "origin_address",
        "road_address",
        "jibun_address",
        "english_address",
        "address_elements",
        "lat",
        "lng",
        "geocoding_success",
        "geocoding_false_stage",
        "is_missing",
        "is_not_selected",
        "recollect_version",
    }
)
_VIDEO_COLUMNS = frozenset(
    {
        "youtube_link",
        "channel_name",
        "title",
        "published_at",
        "duration",
        "category",
        "meta_history",
        "view_count",
        "like_count",
        "comment_count",
    }
)

# These statements contain no caller-controlled identifiers. The read surface
# includes CAS-only updated_at but never returns row-owned/private table data.
_TABLE_PLANS: Mapping[str, _TablePlan] = {
    "public.restaurants": _TablePlan(
        rpc_sql="SELECT pipeline_control.publish_upsert_restaurants(%s::jsonb)",
        read_sql=(
            "SELECT id, approved_name, origin_name, naver_name, google_name, "
            "trace_id_name_source, trace_id, phone, categories, status, source_type, "
            "channel_name, youtube_link, youtube_meta, description_map_url, "
            "evaluation_results, reasoning_basis, tzuyang_review, origin_address, "
            "road_address, jibun_address, english_address, address_elements, lat, lng, "
            "geocoding_success, geocoding_false_stage, is_missing, is_not_selected, "
            "recollect_version, updated_at FROM public.restaurants "
            "WHERE id = ANY(%s::uuid[])"
        ),
        published_columns=_RESTAURANT_COLUMNS,
        cas_keys=("id", "trace_id", "updated_at"),
        required_insert_columns=frozenset({"id"}),
        nullable_cas_keys=frozenset({"trace_id"}),
    ),
    "public.videos": _TablePlan(
        rpc_sql="SELECT pipeline_control.publish_upsert_videos(%s::jsonb)",
        read_sql=(
            "SELECT id, youtube_link, channel_name, title, published_at, duration, "
            "category, meta_history, view_count, like_count, comment_count, updated_at "
            "FROM public.videos WHERE id = ANY(%s::text[])"
        ),
        published_columns=_VIDEO_COLUMNS,
        cas_keys=("id", "updated_at"),
        required_insert_columns=frozenset({"id", "youtube_link", "channel_name"}),
    ),
}


def _database_primary_code(exc: BaseException) -> str | None:
    """Read only a bounded primary code; never stringify a database exception."""

    diag = getattr(exc, "diag", None)
    primary = getattr(diag, "message_primary", None)
    if primary in {
        "compare_and_set_conflict",
        "batch_upsert_limit",
        "batch_upsert_invalid",
        "conditional_write_failed",
    }:
        return primary
    return None


def _raise_bounded_database_failure(exc: BaseException) -> None:
    code = _database_primary_code(exc)
    pgcode = getattr(exc, "pgcode", None)
    if code == "compare_and_set_conflict" or pgcode in {"23505", "40001"}:
        raise HostedApplyConflict() from exc
    if code == "batch_upsert_limit":
        raise HostedBatchLimitError() from exc
    raise HostedApplyFailure() from exc


class PublicationSqlAdapter:
    """Adapt fixed SQL executors to PublishWorker's hosted apply/read callables.

    ``execute_one`` accepts one fixed statement plus its positional parameters
    and returns the scalar RPC result. ``execute_all`` returns mapping rows. The
    constructor performs no I/O, and this class does not obtain credentials.
    """

    def __init__(
        self,
        publication_set: PublicationSet,
        *,
        execute_one: ExecuteOne,
        execute_all: ExecuteAll,
    ) -> None:
        self._publication_set = publication_set
        self._execute_one = execute_one
        self._execute_all = execute_all

    def _admitted_plan(self, table_key: str) -> _TablePlan:
        plan = _TABLE_PLANS.get(table_key)
        table = self._publication_set.tables.get(table_key)
        if (
            plan is None
            or table is None
            or table.published_columns != plan.published_columns
            or table.cas_keys != plan.cas_keys
            or table.identity_keys != ("id",)
        ):
            raise HostedApplyFailure()
        return plan

    def read(self, table_key: str, signatures: list[tuple]) -> list[dict[str, Any]]:
        plan = self._admitted_plan(table_key)
        identities: list[str] = []
        for signature in signatures:
            if (
                not isinstance(signature, tuple)
                or len(signature) != 1
                or not isinstance(signature[0], str)
                or not signature[0]
            ):
                raise HostedApplyFailure()
            identities.append(signature[0])
        if not identities:
            return []
        try:
            rows = self._execute_all(plan.read_sql, (identities,))
        except (HostedApplyConflict, HostedApplyFailure, HostedBatchLimitError):
            raise
        except Exception as exc:
            _raise_bounded_database_failure(exc)
        if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
            raise HostedApplyFailure()
        normalized: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, Mapping):
                raise HostedApplyFailure()
            normalized.append(dict(row))
        return normalized

    def apply(self, table_key: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        if len(rows) > BATCH_LIMIT:
            raise HostedBatchLimitError()
        plan = self._admitted_plan(table_key)
        table = self._publication_set.tables[table_key]
        if not rows:
            return {"inserted_count": 0, "updated_count": 0, "readback": []}

        signatures: list[tuple] = []
        normalized_rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, Mapping):
                raise HostedApplyFailure()
            keys = set(row)
            identity = row.get("id")
            if (
                not keys.issubset(table.allowed_columns)
                or keys.isdisjoint(plan.published_columns)
                or not isinstance(identity, str)
                or not identity
                or identity in seen
            ):
                raise HostedApplyFailure()
            seen.add(identity)
            signatures.append((identity,))
            normalized_rows.append(dict(row))

        try:
            current_rows = self.read(table_key, signatures)
        except (HostedApplyConflict, HostedBatchLimitError):
            raise
        except HostedApplyFailure:
            raise

        current_by_id: dict[str, Mapping[str, Any]] = {}
        for current in current_rows:
            identity = current.get("id")
            if not isinstance(identity, str) or not identity or identity in current_by_id:
                raise HostedApplyFailure()
            current_by_id[identity] = current

        operations: list[dict[str, Any]] = []
        for row in normalized_rows:
            identity = row["id"]
            current = current_by_id.get(identity)
            if current is None:
                if not plan.required_insert_columns.issubset(row):
                    raise HostedApplyFailure()
                operations.append({"op": "insert", "payload": row})
                continue
            if any(key not in current for key in plan.cas_keys):
                raise HostedApplyFailure()
            expected = {key: current[key] for key in plan.cas_keys}
            if any(value is None and key not in plan.nullable_cas_keys for key, value in expected.items()):
                raise HostedApplyFailure()
            operations.append({"op": "update", "payload": row, "expected": expected})

        encoded = json.dumps(
            operations,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        try:
            result = self._execute_one(plan.rpc_sql, (encoded,))
        except (HostedApplyConflict, HostedApplyFailure, HostedBatchLimitError):
            raise
        except Exception as exc:
            _raise_bounded_database_failure(exc)

        if isinstance(result, str):
            try:
                result = json.loads(result)
            except (TypeError, ValueError) as exc:
                raise HostedApplyFailure() from exc
        if not isinstance(result, Mapping):
            raise HostedApplyFailure()
        return dict(result)


__all__ = ["PublicationSqlAdapter"]
