"""Contracts for the consumed G037 membership diagnostic and focused follow-up."""

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
    / "backend/supabase/g037-readonly-role-membership-diagnostic-authorization.v2.json"
)
AUTHORIZATION = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
ATTEMPT_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-membership-diagnostic-attempt.v2.json"
)
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
PREVIEW_PATH = (
    ROOT
    / "backend/supabase/g037-readonly-role-creator-membership-diagnostic-preview.v3.json"
)
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
DIAGNOSTIC_PATH = (
    ROOT
    / "backend/supabase/scripts/g037_readonly_role_creator_membership_diagnostic_v3.sql"
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


class G037ReadonlyRoleCreatorMembershipDiagnosticSourceTests(unittest.TestCase):
    def test_membership_authorization_is_exact_narrow_and_consumed(self) -> None:
        self.assertEqual(AUTHORIZATION["schemaVersion"], 2)
        self.assertEqual(
            AUTHORIZATION["kind"],
            "g037_readonly_role_membership_diagnostic_authorization",
        )
        self.assertEqual(AUTHORIZATION["approverDisplayName"], "최연우")
        self.assertEqual(AUTHORIZATION["authorizedAt"], "2026-09-04T08:10:24Z")
        self.assertEqual(
            sha256(AUTHORIZATION_PATH),
            "ebf8bd6556691a8b444fc787ce80487d0510c6740ddd94e16dd77c072d5c920e",
        )
        scope = AUTHORIZATION["authorizedScope"]
        self.assertEqual(scope["maximumExecutionCount"], 1)
        self.assertIs(scope["productionRollbackOnlyMembershipDiagnostic"], True)
        self.assertIs(scope["immediateBoundedReadback"], True)
        for denied in (
            "persistentProvisioning",
            "passwordConfiguration",
            "repositorySecretMutation",
            "workflowDispatch",
            "migrationLedgerMutation",
        ):
            self.assertIs(scope[denied], False)

    def test_attempt_records_one_execution_and_allowlisted_fixed_code(self) -> None:
        self.assertEqual(ATTEMPT["schemaVersion"], 2)
        self.assertEqual(
            ATTEMPT["kind"], "g037_readonly_role_membership_diagnostic_attempt"
        )
        self.assertEqual(
            sha256(ATTEMPT_PATH),
            "a7cba5f5eac9fa241c75f53f0b0c169ef291fc7b2e8889c4627b243057919bdc",
        )
        authorization = ATTEMPT["authorization"]
        self.assertEqual(authorization["authorizationSha256"], sha256(AUTHORIZATION_PATH))
        self.assertEqual(authorization["approvedExecutionCount"], 1)
        self.assertEqual(authorization["consumedExecutionCount"], 1)
        outcome = ATTEMPT["outcome"]
        self.assertEqual(outcome["status"], "rolled_back")
        self.assertEqual(
            outcome["fixedCode"], "g037_membership_diag_has_elevated_member"
        )
        self.assertIs(outcome["fixedCodeAllowlisted"], True)
        self.assertIs(outcome["transactionCommitObserved"], False)
        self.assertIs(outcome["persistentHostedStateChanged"], False)
        self.assertIs(outcome["providerErrorRetained"], False)

    def test_preconditions_and_rollback_readback_are_bounded(self) -> None:
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
        readback = ATTEMPT["rollbackReadback"]
        self.assertEqual(readback["queryExecutionCount"], 3)
        self.assertIs(readback["firstTwoResultWrapperParsesSucceeded"], False)
        self.assertIs(readback["thirdResultWrapperParseSucceeded"], True)
        self.assertIs(readback["roleAbsent"], True)
        self.assertEqual(readback["migrationCount"], 50)
        self.assertEqual(readback["terminalMigrationVersion"], "20260804000500")

    def test_code_priority_deductions_stop_before_later_properties(self) -> None:
        boundary = ATTEMPT["diagnosisBoundary"]
        self.assertEqual(boundary["membershipDirection"], "has_member")
        self.assertEqual(boundary["memberOfCount"], 0)
        self.assertEqual(boundary["hasMemberCount"], 1)
        self.assertEqual(boundary["hasElevatedMemberCount"], 1)
        for unknown in (
            "laterPriorityPropertiesEvaluatedByFixedCode",
            "memberLoginKnown",
            "adminOptionKnown",
            "setOptionKnown",
            "inheritOptionKnown",
            "memberRoleIdentityRecorded",
            "memberRoleNameRecorded",
            "postgres17AutomaticCreatorMembershipConfirmed",
        ):
            self.assertIs(boundary[unknown], False)
        self.assertIs(boundary["postgres17AutomaticCreatorMembershipHypothesis"], True)

    def test_membership_v2_retry_and_authorization_reuse_are_closed(self) -> None:
        gate = ATTEMPT["retryGate"]
        self.assertIs(gate["membershipDiagnosticV2RetryAllowed"], False)
        self.assertIs(gate["authorizationReusable"], False)
        self.assertIs(gate["focusedCreatorMembershipDiagnosticPreviewRequired"], True)
        self.assertIs(gate["freshFocusedDiagnosticPreviewApprovalRequired"], True)
        self.assertIs(gate["freshFocusedDiagnosticExecutionAuthorizationRequired"], True)

    def test_focused_preview_binds_attempt_reference_and_exact_sql(self) -> None:
        self.assertEqual(PREVIEW["schemaVersion"], 3)
        self.assertEqual(
            PREVIEW["kind"],
            "g037_readonly_role_creator_membership_diagnostic_preview",
        )
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "25b85850bbaef428915d88606276785777213b70c8828d3dc6006ab59ae84a2f",
        )
        self.assertEqual(
            PREVIEW["priorMembershipDiagnosticAttempt"]["sha256"],
            sha256(ATTEMPT_PATH),
        )
        self.assertEqual(
            PREVIEW["diagnosticSql"]["path"],
            DIAGNOSTIC_PATH.relative_to(ROOT).as_posix(),
        )
        self.assertEqual(PREVIEW["diagnosticSql"]["sha256"], sha256(DIAGNOSTIC_PATH))
        self.assertEqual(PREVIEW["diagnosticSql"]["topLevelStatementCount"], 16)

    def test_focused_diagnostic_is_rollback_only_and_fixed_code_only(self) -> None:
        executable = re.sub(r"(?m)^\s*--.*$", "", DIAGNOSTIC)
        self.assertEqual(len(re.findall(r"(?im)^BEGIN;", executable)), 1)
        self.assertEqual(len(re.findall(r"(?im)^ROLLBACK;", executable)), 1)
        self.assertNotRegex(executable, r"(?im)^COMMIT;")
        self.assertEqual(len(re.findall(r"(?im)^CREATE ROLE ", executable)), 1)
        codes = list(
            dict.fromkeys(
                re.findall(r"RAISE EXCEPTION '(g037_creator_diag_[a-z_]+)'", DIAGNOSTIC)
            )
        )
        self.assertEqual(codes, PREVIEW["allowedFixedCodes"])
        self.assertEqual(len(codes), 11)
        self.assertNotIn("RAISE EXCEPTION format", DIAGNOSTIC)
        self.assertNotRegex(DIAGNOSTIC, r"RAISE EXCEPTION\s+[^']")

    def test_focused_invariant_matches_postgres17_documented_shape(self) -> None:
        scope = PREVIEW["diagnosticScope"]
        for key in (
            "parentMembershipMustBeAbsent",
            "memberCardinalityMustEqualOne",
            "memberMustEqualCurrentUser",
            "currentUserMustBeNonSuperuserCreateRole",
            "grantorMustBeSuperuser",
            "adminOptionMustBeTrue",
            "setOptionMustBeFalse",
            "inheritOptionMustBeFalse",
            "fixedCodeOnly",
        ):
            self.assertIs(scope[key], True)
        self.assertIs(scope["roleNameOutput"], False)
        reference = PREVIEW["postgres17Reference"]
        self.assertEqual(
            reference["roleAttributesUrl"],
            "https://www.postgresql.org/docs/17/role-attributes.html",
        )
        self.assertIs(reference["productionEquivalenceConfirmed"], False)

    def test_local_validation_does_not_claim_hosted_equivalence(self) -> None:
        local = PREVIEW["localValidation"]
        self.assertEqual(local["postgresVersion"], "17.11")
        self.assertEqual(
            local["executorPrivilegeClass"],
            "database_owner_nonsuperuser_createrole",
        )
        self.assertEqual(
            local["observedFixedCode"], "g037_creator_diag_creator_admin_only"
        )
        self.assertIs(local["roleAbsentAfterDiagnostic"], True)
        self.assertIs(local["scratchClusterMovedToRecoverableTrash"], True)
        self.assertIs(local["hostedConnectionUsed"], False)
        self.assertIn(
            "production automatic creator-membership equivalence",
            PREVIEW["notEvidenceOf"],
        )

    def test_machine_gates_require_preview_approval_then_separate_execution(self) -> None:
        attempt_sha = sha256(ATTEMPT_PATH)
        preview_sha = sha256(PREVIEW_PATH)
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertIs(gate["rollbackOnlyMembershipDiagnosticExecutionAuthorized"], False)
        self.assertIs(gate["rollbackOnlyMembershipDiagnosticExecutionConsumed"], True)
        self.assertEqual(gate["rollbackOnlyMembershipDiagnosticAttemptSha256"], attempt_sha)
        self.assertEqual(
            gate["rollbackOnlyMembershipDiagnosticFixedCode"],
            "g037_membership_diag_has_elevated_member",
        )
        self.assertEqual(
            gate["rollbackOnlyCreatorMembershipDiagnosticPreviewSha256"], preview_sha
        )
        self.assertIs(gate["rollbackOnlyCreatorMembershipDiagnosticPreviewApproved"], True)
        self.assertIs(gate["rollbackOnlyCreatorMembershipDiagnosticExecutionAuthorized"], False)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)

        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertEqual(
            controller["rollbackOnlyMembershipDiagnosticAttemptSha256"], attempt_sha
        )
        self.assertEqual(
            controller["rollbackOnlyCreatorMembershipDiagnosticPreviewSha256"],
            preview_sha,
        )
        self.assertIs(
            controller["rollbackOnlyCreatorMembershipDiagnosticPreviewApproved"], True
        )
        self.assertIs(
            controller["rollbackOnlyCreatorMembershipDiagnosticExecutionAuthorized"],
            False,
        )
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)

    def test_tasks_separate_execution_preview_review_and_later_authority(self) -> None:
        self.assertIn("- [x]! 7.261 ", TASKS)
        for task_id in range(268, 295):
            marker = "!" if task_id in range(270, 276) else "*" if task_id == 290 else ""
            self.assertIn(f"- [x]{marker} 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.295 ", TASKS)
        self.assertIn("- [x]! 7.296 ", TASKS)
        for task_id in range(297, 302):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)

    def test_no_automatic_execution_path_exists(self) -> None:
        diagnostic_relative = DIAGNOSTIC_PATH.relative_to(ROOT).as_posix()
        self.assertNotIn(diagnostic_relative, G037_WORKFLOW)
        self.assertEqual(SECURITY_WORKFLOW.count(diagnostic_relative), 1)

    def test_security_workflow_tracks_and_runs_focused_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-role-membership-diagnostic-authorization.v2.json",
            "backend/supabase/g037-readonly-role-membership-diagnostic-attempt.v2.json",
            "backend/supabase/g037-readonly-role-creator-membership-diagnostic-preview.v3.json",
            "backend/supabase/scripts/g037_readonly_role_creator_membership_diagnostic_v3.sql",
            "backend/supabase/tests/test_g037_readonly_role_creator_membership_diagnostic_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_creator_membership_diagnostic_source",
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
