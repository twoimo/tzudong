"""Property-based test for the Log_Pipeline required-field gate (Property 27).

Feature: platform-modernization, Property 27: 로그 필수 필드 게이트
Validates: Requirements 13.1, 13.2, 13.14

Property 27 (design section, requirements 13.1/13.2/13.14). For *every* log
record input, ``log_pipeline.validate_required_fields`` forwards the record
(returns without raising) IF AND ONLY IF:

  * the four required fields ``component``, ``occurred_at``,
    ``correlation_id``, ``severity`` are each present (non-null and, for a
    string, non-blank), AND
  * ``component`` is exactly one of the five enumerated Component identifiers
    (``web_app``, ``backend_runtime``, ``publish_worker``,
    ``observability_stack``, ``ops_agent``), AND
  * ``severity`` is one of the enumerated levels ``debug`` | ``info`` |
    ``warn`` | ``error``.

Otherwise the gate raises :class:`LogPipelineError` carrying the single bounded
fixed code ``log_record_field_missing`` and the record is not forwarded. The
test pins that biconditional precisely: a valid record must pass, and any
defect (a missing/null/blank required field, an unlisted component, or an
unlisted severity) must raise with exactly that fixed code and nothing else.

The generator draws each of the four fields independently from a pool that
mixes valid values with every defect class (absent, ``None``, blank string,
whitespace, unlisted string, wrong type), plus extra non-required keys that
must never affect the decision. A spec-level oracle (expressed from the
requirement text, not by calling the module) decides the expected outcome, so
the assertion is a genuine cross-check rather than a tautology.

Runnable via
``python -m unittest backend.pipeline_control.test_log_required_fields_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.log_pipeline import (
    CODE_FIELD_MISSING,
    COMPONENT_IDENTIFIERS,
    LogPipelineError,
    SEVERITY_LEVELS,
    validate_required_fields,
)

# --- Independent copies of the enumerated sets (spec, not import echo) -----
# Expressed directly from requirements 13.1/13.2 so the property pins the exact
# membership rather than trusting the module constant it is validating.
_EXPECTED_COMPONENTS = frozenset(
    {
        "web_app",
        "backend_runtime",
        "publish_worker",
        "observability_stack",
        "ops_agent",
    }
)
_EXPECTED_SEVERITIES = frozenset({"debug", "info", "warn", "error"})

# Sentinel meaning "this field is absent from the record dict".
_ABSENT = object()

_REQUIRED = ("component", "occurred_at", "correlation_id", "severity")


def _present_oracle(value: Any) -> bool:
    """Spec presence rule: non-null, and for strings non-blank (13.2/13.14)."""
    if value is _ABSENT or value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True


def _expected_forwards(record: dict[str, Any]) -> bool:
    """Spec oracle for the forward biconditional.

    Forwards IFF all four required fields are present, ``component`` is an
    enumerated identifier, and ``severity`` is an enumerated level.
    """
    for field in _REQUIRED:
        if not _present_oracle(record.get(field, _ABSENT)):
            return False
    component = record.get("component", _ABSENT)
    if not isinstance(component, str) or component not in _EXPECTED_COMPONENTS:
        return False
    severity = record.get("severity", _ABSENT)
    if not isinstance(severity, str) or severity not in _EXPECTED_SEVERITIES:
        return False
    return True


# --- Field value strategies ------------------------------------------------
# Blank / whitespace strings that count as absent for string fields.
_blank_strings = st.sampled_from(["", " ", "   ", "\t", "\n", " \t \n "])

# Wrong-type non-string scalars.
_wrong_types = st.one_of(
    st.integers(min_value=-1000, max_value=1000),
    st.booleans(),
    st.floats(allow_nan=False, allow_infinity=False, width=32),
    st.lists(st.integers(), max_size=2),
)

# component: valid identifier, or an unlisted/blank/None/absent/wrong-type value.
_component_values = st.one_of(
    st.sampled_from(sorted(_EXPECTED_COMPONENTS)),
    st.sampled_from(
        ["WEB_APP", "web-app", "worker", "unknown_component", "publishworker", "ops"]
    ),
    _blank_strings,
    st.none(),
    _wrong_types,
    st.just(_ABSENT),
)

# severity: valid level, or an unlisted/blank/None/absent/wrong-type value.
_severity_values = st.one_of(
    st.sampled_from(sorted(_EXPECTED_SEVERITIES)),
    st.sampled_from(["critical", "INFO", "Warn", "fatal", "trace", "notice"]),
    _blank_strings,
    st.none(),
    _wrong_types,
    st.just(_ABSENT),
)

# occurred_at: any present value passes the presence check (int epoch-ms, iso
# string), or a defect (blank/None/absent).
_occurred_at_values = st.one_of(
    st.integers(min_value=0, max_value=2_000_000_000_000),
    st.sampled_from(["2024-01-01T00:00:00.000Z", "2025-06-30T12:34:56.789Z"]),
    _blank_strings,
    st.none(),
    st.just(_ABSENT),
)

# correlation_id: any present value passes, or a defect.
_correlation_id_values = st.one_of(
    st.text(alphabet="abcdef0123456789-", min_size=1, max_size=36),
    st.integers(min_value=1, max_value=10_000),
    _blank_strings,
    st.none(),
    st.just(_ABSENT),
)

# Extra non-required keys that must never influence the decision.
_extra_keys = st.dictionaries(
    keys=st.sampled_from(["type", "job_id", "note", "password", "email", "extra"]),
    values=st.one_of(st.text(max_size=8), st.integers(), st.none()),
    max_size=3,
)


@st.composite
def _records(draw: st.DrawFn) -> dict[str, Any]:
    """Draw a record with each required field independently valid or defective."""
    record: dict[str, Any] = dict(draw(_extra_keys))
    field_values = {
        "component": draw(_component_values),
        "occurred_at": draw(_occurred_at_values),
        "correlation_id": draw(_correlation_id_values),
        "severity": draw(_severity_values),
    }
    for field, value in field_values.items():
        if value is not _ABSENT:
            record[field] = value
        else:
            record.pop(field, None)
    return record


class LogRequiredFieldGatePropertyTests(unittest.TestCase):
    def test_enum_membership_is_exactly_five_and_four(self) -> None:
        # Anchor: the module enums match the spec sets exactly (13.1, 13.2).
        self.assertEqual(set(COMPONENT_IDENTIFIERS), set(_EXPECTED_COMPONENTS))
        self.assertEqual(len(COMPONENT_IDENTIFIERS), 5)
        self.assertEqual(set(SEVERITY_LEVELS), set(_EXPECTED_SEVERITIES))

    def test_canonical_valid_record_forwards(self) -> None:
        # A fully valid record passes the gate without raising.
        record = {
            "component": "backend_runtime",
            "occurred_at": 1_700_000_000_000,
            "correlation_id": "corr-abc-123",
            "severity": "info",
        }
        self.assertIsNone(validate_required_fields(record))

    # Feature: platform-modernization, Property 27: 로그 필수 필드 게이트
    # Validates: Requirements 13.1, 13.2, 13.14
    @settings(max_examples=100, deadline=None)
    @given(record=_records())
    def test_property_27_required_field_gate_iff(self, record: dict[str, Any]) -> None:
        expected = _expected_forwards(record)
        if expected:
            # Valid record forwards: validate_required_fields returns (no raise).
            try:
                result = validate_required_fields(record)
            except LogPipelineError as exc:  # pragma: no cover - failure path
                self.fail(
                    f"valid record was rejected with {exc.code!r}: {record!r}"
                )
            self.assertIsNone(result)
        else:
            # Any defect: not forwarded, exactly the fixed code and nothing else.
            with self.assertRaises(LogPipelineError) as ctx:
                validate_required_fields(record)
            self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)


if __name__ == "__main__":
    unittest.main()
