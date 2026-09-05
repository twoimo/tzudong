"""Source contracts for the consumed G037 pooler-metadata read attempt."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
DESIGN = (SPEC / "design.md").read_text(encoding="utf-8")
RUNBOOK = (ROOT / "backend/supabase/docs/g037-hosted-closure-runbook.md").read_text(
    encoding="utf-8"
)
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
AUTHORIZATION_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-metadata-readback-authorization.v1.json"
)
CONSUMPTION_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-metadata-readback-consumption.v1.json"
)
ATTEMPT_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-metadata-readback-attempt.v1.json"
)
AUTHORIZATION = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
CONSUMPTION = json.loads(CONSUMPTION_PATH.read_text(encoding="utf-8"))
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
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


class G037SessionPoolerMetadataAttemptSourceTests(unittest.TestCase):
    def test_exact_named_owner_authorization_is_one_time_and_narrow(self) -> None:
        self.assertEqual(
            sha256(AUTHORIZATION_PATH),
            "240b24087110c8e88c7859f3370f3fba21aa1bf6af4032410fefc99a7226a54f",
        )
        self.assertEqual(AUTHORIZATION["schemaVersion"], 1)
        self.assertEqual(
            AUTHORIZATION["kind"],
            "g037_session_pooler_metadata_readback_authorization",
        )
        self.assertEqual(AUTHORIZATION["approverDisplayName"], "최연우")
        self.assertEqual(
            AUTHORIZATION["authorizationStatement"],
            "최연우, production aqlcofblfxdrjhhdmarw G037 session-pooler "
            "metadata-only Dashboard Connect readback request "
            "f8101542b4f10bc8acaeb1bd657f7d5c0c1add9fbf30ccd456523255db9bcc22에 "
            "따라 1회 읽기 실행 승인",
        )
        self.assertEqual(AUTHORIZATION["approvedTarget"]["maximumReadCount"], 1)
        self.assertIs(
            AUTHORIZATION["authorizedScope"]["oneMetadataOnlyDashboardConnectRead"],
            True,
        )
        self.assertIs(AUTHORIZATION["authorizedScope"]["networkProbe"], False)
        self.assertIs(AUTHORIZATION["authorizedScope"]["sqlExecution"], False)

    def test_authorization_binds_every_immutable_source(self) -> None:
        for descriptor in (
            AUTHORIZATION["approvedTarget"],
            AUTHORIZATION["boundPreviewApproval"],
            AUTHORIZATION["boundReceiptContract"],
        ):
            self.assertEqual(descriptor["sha256"], sha256(ROOT / descriptor["path"]))
        verifier = AUTHORIZATION["boundReceiptContract"]
        self.assertEqual(
            verifier["verifierSha256"], sha256(ROOT / verifier["verifierPath"])
        )

    def test_consumption_is_exact_terminal_and_non_reusable(self) -> None:
        self.assertEqual(
            sha256(CONSUMPTION_PATH),
            "d203751ccd74cbb14297a56139f71de412b2ef5eff11876e32176f98bb6664e5",
        )
        self.assertEqual(CONSUMPTION["operationId"], ATTEMPT["operationId"])
        authorization = CONSUMPTION["authorization"]
        self.assertEqual(authorization["sha256"], sha256(AUTHORIZATION_PATH))
        self.assertEqual(authorization["approvedReadCount"], 1)
        self.assertEqual(authorization["consumedReadCount"], 1)
        self.assertEqual(authorization["remainingReadCount"], 0)
        self.assertIs(authorization["reusable"], False)
        self.assertIs(
            CONSUMPTION["consumptionEvent"]["consumptionArtifactRecordedBeforeRead"],
            False,
        )
        self.assertIs(CONSUMPTION["executionBoundary"]["externalRetryAllowed"], False)

    def test_attempt_fails_closed_on_observation_scope_violation(self) -> None:
        self.assertEqual(
            sha256(ATTEMPT_PATH),
            "6e5915d6d4f2e96f4aa07ade8e10277b6daab382370dec8c85649f797c1d036b",
        )
        self.assertEqual(ATTEMPT["outcome"]["status"], "denied")
        self.assertEqual(
            ATTEMPT["outcome"]["fixedCode"],
            "g037_session_pooler_metadata_scope_boundary_violated",
        )
        self.assertIs(ATTEMPT["outcome"]["successfulMetadataReadback"], False)
        self.assertIs(ATTEMPT["outcome"]["sanitizedReceiptCreated"], False)
        self.assertIs(
            ATTEMPT["outcome"]["unapprovedProjectOverviewFieldsObserved"], True
        )
        self.assertIs(
            ATTEMPT["browserAttempt"]["stoppedImmediatelyAfterBoundaryViolation"],
            True,
        )
        self.assertIs(ATTEMPT["retryGate"]["metadataReadRetryAllowed"], False)

    def test_attempt_records_all_sensitive_and_external_actions_as_absent(self) -> None:
        safety = ATTEMPT["safetyReadback"]
        self.assertTrue(all(value is False for value in safety.values()))
        self.assertIs(ATTEMPT["browserAttempt"]["imageOrScreenshotUsed"], False)
        self.assertIs(ATTEMPT["browserAttempt"]["sessionPoolerMethodSelected"], False)
        retry = ATTEMPT["retryGate"]
        for key in (
            "fixedProbeConstructionAuthorized",
            "fixedProbeExecutionAuthorized",
            "passwordOrSecretWorkAuthorized",
            "controllerOrWorkflowDispatchAuthorized",
        ):
            self.assertIs(retry[key], False)

    def test_central_gates_record_consumed_denial_without_receipt_or_selection(self) -> None:
        for gate in CENTRAL_GATES:
            self.assertIs(gate["sessionPoolerMetadataReadAuthorizationPresent"], True)
            self.assertEqual(
                gate["sessionPoolerMetadataReadAuthorizationSha256"],
                sha256(AUTHORIZATION_PATH),
            )
            self.assertEqual(gate["sessionPoolerMetadataReadApprovedCount"], 1)
            self.assertEqual(gate["sessionPoolerMetadataReadConsumedCount"], 1)
            self.assertIs(gate["sessionPoolerMetadataReadAuthorizationReusable"], False)
            self.assertEqual(
                gate["sessionPoolerMetadataReadConsumptionSha256"],
                sha256(CONSUMPTION_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerMetadataReadAttemptSha256"], sha256(ATTEMPT_PATH)
            )
            self.assertEqual(
                gate["sessionPoolerMetadataReadOutcomeCode"],
                "g037_session_pooler_metadata_scope_boundary_violated",
            )
            self.assertIs(gate["sessionPoolerMetadataReadRetryAllowed"], False)
            self.assertIs(gate["sessionPoolerMetadataReceiptPresent"], False)
            self.assertIs(gate["sessionPoolerMetadataReceiptVerified"], False)
            self.assertIs(gate["sessionPoolerSelected"], False)
            self.assertIs(gate["sessionPoolerExactMetadataPresent"], False)

    def test_tasks_docs_and_security_workflow_record_denial_without_overclaim(self) -> None:
        for task_id in range(513, 526):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(sha256(AUTHORIZATION_PATH), normalized)
            self.assertIn(sha256(CONSUMPTION_PATH), normalized)
            self.assertIn(sha256(ATTEMPT_PATH), normalized)
            self.assertIn(
                "g037_session_pooler_metadata_scope_boundary_violated", normalized
            )
        for path in (AUTHORIZATION_PATH, CONSUMPTION_PATH, ATTEMPT_PATH):
            relative = path.relative_to(ROOT).as_posix()
            self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_metadata_attempt_source",
            SECURITY_WORKFLOW,
        )

    def test_artifacts_contain_no_connection_or_credential_material(self) -> None:
        for path in (AUTHORIZATION_PATH, CONSUMPTION_PATH, ATTEMPT_PATH):
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
