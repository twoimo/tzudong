"""Contracts for denied control-map v2 evidence and prepared v3 sources."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC_ROOT = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC_ROOT / "tasks.md").read_text(encoding="utf-8")
DESIGN = (SPEC_ROOT / "design.md").read_text(encoding="utf-8")
RUNBOOK = (ROOT / "backend/supabase/docs/g037-hosted-closure-runbook.md").read_text(
    encoding="utf-8"
)
WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(encoding="utf-8")
V2_AUTHORIZATION_PATH = ROOT / "backend/supabase/g037-session-pooler-connect-control-map-authorization.v2.json"
V2_CONSUMPTION_PATH = ROOT / "backend/supabase/g037-session-pooler-connect-control-map-consumption.v2.json"
V2_ATTEMPT_PATH = ROOT / "backend/supabase/g037-session-pooler-connect-control-map-attempt.v2.json"
BROWSER_SOURCE_PATH = ROOT / "backend/supabase/scripts/g037_session_pooler_control_map_read_v3.mjs"
STDOUT_FILTER_PATH = ROOT / "backend/supabase/scripts/g037_session_pooler_control_map_stdout_filter_v3.py"
REQUEST_PATH = ROOT / "backend/supabase/g037-session-pooler-connect-control-map-request.v3.json"
VERIFIER_PATH = ROOT / "backend/supabase/scripts/g037_session_pooler_control_map_receipt_v3.py"
CONTRACT_PATH = ROOT / "backend/supabase/g037-session-pooler-connect-control-map-receipt-contract.v3.json"
AUTHORIZATION_REQUEST_PATH = ROOT / "backend/supabase/g037-session-pooler-connect-control-map-authorization-request.v3.json"
V2_ATTEMPT = json.loads(V2_ATTEMPT_PATH.read_text(encoding="utf-8"))
REQUEST = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
AUTHORIZATION_REQUEST = json.loads(AUTHORIZATION_REQUEST_PATH.read_text(encoding="utf-8"))
SPEC = importlib.util.spec_from_file_location("g037_control_map_receipt_v3", VERIFIER_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)
CENTRAL_GATES = tuple(
    json.loads(path.read_text(encoding="utf-8"))[key]
    for path, key in (
        (ROOT / "backend/supabase/g037-readonly-credential-contract.v1.json", "provisioningGate"),
        (ROOT / "backend/supabase/hosted-db-access-decision.v1.json", "controllerGate"),
    )
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_filter(value: bytes) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [os.fspath(Path(os.sys.executable)), os.fspath(STDOUT_FILTER_PATH)],
        cwd=ROOT,
        input=value,
        capture_output=True,
        timeout=10,
    )


def valid_receipt() -> dict[str, object]:
    receipt: dict[str, object] = {
        "schema": VERIFIER.SCHEMA,
        "status": "ready",
        "fixedCode": "g037_session_pooler_control_map_v3_ready",
        "stageCode": "ready",
        "operationId": str(uuid.UUID("3d38beb3-e349-4fe7-9d5f-087346839e10")),
        "observedAt": "2026-09-04T18:30:00Z",
        "controlMapRequestSha256": VERIFIER.REQUEST_SHA256,
        "browserSourceSha256": VERIFIER.BROWSER_SOURCE_SHA256,
        "stdoutFilterSha256": VERIFIER.STDOUT_FILTER_SHA256,
        "priorAttemptSha256": VERIFIER.PRIOR_ATTEMPT_SHA256,
        "observationSha256": "6" * 64,
        "controlShapeSha256": "7" * 64,
        **VERIFIER.EXPECTED_COUNTS,
    }
    receipt.update({key: True for key in VERIFIER.TRUE_KEYS})
    receipt.update({key: False for key in VERIFIER.FALSE_KEYS})
    return receipt


class G037SessionPoolerControlMapV3SourceTests(unittest.TestCase):
    def test_v2_evidence_is_exact_spent_denied_and_non_reusable(self) -> None:
        self.assertEqual(sha256(V2_AUTHORIZATION_PATH), "62b222c88728c0b993359dd472e36aa7fcfa715bceaac3dd6e1675f76c09e069")
        self.assertEqual(sha256(V2_CONSUMPTION_PATH), "27cbf11111867f223acfd92fb72675c4f105dffebb64a1d115ac68fdb8c7659f")
        self.assertEqual(sha256(V2_ATTEMPT_PATH), "f624f78125c1c3938053569fa27e2d547aa3796f17d621f7707f8eb47580aad5")
        self.assertEqual(V2_ATTEMPT["outcome"]["status"], "denied")
        self.assertEqual(V2_ATTEMPT["browserExecution"]["dashboardOpenCountObserved"], 1)
        self.assertEqual(V2_ATTEMPT["browserExecution"]["controlSnapshotCountObserved"], 0)
        self.assertEqual(V2_ATTEMPT["browserExecution"]["controlClickCountObserved"], 0)
        self.assertIs(V2_ATTEMPT["browserExecution"]["transportEmittedAutomaticTabTitle"], True)
        self.assertIs(V2_ATTEMPT["browserExecution"]["rawTransportTitleStoredInRepository"], False)
        self.assertIs(V2_ATTEMPT["retryGate"]["controlMapRetryAllowed"], False)

    def test_v3_browser_source_is_exact_wait_bounded_and_single_line(self) -> None:
        self.assertEqual(sha256(BROWSER_SOURCE_PATH), "6dbf2915400970b6de301a2f9aed5c0736d23bc7572d8a6ec7e8e4ced3a5d96e")
        source = BROWSER_SOURCE_PATH.read_text(encoding="utf-8")
        self.assertEqual(source.count("\n"), 1)
        self.assertIn("await openTab(g037v3TargetUrl)", source)
        self.assertIn("timeout:15000", source)
        self.assertIn("timeout:10000", source)
        self.assertEqual(source.count("await snapshot(g037v3Page"), 2)
        self.assertIn("stageCode:g037v3StageCode", source)
        self.assertNotIn("(async function", source)
        self.assertNotIn("eval(", source)
        syntax = subprocess.run(
            ["node", "--check", os.fspath(BROWSER_SOURCE_PATH)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)

    def test_stdout_filter_discards_transport_envelope_and_fails_closed(self) -> None:
        self.assertEqual(sha256(STDOUT_FILTER_PATH), "f826640d6004d9baec9870130180fc189e75aa83b982dd14d4b44be8e1082855")
        observation = {
            "controlClickCount": 0,
            "controlSnapshotCount": 0,
            "dashboardOpenCount": 1,
            "fixedCode": "g037_session_pooler_control_map_v3_denied",
            "metadataValueRead": False,
            "persistentStateChanged": False,
            "schema": "g037-session-pooler-control-map-observation-v3",
            "stageCode": "waiting_first_control_scope",
            "status": "denied",
        }
        canonical = json.dumps(observation, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii") + b"\n"
        result = run_filter(b"automatic provider transport title\n" + canonical + b"[ok]\n")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, canonical)
        self.assertNotIn(b"transport title", result.stdout)
        self.assertNotEqual(run_filter(canonical + canonical).returncode, 0)
        bad = dict(observation, stageCode="unbounded_dynamic_stage")
        self.assertNotEqual(run_filter(json.dumps(bad).encode() + b"\n").returncode, 0)
        self.assertNotEqual(run_filter(b"x" * 32769).returncode, 0)

    def test_request_binds_prior_attempt_source_and_filter_without_authority(self) -> None:
        self.assertEqual(sha256(REQUEST_PATH), "e0e33500d568d911412c0b0faf4fe2ecf732185655c128f25c6ae6d45c72e9b0")
        continuity = REQUEST["continuity"]
        for prefix in ("priorRequest", "spentAuthorization", "consumption", "deniedAttempt"):
            self.assertEqual(continuity[f"{prefix}Sha256"], sha256(ROOT / continuity[f"{prefix}Path"]))
        self.assertEqual(REQUEST["reviewedBrowserSource"]["sha256"], sha256(BROWSER_SOURCE_PATH))
        self.assertEqual(REQUEST["reviewedStdoutFilter"]["sha256"], sha256(STDOUT_FILTER_PATH))
        self.assertIs(REQUEST["failureAssessment"]["exactFailureCauseEstablished"], False)
        self.assertIs(REQUEST["authorizationGate"]["controlMapReadAuthorized"], False)

    def test_contract_and_verifier_are_exact_offline_and_fail_closed(self) -> None:
        self.assertEqual(sha256(CONTRACT_PATH), "1336c656acd8abb1bdf4e51a157400160e87a28bde4bd159e40fe7e36e172daa")
        self.assertEqual(sha256(VERIFIER_PATH), "7c9d5033ea0e581df8e133310e8f8f923aa5313f8c8e84753bad4c3f6ed5c942")
        self.assertEqual(VERIFIER.REQUEST_SHA256, sha256(REQUEST_PATH))
        self.assertEqual(VERIFIER.BROWSER_SOURCE_SHA256, sha256(BROWSER_SOURCE_PATH))
        self.assertEqual(VERIFIER.STDOUT_FILTER_SHA256, sha256(STDOUT_FILTER_PATH))
        self.assertEqual(VERIFIER.PRIOR_ATTEMPT_SHA256, sha256(V2_ATTEMPT_PATH))
        result = subprocess.run(
            [os.fspath(Path(os.sys.executable)), os.fspath(VERIFIER_PATH), "validate"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["fixedCode"], "g037_session_pooler_control_map_v3_source_valid")

    def test_ready_receipt_is_accepted_and_any_safety_drift_is_denied(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "receipt.json"
            path.write_bytes(VERIFIER.canonical_bytes(valid_receipt()))
            path.chmod(0o600)
            expected = sha256(path)
            result = subprocess.run(
                [os.fspath(Path(os.sys.executable)), os.fspath(VERIFIER_PATH), "verify", "--receipt-file", os.fspath(path)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=10,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["receiptSha256"], expected)
        for key in sorted(VERIFIER.FALSE_KEYS):
            receipt = valid_receipt()
            receipt[key] = True
            with self.subTest(key=key), self.assertRaises(VERIFIER.ReceiptError):
                VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))

    def test_authorization_request_binds_all_sources_but_grants_nothing(self) -> None:
        self.assertEqual(sha256(AUTHORIZATION_REQUEST_PATH), "3469f4f434627c1e49a7b8e9e5765c50e4d82548c6c40a6c014d1de5a57759d8")
        for descriptor in AUTHORIZATION_REQUEST["reviewedArtifacts"].values():
            self.assertEqual(descriptor["sha256"], sha256(ROOT / descriptor["path"]))
        statement = AUTHORIZATION_REQUEST["requestedExactStatement"]
        for path in (REQUEST_PATH, BROWSER_SOURCE_PATH, STDOUT_FILTER_PATH, CONTRACT_PATH, VERIFIER_PATH):
            self.assertIn(sha256(path), statement)
        gate = AUTHORIZATION_REQUEST["authorizationGate"]
        self.assertIs(gate["exactStatementReceived"], False)
        self.assertIs(gate["executionAuthorizationPresent"], False)
        self.assertEqual(gate["approvedExecutionCount"], 0)

    def test_central_gates_and_docs_keep_v3_blocked(self) -> None:
        for gate in CENTRAL_GATES:
            self.assertIs(gate["sessionPoolerControlMapV3RequestPresent"], True)
            self.assertIs(gate["sessionPoolerControlMapV3RequestBlocked"], True)
            self.assertEqual(gate["sessionPoolerControlMapV3RequestSha256"], sha256(REQUEST_PATH))
            self.assertEqual(gate["sessionPoolerControlMapV3BrowserSourceSha256"], sha256(BROWSER_SOURCE_PATH))
            self.assertEqual(gate["sessionPoolerControlMapV3StdoutFilterSha256"], sha256(STDOUT_FILTER_PATH))
            self.assertEqual(gate["sessionPoolerControlMapV3ReceiptContractSha256"], sha256(CONTRACT_PATH))
            self.assertEqual(gate["sessionPoolerControlMapV3ReceiptVerifierSha256"], sha256(VERIFIER_PATH))
            self.assertEqual(gate["sessionPoolerControlMapV3AuthorizationRequestSha256"], sha256(AUTHORIZATION_REQUEST_PATH))
            self.assertIs(gate["sessionPoolerControlMapV3ApprovalStatementReceived"], False)
            self.assertIs(gate["sessionPoolerControlMapV3AuthorizationPresent"], False)
            self.assertIs(gate["sessionPoolerControlMapV3ReceiptPresent"], False)
            self.assertIs(gate["sessionPoolerSelected"], False)
        for task_id in range(557, 564):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x] 7.564 ", TASKS)
        self.assertIn("- [x]! 7.565 ", TASKS)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            for path in (V2_ATTEMPT_PATH, BROWSER_SOURCE_PATH, STDOUT_FILTER_PATH, REQUEST_PATH, VERIFIER_PATH, CONTRACT_PATH, AUTHORIZATION_REQUEST_PATH):
                self.assertIn(sha256(path), normalized)

    def test_consumed_task_authorization_records_denial_without_a_success_receipt(self) -> None:
        attempt_path = ROOT / "backend/supabase/g037-session-pooler-connect-control-map-attempt.v3.json"
        attempt = json.loads(attempt_path.read_text(encoding="utf-8"))
        self.assertIn(attempt_path.relative_to(ROOT).as_posix(), WORKFLOW)
        self.assertEqual(attempt["authorization"]["basis"], "current_user_task_transcript")
        self.assertIs(attempt["authorization"]["historicalExactStatementClaimed"], False)
        self.assertIs(attempt["authorization"]["consumedBeforeExecution"], True)
        self.assertEqual(attempt["authorization"]["remainingExecutionCount"], 0)
        for binding in attempt["reviewedArtifacts"].values():
            self.assertEqual(sha256(ROOT / binding["path"]), binding["sha256"])
        observation = attempt["observation"]
        encoded = (json.dumps(observation, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n").encode()
        self.assertEqual(hashlib.sha256(encoded).hexdigest(), attempt["canonicalObservationSha256"])
        self.assertEqual(observation["status"], "denied")
        self.assertEqual(observation["stageCode"], "reading_first_control_scope")
        self.assertEqual(observation["dashboardOpenCount"], 1)
        self.assertEqual(observation["controlSnapshotCount"], 1)
        self.assertEqual(observation["controlClickCount"], 0)
        self.assertIs(observation["metadataValueRead"], False)
        self.assertIs(observation["persistentStateChanged"], False)
        self.assertIs(attempt["successfulReceiptCreated"], False)
        self.assertIs(attempt["automaticRetry"], False)
        self.assertIs(attempt["successorMetadataReady"], False)

    def test_workflow_covers_every_v3_source_and_no_source_contains_secrets(self) -> None:
        paths = (
            BROWSER_SOURCE_PATH,
            STDOUT_FILTER_PATH,
            REQUEST_PATH,
            VERIFIER_PATH,
            CONTRACT_PATH,
            AUTHORIZATION_REQUEST_PATH,
            Path(__file__),
        )
        for path in paths:
            relative = path.relative_to(ROOT).as_posix()
            self.assertEqual(WORKFLOW.count(f"- '{relative}'"), 1)
        for path in paths[:-1]:
            raw = path.read_text(encoding="utf-8").lower()
            for forbidden in ("postgres://", "postgresql://", "@aws-", ".pooler.supabase.com", "access_token", "refresh_token", "service_role_key", "database_password", "-----begin"):
                self.assertNotIn(forbidden, raw)
        self.assertIn("backend.supabase.tests.test_g037_session_pooler_control_map_v3_source", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
