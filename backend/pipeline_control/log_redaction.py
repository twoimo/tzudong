"""Log_Pipeline Redaction_Boundary step (design B, requirements 13.3, 13.5,
13.8, 13.9, 13.15).

This module is the value-level redaction stage of the Log_Pipeline. It runs
*after* the field/class/allowlist gate :func:`log_pipeline.enforce_record_contract`
(Task 22) and *before* any Log_Sink write. The seam described in
``log_pipeline.py`` -- ``sanitize_log_value(enforce_record_contract(record))`` --
is realised here as :func:`prepare_record_for_sink`.

What this stage guarantees (fail-closed)
----------------------------------------
1. Every record passes through the shared Redaction_Boundary
   (:func:`backend.utils.privacy_log.sanitize_log_value`). A record that cannot
   be routed through the boundary as a JSON object is not forwarded
   (requirement 13.3).
2. Forbidden_Log_Field values are replaced with the shared fixed markers
   ``REDACTED = "[REDACTED]"`` / ``TRUNCATED = "[TRUNCATED]"`` carried by
   ``privacy_log``. Those markers carry no substring, length, or hash of the
   original value, and the same value class always maps to the same marker
   (requirement 13.5). This stage does not invent a new marker; it relies on the
   shared boundary's deterministic markers.
3. The four bounds are enforced: strings <= 4096 chars, <= 100 entries, depth
   <= 8, serialized size <= 65536 bytes. String/entry/depth bounds come from the
   shared boundary; the serialized-size bound is enforced here. Overflow is
   replaced with the fixed ``TRUNCATED`` marker (requirement 13.8).
4. Exception information is limited to a bounded exception *type name*
   (<= 128 chars) via :func:`backend.utils.privacy_log.safe_error_name`. No
   exception message, stack, or provider/database diagnostic is ever surfaced
   (requirements 13.9, 13.15).
5. If the redaction step raises, or the redacted result still carries the unsafe
   marker (``PRIVACY_UNSAFE_VALUE``, the sentinel the web ``sanitize.ts``
   boundary emits), the record is not forwarded and the bounded fixed code
   ``log_redaction_unsafe`` is returned/raised (requirement 13.15).

Depth alignment (requirement 13.8)
----------------------------------
``privacy_log.py`` keeps ``DEFAULT_MAX_DEPTH = 6`` because it is a *shared*
redaction boundary used by other call sites (``es_index.py``, ``loki_sink.py``,
route/handler redaction). This module does **not** edit that shared default.
Instead it passes ``max_depth=8`` through :func:`sanitize_log_value` at the
Log_Pipeline boundary so the backend boundary matches the web ``sanitize.ts``
boundary, which already defaults to depth 8. Raising the depth for this stage is
an *alignment* of the two boundaries to requirement 13.8's stated depth, not a
relaxation of the shared default: it lets deeper (up to 8) structure survive,
and every surviving value is still fully redacted and bounded.

Boundaries with adjacent tasks
------------------------------
- The field/class/allowlist gate is Task 22 (``log_pipeline.py``).
- The pending queue / retry / status-decision separation is Task 24.
- The dedicated property-based tests for redaction leak (Property 28, Task 25.4)
  and log bounds (Property 30, Task 25.6) are separate; this module ships
  focused unit tests only.

Only bounded fixed codes are surfaced from this module; provider and database
error strings are never exposed (AGENTS.md).
"""

from __future__ import annotations

import json
from typing import Any

from backend.pipeline_control.log_pipeline import (
    REQUIRED_FIELDS,
    enforce_record_contract,
)
from backend.utils.privacy_log import (
    REDACTED,
    TRUNCATED,
    safe_error_name,
    sanitize_log_value,
)

# --- Aligned bounds (design B / requirement 13.8) -------------------------
# Depth is aligned to the web sanitize.ts boundary (8), NOT by editing the
# shared privacy_log.py default (6) but by passing this value through the
# wrapper below. String/entry limits already match the shared boundary.
MAX_DEPTH = 8
MAX_ENTRIES = 100
MAX_STRING_LENGTH = 4096
MAX_SERIALIZED_BYTES = 65536

# --- Fixed code (design fixed-code table, requirement 13.15) --------------
CODE_REDACTION_UNSAFE = "log_redaction_unsafe"

# --- Unsafe marker (design B, requirement 13.15) --------------------------
# The web sanitize.ts boundary emits ``PRIVACY_UNSAFE_VALUE`` when it cannot
# guarantee a safe result. The backend boundary does not emit this sentinel,
# but the Log_Pipeline scans for it so that a record carrying the marker from
# any origin (or a value literally containing it) is treated as unsafe and not
# forwarded.
UNSAFE_MARKER = "PRIVACY_UNSAFE_VALUE"

# Identity fields that are preserved when a bounded record still overflows the
# serialized-size bound. These are the four required fields plus ``type``; all
# are members of every Log_Record_Class allowlist, so keeping only these never
# widens the key set beyond the class allowlist (requirement 13.7).
_IDENTITY_KEYS: frozenset[str] = frozenset(REQUIRED_FIELDS) | {"type"}


