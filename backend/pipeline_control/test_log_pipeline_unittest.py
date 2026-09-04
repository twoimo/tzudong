"""Unit tests for the Log_Pipeline field/class/allowlist gate.

Covers Task 22 of the platform-modernization spec (Requirements 13.1, 13.2,
13.4, 13.14):

- R13.1: exactly one of the five Component identifiers per record.
- R13.2: the four required fields plus the enumerated severity levels.
- R13.4: per-Log_Record_Class field allowlist; only allowlisted keys survive;
  an unlisted class is not forwarded (``log_record_class_unknown``).
- R13.14: any absent required field, an unlisted component, or an unlisted
  severity yields ``log_record_field_missing`` and no forwarding.

The dedicated property-based tests for the required-fields gate (Property 27,
Task 25.3) and the allowlist-subset invariant (Property 29, Task 25.5) are
separate. These unit tests pin the specific examples and edge cases.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import unittest

from backend.pipeline_control.log_pipeline import (
    CODE_CLASS_UNKNOWN,
    CODE_FIELD_MISSING,
    COMPONENT_IDENTIFIERS,
    LOG_RECORD_CLASS_ALLOWLIST,
    REQUIRED_FIELDS,
    SEVERITY_LEVELS,
    LogPipelineError,
    apply_field_allowlist,
    enforce_record_contract,
    resolve_record_class,
    validate_required_fields,
)


def _valid_record(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "type": "run.lifecycle",
        "component": "backend_runtime",
        "occurred_at": "2026-01-01T00:00:00.000Z",
        "correlation_id": "corr-0001",
        "severity": "info",
        "job_id": "job-0001",
        "status": "started",
    }
    record.update(overrides)
    return record


class ComponentAndSeverityEnumTests(unittest.TestCase):
    def test_five_component_identifiers_are_exactly_the_design_set(self) -> None:
        self.assertEqual(
            COMPONENT_IDENTIFIERS,
            frozenset(
                {
                    "web_app",
                    "backend_runtime",
                    "publish_worker",
                    "observability_stack",
                    "ops_agent",
                }
            ),
        )

    def test_severity_enum_is_exactly_four_levels(self) -> None:
        self.assertEqual(SEVERITY_LEVELS, frozenset({"debug", "info", "warn", "error"}))

    def test_required_fields_are_the_four_design_fields(self) -> None:
        self.assertEqual(
            REQUIRED_FIELDS,
            ("component", "occurred_at", "correlation_id", "severity"),
        )

    def test_every_component_identifier_is_accepted(self) -> None:
        for component in COMPONENT_IDENTIFIERS:
            with self.subTest(component=component):
                validate_required_fields(_valid_record(component=component))

    def test_every_severity_level_is_accepted(self) -> None:
        for severity in SEVERITY_LEVELS:
            with self.subTest(severity=severity):
                validate_required_fields(_valid_record(severity=severity))


class RequiredFieldGateTests(unittest.TestCase):
    def test_valid_record_passes(self) -> None:
        validate_required_fields(_valid_record())

    def test_missing_each_required_field_is_field_missing(self) -> None:
        for field in REQUIRED_FIELDS:
            record = _valid_record()
            del record[field]
            with self.subTest(field=field):
                with self.assertRaises(LogPipelineError) as ctx:
                    validate_required_fields(record)
                self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)

    def test_null_required_field_is_field_missing(self) -> None:
        for field in REQUIRED_FIELDS:
            with self.subTest(field=field):
                with self.assertRaises(LogPipelineError) as ctx:
                    validate_required_fields(_valid_record(**{field: None}))
                self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)

    def test_blank_string_correlation_id_is_field_missing(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            validate_required_fields(_valid_record(correlation_id="   "))
        self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)

    def test_unlisted_component_is_field_missing(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            validate_required_fields(_valid_record(component="unknown_component"))
        self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)

    def test_unlisted_severity_is_field_missing(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            validate_required_fields(_valid_record(severity="critical"))
        self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)

    def test_non_string_component_is_field_missing(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            validate_required_fields(_valid_record(component=123))
        self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)

    def test_integer_occurred_at_is_present(self) -> None:
        # An epoch-millis integer counts as present (non-string, non-null).
        validate_required_fields(_valid_record(occurred_at=1735689600000))

    def test_non_dict_record_is_field_missing(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            validate_required_fields("not-a-dict")  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)


class RecordClassResolutionTests(unittest.TestCase):
    def test_known_classes_resolve(self) -> None:
        for record_class in LOG_RECORD_CLASS_ALLOWLIST:
            with self.subTest(record_class=record_class):
                self.assertEqual(
                    resolve_record_class(_valid_record(type=record_class)),
                    record_class,
                )

    def test_unknown_class_is_class_unknown(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            resolve_record_class(_valid_record(type="nope.unknown"))
        self.assertEqual(ctx.exception.code, CODE_CLASS_UNKNOWN)

    def test_missing_type_is_class_unknown(self) -> None:
        record = _valid_record()
        del record["type"]
        with self.assertRaises(LogPipelineError) as ctx:
            resolve_record_class(record)
        self.assertEqual(ctx.exception.code, CODE_CLASS_UNKNOWN)

    def test_non_string_type_is_class_unknown(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            resolve_record_class(_valid_record(type=42))
        self.assertEqual(ctx.exception.code, CODE_CLASS_UNKNOWN)


class AllowlistProjectionTests(unittest.TestCase):
    def test_every_class_allowlist_contains_required_fields(self) -> None:
        for record_class, allowlist in LOG_RECORD_CLASS_ALLOWLIST.items():
            with self.subTest(record_class=record_class):
                self.assertTrue(frozenset(REQUIRED_FIELDS).issubset(allowlist))

    def test_non_allowlisted_keys_are_dropped(self) -> None:
        record = _valid_record(
            type="run.lifecycle",
            password="hunter2",  # Forbidden_Log_Field-bearing key
            email="a@b.com",
            arbitrary_body={"deep": "value"},
        )
        projected = apply_field_allowlist(record, "run.lifecycle")
        self.assertNotIn("password", projected)
        self.assertNotIn("email", projected)
        self.assertNotIn("arbitrary_body", projected)
        # Allowlisted keys survive.
        self.assertEqual(projected["component"], "backend_runtime")
        self.assertEqual(projected["job_id"], "job-0001")

    def test_output_keys_are_subset_of_class_allowlist(self) -> None:
        for record_class, allowlist in LOG_RECORD_CLASS_ALLOWLIST.items():
            record = _valid_record(type=record_class, injected_secret="x", extra=1)
            projected = apply_field_allowlist(record, record_class)
            with self.subTest(record_class=record_class):
                self.assertTrue(set(projected).issubset(allowlist))

    def test_publish_stage_allowlist_matches_design(self) -> None:
        self.assertEqual(
            LOG_RECORD_CLASS_ALLOWLIST["publish.stage"],
            frozenset(
                {
                    "component",
                    "occurred_at",
                    "correlation_id",
                    "severity",
                    "type",
                    "publish_job_id",
                    "stage",
                    "table",
                    "row_count",
                    "result_code",
                    "preview_hash",
                }
            ),
        )

    def test_agent_action_allowlist_matches_design(self) -> None:
        self.assertEqual(
            LOG_RECORD_CLASS_ALLOWLIST["agent.action"],
            frozenset(
                {
                    "component",
                    "occurred_at",
                    "correlation_id",
                    "severity",
                    "type",
                    "action_id",
                    "trigger_signal_id",
                    "signal_severity",
                    "action_kind_id",
                    "result_code",
                    "human_approval_ref",
                }
            ),
        )

    def test_observability_service_allowlist_matches_design(self) -> None:
        self.assertEqual(
            LOG_RECORD_CLASS_ALLOWLIST["observability.service"],
            frozenset(
                {
                    "component",
                    "occurred_at",
                    "correlation_id",
                    "severity",
                    "type",
                    "service",
                    "image_tag",
                    "readiness",
                    "elapsed_seconds",
                }
            ),
        )

    def test_adapter_raw_allowlist_matches_design(self) -> None:
        self.assertEqual(
            LOG_RECORD_CLASS_ALLOWLIST["adapter.raw"],
            frozenset(
                {
                    "component",
                    "occurred_at",
                    "correlation_id",
                    "severity",
                    "type",
                    "job_id",
                    "step",
                    "status",
                    "skipped",
                    "request_id",
                    "payload_hash",
                }
            ),
        )

    def test_step_progress_extends_run_lifecycle(self) -> None:
        self.assertTrue(
            LOG_RECORD_CLASS_ALLOWLIST["run.lifecycle"].issubset(
                LOG_RECORD_CLASS_ALLOWLIST["step.progress"]
            )
        )
        self.assertEqual(
            LOG_RECORD_CLASS_ALLOWLIST["step.progress"]
            - LOG_RECORD_CLASS_ALLOWLIST["run.lifecycle"],
            frozenset({"step", "index", "skipped"}),
        )


class EnforceRecordContractTests(unittest.TestCase):
    def test_valid_record_returns_allowlisted_projection(self) -> None:
        record = _valid_record(type="step.progress", step="crawl", index=3, secret="x")
        result = enforce_record_contract(record)
        self.assertTrue(set(result).issubset(LOG_RECORD_CLASS_ALLOWLIST["step.progress"]))
        self.assertNotIn("secret", result)
        self.assertEqual(result["step"], "crawl")

    def test_field_gate_runs_before_class_resolution(self) -> None:
        # Missing required field AND unknown class -> field-missing takes priority.
        record = _valid_record(type="nope.unknown")
        del record["severity"]
        with self.assertRaises(LogPipelineError) as ctx:
            enforce_record_contract(record)
        self.assertEqual(ctx.exception.code, CODE_FIELD_MISSING)

    def test_unknown_class_with_valid_fields_is_class_unknown(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            enforce_record_contract(_valid_record(type="nope.unknown"))
        self.assertEqual(ctx.exception.code, CODE_CLASS_UNKNOWN)

    def test_forbidden_field_keys_never_survive_the_gate(self) -> None:
        record = _valid_record(
            type="agent.action",
            action_id="act-1",
            authorization="Bearer secret",
            cookie="session=abc",
            phone="010-1234-5678",
        )
        result = enforce_record_contract(record)
        for forbidden_key in ("authorization", "cookie", "phone"):
            self.assertNotIn(forbidden_key, result)
        self.assertEqual(result["action_id"], "act-1")


if __name__ == "__main__":
    unittest.main()
