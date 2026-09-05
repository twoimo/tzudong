"""Source contract for the blocked G037 session-pooler metadata request."""

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
REQUEST_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-metadata-readback-request.v1.json"
)
REQUEST = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
CONTRACT = json.loads(
    (ROOT / "backend/supabase/g037-readonly-credential-contract.v1.json").read_text(
        encoding="utf-8"
    )
)
DECISION = json.loads(
    (ROOT / "backend/supabase/hosted-db-access-decision.v1.json").read_text(
        encoding="utf-8"
    )
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class G037SessionPoolerMetadataRequestSourceTests(unittest.TestCase):
    def test_request_is_exact_blocked_and_non_authorizing(self) -> None:
        self.assertEqual(
            sha256(REQUEST_PATH),
            "f8101542b4f10bc8acaeb1bd657f7d5c0c1add9fbf30ccd456523255db9bcc22",
        )
        self.assertEqual(REQUEST["schemaVersion"], 1)
        self.assertEqual(
            REQUEST["kind"], "g037_session_pooler_metadata_readback_request"
        )
        self.assertEqual(
            REQUEST["requestStatus"],
            "blocked_exact_alternative_preview_approval_required",
        )
        self.assertIs(REQUEST["continuity"]["alternativePreviewApproved"], False)
        self.assertIs(REQUEST["authorizationGate"]["metadataReadAuthorized"], False)

    def test_request_binds_preview_and_preserves_direct_path(self) -> None:
        continuity = REQUEST["continuity"]
        for prefix in ("alternativePreview", "directHostEvidenceRequest"):
            self.assertEqual(
                continuity[f"{prefix}Sha256"],
                sha256(ROOT / continuity[f"{prefix}Path"]),
            )
        self.assertIs(continuity["directPathStillAvailable"], True)
        self.assertIs(continuity["directPathAbandoned"], False)
        self.assertIs(continuity["ipv4AddonUpgradeDeferred"], True)

    def test_requested_read_is_one_metadata_only_dashboard_inspection(self) -> None:
        requested = REQUEST["requestedRead"]
        self.assertEqual(requested["providerSurface"], "supabase_dashboard_connect_dialog")
        self.assertIs(requested["productionProjectOnly"], True)
        self.assertEqual(requested["connectionMethod"], "Session pooler")
        self.assertEqual(requested["maximumReadCount"], 1)
        for denied in (
            "persistentMutation",
            "databaseAuthentication",
            "sqlExecution",
            "networkProbe",
            "credentialRequiredOrRead",
            "clipboardCopyRequired",
            "screenshotRequired",
            "rawConnectionStringRequired",
        ):
            self.assertIs(requested[denied], False)

    def test_fixed_checks_exclude_transaction_mode_and_credentials(self) -> None:
        checks = REQUEST["expectedFixedChecks"]
        self.assertIs(checks["methodIsSharedSessionPooler"], True)
        self.assertIs(checks["portEquals5432"], True)
        self.assertIs(checks["port6543Absent"], True)
        self.assertIs(checks["databaseNameEqualsPostgres"], True)
        self.assertIs(checks["hostnameIsSingleLabelUnderPoolerSupabaseCom"], True)
        self.assertIs(checks["usernameSuffixEqualsDotProjectReference"], True)
        self.assertIs(checks["passwordIsOnlyAPlaceholder"], True)
        forbidden = REQUEST["forbiddenObservation"]
        self.assertTrue(all(forbidden.values()))

    def test_receipt_is_hash_and_boolean_only(self) -> None:
        boundary = REQUEST["sanitizedReadbackBoundary"]
        self.assertIs(boundary["exactHostnameInReceiptAllowed"], False)
        self.assertIs(boundary["exactUsernameInReceiptAllowed"], False)
        self.assertIn("hostname SHA-256", boundary["allowedReceiptFields"])
        self.assertIn("username-shape SHA-256", boundary["allowedReceiptFields"])
        self.assertIn("exact hostname or username", boundary["forbiddenReceiptFields"])
        self.assertIn("connection string or DSN", boundary["forbiddenReceiptFields"])

    def test_failure_never_escalates_or_retries(self) -> None:
        failure = REQUEST["failureDiscipline"]
        for required in (
            "previewApprovalRequiredBeforeRead",
            "exactProjectMismatchBlocksRead",
            "sessionMethodUnavailableBlocksAlternative",
            "missingOrAmbiguousFieldBlocksProbeConstruction",
            "unexpectedCredentialDisplayStopsInspection",
            "rawDsnExposureMustNotBeRetained",
            "failureDoesNotAuthorizeRetry",
            "failureDoesNotAuthorizeDirectPathRetry",
            "failureDoesNotAuthorizeIpv4AddonChange",
            "failureDoesNotAuthorizePasswordOrSecretWork",
        ):
            self.assertIs(failure[required], True)

    def test_machine_gates_register_consumed_denial_while_request_stays_immutable(self) -> None:
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        request_sha = sha256(REQUEST_PATH)
        for gate in (CONTRACT["provisioningGate"], DECISION["controllerGate"]):
            self.assertIs(gate["sessionPoolerMetadataReadbackRequestPresent"], True)
            self.assertEqual(gate["sessionPoolerMetadataReadbackRequestPath"], relative)
            self.assertEqual(gate["sessionPoolerMetadataReadbackRequestSha256"], request_sha)
            self.assertIs(gate["sessionPoolerMetadataReadbackRequestBlocked"], True)
            self.assertIs(gate["sessionPoolerMetadataReadAuthorizationPresent"], True)
            self.assertEqual(gate["sessionPoolerMetadataReadApprovedCount"], 1)
            self.assertEqual(gate["sessionPoolerMetadataReadConsumedCount"], 1)
            self.assertIs(gate["sessionPoolerMetadataReadRetryAllowed"], False)
            self.assertIs(gate["sessionPoolerMetadataReceiptPresent"], False)
            self.assertIs(gate["sessionPoolerAlternativePreviewApproved"], True)
            self.assertIs(gate["sessionPoolerSelected"], False)

    def test_tasks_docs_and_security_workflow_track_request(self) -> None:
        for task_id in range(452, 464):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        request_sha = sha256(REQUEST_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(request_sha, normalized)
            self.assertIn("metadata-only Dashboard Connect", normalized)
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_metadata_request_source",
            SECURITY_WORKFLOW,
        )

    def test_request_contains_no_connection_or_credential_material(self) -> None:
        raw = REQUEST_PATH.read_text(encoding="utf-8").lower()
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