class LogRedactionError(Exception):
    """Bounded fixed-code error for the Log_Pipeline Redaction_Boundary step.

    ``code`` is always :data:`CODE_REDACTION_UNSAFE`. ``error_name`` is at most a
    128-char, redacted exception *type name* (never a message or stack), so a
    caller can log ``(code, error_name)`` and nothing else (requirements 13.9,
    13.15).
    """

    def __init__(self, code: str, error_name: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.error_name = error_name


def _serialized_size(record: dict[str, Any]) -> int:
    """Byte size of the record as it would reach a Log_Sink.

    Matches the sink serialization (``sort_keys``, compact separators, the
    default ASCII escaping) so the measured size equals the payload the sink
    writes.
    """
    return len(
        json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )


def _enforce_serialized_bound(record: dict[str, Any]) -> dict[str, Any]:
    """Keep the serialized record within :data:`MAX_SERIALIZED_BYTES`.

    The string/entry/depth bounds are already applied by the shared boundary, so
    this only guards the aggregate serialized size. Overflow is replaced with
    the fixed ``TRUNCATED`` marker deterministically:

    1. If it already fits, return unchanged.
    2. Otherwise keep identity-field values and replace every other value with
       the fixed ``TRUNCATED`` marker (key set unchanged, so still a subset of
       the class allowlist).
    3. As a last resort keep only the identity fields. Identity values are
       themselves bounded (<= 4096 chars each, <= 5 fields), so this always
       fits; if it somehow does not, fail closed.
    """
    if _serialized_size(record) <= MAX_SERIALIZED_BYTES:
        return record

    reduced: dict[str, Any] = {}
    for key, value in record.items():
        reduced[key] = value if key in _IDENTITY_KEYS else TRUNCATED
    if _serialized_size(reduced) <= MAX_SERIALIZED_BYTES:
        return reduced

    minimal = {key: value for key, value in reduced.items() if key in _IDENTITY_KEYS}
    if _serialized_size(minimal) <= MAX_SERIALIZED_BYTES:
        return minimal

    # Unreachable given the bounds above; fail closed rather than forward an
    # oversized record.
    raise LogRedactionError(CODE_REDACTION_UNSAFE)


def _contains_unsafe_marker(record: dict[str, Any]) -> bool:
    """True if the serialized redacted record still carries the unsafe marker."""
    return UNSAFE_MARKER in json.dumps(
        record, sort_keys=True, separators=(",", ":")
    )


def redact_record(record: dict[str, Any]) -> dict[str, Any]:
    """Apply the Redaction_Boundary to an already contract-enforced record.

    Routes the record through the shared ``sanitize_log_value`` boundary with
    the depth aligned to 8, enforces the serialized-size bound, and rejects any
    result that still carries the unsafe marker. On any failure the record is
    not forwarded: :class:`LogRedactionError` with :data:`CODE_REDACTION_UNSAFE`
    is raised, carrying only a bounded exception type name (requirements 13.3,
    13.5, 13.8, 13.9, 13.15).
    """
    try:
        sanitized = sanitize_log_value(
            record,
            max_depth=MAX_DEPTH,
            max_entries=MAX_ENTRIES,
            max_string_length=MAX_STRING_LENGTH,
        )
        if not isinstance(sanitized, dict):
            raise LogRedactionError(CODE_REDACTION_UNSAFE)
        bounded = _enforce_serialized_bound(sanitized)
        if _contains_unsafe_marker(bounded):
            raise LogRedactionError(CODE_REDACTION_UNSAFE)
        return bounded
    except LogRedactionError:
        raise
    except BaseException as exc:  # noqa: BLE001 - fail closed, bounded name only
        raise LogRedactionError(
            CODE_REDACTION_UNSAFE, error_name=safe_error_name(exc)
        ) from None


def prepare_record_for_sink(record: dict[str, Any]) -> dict[str, Any]:
    """Full Log_Pipeline pre-sink projection: contract gate then redaction.

    Composition of Task 22 and Task 23:
    ``redact_record(enforce_record_contract(record))``. The contract gate's
    bounded fixed codes (``log_record_field_missing``,
    ``log_record_class_unknown``) propagate unchanged as
    :class:`log_pipeline.LogPipelineError`; redaction-stage failures surface as
    :class:`LogRedactionError` (``log_redaction_unsafe``). A record reaches a
    Log_Sink only when this function returns without raising (requirement 13.3).
    """
    contracted = enforce_record_contract(record)
    return redact_record(contracted)


# Re-exported for callers that assert on the shared markers.
__all__ = [
    "CODE_REDACTION_UNSAFE",
    "MAX_DEPTH",
    "MAX_ENTRIES",
    "MAX_SERIALIZED_BYTES",
    "MAX_STRING_LENGTH",
    "REDACTED",
    "TRUNCATED",
    "UNSAFE_MARKER",
    "LogRedactionError",
    "prepare_record_for_sink",
    "redact_record",
]
