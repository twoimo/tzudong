"""Manifest staleness / health rule and missed-window derivation.

Pure, secret-free logic for Requirements 5.7 and 6.2. Nothing here reads
secrets, contacts a provider, or records provider/DB diagnostics: every input
is a plain manifest dict or a date, and every output is a ``bool`` or a
non-negative ``int``.

- ``run_is_healthy`` fails closed: a manifest whose ``date`` is earlier than the
  current UTC date, or the absence of any manifest for the current UTC date, is
  treated as not-Succeeded. Only a today-dated ``Succeeded``/``OK`` manifest is
  healthy (R5.7).
- ``missed_window_count`` derives the coalesced missed-window count from the
  last-successful manifest date versus the current UTC date, with no provider or
  database detail (R6.2).
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from backend.pipeline_control.manifest import (
    FINAL_STATUS_ERROR,
    FINAL_STATUS_OK,
    RUN_STATUS_FAILED,
    RUN_STATUS_SUCCEEDED,
)

_DATE_FORMAT = "%Y-%m-%d"
_TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# Fixed known evidence locations (R5.1). ``current-summary.json`` is the
# Run_Manifest; ``current-health.json`` is the derived health outcome the GHA
# evidence artifact publishes alongside it (R5.3, R5.7).
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST_PATH = REPO_ROOT / "backend" / "log" / "cron" / "current-summary.json"
DEFAULT_HEALTH_PATH = REPO_ROOT / "backend" / "log" / "cron" / "current-health.json"

# Bounded reported-status vocabulary for the health outcome. A run is reported
# ``Succeeded`` only when a today-dated success manifest is present; every other
# case (stale, absent, malformed, or failed) is ``NotSucceeded`` (fail closed).
REPORTED_STATUS_SUCCEEDED = "Succeeded"
REPORTED_STATUS_NOT_SUCCEEDED = "NotSucceeded"

# The bounded final-status tokens a manifest may legitimately carry. Anything
# else is normalized to ``None`` in the health outcome so no free-form value
# leaks through the reporting path (R5.9).
_KNOWN_FINAL_STATUSES = frozenset(
    {FINAL_STATUS_OK, FINAL_STATUS_ERROR, RUN_STATUS_SUCCEEDED, RUN_STATUS_FAILED}
)

# A manifest is only healthy when its final status is one of these success
# tokens. ``write_run_manifest`` records ``finalStatus`` in the OK/ERROR
# vocabulary; ``Succeeded`` is accepted defensively for callers holding the
# run-status vocabulary. Every other value (including ``ERROR``/``Failed``) is
# not healthy.
_HEALTHY_STATUSES = frozenset({FINAL_STATUS_OK, RUN_STATUS_SUCCEEDED})


def current_utc_date() -> date:
    """Return today's date in UTC."""

    return datetime.now(timezone.utc).date()


def _coerce_date(value: Any) -> date | None:
    """Coerce a date, datetime, or ``%Y-%m-%d`` string to a ``date``.

    Returns ``None`` for anything malformed so callers fail closed rather than
    raising on an untrusted manifest field.
    """

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.strptime(value, _DATE_FORMAT).date()
        except ValueError:
            return None
    return None


def run_is_healthy(manifest: Any, *, today: Any = None) -> bool:
    """Return whether ``manifest`` represents a healthy run for the current day.

    Fail closed (return ``False``) when the manifest is absent/malformed, its
    ``date`` is earlier than the current UTC date (stale), or its ``date`` is not
    the current UTC date. A run is healthy only when a manifest dated the current
    UTC date carries a success final status (R5.7).
    """

    reference = _coerce_date(today) if today is not None else current_utc_date()
    if reference is None:
        return False
    if not isinstance(manifest, dict):
        return False
    manifest_date = _coerce_date(manifest.get("date"))
    if manifest_date is None:
        return False
    # Stale (earlier) or otherwise not the current UTC date -> not healthy.
    if manifest_date != reference:
        return False
    return manifest.get("finalStatus") in _HEALTHY_STATUSES


