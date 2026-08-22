"""Authoritative local_db snapshots and FileStore run-ID continuity.

FileStore remains the GET source of truth. Overlay compose must not add
Postgres to satisfy this receipt. Three independent REST reads of the local
restaurants relation are hashed separately; mismatched reads fail closed.
"""

from __future__ import annotations

import json
from hashlib import sha256
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.utils.supabase_rest import (
    HostedRestRejected,
    SupabaseRestConfigurationError,
    resolve_privileged_supabase_rest_credentials,
    rest_url_is_hosted,
)

_TERMINAL_SUCCESS = {"succeeded", "dry_run_succeeded"}
_VOLATILE_SUFFIXES = ("_at",)
_RESTAURANTS_QUERY = "rest/v1/restaurants?select=id,trace_id&order=id.asc"
_SNAPSHOT_RANGE = "0-9999"


def canonical_sha256(payload: object) -> str:
    blob = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    return sha256(blob.encode("utf-8")).hexdigest()


def same_run_id_verified(store: MemoryStore | None, run: RunRecord | None) -> bool:
    """True only when one FileStore job id survives enqueue, claim, and success."""

    if store is None or run is None:
        return False
    try:
        current = store.get(run.id)
    except Exception:
        return False
    if current is None or current.id != run.id:
        return False
    audit = getattr(store, "audit", None)
    if not isinstance(audit, list):
        return False
    transitions = {
        str(item.get("transition") or "")
        for item in audit
        if isinstance(item, dict) and item.get("job_id") == run.id
    }
    return "enqueue" in transitions and "claim" in transitions and bool(
        transitions & _TERMINAL_SUCCESS
    )


def _strip_volatile(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in row.items()
        if not any(str(key).endswith(suffix) for suffix in _VOLATILE_SUFFIXES)
    }


def canonicalize_restaurant_rows(rows: list[Any]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        cleaned.append(_strip_volatile(row))
    cleaned.sort(key=canonical_sha256)
    return cleaned


def snapshot_restaurants_relation(
    environment: Mapping[str, object] | None = None,
    *,
    fetch=None,
) -> tuple[str, int] | None:
    """Return (sha256, row_count) for one GET of local_db.restaurants, or None."""

    if fetch is not None:
        rows = fetch()
        if not isinstance(rows, list):
            return None
        canonical = canonicalize_restaurant_rows(rows)
        return canonical_sha256(canonical), len(canonical)

    try:
        credentials = resolve_privileged_supabase_rest_credentials(environment)
    except (HostedRestRejected, SupabaseRestConfigurationError, OSError, ValueError):
        return None
    if rest_url_is_hosted(credentials.url):
        return None
    endpoint = urljoin(credentials.url.rstrip("/") + "/", _RESTAURANTS_QUERY)
    request = Request(
        endpoint,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {credentials.service_role_key}",
            "Prefer": "count=exact",
            "Range": _SNAPSHOT_RANGE,
            "apikey": credentials.service_role_key,
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read()
            content_range = response.headers.get("Content-Range") or ""
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return None
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, list):
        return None
    if "/" in content_range:
        total_token = content_range.rsplit("/", 1)[-1].strip()
        if total_token.isdigit() and int(total_token) > len(payload):
            return None
    canonical = canonicalize_restaurant_rows(payload)
    return canonical_sha256(canonical), len(canonical)


def independent_local_db_snapshots(
    environment: Mapping[str, object] | None = None,
    *,
    fetch=None,
    reads: int = 3,
) -> list[tuple[str, int]]:
    snapshots: list[tuple[str, int]] = []
    for _ in range(reads):
        snapshot = snapshot_restaurants_relation(environment, fetch=fetch)
        if snapshot is None:
            return []
        snapshots.append(snapshot)
    return snapshots
