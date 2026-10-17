#!/usr/bin/env python3
"""Reference-rollover contracts: exact cohort, completeness and immutability."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


REFERENCE = module("ci_reference_test", "prepare-ci-reference.py")
FIXTURE = module("ci_reference_fixtures", "test_monitor_ci_performance.py")
WORKFLOW = ".github/workflows/web-admin-ci.yml"


class CiReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.state = self.root / "state"
        self.checkpoint = self.state / "analysis-state.json"
        self.state.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def observation(self, run):
        fingerprint = REFERENCE.MONITOR.sha256_bytes(
            REFERENCE.MONITOR.canonical_json(run)
        )
        return REFERENCE.MONITOR.analyze_record(
            run, "after", WORKFLOW, True, fingerprint
        )

    def write_checkpoint(self, runs):
        observations = {
            f"{run['id']}:{run.get('attempt', 1)}": self.observation(run)
            for run in runs
        }
        REFERENCE.MONITOR.atomic_write_json(self.checkpoint, {
            "schema": f"{REFERENCE.MONITOR.SCHEMA_VERSION}/checkpoint",
            "runs": observations,
        })

    def write_mixed_phase_checkpoint(self, before, after):
        observations = {}
        for phase, runs in (("before", before), ("after", after)):
            for run in runs:
                observation = self.observation(run)
                observation["phase"] = phase
                observations[f"{run['id']}:{run.get('attempt', 1)}"] = observation
        REFERENCE.MONITOR.atomic_write_json(self.checkpoint, {
            "schema": f"{REFERENCE.MONITOR.SCHEMA_VERSION}/checkpoint",
            "runs": observations,
        })

    def write_tick(
        self,
        tick_id,
        runs,
        *,
        complete=True,
        alerts=None,
        captured_at="2026-10-11T08:00:00Z",
    ):
        directory = self.state / "ticks" / tick_id
        export = {
            "workflow": WORKFLOW,
            "capturedAtUtc": captured_at,
            "runs": runs,
            "coverage": {
                "incrementalWindowComplete": complete,
                "alerts": list(alerts or []),
            },
        }
        export_path = directory / "export.json"
        REFERENCE.MONITOR.atomic_write_json(export_path, export)
        REFERENCE.MONITOR.atomic_write_json(directory / "tick.json", {
            "schema": "tzudong-ci-monitor-tick/v1",
            "exportSha256": REFERENCE.MONITOR.sha256_file(export_path),
            "checkpointSha256": REFERENCE.MONITOR.sha256_file(self.checkpoint),
        })
        return export_path

    def successes(self, start=100, count=7, **changes):
        records = [FIXTURE.make_run(start + index, 50) for index in range(count)]
        for record in records:
            record.update(changes)
        return records

    def test_insufficient_reference_becomes_ready_at_seven_distinct_trees(self):
        first = self.successes(count=6)
        self.write_checkpoint(first)
        self.write_tick("001", first)
        collecting = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(collecting["status"], "collecting_reference")
        self.assertEqual(collecting["successCount"], 6)
        self.assertFalse((self.state / "reference-candidates").exists())

        seventh = self.successes(start=106, count=1)
        all_runs = first + seventh
        self.write_checkpoint(all_runs)
        # The latest export alone is insufficient; first candidate creation
        # binds source fingerprints across retained authenticated exports.
        self.write_tick("002", seventh)
        ready = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        self.assertEqual(ready["status"], "reference_candidate_ready")
        self.assertEqual(ready["successCount"], 7)
        self.assertEqual(ready["distinctSourceTreeCount"], 7)
        self.assertTrue(ready["candidateBaselinePath"].startswith("state://"))
        candidate = self.state / ready["candidateBaselinePath"].removeprefix("state://")
        self.assertEqual(REFERENCE.MONITOR.sha256_file(candidate), ready["candidateBaselineSha256"])
        candidate_payload = REFERENCE.MONITOR.load_json(candidate)
        self.assertFalse(candidate_payload["reference"]["candidateIsImprovementClaim"])
        self.assertEqual(candidate_payload["capturedAtUtc"], "2026-10-11T08:00:00Z")

    def test_different_cohorts_never_combine_to_reach_minimum(self):
        older = self.successes(start=200, count=6)
        newest = self.successes(start=300, count=1, workflowRevision="c" * 64)
        runs = older + newest
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        result = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(result["status"], "collecting_reference")
        self.assertEqual(result["successCount"], 1)
        self.assertEqual(result["distinctSourceTreeCount"], 1)

    def test_frozen_before_phase_never_bootstraps_next_reference(self):
        before = self.successes(start=350, count=7)
        after = self.successes(start=360, count=1)
        self.write_mixed_phase_checkpoint(before, after)
        self.write_tick("001", after)
        result = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(result["status"], "collecting_reference")
        self.assertEqual(result["successCount"], 1)

    def test_pending_attempt_or_incomplete_collection_freezes_candidate(self):
        successes = self.successes(start=400)
        pending = FIXTURE.make_run(
            499, 50, status="in_progress", conclusion="success", incomplete_step=True
        )
        runs = successes + [pending]
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        pending_result = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(pending_result["status"], "collecting_reference")
        self.assertEqual(pending_result["pendingSameCohortCount"], 0)
        self.assertEqual(pending_result["potentialSameCohortPendingCount"], 1)
        self.assertEqual(
            pending_result["pendingReasonCounts"],
            {"potential_same_cohort_execution_mode_unverified": 1},
        )

        self.write_checkpoint(successes)
        self.write_tick("002", successes, complete=False, alerts=["RECENT_WINDOW_TRUNCATED"])
        incomplete = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        self.assertEqual(incomplete["status"], "collecting_reference")
        self.assertFalse(incomplete["collectionComplete"])
        self.assertEqual(incomplete["blockingCoverageAlerts"], ["RECENT_WINDOW_TRUNCATED"])

    def test_target_selector_skips_highest_tombstone_without_hiding_pending(self):
        completed = self.observation(FIXTURE.make_run(480, 50))
        pending_run = FIXTURE.make_run(
            490, 50, status="in_progress", conclusion="success", incomplete_step=True
        )
        pending = self.observation(pending_run)
        tombstone = dict(self.observation(FIXTURE.make_run(999, 50)))
        tombstone.update(status="missing", conclusion="stale", tombstone=True)

        selected = REFERENCE.select_current_observation(
            [completed, pending, tombstone]
        )
        self.assertEqual((selected["runId"], selected["attempt"]), (480, 1))
        self.assertFalse(pending["cohortMetadataVerified"])
        self.assertFalse(REFERENCE.attempt_resolved(pending))
        self.assertTrue(REFERENCE.attempt_resolved(tombstone))

    def test_chronology_invalid_success_blocks_candidate_until_corrected(self):
        successes = self.successes(start=400)
        defective = FIXTURE.make_run(499, 50, attempt=2)
        defective["jobs"][0]["createdAt"] = FIXTURE.timestamp(
            REFERENCE.MONITOR.parse_timestamp(
                defective["jobs"][0]["startedAt"]
            ) + timedelta(seconds=1)
        )
        runs = successes + [defective]
        self.write_checkpoint(runs)
        self.write_tick("001", runs)

        result = REFERENCE.evaluate_reference(
            self.state, self.checkpoint, "001"
        )
        self.assertEqual(result["status"], "collecting_reference")
        self.assertEqual(result["successCount"], 7)
        self.assertEqual(result["distinctSourceTreeCount"], 7)
        self.assertEqual(result["candidateAttemptCount"], 7)
        self.assertEqual(result["blockingPendingCount"], 1)
        self.assertEqual(
            result["pendingReasonCounts"], {"chronology_invalid_attempt": 1}
        )
        self.assertEqual(result["timingExcludedTerminalCount"], 1)
        self.assertEqual(
            result["timingExclusionReasonCounts"],
            {"invalid_timing_order": 1},
        )
        self.assertEqual(result["chronologyInvalidAttemptCount"], 1)
        self.assertEqual(
            result["chronologyIssueCodeCounts"],
            {"JOB_START_PRECEDES_JOB_CREATION": 1},
        )
        self.assertEqual(len(result["pendingAssessments"]), 1)
        self.assertFalse((self.state / "reference-candidates").exists())

    def test_later_refreshable_chronology_defect_blocks_frozen_candidate(self):
        successes = self.successes(start=420)
        self.write_checkpoint(successes)
        self.write_tick("001", successes)
        ready = REFERENCE.evaluate_reference(
            self.state, self.checkpoint, "001"
        )
        self.assertEqual(ready["status"], "reference_candidate_ready")

        defective = FIXTURE.make_run(499, 50, attempt=2)
        defective["jobs"][0]["createdAt"] = FIXTURE.timestamp(
            REFERENCE.MONITOR.parse_timestamp(
                defective["jobs"][0]["startedAt"]
            ) + timedelta(seconds=1)
        )
        runs = successes + [defective]
        self.write_checkpoint(runs)
        self.write_tick("002", runs)
        blocked = REFERENCE.evaluate_reference(
            self.state, self.checkpoint, "002"
        )

        self.assertEqual(blocked["status"], "collecting_reference")
        self.assertEqual(blocked["blockingPendingCount"], 1)
        self.assertEqual(blocked["timingExcludedTerminalCount"], 1)
        self.assertEqual(
            blocked["candidateBaselineSha256"],
            ready["candidateBaselineSha256"],
        )
        self.assertNotIn("notificationKey", blocked)

    def test_unverified_shape_or_revision_pending_blocks_reference(self):
        successes = self.successes(start=800)
        pending = FIXTURE.make_run(
            807, 50, status="in_progress", conclusion="success", incomplete_step=True
        )
        pending["executionMode"] = "unknown"
        pending["jobTopology"] = None
        runs = successes + [pending]
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        shape = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(shape["status"], "collecting_reference")
        self.assertEqual(shape["potentialSameCohortPendingCount"], 1)
        self.assertEqual(shape["blockingPendingCount"], 1)
        self.assertEqual(shape["pendingReasonCounts"], {
            "potential_same_cohort_execution_mode_unverified": 1,
        })
        assessment = shape["pendingAssessments"][0]
        self.assertEqual(assessment["runId"], 807)
        self.assertEqual(assessment["attempt"], 1)
        self.assertEqual(
            assessment["sourceFingerprint"], self.observation(pending)["sourceFingerprint"]
        )

        pending["executionMode"] = "full_benchmark"
        pending["jobTopology"] = "b" * 64
        pending["workflowRevision"] = None
        self.write_checkpoint(successes + [pending])
        self.write_tick("002", successes + [pending])
        revision = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        self.assertEqual(revision["status"], "collecting_reference")
        self.assertEqual(revision["pendingReasonCounts"], {
            "potential_same_cohort_revision_unverified": 1,
        })

    def test_verified_different_cohort_pending_is_distinct_but_still_blocks_cutoff(self):
        successes = self.successes(start=900)
        pending = FIXTURE.make_run(
            899, 50, status="in_progress", conclusion="success"
        )
        for job in pending["jobs"]:
            job["steps"][0]["name"] = "Run npm run typecheck:parity"
        pending["executionMode"] = "diagnostic"
        runs = [pending] + successes
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        result = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(result["status"], "collecting_reference")
        self.assertEqual(result["potentialSameCohortPendingCount"], 0)
        self.assertEqual(result["verifiedDifferentPendingCount"], 1)
        self.assertEqual(result["blockingPendingCount"], 1)
        self.assertEqual(result["pendingReasonCounts"], {
            "verified_different_execution_mode": 1,
        })
        self.assertFalse(
            result["transitionPolicy"]["continuedSourceWindowMonitoringGuaranteedByHelper"]
        )
        self.assertTrue(
            result["transitionPolicy"]["preserveSourceWindowForUnresolvedAttempts"]
        )

    def test_unverified_pending_can_complete_into_target_cohort_then_be_reassessed(self):
        successes = self.successes(start=1000)
        pending = FIXTURE.make_run(
            1007, 50, status="in_progress", conclusion="success", incomplete_step=True
        )
        pending["executionMode"] = "unknown"
        pending["jobTopology"] = None
        self.write_checkpoint(successes + [pending])
        self.write_tick("001", successes + [pending])
        collecting = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(collecting["status"], "collecting_reference")

        completed = FIXTURE.make_run(1007, 50)
        self.write_checkpoint(successes + [completed])
        self.write_tick("002", successes + [completed])
        ready = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        self.assertEqual(ready["status"], "reference_candidate_ready")
        self.assertEqual(ready["successCount"], 8)
        self.assertEqual(ready["blockingPendingCount"], 0)

    def test_unverified_pending_tombstone_resolves_without_phase_move(self):
        successes = self.successes(start=1100)
        pending = FIXTURE.make_run(
            1107, 50, status="in_progress", conclusion="success", incomplete_step=True
        )
        pending["executionMode"] = "unknown"
        pending["jobTopology"] = None
        self.write_checkpoint(successes + [pending])
        self.write_tick("001", successes + [pending])
        self.assertEqual(
            REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")["status"],
            "collecting_reference",
        )

        tombstone = dict(
            pending,
            status="missing",
            conclusion="stale",
            tombstone=True,
            jobs=[],
            jobsTotalCount=0,
            jobsAttempt=1,
        )
        self.write_checkpoint(successes + [tombstone])
        self.write_tick("002", successes + [tombstone])
        ready = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        self.assertEqual(ready["status"], "reference_candidate_ready")
        self.assertEqual(ready["blockingPendingCount"], 0)
        self.assertFalse(ready["transitionPolicy"]["automaticPhaseMoveAllowed"])

    def test_refreshable_success_blocks_freeze_until_snapshot_is_immutable(self):
        successes = self.successes(start=1200)
        refreshable = FIXTURE.make_run(1207, 50)
        refreshable["jobs"][0]["createdAt"] = FIXTURE.timestamp(
            REFERENCE.MONITOR.parse_timestamp(
                refreshable["jobs"][0]["startedAt"]
            ) + timedelta(seconds=1)
        )
        self.write_checkpoint(successes + [refreshable])
        self.write_tick("001", successes + [refreshable])

        collecting = REFERENCE.evaluate_reference(
            self.state, self.checkpoint, "001"
        )
        self.assertEqual(collecting["status"], "collecting_reference")
        self.assertEqual(collecting["blockingPendingCount"], 1)
        self.assertEqual(
            collecting["transitionPolicy"]["unresolvedAttemptCount"], 1
        )

        corrected = FIXTURE.make_run(1207, 50)
        self.write_checkpoint(successes + [corrected])
        self.write_tick("002", successes + [corrected])
        ready = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        self.assertEqual(ready["status"], "reference_candidate_ready")
        self.assertEqual(ready["successCount"], 8)
        self.assertEqual(ready["blockingPendingCount"], 0)

    def test_collecting_reference_reads_latest_tick_only(self):
        old = self.successes(start=450, count=1)
        self.write_checkpoint(old)
        old_export = self.write_tick("001", old)
        latest = self.successes(start=451, count=1)
        self.write_checkpoint(latest)
        self.write_tick("002", latest)
        old_export.write_text("tampered historical export", encoding="utf-8")

        result = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        self.assertEqual(result["status"], "collecting_reference")
        self.assertEqual(result["successCount"], 1)

    def test_explicit_historical_tick_must_match_supplied_checkpoint(self):
        old = self.successes(start=452, count=1)
        self.write_checkpoint(old)
        self.write_tick("001", old)
        latest = self.successes(start=453, count=1)
        self.write_checkpoint(latest)
        self.write_tick("002", latest)

        with self.assertRaisesRegex(
            REFERENCE.ReferenceError, "REFERENCE_CHECKPOINT_MISMATCH"
        ):
            REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")

    def test_duplicate_attempts_collapse_and_failures_are_preserved(self):
        successes = self.successes(start=500)
        failure = FIXTURE.make_run(590, 20, conclusion="failure")
        cancelled = FIXTURE.make_run(591, 20, conclusion="cancelled")
        runs = successes + [failure, cancelled]
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        self.write_tick("002", list(reversed(runs)))
        result = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")
        candidate_path = self.state / result["candidateBaselinePath"].removeprefix("state://")
        candidate = REFERENCE.MONITOR.load_json(candidate_path)
        keys = [(run["id"], run["attempt"]) for run in candidate["runs"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(keys), 9)
        self.assertEqual(result["terminalFailureCounts"], {"cancelled": 1, "failure": 1})
        self.assertEqual(candidate["reference"]["terminalFailureCounts"], {"cancelled": 1, "failure": 1})

        original = candidate_path.read_bytes()
        # Once the candidate is frozen, its O(1) cohort manifest is sufficient;
        # an unrelated historical export is no longer reopened.
        (self.state / "ticks" / "001" / "export.json").write_text(
            "tampered after reference freeze", encoding="utf-8"
        )
        expanded = runs + [FIXTURE.make_run(592, 20, conclusion="failure")]
        self.write_checkpoint(expanded)
        self.write_tick("003", expanded)
        repeated = REFERENCE.evaluate_reference(self.state, self.checkpoint, "003")
        self.assertEqual(repeated["candidateBaselineSha256"], result["candidateBaselineSha256"])
        self.assertEqual(candidate_path.read_bytes(), original)

    def test_tampered_export_is_rejected(self):
        runs = self.successes(start=600)
        self.write_checkpoint(runs)
        export_path = self.write_tick("001", runs)
        export_path.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(REFERENCE.ReferenceError, "HASH_MISMATCH"):
            REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")

    def test_authenticated_export_parses_the_verified_byte_snapshot_once(self):
        runs = self.successes(start=625, count=1)
        self.write_checkpoint(runs)
        export_path = self.write_tick("001", runs)
        directory = export_path.parent
        original_read_bytes = Path.read_bytes
        export_reads = 0

        def mutate_after_read(path):
            nonlocal export_reads
            payload = original_read_bytes(path)
            if path == export_path:
                export_reads += 1
                if export_reads == 1:
                    path.write_text('{"tampered":true}', encoding="utf-8")
            return payload

        with patch.object(Path, "read_bytes", new=mutate_after_read):
            export, authenticated_runs, workflow = REFERENCE.authenticated_export(directory)

        self.assertEqual(export_reads, 1)
        self.assertEqual(export["runs"][0]["id"], 625)
        self.assertEqual(authenticated_runs[0]["id"], 625)
        self.assertEqual(workflow, WORKFLOW)
        self.assertEqual(export_path.read_text(encoding="utf-8"), '{"tampered":true}')

    def test_frozen_candidate_is_authenticated_and_parsed_from_one_read(self):
        runs = self.successes(start=635)
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        ready = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        candidate_path = REFERENCE.resolve_state_ref(
            self.state, ready["candidateBaselinePath"]
        )
        candidate_reads = 0
        original_read_bytes = Path.read_bytes

        def mutate_after_read(path):
            nonlocal candidate_reads
            payload = original_read_bytes(path)
            if path == candidate_path:
                candidate_reads += 1
                if candidate_reads == 1:
                    path.write_text('{"tampered":true}', encoding="utf-8")
            return payload

        self.write_tick("002", runs)
        with patch.object(Path, "read_bytes", new=mutate_after_read):
            repeated = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")

        self.assertEqual(candidate_reads, 1)
        self.assertEqual(
            repeated["candidateBaselineSha256"], ready["candidateBaselineSha256"]
        )
        self.assertEqual(repeated["status"], "reference_candidate_ready")
        self.assertEqual(candidate_path.read_text(encoding="utf-8"), '{"tampered":true}')

    def test_crash_window_adopts_byte_exact_orphan_with_original_capture(self):
        runs = self.successes(start=640)
        self.write_checkpoint(runs)
        self.write_tick("001", runs, captured_at="2026-10-11T08:00:00Z")
        original_create = REFERENCE.atomic_create_json
        create_count = 0

        def stop_before_manifest(path, value):
            nonlocal create_count
            create_count += 1
            if create_count == 2:
                raise RuntimeError("simulated receipt publication crash")
            return original_create(path, value)

        with patch.object(REFERENCE, "atomic_create_json", new=stop_before_manifest):
            with self.assertRaisesRegex(RuntimeError, "publication crash"):
                REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")

        candidates = list((self.state / "reference-candidates").glob("*.json"))
        orphan = next(path for path in candidates if not path.name.endswith(".receipt.json"))
        receipt = orphan.with_name(f"{orphan.stem}.receipt.json")
        original = orphan.read_bytes()
        original_sha = REFERENCE.MONITOR.sha256_bytes(original)
        self.assertFalse(receipt.exists())

        self.write_tick("002", runs, captured_at="2026-10-11T09:00:00Z")
        recovered = REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")

        self.assertEqual(orphan.read_bytes(), original)
        self.assertEqual(recovered["candidateBaselineSha256"], original_sha)
        self.assertEqual(
            REFERENCE.MONITOR.load_json(orphan)["capturedAtUtc"],
            "2026-10-11T08:00:00Z",
        )
        self.assertTrue(receipt.is_file())

    def test_tampered_crash_window_orphan_is_preserved_and_rejected(self):
        runs = self.successes(start=642)
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        original_create = REFERENCE.atomic_create_json
        create_count = 0

        def stop_before_manifest(path, value):
            nonlocal create_count
            create_count += 1
            if create_count == 2:
                raise RuntimeError("simulated receipt publication crash")
            return original_create(path, value)

        with patch.object(REFERENCE, "atomic_create_json", new=stop_before_manifest):
            with self.assertRaises(RuntimeError):
                REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")

        candidates = list((self.state / "reference-candidates").glob("*.json"))
        orphan = next(path for path in candidates if not path.name.endswith(".receipt.json"))
        tampered = REFERENCE.MONITOR.load_json(orphan)
        tampered["reference"]["successCount"] = 999
        REFERENCE.MONITOR.atomic_write_json(orphan, tampered)
        tampered_bytes = orphan.read_bytes()

        self.write_tick("002", runs, captured_at="2026-10-11T09:00:00Z")
        with self.assertRaisesRegex(
            REFERENCE.ReferenceError, "ORPHAN_REFERENCE_CANDIDATE_MISMATCH"
        ):
            REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")

        self.assertEqual(orphan.read_bytes(), tampered_bytes)
        self.assertFalse(orphan.with_name(f"{orphan.stem}.receipt.json").exists())

    def test_tampered_frozen_candidate_is_rejected_before_parsing(self):
        runs = self.successes(start=645)
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        ready = REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        candidate_path = REFERENCE.resolve_state_ref(
            self.state, ready["candidateBaselinePath"]
        )
        candidate_path.write_text('{"schema":"attacker-controlled"}', encoding="utf-8")
        self.write_tick("002", runs)

        with self.assertRaisesRegex(
            REFERENCE.ReferenceError, "REFERENCE_CANDIDATE_HASH_MISMATCH"
        ):
            REFERENCE.evaluate_reference(self.state, self.checkpoint, "002")

    def test_explicit_tick_id_must_be_safe_and_exist(self):
        runs = self.successes(start=650, count=1)
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        for tick_id, code in (
            ("../001", "INVALID_TICK_ID"),
            ("missing", "TICK_NOT_FOUND"),
        ):
            with self.assertRaisesRegex(REFERENCE.ReferenceError, code):
                REFERENCE.evaluate_reference(self.state, self.checkpoint, tick_id)

    def test_implicit_latest_tick_rejects_symlink_outside_state_root(self):
        runs = self.successes(start=675, count=1)
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        external = self.root / "external-tick"
        external.mkdir()
        (external / "tick.json").write_text("{}", encoding="utf-8")
        (self.state / "ticks" / "zzz").symlink_to(external, target_is_directory=True)

        with self.assertRaisesRegex(
            REFERENCE.ReferenceError, "INVALID_RETAINED_TICK_PATH"
        ):
            REFERENCE.select_tick_directory(self.state, None)

    def test_existing_candidate_is_never_overwritten(self):
        runs = self.successes(start=700)
        self.write_checkpoint(runs)
        self.write_tick("001", runs)
        cohort_key = REFERENCE.select_current_cohort(
            list(REFERENCE.load_checkpoint(self.checkpoint)["runs"].values())
        )
        cohort_id = REFERENCE.MONITOR.sha256_bytes(cohort_key.encode("utf-8"))[:16]
        candidate_path = self.state / "reference-candidates" / f"{cohort_id}.json"
        candidate_path.parent.mkdir()
        candidate_path.write_text("preserve me", encoding="utf-8")
        with self.assertRaisesRegex(REFERENCE.ReferenceError, "ALREADY_EXISTS"):
            REFERENCE.evaluate_reference(self.state, self.checkpoint, "001")
        self.assertEqual(candidate_path.read_text(encoding="utf-8"), "preserve me")


if __name__ == "__main__":
    unittest.main()