def manifest_is_stale(manifest: Any, *, today: Any = None) -> bool:
    """Return whether ``manifest`` is absent, malformed, or earlier than today.

    A missing/malformed manifest and one dated before the current UTC date are
    both stale. A today-dated manifest is not stale regardless of its final
    status (staleness is about age, not success).
    """

    reference = _coerce_date(today) if today is not None else current_utc_date()
    if reference is None or not isinstance(manifest, dict):
        return True
    manifest_date = _coerce_date(manifest.get("date"))
    if manifest_date is None:
        return True
    return manifest_date < reference


def last_success_date_from_manifest(manifest: Any) -> date | None:
    """Return the ``date`` of a successful manifest, else ``None``.

    Only a manifest carrying a success final status contributes a
    last-successful date; a failed or malformed manifest yields ``None`` so it
    never anchors the missed-window derivation.
    """

    if not isinstance(manifest, dict):
        return None
    if manifest.get("finalStatus") not in _HEALTHY_STATUSES:
        return None
    return _coerce_date(manifest.get("date"))


def missed_window_count(last_success_date: Any, *, today: Any = None) -> int:
    """Derive the coalesced missed-window count since the last success (R6.2).

    With one daily cadence window, the number of fully-missed windows is the
    count of days strictly between the last-successful run date and the current
    UTC date: ``gap - 1`` where ``gap`` is the day difference. A same-day or
    consecutive-day success (gap <= 1) has no missed window and returns ``0``;
    a gap of two or more days returns ``gap - 1``.

    Inputs that are absent, malformed, or in the future (last success after the
    current date) return ``0``. The result is a bounded non-negative integer and
    carries no provider or database detail.
    """

    reference = _coerce_date(today) if today is not None else current_utc_date()
    last = _coerce_date(last_success_date)
    if reference is None or last is None:
        return 0
    gap = (reference - last).days
    if gap <= 1:
        return 0
    return gap - 1


def _load_manifest(path: Path) -> dict | None:
    """Read a Run_Manifest, returning ``None`` on any read/parse failure.

    A missing, unreadable, or non-object manifest is treated as absent so the
    caller fails closed (R5.7). No filesystem or provider diagnostics surface.
    """

    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def build_health_report(manifest: Any, *, today: Any = None) -> dict:
    """Derive the bounded, secret-free health outcome for a Run_Manifest.

    Governs stale/absent-manifest reporting (R5.7): the ``reportedStatus`` is
    ``Succeeded`` only when a today-dated success manifest is present, and
    ``NotSucceeded`` for every stale, absent, malformed, or failed manifest. The
    coalesced missed-window count (R6.2) is derived from the last-successful
    manifest date. Every field is a bounded primitive; no secret, credential, or
    provider/DB diagnostic is recorded (R5.9).
    """

    reference = _coerce_date(today) if today is not None else current_utc_date()
    healthy = run_is_healthy(manifest, today=reference)
    stale = manifest_is_stale(manifest, today=reference)
    present = isinstance(manifest, dict)
    final_status = manifest.get("finalStatus") if present else None
    if final_status not in _KNOWN_FINAL_STATUSES:
        final_status = None
    missed = missed_window_count(last_success_date_from_manifest(manifest), today=reference)
    reference_str = reference.strftime(_DATE_FORMAT) if reference is not None else None
    return {
        "generatedAt": datetime.now(timezone.utc).strftime(_TIMESTAMP_FORMAT),
        "date": reference_str,
        "manifestPresent": present,
        "manifestStale": stale,
        "healthy": healthy,
        "reportedStatus": (
            REPORTED_STATUS_SUCCEEDED if healthy else REPORTED_STATUS_NOT_SUCCEEDED
        ),
        "finalStatus": final_status,
        "missedWindowCount": missed,
    }


def write_health_report(
    manifest_path: Path | None = None,
    health_path: Path | None = None,
    *,
    today: Any = None,
) -> dict:
    """Read the Run_Manifest at ``manifest_path`` and write the health outcome.

    The Run_Manifest is read from the fixed known location (R5.1) and the derived
    outcome is written atomically to ``health_path`` so the GHA evidence artifact
    can publish it (R5.3). Returns the report dict.
    """

    manifest = _load_manifest(manifest_path or DEFAULT_MANIFEST_PATH)
    report = build_health_report(manifest, today=today)
    destination = health_path or DEFAULT_HEALTH_PATH
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destination.with_name(destination.name + ".tmp")
    tmp_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(str(tmp_path), str(destination))
    return report
