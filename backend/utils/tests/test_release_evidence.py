from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
CHECKER_PATH = REPO_ROOT / "backend" / "bin" / "check_release_evidence.py"
OBSERVED_ARTIFACT = REPO_ROOT / "artifacts" / "release-evidence-20260807.json"

_spec = importlib.util.spec_from_file_location("check_release_evidence", CHECKER_PATH)
assert _spec is not None and _spec.loader is not None
checker = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = checker
_spec.loader.exec_module(checker)


class ReleaseEvidenceCheckerTests(unittest.TestCase):
    def run_checker(self, path: Path) -> tuple[subprocess.CompletedProcess[str], dict[str, Any]]:
        result = subprocess.run(
            [sys.executable, str(CHECKER_PATH), str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.stderr, "")
        self.assertLessEqual(len(result.stdout.encode("utf-8")), 16_384)
        return result, json.loads(result.stdout)

    def write_json(self, directory: Path, value: Any, name: str = "evidence.json") -> Path:
        path = directory / name
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def test_missing_file_fails_closed_with_bounded_json(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, report = self.run_checker(Path(temporary) / "missing.json")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["status"], "missing")
        self.assertFalse(report["allExternalGatesVerified"])
        self.assertEqual(report["diagnostics"][0]["code"], "FILE_MISSING")
        self.assertEqual(report["authenticity"], "not established")

    def test_malformed_schema_rejects_unknown_root_field(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            value = json.loads(OBSERVED_ARTIFACT.read_text(encoding="utf-8"))
            value["unexpected"] = True
            path = self.write_json(Path(temporary), value)
            result, report = self.run_checker(path)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(report["status"], "invalid")
        self.assertEqual(report["diagnostics"][0]["code"], "SCHEMA_KEYS")

    def test_technical_only_observations_remain_blocked(self) -> None:
        result, report = self.run_checker(OBSERVED_ARTIFACT)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["status"], "blocked")
        self.assertFalse(report["allExternalGatesVerified"])
        self.assertEqual(
            report["gateStatuses"],
            {
                **{gate: "not evidenced" for gate in checker.REQUIRED_EXTERNAL_GATES[:-1]},
                "releaseDecision": "blocked",
            },
        )
        self.assertEqual(report["productionRelease"], "not certified")
        self.assertTrue(all(item["code"] == "GATE_NOT_VERIFIED" for item in report["diagnostics"]))

    def test_explicit_all_gates_verified_is_observed_not_authenticated(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            value = copy.deepcopy(json.loads(OBSERVED_ARTIFACT.read_text(encoding="utf-8")))
            value["releaseGateStatus"] = {
                gate: {"status": "verified", "evidenceRef": f"external://g003/{gate}"}
                for gate in checker.REQUIRED_EXTERNAL_GATES
            }
            path = self.write_json(Path(temporary), value)
            result, report = self.run_checker(path)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["status"], "observed_all_gates_verified")
        self.assertTrue(report["allExternalGatesVerified"])
        self.assertEqual(report["productionRelease"], "not certified")
        self.assertEqual(report["authenticity"], "not established")
        self.assertEqual(report["diagnostics"], [])

    def test_secret_reference_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            value = copy.deepcopy(json.loads(OBSERVED_ARTIFACT.read_text(encoding="utf-8")))
            value["releaseGateStatus"]["privacyLegalReview"] = {
                "status": "verified",
                "evidenceRef": "secret://operator-token",
            }
            path = self.write_json(Path(temporary), value)
            result, report = self.run_checker(path)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["diagnostics"][0]["code"], "EVIDENCE_REFERENCE_SECRET")


if __name__ == "__main__":
    unittest.main()
