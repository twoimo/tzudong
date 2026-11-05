#!/usr/bin/env python3
"""Focused regression tests for monitor-ci-performance.py."""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("monitor-ci-performance.py")
SPEC = importlib.util.spec_from_file_location("monitor_ci_performance", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)


def timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_run(
    run_id: int,
    duration: int,
    *,
    event: str = "pull_request",
    conclusion: str = "success",
    status: str = "completed",
    attempt: int = 1,
    malformed: bool = False,
    incomplete_step: bool = False,
    unsafe_step_name: str | None = None,
) -> dict:
    base = datetime(2026, 10, 10, 10, 0, tzinfo=timezone.utc) + timedelta(
        minutes=run_id % 1_000
    )
    started = base + timedelta(seconds=2)
    completed = started + timedelta(seconds=duration)
    platform_names = ("Ubuntu Bun", "Ubuntu npm", "Windows Bun", "Windows npm")
    jobs = []
    for index, name in enumerate(platform_names):
        primary = index == 0
        job_status = status if primary else "completed"
        job_conclusion = conclusion if primary else "success"
        step_incomplete = incomplete_step and primary
        jobs.append(
            {
                "name": name,
                "status": job_status,
                "conclusion": job_conclusion,
                "createdAt": timestamp(base),
                "startedAt": timestamp(started),
                "completedAt": timestamp(completed),
                "runnerLabels": [
                    "windows-latest" if name.startswith("Windows") else "ubuntu-latest"
                ],
                "steps": [
                    {
                        "number": 1,
                        "name": (
                            unsafe_step_name
                            if primary and unsafe_step_name
                            else "Run npm run typecheck:benchmark"
                        ),
                        "status": "in_progress" if step_incomplete else "completed",
                        "conclusion": None if step_incomplete else job_conclusion,
                        "startedAt": timestamp(started),
                        "completedAt": (
                            None if step_incomplete else timestamp(completed)
                        ),
                    }
                ],
            }
        )
    job_topology = MONITOR.incremental_digest(sorted(platform_names))
    return {
        "id": run_id,
        "attempt": attempt,
        "event": event,
        "status": status,
        "conclusion": conclusion,
        "jobsTotalCount": len(jobs),
        "jobsAttempt": attempt,
        "headSha": f"{run_id:040x}"[-40:],
        "sourceTree": f"{run_id + 10_000:040x}"[-40:],
        "workflowRevision": "a" * 64,
        "executionMode": "full_benchmark",
        "jobTopology": job_topology,
        "createdAt": "not-a-time" if malformed else timestamp(base),
        "startedAt": "not-a-time" if malformed else timestamp(base),
        "updatedAt": timestamp(completed),
        "jobs": jobs,
    }


def payload(runs: list[dict], workflow: str | None = ".github/workflows/web-admin-ci.yml") -> dict:
    result = {"runs": runs}
    if workflow is not None:
        result["workflow"] = {"path": workflow}
    return result


class MonitorCiPerformanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.checkpoint = self.root / "checkpoint.json"
        self.receipt = self.root / "receipt.json"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, name: str, value: object) -> Path:
        path = self.root / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def invoke(self, before: Path | None = None, after: Path | None = None) -> dict:
        arguments = [
            "--checkpoint",
            str(self.checkpoint),
            "--receipt",
            str(self.receipt),
            "--bootstrap-resamples",
            "1000",
        ]
        if before is not None:
            arguments += ["--before-input", str(before)]
        if after is not None:
            arguments += ["--after-input", str(after)]
        with redirect_stdout(io.StringIO()):
            self.assertEqual(MONITOR.main(arguments), 0)
        return json.loads(self.receipt.read_text(encoding="utf-8"))

    def assert_input_rejected(
        self, value: object, *, before: bool = False, name: str = "rejected.json"
    ) -> None:
        source = self.write(name, value)
        self.receipt.write_text("unchanged", encoding="utf-8")
        arguments = [
            "--before-input" if before else "--after-input",
            str(source),
            "--checkpoint",
            str(self.checkpoint),
            "--receipt",
            str(self.receipt),
            "--bootstrap-resamples",
            "1000",
        ]
        with self.assertRaises(MONITOR.MonitorError):
            with redirect_stdout(io.StringIO()):
                MONITOR.main(arguments)
        self.assertEqual(self.receipt.read_text(encoding="utf-8"), "unchanged")

    def test_improvement_signal_requires_seven_per_phase(self) -> None:
        before = self.write(
            "before.json", payload([make_run(100 + index, 100) for index in range(7)])
        )
        after = self.write(
            "after.json", payload([make_run(200 + index, 60) for index in range(7)])
        )
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(
            cohort["metrics"]["criticalPathSeconds"]["signal"],
            "exploratory_improvement_signal",
        )
        self.assertEqual(cohort["beforeTimingSuccessCount"], 7)
        self.assertEqual(cohort["afterTimingSuccessCount"], 7)
        self.assertFalse(cohort["causalClaimAllowed"])
        self.assertIsNone(cohort["metrics"]["criticalPathSeconds"]["before"]["p95"])

    def test_regression_signal_is_distinct(self) -> None:
        before = self.write(
            "before.json", payload([make_run(300 + index, 60) for index in range(7)])
        )
        after = self.write(
            "after.json", payload([make_run(400 + index, 110) for index in range(7)])
        )
        receipt = self.invoke(before, after)
        signal = receipt["analysis"]["cohorts"][0]["metrics"][
            "criticalPathSeconds"
        ]["signal"]
        self.assertEqual(signal, "exploratory_regression_signal")

    def test_single_after_run_never_confirms_improvement(self) -> None:
        before = self.write(
            "before.json", payload([make_run(500 + index, 100) for index in range(7)])
        )
        after = self.write("after.json", payload([make_run(600, 10)]))
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(cohort["metrics"], {})
        self.assertIn("minimum_7_before_and_7_after_successes_not_met", cohort["warnings"])

    def test_failure_and_cancelled_runs_are_preserved(self) -> None:
        before = self.write(
            "before.json",
            payload(
                [make_run(700 + index, 80) for index in range(7)]
                + [make_run(710, 20, conclusion="failure")]
            ),
        )
        after = self.write(
            "after.json",
            payload(
                [make_run(800 + index, 80) for index in range(7)]
                + [make_run(810, 20, conclusion="failure")]
                + [make_run(811, 20, conclusion="cancelled")]
            ),
        )
        receipt = self.invoke(before, after)
        counts = receipt["analysis"]["runConclusionCounts"]
        self.assertEqual(counts["failure"], 2)
        self.assertEqual(counts["cancelled"], 1)
        self.assertEqual(
            receipt["analysis"]["cohorts"][0]["failureSignal"],
            "failure_rate_increased",
        )

    def test_failure_rate_excludes_unfinished_attempts(self) -> None:
        rate = MONITOR.failure_rate(
            [
                {
                    "status": "completed",
                    "conclusion": "failure",
                    "timingUsable": False,
                },
                {
                    "status": "completed",
                    "conclusion": "cancelled",
                    "timingUsable": False,
                },
                {"status": "in_progress", "conclusion": "missing"},
                {"status": "completed", "conclusion": "missing"},
            ]
        )
        self.assertEqual(rate["n"], 2)
        self.assertEqual(rate["totalAttempts"], 4)
        self.assertEqual(rate["unfinishedAttempts"], 1)
        self.assertEqual(rate["incompleteTerminalAttempts"], 1)
        self.assertEqual(rate["failures"], 2)
        self.assertEqual(rate["percent"], 100.0)

    def test_duplicate_run_id_and_attempt_are_checkpointed(self) -> None:
        repeated = make_run(900, 80)
        first = self.write("first.json", payload([repeated, repeated]))
        receipt = self.invoke(after=first)
        self.assertEqual(receipt["admittedRunCount"], 1)
        self.assertEqual(receipt["duplicateRunIdCount"], 1)

        rerun = self.write("rerun.json", payload([make_run(900, 75, attempt=2)]))
        receipt = self.invoke(after=rerun)
        self.assertEqual(receipt["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertEqual(set(checkpoint["runs"]), {"900:1", "900:2"})

    def test_in_progress_run_can_be_replaced_by_completed_state(self) -> None:
        initial_run = make_run(950, 80, status="in_progress", conclusion="missing")
        initial = self.write("initial.json", payload([initial_run]))
        self.invoke(after=initial)
        completed = self.write("completed.json", payload([make_run(950, 80)]))
        receipt = self.invoke(after=completed)
        self.assertEqual(receipt["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["runs"]["950:1"]["conclusion"], "success")

    def test_malformed_timestamp_and_incomplete_step_do_not_crash(self) -> None:
        source = self.write(
            "observations.json",
            payload(
                [
                    make_run(1_000, 80, malformed=True),
                    make_run(1_001, 80, incomplete_step=True),
                ]
            ),
        )
        receipt = self.invoke(after=source)
        analysis = receipt["analysis"]
        self.assertEqual(analysis["malformedTimestampRunCount"], 1)
        self.assertEqual(analysis["incompleteStepCount"], 1)
        self.assertEqual(analysis["timingUsableRunCount"], 0)

    def test_non_object_run_and_job_entries_fail_closed(self) -> None:
        self.assert_input_rejected(
            payload([make_run(1_010, 80), None]),  # type: ignore[list-item]
            name="null-run.json",
        )
        malformed_job = make_run(1_011, 80)
        malformed_job["jobs"].append(None)
        self.assert_input_rejected(payload([malformed_job]), name="null-job.json")

    def test_job_timestamps_before_run_creation_are_rejected_from_baseline(self) -> None:
        base = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
        cases = {
            "created": {
                "createdAt": timestamp(base - timedelta(seconds=1)),
                "startedAt": timestamp(base + timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=2)),
            },
            "started": {
                "createdAt": timestamp(base - timedelta(seconds=2)),
                "startedAt": timestamp(base - timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=1)),
            },
            "completed": {
                "createdAt": timestamp(base - timedelta(seconds=3)),
                "startedAt": timestamp(base - timedelta(seconds=2)),
                "completedAt": timestamp(base - timedelta(seconds=1)),
            },
        }
        for index, (field, job_times) in enumerate(cases.items()):
            with self.subTest(field=field):
                run = make_run(1_020 + index, 80)
                run["createdAt"] = timestamp(base)
                run["jobs"][0].update(job_times)
                with self.assertRaises(MONITOR.MonitorError):
                    MONITOR.analyze_record(
                        run,
                        "before",
                        ".github/workflows/web-admin-ci.yml",
                        True,
                        "c" * 64,
                    )

    def test_identical_attempt_cannot_appear_in_both_phases(self) -> None:
        repeated = make_run(1_024, 80)
        before = self.write("phase-before.json", payload([repeated]))
        after = self.write("phase-after.json", payload([repeated]))
        self.receipt.write_text("unchanged", encoding="utf-8")
        with self.assertRaises(MONITOR.MonitorError):
            with redirect_stdout(io.StringIO()):
                MONITOR.main(
                    [
                        "--before-input",
                        str(before),
                        "--after-input",
                        str(after),
                        "--checkpoint",
                        str(self.checkpoint),
                        "--receipt",
                        str(self.receipt),
                        "--bootstrap-resamples",
                        "1000",
                    ]
                )
        self.assertEqual(self.receipt.read_text(encoding="utf-8"), "unchanged")

    def test_zero_baseline_relative_change_is_undefined_and_absolute_regression_applies(
        self,
    ) -> None:
        interval = MONITOR.bootstrap_mean_change(
            [0.0] * 7, [200.0] * 7, 1000, 20_261_011
        )
        self.assertIsNone(interval["relativeReductionPercent95Ci"])
        self.assertEqual(
            interval["relativeReductionStatus"], "undefined_zero_baseline"
        )
        mixed_zero_interval = MONITOR.bootstrap_mean_change(
            [0.0, 100.0] * 4, [200.0] * 8, 1000, 20_261_011
        )
        self.assertIsNone(mixed_zero_interval["relativeReductionPercent95Ci"])
        self.assertEqual(
            MONITOR.classify_signal(
                [0.0] * 7,
                [200.0] * 7,
                interval,
                MONITOR.DEFAULT_THRESHOLDS["runnerOccupiedSeconds"],
            ),
            "regression_signal",
        )

    def test_thresholds_reject_boolean_nonfinite_negative_and_overflow_values(self) -> None:
        malformed = (
            True,
            False,
            0,
            0.0,
            -0.01,
            float("nan"),
            float("inf"),
            10**1000,
        )
        for field in ("absoluteSeconds", "relativePercent"):
            for value in malformed:
                with self.subTest(field=field, value=value):
                    thresholds = {
                        metric: dict(defaults)
                        for metric, defaults in MONITOR.DEFAULT_THRESHOLDS.items()
                    }
                    thresholds["criticalPathSeconds"][field] = value
                    path = self.write("thresholds.json", {"thresholds": thresholds})
                    with self.assertRaisesRegex(MONITOR.MonitorError, "threshold"):
                        MONITOR.load_thresholds(path)

    def test_signal_boundaries_keep_unchanged_inconclusive(self) -> None:
        threshold = {"absoluteSeconds": 1.0, "relativePercent": 1.0}
        unchanged = {
            "absoluteReductionSeconds95Ci": [0.0, 0.0],
            "relativeReductionPercent95Ci": [0.0, 0.0],
        }
        better = {
            "absoluteReductionSeconds95Ci": [1.0, 1.0],
            "relativeReductionPercent95Ci": [1.0, 1.0],
        }
        worse = {
            "absoluteReductionSeconds95Ci": [-1.0, -1.0],
            "relativeReductionPercent95Ci": [-1.0, -1.0],
        }

        self.assertEqual(
            MONITOR.classify_signal([10.0] * 7, [10.0] * 7, unchanged, threshold),
            "inconclusive",
        )
        self.assertEqual(
            MONITOR.classify_signal([10.0] * 7, [9.0] * 7, better, threshold),
            "improvement_signal",
        )
        self.assertEqual(
            MONITOR.classify_signal([9.0] * 7, [10.0] * 7, worse, threshold),
            "regression_signal",
        )

    def test_incomplete_completed_attempt_can_be_replaced_when_evidence_completes(self) -> None:
        incomplete = self.write(
            "incomplete-completed.json",
            payload([make_run(1_025, 80, incomplete_step=True)]),
        )
        first = self.invoke(after=incomplete)
        self.assertEqual(first["analysis"]["timingUsableRunCount"], 0)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertFalse(checkpoint["runs"]["1025:1"]["terminalEvidenceComplete"])

        complete = self.write("complete.json", payload([make_run(1_025, 80)]))
        second = self.invoke(after=complete)
        self.assertEqual(second["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertTrue(checkpoint["runs"]["1025:1"]["terminalEvidenceComplete"])
        self.assertTrue(checkpoint["runs"]["1025:1"]["timingUsable"])

    def test_legacy_immutable_snapshot_is_revalidated_under_current_contract(self) -> None:
        valid = self.write("legacy-valid.json", payload([make_run(1_054, 80)]))
        self.invoke(after=valid)

        empty_steps = make_run(1_054, 80)
        empty_steps["jobs"][0]["steps"] = []
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        legacy = checkpoint["runs"]["1054:1"]
        legacy.pop("analysisFingerprint")
        legacy["sourceFingerprint"] = MONITOR.sha256_bytes(
            MONITOR.canonical_json(empty_steps)
        )
        legacy.update(
            terminalOutcomeComplete=True,
            terminalEvidenceComplete=True,
            timingUsable=True,
            timingExclusionReasons=[],
            snapshotImmutable=True,
        )
        self.checkpoint.write_text(json.dumps(checkpoint), encoding="utf-8")
        empty = self.write("legacy-empty-steps.json", payload([empty_steps]))

        receipt = self.invoke(after=empty)
        refreshed = json.loads(self.checkpoint.read_text(encoding="utf-8"))[
            "runs"
        ]["1054:1"]

        self.assertEqual(receipt["admittedRunCount"], 1)
        self.assertFalse(refreshed["terminalOutcomeComplete"])
        self.assertFalse(refreshed["timingUsable"])
        self.assertFalse(refreshed["snapshotImmutable"])
        self.assertIn("no_steps", refreshed["timingExclusionReasons"])

    def test_timestamped_nonterminal_step_can_be_replaced_when_it_completes(self) -> None:
        incomplete_run = make_run(1_027, 80)
        incomplete_run["jobs"][0]["steps"][0].update(
            {"status": "in_progress", "conclusion": None}
        )
        incomplete = self.write(
            "timestamped-nonterminal-step.json", payload([incomplete_run])
        )
        first = self.invoke(after=incomplete)
        self.assertEqual(first["analysis"]["incompleteStepCount"], 1)
        self.assertEqual(first["analysis"]["timingUsableRunCount"], 0)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertFalse(checkpoint["runs"]["1027:1"]["terminalEvidenceComplete"])

        complete = self.write(
            "timestamped-terminal-step.json", payload([make_run(1_027, 80)])
        )
        second = self.invoke(after=complete)
        self.assertEqual(second["admittedRunCount"], 1)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertTrue(checkpoint["runs"]["1027:1"]["terminalEvidenceComplete"])
        self.assertTrue(checkpoint["runs"]["1027:1"]["timingUsable"])

    def test_untimed_neutral_step_is_incomplete(self) -> None:
        run = make_run(1_028, 80)
        run["jobs"][0]["steps"][0].update(
            {
                "status": "completed",
                "conclusion": "neutral",
                "startedAt": None,
                "completedAt": None,
            }
        )
        source = self.write("untimed-neutral-step.json", payload([run]))
        receipt = self.invoke(after=source)
        self.assertEqual(receipt["analysis"]["incompleteStepCount"], 1)
        self.assertEqual(receipt["analysis"]["timingUsableRunCount"], 0)

    def test_step_timestamps_outside_baseline_bounds_are_rejected(self) -> None:
        base = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
        cases = {
            "before_job_start": {
                "startedAt": timestamp(base + timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=3)),
            },
            "after_job_completion": {
                "startedAt": timestamp(base + timedelta(seconds=3)),
                "completedAt": timestamp(base + timedelta(seconds=83)),
            },
            "completion_before_start": {
                "startedAt": timestamp(base + timedelta(seconds=4)),
                "completedAt": timestamp(base + timedelta(seconds=3)),
            },
            "before_run_creation": {
                "startedAt": timestamp(base - timedelta(seconds=1)),
                "completedAt": timestamp(base + timedelta(seconds=1)),
            },
        }
        for index, (case, step_times) in enumerate(cases.items()):
            with self.subTest(case=case):
                run = make_run(1_030 + index, 80)
                run["createdAt"] = timestamp(base)
                run["jobs"][0].update(
                    {
                        "createdAt": timestamp(base),
                        "startedAt": (
                            None
                            if case == "before_run_creation"
                            else timestamp(base + timedelta(seconds=2))
                        ),
                        "completedAt": timestamp(base + timedelta(seconds=82)),
                    }
                )
                run["jobs"][0]["steps"][0].update(step_times)
                with self.assertRaises(MONITOR.MonitorError):
                    MONITOR.analyze_record(
                        run,
                        "before",
                        ".github/workflows/web-admin-ci.yml",
                        True,
                        "d" * 64,
                    )

    def test_after_chronology_defect_is_replaceable_and_excluded_from_timing(self) -> None:
        defective = make_run(1_035, 80, attempt=2)
        defective["jobs"][0]["createdAt"] = timestamp(
            MONITOR.parse_timestamp(defective["jobs"][0]["startedAt"])
            + timedelta(seconds=1)
        )
        first_source = self.write("chronology-defect.json", payload([defective]))
        first = self.invoke(after=first_source)
        observation = json.loads(
            self.checkpoint.read_text(encoding="utf-8")
        )["runs"]["1035:2"]

        self.assertFalse(observation["chronologyValid"])
        self.assertEqual(
            observation["chronologyIssueCodes"],
            ["JOB_START_PRECEDES_JOB_CREATION"],
        )
        self.assertTrue(observation["terminalOutcomeComplete"])
        self.assertTrue(observation["terminalEvidenceComplete"])
        self.assertFalse(observation["snapshotImmutable"])
        self.assertFalse(observation["timingUsable"])
        self.assertIn("invalid_timing_order", observation["timingExclusionReasons"])
        self.assertIsNone(observation["criticalPathSeconds"])
        self.assertIsNone(observation["runnerOccupiedSeconds"])
        self.assertIsNone(observation["totalQueueSeconds"])
        self.assertEqual(observation["stageSeconds"], {})
        self.assertEqual(first["analysis"]["chronologyInvalidRunCount"], 1)
        self.assertEqual(
            first["analysis"]["chronologyIssueCodeCounts"],
            {"JOB_START_PRECEDES_JOB_CREATION": 1},
        )

        duplicate = self.invoke(after=first_source)
        self.assertEqual(duplicate["admittedRunCount"], 0)
        self.assertEqual(duplicate["duplicateRunIdCount"], 1)

        normal = make_run(1_036, 40)
        continued_source = self.write(
            "chronology-defect-plus-new.json", payload([defective, normal])
        )
        continued = self.invoke(after=continued_source)
        self.assertEqual(continued["admittedRunCount"], 1)
        self.assertEqual(continued["analysis"]["timingUsableRunCount"], 1)
        self.assertEqual(continued["analysis"]["chronologyInvalidRunCount"], 1)

        corrected = make_run(1_035, 80, attempt=2)
        corrected_source = self.write(
            "corrected-chronology-attempt.json", payload([corrected])
        )
        corrected_receipt = self.invoke(after=corrected_source)
        corrected_observation = json.loads(
            self.checkpoint.read_text(encoding="utf-8")
        )["runs"]["1035:2"]
        self.assertEqual(corrected_receipt["admittedRunCount"], 1)
        self.assertTrue(corrected_observation["terminalEvidenceComplete"])
        self.assertTrue(corrected_observation["chronologyValid"])
        self.assertTrue(corrected_observation["timingUsable"])
        self.assertEqual(corrected_observation["chronologyIssueCodes"], [])

        changed = dict(corrected)
        changed["updatedAt"] = "2026-10-12T00:00:00Z"
        self.assert_input_rejected(
            payload([changed]), name="changed-immutable-chronology-defect.json"
        )

    def test_partial_rerun_outcome_is_terminal_but_inherited_timing_is_excluded(self) -> None:
        run = make_run(1_037, 80, attempt=2)
        run_started = MONITOR.parse_timestamp(run["startedAt"])
        inherited_started = run_started - timedelta(minutes=15)
        inherited_completed = inherited_started + timedelta(minutes=10)
        job = run["jobs"][0]
        job.update(
            createdAt=timestamp(run_started + timedelta(seconds=1)),
            startedAt=timestamp(inherited_started),
            completedAt=timestamp(inherited_completed),
        )
        job["steps"][0].update(
            startedAt=timestamp(inherited_started),
            completedAt=timestamp(inherited_completed),
        )
        source = self.write("partial-rerun.json", payload([run]))
        self.invoke(after=source)
        observation = MONITOR.load_json(self.checkpoint)["runs"]["1037:2"]

        self.assertTrue(observation["terminalOutcomeComplete"])
        self.assertFalse(observation["timingUsable"])
        self.assertFalse(observation["snapshotImmutable"])
        self.assertIn("JOB_START_PRECEDES_JOB_CREATION", observation["chronologyIssueCodes"])
        self.assertIn("JOB_START_PRECEDES_RUN_START", observation["chronologyIssueCodes"])
        self.assertEqual(observation["stageSeconds"], {})

    def test_terminal_outcome_requires_job_and_step_conclusions(self) -> None:
        for target in ("job", "step"):
            with self.subTest(target=target):
                run = make_run(1_038 if target == "job" else 1_039, 20)
                if target == "job":
                    run["jobs"][0]["conclusion"] = None
                else:
                    run["jobs"][0]["steps"][0]["conclusion"] = None
                observation = MONITOR.analyze_record(
                    run,
                    "after",
                    ".github/workflows/web-admin-ci.yml",
                    True,
                    "e" * 64,
                )
                self.assertFalse(observation["terminalOutcomeComplete"])
                self.assertFalse(observation["timingUsable"])

    def test_success_without_step_evidence_is_refreshable(self) -> None:
        for name, value in (("missing", "missing"), ("null", None), ("empty", [])):
            with self.subTest(name=name):
                run = make_run(1_048, 20)
                if value == "missing":
                    run["jobs"][0].pop("steps")
                else:
                    run["jobs"][0]["steps"] = value
                observation = MONITOR.analyze_record(
                    run,
                    "after",
                    ".github/workflows/web-admin-ci.yml",
                    True,
                    "e" * 64,
                )
                self.assertFalse(observation["terminalOutcomeComplete"])
                self.assertFalse(observation["timingUsable"])
                self.assertFalse(observation["snapshotImmutable"])
                self.assertIn("no_steps", observation["timingExclusionReasons"])

    def test_skipped_job_without_steps_does_not_invalidate_success_run(self) -> None:
        run = make_run(1_053, 20)
        run["jobs"][0].update(conclusion="skipped", steps=[])

        observation = MONITOR.analyze_record(
            run,
            "after",
            ".github/workflows/web-admin-ci.yml",
            True,
            "f" * 64,
        )

        self.assertTrue(observation["terminalOutcomeComplete"])
        self.assertTrue(observation["timingUsable"])
        self.assertTrue(observation["snapshotImmutable"])
        self.assertNotIn("no_steps", observation["timingExclusionReasons"])

    def test_digest_fields_require_exact_producer_lengths(self) -> None:
        invalid_git_ids = (
            "a" * 41,
            "a" * 63,
            "sha256:" + "a" * 40,
            "sha256:" + "a" * 64,
        )
        for field in ("sourceTree", "workflowRevision"):
            for invalid in invalid_git_ids:
                with self.subTest(field=field, length=len(invalid)):
                    run = make_run(1_049, 20)
                    run[field] = invalid
                    observation = MONITOR.analyze_record(
                        run,
                        "after",
                        ".github/workflows/web-admin-ci.yml",
                        True,
                        "d" * 64,
                    )
                    self.assertIsNone(observation[field])
                    self.assertFalse(observation["cohortMetadataVerified"])

        for invalid in (
            "b" * 40,
            "b" * 41,
            "b" * 63,
            "sha256:" + "b" * 40,
            "sha256:" + "b" * 64,
        ):
            with self.subTest(field="jobTopology", length=len(invalid)):
                run = make_run(1_050, 20)
                run["jobTopology"] = invalid
                observation = MONITOR.analyze_record(
                    run,
                    "after",
                    ".github/workflows/web-admin-ci.yml",
                    True,
                    "c" * 64,
                )
                self.assertIsNone(observation["jobTopology"])
                self.assertFalse(observation["cohortMetadataVerified"])

        for git_id in ("c" * 40, "c" * 64):
            with self.subTest(valid_git_id_length=len(git_id)):
                run = make_run(1_051, 20)
                run["sourceTree"] = git_id
                run["workflowRevision"] = git_id
                observation = MONITOR.analyze_record(
                    run,
                    "after",
                    ".github/workflows/web-admin-ci.yml",
                    True,
                    "b" * 64,
                )
                self.assertTrue(observation["cohortMetadataVerified"])

    def test_claimed_topology_and_execution_mode_must_match_retained_jobs(self) -> None:
        wrong_topology = make_run(1_052, 20)
        wrong_topology["jobTopology"] = "f" * 64
        topology_observation = MONITOR.analyze_record(
            wrong_topology,
            "after",
            ".github/workflows/web-admin-ci.yml",
            True,
            "d" * 64,
        )
        self.assertIsNone(topology_observation["jobTopology"])
        self.assertFalse(topology_observation["cohortMetadataVerified"])

        wrong_mode = make_run(1_053, 20)
        wrong_mode["executionMode"] = "diagnostic"
        mode_observation = MONITOR.analyze_record(
            wrong_mode,
            "after",
            ".github/workflows/web-admin-ci.yml",
            True,
            "e" * 64,
        )
        self.assertEqual(mode_observation["executionMode"], "unknown")
        self.assertFalse(mode_observation["cohortMetadataVerified"])

    def test_unverified_attempt_boundary_stays_out_of_failure_rate_signals(self) -> None:
        before_runs = [make_run(1_060 + index, 20) for index in range(7)]
        after_runs = [make_run(1_070 + index, 20) for index in range(7)]
        uncertain = make_run(1_080, 20, conclusion="cancelled", attempt=2)
        uncertain["attemptBoundaryVerified"] = False
        before = self.write("boundary-before.json", payload(before_runs))
        after = self.write(
            "boundary-after.json", payload([*after_runs, uncertain])
        )

        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]

        self.assertEqual(cohort["beforeFailureRate"]["n"], 7)
        self.assertEqual(cohort["afterFailureRate"]["n"], 7)
        self.assertEqual(cohort["afterFailureRate"]["failures"], 0)
        self.assertEqual(cohort["failureSignal"], "insufficient_samples")

    def test_terminal_failure_outcome_does_not_require_timing(self) -> None:
        run = make_run(1_040, 20, conclusion="failure")
        run["startedAt"] = None
        run["updatedAt"] = None
        job = run["jobs"][0]
        job.update(startedAt=None, completedAt=None)
        job["steps"][0].update(startedAt=None, completedAt=None)
        observation = MONITOR.analyze_record(
            run,
            "after",
            ".github/workflows/web-admin-ci.yml",
            True,
            "f" * 64,
        )
        self.assertTrue(observation["terminalOutcomeComplete"])
        self.assertFalse(observation["timingUsable"])
        self.assertTrue(observation["snapshotImmutable"])

    def test_unknown_runner_family_invalidates_cohort_metadata(self) -> None:
        run = make_run(1_041, 20)
        run["jobs"][0]["runnerLabels"] = ["mystery-runner"]
        observation = MONITOR.analyze_record(
            run,
            "after",
            ".github/workflows/web-admin-ci.yml",
            True,
            "1" * 64,
        )
        self.assertIn("unknown", observation["runnerFamilies"])
        self.assertFalse(observation["cohortMetadataVerified"])

    def test_scalar_or_null_steps_are_rejected_instead_of_dropped(self) -> None:
        for invalid in (None, "scalar", 3):
            with self.subTest(invalid=invalid):
                run = make_run(1_042, 20)
                run["jobs"][0]["steps"].append(invalid)
                self.assert_input_rejected(payload([run]), name=f"bad-step-{invalid!s}.json")

    def test_falsey_scalar_step_collections_are_rejected(self) -> None:
        for invalid in (False, 0, ""):
            with self.subTest(invalid=invalid):
                run = make_run(1_052, 20)
                run["jobs"][0]["steps"] = invalid
                self.assert_input_rejected(
                    payload([run]), name=f"bad-step-collection-{invalid!s}.json"
                )

    def test_attempt_defaults_only_when_absent(self) -> None:
        absent = make_run(1_043, 20)
        absent.pop("attempt")
        absent["jobsAttempt"] = 1
        observation = MONITOR.analyze_record(
            absent,
            "after",
            ".github/workflows/web-admin-ci.yml",
            True,
            "2" * 64,
        )
        self.assertEqual(observation["attempt"], 1)
        for invalid in (0, False, None):
            with self.subTest(invalid=invalid):
                run = make_run(1_044, 20)
                run["attempt"] = invalid
                self.assert_input_rejected(payload([run]), name=f"bad-attempt-{invalid!s}.json")

    def test_jobs_attempt_requires_a_non_boolean_positive_integer(self) -> None:
        for invalid in (True, False, 0, -1, "1", None):
            with self.subTest(invalid=invalid):
                run = make_run(1_046, 20, attempt=1)
                run["jobsAttempt"] = invalid
                observation = MONITOR.analyze_record(
                    run,
                    "after",
                    ".github/workflows/web-admin-ci.yml",
                    True,
                    "3" * 64,
                )
                self.assertFalse(observation["timingUsable"])
                self.assertFalse(observation["attemptJobSetComplete"])
                self.assertFalse(observation["snapshotImmutable"])
                self.assertIn(
                    "incomplete_job_set", observation["timingExclusionReasons"]
                )

    def test_run_envelope_violations_are_fixed_codes(self) -> None:
        cases = {
            "start": ("startedAt", -1, "RUN_START_PRECEDES_RUN_CREATION"),
            "update": ("updatedAt", 200, "JOB_COMPLETION_FOLLOWS_RUN_UPDATE"),
        }
        for name, (field, offset, code) in cases.items():
            with self.subTest(name=name):
                run = make_run(1_045, 20)
                base = MONITOR.parse_timestamp(run["createdAt"])
                if field == "startedAt":
                    run[field] = timestamp(base + timedelta(seconds=offset))
                else:
                    # Put the run update before the completed job.
                    run[field] = timestamp(base + timedelta(seconds=2))
                observation = MONITOR.analyze_record(
                    run,
                    "after",
                    ".github/workflows/web-admin-ci.yml",
                    True,
                    "3" * 64,
                )
                self.assertIn(code, observation["chronologyIssueCodes"])
                self.assertFalse(observation["timingUsable"])
                with self.assertRaises(MONITOR.ChronologyError):
                    MONITOR.analyze_record(
                        run,
                        "before",
                        ".github/workflows/web-admin-ci.yml",
                        True,
                        "3" * 64,
                    )

    def test_completed_skipped_step_may_omit_timing(self) -> None:
        run = make_run(1_026, 80)
        step = run["jobs"][0]["steps"][0]
        step.update(
            {
                "status": "completed",
                "conclusion": "skipped",
                "startedAt": None,
                "completedAt": None,
            }
        )
        source = self.write("skipped-step.json", payload([run]))
        receipt = self.invoke(after=source)
        self.assertEqual(receipt["analysis"]["incompleteStepCount"], 0)
        self.assertEqual(receipt["analysis"]["timingUsableRunCount"], 1)

    def test_missing_attempt_job_total_is_not_timing_usable(self) -> None:
        run = make_run(1_050, 80)
        run.pop("jobsTotalCount")
        source = self.write("missing-total.json", payload([run]))
        receipt = self.invoke(after=source)
        analysis = receipt["analysis"]
        self.assertEqual(analysis["timingUsableRunCount"], 0)
        self.assertEqual(analysis["incompleteAttemptJobSetRunCount"], 1)

    def test_expired_attempt_tombstone_is_distinct_from_timing_data(self) -> None:
        run = make_run(1_075, 80)
        run["tombstone"] = True
        run["jobs"] = []
        run["jobsTotalCount"] = 0
        source = self.write("tombstone.json", payload([run]))
        receipt = self.invoke(after=source)
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertTrue(checkpoint["runs"]["1075:1"]["tombstone"])
        self.assertEqual(receipt["analysis"]["timingUsableRunCount"], 0)

    def test_no_comparable_cohort_is_explicit(self) -> None:
        before = self.write("before.json", payload([make_run(1_100, 80)]))
        after = self.write(
            "after.json", payload([make_run(1_200, 80, event="workflow_dispatch")])
        )
        receipt = self.invoke(before, after)
        self.assertIn(
            "no_comparable_workflow_event_runner_cohort",
            receipt["analysis"]["warnings"],
        )

    def test_unresolved_cohort_attempt_blocks_timing_and_failure_signals(self) -> None:
        before = self.write(
            "resolved-before.json",
            payload([make_run(1_210 + index, 100) for index in range(7)]),
        )
        after = self.write(
            "censored-after.json",
            payload(
                [make_run(1_310 + index, 50) for index in range(7)]
                + [
                    make_run(
                        1_317,
                        50,
                        status="in_progress",
                        conclusion="success",
                    )
                ]
            ),
        )
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(cohort["metrics"], {})
        self.assertEqual(cohort["failureSignal"], "insufficient_samples")
        self.assertIn("unresolved_cohort_attempts", cohort["warnings"])

    def test_missing_frozen_baseline_workflow_metadata_blocks_comparison(self) -> None:
        before = self.write(
            "before.json",
            payload([make_run(1_300 + index, 100) for index in range(7)], workflow=None),
        )
        after = self.write(
            "after.json",
            payload(
                [make_run(1_400 + index, 50) for index in range(7)]
                + [make_run(1_407, 50, conclusion="failure")],
                workflow="web-admin-ci.yml",
            ),
        )
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(cohort["metrics"], {})
        self.assertEqual(cohort["failureSignal"], "insufficient_samples")
        self.assertIn("workflow_cohort_metadata_unverified", cohort["warnings"])

    def test_unknown_event_cannot_verify_cohort_or_emit_signals(self) -> None:
        before = self.write(
            "unknown-event-before.json",
            payload(
                [
                    make_run(1_450 + index, 100, event="unknown")
                    for index in range(7)
                ]
            ),
        )
        after = self.write(
            "unknown-event-after.json",
            payload(
                [
                    make_run(1_550 + index, 50, event="unknown")
                    for index in range(7)
                ]
                + [make_run(1_557, 50, conclusion="failure", event="unknown")]
            ),
        )
        receipt = self.invoke(before, after)
        cohort = receipt["analysis"]["cohorts"][0]
        self.assertEqual(cohort["metrics"], {})
        self.assertEqual(cohort["failureSignal"], "insufficient_samples")
        self.assertIn("workflow_cohort_metadata_unverified", cohort["warnings"])
        checkpoint = json.loads(self.checkpoint.read_text(encoding="utf-8"))
        self.assertTrue(
            all(
                not observation["cohortMetadataVerified"]
                for observation in checkpoint["runs"].values()
            )
        )

    def test_damaged_checkpoint_fails_without_overwriting_receipt(self) -> None:
        self.checkpoint.write_text("{broken", encoding="utf-8")
        self.receipt.write_text("unchanged", encoding="utf-8")
        source = self.write("input.json", payload([make_run(1_500, 80)]))
        with self.assertRaises(MONITOR.MonitorError):
            MONITOR.main(
                [
                    "--after-input",
                    str(source),
                    "--checkpoint",
                    str(self.checkpoint),
                    "--receipt",
                    str(self.receipt),
                    "--bootstrap-resamples",
                    "1000",
                ]
            )
        self.assertEqual(self.receipt.read_text(encoding="utf-8"), "unchanged")

    def test_sensitive_diagnostics_are_not_retained(self) -> None:
        source = self.write(
            "input.json",
            payload(
                [
                    make_run(
                        1_600,
                        80,
                        unsafe_step_name=(
                            "Run PRIVATE_DIAGNOSTIC_SENTINEL "
                            "https://example.test/?access_token=hidden"
                        ),
                    )
                ]
            ),
        )
        self.invoke(after=source)
        retained = self.checkpoint.read_text(encoding="utf-8") + self.receipt.read_text(
            encoding="utf-8"
        )
        self.assertNotIn("PRIVATE_DIAGNOSTIC_SENTINEL", retained)
        self.assertNotIn("PRIVATE_URL_SENTINEL", retained)
        self.assertNotIn("hidden", retained)
        self.assertNotIn("API_TOKEN", retained)
        self.assertNotIn("PASSWORD", retained)


if __name__ == "__main__":
    unittest.main()
