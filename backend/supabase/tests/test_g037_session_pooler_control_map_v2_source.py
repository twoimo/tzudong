"""Contracts for the spent control-map v1 attempt and prepared v2 source."""

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
AUTHORIZATION_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-authorization.v1.json"
)
CONSUMPTION_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-consumption.v1.json"
)
ATTEMPT_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-attempt.v1.json"
)
BROWSER_SOURCE_PATH = (
    ROOT / "backend/supabase/scripts/g037_session_pooler_control_map_read_v2.mjs"
)
REQUEST_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-connect-control-map-request.v2.json"
)
CONTRACT_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-receipt-contract.v2.json"
)
VERIFIER_PATH = ROOT / (
    "backend/supabase/scripts/g037_session_pooler_control_map_receipt_v2.py"
)
AUTHORIZATION_REQUEST_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-authorization-request.v2.json"
)
V2_AUTHORIZATION_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-authorization.v2.json"
)
V2_CONSUMPTION_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-consumption.v2.json"
)
V2_ATTEMPT_PATH = ROOT / (
    "backend/supabase/g037-session-pooler-connect-control-map-attempt.v2.json"
)
AUTHORIZATION = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
CONSUMPTION = json.loads(CONSUMPTION_PATH.read_text(encoding="utf-8"))
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
REQUEST = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
AUTHORIZATION_REQUEST = json.loads(
    AUTHORIZATION_REQUEST_PATH.read_text(encoding="utf-8")
)
V2_AUTHORIZATION = json.loads(V2_AUTHORIZATION_PATH.read_text(encoding="utf-8"))
V2_CONSUMPTION = json.loads(V2_CONSUMPTION_PATH.read_text(encoding="utf-8"))
V2_ATTEMPT = json.loads(V2_ATTEMPT_PATH.read_text(encoding="utf-8"))
SPEC = importlib.util.spec_from_file_location(
    "g037_pooler_control_map_receipt_v2", VERIFIER_PATH
)
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
        "fixedCode": "g037_session_pooler_control_map_v2_ready",
        "operationId": str(uuid.UUID("516f107b-3692-4e11-ac08-cdd2f24b74ee")),
        "observedAt": "2026-09-04T17:20:00Z",
        "controlMapRequestSha256": VERIFIER.REQUEST_SHA256,
        "browserSourceSha256": VERIFIER.BROWSER_SOURCE_SHA256,
        "priorAttemptSha256": VERIFIER.PRIOR_ATTEMPT_SHA256,
        "observationSha256": "4" * 64,
        "controlShapeSha256": "5" * 64,
        **VERIFIER.EXPECTED_COUNTS,
    }
    receipt.update({key: True for key in VERIFIER.TRUE_KEYS})
    receipt.update({key: False for key in VERIFIER.FALSE_KEYS})
    return receipt


