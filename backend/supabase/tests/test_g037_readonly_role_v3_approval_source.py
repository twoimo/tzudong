"""Source contracts for the review-only G037 provisioning v3 approval."""

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
G037_WORKFLOW = (ROOT / ".github/workflows/g037-hosted-closure.yml").read_text(
    encoding="utf-8"
)
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
APPROVAL_PATH = ROOT / "backend/supabase/g037-readonly-role-preview-approval.v3.json"
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


from backend.supabase.tests.g037_reviewed_artifacts import reviewed_sha256 as sha256


class G037ReadonlyRoleV3ApprovalSourceTests(unittest.TestCase):
    def test_named_owner_approval_is_exact_and_separate(self) -> None:
        self.assertEqual(
            sha256(APPROVAL_PATH),
            "1547c6532e786f4a9767e546da0f2b43c55c488cd4266272d6eb3877b4899581",
        )
        self.assertEqual(APPROVAL["schemaVersion"], 3)
        self.assertEqual(APPROVAL["kind"], "g037_readonly_role_preview_approval")
        self.assertEqual(APPROVAL["repository"], "twoimo/tzudong")
        self.assertEqual(APPROVAL["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(APPROVAL["databaseName"], "postgres")
        self.assertEqual(APPROVAL["approverDisplayName"], "최연우")
        self.assertEqual(APPROVAL["approvedAt"], "2026-09-04T09:22:06Z")
        self.assertIn("current task transcript", APPROVAL["approvalEvidenceBoundary"])

    def test_approval_binds_all_four_recomputed_sources(self) -> None:
        expected = {
            "backend/supabase/g037-readonly-role-provisioning-preview.v3.json": (
                "bf1913e5b0cfffaad856e4080939d21e7d11d60fee4f2c333c92c3c9ca219ff9"
            ),
            "backend/supabase/scripts/g037_readonly_role_provisioning_v3.sql": (
                "77542865f044f10c8d6d86f99ba015ef3419a3dfacf5e4ad9c44cc8848d6c4a8"
            ),
            "backend/supabase/scripts/g037_readonly_role_readback_v3.sql": (
                "8a225381a61ff1c752bcdee89722d16e9173a1aadda0fbcc35707cb9cbdeae09"
            ),
            "backend/supabase/scripts/g037_hosted_closure_executor.py": (
                "188095df7df30edbe890d3cb0df9b1d69f59b7942dd449ae5f0b7b8fad5e89b0"
            ),
        }
        approved = {
            descriptor["path"]: descriptor["sha256"]
            for descriptor in APPROVAL["approvedArtifacts"]
        }
        self.assertEqual(approved, expected)
        for relative, digest in expected.items():
            self.assertEqual(sha256(ROOT / relative), digest)

    def test_continuity_binds_immutable_failure_and_consumed_diagnostic(self) -> None:
        continuity = APPROVAL["continuity"]
        expected = {
            "priorPreviewApprovalPath": (
                "backend/supabase/g037-readonly-role-preview-approval.v2.json"
            ),
            "failedApplyAttemptPath": (
                "backend/supabase/g037-readonly-role-apply-attempt.v2.json"
            ),
            "creatorMembershipDiagnosticAuthorizationPath": (
                "backend/supabase/g037-readonly-role-creator-membership-diagnostic-authorization.v3.json"
            ),
            "creatorMembershipDiagnosticAttemptPath": (
                "backend/supabase/g037-readonly-role-creator-membership-diagnostic-attempt.v3.json"
            ),
        }
        for key, relative in expected.items():
            self.assertEqual(continuity[key], relative)
            self.assertEqual(continuity[key.removesuffix("Path") + "Sha256"], sha256(ROOT / relative))
        self.assertIs(
            continuity["creatorMembershipDiagnosticAuthorizationReusable"], False
        )

    def test_approval_is_review_only_and_cannot_authorize_apply(self) -> None:
        scope = APPROVAL["approvedScope"]
        for reviewed in (
            "correctedProvisioningV3PreviewReview",
            "provisioningSqlReview",
            "readbackSqlReview",
            "controllerAdmissionReview",
        ):
            self.assertIs(scope[reviewed], True)
        for denied in (
            "productionHostedExecution",
            "roleCreation",
            "passwordConfiguration",
            "repositorySecretMutation",
            "controllerDispatch",
            "workflowDispatch",
            "migrationLedgerMutation",
            "releaseOrDeployment",
        ):
            self.assertIs(scope[denied], False)
        self.assertEqual(
            APPROVAL["executionGate"]["status"],
            "separate_one_time_production_apply_authorization_required",
        )
        self.assertIs(APPROVAL["executionGate"]["previewOwnerApproved"], True)
        for closed in (
            "hostedApplyAuthorized",
            "hostedApplyPerformed",
            "postapplyReadbackPerformed",
            "credentialConfigured",
            "repositorySecretChanged",
            "controllerRetryAuthorized",
        ):
            self.assertIs(APPROVAL["executionGate"][closed], False)

    def test_both_machine_gates_bind_approval_and_keep_execution_closed(self) -> None:
        approval_sha = sha256(APPROVAL_PATH)
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertIs(gate["currentPreviewOwnerApprovalPresent"], True)
        self.assertEqual(gate["currentPreviewApprovalPath"], APPROVAL_PATH.relative_to(ROOT).as_posix())
        self.assertEqual(gate["currentPreviewApprovalSha256"], approval_sha)
        self.assertIs(gate["correctedProvisioningV3PreviewApproved"], True)
        self.assertEqual(gate["correctedProvisioningV3PreviewApprovalSha256"], approval_sha)
        self.assertIs(gate["hostedApplyAuthorizationPresent"], True)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)
        self.assertIs(gate["controllerRetryAuthorized"], False)

        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertIs(controller["currentReadonlyCredentialPreviewApproved"], True)
        self.assertEqual(
            controller["currentReadonlyCredentialPreviewApprovalSha256"], approval_sha
        )
        self.assertIs(controller["correctedProvisioningV3PreviewApproved"], True)
        self.assertEqual(
            controller["correctedProvisioningV3PreviewApprovalSha256"], approval_sha
        )
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)

    def test_tasks_and_docs_record_review_but_leave_apply_authority_open(self) -> None:
        self.assertIn("- [x]! 7.335 ", TASKS)
        self.assertIn("- [x]! 7.336 ", TASKS)
        for task_id in range(337, 342):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        approval_sha = sha256(APPROVAL_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(approval_sha, normalized)
            self.assertIn("one-time", normalized)
            self.assertIn("apply authorization", normalized)

    def test_no_workflow_apply_path_or_unreviewed_authority_is_added(self) -> None:
        for descriptor in APPROVAL["approvedArtifacts"][:3]:
            self.assertNotIn(descriptor["path"], G037_WORKFLOW)
        relative = APPROVAL_PATH.relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_v3_approval_source",
            SECURITY_WORKFLOW,
        )

    def test_approval_contains_no_connection_or_credential_material(self) -> None:
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
