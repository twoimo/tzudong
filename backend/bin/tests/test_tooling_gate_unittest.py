#!/usr/bin/env python3
"""Unit tests for the tooling startup gate ``backend/bin/tooling_gate.py``
(Task 29; Requirement 11.5, 11.8, 11.9).

These verify the observable branches with injected fakes and no live Docker,
network, or operator secrets:

  * record coherence rejects category-count / candidate-count / duplicate-id /
    unpinned-tag / unresolved-path mismatches with ``tooling_record_mismatch``,
    and admits the committed record (11.9);
  * the startup gate excludes every unapproved category with
    ``tooling_approval_missing`` and admits only ``approved`` ones, with no
    partial startup (11.5);
  * install measurement fills fields only from a real (fake) runner observation,
    never estimates when unrun, and marks a zero-success category
    ``local_install_unverified`` (11.8);
  * the committed record — today all approvals unresolved and all measurements
    null — honestly yields an empty default startup set.

Following the ``backend/bin`` convention (no ``__init__.py``), the module and
the committed record are loaded by file path.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = _ROOT / "backend" / "bin" / "tooling_gate.py"
_RECORD_PATH = _ROOT / "backend" / "deploy" / "tooling-selection.v1.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tg = _load("tooling_gate", _MODULE_PATH)


def _committed_record() -> dict:
    return json.loads(_RECORD_PATH.read_text(encoding="utf-8"))


# A tiny two-category record that is coherent against a fake tree root.
def _minimal_record(tmp_root: Path) -> dict:
    (tmp_root / "compose").mkdir(parents=True, exist_ok=True)
    compose_rel = "compose/docker-compose.observability.yml"
    (tmp_root / compose_rel).write_text("services: {}\n", encoding="utf-8")

    def category(name: str, ids: list[str], status: str) -> dict:
        return {
            "category": name,
            "operatorApproval": {
                "approverName": None,
                "approvedAt": None,
                "category": name,
                "selectedCandidateId": ids[0],
                "status": status,
            },
            "candidates": [
                {
                    "candidateId": cid,
                    "category": name,
                    "referenceKind": "image_tag",
                    "imageTag": f"example.io/{cid}:v1.2.3",
                    "installVerifyCommand": f"docker image inspect example.io/{cid}:v1.2.3",
                    "macosLocalInstallSucceeded": None,
                    "installVerifyObservation": None,
                    "residentMemoryMiBAt300s": None,
                }
                for cid in ids
            ],
        }

    # 12 categories so the count check passes for coherence-focused tests.
    categories = [
        category(f"cat_{i}", [f"cand_{i}_a", f"cand_{i}_b"], "unresolved")
        for i in range(tg.EXPECTED_CATEGORY_COUNT)
    ]
    return {
        "schemaVersion": 1,
        "kind": "tooling_selection_record",
        "categoryCount": tg.EXPECTED_CATEGORY_COUNT,
        "categories": categories,
        "currentAssetDecisions": [
            {"asset": "obs", "composePath": compose_rel, "decision": "keep"}
        ],
    }


class PinnedReferenceTests(unittest.TestCase):
    def test_exact_image_tag_is_pinned(self):
        self.assertTrue(tg.is_pinned_reference("apache/kafka:3.9.0", "image_tag"))

    def test_registry_prefixed_image_tag_is_pinned(self):
        self.assertTrue(
            tg.is_pinned_reference(
                "ghcr.io/project-zot/zot-linux-arm64:v2.1.20", "image_tag"
            )
        )

    def test_digest_image_is_pinned(self):
        self.assertTrue(
            tg.is_pinned_reference("grafana/grafana@sha256:" + "a" * 64, "image_tag")
        )

    def test_latest_and_untagged_rejected(self):
        self.assertFalse(tg.is_pinned_reference("grafana/grafana:latest", "image_tag"))
        self.assertFalse(tg.is_pinned_reference("grafana/grafana", "image_tag"))

    def test_package_version_pin_and_range(self):
        self.assertTrue(tg.is_pinned_reference("4.2.4", "package_version"))
        self.assertTrue(tg.is_pinned_reference("v5.5.0", "package_version"))
        self.assertFalse(tg.is_pinned_reference("^1.2.0", "package_version"))
        self.assertFalse(tg.is_pinned_reference(">=1.2.0", "package_version"))
        self.assertFalse(tg.is_pinned_reference("1.2.x", "package_version"))

    def test_address_scheme_pin_and_wildcard(self):
        self.assertTrue(
            tg.is_pinned_reference("harbor.local/tzudong/pipeline-api", "registry_address_scheme")
        )
        self.assertFalse(
            tg.is_pinned_reference("harbor.local/tzudong/*", "registry_address_scheme")
        )

    def test_unknown_kind_and_non_string_rejected(self):
        self.assertFalse(tg.is_pinned_reference("x:1", "mystery_kind"))
        self.assertFalse(tg.is_pinned_reference(None, "image_tag"))


class RecordCoherenceTests(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(self.enterContext(_tempdir()))
        self.record = _minimal_record(self._tmp)

    def test_minimal_record_is_coherent(self):
        res = tg.validate_record_coherence(self.record, root=self._tmp)
        self.assertTrue(res["ok"], res)
        self.assertIsNone(res["errorCode"])

    def test_wrong_declared_count_mismatch(self):
        self.record["categoryCount"] = 11
        res = tg.validate_record_coherence(self.record, root=self._tmp)
        self.assertFalse(res["ok"])
        self.assertEqual(res["errorCode"], tg.TOOLING_RECORD_MISMATCH)
        self.assertTrue(
            any(m["kind"] == "declared_category_count" for m in res["mismatches"])
        )

    def test_enumerated_count_mismatch(self):
        self.record["categories"].pop()
        res = tg.validate_record_coherence(self.record, root=self._tmp)
        self.assertEqual(res["errorCode"], tg.TOOLING_RECORD_MISMATCH)
        self.assertTrue(
            any(m["kind"] == "enumerated_category_count" for m in res["mismatches"])
        )

    def test_candidate_count_out_of_range(self):
        self.record["categories"][0]["candidates"] = self.record["categories"][0][
            "candidates"
        ][:1]
        res = tg.validate_record_coherence(self.record, root=self._tmp)
        self.assertEqual(res["errorCode"], tg.TOOLING_RECORD_MISMATCH)
        self.assertTrue(any(m["kind"] == "candidate_count" for m in res["mismatches"]))

    def test_duplicate_candidate_id(self):
        cands = self.record["categories"][0]["candidates"]
        cands[1]["candidateId"] = cands[0]["candidateId"]
        res = tg.validate_record_coherence(self.record, root=self._tmp)
        self.assertEqual(res["errorCode"], tg.TOOLING_RECORD_MISMATCH)
        self.assertTrue(
            any(m["kind"] == "duplicate_candidate_id" for m in res["mismatches"])
        )

    def test_unpinned_tag(self):
        self.record["categories"][0]["candidates"][0]["imageTag"] = "example.io/x:latest"
        res = tg.validate_record_coherence(self.record, root=self._tmp)
        self.assertEqual(res["errorCode"], tg.TOOLING_RECORD_MISMATCH)
        self.assertTrue(
            any(m["kind"] == "unpinned_reference" for m in res["mismatches"])
        )

    def test_unresolved_path(self):
        self.record["currentAssetDecisions"][0]["composePath"] = "compose/missing.yml"
        res = tg.validate_record_coherence(self.record, root=self._tmp)
        self.assertEqual(res["errorCode"], tg.TOOLING_RECORD_MISMATCH)
        self.assertTrue(any(m["kind"] == "unresolved_path" for m in res["mismatches"]))

    def test_committed_record_is_coherent_on_real_tree(self):
        res = tg.validate_record_coherence(_committed_record(), root=_ROOT)
        self.assertTrue(res["ok"], res)


class StartupGateTests(unittest.TestCase):
    def test_all_unresolved_excludes_all(self):
        gate = tg.startup_gate(_committed_record())
        self.assertFalse(gate["ok"])
        self.assertEqual(gate["errorCode"], tg.TOOLING_APPROVAL_MISSING)
        self.assertEqual(gate["admitted"], [])
        self.assertEqual(len(gate["excluded"]), tg.EXPECTED_CATEGORY_COUNT)
        for row in gate["excluded"]:
            self.assertEqual(row["errorCode"], tg.TOOLING_APPROVAL_MISSING)

    def test_only_approved_admitted(self):
        record = _committed_record()
        record["categories"][0]["operatorApproval"].update(status="approved", approverName="test-operator")
        gate = tg.startup_gate(record)
        self.assertTrue(gate["ok"])
        self.assertIsNone(gate["errorCode"])
        self.assertEqual(gate["admitted"], [record["categories"][0]["category"]])
        self.assertEqual(len(gate["excluded"]), tg.EXPECTED_CATEGORY_COUNT - 1)

    def test_status_only_or_blank_identity_never_admits_startup(self):
        for name in (None, "", "  ", 1, [], {}):
            record = _committed_record()
            record["categories"][0]["operatorApproval"].update(status="approved", approverName=name)
            self.assertFalse(tg.startup_gate(record)["ok"])

    def test_pending_and_rejected_not_admitted(self):
        record = _committed_record()
        record["categories"][0]["operatorApproval"]["status"] = "pending"
        record["categories"][1]["operatorApproval"]["status"] = "rejected"
        gate = tg.startup_gate(record)
        self.assertNotIn(record["categories"][0]["category"], gate["admitted"])
        self.assertNotIn(record["categories"][1]["category"], gate["admitted"])


class _RecordingRunner:
    """A fake command runner that returns scripted observations by command."""

    def __init__(self, results: dict):
        self.results = results
        self.calls: list[str] = []

    def __call__(self, command: str):
        self.calls.append(command)
        return self.results.get(command, {"ran": False})


class InstallMeasurementTests(unittest.TestCase):
    def test_null_runner_leaves_measurements_null(self):
        candidate = {
            "candidateId": "x",
            "installVerifyCommand": "docker image inspect x:1",
        }
        measured = tg.measure_candidate(candidate)
        self.assertIsNone(measured["macosLocalInstallSucceeded"])
        self.assertIsNone(measured["installVerifyObservation"])
        self.assertIsNone(measured["residentMemoryMiBAt300s"])

    def test_runner_fills_success(self):
        cmd = "docker image inspect x:1"
        runner = _RecordingRunner(
            {cmd: {"ran": True, "exitCode": 0, "observation": "ok", "residentMemoryMiBAt300s": 42}}
        )
        measured = tg.measure_candidate({"candidateId": "x", "installVerifyCommand": cmd}, runner)
        self.assertTrue(measured["macosLocalInstallSucceeded"])
        self.assertEqual(measured["installVerifyObservation"], "ok")
        self.assertEqual(measured["residentMemoryMiBAt300s"], 42)

    def test_runner_fills_failure(self):
        cmd = "docker image inspect x:1"
        runner = _RecordingRunner({cmd: {"ran": True, "exitCode": 125, "observation": "no such image"}})
        measured = tg.measure_candidate({"candidateId": "x", "installVerifyCommand": cmd}, runner)
        self.assertFalse(measured["macosLocalInstallSucceeded"])
        self.assertIsNone(measured["residentMemoryMiBAt300s"])

    def test_observation_is_length_bounded(self):
        cmd = "c"
        runner = _RecordingRunner({cmd: {"ran": True, "exitCode": 0, "observation": "z" * 5000}})
        measured = tg.measure_candidate({"candidateId": "x", "installVerifyCommand": cmd}, runner)
        self.assertLessEqual(len(measured["installVerifyObservation"]), tg._MAX_OBSERVATION_CHARS)

    def test_missing_command_stays_null(self):
        runner = _RecordingRunner({})
        measured = tg.measure_candidate({"candidateId": "x"}, runner)
        self.assertIsNone(measured["macosLocalInstallSucceeded"])
        self.assertEqual(runner.calls, [])

    def test_negative_memory_coerced_to_null(self):
        cmd = "c"
        runner = _RecordingRunner({cmd: {"ran": True, "exitCode": 0, "residentMemoryMiBAt300s": -5}})
        measured = tg.measure_candidate({"candidateId": "x", "installVerifyCommand": cmd}, runner)
        self.assertIsNone(measured["residentMemoryMiBAt300s"])

    def test_committed_record_all_unverified_with_null_runner(self):
        install = tg.install_verify(_committed_record())
        self.assertFalse(install["ok"])
        self.assertEqual(install["errorCode"], tg.LOCAL_INSTALL_UNVERIFIED)
        for row in install["categories"]:
            self.assertFalse(row["resolved"])
            self.assertEqual(row["succeededCandidateCount"], 0)
            self.assertEqual(row["errorCode"], tg.LOCAL_INSTALL_UNVERIFIED)

    def test_category_resolved_when_one_candidate_succeeds(self):
        record = _committed_record()
        target = record["categories"][0]
        cmd = target["candidates"][0]["installVerifyCommand"]
        runner = _RecordingRunner({cmd: {"ran": True, "exitCode": 0, "observation": "ok"}})
        install = tg.install_verify(record, runner)
        first = next(r for r in install["categories"] if r["category"] == target["category"])
        self.assertTrue(first["resolved"])
        self.assertEqual(first["succeededCandidateCount"], 1)

    def test_input_candidate_not_mutated(self):
        cmd = "c"
        candidate = {"candidateId": "x", "installVerifyCommand": cmd,
                     "macosLocalInstallSucceeded": None}
        snapshot = copy.deepcopy(candidate)
        runner = _RecordingRunner({cmd: {"ran": True, "exitCode": 0}})
        tg.measure_candidate(candidate, runner)
        self.assertEqual(candidate, snapshot)


class EvaluateTests(unittest.TestCase):
    def test_committed_record_honest_empty_default_set(self):
        artifact = tg.evaluate(_committed_record(), root=_ROOT)
        self.assertTrue(artifact["recordCoherent"])
        self.assertFalse(artifact["ok"])
        self.assertEqual(artifact["defaultStartupSet"], [])
        # Approval is the first blocking gate today.
        self.assertEqual(artifact["errorCode"], tg.TOOLING_APPROVAL_MISSING)

    def test_mismatched_record_short_circuits(self):
        record = _committed_record()
        record["categoryCount"] = 99
        artifact = tg.evaluate(record, root=_ROOT)
        self.assertFalse(artifact["recordCoherent"])
        self.assertEqual(artifact["errorCode"], tg.TOOLING_RECORD_MISMATCH)
        self.assertIsNone(artifact["gate"])

    def test_approved_but_unverified_reports_install_code(self):
        record = _committed_record()
        for category in record["categories"]:
            category["operatorApproval"].update(status="approved", approverName="test-operator")
        artifact = tg.evaluate(record, root=_ROOT)
        self.assertEqual(artifact["errorCode"], tg.LOCAL_INSTALL_UNVERIFIED)
        self.assertEqual(artifact["defaultStartupSet"], [])

    def test_approved_and_verified_enters_default_set(self):
        record = _committed_record()
        target = record["categories"][0]
        target["operatorApproval"].update(status="approved", approverName="test-operator")
        cmd = target["candidates"][0]["installVerifyCommand"]
        runner = _RecordingRunner({cmd: {"ran": True, "exitCode": 0, "observation": "ok"}})
        artifact = tg.evaluate(record, root=_ROOT, command_runner=runner)
        self.assertEqual(artifact["defaultStartupSet"], [target["category"]])
        self.assertTrue(artifact["ok"])
        self.assertIsNone(artifact["errorCode"])


class ClosedCodeSetTests(unittest.TestCase):
    def test_all_returned_codes_in_closed_set(self):
        record = _committed_record()
        for res in (
            tg.validate_record_coherence(record, root=_ROOT),
            tg.startup_gate(record),
            tg.install_verify(record),
        ):
            self.assertIn(res["errorCode"], tg.TOOLING_GATE_RESULT_CODES)


# --- test helpers ---------------------------------------------------------

import contextlib
import tempfile


@contextlib.contextmanager
def _tempdir():
    d = tempfile.mkdtemp(prefix="tooling_gate_test_")
    try:
        yield d
    finally:
        import shutil

        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
