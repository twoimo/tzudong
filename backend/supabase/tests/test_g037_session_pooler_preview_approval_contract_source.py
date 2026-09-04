"""Source contract for recording only a future exact pooler-preview approval."""

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
CONTRACT_PATH = (
    ROOT
    / "backend/supabase/g037-session-pooler-alternative-preview-approval-contract.v1.json"
)
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
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


class G037SessionPoolerPreviewApprovalContractSourceTests(unittest.TestCase):
    def test_contract_is_exact_and_awaiting_current_task_evidence(self) -> None:
        self.assertEqual(
            sha256(CONTRACT_PATH),
            "856d361821b28ae319eff627a40a57f5e32e4ba268b5978a220a8e22b9620566",
        )
        self.assertEqual(CONTRACT["schemaVersion"], 1)
        self.assertEqual(
            CONTRACT["kind"],
            "g037_session_pooler_alternative_preview_approval_contract",
        )
        self.assertEqual(
            CONTRACT["contractStatus"], "awaiting_current_task_exact_statement"
        )

    def test_target_request_and_successors_are_hash_bound(self) -> None:
        for item in (CONTRACT["approvalTarget"], CONTRACT["approvalRequest"]):
            self.assertEqual(item["sha256"], sha256(ROOT / item["path"]))
        successor = CONTRACT["successorBoundary"]
        for prefix in ("metadataRequest", "metadataReceiptContract"):
            self.assertEqual(
                successor[f"{prefix}Sha256"],
                sha256(ROOT / successor[f"{prefix}Path"]),
            )
        self.assertIs(successor["successorReviewApproved"], False)
        self.assertIs(successor["successorExecutionAuthorized"], False)

    def test_only_exact_current_task_user_statement_is_acceptable(self) -> None:
        evidence = CONTRACT["acceptableEvidence"]
        self.assertEqual(evidence["source"], "current_task_user_message")
        self.assertIs(evidence["exactStatementRequired"], True)
        self.assertIs(evidence["statementMustPostdatePreviewAndRequest"], True)
        self.assertEqual(evidence["approverDisplayName"], "최연우")
        self.assertEqual(evidence["targetVersion"], 1)
        self.assertEqual(evidence["targetSha256"], CONTRACT["approvalTarget"]["sha256"])
        for denied in (
            "priorMessageOrStandingIntentAccepted",
            "assistantMessageAcceptedAsApproval",
            "localFileOrGeneratedStatementAcceptedAsApproval",
            "inferredIdentityAccepted",
        ):
            self.assertIs(evidence[denied], False)

    def test_future_artifact_requirements_cannot_expand_review_scope(self) -> None:
        future = CONTRACT["futureApprovalArtifactRequirements"]
        self.assertIs(future["createOnlyAfterEvidence"], True)
        self.assertIs(future["mustBindApprovalTarget"], True)
        self.assertIs(future["mustBindApprovalRequest"], True)
        self.assertIs(future["mustRecordExactStatement"], True)
        self.assertIs(future["mustKeepSuccessorsUnapproved"], True)
        self.assertIs(future["mustKeepAllExecutionCountsZero"], True)
        scope = CONTRACT["reviewApprovalScope"]
        self.assertIs(scope["alternativeDesignReviewed"], True)
        self.assertIs(scope["documentationInterpretationReviewed"], True)
        self.assertIs(scope["metadataRequestMayBePresentedNext"], True)
        for key, value in scope.items():
            if key not in {
                "alternativeDesignReviewed",
                "documentationInterpretationReviewed",
                "metadataRequestMayBePresentedNext",
            }:
                self.assertIs(value, False, key)

    def test_historical_contract_has_no_evidence_but_central_gates_record_later_approval(self) -> None:
        self.assertTrue(all(value is False for value in CONTRACT["currentGate"].values()))
        relative = CONTRACT_PATH.relative_to(ROOT).as_posix()
        for gate in CENTRAL_GATES:
            self.assertIs(
                gate["sessionPoolerAlternativePreviewApprovalContractPresent"], True
            )
            self.assertEqual(
                gate["sessionPoolerAlternativePreviewApprovalContractPath"], relative
            )
            self.assertEqual(
                gate["sessionPoolerAlternativePreviewApprovalContractSha256"],
                sha256(CONTRACT_PATH),
            )
            self.assertIs(
                gate["sessionPoolerAlternativePreviewApprovalArtifactPresent"], True
            )
            self.assertIs(
                gate["sessionPoolerAlternativePreviewApprovalStatementReceived"],
                True,
            )
            self.assertIs(gate["sessionPoolerAlternativePreviewApproved"], True)
            self.assertIs(gate["sessionPoolerMetadataReadAuthorizationPresent"], True)
            self.assertEqual(gate["sessionPoolerMetadataReadConsumedCount"], 1)
            self.assertIs(gate["sessionPoolerMetadataReadRetryAllowed"], False)

    def test_tasks_docs_and_security_workflow_track_contract(self) -> None:
        for task_id in range(488, 500):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        contract_sha = sha256(CONTRACT_PATH)
        statement = CONTRACT["approvalRequest"]["requestedExactStatement"]
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(contract_sha, normalized)
            self.assertIn(statement, normalized)
        relative = CONTRACT_PATH.relative_to(ROOT).as_posix()
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_preview_approval_contract_source",
            SECURITY_WORKFLOW,
        )

    def test_contract_contains_no_connection_or_credential_material(self) -> None:
        raw = CONTRACT_PATH.read_text(encoding="utf-8").lower()
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
