"""Contracts for the consumed G037 diagnostic and membership-only follow-up."""

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
    ROOT
    / "backend/supabase/g037-readonly-role-postcondition-diagnostic-authorization.v1.json"
)
AUTHORIZATION = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
ATTEMPT_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-postcondition-diagnostic-attempt.v1.json"
)
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
PREVIEW_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-membership-diagnostic-preview.v2.json"
)
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
DIAGNOSTIC_PATH = (
    ROOT / "backend/supabase/scripts/g037_readonly_role_membership_diagnostic_v2.sql"
)
DIAGNOSTIC = DIAGNOSTIC_PATH.read_text(encoding="utf-8")
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


class G037ReadonlyRoleMembershipDiagnosticSourceTests(unittest.TestCase):
    def test_one_time_authorization_is_exact_and_narrow(self) -> None:
        self.assertEqual(AUTHORIZATION["schemaVersion"], 1)
        self.assertEqual(
            AUTHORIZATION["kind"],
            "g037_readonly_role_postcondition_diagnostic_authorization",
        )
        self.assertEqual(AUTHORIZATION["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(AUTHORIZATION["databaseName"], "postgres")
        self.assertEqual(AUTHORIZATION["approverDisplayName"], "최연우")
        self.assertEqual(AUTHORIZATION["authorizedAt"], "2026-09-04T07:31:51Z")
        self.assertEqual(
            sha256(AUTHORIZATION_PATH),
            "b8bd2d1c2a6fd0f6b37d04c1f2a12506dc8985ea097ea8ae3fd337a266ab6b10",
        )
        scope = AUTHORIZATION["authorizedScope"]
        self.assertEqual(scope["maximumExecutionCount"], 1)
        self.assertIs(scope["productionRollbackOnlyDiagnostic"], True)
        self.assertIs(scope["immediateBoundedReadback"], True)
        for denied in (
            "persistentProvisioning",
            "passwordConfiguration",
            "repositorySecretMutation",
            "workflowDispatch",
            "migrationLedgerMutation",
        ):
            self.assertIs(scope[denied], False)

    def test_attempt_consumes_authorization_once_and_records_fixed_code(self) -> None:
        self.assertEqual(ATTEMPT["schemaVersion"], 1)
        self.assertEqual(
            ATTEMPT["kind"], "g037_readonly_role_postcondition_diagnostic_attempt"
        )
        self.assertEqual(
            ATTEMPT["authorization"]["authorizationSha256"],
            sha256(AUTHORIZATION_PATH),
        )
        self.assertEqual(ATTEMPT["authorization"]["approvedExecutionCount"], 1)
        self.assertEqual(ATTEMPT["authorization"]["consumedExecutionCount"], 1)
        self.assertEqual(ATTEMPT["outcome"]["status"], "rolled_back")
        self.assertEqual(
            ATTEMPT["outcome"]["fixedCode"], "g037_diag_memberships_not_zero"
        )
        self.assertIs(ATTEMPT["outcome"]["fixedCodeAllowlisted"], True)
        self.assertIs(ATTEMPT["outcome"]["providerErrorRetained"], False)
        self.assertIs(ATTEMPT["outcome"]["persistentHostedStateChanged"], False)

    def test_preexecution_and_rollback_readbacks_are_bounded(self) -> None:
        precheck = ATTEMPT["preexecutionReadback"]
        self.assertEqual(precheck["postgresMajorVersion"], 17)
        for key in (
            "projectActiveHealthy",
            "databaseExact",
            "roleAbsent",
            "migrationLedgerPresent",
            "targetFunctionPresent",
            "migrationCountExact",
            "terminalMigrationExact",
        ):
            self.assertIs(precheck[key], True)
        self.assertEqual(
            ATTEMPT["rollbackReadback"],
            {
                "roleAbsent": True,
                "migrationCount": 50,
                "terminalMigrationVersion": "20260804000500",
            },
        )
        boundary = ATTEMPT["diagnosisBoundary"]
        self.assertEqual(boundary["firstDifferingPostcondition"], "membership_count_zero")
        self.assertIs(boundary["membershipDirectionKnown"], False)
        self.assertIs(boundary["membershipCountKnown"], False)
        self.assertIs(boundary["membershipRoleIdentityRecorded"], False)

    def test_v1_retry_and_authorization_reuse_are_closed(self) -> None:
        gate = ATTEMPT["retryGate"]
        self.assertIs(gate["diagnosticV1RetryAllowed"], False)
        self.assertIs(gate["authorizationReusable"], False)
        self.assertIs(gate["rollbackOnlyMembershipDiagnosticPreviewRequired"], True)
        self.assertIs(gate["freshMembershipDiagnosticPreviewApprovalRequired"], True)
        self.assertIs(gate["freshMembershipDiagnosticExecutionAuthorizationRequired"], True)

    def test_membership_preview_binds_attempt_and_new_sql_bytes(self) -> None:
        self.assertEqual(PREVIEW["schemaVersion"], 2)
        self.assertEqual(
            PREVIEW["kind"], "g037_readonly_role_membership_diagnostic_preview"
        )
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "cdb21a3f3cfe6fe52cb37efbc3c40226a5425688321378ff3dbe6a41cf920394",
        )
        self.assertEqual(
            PREVIEW["priorDiagnosticAttempt"]["sha256"], sha256(ATTEMPT_PATH)
        )
        self.assertEqual(
            PREVIEW["diagnosticSql"]["path"],
            DIAGNOSTIC_PATH.relative_to(ROOT).as_posix(),
        )
        self.assertEqual(PREVIEW["diagnosticSql"]["sha256"], sha256(DIAGNOSTIC_PATH))
        self.assertEqual(PREVIEW["diagnosticSql"]["topLevelStatementCount"], 16)

    def test_membership_diagnostic_is_rollback_only_and_fixed_code_only(self) -> None:
        executable = re.sub(r"(?m)^\s*--.*$", "", DIAGNOSTIC)
        self.assertEqual(len(re.findall(r"(?im)^BEGIN;", executable)), 1)
        self.assertEqual(len(re.findall(r"(?im)^ROLLBACK;", executable)), 1)
        self.assertNotRegex(executable, r"(?im)^COMMIT;")
        self.assertEqual(len(re.findall(r"(?im)^CREATE ROLE ", executable)), 1)
        codes = list(
            dict.fromkeys(
                re.findall(r"RAISE EXCEPTION '(g037_membership_diag_[a-z_]+)'", DIAGNOSTIC)
            )
        )
        self.assertEqual(codes, PREVIEW["allowedFixedCodes"])
        self.assertEqual(len(codes), 18)
        self.assertNotIn("RAISE EXCEPTION format", DIAGNOSTIC)
        self.assertNotRegex(DIAGNOSTIC, r"RAISE EXCEPTION\s+[^']")

    def test_membership_dimensions_are_bounded_without_role_name_output(self) -> None:
        scope = PREVIEW["diagnosticScope"]
        for enabled in (
            "membershipDirectionClassification",
            "membershipCardinalityBoundedAtFour",
            "adjacentRolePrivilegeCategoryClassification",
            "postgres17MembershipOptionClassification",
            "fixedCodeOnly",
        ):
            self.assertIs(scope[enabled], True)
        self.assertIs(scope["roleNameOutput"], False)
        self.assertIn("member_of_count + has_member_count > 4", DIAGNOSTIC)
        for option in ("admin_option", "set_option", "inherit_option"):
            self.assertIn(f"membership.{option}", DIAGNOSTIC)

    def test_local_validation_does_not_claim_hosted_membership_state(self) -> None:
        self.assertEqual(
            PREVIEW["localValidation"],
            {
                "postgresVersion": "17.11",
                "observedFixedCode": "g037_membership_diag_none",
                "roleAbsentAfterDiagnostic": True,
                "hostedConnectionUsed": False,
            },
        )
        self.assertIn(
            "production membership direction, count, adjacent role identity, or effective privilege",
            PREVIEW["notEvidenceOf"],
        )

    def test_machine_gates_require_fresh_preview_approval_and_execution_authorization(self) -> None:
        preview_relative = PREVIEW_PATH.relative_to(ROOT).as_posix()
        preview_sha = sha256(PREVIEW_PATH)
        attempt_sha = sha256(ATTEMPT_PATH)
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertIs(gate["rollbackOnlyDiagnosticExecutionConsumed"], True)
        self.assertIs(gate["rollbackOnlyDiagnosticAttemptRecorded"], True)
        self.assertEqual(gate["rollbackOnlyDiagnosticAttemptSha256"], attempt_sha)
        self.assertEqual(gate["rollbackOnlyMembershipDiagnosticPreviewPath"], preview_relative)
        self.assertEqual(gate["rollbackOnlyMembershipDiagnosticPreviewSha256"], preview_sha)
        self.assertIs(gate["rollbackOnlyMembershipDiagnosticPreviewApproved"], True)
        self.assertIs(gate["rollbackOnlyMembershipDiagnosticExecutionAuthorized"], False)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)

        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertEqual(controller["rollbackOnlyDiagnosticAttemptSha256"], attempt_sha)
        self.assertEqual(
            controller["rollbackOnlyMembershipDiagnosticPreviewSha256"], preview_sha
        )
        self.assertIs(
            controller["rollbackOnlyMembershipDiagnosticPreviewApproved"], True
        )
        self.assertIs(
            controller["rollbackOnlyMembershipDiagnosticExecutionAuthorized"], False
        )

    def test_tasks_separate_consumed_execution_from_new_external_gates(self) -> None:
        self.assertIn("- [x]! 7.240 ", TASKS)
        for task_id in range(246, 260):
            marker = "!" if task_id == 248 else "*" if task_id == 258 else ""
            self.assertIn(f"- [x]{marker} 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.260 ", TASKS)
        self.assertIn("- [x]! 7.261 ", TASKS)
        self.assertIn("- [x] 7.262 ", TASKS)
        for task_id in range(263, 268):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)

    def test_no_automatic_execution_path_exists(self) -> None:
        diagnostic_relative = DIAGNOSTIC_PATH.relative_to(ROOT).as_posix()
        self.assertNotIn(diagnostic_relative, G037_WORKFLOW)
        self.assertEqual(SECURITY_WORKFLOW.count(diagnostic_relative), 1)

    def test_security_workflow_tracks_and_runs_membership_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-postcondition-diagnostic-authorization.v1.json",
            "backend/supabase/g037-readonly-role-postcondition-diagnostic-attempt.v1.json",
            "backend/supabase/g037-readonly-role-membership-diagnostic-preview.v2.json",
            "backend/supabase/scripts/g037_readonly_role_membership_diagnostic_v2.sql",
            "backend/supabase/tests/test_g037_readonly_role_membership_diagnostic_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_membership_diagnostic_source",
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
