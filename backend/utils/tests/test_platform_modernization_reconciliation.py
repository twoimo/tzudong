"""Exhaustive inventory contract for the parked platform-modernization commit."""

from __future__ import annotations

import json
import hashlib
import subprocess
import unittest
from collections import Counter
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[3]
MANIFEST = (
    ROOT
    / ".kiro/specs/crawler-pipeline-operational-readiness/"
    "platform-modernization-reconciliation.v1.json"
)
ALLOWED_DISPOSITIONS = {
    "candidate_transformed_present",
    "current_layout_adaptation_reviewed",
    "current_layout_retained",
    "deferred_empty_scaffold",
    "deferred_layout_migration",
    "queued_phase_gate_recovery",
    "queued_publication_recovery",
    "queued_supply_chain_recovery",
    "source_exact_present",
    "superseded_spec_source",
}
ALLOWED_CONTENT_STATES = {
    "base_exact",
    "candidate_absent",
    "candidate_transformed",
    "source_and_base_exact",
    "source_exact",
}


def _safe_path(value: str) -> Path:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise AssertionError(value)
    return ROOT.joinpath(*path.parts)


def _source_delta(base: str, source: str) -> list[tuple[str, str, str]]:
    result = subprocess.run(
        ["git", "diff", "--name-status", "--find-renames", base, source],
        cwd=ROOT,
        capture_output=True,
        check=True,
        text=True,
    )
    rows = []
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        status = fields[0]
        source_path = fields[1]
        candidate_path = fields[2] if status.startswith("R") else fields[1]
        rows.append((status, source_path, candidate_path))
    return rows


class PlatformModernizationReconciliationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.document = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_all_207_source_delta_entries_are_accounted_for_exactly_once(self) -> None:
        document = self.document
        self.assertEqual(document["schemaVersion"], 3)
        self.assertEqual(document["kind"], "platform_modernization_reconciliation")
        expected = _source_delta(document["baseCommit"], document["sourceCommit"])
        actual = [
            (entry["sourceStatus"], entry["basePath"], entry["sourcePath"])
            for entry in document["entries"]
        ]
        self.assertEqual(document["sourceDeltaEntryCount"], 207)
        self.assertEqual(len(expected), 207)
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), len(set(actual)))

    def test_dispositions_and_candidate_presence_are_current(self) -> None:
        document = self.document
        counts = Counter()
        states = Counter()
        for entry in document["entries"]:
            self.assertEqual(
                set(entry),
                {
                    "sourceStatus",
                    "basePath",
                    "sourcePath",
                    "candidateDeclaredPath",
                    "candidateInspectionPath",
                    "candidatePresentAtInspectionPath",
                    "baseGitBlobSha1",
                    "sourceGitBlobSha1",
                    "candidateGitBlobSha1",
                    "contentState",
                    "disposition",
                    "rationale",
                },
            )
            self.assertIn(entry["disposition"], ALLOWED_DISPOSITIONS)
            self.assertIn(entry["contentState"], ALLOWED_CONTENT_STATES)
            self.assertEqual(
                entry["candidatePresentAtInspectionPath"],
                _safe_path(entry["candidateInspectionPath"]).exists(),
                entry["candidateInspectionPath"],
            )
            self.assertGreater(len(entry["rationale"]), 20)
            self.assertLessEqual(len(entry["rationale"]), 180)
            counts[entry["disposition"]] += 1
            states[entry["contentState"]] += 1

        self.assertEqual(dict(sorted(counts.items())), document["dispositionCounts"])
        self.assertEqual(dict(sorted(states.items())), document["contentStateCounts"])
        self.assertEqual(counts["source_exact_present"], 79)
        self.assertEqual(counts["candidate_transformed_present"], 96)
        for path in (
            "backend/bin/schema_mirror_report.py",
            "backend/bin/tests/test_schema_mirror_pbt.py",
            "backend/pipeline_control/log_retention.py",
            "backend/pipeline_control/test_log_retention_unittest.py",
        ):
            entry = next(row for row in document["entries"] if row["sourcePath"] == path)
            self.assertEqual(entry["disposition"], "candidate_transformed_present")
        descriptor = next(entry for entry in document["entries"]
                          if entry["sourcePath"] == "backend/bin/check_deployment_descriptor_set.py")
        self.assertEqual(descriptor["disposition"], "candidate_transformed_present")
        self.assertEqual(counts["current_layout_adaptation_reviewed"], 8)
        self.assertEqual(counts["current_layout_retained"], 16)
        self.assertEqual(
            sum(
                count
                for disposition, count in counts.items()
                if disposition
                not in {
                    "source_exact_present",
                    "candidate_transformed_present",
                    "current_layout_adaptation_reviewed",
                    "current_layout_retained",
                }
            ),
            8,
        )

    def test_seven_layout_contracts_are_present_and_only_old_nested_tree_is_deferred(self) -> None:
        adapted = {
            "backend/bin/check_layout_manifest.py",
            "backend/bin/check_rename_ledger.py",
            "backend/bin/tests/test_check_layout_manifest_unittest.py",
            "backend/bin/tests/test_check_rename_ledger_unittest.py",
            "backend/bin/tests/test_layout_move_pbt.py",
            "backend/bin/tests/test_rename_scope_pbt.py",
            "backend/layout-manifest.v1.json",
        }
        entries = {entry["sourcePath"]: entry for entry in self.document["entries"]}
        self.assertTrue(all(entries[path]["candidatePresentAtInspectionPath"] for path in adapted))
        deferred = {
            entry["sourcePath"]
            for entry in self.document["entries"]
            if entry["disposition"] == "deferred_layout_migration"
        }
        self.assertEqual(deferred, {"backend/deploy/pipeline-control/otel-collector.yaml"})

    def test_layout_deferment_never_creates_a_second_control_plane_tree(self) -> None:
        self.assertFalse((ROOT / "backend/deploy/pipeline-control").exists())
        retained = [
            entry
            for entry in self.document["entries"]
            if entry["disposition"] == "current_layout_retained"
        ]
        self.assertEqual(len(retained), 16)
        self.assertTrue(
            all(
                entry["basePath"].startswith("backend/pipeline-control/")
                for entry in retained
            )
        )

    def test_reviewed_layout_adaptations_are_named_not_hidden_by_path_presence(self) -> None:
        paths = {
            entry["sourcePath"]
            for entry in self.document["entries"]
            if entry["disposition"] == "current_layout_adaptation_reviewed"
        }
        self.assertEqual(
            paths,
            {
                "backend/DATA_CONTRACTS.md",
                "backend/pipeline_control/dsn_guard.py",
                "backend/pipeline_control/metrics.py",
                "backend/pipeline_control/tests/test_container_runtime.py",
                "backend/pipeline_control/tests/test_events.py",
                "backend/pipeline_control/tests/test_events_observability.py",
                "backend/pipeline_control/tests/test_metrics.py",
                "backend/utils/tests/test_tracked_document_integrity.py",
            },
        )

    def test_manifest_is_reproducible_from_current_candidate_blobs(self) -> None:
        result = subprocess.run(
            [
                "python3",
                "backend/bin/build_platform_modernization_reconciliation.py",
                "--check",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            result.stdout.strip(), "platform_modernization_reconciliation_current"
        )

    def test_manifest_binds_candidate_content_without_a_commit_self_reference(self) -> None:
        self.assertNotIn("candidateHead", self.document)
        entries = self.document["entries"]
        encoded = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(self.document["candidateContentSha256"], hashlib.sha256(encoded).hexdigest())


if __name__ == "__main__":
    unittest.main()
