"""Provenance and fail-closed contracts for the recovered Rust workspace."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tomllib
import unittest
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[3]
PROVENANCE = (
    ROOT
    / ".kiro/specs/crawler-pipeline-operational-readiness/rust-source-provenance.v1.json"
)
CANDIDATE_PROVENANCE = (
    ROOT
    / ".kiro/specs/crawler-pipeline-operational-readiness/rust-candidate-provenance.v1.json"
)
RUST_ROOT = ROOT / "backend/rust"
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


class RustSourceRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.provenance = json.loads(PROVENANCE.read_text(encoding="utf-8"))
        cls.candidate_provenance = json.loads(
            CANDIDATE_PROVENANCE.read_text(encoding="utf-8")
        )

    def test_source_provenance_is_closed_and_matches_the_authoritative_commit(self) -> None:
        document = self.provenance
        self.assertEqual(document["schemaVersion"], 1)
        self.assertRegex(document["sourceCommit"], HEX40)
        self.assertRegex(document["corroboratingCommit"], HEX40)
        self.assertRegex(document["treeListingSha1"], HEX40)
        self.assertNotEqual(document["sourceCommit"], document["corroboratingCommit"])
        self.assertEqual(document["fileCount"], 36)
        self.assertEqual(document["fileCount"], len(document["files"]))
        entries = document["files"]
        paths = [entry["path"] for entry in entries]
        self.assertEqual(len(paths), len(set(paths)))
        for entry in entries:
            self.assertEqual(
                set(entry), {"path", "gitBlobSha1", "sha256", "bytes"}
            )
            relative = PurePosixPath(entry["path"])
            self.assertFalse(relative.is_absolute())
            self.assertNotIn("..", relative.parts)
            self.assertNotIn("target", relative.parts)
            result = subprocess.run(
                ["git", "show", f"{document['sourceCommit']}:{entry['path']}"],
                cwd=ROOT,
                capture_output=True,
                check=True,
            )
            data = result.stdout
            self.assertEqual(len(data), entry["bytes"], entry["path"])
            self.assertRegex(entry["gitBlobSha1"], HEX40)
            self.assertRegex(entry["sha256"], HEX64)
            self.assertEqual(_git_blob_sha(data), entry["gitBlobSha1"], entry["path"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"], entry["path"])

    def test_candidate_provenance_matches_every_current_rust_byte(self) -> None:
        source = self.provenance
        candidate = self.candidate_provenance
        self.assertEqual(candidate["schemaVersion"], 1)
        self.assertEqual(candidate["sourceProvenance"], PROVENANCE.relative_to(ROOT).as_posix())
        self.assertEqual(
            candidate["sourceProvenanceSha256"],
            hashlib.sha256(PROVENANCE.read_bytes()).hexdigest(),
        )
        self.assertEqual(candidate["sourceCommit"], source["sourceCommit"])
        self.assertEqual(candidate["fileCount"], 36)
        self.assertEqual(candidate["fileCount"], len(candidate["files"]))
        source_by_path = {entry["path"]: entry for entry in source["files"]}
        candidate_by_path = {entry["path"]: entry for entry in candidate["files"]}
        self.assertEqual(set(candidate_by_path), set(source_by_path))

        changed_paths: set[str] = set()
        for path_text, entry in candidate_by_path.items():
            self.assertEqual(set(entry), {"path", "gitBlobSha1", "sha256", "bytes"})
            relative = PurePosixPath(path_text)
            self.assertFalse(relative.is_absolute())
            self.assertNotIn("..", relative.parts)
            self.assertNotIn("target", relative.parts)
            data = ROOT.joinpath(*relative.parts).read_bytes()
            self.assertEqual(len(data), entry["bytes"], path_text)
            self.assertEqual(_git_blob_sha(data), entry["gitBlobSha1"], path_text)
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"], path_text)
            if entry["gitBlobSha1"] != source_by_path[path_text]["gitBlobSha1"]:
                changed_paths.add(path_text)

        transformations = candidate["candidateTransformations"]
        self.assertEqual(
            [item["id"] for item in transformations],
            ["rustfmt-1.97.0", "root-mit-license-alignment", "python-whitespace-parity", "python-date-hash-parity"],
        )
        declared_paths = {
            path
            for transformation in transformations
            for path in transformation["paths"]
        }
        self.assertEqual(declared_paths, changed_paths)
        rustfmt = transformations[0]
        self.assertEqual(
            (rustfmt["kind"], rustfmt["tool"], rustfmt["version"]),
            ("format", "rustfmt", "1.97.0"),
        )
        self.assertTrue(rustfmt["paths"])
        self.assertTrue(all(path.endswith(".rs") for path in rustfmt["paths"]))
        self.assertEqual(transformations[1]["paths"], ["backend/rust/Cargo.toml"])

    def test_target_build_products_are_neither_source_nor_tracked(self) -> None:
        listed = subprocess.run(
            ["git", "ls-files", "backend/rust/target"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        self.assertEqual(listed, "")
        recorded = json.dumps(
            [self.provenance, self.candidate_provenance], sort_keys=True
        )
        for forbidden in ("/target/", ".dylib", ".pyc", "__pycache__"):
            self.assertNotIn(forbidden, recorded)

    def test_workspace_and_toolchain_pins_match_the_recovered_lock(self) -> None:
        workspace = tomllib.loads((RUST_ROOT / "Cargo.toml").read_text(encoding="utf-8"))
        toolchain = tomllib.loads((RUST_ROOT / "rust-toolchain.toml").read_text(encoding="utf-8"))
        lock = tomllib.loads((RUST_ROOT / "Cargo.lock").read_text(encoding="utf-8"))
        expected_members = [
            "tzudong-validators",
            "tzudong-normalize",
            "tzudong-upsert-payload",
            "tzudong-media-compute",
            "tzudong-pipeline-graph",
        ]
        self.assertEqual(workspace["workspace"]["members"], expected_members)
        self.assertEqual(workspace["workspace"]["package"]["rust-version"], "1.97.0")
        self.assertEqual(workspace["workspace"]["package"]["license"], "MIT")
        self.assertTrue((ROOT / "LICENSE").read_text(encoding="utf-8").startswith("MIT License"))
        self.assertEqual(toolchain["toolchain"]["channel"], "1.97.0")
        self.assertEqual(workspace["workspace"]["dependencies"]["pyo3"]["version"], "=0.29.2")
        self.assertEqual(workspace["workspace"]["dependencies"]["proptest"], "=1.11.0")
        packages = {package["name"]: package for package in lock["package"]}
        self.assertEqual(packages["pyo3"]["version"], "0.29.2")
        self.assertEqual(packages["proptest"]["version"], "1.11.0")
        for package in lock["package"]:
            if package.get("source", "").startswith("registry+"):
                self.assertRegex(package.get("checksum", ""), HEX64, package["name"])

    def test_migration_ledger_stays_python_default_and_n3_closed(self) -> None:
        ledger = json.loads((RUST_ROOT / "migration-ledger.v1.json").read_text(encoding="utf-8"))
        self.assertEqual(ledger["schemaVersion"], 1)
        self.assertEqual(len(ledger["slices"]), 5)
        replaced: list[str] = []
        for item in ledger["slices"]:
            self.assertEqual(item["activeImplementation"], "python")
            self.assertEqual(item["consecutiveMatchedCount"], 0)
            self.assertEqual(item["parityResultRefs"], [])
            self.assertIsNone(item["rustArtifactId"])
            replaced.extend(item["replacedPythonPaths"])
        self.assertEqual(len(replaced), len(set(replaced)))
        excluded = {
            path
            for item in ledger["exclusions"]
            for path in item["excludedPaths"]
        }
        self.assertTrue(excluded.isdisjoint(replaced))


if __name__ == "__main__":
    unittest.main()
