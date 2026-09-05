"""Source contracts for the review-only G037 diagnostic approval."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
APPROVAL_PATH = (
    ROOT
    / "backend/supabase/g037-readonly-role-postcondition-diagnostic-approval.v1.json"
)
APPROVAL = json.loads(APPROVAL_PATH.read_text(encoding="utf-8"))
PREVIEW_PATH = (
    ROOT
    / "backend/supabase/g037-readonly-role-postcondition-diagnostic-preview.v1.json"
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


class G037ReadonlyRolePostconditionDiagnosticApprovalSourceTests(unittest.TestCase):
    def test_approval_identity_and_evidence_boundary_are_exact(self) -> None:
        self.assertEqual(APPROVAL["schemaVersion"], 1)
        self.assertEqual(
            APPROVAL["kind"],
            "g037_readonly_role_postcondition_diagnostic_approval",
        )
        self.assertEqual(APPROVAL["repository"], "twoimo/tzudong")
        self.assertEqual(APPROVAL["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(APPROVAL["databaseName"], "postgres")
        self.assertEqual(APPROVAL["approverDisplayName"], "최연우")
        self.assertEqual(APPROVAL["approvedAt"], "2026-09-04T07:01:59Z")
        self.assertIn("current task transcript", APPROVAL["approvalEvidenceBoundary"])
        self.assertIn("no external immutable receipt", APPROVAL["approvalEvidenceBoundary"])
        self.assertEqual(
            sha256(APPROVAL_PATH),
            "7b823f6425c9505495d2026ee3ef0f7c39abd7496a93204cdc4aebb754ca31bb",
        )

    def test_continuity_binds_failed_attempt_and_consumed_authorization(self) -> None:
        continuity = APPROVAL["continuity"]
        for path_key, digest_key in (
            ("failedV2AttemptPath", "failedV2AttemptSha256"),
            ("v2ApplyAuthorizationPath", "v2ApplyAuthorizationSha256"),
        ):
            path = ROOT / continuity[path_key]
            self.assertEqual(continuity[digest_key], sha256(path))
        self.assertIs(continuity["priorV2ApplyAuthorizationReusable"], False)

    def test_each_approved_hash_matches_current_immutable_bytes(self) -> None:
        expected = {
            "backend/supabase/g037-readonly-role-postcondition-diagnostic-preview.v1.json": (
                "8280b2848fbdcd7209affcf8eeb4aa539afe460defdacb97fc5552b84db7693b"
            ),
            "backend/supabase/scripts/g037_readonly_role_postcondition_diagnostic_v1.sql": (
                "2f926d1a8ceccbb552718cdeb95c6c55d9922b9a9805efee66f85c6205bf7755"
            ),
        }
        self.assertEqual(
            {item["path"]: item["sha256"] for item in APPROVAL["approvedArtifacts"]},
            expected,
        )
        for path, digest in expected.items():
            self.assertEqual(sha256(ROOT / path), digest)

    def test_approval_scope_is_review_only_and_execution_stays_closed(self) -> None:
        self.assertEqual(
            APPROVAL["approvedScope"],
            {
                "rollbackOnlyDiagnosticPreviewReview": True,
                "fixedCodeDiagnosticSqlReview": True,
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
                    "separate_one_time_diagnostic_execution_authorization_required"
                ),
                "previewOwnerApproved": True,
                "diagnosticExecutionAuthorized": False,
                "diagnosticExecuted": False,
                "persistentHostedStateChanged": False,
            },
        )

    def test_immutable_preview_still_records_its_preapproval_state(self) -> None:
        self.assertEqual(
            PREVIEW["approvalGate"],
            {
                "status": "diagnostic_preview_owner_approval_required",
                "previewOwnerApproved": False,
                "diagnosticExecutionAuthorized": False,
                "diagnosticExecuted": False,
                "persistentHostedStateChanged": False,
            },
        )
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "8280b2848fbdcd7209affcf8eeb4aa539afe460defdacb97fc5552b84db7693b",
        )

    def test_machine_gates_bind_approval_without_opening_execution(self) -> None:
        approval_relative = APPROVAL_PATH.relative_to(ROOT).as_posix()
        approval_sha = sha256(APPROVAL_PATH)
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertEqual(gate["rollbackOnlyDiagnosticApprovalPath"], approval_relative)
        self.assertEqual(gate["rollbackOnlyDiagnosticApprovalSha256"], approval_sha)
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
        self.assertEqual(
            controller["rollbackOnlyDiagnosticApprovalPath"], approval_relative
        )
        self.assertEqual(
            controller["rollbackOnlyDiagnosticApprovalSha256"], approval_sha
        )
        self.assertIs(controller["rollbackOnlyDiagnosticPreviewApproved"], True)
        self.assertIs(controller["rollbackOnlyDiagnosticExecutionAuthorized"], False)
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)

    def test_task_state_separates_approval_from_execution(self) -> None:
        self.assertIn("- [x]! 7.239 ", TASKS)
        self.assertIn("- [x]! 7.240 ", TASKS)
        for task_id in range(241, 246):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)

    def test_diagnostic_remains_outside_automatic_workflow_execution(self) -> None:
        diagnostic_relative = APPROVAL["approvedArtifacts"][1]["path"]
        self.assertNotIn(diagnostic_relative, G037_WORKFLOW)
        self.assertEqual(SECURITY_WORKFLOW.count(diagnostic_relative), 1)

    def test_security_workflow_tracks_and_runs_approval_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-postcondition-diagnostic-approval.v1.json",
            "backend/supabase/tests/test_g037_readonly_role_postcondition_diagnostic_approval_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_postcondition_diagnostic_approval_source",
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
