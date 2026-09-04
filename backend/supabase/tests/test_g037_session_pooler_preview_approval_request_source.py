"""Source contract for the exact G037 pooler-preview review request."""

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
    ROOT
    / "backend/supabase/g037-session-pooler-alternative-preview-approval-request.v1.json"
)
REQUEST = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
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


class G037SessionPoolerPreviewApprovalRequestSourceTests(unittest.TestCase):
    def test_request_is_exact_and_awaiting_named_owner(self) -> None:
        self.assertEqual(
            sha256(REQUEST_PATH),
            "2fbe7bbb5bd8b461c12d7d7cf723e8be9c040bc8eb90a6c321fb3ac8422c5804",
        )
        self.assertEqual(REQUEST["schemaVersion"], 1)
        self.assertEqual(
            REQUEST["kind"],
            "g037_session_pooler_alternative_preview_approval_request",
        )
        self.assertEqual(
            REQUEST["requestStatus"], "awaiting_exact_named_owner_review_approval"
        )
        self.assertEqual(REQUEST["requestedApproverDisplayName"], "최연우")

    def test_request_binds_only_the_exact_preview(self) -> None:
        target = REQUEST["reviewTarget"]
        self.assertEqual(target["sha256"], sha256(ROOT / target["path"]))
        self.assertEqual(target["kind"], "g037_session_pooler_alternative_preview")
        self.assertIs(target["reviewOnly"], True)
        self.assertEqual(
            REQUEST["requestedExactStatement"],
            "최연우, G037 session-pooler alternative preview v1 "
            "cdf4bd8f9c05eb2fd789228cdfffa563cf8b5dbf7e68f940b1c9689db8d8214e "
            "검토 승인",
        )

    def test_standing_or_unqualified_approval_is_not_substituted(self) -> None:
        rules = REQUEST["statementRules"]
        for required in (
            "exactDisplayNameRequired",
            "exactVersionRequired",
            "exactSha256Required",
        ):
            self.assertIs(rules[required], True)
        for denied in (
            "unqualifiedAffirmationAccepted",
            "priorStandingApprovalApplied",
            "futureArtifactApprovalInferred",
            "executionAuthorizationInferred",
        ):
            self.assertIs(rules[denied], False)

    def test_successor_sources_are_bound_but_not_approved(self) -> None:
        self.assertEqual(len(REQUEST["preparedButUnapprovedSuccessors"]), 3)
        for successor in REQUEST["preparedButUnapprovedSuccessors"]:
            self.assertEqual(successor["sha256"], sha256(ROOT / successor["path"]))
            self.assertIs(successor["approvedByThisRequest"], False)
        denied = REQUEST["approvalWouldNotEstablish"]
        self.assertTrue(all(denied.values()))

    def test_request_gate_records_no_approval_or_external_authority(self) -> None:
        gate = REQUEST["requestGate"]
        self.assertTrue(all(value is False for value in gate.values()))
        for central in CENTRAL_GATES:
            self.assertIs(
                central["sessionPoolerAlternativePreviewApprovalRequestPresent"], True
            )
            self.assertEqual(
                central["sessionPoolerAlternativePreviewApprovalRequestPath"],
                REQUEST_PATH.relative_to(ROOT).as_posix(),
            )
            self.assertEqual(
                central["sessionPoolerAlternativePreviewApprovalRequestSha256"],
                sha256(REQUEST_PATH),
            )
            self.assertIs(
                central["sessionPoolerAlternativePreviewApprovalStatementReceived"],
                True,
            )
            self.assertIs(central["sessionPoolerAlternativePreviewApproved"], True)
            self.assertIs(central["sessionPoolerMetadataReadAuthorizationPresent"], True)
            self.assertEqual(central["sessionPoolerMetadataReadConsumedCount"], 1)
            self.assertIs(central["sessionPoolerMetadataReadRetryAllowed"], False)

    def test_tasks_docs_and_security_workflow_track_request(self) -> None:
        for task_id in range(478, 488):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        request_sha = sha256(REQUEST_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(request_sha, normalized)
            self.assertIn(REQUEST["requestedExactStatement"], normalized)
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_preview_approval_request_source",
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
