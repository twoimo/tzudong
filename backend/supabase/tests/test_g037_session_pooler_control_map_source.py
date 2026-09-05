"""Offline and source contracts for the G037 Connect-dialog control map."""

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
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
REQUEST_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-connect-control-map-request.v1.json"
)
CONTRACT_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-receipt-contract.v1.json"
)
SCRIPT_PATH = (
    ROOT / "backend/supabase/scripts/g037_session_pooler_control_map_receipt.py"
)
REQUEST = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
SPEC = importlib.util.spec_from_file_location("g037_pooler_control_map_receipt", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)
CENTRAL_GATES = tuple(
    json.loads(path.read_text(encoding="utf-8"))[key]
    for path, key in (
        (
            ROOT / "backend/supabase/g037-readonly-credential-contract.v1.json",
            "provisioningGate",
        ),
        (
            ROOT / "backend/supabase/hosted-db-access-decision.v1.json",
            "controllerGate",
        ),
    )
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def valid_receipt() -> dict[str, object]:
    receipt: dict[str, object] = {
        "schema": VERIFIER.SCHEMA,
        "status": "ready",
        "fixedCode": "g037_session_pooler_control_map_ready",
        "operationId": str(uuid.UUID("78ce4e76-730b-4fc9-a659-bd17883d0a57")),
        "observedAt": "2026-09-04T16:40:00Z",
        "controlMapRequestSha256": VERIFIER.REQUEST_SHA256,
        "priorAttemptSha256": VERIFIER.PRIOR_ATTEMPT_SHA256,
        "controlShapeSha256": "3" * 64,
        **VERIFIER.EXPECTED_COUNTS,
    }
    receipt.update({key: True for key in VERIFIER.TRUE_KEYS})
    receipt.update({key: False for key in VERIFIER.FALSE_KEYS})
    return receipt


class G037SessionPoolerControlMapSourceTests(unittest.TestCase):
    def test_request_is_exact_narrow_and_non_authorizing(self) -> None:
        self.assertEqual(
            sha256(REQUEST_PATH),
            "48366c5e157a186a6c19647a70da40d027c01a70e83ba0e3b6087ec5679fca7f",
        )
        self.assertEqual(
            REQUEST["kind"], "g037_session_pooler_connect_control_map_request"
        )
        self.assertEqual(
            REQUEST["requestStatus"],
            "blocked_fresh_named_owner_authorization_required",
        )
        discovery = REQUEST["requestedDiscovery"]
        self.assertEqual(discovery["maximumDashboardOpenCount"], 1)
        self.assertEqual(discovery["maximumInspectionAttemptCount"], 1)
        self.assertEqual(discovery["maximumControlSnapshotCount"], 2)
        self.assertEqual(discovery["maximumControlClickCount"], 1)
        self.assertIs(discovery["sessionPoolerControlClick"], False)
        self.assertIs(discovery["metadataValueRead"], False)
        self.assertTrue(all(REQUEST["authorizationGate"][key] is False for key in REQUEST["authorizationGate"]))

    def test_request_binds_spent_v1_and_forbids_value_bearing_nodes(self) -> None:
        continuity = REQUEST["continuity"]
        for prefix in (
            "metadataRequest",
            "spentAuthorization",
            "consumption",
            "failedAttempt",
        ):
            self.assertEqual(
                continuity[f"{prefix}Sha256"],
                sha256(ROOT / continuity[f"{prefix}Path"]),
            )
        self.assertEqual(continuity["priorRemainingReadCount"], 0)
        self.assertIs(continuity["priorAuthorizationReusable"], False)
        selector = REQUEST["selectorBoundary"]
        self.assertEqual(
            selector["allowedSelector"],
            "[role=dialog] button, [role=dialog] [role=combobox]",
        )
        self.assertIn(
            "textbox, input, textarea, code, or pre",
            selector["forbiddenSelectorsOrNodes"],
        )
        self.assertIs(selector["unexpectedValueBearingNodeDeny"], True)
        self.assertTrue(all(REQUEST["forbiddenObservation"].values()))
        self.assertTrue(all(REQUEST["prohibitedActions"].values()))

    def test_contract_and_verifier_are_exact_and_offline(self) -> None:
        self.assertEqual(
            sha256(CONTRACT_PATH),
            "c696287a0246849ef774aa256eb27a982d4303c06e0fd9ed73a3f3a004e5d1f1",
        )
        self.assertEqual(
            sha256(SCRIPT_PATH),
            "f5b641d76d33ed8343751dabb634f90737c898b4a44f70f95d2f63c27f601764",
        )
        self.assertEqual(CONTRACT["verifier"]["sha256"], sha256(SCRIPT_PATH))
        self.assertEqual(
            CONTRACT["continuity"]["controlMapRequestSha256"],
            sha256(REQUEST_PATH),
        )
        self.assertIs(CONTRACT["executionGate"]["controlMapReadAuthorized"], False)
        self.assertIs(CONTRACT["executionGate"]["controlMapReceiptPresent"], False)

    def test_validate_and_exact_receipt_emit_only_fixed_results(self) -> None:
        validation = subprocess.run(
            [os.fspath(Path(os.sys.executable)), os.fspath(SCRIPT_PATH), "validate"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(validation.returncode, 0, validation.stderr)
        self.assertEqual(
            json.loads(validation.stdout)["fixedCode"],
            "g037_session_pooler_control_map_source_valid",
        )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "receipt.json"
            path.write_bytes(VERIFIER.canonical_bytes(valid_receipt()))
            path.chmod(0o600)
            expected = sha256(path)
            verified = subprocess.run(
                [
                    os.fspath(Path(os.sys.executable)),
                    os.fspath(SCRIPT_PATH),
                    "verify",
                    "--receipt-file",
                    os.fspath(path),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=10,
            )
        self.assertEqual(verified.returncode, 0, verified.stderr)
        output = json.loads(verified.stdout)
        self.assertEqual(
            output["fixedCode"], "g037_session_pooler_control_map_receipt_ready"
        )
        self.assertEqual(output["receiptSha256"], expected)
        self.assertNotIn("controlShapeSha256", output)
        self.assertNotIn("operationId", output)

    def test_every_boolean_count_and_identity_drift_fails_closed(self) -> None:
        for key in sorted(VERIFIER.TRUE_KEYS):
            receipt = valid_receipt()
            receipt[key] = False
            with self.subTest(key=key), self.assertRaises(VERIFIER.ReceiptError):
                VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))
        for key in sorted(VERIFIER.FALSE_KEYS):
            receipt = valid_receipt()
            receipt[key] = True
            with self.subTest(key=key), self.assertRaises(VERIFIER.ReceiptError):
                VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))
        for key in VERIFIER.EXPECTED_COUNTS:
            receipt = valid_receipt()
            receipt[key] = receipt[key] + 1
            with self.subTest(key=key), self.assertRaises(VERIFIER.ReceiptError):
                VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))
        for key, value in (
            ("operationId", "invalid"),
            ("observedAt", "not-utc"),
            ("controlMapRequestSha256", "4" * 64),
            ("priorAttemptSha256", "5" * 64),
            ("controlShapeSha256", "0" * 64),
        ):
            receipt = valid_receipt()
            receipt[key] = value
            with self.subTest(key=key), self.assertRaises(VERIFIER.ReceiptError):
                VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))

    def test_central_gates_register_consumed_ambiguous_control_map(self) -> None:
        for gate in CENTRAL_GATES:
            self.assertIs(gate["sessionPoolerControlMapRequestPresent"], True)
            self.assertEqual(
                gate["sessionPoolerControlMapRequestSha256"], sha256(REQUEST_PATH)
            )
            self.assertIs(gate["sessionPoolerControlMapRequestBlocked"], True)
            self.assertIs(gate["sessionPoolerControlMapAuthorizationPresent"], True)
            self.assertEqual(gate["sessionPoolerControlMapApprovedCount"], 1)
            self.assertEqual(gate["sessionPoolerControlMapConsumedCount"], 1)
            self.assertIs(gate["sessionPoolerControlMapAuthorizationReusable"], False)
            self.assertIs(gate["sessionPoolerControlMapAttemptRecorded"], True)
            self.assertEqual(
                gate["sessionPoolerControlMapOutcomeCode"],
                "g037_session_pooler_control_map_async_completion_ambiguous",
            )
            self.assertIs(gate["sessionPoolerControlMapRetryAllowed"], False)
            self.assertEqual(
                gate["sessionPoolerControlMapReceiptContractSha256"],
                sha256(CONTRACT_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerControlMapReceiptVerifierSha256"],
                sha256(SCRIPT_PATH),
            )
            self.assertIs(gate["sessionPoolerControlMapReceiptPresent"], False)
            self.assertIs(gate["sessionPoolerControlMapReceiptVerified"], False)
            self.assertIs(gate["sessionPoolerSelected"], False)

    def test_tasks_docs_and_workflow_track_consumed_attempt(self) -> None:
        for task_id in range(526, 540):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(sha256(REQUEST_PATH), normalized)
            self.assertIn(sha256(CONTRACT_PATH), normalized)
            self.assertIn(sha256(SCRIPT_PATH), normalized)
            self.assertIn("control-only", normalized)
        for path in (REQUEST_PATH, CONTRACT_PATH, SCRIPT_PATH):
            relative = path.relative_to(ROOT).as_posix()
            self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_control_map_source",
            SECURITY_WORKFLOW,
        )

    def test_sources_contain_no_connection_or_credential_material(self) -> None:
        for path in (REQUEST_PATH, CONTRACT_PATH, SCRIPT_PATH):
            raw = path.read_text(encoding="utf-8").lower()
            for forbidden in (
                "postgres://",
                "postgresql://",
                "@aws-",
                ".pooler.supabase.com",
                "access_token",
                "refresh_token",
                "service_role_key",
                "database_password",
                "-----begin",
            ):
                self.assertNotIn(forbidden, raw)


if __name__ == "__main__":
    unittest.main()
