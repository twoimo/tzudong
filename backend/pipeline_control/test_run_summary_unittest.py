"""Unit tests for the run execution summary produced at run end.

Covers Task 5 of the platform-modernization spec (Requirements 8.4, 8.5, 8.10):

- R8.4: the summary records Hosted_Database read/write request counts as
  non-negative integers and excludes Forbidden_Log_Field values.
- R8.5: the summary records succeeded/failed/skipped step name lists, and every
  skip carries a bounded fixed reason code drawn from ``SKIP_REASON_CODES``.
- R8.10: a required-step failure marks its dependents as skipped, sets the final
  status to failed, and never records the failed step's Local_Database write as
  confirmed.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import unittest

from backend.pipeline_control.graph import MUTATING_CAPABILITY, STEP_BY_ID, STEP_SPECS
from backend.pipeline_control.profiles import (
    ProfileError,
    RUN_SUMMARY_SCHEMA_VERSION,
    SKIP_REASON_CODES,
    SKIP_REASON_CODE_UPSTREAM,
    STEP_STATUS_FAILED,
    STEP_STATUS_SUCCEEDED,
    build_run_summary,
)

ALL_STEP_IDS = frozenset(spec.id for spec in STEP_SPECS)
MUTATING_STEP_IDS = frozenset(
    spec.id for spec in STEP_SPECS if MUTATING_CAPABILITY in spec.capabilities
)


class RunSummaryShapeTests(unittest.TestCase):
    def test_clean_local_db_summary_has_design_shape(self) -> None:
        summary = build_run_summary(
            run_id="run-0001",
            compute_profile="heavy_local",
            data_sink="local_db",
        )
        self.assertEqual(summary["schemaVersion"], RUN_SUMMARY_SCHEMA_VERSION)
        self.assertEqual(summary["computeProfile"], "heavy_local")
        self.assertEqual(summary["dataSink"], "local_db")
        self.assertEqual(summary["hostedReadRequestCount"], 0)
        self.assertEqual(summary["hostedWriteRequestCount"], 0)
        self.assertEqual(set(summary["succeededSteps"]), ALL_STEP_IDS)
        self.assertEqual(summary["failedSteps"], [])
        self.assertEqual(summary["skippedSteps"], [])
        self.assertEqual(summary["finalStatus"], STEP_STATUS_SUCCEEDED)
        # A clean heavy_local + local_db run confirms every mutating step's write.
        self.assertEqual(set(summary["confirmedWriteSteps"]), MUTATING_STEP_IDS)

    def test_summary_key_set_is_fixed_and_non_sensitive(self) -> None:
        summary = build_run_summary(
            run_id="run-0002",
            compute_profile="heavy_local",
            data_sink="local_db",
        )
        self.assertEqual(
            set(summary),
            {
                "schemaVersion",
                "runId",
                "computeProfile",
                "dataSink",
                "hostedReadRequestCount",
                "hostedWriteRequestCount",
                "succeededSteps",
                "failedSteps",
                "skippedSteps",
                "confirmedWriteSteps",
                "finalStatus",
            },
        )


class RunSummaryHostedCountTests(unittest.TestCase):
    def test_records_non_negative_hosted_counts(self) -> None:
        summary = build_run_summary(
            run_id="run-0003",
            compute_profile="lite_gha",
            data_sink="artifact_only",
            hosted_read_request_count=4,
            hosted_write_request_count=0,
        )
        self.assertEqual(summary["hostedReadRequestCount"], 4)
        self.assertEqual(summary["hostedWriteRequestCount"], 0)

    def test_negative_hosted_count_fails_closed(self) -> None:
        with self.assertRaises(ProfileError) as ctx:
            build_run_summary(
                run_id="run-0004",
                compute_profile="lite_gha",
                data_sink="artifact_only",
                hosted_read_request_count=-1,
            )
        self.assertEqual(ctx.exception.code, "hosted_request_count_invalid")

    def test_boolean_hosted_count_rejected(self) -> None:
        # bool is an int subclass; a boolean is not a valid request count.
        with self.assertRaises(ProfileError) as ctx:
            build_run_summary(
                run_id="run-0005",
                compute_profile="lite_gha",
                data_sink="artifact_only",
                hosted_write_request_count=True,  # type: ignore[arg-type]
            )
        self.assertEqual(ctx.exception.code, "hosted_request_count_invalid")

    def test_local_db_with_hosted_write_is_boundary_breach(self) -> None:
        with self.assertRaises(ProfileError) as ctx:
            build_run_summary(
                run_id="run-0006",
                compute_profile="heavy_local",
                data_sink="local_db",
                hosted_write_request_count=1,
            )
        self.assertEqual(ctx.exception.code, "supabase_data_boundary_rejected")


class RunSummaryRedactionTests(unittest.TestCase):
    def test_forbidden_value_in_run_id_is_redacted(self) -> None:
        # A caller must not be able to smuggle a secret into the summary via
        # the free-form run id; it passes through the redaction boundary.
        summary = build_run_summary(
            run_id="token=supersecretvalue123456",
            compute_profile="heavy_local",
            data_sink="local_db",
        )
        self.assertNotIn("supersecretvalue123456", summary["runId"])

    def test_none_run_id_preserved(self) -> None:
        summary = build_run_summary(
            run_id=None,
            compute_profile="heavy_local",
            data_sink="local_db",
        )
        self.assertIsNone(summary["runId"])


class RunSummaryFailurePropagationTests(unittest.TestCase):
    def test_required_failure_skips_dependents_and_fails_run(self) -> None:
        summary = build_run_summary(
            run_id="run-0007",
            compute_profile="heavy_local",
            data_sink="local_db",
            outcomes={"12-transform": "failed"},
        )
        self.assertIn("12-transform", summary["failedSteps"])
        self.assertEqual(summary["finalStatus"], STEP_STATUS_FAILED)
        skipped_ids = {entry["step"] for entry in summary["skippedSteps"]}
        # The insertion chain depends on 12-transform and must be skipped.
        for dependent in ("13-supabase-insert", "13-quality-gate"):
            self.assertIn(dependent, skipped_ids, dependent)

    def test_failed_insertion_step_write_not_confirmed(self) -> None:
        # A failed mutating (insertion) step must never appear as a confirmed
        # Local_Database write (R8.10).
        summary = build_run_summary(
            run_id="run-0008",
            compute_profile="heavy_local",
            data_sink="local_db",
            outcomes={"13-supabase-insert": "failed"},
        )
        self.assertIn("13-supabase-insert", summary["failedSteps"])
        self.assertNotIn("13-supabase-insert", summary["confirmedWriteSteps"])
        self.assertEqual(summary["finalStatus"], STEP_STATUS_FAILED)

    def test_skip_reason_codes_are_bounded(self) -> None:
        summary = build_run_summary(
            run_id="run-0009",
            compute_profile="lite_gha",
            data_sink="artifact_only",
        )
        self.assertTrue(summary["skippedSteps"])
        for entry in summary["skippedSteps"]:
            self.assertIn(entry["reasonCode"], SKIP_REASON_CODES)

    def test_partition_is_total_and_disjoint(self) -> None:
        summary = build_run_summary(
            run_id="run-0010",
            compute_profile="heavy_local",
            data_sink="local_db",
            outcomes={"08-chunk": "failed"},
        )
        succeeded = set(summary["succeededSteps"])
        failed = set(summary["failedSteps"])
        skipped = {entry["step"] for entry in summary["skippedSteps"]}
        self.assertEqual(succeeded & failed, set())
        self.assertEqual(succeeded & skipped, set())
        self.assertEqual(failed & skipped, set())
        self.assertEqual(succeeded | failed | skipped, ALL_STEP_IDS)
        # Confirmed writes are a subset of succeeded mutating steps.
        self.assertTrue(set(summary["confirmedWriteSteps"]) <= succeeded)
        for step_id in summary["confirmedWriteSteps"]:
            self.assertIn(
                MUTATING_CAPABILITY, STEP_BY_ID[step_id].capabilities, step_id
            )
        # Downstream skips carry the upstream reason code.
        for entry in summary["skippedSteps"]:
            if entry["step"] in {"09-target", "10-rule"}:
                self.assertEqual(entry["reasonCode"], SKIP_REASON_CODE_UPSTREAM)


if __name__ == "__main__":
    unittest.main()
