"""Source contracts for the G037 credential-custody review approval."""

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
APPROVAL_PATH = (
    ROOT / "backend/supabase/g037-readonly-credential-custody-preview-approval.v1.json"
)
APPROVAL = json.loads(APPROVAL_PATH.read_text(encoding="utf-8"))
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


class G037ReadonlyCredentialCustodyApprovalSourceTests(unittest.TestCase):
    def test_approval_is_exact_named_owner_review_evidence(self) -> None:
        self.assertEqual(
            sha256(APPROVAL_PATH),
            "46eea3b0f168775771f11b7909b8174fc8b3450ceb0fe23869ed28c2b744e3a8",
        )
        self.assertEqual(APPROVAL["schemaVersion"], 1)
        self.assertEqual(
            APPROVAL["kind"], "g037_readonly_credential_custody_preview_approval"
        )
        self.assertEqual(APPROVAL["approverDisplayName"], "최연우")
        self.assertIn("already-presented exact preview", APPROVAL["approvalEvidenceBoundary"])

    def test_approval_binds_every_reviewed_artifact_and_network_attempt(self) -> None:
        for descriptor in APPROVAL["approvedArtifacts"]:
            self.assertEqual(descriptor["sha256"], sha256(ROOT / descriptor["path"]))
        network = APPROVAL["networkContinuity"]
        self.assertEqual(
            network["attemptSha256"], sha256(ROOT / network["attemptPath"])
        )
        self.assertEqual(network["fixedCode"], "g037_direct_endpoint_tcp_unreachable")
        self.assertIs(network["directEndpointReachabilityProved"], False)
        self.assertIs(network["reachabilityRequirementWaived"], False)
        self.assertIs(network["poolerFallbackApproved"], False)
        self.assertIs(network["ipv4AddonChangeApproved"], False)

    def test_broad_statement_does_not_preapprove_unseen_execution(self) -> None:
        interpretation = APPROVAL["standingApprovalInterpretation"]
        self.assertEqual(
            interpretation,
            {
                "currentPresentedPreviewApproved": True,
                "unseenFutureArtifactPreapproved": False,
                "futureHashBoundExecutionAutomaticallyAuthorized": False,
                "freshPreviewConfirmApplyOrderingPreserved": True,
            },
        )
        scope = APPROVAL["approvedScope"]
        for allowed in (
            "credentialCustodyCeremonyReview",
            "connectionReadbackSqlReview",
            "documentationAndTransportGateReview",
        ):
            self.assertIs(scope[allowed], True)
        for denied in set(scope) - {
            "credentialCustodyCeremonyReview",
            "connectionReadbackSqlReview",
            "documentationAndTransportGateReview",
        }:
            self.assertIs(scope[denied], False)

    def test_machine_gates_record_review_only(self) -> None:
        relative = APPROVAL_PATH.relative_to(ROOT).as_posix()
        approval_sha = sha256(APPROVAL_PATH)
        for gate in (CONTRACT["provisioningGate"], DECISION["controllerGate"]):
            self.assertIs(gate["credentialCustodyPreviewApproved"], True)
            self.assertEqual(gate["credentialCustodyPreviewApprovalPath"], relative)
            self.assertEqual(gate["credentialCustodyPreviewApprovalSha256"], approval_sha)
            self.assertIs(gate["directEndpointReachabilityProved"], False)
            self.assertIs(gate["passwordConfigurationAuthorizationPresent"], False)
            self.assertIs(
                gate["repositorySecretMutationAuthorizationPresent"], False
            )

    def test_tasks_docs_and_security_workflow_track_review_approval(self) -> None:
        self.assertIn("- [x]! 7.386 ", TASKS)
        for task_id in range(410, 415):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        approval_sha = sha256(APPROVAL_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(approval_sha, normalized)
            self.assertIn("unseen future", normalized)
        relative = APPROVAL_PATH.relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_credential_custody_approval_source",
            SECURITY_WORKFLOW,
        )

    def test_approval_contains_no_connection_or_credential_material(self) -> None:
        raw = APPROVAL_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "postgres://",
            "postgresql://",
            "db.aqlcofblfxdrjhhdmarw",
            "access_token",
            "refresh_token",
            "service_role_key",
            "database_password",
            "pooler.",
            "-----begin",
        ):
            self.assertNotIn(forbidden, raw)


if __name__ == "__main__":
    unittest.main()
