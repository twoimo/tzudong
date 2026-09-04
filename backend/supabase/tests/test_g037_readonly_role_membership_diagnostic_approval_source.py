"""Source contracts for the review-only G037 membership diagnostic approval."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
APPROVAL_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-membership-diagnostic-approval.v2.json"
)
APPROVAL = json.loads(APPROVAL_PATH.read_text(encoding="utf-8"))
PREVIEW_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-membership-diagnostic-preview.v2.json"
)
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
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
G037_WORKFLOW = (ROOT / ".github/workflows/g037-hosted-closure.yml").read_text(
    encoding="utf-8"
)
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class G037ReadonlyRoleMembershipDiagnosticApprovalSourceTests(unittest.TestCase):
    def test_approval_identity_and_evidence_boundary_are_exact(self) -> None:
        self.assertEqual(APPROVAL["schemaVersion"], 2)
        self.assertEqual(
            APPROVAL["kind"], "g037_readonly_role_membership_diagnostic_approval"
        )
        self.assertEqual(APPROVAL["repository"], "twoimo/tzudong")
        self.assertEqual(APPROVAL["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(APPROVAL["databaseName"], "postgres")
        self.assertEqual(APPROVAL["approverDisplayName"], "최연우")
        self.assertEqual(APPROVAL["approvedAt"], "2026-09-04T07:53:19Z")
        self.assertIn("current task transcript", APPROVAL["approvalEvidenceBoundary"])
        self.assertIn("no external immutable receipt", APPROVAL["approvalEvidenceBoundary"])
        self.assertEqual(
            sha256(APPROVAL_PATH),
            "9631fab6ff13925b39aece61688c4e06df6c37e975121bcdb845ee0a9a49cef9",
        )

    def test_continuity_hashes_match_spent_diagnostic_evidence(self) -> None:
        continuity = APPROVAL["continuity"]
        for path_key, digest_key in (
            ("priorDiagnosticAttemptPath", "priorDiagnosticAttemptSha256"),
            ("spentDiagnosticAuthorizationPath", "spentDiagnosticAuthorizationSha256"),
        ):
            path = ROOT / continuity[path_key]
            self.assertEqual(continuity[digest_key], sha256(path))
        self.assertIs(continuity["priorDiagnosticAuthorizationReusable"], False)

    def test_each_approved_hash_matches_current_immutable_bytes(self) -> None:
        expected = {
            "backend/supabase/g037-readonly-role-membership-diagnostic-preview.v2.json": (
                "cdb21a3f3cfe6fe52cb37efbc3c40226a5425688321378ff3dbe6a41cf920394"
            ),
            "backend/supabase/scripts/g037_readonly_role_membership_diagnostic_v2.sql": (
                "29b7ef6084eb2732e65028dd1a0158a8cf5eec2ac60b3c081ddffd9d8461ad8a"
            ),
        }
        self.assertEqual(
            {item["path"]: item["sha256"] for item in APPROVAL["approvedArtifacts"]},
            expected,
        )
        for path, digest in expected.items():
            self.assertEqual(sha256(ROOT / path), digest)

    def test_scope_is_review_only_and_execution_remains_closed(self) -> None:
        self.assertEqual(
            APPROVAL["approvedScope"],
            {
                "rollbackOnlyMembershipDiagnosticPreviewReview": True,
                "fixedCodeMembershipDiagnosticSqlReview": True,
                "productionDiagnosticExecution": False,
                "persistentProvisioning": False,
                "passwordConfiguration": False,
                "repositorySecretMutation": False,
                "workflowDispatch": False,
            },
        )
        self.assertEqual(
            APPROVAL["executionGate"],
            {
                "status": (
                    "separate_one_time_membership_diagnostic_execution_authorization_required"
                ),
                "previewOwnerApproved": True,
                "diagnosticExecutionAuthorized": False,
                "diagnosticExecuted": False,
                "persistentHostedStateChanged": False,
            },
        )

    def test_immutable_preview_preserves_its_preapproval_gate(self) -> None:
        self.assertEqual(
            PREVIEW["approvalGate"],
            {
                "status": "membership_diagnostic_preview_owner_approval_required",
                "previewOwnerApproved": False,
                "diagnosticExecutionAuthorized": False,
                "diagnosticExecuted": False,
                "persistentHostedStateChanged": False,
            },
        )
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "cdb21a3f3cfe6fe52cb37efbc3c40226a5425688321378ff3dbe6a41cf920394",
        )

    def test_machine_gates_bind_approval_without_opening_execution(self) -> None:
        approval_relative = APPROVAL_PATH.relative_to(ROOT).as_posix()
        approval_sha = sha256(APPROVAL_PATH)
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertEqual(
            gate["rollbackOnlyMembershipDiagnosticApprovalPath"], approval_relative
        )
        self.assertEqual(
            gate["rollbackOnlyMembershipDiagnosticApprovalSha256"], approval_sha
        )
        self.assertIs(gate["rollbackOnlyMembershipDiagnosticPreviewApproved"], True)
        self.assertIs(gate["rollbackOnlyMembershipDiagnosticExecutionAuthorized"], False)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)
        self.assertIs(gate["controllerRetryAuthorized"], False)

        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertEqual(
            controller["rollbackOnlyMembershipDiagnosticApprovalPath"], approval_relative
        )
        self.assertEqual(
            controller["rollbackOnlyMembershipDiagnosticApprovalSha256"], approval_sha
        )
        self.assertIs(
            controller["rollbackOnlyMembershipDiagnosticPreviewApproved"], True
        )
        self.assertIs(
            controller["rollbackOnlyMembershipDiagnosticExecutionAuthorized"], False
        )
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)

    def test_tasks_close_review_but_leave_execution_open(self) -> None:
        self.assertIn("- [x]! 7.260 ", TASKS)
        self.assertIn("- [x]! 7.261 ", TASKS)
        self.assertIn("- [x] 7.262 ", TASKS)
        for task_id in range(263, 268):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)

    def test_no_automatic_execution_path_exists(self) -> None:
        diagnostic_relative = APPROVAL["approvedArtifacts"][1]["path"]
        self.assertNotIn(diagnostic_relative, G037_WORKFLOW)
        self.assertEqual(SECURITY_WORKFLOW.count(diagnostic_relative), 1)

    def test_security_workflow_tracks_and_runs_approval_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-membership-diagnostic-approval.v2.json",
            "backend/supabase/tests/test_g037_readonly_role_membership_diagnostic_approval_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_membership_diagnostic_approval_source",
            SECURITY_WORKFLOW,
        )

    def test_approval_artifact_contains_no_connection_or_credential_material(self) -> None:
        raw = APPROVAL_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "postgres://",
            "postgresql://",
            "access_token",
            "refresh_token",
            "service_role_key",
            "database_password",
            "pooler.",
        ):
            self.assertNotIn(forbidden, raw)


if __name__ == "__main__":
    unittest.main()
