"""Log_Pipeline record contract: required fields, component/severity enums, and
per-Log_Record_Class field allowlists.

This module is the field/class/allowlist gate of the Log_Pipeline (design C9,
requirements 13.1, 13.2, 13.4, 13.14). It runs *before* any Log_Sink write and
enforces, fail-closed:

1. The five Component identifiers (design B / C9): every record must carry
   exactly one of them in ``component``.
2. The four required fields ``component``, ``occurred_at``, ``correlation_id``,
   ``severity`` (requirement 13.2). ``severity`` must be one of the enumerated
   levels ``debug`` | ``info`` | ``warn`` | ``error``. Any absent required field,
   an unlisted ``component`` value, or an unlisted ``severity`` value yields the
   bounded fixed code ``log_record_field_missing`` and no forwarding
   (requirement 13.14).
3. A per-Log_Record_Class field allowlist (design C9 table). Only allowlisted
   keys survive; every other key is dropped before forwarding. A record whose
   class is not in the enumerated set yields the bounded fixed code
   ``log_record_class_unknown`` and no forwarding (requirement 13.4).

Boundary with adjacent tasks
----------------------------
- The Redaction_Boundary application (depth alignment, string/entry/depth/size
  bounds, ``PRIVACY_UNSAFE_VALUE`` handling) is Task 23. It runs *after* this
  gate, on the allowlisted dict returned by :func:`enforce_record_contract`.
  The seam is intentionally kept as a single function so Task 23 can wrap it:
  ``sanitize_log_value(enforce_record_contract(record))``.
- The pending queue / retry / status-decision separation is Task 24.

This gate structurally excludes Forbidden_Log_Field: the allowlist drops any key
not enumerated for the record class, so a key carrying a forbidden value never
reaches the sink. Task 23 additionally redacts the *values* of the surviving
allowlisted keys. Only bounded fixed codes are surfaced; provider/database error
strings are never exposed (AGENTS.md).

Allowlist provenance
--------------------
The class allowlists below are transcribed from the design C9 table. They extend
the existing, validated ``es_index.py`` ``LOG_ALLOWLIST`` / ``RAW_ALLOWLIST`` into
a per-class scheme and always include the four required fields. The design table
uses an incremental "위 +" (previous row plus …) notation for the three ES log
classes; that notation is expanded explicitly here so each class stands alone.
"""

from __future__ import annotations

from typing import Any

# --- Component identifiers (design B / C9) --------------------------------
# Each record is assigned exactly one of these five values so that a single
# query path can filter by component (requirement 13.1).
COMPONENT_IDENTIFIERS: frozenset[str] = frozenset(
    {
        "web_app",
        "backend_runtime",
        "publish_worker",
        "observability_stack",
        "ops_agent",
    }
)

# --- Severity enum (design C9, requirement 13.2) --------------------------
SEVERITY_LEVELS: frozenset[str] = frozenset({"debug", "info", "warn", "error"})

# --- Required fields (design C9, requirements 13.2, 13.14) ----------------
REQUIRED_FIELDS: tuple[str, ...] = (
    "component",
    "occurred_at",
    "correlation_id",
    "severity",
)

# --- Fixed codes ----------------------------------------------------------
CODE_FIELD_MISSING = "log_record_field_missing"
CODE_CLASS_UNKNOWN = "log_record_class_unknown"

# --- Per-Log_Record_Class field allowlists (design C9 table) --------------
# The four required fields are the common prefix of every class.
_REQUIRED = frozenset(REQUIRED_FIELDS)

# run.lifecycle base (design C9): required + ES log fields.
_RUN_LIFECYCLE = _REQUIRED | frozenset(
    {"type", "job_id", "status", "target", "profile", "request_id"}
)
# step.progress = run.lifecycle + {step, index, skipped}  (design "위 +").
_STEP_PROGRESS = _RUN_LIFECYCLE | frozenset({"step", "index", "skipped"})
# record.upserted = step.progress + {index}  (design "위 +"); index already
# present in step.progress, kept explicit to mirror the table exactly.
_RECORD_UPSERTED = _STEP_PROGRESS | frozenset({"index"})

