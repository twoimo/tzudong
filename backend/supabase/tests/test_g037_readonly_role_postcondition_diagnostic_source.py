"""Contracts for the rolled-back v2 attempt and rollback-only diagnostic."""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
AUTHORIZATION_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-apply-authorization.v2.json"
)
AUTHORIZATION = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
ATTEMPT_PATH = ROOT / "backend/supabase/g037-readonly-role-apply-attempt.v2.json"
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
PREVIEW_PATH = (
    ROOT
    / "backend/supabase/g037-readonly-role-postcondition-diagnostic-preview.v1.json"
)
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
DIAGNOSTIC_PATH = (
    ROOT / "backend/supabase/scripts/g037_readonly_role_postcondition_diagnostic_v1.sql"
)
DIAGNOSTIC = DIAGNOSTIC_PATH.read_text(encoding="utf-8")
PROVISIONING_V2_PATH = (
    ROOT / "backend/supabase/scripts/g037_readonly_role_provisioning_v2.sql"
)
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
WORKFLOW = (ROOT / ".github/workflows/g037-hosted-closure.yml").read_text(
    encoding="utf-8"
)
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class G037ReadonlyRolePostconditionDiagnosticSourceTests(unittest.TestCase):
    def test_v2_authorization_is_exact_and_consumed_only_by_attempt_receipt(self) -> None:
        self.assertEqual(AUTHORIZATION["schemaVersion"], 2)
        self.assertEqual(
            AUTHORIZATION["kind"], "g037_readonly_role_apply_authorization"
        )
        self.assertEqual(AUTHORIZATION["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(AUTHORIZATION["approverDisplayName"], "최연우")
        self.assertEqual(AUTHORIZATION["authorizedScope"]["maximumExecutionCount"], 1)
        self.assertIs(AUTHORIZATION["authorizedScope"]["passwordConfiguration"], False)
        self.assertIs(
            AUTHORIZATION["authorizedScope"]["repositorySecretMutation"], False
        )
        self.assertEqual(
            ATTEMPT["authorization"]["authorizationSha256"],
            sha256(AUTHORIZATION_PATH),
        )
        self.assertEqual(ATTEMPT["authorization"]["consumedExecutionCount"], 1)

    def test_v2_attempt_is_bounded_and_proves_rollback(self) -> None:
        self.assertEqual(ATTEMPT["schemaVersion"], 2)
        self.assertEqual(ATTEMPT["kind"], "g037_readonly_role_apply_attempt")
        self.assertEqual(ATTEMPT["outcome"]["status"], "rolled_back")
        self.assertEqual(
            ATTEMPT["outcome"]["fixedCode"], "role_postcondition_denied"
        )
        self.assertIs(ATTEMPT["outcome"]["persistentHostedStateChanged"], False)
        self.assertIs(ATTEMPT["outcome"]["providerErrorRetained"], False)
        self.assertEqual(
            ATTEMPT["rollbackReadback"],
            {
                "roleAbsent": True,
                "migrationCount": 50,
                "terminalMigrationVersion": "20260804000500",
            },
        )
        self.assertIs(ATTEMPT["retryGate"]["approvedSqlRetryAllowed"], False)
        self.assertIs(ATTEMPT["retryGate"]["authorizationReusable"], False)

    def test_preview_binds_exact_attempt_and_diagnostic_bytes(self) -> None:
        self.assertEqual(PREVIEW["schemaVersion"], 1)
        self.assertEqual(
            PREVIEW["kind"], "g037_readonly_role_postcondition_diagnostic_preview"
        )
        self.assertEqual(PREVIEW["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "8280b2848fbdcd7209affcf8eeb4aa539afe460defdacb97fc5552b84db7693b",
        )
        self.assertEqual(PREVIEW["failedAttempt"]["sha256"], sha256(ATTEMPT_PATH))
        self.assertEqual(
            PREVIEW["diagnosticSql"]["path"],
            DIAGNOSTIC_PATH.relative_to(ROOT).as_posix(),
        )
        self.assertEqual(PREVIEW["diagnosticSql"]["sha256"], sha256(DIAGNOSTIC_PATH))
        self.assertEqual(PREVIEW["diagnosticSql"]["topLevelStatementCount"], 16)

    def test_diagnostic_is_rollback_only_and_emits_only_fixed_codes(self) -> None:
        executable = re.sub(r"(?m)^\s*--.*$", "", DIAGNOSTIC)
        self.assertEqual(len(re.findall(r"(?im)^BEGIN;", executable)), 1)
        self.assertEqual(len(re.findall(r"(?im)^ROLLBACK;", executable)), 1)
        self.assertNotRegex(executable, r"(?im)^COMMIT;")
        self.assertEqual(len(re.findall(r"(?im)^CREATE ROLE ", executable)), 1)
        codes = re.findall(r"RAISE EXCEPTION '(g037_diag_[a-z_]+)'", DIAGNOSTIC)
        self.assertEqual(codes, PREVIEW["allowedFixedCodes"])
        self.assertEqual(len(codes), 17)
        self.assertEqual(codes[-1], "g037_diag_all_conditions_passed")
        self.assertIs(PREVIEW["diagnosticScope"]["alwaysAbortsBeforePersistentCommit"], True)
        self.assertIs(PREVIEW["diagnosticScope"]["persistentRoleCreation"], False)

    def test_local_validation_and_hosted_difference_remain_separate(self) -> None:
        self.assertEqual(
            PREVIEW["localValidation"],
            {
                "postgresVersion": "17.11",
                "observedFixedCode": "g037_diag_all_conditions_passed",
                "roleAbsentAfterDiagnostic": True,
                "hostedConnectionUsed": False,
            },
        )
        self.assertIs(ATTEMPT["localPostgresReproduction"]["allDeclaredPostconditionsPassed"], True)
        self.assertIn(
            "which individual hosted postcondition differed", ATTEMPT["notEvidenceOf"]
        )

    def test_machine_gates_record_approval_but_require_execution_authorization(self) -> None:
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertEqual(gate["failedApplyAttemptCount"], 2)
        self.assertIs(gate["rollbackOnlyDiagnosticPreviewPresent"], True)
        self.assertIs(gate["rollbackOnlyDiagnosticPreviewApproved"], True)
        self.assertIs(gate["rollbackOnlyDiagnosticExecutionAuthorized"], False)
        self.assertIs(gate["repositorySecretPresent"], False)
        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertEqual(controller["failedApplyAttemptCount"], 2)
        self.assertIs(controller["rollbackOnlyDiagnosticPreviewApproved"], True)
        self.assertIs(controller["rollbackOnlyDiagnosticExecutionAuthorized"], False)

    def test_tasks_close_diagnostic_review_but_leave_execution_gate_open(self) -> None:
        self.assertIn("- [x]! 7.220 ", TASKS)
        for task_id in range(226, 239):
            marker = "!" if task_id == 228 else "*" if task_id == 237 else ""
            self.assertIn(f"- [x]{marker} 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.239 ", TASKS)
        self.assertIn("- [x]! 7.240 ", TASKS)
        for task_id in range(241, 246):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)

    def test_diagnostic_has_no_automatic_execution_path(self) -> None:
        relative = DIAGNOSTIC_PATH.relative_to(ROOT).as_posix()
        self.assertNotIn(relative, WORKFLOW)
        self.assertEqual(SECURITY_WORKFLOW.count(relative), 1)

    def test_security_workflow_tracks_and_runs_diagnostic_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-apply-authorization.v2.json",
            "backend/supabase/g037-readonly-role-apply-attempt.v2.json",
            "backend/supabase/g037-readonly-role-postcondition-diagnostic-preview.v1.json",
            "backend/supabase/scripts/g037_readonly_role_postcondition_diagnostic_v1.sql",
            "backend/supabase/tests/test_g037_readonly_role_postcondition_diagnostic_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_postcondition_diagnostic_source",
            SECURITY_WORKFLOW,
        )

    def test_new_evidence_contains_no_connection_or_credential_material(self) -> None:
        for path in (AUTHORIZATION_PATH, ATTEMPT_PATH, PREVIEW_PATH):
            raw = path.read_text(encoding="utf-8").lower()
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
