"""Source contract for the exact G037 session-pooler preview approval."""

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
    ROOT / "backend/supabase/g037-session-pooler-alternative-preview-approval.v1.json"
)
APPROVAL = json.loads(APPROVAL_PATH.read_text(encoding="utf-8"))
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


class G037SessionPoolerPreviewApprovalSourceTests(unittest.TestCase):
    def test_approval_is_exact_and_named(self) -> None:
        self.assertEqual(
            sha256(APPROVAL_PATH),
            "50d9c3b69fe5ecd2024378c67141a7f41081434ecaec3a7ed1da0783b3ef9279",
        )
        self.assertEqual(APPROVAL["schemaVersion"], 1)
        self.assertEqual(
            APPROVAL["kind"], "g037_session_pooler_alternative_preview_approval"
        )
        self.assertEqual(APPROVAL["approverDisplayName"], "최연우")
        self.assertEqual(
            APPROVAL["approvalStatement"],
            "최연우, G037 session-pooler alternative preview v1 "
            "cdf4bd8f9c05eb2fd789228cdfffa563cf8b5dbf7e68f940b1c9689db8d8214e "
            "검토 승인",
        )

    def test_target_request_and_contract_are_exact(self) -> None:
        for key in ("approvedTarget", "boundApprovalRequest", "boundApprovalContract"):
            item = APPROVAL[key]
            self.assertEqual(item["sha256"], sha256(ROOT / item["path"]))
        self.assertIs(APPROVAL["approvedTarget"]["reviewOnly"], True)
        self.assertIs(APPROVAL["boundApprovalRequest"]["exactStatementMatched"], True)
        self.assertIs(
            APPROVAL["boundApprovalContract"]["evidenceRequirementsMatched"], True
        )

    def test_evidence_is_current_exact_and_not_inferred(self) -> None:
        evidence = APPROVAL["evidenceAssessment"]
        for required in (
            "currentTaskUserMessage",
            "messagePostdatesPreview",
            "messagePostdatesApprovalRequest",
            "approverDisplayNameMatched",
            "targetVersionMatched",
            "targetSha256Matched",
        ):
            self.assertIs(evidence[required], True)
        for denied in (
            "priorStandingApprovalUsed",
            "assistantOrGeneratedEvidenceUsed",
            "inferredIdentityUsed",
        ):
            self.assertIs(evidence[denied], False)

    def test_scope_is_review_only_and_successors_remain_unapproved(self) -> None:
        scope = APPROVAL["approvedScope"]
        self.assertIs(scope["alternativeDesignReview"], True)
        self.assertIs(scope["officialDocumentationInterpretationReview"], True)
        self.assertIs(scope["metadataRequestMayBePresentedNext"], True)
        for key, value in scope.items():
            if key not in {
                "alternativeDesignReview",
                "officialDocumentationInterpretationReview",
                "metadataRequestMayBePresentedNext",
            }:
                self.assertIs(value, False, key)
        successor = APPROVAL["successorBoundary"]
        for prefix in ("metadataRequest", "metadataReceiptContract"):
            self.assertEqual(
                successor[f"{prefix}Sha256"],
                sha256(ROOT / successor[f"{prefix}Path"]),
            )
        self.assertIs(successor["successorReviewApproved"], False)
        self.assertIs(successor["metadataReadAuthorized"], False)
        for key, value in successor.items():
            if key.endswith("ExecutionCountApproved"):
                self.assertEqual(value, 0, key)

    def test_approval_gate_has_no_external_authority(self) -> None:
        gate = APPROVAL["approvalGate"]
        self.assertIs(gate["reviewApproved"], True)
        self.assertIs(gate["metadataRequestMayBePresented"], True)
        for key, value in gate.items():
            if key not in {"reviewApproved", "metadataRequestMayBePresented"}:
                self.assertIs(value, False, key)

    def test_central_gates_preserve_preview_approval_after_spent_read_denial(self) -> None:
        relative = APPROVAL_PATH.relative_to(ROOT).as_posix()
        for gate in CENTRAL_GATES:
            self.assertIs(gate["sessionPoolerAlternativePreviewApproved"], True)
            self.assertIs(
                gate["sessionPoolerAlternativePreviewApprovalStatementReceived"], True
            )
            self.assertIs(
                gate["sessionPoolerAlternativePreviewApprovalArtifactPresent"], True
            )
            self.assertEqual(
                gate["sessionPoolerAlternativePreviewApprovalArtifactPath"], relative
            )
            self.assertEqual(
                gate["sessionPoolerAlternativePreviewApprovalArtifactSha256"],
                sha256(APPROVAL_PATH),
            )
            self.assertIs(gate["sessionPoolerMetadataReadbackRequestPresentable"], True)
            self.assertEqual(
                gate["sessionPoolerMetadataReadbackRequestBlocker"],
                "fresh_metadata_read_request_and_named_owner_authorization_required_after_scope_boundary_violation",
            )
            self.assertIs(gate["sessionPoolerSelected"], False)
            self.assertIs(gate["sessionPoolerMetadataReadAuthorizationPresent"], True)
            self.assertEqual(gate["sessionPoolerMetadataReadApprovedCount"], 1)
            self.assertEqual(gate["sessionPoolerMetadataReadConsumedCount"], 1)
            self.assertIs(gate["sessionPoolerMetadataReadRetryAllowed"], False)
            self.assertIs(gate["sessionPoolerMetadataReceiptPresent"], False)
            self.assertIs(gate["repositorySecretMutationAuthorizationPresent"], False)

    def test_tasks_docs_and_security_workflow_track_approval(self) -> None:
        self.assertIn("- [x] 7.448 ", TASKS)
        for task_id in range(500, 513):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        approval_sha = sha256(APPROVAL_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(approval_sha, normalized)
            self.assertIn(APPROVAL["approvalStatement"], normalized)
        relative = APPROVAL_PATH.relative_to(ROOT).as_posix()
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_preview_approval_source",
            SECURITY_WORKFLOW,
        )

    def test_approval_contains_no_connection_or_credential_material(self) -> None:
        raw = APPROVAL_PATH.read_text(encoding="utf-8").lower()
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
