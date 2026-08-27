"""Cadence schedule validation and fixed KST (UTC+9) derivation.

Pure-logic module for Requirement 1 of the crawler-pipeline-orchestration
feature. It provides:

- ``validate_cadence(config)`` — a pure validator that rejects overlapping
  windows, sub-buffer gaps, and GHA-after-Mac ordering, returning a bounded
  ``errorCode`` from a closed set and identifying the conflicting windows.
- A fixed UTC+9 (540 minute) KST derivation helper with no daylight-saving
  adjustment.

The module performs no I/O and reads no environment. Callers (worker /
entrypoint preflight, task 1.3) pass an already-parsed configuration mapping.
"""

from __future__ import annotations

from typing import Any, Mapping

# Fixed Korea Standard Time offset. KST is UTC+9 year round with no
# daylight-saving adjustment, so the offset is always exactly 540 minutes.
KST_UTC_OFFSET_MINUTES = 540
MINUTES_PER_DAY = 24 * 60

# Runner identities the ordering rule is expressed against.
GHA_RUNNER = "GHA_Runner"
MAC_RUNNER = "Mac_Runner"

# Default buffer used when a config omits ``minBufferMinutes``.
DEFAULT_MIN_BUFFER_MINUTES = 30

# Closed set of rejection codes. ``None`` (JSON null) means accepted.
ERROR_WINDOWS_OVERLAP = "windows_overlap"
ERROR_BUFFER_TOO_SMALL = "buffer_too_small"
ERROR_ORDER_VIOLATION = "order_violation"
ERROR_WINDOW_SHAPE_INVALID = "window_shape_invalid"

CADENCE_ERROR_CODES = frozenset(
    {
        None,
        ERROR_WINDOWS_OVERLAP,
        ERROR_BUFFER_TOO_SMALL,
        ERROR_ORDER_VIOLATION,
        ERROR_WINDOW_SHAPE_INVALID,
    }
)


def kst_offset_minutes() -> int:
    """Return the fixed KST offset (540 minutes), never DST-adjusted."""

    return KST_UTC_OFFSET_MINUTES


def utc_to_kst_minutes(utc_minutes: int) -> int:
    """Derive the KST minute-of-day from a UTC minute-of-day.

    Applies the fixed UTC+9 offset (540 minutes) with wraparound and no
    daylight-saving adjustment.
    """

    if not isinstance(utc_minutes, int) or isinstance(utc_minutes, bool):
        raise TypeError("utc_minutes must be an int")
    return (utc_minutes + KST_UTC_OFFSET_MINUTES) % MINUTES_PER_DAY


def kst_to_utc_minutes(kst_minutes: int) -> int:
    """Inverse of :func:`utc_to_kst_minutes` using the same fixed offset."""

    if not isinstance(kst_minutes, int) or isinstance(kst_minutes, bool):
        raise TypeError("kst_minutes must be an int")
    return (kst_minutes - KST_UTC_OFFSET_MINUTES) % MINUTES_PER_DAY


def _parse_hhmm(value: Any) -> int | None:
    """Parse an ``HH:MM`` 24-hour string to a minute-of-day, else ``None``."""

    if not isinstance(value, str):
        return None
    parts = value.split(":")
    if len(parts) != 2:
        return None
    hh, mm = parts
    if not (hh.isdigit() and mm.isdigit()):
        return None
    if len(hh) != 2 or len(mm) != 2:
        return None
    hours = int(hh)
    minutes = int(mm)
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None
    return hours * 60 + minutes


def _result(ok: bool, error_code: str | None, conflicting: list[str]) -> dict:
    return {"ok": ok, "errorCode": error_code, "conflictingWindows": conflicting}


def _window_label(window: Mapping[str, Any], index: int) -> str:
    runner = window.get("runner") if isinstance(window, Mapping) else None
    if isinstance(runner, str) and runner:
        return runner
    return f"window[{index}]"


def validate_cadence(config: Any) -> dict:
    """Validate a cadence configuration.

    Returns ``{"ok": bool, "errorCode": str|None, "conflictingWindows": [...]}``
    where ``errorCode`` is drawn from the closed set
    ``{None, "windows_overlap", "buffer_too_small", "order_violation",
    "window_shape_invalid"}``.

    Rejection precedence (first failure wins):
      1. malformed config or window shape -> ``window_shape_invalid``
      2. any two windows overlap -> ``windows_overlap``
      3. GHA_Runner does not precede Mac_Runner -> ``order_violation``
      4. any consecutive gap below the minimum buffer -> ``buffer_too_small``

    The function is pure: it reads no environment and performs no I/O.
    """

    if not isinstance(config, Mapping):
        return _result(False, ERROR_WINDOW_SHAPE_INVALID, [])

    raw_windows = config.get("windows")
    if not isinstance(raw_windows, (list, tuple)) or len(raw_windows) == 0:
        return _result(False, ERROR_WINDOW_SHAPE_INVALID, [])

    min_buffer = config.get("minBufferMinutes", DEFAULT_MIN_BUFFER_MINUTES)
    if isinstance(min_buffer, bool) or not isinstance(min_buffer, int) or min_buffer < 0:
        return _result(False, ERROR_WINDOW_SHAPE_INVALID, [])

    # 1. Shape validation for each window.
    parsed: list[tuple[str, int, int]] = []
    for index, window in enumerate(raw_windows):
        if not isinstance(window, Mapping):
            return _result(False, ERROR_WINDOW_SHAPE_INVALID, [f"window[{index}]"])
        label = _window_label(window, index)
        start = _parse_hhmm(window.get("kstStart"))
        end = _parse_hhmm(window.get("kstEnd"))
        if start is None or end is None or end <= start:
            return _result(False, ERROR_WINDOW_SHAPE_INVALID, [label])
        parsed.append((label, start, end))

    # 2. Overlap: any two windows sharing time. Report the earliest-starting
    #    overlapping pair for stability.
    ordered = sorted(range(len(parsed)), key=lambda i: (parsed[i][1], parsed[i][2]))
    for a_pos in range(len(ordered)):
        a_label, a_start, a_end = parsed[ordered[a_pos]]
        for b_pos in range(a_pos + 1, len(ordered)):
            b_label, b_start, b_end = parsed[ordered[b_pos]]
            if a_start < b_end and b_start < a_end:
                return _result(False, ERROR_WINDOWS_OVERLAP, [a_label, b_label])

    windows_by_runner = {label: (start, end) for label, start, end in parsed}

    # 3. Ordering: GHA_Runner must precede Mac_Runner when both are present.
    gha = windows_by_runner.get(GHA_RUNNER)
    mac = windows_by_runner.get(MAC_RUNNER)
    if gha is not None and mac is not None:
        _, gha_end = gha
        mac_start, _ = mac
        if gha_end > mac_start:
            return _result(False, ERROR_ORDER_VIOLATION, [GHA_RUNNER, MAC_RUNNER])

    # 4. Buffer: every consecutive pair (by start time) must be separated by at
    #    least the minimum buffer.
    for pos in range(len(ordered) - 1):
        cur_label, _, cur_end = parsed[ordered[pos]]
        next_label, next_start, _ = parsed[ordered[pos + 1]]
        if next_start - cur_end < min_buffer:
            return _result(False, ERROR_BUFFER_TOO_SMALL, [cur_label, next_label])

    return _result(True, None, [])
