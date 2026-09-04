"""Source contracts for the rolled-back G037 v1 attempt and corrected v2 preview."""

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
WORKFLOW = (ROOT / ".github/workflows/g037-hosted-closure.yml").read_text(
    encoding="utf-8"
)
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
ATTEMPT_PATH = ROOT / "backend/supabase/g037-readonly-role-apply-attempt.v1.json"
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
PREVIEW_V1_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-provisioning-preview.v1.json"
)
PREVIEW_V2_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-provisioning-preview.v2.json"
)
PREVIEW_V2 = json.loads(PREVIEW_V2_PATH.read_text(encoding="utf-8"))
PROVISIONING_V1 = (
    ROOT / "backend/supabase/scripts/g037_readonly_role_provisioning.sql"
)
READBACK_V1 = ROOT / "backend/supabase/scripts/g037_readonly_role_readback.sql"
PROVISIONING_V2 = (
    ROOT / "backend/supabase/scripts/g037_readonly_role_provisioning_v2.sql"
)
READBACK_V2 = ROOT / "backend/supabase/scripts/g037_readonly_role_readback_v2.sql"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class G037ReadonlyRoleV2SourceTests(unittest.TestCase):
    def test_v1_approval_and_source_bytes_remain_exact_historical_evidence(self) -> None:
        self.assertEqual(
            sha256(PREVIEW_V1_PATH),
            "59489e04a707651c11b403d0c72831fe63573b2c27ef212e306042bf3dad82d9",
        )
        self.assertEqual(
            sha256(PROVISIONING_V1),
            "d2fd03c0988a083baafef5b4f98eff2ae96350f93bb062bc2f1483846bf4f997",
        )
        self.assertEqual(
            sha256(READBACK_V1),
            "fb0da6c074cbca2a6534b9cf8ae99cd12c9f4af2915ad40bedf053a4624b4c0b",
        )

    def test_failed_attempt_consumed_authorization_and_proves_rollback(self) -> None:
        self.assertEqual(ATTEMPT["schemaVersion"], 1)
        self.assertEqual(ATTEMPT["kind"], "g037_readonly_role_apply_attempt")
        self.assertEqual(ATTEMPT["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(ATTEMPT["databaseName"], "postgres")
        self.assertEqual(ATTEMPT["authorization"]["approvedExecutionCount"], 1)
        self.assertEqual(ATTEMPT["authorization"]["consumedExecutionCount"], 1)
        self.assertEqual(
            ATTEMPT["outcome"],
            {
                "status": "rolled_back",
                "fixedCode": "acl_array_dimension_postcondition_denied",
                "transactionCommitObserved": False,
                "persistentRolePresentAfterFailure": False,
                "persistentHostedStateChanged": False,
                "providerErrorRetained": False,
            },
        )
        self.assertEqual(
            ATTEMPT["rollbackReadback"],
            {
                "roleAbsent": True,
                "migrationCount": 50,
                "terminalMigrationVersion": "20260804000500",
            },
        )
        self.assertEqual(
            ATTEMPT["retryGate"],
            {
                "approvedSqlRetryAllowed": False,
                "correctedPreviewRequired": True,
                "freshPreviewOwnerApprovalRequired": True,
                "freshOneTimeHostedApplyAuthorizationRequired": True,
            },
        )

    def test_v2_preview_is_bound_to_current_corrected_sources(self) -> None:
        self.assertEqual(PREVIEW_V2["schemaVersion"], 2)
        self.assertEqual(PREVIEW_V2["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(
            sha256(PREVIEW_V2_PATH),
            "9351623d80b179e46b335e65a6fd67faf86485783fa7e5e1117022cef4261fb3",
        )
        for descriptor, path in (
            (PREVIEW_V2["provisioningSql"], PROVISIONING_V2),
            (PREVIEW_V2["readbackSql"], READBACK_V2),
        ):
            self.assertEqual(descriptor["path"], path.relative_to(ROOT).as_posix())
            self.assertEqual(descriptor["sha256"], sha256(path))
        self.assertEqual(
            PREVIEW_V2["syntaxValidation"],
            {
                "parser": "pglast",
                "parserVersion": "7.10",
                "provisioningStatementCount": 16,
                "readbackStatementCount": 1,
                "hostedConnectionUsed": False,
            },
        )

    def test_v2_changes_only_three_nullable_acl_expansions(self) -> None:
        needle = "COALESCE(attribute_row.attacl, '{}'::pg_catalog.aclitem[])"
        replacement = "attribute_row.attacl"
        provisioning_v1 = PROVISIONING_V1.read_text(encoding="utf-8")
        provisioning_v2 = PROVISIONING_V2.read_text(encoding="utf-8")
        readback_v1 = READBACK_V1.read_text(encoding="utf-8")
        readback_v2 = READBACK_V2.read_text(encoding="utf-8")
        self.assertEqual(provisioning_v1.count(needle), 2)
        self.assertEqual(readback_v1.count(needle), 1)
        self.assertEqual(provisioning_v2, provisioning_v1.replace(needle, replacement))
        self.assertEqual(readback_v2, readback_v1.replace(needle, replacement))
        self.assertEqual(
            PREVIEW_V2["correction"],
            {
                "scope": (
                    "replace zero-dimensional empty ACL substitution with strict "
                    "NULL ACL expansion"
                ),
                "provisioningReplacementCount": 2,
                "readbackReplacementCount": 1,
                "grantSetChanged": False,
                "rolePropertiesChanged": False,
                "transactionBoundaryChanged": False,
            },
        )

    def test_v2_external_gates_are_closed(self) -> None:
        self.assertEqual(
            PREVIEW_V2["approvalGate"],
            {
                "status": "corrected_preview_complete_owner_approval_required",
                "previewOwnerApproved": False,
                "hostedApplyAuthorized": False,
                "previewExecuted": False,
                "hostedStateChanged": False,
                "credentialConfigured": False,
                "repositorySecretChanged": False,
                "controllerRetryAuthorized": False,
            },
        )
        self.assertIs(PREVIEW_V2["failedAttempt"]["priorSqlRetryAllowed"], False)
        self.assertIs(
            PREVIEW_V2["failedAttempt"]["persistentHostedStateChanged"], False
        )

    def test_v2_operator_sql_is_never_workflow_executed(self) -> None:
        for path in (PROVISIONING_V2, READBACK_V2):
            relative = path.relative_to(ROOT).as_posix()
            self.assertNotIn(relative, WORKFLOW)
            self.assertEqual(SECURITY_WORKFLOW.count(relative), 1)

    def test_tasks_and_docs_preserve_failure_and_fresh_authorization(self) -> None:
        self.assertIn("- [x]! 7.188 ", TASKS)
        self.assertIn("- [x]! 7.208 ", TASKS)
        for task_id in range(209, 219):
            marker = "*" if task_id == 217 else ""
            self.assertIn(f"- [x]{marker} 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.219 ", TASKS)
        self.assertIn("- [x]! 7.220 ", TASKS)
        for task_id in range(221, 226):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.239 ", TASKS)
        self.assertIn("- [x]! 7.240 ", TASKS)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn("acl_array_dimension_postcondition_denied", normalized)
            self.assertIn(
                "9351623d80b179e46b335e65a6fd67faf86485783fa7e5e1117022cef4261fb3",
                normalized,
            )
            self.assertIn(
                "8280b2848fbdcd7209affcf8eeb4aa539afe460defdacb97fc5552b84db7693b",
                normalized,
            )
            self.assertIn("fresh", normalized)

    def test_security_workflow_tracks_and_runs_v2_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-apply-attempt.v1.json",
            "backend/supabase/g037-readonly-role-provisioning-preview.v2.json",
            "backend/supabase/scripts/g037_readonly_role_provisioning_v2.sql",
            "backend/supabase/scripts/g037_readonly_role_readback_v2.sql",
            "backend/supabase/tests/test_g037_readonly_role_v2_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_v2_source",
            SECURITY_WORKFLOW,
        )


if __name__ == "__main__":
    unittest.main()
