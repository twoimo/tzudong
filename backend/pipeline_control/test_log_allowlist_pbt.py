"""Property-based test for the Log_Pipeline field-allowlist projection (Property 29).

Feature: platform-modernization, Property 29: 로그 키 허용목록 부분집합
Validates: Requirements 13.4, 13.7

Property 29 (design section, requirements 13.4/13.7). For *every* log record
input, the key set of the Log_Pipeline output is a subset of the field
allowlist enumerated for that record's Log_Record_Class, and the count of
records forwarded to a Log_Sink whose class is not in the enumerated class set
is zero.

This test pins that invariant at the three seams the pipeline exposes:

  * :func:`log_pipeline.apply_field_allowlist` -- the pure per-class projection.
    For each of the seven enumerated classes and an arbitrarily key-extended
    record (including forbidden-looking keys such as ``password``/``email``),
    the projected key set must be a subset of that class's allowlist, and every
    allowlisted key that *was* present must survive with its value unchanged.
  * :func:`log_pipeline.enforce_record_contract` -- the field/class/allowlist
    gate. A contract-valid record (four required fields present, enumerated
    component/severity, an enumerated ``type``) is projected to a key set that
    is a subset of its class allowlist regardless of injected extra keys.
  * :func:`log_redaction.prepare_record_for_sink` -- the full pre-sink
    composition (contract gate then Redaction_Boundary). When a record is
    forwarded (the function returns), its key set is still a subset of the
    class allowlist. When it is not forwarded (the function raises a bounded
    fixed code), the forward count is zero, which also satisfies the invariant.

The unknown-class arm (requirement 13.4 / 13.7 "class not in the enumerated
set => forward count 0") is pinned separately: a record whose ``type`` is not
one of the seven enumerated classes is never forwarded -- both
``enforce_record_contract`` and ``prepare_record_for_sink`` raise
``log_record_class_unknown`` and return no record.

The expected per-class allowlists below are transcribed independently from the
design C9 table (not read back from the module under test), so the subset and
survival assertions are a genuine cross-check rather than an echo of the
constant they validate. An anchor test asserts the module constant equals this
independent transcription.

Runnable via
``python -m unittest backend.pipeline_control.test_log_allowlist_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.log_pipeline import (
    CODE_CLASS_UNKNOWN,
    LOG_RECORD_CLASS_ALLOWLIST,
    LogPipelineError,
    apply_field_allowlist,
    enforce_record_contract,
)
from backend.pipeline_control.log_redaction import (
    LogRedactionError,
    prepare_record_for_sink,
)

# --- Independent transcription of the design C9 allowlist table ------------
# Expressed directly from design C9 so the property pins the exact per-class
# membership rather than trusting the module constant it validates. The four
# required fields are the common prefix of every class; the design "위 +"
# (previous row plus ...) notation for the three ES log classes is expanded
# here so each class stands alone.
_REQUIRED = frozenset(
    {"component", "occurred_at", "correlation_id", "severity"}
)
_RUN_LIFECYCLE = _REQUIRED | frozenset(
    {"type", "job_id", "status", "target", "profile", "request_id"}
)
_STEP_PROGRESS = _RUN_LIFECYCLE | frozenset({"step", "index", "skipped"})
_RECORD_UPSERTED = _STEP_PROGRESS | frozenset({"index"})

_EXPECTED_ALLOWLIST: dict[str, frozenset[str]] = {
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

_CLASSES = sorted(_EXPECTED_ALLOWLIST)

# Every allowlisted key that any class enumerates -- used to draw "in-allowlist"
# keys that must survive projection when present.
_ALL_ALLOWLIST_KEYS = sorted(
    {key for keys in _EXPECTED_ALLOWLIST.values() for key in keys}
)

# Forbidden-looking / never-allowlisted keys that must always be dropped.
_FORBIDDEN_KEYS = [
    "password",
    "email",
    "phone",
    "cookie",
    "session_token",
    "onboarding_token",
    "resident_registration_number",
    "precise_location",
    "raw_ocr",
    "request_body",
    "provider_diagnostic",
    "stack_trace",
    "secret",
    "credential",
    "authorization",
]

# Class identifiers that are NOT enumerated -- the unknown-class arm.
_UNKNOWN_CLASSES = [
    "run.unknown",
    "publish.rollback",
    "agent.unlisted",
    "RUN.LIFECYCLE",
    "",
    "adapter",
    "record",
]

# --- Value strategy --------------------------------------------------------
# JSON-safe, bounded values so the Redaction_Boundary path exercises real
# structure without deliberately tripping the size/unsafe-marker guards (the
# invariant holds either way: a non-forwarded record contributes zero to the
# forward count).
_scalar_values = st.one_of(
    st.text(max_size=16),
    st.integers(min_value=-10_000, max_value=10_000),
    st.booleans(),
    st.none(),
)
_values = st.one_of(
    _scalar_values,
    st.lists(_scalar_values, max_size=3),
    st.dictionaries(st.text(min_size=1, max_size=6), _scalar_values, max_size=3),
)

# Arbitrary keys: a mix of allowlisted keys, forbidden-looking keys, and free
# random identifiers. Any of them may be injected into a record.
_arbitrary_keys = st.one_of(
    st.sampled_from(_ALL_ALLOWLIST_KEYS),
    st.sampled_from(_FORBIDDEN_KEYS),
    st.text(min_size=1, max_size=12),
)

# A record body: an arbitrary key -> value map with injected extra keys.
_arbitrary_record = st.dictionaries(_arbitrary_keys, _values, max_size=12)


def _valid_required_fields() -> st.SearchStrategy[dict[str, Any]]:
    """The four required fields with contract-valid values (13.2/13.14)."""
    return st.fixed_dictionaries(
        {
            "component": st.sampled_from(
                [
                    "web_app",
                    "backend_runtime",
                    "publish_worker",
                    "observability_stack",
                    "ops_agent",
                ]
            ),
            "occurred_at": st.integers(
                min_value=0, max_value=2_000_000_000_000
            ),
            "correlation_id": st.text(
                alphabet="abcdef0123456789-", min_size=1, max_size=36
            ),
            "severity": st.sampled_from(["debug", "info", "warn", "error"]),
        }
    )


@st.composite
def _contract_valid_records(draw: st.DrawFn) -> tuple[dict[str, Any], str]:
    """A record that passes the contract gate, plus its class.

    Required fields valid, ``type`` an enumerated class, and arbitrary injected
    extra keys (allowlisted-elsewhere, forbidden-looking, and random).
    """
    record: dict[str, Any] = dict(draw(_arbitrary_record))
    record.update(draw(_valid_required_fields()))
    record_class = draw(st.sampled_from(_CLASSES))
    record["type"] = record_class
    return record, record_class


class LogAllowlistSubsetPropertyTests(unittest.TestCase):
    def test_module_allowlist_matches_design_c9_table(self) -> None:
        # Anchor: the module constant equals the independent C9 transcription,
        # so the property's subset checks are a genuine cross-check (13.4).
        self.assertEqual(
            {cls: set(keys) for cls, keys in LOG_RECORD_CLASS_ALLOWLIST.items()},
            {cls: set(keys) for cls, keys in _EXPECTED_ALLOWLIST.items()},
        )
        # Exactly seven enumerated classes.
        self.assertEqual(len(LOG_RECORD_CLASS_ALLOWLIST), 7)

    # Feature: platform-modernization, Property 29: 로그 키 허용목록 부분집합
    # Validates: Requirements 13.4, 13.7
    @settings(max_examples=100, deadline=None)
    @given(record=_arbitrary_record, record_class=st.sampled_from(_CLASSES))
    def test_property_29_projection_is_subset_and_preserves_allowlisted(
        self, record: dict[str, Any], record_class: str
    ) -> None:
        allowlist = _EXPECTED_ALLOWLIST[record_class]
        projected = apply_field_allowlist(record, record_class)

        # (1) Output key set is a subset of the class allowlist.
        self.assertTrue(
            set(projected).issubset(allowlist),
            f"class {record_class!r}: extra keys "
            f"{set(projected) - allowlist!r}",
        )
        # (2) Every allowlisted key that was present survives, value unchanged.
        for key, value in record.items():
            if key in allowlist:
                self.assertIn(key, projected)
                self.assertEqual(projected[key], value)
        # (3) Forbidden-looking / non-allowlisted keys are dropped.
        for key in record:
            if key not in allowlist:
                self.assertNotIn(key, projected)

    # Feature: platform-modernization, Property 29: 로그 키 허용목록 부분집합
    # Validates: Requirements 13.4, 13.7
    @settings(max_examples=100, deadline=None)
    @given(pair=_contract_valid_records())
    def test_property_29_contract_gate_output_is_subset(
        self, pair: tuple[dict[str, Any], str]
    ) -> None:
        record, record_class = pair
        allowlist = _EXPECTED_ALLOWLIST[record_class]

        gated = enforce_record_contract(record)
        self.assertTrue(
            set(gated).issubset(allowlist),
            f"class {record_class!r}: extra keys {set(gated) - allowlist!r}",
        )

    # Feature: platform-modernization, Property 29: 로그 키 허용목록 부분집합
    # Validates: Requirements 13.4, 13.7
    @settings(max_examples=100, deadline=None)
    @given(pair=_contract_valid_records())
    def test_property_29_pre_sink_output_is_subset(
        self, pair: tuple[dict[str, Any], str]
    ) -> None:
        record, record_class = pair
        allowlist = _EXPECTED_ALLOWLIST[record_class]

        try:
            prepared = prepare_record_for_sink(record)
        except (LogPipelineError, LogRedactionError):
            # Not forwarded: contributes zero to the forward count, which still
            # satisfies "output key set is a subset of the class allowlist".
            return
        self.assertTrue(
            set(prepared).issubset(allowlist),
            f"class {record_class!r}: extra keys "
            f"{set(prepared) - allowlist!r}",
        )

    # Feature: platform-modernization, Property 29: 로그 키 허용목록 부분집합
    # Validates: Requirements 13.4, 13.7
    @settings(max_examples=100, deadline=None)
    @given(
        record=_arbitrary_record,
        unknown_class=st.sampled_from(_UNKNOWN_CLASSES),
    )
    def test_property_29_unknown_class_is_never_forwarded(
        self, record: dict[str, Any], unknown_class: str
    ) -> None:
        # A record whose class is not enumerated is never forwarded: both the
        # gate and the full pre-sink composition raise the bounded fixed code
        # and return no record (forward count 0).
        candidate = dict(record)
        candidate.update(
            {
                "component": "backend_runtime",
                "occurred_at": 1_700_000_000_000,
                "correlation_id": "corr-abc-123",
                "severity": "info",
                "type": unknown_class,
            }
        )
        with self.assertRaises(LogPipelineError) as ctx:
            enforce_record_contract(candidate)
        self.assertEqual(ctx.exception.code, CODE_CLASS_UNKNOWN)

        with self.assertRaises(LogPipelineError) as ctx2:
            prepare_record_for_sink(candidate)
        self.assertEqual(ctx2.exception.code, CODE_CLASS_UNKNOWN)


if __name__ == "__main__":
    unittest.main()
