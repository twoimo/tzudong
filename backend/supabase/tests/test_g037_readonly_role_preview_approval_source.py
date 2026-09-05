"""Source contracts for the exact, bounded G037 preview approval."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
APPROVAL_PATH = ROOT / "backend/supabase/g037-readonly-role-preview-approval.v1.json"
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
RUNBOOK = (ROOT / "backend/supabase/docs/g037-hosted-closure-runbook.md").read_text(
    encoding="utf-8"
)


class G037ReadonlyRolePreviewApprovalSourceTests(unittest.TestCase):
    def test_approval_identity_and_evidence_boundary_are_exact(self) -> None:
        self.assertEqual(APPROVAL["schemaVersion"], 1)
        self.assertEqual(APPROVAL["kind"], "g037_readonly_role_preview_approval")
        self.assertEqual(APPROVAL["repository"], "twoimo/tzudong")
        self.assertEqual(APPROVAL["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(APPROVAL["approverDisplayName"], "최연우")
        self.assertEqual(APPROVAL["approvedAt"], "2026-09-04T05:57:03Z")
        self.assertIn("current task transcript", APPROVAL["approvalEvidenceBoundary"])
        self.assertIn("no external immutable receipt", APPROVAL["approvalEvidenceBoundary"])

    def test_each_approved_artifact_hash_matches_current_bytes(self) -> None:
        expected = {
            "backend/supabase/g037-readonly-role-provisioning-preview.v1.json":
                "59489e04a707651c11b403d0c72831fe63573b2c27ef212e306042bf3dad82d9",
            "backend/supabase/scripts/g037_readonly_role_provisioning.sql":
                "d2fd03c0988a083baafef5b4f98eff2ae96350f93bb062bc2f1483846bf4f997",
            "backend/supabase/scripts/g037_readonly_role_readback.sql":
                "fb0da6c074cbca2a6534b9cf8ae99cd12c9f4af2915ad40bedf053a4624b4c0b",
        }
        self.assertEqual(
            {item["path"]: item["sha256"] for item in APPROVAL["approvedArtifacts"]},
            expected,
        )
        for path, digest in expected.items():
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest)

    def test_scope_approves_only_preview_and_external_custody_procedure(self) -> None:
        self.assertEqual(
            APPROVAL["approvedScope"],
            {
                "roleAndGrantPreview": True,
                "externalCredentialCustodyProcedure": True,
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
                "status": "separate_hosted_apply_authorization_required",
                "preapplyReadbackPerformed": False,
                "hostedApplyAuthorized": False,
                "hostedApplyPerformed": False,
                "postapplyReadbackPerformed": False,
            },
        )

    def test_downstream_gates_remain_closed(self) -> None:
        gate = CONTRACT["provisioningGate"]
        self.assertIs(gate["priorPreviewOwnerApprovalPresent"], True)
        self.assertIs(gate["currentPreviewOwnerApprovalPresent"], True)
        self.assertIs(gate["hostedApplyAuthorizationPresent"], True)
        self.assertIs(gate["failedApplyAttemptRecorded"], True)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)
        self.assertIs(gate["controllerRetryAuthorized"], False)
        controller = DECISION["controllerGate"]
        self.assertIs(controller["priorReadonlyCredentialPreviewApproved"], True)
        self.assertIs(controller["currentReadonlyCredentialPreviewApproved"], True)
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)
        self.assertIs(controller["failedApplyAttemptRecorded"], True)

    def test_runbook_preserves_separate_hosted_apply_boundary(self) -> None:
        normalized = " ".join(RUNBOOK.split())
        self.assertIn(APPROVAL["approvedArtifacts"][0]["sha256"], normalized)
        self.assertIn("This is review approval only", normalized)
        self.assertIn("separate exact one-time hosted-apply authorization", normalized)
        self.assertIn("no role creation, password configuration", normalized)

    def test_tasks_close_approval_only_and_keep_external_actions_open(self) -> None:
        for task_id in (164, 186):
            self.assertIn(f"- [x]! 7.{task_id} ", TASKS)
        for task_id in range(202, 208):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.208 ", TASKS)
        for task_id in range(209, 219):
            marker = "*" if task_id == 217 else ""
            self.assertIn(f"- [x]{marker} 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.219 ", TASKS)
        self.assertIn("- [x]! 7.220 ", TASKS)
        for task_id in range(221, 226):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        for task_id in range(226, 239):
            marker = "!" if task_id == 228 else "*" if task_id == 237 else ""
            self.assertIn(f"- [x]{marker} 7.{task_id} ", TASKS)
        for task_id in (165, 166, 167, 187, *range(189, 195)):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [ ]! 7.195 ", TASKS)
        self.assertIn("- [x]! 7.239 ", TASKS)
        self.assertIn("- [x]! 7.240 ", TASKS)

    def test_security_workflow_tracks_and_runs_approval_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-preview-approval.v1.json",
            "backend/supabase/docs/g037-hosted-closure-runbook.md",
            "backend/supabase/tests/test_g037_readonly_role_preview_approval_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_preview_approval_source",
            SECURITY_WORKFLOW,
        )


if __name__ == "__main__":
    unittest.main()
