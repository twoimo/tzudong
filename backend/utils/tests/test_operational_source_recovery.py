"""Provenance contracts for recovered observability and readiness-agent work."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import unittest
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[3]
PROVENANCE = (
    ROOT
    / ".kiro/specs/crawler-pipeline-operational-readiness/operational-recovery-provenance.v1.json"
)
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _git_blob_sha(data: bytes) -> str:
    result = subprocess.run(
        ["git", "hash-object", "--stdin"],
        cwd=ROOT,
        input=data,
        capture_output=True,
        check=True,
    )
    return result.stdout.decode("ascii").strip()


def _safe_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise AssertionError(value)
    if {"target", "__pycache__", ".next"} & set(path.parts):
        raise AssertionError(value)
    return path


class OperationalRecoveryProvenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.document = json.loads(PROVENANCE.read_text(encoding="utf-8"))

    def test_source_and_corroborating_git_objects_match(self) -> None:
        document = self.document
        self.assertEqual(document["schemaVersion"], 1)
        self.assertEqual(document["kind"], "operational_recovery_provenance")
        self.assertRegex(document["sourceCommit"], HEX40)
        self.assertRegex(document["corroboratingCommit"], HEX40)
        self.assertNotEqual(document["sourceCommit"], document["corroboratingCommit"])
        self.assertEqual(document["sourceFileCount"], 50)
        self.assertEqual(document["sourceFileCount"], len(document["files"]))

        source_pairs = set()
        for entry in document["files"]:
            self.assertEqual(
                set(entry),
                {
                    "sourcePath",
                    "candidatePath",
                    "sourceGitBlobSha1",
                    "sourceSha256",
                    "sourceBytes",
                    "candidateGitBlobSha1",
                    "candidateSha256",
                    "candidateBytes",
                },
            )
            _safe_path(entry["sourcePath"])
            _safe_path(entry["candidatePath"])
            pair = (entry["sourcePath"], entry["candidatePath"])
            self.assertNotIn(pair, source_pairs)
            source_pairs.add(pair)

            source = subprocess.run(
                [
                    "git",
                    "show",
                    f"{document['sourceCommit']}:{entry['sourcePath']}",
                ],
                cwd=ROOT,
                capture_output=True,
                check=True,
            ).stdout
            corroborating = subprocess.run(
                [
                    "git",
                    "show",
                    f"{document['corroboratingCommit']}:{entry['sourcePath']}",
                ],
                cwd=ROOT,
                capture_output=True,
                check=True,
            ).stdout
            self.assertEqual(source, corroborating, entry["sourcePath"])
            self.assertEqual(len(source), entry["sourceBytes"])
            self.assertRegex(entry["sourceGitBlobSha1"], HEX40)
            self.assertRegex(entry["sourceSha256"], HEX64)
            self.assertEqual(_git_blob_sha(source), entry["sourceGitBlobSha1"])
            self.assertEqual(hashlib.sha256(source).hexdigest(), entry["sourceSha256"])

    def test_candidate_hashes_and_declared_transform_set_are_exact(self) -> None:
        document = self.document
        changed = set()
        for entry in document["files"]:
            path = ROOT.joinpath(*_safe_path(entry["candidatePath"]).parts)
            data = path.read_bytes()
            self.assertEqual(len(data), entry["candidateBytes"], entry["candidatePath"])
            self.assertEqual(_git_blob_sha(data), entry["candidateGitBlobSha1"])
            self.assertEqual(
                hashlib.sha256(data).hexdigest(),
                entry["candidateSha256"],
                entry["candidatePath"],
            )
            if (
                entry["sourcePath"] != entry["candidatePath"]
                or entry["sourceGitBlobSha1"] != entry["candidateGitBlobSha1"]
            ):
                changed.add(entry["candidatePath"])

        candidate_only = set()
        self.assertEqual(
            document["candidateOnlyFileCount"], len(document["candidateOnlyFiles"])
        )
        for entry in document["candidateOnlyFiles"]:
            self.assertEqual(set(entry), {"path", "gitBlobSha1", "sha256", "bytes"})
            path = ROOT.joinpath(*_safe_path(entry["path"]).parts)
            data = path.read_bytes()
            self.assertEqual(len(data), entry["bytes"])
            self.assertEqual(_git_blob_sha(data), entry["gitBlobSha1"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
            candidate_only.add(entry["path"])

        transforms = document["candidateTransformations"]
        self.assertEqual(
            [entry["id"] for entry in transforms],
            [
                "current-pipeline-control-layout",
                "loki-runtime-closure",
                "least-authority-external-writes",
                "kubernetes-rfc1123-rendering",
                "bounded-descriptor-cli-test-output",
                "migration-readiness-source-contract",
                "synthetic-secret-fixture-source-safety",
            ],
        )
        declared = {
            path for transform in transforms for path in transform["paths"]
        }
        self.assertEqual(declared, changed | candidate_only)

    def test_only_two_legacy_layout_sources_map_to_current_owned_paths(self) -> None:
        moved = {
            entry["sourcePath"]: entry["candidatePath"]
            for entry in self.document["files"]
            if entry["sourcePath"] != entry["candidatePath"]
        }
        self.assertEqual(
            moved,
            {
                "backend/deploy/pipeline-control/otel-collector.yaml":
                    "backend/pipeline-control/otel-collector.yaml",
                "backend/deploy/pipeline-control/docker-compose.observability.yml":
                    "backend/pipeline-control/docker-compose.observability.yml",
            },
        )
        self.assertFalse((ROOT / "backend/deploy/pipeline-control").exists())


if __name__ == "__main__":
    unittest.main()
