"""Unit tests for heavy_local + local_db composition and sink preflight.

Covers Task 4 of the platform-modernization spec (Requirements 8.1, 8.2, 8.3,
8.6, 8.11):

- R8.1: the 18 STEP_SPECS map to exactly one of the four classes (crawling,
  evaluation, media, insertion) and ``compose_step_plan`` assigns every step
  exactly one terminal status (succeeded/failed/skipped), with skip reason codes
  drawn only from the bounded ``SKIP_REASON_CODES`` set.
- R8.3: a ``hosted_apply`` request fails closed with ``hosted_apply_not_admitted``
  before any step starts, leaving the run's adapter index at 0.
- R8.6: the worker entrypoint is the sole step-execution path; the composition
  and preflight are pure and do not start a Route_Handler_Boundary path.
- R8.10 (partition support): a required-step failure marks skip_after dependents
  as downstream-skipped and the final status is failed.
- R8.11: a hosted URL under a ``local_db`` classification ends the run with the
  bounded ``supabase_data_boundary_rejected`` code and no provider/DB string.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import unittest
from unittest import mock

from backend.pipeline_control.graph import (
    STEP_CLASSES,
    STEP_CLASS_BY_ID,
    STEP_SPECS,
    SKIP_HEAVY_REASON,
    AdapterGraphError,
    step_class,
    validate_step_classes,
)
from backend.pipeline_control.profiles import (
    ProfileError,
    SKIP_REASON_CODES,
    SKIP_REASON_CODE_ARTIFACT_MUTATING,
    SKIP_REASON_CODE_HEAVY,
    SKIP_REASON_CODE_TARGET_LACKS_CAPABILITY,
    SKIP_REASON_CODE_TARGET_LACKS_INSERT,
    SKIP_REASON_CODE_UPSTREAM,
    STEP_STATUS_FAILED,
    STEP_STATUS_SKIPPED,
    STEP_STATUS_SUCCEEDED,
    classify_skip_reason_code,
    compose_step_plan,
    preflight_data_sink,
)
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import process_one

ALL_STEP_IDS = frozenset(spec.id for spec in STEP_SPECS)


class StepClassMappingTests(unittest.TestCase):
    def test_all_eighteen_steps_map_to_one_class(self) -> None:
        self.assertEqual(len(STEP_SPECS), 18)
        self.assertEqual(set(STEP_CLASS_BY_ID), ALL_STEP_IDS)
        for spec in STEP_SPECS:
            self.assertIn(step_class(spec.id), STEP_CLASSES, spec.id)

    def test_every_class_is_non_empty(self) -> None:
        self.assertEqual(set(STEP_CLASS_BY_ID.values()), set(STEP_CLASSES))
        for klass in STEP_CLASSES:
            members = [sid for sid, k in STEP_CLASS_BY_ID.items() if k == klass]
            self.assertTrue(members, klass)

    def test_validate_step_classes_passes(self) -> None:
        validate_step_classes()  # must not raise

    def test_unknown_step_class_rejected(self) -> None:
        with self.assertRaises(AdapterGraphError) as ctx:
            step_class("99-not-a-step")
        self.assertEqual(ctx.exception.code, "step_class_unknown")


class SkipReasonCodeTests(unittest.TestCase):
    def test_heavy_reason_maps_to_bounded_code(self) -> None:
        self.assertEqual(
            classify_skip_reason_code(("optional", SKIP_HEAVY_REASON)),
            SKIP_REASON_CODE_HEAVY,
        )

    def test_artifact_mutating_maps_exactly(self) -> None:
        self.assertEqual(
            classify_skip_reason_code(
                ("downstream", "artifact_only_skips_mutating_step")
            ),
            SKIP_REASON_CODE_ARTIFACT_MUTATING,
        )

    def test_missing_insert_capability_maps_exactly(self) -> None:
        self.assertEqual(
            classify_skip_reason_code(
                ("downstream", "target_lacks_insert_capability")
            ),
            SKIP_REASON_CODE_TARGET_LACKS_INSERT,
        )

    def test_generic_capability_maps_to_family_code(self) -> None:
        self.assertEqual(
            classify_skip_reason_code(("optional", "target_lacks_map_url_capability")),
            SKIP_REASON_CODE_TARGET_LACKS_CAPABILITY,
        )

    def test_downstream_reason_maps_to_upstream_code(self) -> None:
        self.assertEqual(
            classify_skip_reason_code(("downstream", "08-chunk skipped or failed")),
            SKIP_REASON_CODE_UPSTREAM,
        )

    def test_all_mapped_codes_are_in_bounded_set(self) -> None:
        for code in (
            SKIP_REASON_CODE_HEAVY,
            SKIP_REASON_CODE_ARTIFACT_MUTATING,
            SKIP_REASON_CODE_TARGET_LACKS_INSERT,
            SKIP_REASON_CODE_TARGET_LACKS_CAPABILITY,
            SKIP_REASON_CODE_UPSTREAM,
        ):
            self.assertIn(code, SKIP_REASON_CODES)

    def test_unknown_reason_fails_closed(self) -> None:
        with self.assertRaises(ProfileError) as ctx:
            classify_skip_reason_code(("optional", "free form reason"))
        self.assertEqual(ctx.exception.code, "skip_reason_unknown")


class ComposeStepPlanTests(unittest.TestCase):
    def _assert_partition(self, plan: dict) -> None:
        succeeded = set(plan["succeededSteps"])
        failed = set(plan["failedSteps"])
        skipped = {entry["step"] for entry in plan["skippedSteps"]}
        # Mutually exclusive.
        self.assertEqual(succeeded & failed, set())
        self.assertEqual(succeeded & skipped, set())
        self.assertEqual(failed & skipped, set())
        # Union covers every composed step exactly once.
        self.assertEqual(succeeded | failed | skipped, ALL_STEP_IDS)
        self.assertEqual(
            len(plan["steps"]),
            len(succeeded) + len(failed) + len(skipped),
        )
        # Skip reason codes are bounded.
        for entry in plan["skippedSteps"]:
            self.assertIn(entry["reasonCode"], SKIP_REASON_CODES)
        # Each step carries its class and exactly one terminal status.
        for step in plan["steps"]:
            self.assertIn(step["stepClass"], STEP_CLASSES)
            self.assertIn(
                step["status"],
                {STEP_STATUS_SUCCEEDED, STEP_STATUS_FAILED, STEP_STATUS_SKIPPED},
            )

    def test_heavy_local_local_db_runs_all_four_classes(self) -> None:
        plan = compose_step_plan(
            compute_profile="heavy_local",
            data_sink="local_db",
            capabilities=None,
        )
        self._assert_partition(plan)
        # A clean heavy_local + local_db run has no skips and no failures.
        self.assertEqual(plan["skippedSteps"], [])
        self.assertEqual(plan["failedSteps"], [])
        self.assertEqual(set(plan["succeededSteps"]), ALL_STEP_IDS)
        self.assertEqual(plan["finalStatus"], STEP_STATUS_SUCCEEDED)
        # All four stage classes are composed as execution targets.
        for klass in STEP_CLASSES:
            self.assertTrue(plan["byClass"][klass])

    def test_lite_gha_skips_heavy_media_steps(self) -> None:
        plan = compose_step_plan(
            compute_profile="lite_gha",
            data_sink="artifact_only",
            capabilities=None,
        )
        self._assert_partition(plan)
        skipped_ids = {entry["step"] for entry in plan["skippedSteps"]}
        # The heavy steps must be skipped under lite_gha.
        for heavy in ("03-2-visual", "04-frames", "05-map-url", "06-frame-caption", "08-chunk"):
            self.assertIn(heavy, skipped_ids, heavy)

    def test_required_failure_propagates_downstream_skip(self) -> None:
        plan = compose_step_plan(
            compute_profile="heavy_local",
            data_sink="local_db",
            capabilities=None,
            outcomes={"08-chunk": "failed"},
        )
        self._assert_partition(plan)
        self.assertIn("08-chunk", plan["failedSteps"])
        self.assertEqual(plan["finalStatus"], STEP_STATUS_FAILED)
        skipped_ids = {entry["step"] for entry in plan["skippedSteps"]}
        # The evaluation/insertion chain that depends on 08-chunk is skipped.
        for dependent in (
            "09-target",
            "10-rule",
            "11-laaj",
            "12-transform",
            "13-supabase-insert",
            "13-quality-gate",
        ):
            self.assertIn(dependent, skipped_ids, dependent)
        for entry in plan["skippedSteps"]:
            if entry["step"] in {"09-target", "10-rule"}:
                self.assertEqual(entry["reasonCode"], SKIP_REASON_CODE_UPSTREAM)

    def test_hosted_apply_sink_refused_in_composition(self) -> None:
        with self.assertRaises(ProfileError) as ctx:
            compose_step_plan(
                compute_profile="heavy_local",
                data_sink="hosted_apply",
                capabilities=None,
            )
        self.assertEqual(ctx.exception.code, "hosted_apply_not_admitted")


class PreflightDataSinkTests(unittest.TestCase):
    def test_heavy_local_defaults_to_local_db(self) -> None:
        self.assertEqual(
            preflight_data_sink(compute_profile="heavy_local", environment={}),
            "local_db",
        )

    def test_lite_gha_defaults_to_artifact_only(self) -> None:
        self.assertEqual(
            preflight_data_sink(compute_profile="lite_gha", environment={}),
            "artifact_only",
        )

    def test_explicit_local_db_sink(self) -> None:
        self.assertEqual(
            preflight_data_sink(
                compute_profile="heavy_local",
                environment={"TZUDONG_DATA_SINK": "local_db"},
            ),
            "local_db",
        )

    def test_data_env_backward_compat(self) -> None:
        self.assertEqual(
            preflight_data_sink(
                compute_profile="lite_gha",
                environment={"TZUDONG_DATA_ENV": "local_db"},
            ),
            "local_db",
        )

    def test_hosted_apply_request_fails_closed(self) -> None:
        with self.assertRaises(ProfileError) as ctx:
            preflight_data_sink(
                compute_profile="heavy_local",
                environment={"TZUDONG_DATA_SINK": "hosted_apply"},
            )
        self.assertEqual(ctx.exception.code, "hosted_apply_not_admitted")


def _queue_and_claim(store: MemoryStore, *, profile: str) -> object:
    run, _created = store.create_run(
        target="tzuyang",
        profile=profile,  # type: ignore[arg-type]
        idempotency_key=f"task4-{profile}",
        payload={"limit": 1},
        actor="operator",
        request_id="req-task4",
    )
    return run


class WorkerBoundaryTests(unittest.TestCase):
    def test_hosted_apply_halts_before_any_step(self) -> None:
        store = MemoryStore()
        run = _queue_and_claim(store, profile="heavy_local")
        with mock.patch.dict(
            "os.environ", {"TZUDONG_DATA_SINK": "hosted_apply"}, clear=False
        ):
            result = process_one(store, live=False)
        self.assertEqual(result, "Failed")
        stored = store.get(run.id)
        self.assertEqual(stored.error_code, "hosted_apply_not_admitted")
        # No step was started: the adapter index never advanced.
        self.assertEqual(stored.adapter_index, 0)

    def test_local_db_hosted_url_rejected_without_provider_string(self) -> None:
        store = MemoryStore()
        run = _queue_and_claim(store, profile="heavy_local")
        hosted_url = "https://abcdefghijklmnopqrst.supabase.co"
        env = {"SUPABASE_URL": hosted_url}
        with mock.patch.dict("os.environ", env, clear=False):
            # Ensure no explicit sink override; heavy_local defaults to local_db.
            import os

            os.environ.pop("TZUDONG_DATA_SINK", None)
            result = process_one(store, live=False)
        self.assertEqual(result, "Failed")
        stored = store.get(run.id)
        self.assertEqual(stored.error_code, "supabase_data_boundary_rejected")
        # The bounded code carries no provider host or DB error string.
        self.assertNotIn("supabase.co", stored.error_code)
        self.assertNotIn("abcdefghijklmnopqrst", stored.error_code)


if __name__ == "__main__":
    unittest.main()