LOG_RECORD_CLASS_ALLOWLIST: dict[str, frozenset[str]] = {
    "run.lifecycle": _RUN_LIFECYCLE,
    "step.progress": _STEP_PROGRESS,
    "record.upserted": _RECORD_UPSERTED,
    "publish.stage": _REQUIRED
    | frozenset(
        {
            "type",
            "publish_job_id",
            "stage",
            "table",
            "row_count",
            "result_code",
            "preview_hash",
        }
    ),
    "agent.action": _REQUIRED
    | frozenset(
        {
            "type",
            "action_id",
            "trigger_signal_id",
            "signal_severity",
            "action_kind_id",
            "result_code",
            "human_approval_ref",
        }
    ),
    "observability.service": _REQUIRED
    | frozenset(
        {
            "type",
            "service",
            "image_tag",
            "readiness",
            "elapsed_seconds",
        }
    ),
    "adapter.raw": _REQUIRED
    | frozenset(
        {
            "type",
            "job_id",
            "step",
            "status",
            "skipped",
            "request_id",
            "payload_hash",
        }
    ),
}

LOG_RECORD_CLASSES: frozenset[str] = frozenset(LOG_RECORD_CLASS_ALLOWLIST)


class LogPipelineError(Exception):
    """Bounded fixed-code error for the Log_Pipeline field/class/allowlist gate.

    ``code`` is always one of the enumerated fixed codes; no provider or database
    diagnostics are ever attached.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _is_present(value: Any) -> bool:
    """A required field is present when it is non-null and, for strings, not blank.

    Fail-closed: ``None`` and whitespace-only strings count as absent. Non-string
    values (e.g. an integer epoch-millis ``occurred_at``) count as present.
    """
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True


def validate_required_fields(record: dict[str, Any]) -> None:
    """Enforce the four required fields and the component/severity enums.

    Raises :class:`LogPipelineError` with ``log_record_field_missing`` when any
    required field is absent, when ``component`` is not one of the five
    Component identifiers, or when ``severity`` is not an enumerated level
    (requirements 13.2, 13.14).
    """
    if not isinstance(record, dict):
        raise LogPipelineError(CODE_FIELD_MISSING)

    for field in REQUIRED_FIELDS:
        if field not in record or not _is_present(record[field]):
            raise LogPipelineError(CODE_FIELD_MISSING)

    component = record["component"]
    if not isinstance(component, str) or component not in COMPONENT_IDENTIFIERS:
        raise LogPipelineError(CODE_FIELD_MISSING)

    severity = record["severity"]
    if not isinstance(severity, str) or severity not in SEVERITY_LEVELS:
        raise LogPipelineError(CODE_FIELD_MISSING)


def resolve_record_class(record: dict[str, Any]) -> str:
    """Resolve the Log_Record_Class from the record ``type``.

    Mirrors ``es_index.resolve_index`` fail-closed behaviour: an absent,
    non-string, or unlisted ``type`` raises :class:`LogPipelineError` with
    ``log_record_class_unknown`` (requirement 13.4).
    """
    if not isinstance(record, dict):
        raise LogPipelineError(CODE_CLASS_UNKNOWN)
    record_class = record.get("type")
    if not isinstance(record_class, str) or record_class not in LOG_RECORD_CLASSES:
        raise LogPipelineError(CODE_CLASS_UNKNOWN)
    return record_class


def apply_field_allowlist(record: dict[str, Any], record_class: str) -> dict[str, Any]:
    """Keep only the keys allowlisted for ``record_class``; drop every other key.

    The returned dict's key set is always a subset of the class allowlist
    (requirement 13.4). This is the structural exclusion of Forbidden_Log_Field
    keys; value-level redaction of the surviving keys is Task 23.
    """
    allowlist = LOG_RECORD_CLASS_ALLOWLIST.get(record_class)
    if allowlist is None:
        raise LogPipelineError(CODE_CLASS_UNKNOWN)
    return {key: value for key, value in record.items() if key in allowlist}


def enforce_record_contract(record: dict[str, Any]) -> dict[str, Any]:
    """Run the full field/class/allowlist gate and return the allowlisted record.

    Order (fail-closed):
      1. required-field + component/severity enum validation
         (``log_record_field_missing``),
      2. Log_Record_Class resolution (``log_record_class_unknown``),
      3. per-class field allowlist projection.

    The returned dict is the input to the Task 23 Redaction_Boundary step; a
    caller that also redacts does
    ``sanitize_log_value(enforce_record_contract(record))``. No record reaches a
    Log_Sink unless this function returns without raising.
    """
    validate_required_fields(record)
    record_class = resolve_record_class(record)
    return apply_field_allowlist(record, record_class)
