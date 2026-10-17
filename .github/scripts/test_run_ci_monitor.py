"""Tick integration: freeze boundary, deduplication and preserved state."""
import argparse
import fcntl
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import timedelta
from unittest.mock import patch
from pathlib import Path


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


TICK = module("ci_tick", "run-ci-monitor.py")
FIXTURE = module("ci_test_fixtures", "test_monitor_ci_performance.py")


class CiMonitorTickTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.baseline = FIXTURE.payload([FIXTURE.make_run(1, 10)])
        self.baseline["capturedAtUtc"] = "2026-10-10T10:01:31Z"
        self.baseline_path = self.root / "baseline.json"
        TICK.MONITOR.atomic_write_json(self.baseline_path, self.baseline)
        self.export = FIXTURE.payload([FIXTURE.make_run(2, 10, conclusion="failure")])
        self.export["capturedAtUtc"] = "2026-10-10T10:03:00Z"
        self.export["coverage"] = {"alerts": ["RECENT_WINDOW_TRUNCATED"]}
        self.input_path = self.root / "input.json"
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        self.args = argparse.Namespace(
            state_dir=self.root / "state", baseline=self.baseline_path,
            baseline_sha256=TICK.MONITOR.sha256_file(self.baseline_path), input=self.input_path,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_older_pagination_catch_up_never_becomes_after_sample(self):
        historical = FIXTURE.make_run(3, 10)
        historical.update(startedAt="2026-10-09T00:00:01Z", createdAt="2026-10-09T00:00:00Z")
        payload = {"workflow": self.export["workflow"], "runs": [self.baseline["runs"][0], historical, self.export["runs"][0]]}
        current = TICK.future_observations(payload, self.baseline)
        self.assertEqual([r["id"] for r in current["runs"]], [2])
        self.assertEqual(current["excludedHistoricalAttempts"], 1)

    def test_new_attempt_of_old_run_is_observed_when_attempt_start_is_after_freeze(self):
        retry = dict(self.baseline["runs"][0], attempt=2, startedAt="2026-10-11T00:00:00Z")
        current = TICK.future_observations({"workflow": self.export["workflow"], "runs": [retry]}, self.baseline)
        self.assertEqual(len(current["runs"]), 1)
        self.assertTrue(current["runs"][0]["attemptBoundaryVerified"])

    def test_new_attempt_uses_attempt_update_instead_of_original_creation(self):
        retry = dict(
            self.baseline["runs"][0],
            attempt=2,
            startedAt=None,
            createdAt="2026-10-09T00:00:00Z",
            updatedAt="2026-10-11T00:00:00Z",
        )
        current = TICK.future_observations(
            {"workflow": self.export["workflow"], "runs": [retry]}, self.baseline
        )
        self.assertEqual(len(current["runs"]), 1)
        self.assertTrue(current["runs"][0]["attemptBoundaryVerified"])
        self.assertEqual(current["uncertainAttemptBoundaryCount"], 0)

    def test_unlisted_old_run_rerun_uses_post_cutoff_attempt_update(self):
        retry = FIXTURE.make_run(3, 10, attempt=2)
        retry.update(
            startedAt=None,
            createdAt="2026-10-09T00:00:00Z",
            updatedAt="2026-10-11T00:00:00Z",
        )

        current = TICK.future_observations(
            {"workflow": self.export["workflow"], "runs": [retry]}, self.baseline
        )

        self.assertEqual(len(current["runs"]), 1)
        self.assertTrue(current["runs"][0]["attemptBoundaryVerified"])
        self.assertEqual(current["excludedHistoricalAttempts"], 0)
        self.assertEqual(current["uncertainAttemptBoundaryCount"], 0)

    def test_unlisted_old_run_rerun_without_attempt_clock_stays_pending(self):
        retry = FIXTURE.make_run(3, 10, attempt=2)
        retry.update(
            startedAt=None,
            createdAt="2026-10-09T00:00:00Z",
            updatedAt=None,
        )

        current = TICK.future_observations(
            {"workflow": self.export["workflow"], "runs": [retry]}, self.baseline
        )

        self.assertEqual(len(current["runs"]), 1)
        self.assertFalse(current["runs"][0]["attemptBoundaryVerified"])
        self.assertEqual(current["excludedHistoricalAttempts"], 0)
        self.assertEqual(current["uncertainAttemptBoundaryCount"], 1)

    def test_rerun_start_before_cutoff_remains_historical_after_late_update(self):
        retry = dict(
            self.baseline["runs"][0],
            attempt=2,
            startedAt="2026-10-10T10:00:00Z",
            createdAt="2026-10-09T00:00:00Z",
            updatedAt="2026-10-11T00:00:00Z",
        )

        current = TICK.future_observations(
            {"workflow": self.export["workflow"], "runs": [retry]}, self.baseline
        )

        self.assertEqual(current["runs"], [])
        self.assertEqual(current["excludedHistoricalAttempts"], 1)
        self.assertEqual(current["uncertainAttemptBoundaryCount"], 0)

    def test_listed_run_rerun_with_pre_cutoff_attempt_clocks_is_historical(self):
        retry = dict(
            self.baseline["runs"][0],
            attempt=2,
            startedAt="2026-10-10T10:00:00Z",
            createdAt="2026-10-09T00:00:00Z",
            updatedAt="2026-10-10T10:01:00Z",
        )

        current = TICK.future_observations(
            {"workflow": self.export["workflow"], "runs": [retry]}, self.baseline
        )

        self.assertEqual(current["runs"], [])
        self.assertEqual(current["excludedHistoricalAttempts"], 1)
        self.assertEqual(current["uncertainAttemptBoundaryCount"], 0)

    def test_original_run_update_does_not_move_a_historical_run_past_cutoff(self):
        historical = FIXTURE.make_run(3, 10)
        historical.update(
            startedAt="2026-10-09T00:00:01Z",
            createdAt="2026-10-09T00:00:00Z",
            updatedAt="2026-10-11T00:00:00Z",
        )
        current = TICK.future_observations(
            {"workflow": self.export["workflow"], "runs": [historical]},
            self.baseline,
        )
        self.assertEqual(current["runs"], [])
        self.assertEqual(current["excludedHistoricalAttempts"], 1)

    def test_attempt_clock_equal_to_cutoff_is_not_after(self):
        retry = dict(
            self.baseline["runs"][0],
            attempt=2,
            startedAt=None,
            createdAt="2026-10-09T00:00:00Z",
            updatedAt=self.baseline["capturedAtUtc"],
        )
        current = TICK.future_observations(
            {"workflow": self.export["workflow"], "runs": [retry]}, self.baseline
        )
        self.assertEqual(current["runs"], [])
        self.assertEqual(current["excludedHistoricalAttempts"], 1)
        self.assertEqual(current["uncertainAttemptBoundaryCount"], 0)

    def test_new_attempt_without_attempt_time_is_retained_as_pending(self):
        retry = FIXTURE.make_run(1, 10, attempt=2, conclusion="cancelled")
        retry.update(
            startedAt=None,
            createdAt="2026-10-09T00:00:00Z",
            updatedAt=None,
        )
        self.export["runs"] = [retry]
        self.export["coverage"] = {
            "alerts": [],
            "incrementalWindowComplete": True,
        }
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)

        result = TICK.tick(self.args)

        self.assertEqual(result["uncertainAttemptBoundaryCount"], 1)
        self.assertIn("failure:1:2", result["newAlertKeys"])
        self.assertEqual(result["referenceReadiness"]["blockingPendingCount"], 1)
        self.assertEqual(
            result["referenceReadiness"]["pendingReasonCounts"],
            {"attempt_cutoff_unverified": 1},
        )
        checkpoint = TICK.MONITOR.load_json(
            self.args.state_dir / "analysis-state.json"
        )
        observation = checkpoint["runs"]["1:2"]
        self.assertFalse(observation["attemptBoundaryVerified"])
        self.assertFalse(observation["snapshotImmutable"])

    def test_offline_tick_alerts_once_and_reuses_completed_attempts(self):
        first = TICK.tick(self.args)
        second = TICK.tick(self.args)
        self.assertTrue(first["shouldNotify"])
        self.assertIn("failure:2:1", first["newAlertKeys"])
        self.assertFalse(second["shouldNotify"])
        self.assertEqual(second["admittedAttemptCount"], 0)
        self.assertEqual(second["duplicateAttemptCount"], 2)
        self.assertEqual(second["remoteMutations"], 0)
        self.assertEqual(second["modelsInvokedByProgram"], 0)
        self.assertEqual(second["mode"], "offline_replay")
        self.assertEqual(second["apiRequestsThisTick"], 0)
        self.assertEqual(second["referenceReadiness"]["status"], "collecting_reference")

    def test_terminal_chronology_defect_remains_pending_until_corrected(self):
        defective = FIXTURE.make_run(2, 10, attempt=2)
        defective["jobs"][0]["createdAt"] = FIXTURE.timestamp(
            TICK.MONITOR.parse_timestamp(defective["jobs"][0]["startedAt"])
            + timedelta(seconds=1)
        )
        self.export = FIXTURE.payload([defective])
        self.export["capturedAtUtc"] = "2026-10-10T10:03:00Z"
        self.export["coverage"] = {
            "alerts": [],
            "incrementalWindowComplete": True,
        }
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)

        first = TICK.tick(self.args)
        chronology_alert = (
            "chronology:2:2:JOB_START_PRECEDES_JOB_CREATION"
        )
        self.assertIn(chronology_alert, first["newAlertKeys"])
        self.assertEqual(first["chronologyInvalidAttemptCount"], 1)
        readiness = first["referenceReadiness"]
        self.assertEqual(readiness["status"], "collecting_reference")
        self.assertEqual(readiness["successCount"], 0)
        self.assertEqual(readiness["blockingPendingCount"], 1)
        self.assertEqual(
            readiness["pendingReasonCounts"], {"chronology_invalid_attempt": 1}
        )
        self.assertEqual(readiness["timingExcludedTerminalCount"], 1)
        self.assertEqual(
            readiness["timingExclusionReasonCounts"],
            {"invalid_timing_order": 1},
        )
        self.assertEqual(readiness["chronologyInvalidAttemptCount"], 1)

        repeated = TICK.tick(self.args)
        self.assertFalse(repeated["shouldNotify"])
        self.assertEqual(repeated["admittedAttemptCount"], 0)
        self.assertEqual(repeated["duplicateAttemptCount"], 2)

        normal = FIXTURE.make_run(3, 10)
        self.export["runs"] = [defective, normal]
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        continued = TICK.tick(self.args)
        self.assertEqual(continued["admittedAttemptCount"], 1)
        self.assertEqual(continued["chronologyInvalidAttemptCount"], 1)
        self.assertEqual(
            continued["referenceReadiness"]["blockingPendingCount"], 1
        )
        self.assertEqual(
            continued["referenceReadiness"]["timingExcludedTerminalCount"], 1
        )

        corrected = FIXTURE.make_run(2, 10, attempt=2)
        self.export["runs"] = [corrected, normal]
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        repaired = TICK.tick(self.args)
        self.assertEqual(repaired["admittedAttemptCount"], 1)
        self.assertEqual(repaired["chronologyInvalidAttemptCount"], 0)
        self.assertEqual(
            repaired["referenceReadiness"]["blockingPendingCount"], 0
        )
        self.assertEqual(
            repaired["referenceReadiness"]["timingExcludedTerminalCount"], 0
        )

    def test_receipts_use_only_state_relative_opaque_paths(self):
        result = TICK.tick(self.args)
        self.assertTrue(result["receiptPath"].startswith("state://ticks/"))
        receipt = TICK.resolve_state_receipt_ref(
            self.args.state_dir, result["receiptPath"]
        )
        self.assertTrue(receipt.is_file())
        serialized = json.dumps(result, sort_keys=True)
        self.assertNotIn(str(self.root), serialized)
        self.assertNotIn("/Users/", serialized)
        for retained in (
            self.args.state_dir / "last-tick.json",
            self.args.state_dir / "ticks" / result["tickId"] / "tick.json",
            TICK.resolve_state_receipt_ref(
                self.args.state_dir,
                result["referenceReadiness"]["readinessReceiptPath"],
            ),
        ):
            contents = retained.read_text(encoding="utf-8")
            self.assertNotIn(str(self.root), contents)
            self.assertNotIn("/Users/", contents)

    def test_ready_reference_notifies_once_without_activating_it(self):
        self.export = FIXTURE.payload([
            FIXTURE.make_run(100 + index, 40) for index in range(7)
        ])
        self.export["capturedAtUtc"] = "2026-10-11T12:00:00Z"
        self.export["coverage"] = {
            "alerts": [],
            "incrementalWindowComplete": True,
        }
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        first = TICK.tick(self.args)
        reference = first["referenceReadiness"]
        self.assertEqual(reference["status"], "reference_candidate_ready")
        self.assertTrue(reference["candidateBaselinePath"].startswith("state://"))
        self.assertTrue(any(key.startswith("reference_ready:") for key in first["newAlertKeys"]))
        self.assertTrue(first["shouldNotify"])

        second = TICK.tick(self.args)
        self.assertEqual(second["referenceReadiness"]["candidateBaselineSha256"], reference["candidateBaselineSha256"])
        self.assertFalse(second["shouldNotify"])

    def test_state_receipt_reader_rejects_escape_and_absolute_paths(self):
        for reference in (
            "state://../analysis.json",
            "state:///tmp/analysis.json",
            str(self.root / "analysis.json"),
        ):
            with self.assertRaises(TICK.TickError):
                TICK.resolve_state_receipt_ref(self.args.state_dir, reference)

    def test_reference_failure_is_reported_with_fixed_code_without_traceback(self):
        arguments = [
            "--state-dir", str(self.args.state_dir),
            "--baseline", str(self.baseline_path),
            "--baseline-sha256", self.args.baseline_sha256,
            "--input", str(self.input_path),
        ]
        output = io.StringIO()
        with patch.object(
            TICK.REFERENCE,
            "evaluate_reference",
            side_effect=TICK.REFERENCE.ReferenceError("PRIVATE_DETAIL"),
        ), redirect_stdout(output):
            self.assertEqual(TICK.main(arguments), 2)
        self.assertEqual(
            json.loads(output.getvalue()),
            {"status": "failed", "code": "MONITOR_TICK_FAILED", "remoteMutations": 0},
        )
        self.assertNotIn("PRIVATE_DETAIL", output.getvalue())

    def test_baseline_and_configuration_changes_fail_without_overwriting_checkpoint(self):
        TICK.tick(self.args)
        checkpoint = self.args.state_dir / "analysis-state.json"
        previous = checkpoint.read_bytes()
        self.args.baseline_sha256 = "0" * 64
        with self.assertRaisesRegex(TICK.TickError, "BASELINE_HASH_MISMATCH"):
            TICK.tick(self.args)
        self.assertEqual(checkpoint.read_bytes(), previous)
        self.args.baseline_sha256 = TICK.MONITOR.sha256_file(self.baseline_path)
        config = self.args.state_dir / "monitor-config.json"
        value = TICK.MONITOR.load_json(config); value["limit"] = 99
        TICK.MONITOR.atomic_write_json(config, value)
        with self.assertRaisesRegex(TICK.TickError, "MONITOR_CONFIG_CHANGED"):
            TICK.tick(self.args)
        self.assertEqual(checkpoint.read_bytes(), previous)

    def test_tick_uses_the_authenticated_baseline_snapshot_after_source_changes(self):
        replacement = FIXTURE.payload([FIXTURE.make_run(99, 10)])
        replacement["capturedAtUtc"] = self.baseline["capturedAtUtc"]
        replacement_bytes = TICK.MONITOR.canonical_json(replacement)
        original_read_bytes = Path.read_bytes
        baseline_reads = 0

        def mutate_after_read(path):
            nonlocal baseline_reads
            payload = original_read_bytes(path)
            if path == self.baseline_path:
                baseline_reads += 1
                if baseline_reads == 1:
                    path.write_bytes(replacement_bytes)
            return payload

        with patch.object(Path, "read_bytes", new=mutate_after_read):
            result = TICK.tick(self.args)

        self.assertEqual(baseline_reads, 1)
        self.assertEqual(result["status"], "observed")
        checkpoint = TICK.MONITOR.load_json(
            self.args.state_dir / "analysis-state.json"
        )
        self.assertIn("1:1", checkpoint["runs"])
        self.assertNotIn("99:1", checkpoint["runs"])
        retained_baseline = TICK.MONITOR.load_json(
            self.args.state_dir / "ticks" / result["tickId"] / "baseline.json"
        )
        self.assertEqual(retained_baseline["runs"][0]["id"], 1)
        self.assertEqual(
            TICK.MONITOR.load_json(self.baseline_path)["runs"][0]["id"], 99
        )

    def test_unfinished_or_incomplete_baseline_is_rejected_with_fixed_code(self):
        for baseline_run in (
            FIXTURE.make_run(1, 10, status="in_progress"),
            FIXTURE.make_run(1, 10, incomplete_step=True),
            FIXTURE.make_run(1, 10, conclusion="missing"),
        ):
            baseline = FIXTURE.payload([baseline_run])
            baseline["capturedAtUtc"] = "2026-10-10T10:01:31Z"
            TICK.MONITOR.atomic_write_json(self.baseline_path, baseline)
            arguments = [
                "--state-dir", str(self.args.state_dir),
                "--baseline", str(self.baseline_path),
                "--baseline-sha256", TICK.MONITOR.sha256_file(self.baseline_path),
                "--input", str(self.input_path),
            ]
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(TICK.main(arguments), 2)
            self.assertEqual(
                json.loads(output.getvalue())["code"],
                "BASELINE_TERMINAL_EVIDENCE_INCOMPLETE",
            )
            self.assertFalse((self.args.state_dir / "analysis-state.json").exists())

    def test_chronology_invalid_baseline_remains_fail_closed(self):
        baseline_run = FIXTURE.make_run(1, 10)
        baseline_run["jobs"][0]["createdAt"] = FIXTURE.timestamp(
            TICK.MONITOR.parse_timestamp(
                baseline_run["jobs"][0]["startedAt"]
            ) + timedelta(seconds=1)
        )
        baseline = FIXTURE.payload([baseline_run])
        baseline["capturedAtUtc"] = "2026-10-10T10:01:31Z"
        TICK.MONITOR.atomic_write_json(self.baseline_path, baseline)
        arguments = [
            "--state-dir", str(self.args.state_dir),
            "--baseline", str(self.baseline_path),
            "--baseline-sha256", TICK.MONITOR.sha256_file(self.baseline_path),
            "--input", str(self.input_path),
        ]
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(TICK.main(arguments), 2)
        self.assertEqual(
            json.loads(output.getvalue())["code"],
            "BASELINE_TERMINAL_EVIDENCE_INCOMPLETE",
        )
        self.assertFalse((self.args.state_dir / "analysis-state.json").exists())

    def test_terminal_failure_and_cancelled_baseline_attempts_are_valid(self):
        terminal = [
            FIXTURE.make_run(10, 10, conclusion="failure"),
            FIXTURE.make_run(11, 10, conclusion="cancelled"),
        ]
        for record in terminal:
            for job in record["jobs"]:
                job["startedAt"] = None
                job["completedAt"] = None
                for step in job["steps"]:
                    step["startedAt"] = None
                    step["completedAt"] = None
        baseline = FIXTURE.payload(terminal)
        baseline["capturedAtUtc"] = "2026-10-10T10:12:00Z"
        TICK.MONITOR.atomic_write_json(self.baseline_path, baseline)
        self.args.baseline_sha256 = TICK.MONITOR.sha256_file(self.baseline_path)
        result = TICK.tick(self.args)
        self.assertEqual(result["status"], "observed")
        analysis = TICK.MONITOR.load_json(
            TICK.resolve_state_receipt_ref(self.args.state_dir, result["receiptPath"])
        )["analysis"]
        self.assertEqual(analysis["runConclusionCounts"]["failure"], 1)
        self.assertEqual(analysis["runConclusionCounts"]["cancelled"], 1)

    def test_an_existing_tick_lock_blocks_duplicate_execution(self):
        self.args.state_dir.mkdir()
        with (self.args.state_dir / "tick.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(TICK.TickError, "MONITOR_ALREADY_RUNNING"):
                TICK.tick(self.args)

    def test_lost_last_receipt_preserves_checkpoint_and_retries_without_readmitting(self):
        original = TICK.MONITOR.atomic_write_json
        def fail_last(path, value):
            if path.name == "last-tick.json":
                raise OSError("fixture receipt write interruption")
            return original(path, value)
        with patch.object(TICK.MONITOR, "atomic_write_json", side_effect=fail_last):
            with self.assertRaises(OSError):
                TICK.tick(self.args)
        self.assertTrue((self.args.state_dir / "analysis-state.json").exists())
        recovered = TICK.tick(self.args)
        self.assertEqual(recovered["admittedAttemptCount"], 0)
        self.assertEqual(recovered["duplicateAttemptCount"], 2)
        self.assertIn("failure:2:1", recovered["newAlertKeys"])
        self.assertFalse(TICK.tick(self.args)["shouldNotify"])

    def test_active_attempt_can_become_tombstone_without_becoming_a_time_sample(self):
        active = FIXTURE.make_run(2, 10, status="in_progress")
        active["conclusion"] = None
        self.export["runs"] = [active]
        self.export["coverage"] = {"alerts": []}
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        self.assertFalse(TICK.tick(self.args)["shouldNotify"])
        self.export["runs"] = [dict(active, status="missing", conclusion="stale", tombstone=True, jobs=[], jobsTotalCount=0)]
        TICK.MONITOR.atomic_write_json(self.input_path, self.export)
        observed = TICK.tick(self.args)
        self.assertIn("failure:2:1", observed["newAlertKeys"])
        analysis = TICK.MONITOR.load_json(
            TICK.resolve_state_receipt_ref(
                self.args.state_dir, observed["receiptPath"]
            )
        )["analysis"]
        self.assertEqual(analysis["timingUsableRunCount"], 1)  # frozen baseline only
        self.assertEqual(analysis["runConclusionCounts"]["stale"], 1)

    def test_driver_budget_covers_listed_active_terminal_and_baseline_attempts(self):
        TICK.tick(self.args)
        config = TICK.MONITOR.load_json(self.args.state_dir / "monitor-config.json")
        self.assertGreaterEqual(
            config["maximumInputAttempts"],
            (
                20 * 5
                + 100
                + config["maximumKnownTerminalRunRefreshes"]
            ) * 10 + config["maximumBaselineAttempts"],
        )
        self.assertLessEqual(config["maximumInputAttempts"], TICK.MONITOR.MAX_INPUT_RUNS)


if __name__ == "__main__":
    unittest.main()
