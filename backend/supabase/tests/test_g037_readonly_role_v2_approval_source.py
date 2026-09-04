"""Source contracts for the exact and non-executing G037 v2 preview approval."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
APPROVAL_PATH = ROOT / "backend/supabase/g037-readonly-role-preview-approval.v2.json"
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
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class G037ReadonlyRoleV2ApprovalSourceTests(unittest.TestCase):
    def test_approval_identity_and_evidence_boundary_are_exact(self) -> None:
        self.assertEqual(APPROVAL["schemaVersion"], 2)
        self.assertEqual(APPROVAL["kind"], "g037_readonly_role_preview_approval")
        self.assertEqual(APPROVAL["repository"], "twoimo/tzudong")
        self.assertEqual(APPROVAL["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(APPROVAL["approverDisplayName"], "최연우")
        self.assertEqual(APPROVAL["approvedAt"], "2026-09-04T06:38:46Z")
        self.assertIn("current task transcript", APPROVAL["approvalEvidenceBoundary"])
        self.assertIn("no external immutable receipt", APPROVAL["approvalEvidenceBoundary"])

    def test_continuity_hashes_match_immutable_v1_evidence(self) -> None:
        continuity = APPROVAL["continuity"]
        for path_key, digest_key in (
            ("priorApprovalPath", "priorApprovalSha256"),
            ("failedAttemptPath", "failedAttemptSha256"),
        ):
            path = ROOT / continuity[path_key]
            self.assertEqual(continuity[digest_key], sha256(path))
        self.assertIs(continuity["priorExecutionAuthorizationReusable"], False)
        self.assertIs(
            continuity["externalCredentialCustodyProcedurePreviouslyApproved"], True
        )

    def test_each_approved_v2_hash_matches_current_bytes(self) -> None:
        expected = {
            "backend/supabase/g037-readonly-role-provisioning-preview.v2.json":
                "9351623d80b179e46b335e65a6fd67faf86485783fa7e5e1117022cef4261fb3",
            "backend/supabase/scripts/g037_readonly_role_provisioning_v2.sql":
                "b4241fa478ac287ba418a8a53cc826ccba4dc9b72eafe536c0c8aabad08cfdc3",
            "backend/supabase/scripts/g037_readonly_role_readback_v2.sql":
                "62958564bcdef69cb7114b3c95d8f4e93e366468bcdc9ab060d82ab7c7a7e26b",
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
                "correctedRoleAndGrantPreview": True,
                "correctedProvisioningSqlReview": True,
                "correctedReadbackSqlReview": True,
                "hostedExecution": False,
                "roleCreation": False,
                "passwordConfiguration": False,
                "repositorySecretMutation": False,
                "workflowDispatch": False,
            },
        )
        self.assertEqual(
            APPROVAL["executionGate"],
            {
                "status": "fresh_one_time_hosted_apply_authorization_required",
                "currentPreviewOwnerApproved": True,
                "hostedApplyAuthorized": False,
                "hostedApplyPerformed": False,
                "postapplyReadbackPerformed": False,
            },
        )

    def test_machine_gates_bind_v2_approval_but_not_execution(self) -> None:
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertIs(gate["currentPreviewOwnerApprovalPresent"], True)
        self.assertEqual(
            gate["currentPreviewSha256"],
            "bf1913e5b0cfffaad856e4080939d21e7d11d60fee4f2c333c92c3c9ca219ff9",
        )
        self.assertEqual(
            gate["priorPreviewApprovalPath"],
            "backend/supabase/g037-readonly-role-preview-approval.v2.json",
        )
        self.assertIs(gate["hostedApplyAuthorizationPresent"], True)
        self.assertEqual(gate["failedApplyAttemptCount"], 2)
        self.assertIs(gate["rollbackOnlyDiagnosticPreviewPresent"], True)
        self.assertIs(gate["rollbackOnlyDiagnosticPreviewApproved"], True)
        self.assertIs(gate["rollbackOnlyDiagnosticExecutionAuthorized"], False)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)
        self.assertIs(gate["controllerRetryAuthorized"], False)
        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertIs(controller["currentReadonlyCredentialPreviewApproved"], True)
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)

    def test_tasks_close_review_only_and_leave_execution_open(self) -> None:
        self.assertIn("- [x]! 7.219 ", TASKS)
        self.assertIn("- [x]! 7.220 ", TASKS)
        for task_id in range(221, 226):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.239 ", TASKS)
        self.assertIn("- [x]! 7.240 ", TASKS)

    def test_security_workflow_tracks_and_runs_v2_approval(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-preview-approval.v2.json",
            "backend/supabase/tests/test_g037_readonly_role_v2_approval_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_v2_approval_source",
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