class G037SessionPoolerControlMapV2SourceTests(unittest.TestCase):
    def test_v1_authorization_and_consumption_are_exact_and_non_reusable(self) -> None:
        self.assertEqual(
            sha256(AUTHORIZATION_PATH),
            "3cfe7a899473aea6c31c2a50d1e644db4147c1e03fb3bf10f6118c759ed0f2a6",
        )
        self.assertEqual(
            sha256(CONSUMPTION_PATH),
            "61979c28e596a55a0dcf4fc21b54c518b8ebe9996139892cf80819e25da21748",
        )
        self.assertEqual(AUTHORIZATION["approverDisplayName"], "최연우")
        self.assertEqual(AUTHORIZATION["approvedTarget"]["maximumDashboardOpenCount"], 1)
        self.assertEqual(AUTHORIZATION["executionBudget"]["approvedReadCount"], 1)
        self.assertEqual(AUTHORIZATION["executionBudget"]["consumedReadCount"], 0)
        self.assertEqual(CONSUMPTION["operationId"], ATTEMPT["operationId"])
        self.assertLess(CONSUMPTION["consumedAt"], ATTEMPT["attemptRecordedAt"])
        self.assertEqual(CONSUMPTION["authorization"]["consumedReadCount"], 1)
        self.assertEqual(CONSUMPTION["authorization"]["remainingReadCount"], 0)
        self.assertIs(CONSUMPTION["authorization"]["reusable"], False)

    def test_v1_attempt_is_ambiguous_and_stopped_without_external_followup(self) -> None:
        self.assertEqual(
            sha256(ATTEMPT_PATH),
            "9bcf5eec76211f11113172b08a1133a67a9824d77874212d6a57c0254dce669c",
        )
        self.assertEqual(ATTEMPT["outcome"]["status"], "ambiguous")
        self.assertEqual(
            ATTEMPT["outcome"]["fixedCode"],
            "g037_session_pooler_control_map_async_completion_ambiguous",
        )
        self.assertIs(ATTEMPT["browserExecution"]["openTabCallIssued"], True)
        self.assertIs(ATTEMPT["browserExecution"]["openCompletionObserved"], False)
        self.assertEqual(
            ATTEMPT["browserExecution"]["controlSnapshotCompletionCountObserved"], 0
        )
        self.assertEqual(
            ATTEMPT["browserExecution"]["controlClickCompletionCountObserved"], 0
        )
        self.assertIs(
            ATTEMPT["browserExecution"]["additionalBrowserCommandIssuedAfterAmbiguity"],
            False,
        )
        self.assertTrue(all(value is False for value in ATTEMPT["safetyReadback"].values()))
        self.assertIs(ATTEMPT["retryGate"]["controlMapRetryAllowed"], False)

    def test_v2_browser_source_is_exact_single_line_and_top_level_awaited(self) -> None:
        self.assertEqual(
            sha256(BROWSER_SOURCE_PATH),
            "a07dd10e07c0cd0a1db050230206b6e5ebfd4402c172556d1a159b571e3044bc",
        )
        source = BROWSER_SOURCE_PATH.read_text(encoding="utf-8")
        self.assertEqual(source.count("\n"), 1)
        self.assertIn("await openTab(g037v2TargetUrl)", source)
        self.assertIn("await snapshot(g037v2Page", source)
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

    def test_v2_request_binds_spent_attempt_and_exact_source(self) -> None:
        self.assertEqual(
            sha256(REQUEST_PATH),
            "e74e85936b4d44776ffacf878a65604c03e91ac03b91f4416090ed5efecd0a08",
        )
        continuity = REQUEST["continuity"]
        for prefix in (
            "priorRequest",
            "spentAuthorization",
            "consumption",
            "ambiguousAttempt",
        ):
            self.assertEqual(
                continuity[f"{prefix}Sha256"],
                sha256(ROOT / continuity[f"{prefix}Path"]),
            )
        reviewed = REQUEST["reviewedBrowserSource"]
        self.assertEqual(reviewed["sha256"], sha256(ROOT / reviewed["path"]))
        self.assertIs(reviewed["topLevelAwaitUsed"], True)
        self.assertIs(reviewed["asyncIifeUsed"], False)
        self.assertIs(REQUEST["localTransportPreflight"]["browserOpened"], False)
        self.assertIs(
            REQUEST["localTransportPreflight"]["topLevelAwaitCompletionObserved"],
            True,
        )
        self.assertIs(REQUEST["authorizationGate"]["controlMapReadAuthorized"], False)

    def test_v2_contract_and_verifier_are_exact_offline_and_fail_closed(self) -> None:
        self.assertEqual(
            sha256(CONTRACT_PATH),
            "15150608fcb788f847b8053f6fe61522717759206b6c5e405093bf81635bea1c",
        )
        self.assertEqual(
            sha256(VERIFIER_PATH),
            "7b6be03f1ac15ee93f5b10ddf33d070382e5eb9939f7bab30857f71ce8a631eb",
        )
        self.assertEqual(CONTRACT["verifier"]["sha256"], sha256(VERIFIER_PATH))
        self.assertEqual(VERIFIER.REQUEST_SHA256, sha256(REQUEST_PATH))
        self.assertEqual(VERIFIER.BROWSER_SOURCE_SHA256, sha256(BROWSER_SOURCE_PATH))
        self.assertEqual(VERIFIER.PRIOR_ATTEMPT_SHA256, sha256(ATTEMPT_PATH))
        validation = subprocess.run(
            [os.fspath(Path(os.sys.executable)), os.fspath(VERIFIER_PATH), "validate"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(validation.returncode, 0, validation.stderr)
        self.assertEqual(
            json.loads(validation.stdout)["fixedCode"],
            "g037_session_pooler_control_map_v2_source_valid",
        )

    def test_v2_valid_receipt_is_accepted_and_drift_is_denied(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "receipt.json"
            path.write_bytes(VERIFIER.canonical_bytes(valid_receipt()))
            path.chmod(0o600)
            expected = sha256(path)
            verified = subprocess.run(
                [
                    os.fspath(Path(os.sys.executable)),
                    os.fspath(VERIFIER_PATH),
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
            output["fixedCode"], "g037_session_pooler_control_map_v2_receipt_ready"
        )
        self.assertEqual(output["receiptSha256"], expected)
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

    def test_v2_authorization_request_binds_all_sources_but_grants_nothing(self) -> None:
        self.assertEqual(
            sha256(AUTHORIZATION_REQUEST_PATH),
            "d4259300e49459be899c4c35a06818e45cee814b02af6b0008a5dd234e3da900",
        )
        for descriptor in AUTHORIZATION_REQUEST["reviewedArtifacts"].values():
            self.assertEqual(descriptor["sha256"], sha256(ROOT / descriptor["path"]))
        statement = AUTHORIZATION_REQUEST["requestedExactStatement"]
        for digest in (
            sha256(REQUEST_PATH),
            sha256(BROWSER_SOURCE_PATH),
            sha256(CONTRACT_PATH),
            sha256(VERIFIER_PATH),
        ):
            self.assertIn(digest, statement)
        gate = AUTHORIZATION_REQUEST["authorizationGate"]
        self.assertIs(gate["exactStatementReceived"], False)
        self.assertIs(gate["executionAuthorizationPresent"], False)
        self.assertEqual(gate["approvedExecutionCount"], 0)

    def test_v2_authorization_is_spent_before_one_denied_attempt(self) -> None:
        self.assertEqual(
            sha256(V2_AUTHORIZATION_PATH),
            "62b222c88728c0b993359dd472e36aa7fcfa715bceaac3dd6e1675f76c09e069",
        )
        self.assertEqual(
            sha256(V2_CONSUMPTION_PATH),
            "27cbf11111867f223acfd92fb72675c4f105dffebb64a1d115ac68fdb8c7659f",
        )
        self.assertEqual(
            sha256(V2_ATTEMPT_PATH),
            "f624f78125c1c3938053569fa27e2d547aa3796f17d621f7707f8eb47580aad5",
        )
        self.assertEqual(V2_AUTHORIZATION["approverDisplayName"], "최연우")
        self.assertEqual(V2_CONSUMPTION["operationId"], V2_ATTEMPT["operationId"])
        self.assertLess(
            V2_CONSUMPTION["consumedAt"], V2_ATTEMPT["attemptRecordedAt"]
        )
        self.assertEqual(V2_CONSUMPTION["authorization"]["consumedExecutionCount"], 1)
        self.assertEqual(V2_CONSUMPTION["authorization"]["remainingExecutionCount"], 0)
        self.assertIs(V2_CONSUMPTION["authorization"]["reusable"], False)
        self.assertEqual(V2_ATTEMPT["outcome"]["status"], "denied")
        self.assertEqual(V2_ATTEMPT["browserExecution"]["dashboardOpenCountObserved"], 1)
        self.assertEqual(V2_ATTEMPT["browserExecution"]["controlSnapshotCountObserved"], 0)
        self.assertEqual(V2_ATTEMPT["browserExecution"]["controlClickCountObserved"], 0)
        self.assertIs(V2_ATTEMPT["outcome"]["metadataValueRead"], False)
        self.assertIs(
            V2_ATTEMPT["safetyReadback"]["persistentProviderStateChanged"], False
        )
        self.assertIs(V2_ATTEMPT["retryGate"]["controlMapRetryAllowed"], False)

    def test_central_gates_record_v1_spent_and_v2_denied(self) -> None:
        for gate in CENTRAL_GATES:
            self.assertEqual(
                gate["sessionPoolerControlMapAttemptSha256"], sha256(ATTEMPT_PATH)
            )
            self.assertIs(gate["sessionPoolerControlMapRetryAllowed"], False)
            self.assertEqual(
                gate["sessionPoolerControlMapV2RequestSha256"], sha256(REQUEST_PATH)
            )
            self.assertIs(gate["sessionPoolerControlMapV2RequestBlocked"], True)
            self.assertEqual(
                gate["sessionPoolerControlMapV2BrowserSourceSha256"],
                sha256(BROWSER_SOURCE_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerControlMapV2ReceiptContractSha256"],
                sha256(CONTRACT_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerControlMapV2ReceiptVerifierSha256"],
                sha256(VERIFIER_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerControlMapV2AuthorizationRequestSha256"],
                sha256(AUTHORIZATION_REQUEST_PATH),
            )
            self.assertIs(gate["sessionPoolerControlMapV2ApprovalStatementReceived"], True)
            self.assertIs(gate["sessionPoolerControlMapV2AuthorizationPresent"], True)
            self.assertEqual(
                gate["sessionPoolerControlMapV2AuthorizationSha256"],
                sha256(V2_AUTHORIZATION_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerControlMapV2ConsumptionSha256"],
                sha256(V2_CONSUMPTION_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerControlMapV2AttemptSha256"],
                sha256(V2_ATTEMPT_PATH),
            )
            self.assertEqual(gate["sessionPoolerControlMapV2ConsumedExecutionCount"], 1)
            self.assertEqual(gate["sessionPoolerControlMapV2RemainingExecutionCount"], 0)
            self.assertIs(gate["sessionPoolerControlMapV2RetryAllowed"], False)
            self.assertIs(gate["sessionPoolerControlMapV2ReceiptPresent"], False)
            self.assertIs(gate["sessionPoolerSelected"], False)

    def test_tasks_docs_and_workflow_record_attempt_and_v2_preparation(self) -> None:
        for task_id in (*range(535, 541), *range(542, 555), 556):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x] 7.555 ", TASKS)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            for path in (
                AUTHORIZATION_PATH,
                CONSUMPTION_PATH,
                ATTEMPT_PATH,
                BROWSER_SOURCE_PATH,
                REQUEST_PATH,
                CONTRACT_PATH,
                VERIFIER_PATH,
                AUTHORIZATION_REQUEST_PATH,
                V2_AUTHORIZATION_PATH,
                V2_CONSUMPTION_PATH,
                V2_ATTEMPT_PATH,
            ):
                self.assertIn(sha256(path), normalized)
        for path in (
            AUTHORIZATION_PATH,
            CONSUMPTION_PATH,
            ATTEMPT_PATH,
            BROWSER_SOURCE_PATH,
            REQUEST_PATH,
            CONTRACT_PATH,
            VERIFIER_PATH,
            AUTHORIZATION_REQUEST_PATH,
            V2_AUTHORIZATION_PATH,
            V2_CONSUMPTION_PATH,
            V2_ATTEMPT_PATH,
        ):
            relative = path.relative_to(ROOT).as_posix()
            self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_control_map_v2_source",
            SECURITY_WORKFLOW,
        )

    def test_new_sources_contain_no_database_connection_or_secret_material(self) -> None:
        for path in (
            AUTHORIZATION_PATH,
            CONSUMPTION_PATH,
            ATTEMPT_PATH,
            BROWSER_SOURCE_PATH,
            REQUEST_PATH,
            CONTRACT_PATH,
            VERIFIER_PATH,
            AUTHORIZATION_REQUEST_PATH,
            V2_AUTHORIZATION_PATH,
            V2_CONSUMPTION_PATH,
            V2_ATTEMPT_PATH,
        ):
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
