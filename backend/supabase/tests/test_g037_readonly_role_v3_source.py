"""Contracts for the consumed creator diagnostic and corrected G037 v3 preview."""

from __future__ import annotations

import hashlib
import json
import re
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

AUTHORIZATION_PATH = (
    ROOT
    / "backend/supabase/g037-readonly-role-creator-membership-diagnostic-authorization.v3.json"
)
ATTEMPT_PATH = (
    ROOT
    / "backend/supabase/g037-readonly-role-creator-membership-diagnostic-attempt.v3.json"
)
PREVIEW_PATH = ROOT / "backend/supabase/g037-readonly-role-provisioning-preview.v3.json"
PROVISIONING_PATH = (
    ROOT / "backend/supabase/scripts/g037_readonly_role_provisioning_v3.sql"
)
READBACK_PATH = ROOT / "backend/supabase/scripts/g037_readonly_role_readback_v3.sql"
CONTROLLER_PATH = ROOT / "backend/supabase/scripts/g037_hosted_closure_executor.py"
CONTRACT_PATH = ROOT / "backend/supabase/g037-readonly-credential-contract.v1.json"
DECISION_PATH = ROOT / "backend/supabase/hosted-db-access-decision.v1.json"

AUTHORIZATION = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
DECISION = json.loads(DECISION_PATH.read_text(encoding="utf-8"))
PROVISIONING = PROVISIONING_PATH.read_text(encoding="utf-8")
READBACK = READBACK_PATH.read_text(encoding="utf-8")
CONTROLLER = CONTROLLER_PATH.read_text(encoding="utf-8")


from backend.supabase.tests.g037_reviewed_artifacts import reviewed_sha256 as sha256


class G037ReadonlyRoleV3SourceTests(unittest.TestCase):
    def test_v2_evidence_is_byte_exact_and_immutable(self) -> None:
        expected = {
            "backend/supabase/g037-readonly-role-provisioning-preview.v2.json": (
                "9351623d80b179e46b335e65a6fd67faf86485783fa7e5e1117022cef4261fb3"
            ),
            "backend/supabase/scripts/g037_readonly_role_provisioning_v2.sql": (
                "b4241fa478ac287ba418a8a53cc826ccba4dc9b72eafe536c0c8aabad08cfdc3"
            ),
            "backend/supabase/scripts/g037_readonly_role_readback_v2.sql": (
                "62958564bcdef69cb7114b3c95d8f4e93e366468bcdc9ab060d82ab7c7a7e26b"
            ),
            "backend/supabase/g037-readonly-role-apply-attempt.v2.json": (
                "52d4e75d479810ffd35f0fec848f5759d3b3f4996349ea04a9dfa3869db5a175"
            ),
            "backend/supabase/g037-readonly-role-apply-authorization.v2.json": (
                "7178b0bb2dd01a00c0d6f01d608564432fd002ad6a21f0677abd57613995ed1d"
            ),
            "backend/supabase/g037-readonly-role-preview-approval.v2.json": (
                "b579b7d11c2d82cef6e8502472399de341512b5d7ce08201354e19b018645dd8"
            ),
        }
        for relative, digest in expected.items():
            with self.subTest(path=relative):
                self.assertEqual(sha256(ROOT / relative), digest)

    def test_creator_diagnostic_authorization_is_exact_narrow_and_consumed(self) -> None:
        self.assertEqual(
            sha256(AUTHORIZATION_PATH),
            "25c763681bc2c3d141be7c363c945c16ff3c2aa3159d89f770361731b8a31254",
        )
        self.assertEqual(AUTHORIZATION["schemaVersion"], 3)
        self.assertEqual(AUTHORIZATION["approverDisplayName"], "최연우")
        scope = AUTHORIZATION["authorizedScope"]
        self.assertEqual(scope["maximumExecutionCount"], 1)
        self.assertIs(scope["productionRollbackOnlyCreatorMembershipDiagnostic"], True)
        self.assertIs(scope["immediateBoundedReadback"], True)
        for denied in (
            "persistentProvisioning",
            "passwordConfiguration",
            "repositorySecretMutation",
            "workflowDispatch",
            "migrationLedgerMutation",
        ):
            self.assertIs(scope[denied], False)

        self.assertEqual(
            sha256(ATTEMPT_PATH),
            "cb1398d04e5c943a1780b03380d7d4ea61ee86e0afb45fb89877684b4393613e",
        )
        attempt_authorization = ATTEMPT["authorization"]
        self.assertEqual(attempt_authorization["authorizationSha256"], sha256(AUTHORIZATION_PATH))
        self.assertEqual(attempt_authorization["approvedExecutionCount"], 1)
        self.assertEqual(attempt_authorization["consumedExecutionCount"], 1)

    def test_attempt_retains_only_fixed_result_and_bounded_rollback_proof(self) -> None:
        for key in (
            "projectActiveHealthy",
            "databaseExact",
            "roleAbsent",
            "migrationLedgerPresent",
            "targetFunctionPresent",
            "migrationCountExact",
            "terminalMigrationExact",
        ):
            self.assertIs(ATTEMPT["preexecutionReadback"][key], True)
        self.assertEqual(ATTEMPT["preexecutionReadback"]["postgresMajorVersion"], 17)
        self.assertEqual(
            ATTEMPT["outcome"],
            {
                "status": "rolled_back",
                "fixedCode": "g037_creator_diag_creator_admin_only",
                "fixedCodeAllowlisted": True,
                "transactionCommitObserved": False,
                "persistentRolePresentAfterDiagnostic": False,
                "persistentHostedStateChanged": False,
                "providerErrorRetained": False,
            },
        )
        self.assertEqual(
            ATTEMPT["rollbackReadback"],
            {
                "queryExecutionCount": 1,
                "resultWrapperParseSucceeded": True,
                "roleAbsent": True,
                "migrationCount": 50,
                "terminalMigrationVersion": "20260804000500",
            },
        )

    def test_attempt_records_exact_safe_creator_membership_shape_without_identity(self) -> None:
        self.assertEqual(
            ATTEMPT["diagnosisBoundary"],
            {
                "parentMembershipCount": 0,
                "memberCount": 1,
                "memberIsCurrentUser": True,
                "currentUserIsNonSuperuserCreateRole": True,
                "grantorIsSuperuser": True,
                "adminOption": True,
                "setOption": False,
                "inheritOption": False,
                "automaticCreatorMembershipObservableShapeMatched": True,
                "bootstrapGrantorIdentityRecorded": False,
                "memberRoleIdentityRecorded": False,
                "memberRoleNameRecorded": False,
            },
        )
        retry = ATTEMPT["retryGate"]
        self.assertIs(retry["creatorMembershipDiagnosticV3RetryAllowed"], False)
        self.assertIs(retry["authorizationReusable"], False)
        self.assertIs(retry["correctedProvisioningV3PreviewRequired"], True)
        self.assertIs(retry["freshProvisioningPreviewApprovalRequired"], True)
        self.assertIs(retry["freshProvisioningExecutionAuthorizationRequired"], True)

    def test_v3_preview_binds_every_current_source_and_superseded_attempt(self) -> None:
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "bf1913e5b0cfffaad856e4080939d21e7d11d60fee4f2c333c92c3c9ca219ff9",
        )
        self.assertEqual(PREVIEW["schemaVersion"], 3)
        self.assertEqual(
            PREVIEW["failedApplyAttempt"]["sha256"],
            sha256(ROOT / PREVIEW["failedApplyAttempt"]["path"]),
        )
        self.assertEqual(PREVIEW["diagnosticBasis"]["sha256"], sha256(ATTEMPT_PATH))
        for descriptor, path in (
            (PREVIEW["provisioningSql"], PROVISIONING_PATH),
            (PREVIEW["readbackSql"], READBACK_PATH),
            (PREVIEW["controllerAdmission"], CONTROLLER_PATH),
        ):
            self.assertEqual(descriptor["path"], path.relative_to(ROOT).as_posix())
            self.assertEqual(descriptor["sha256"], sha256(path))

    def test_v3_provisioning_is_transactional_external_and_minimally_granted(self) -> None:
        executable = re.sub(r"(?m)^\s*--.*$", "", PROVISIONING)
        normalized = " ".join(PROVISIONING.split())
        self.assertEqual(PREVIEW["provisioningSql"]["topLevelStatementCount"], 16)
        self.assertEqual(len(re.findall(r"(?im)^BEGIN;", executable)), 1)
        self.assertEqual(len(re.findall(r"(?im)^COMMIT;", executable)), 1)
        self.assertNotRegex(executable, r"(?im)^ROLLBACK;")
        self.assertIn("PASSWORD NULL", PROVISIONING)
        self.assertIn("NOINHERIT", PROVISIONING)
        self.assertEqual(len(re.findall(r"(?im)^GRANT\s", PROVISIONING)), 3)
        self.assertIn("GRANT CONNECT ON DATABASE postgres", normalized)
        self.assertIn("GRANT USAGE ON SCHEMA supabase_migrations", normalized)
        self.assertIn(
            "GRANT SELECT (version, name, statements) ON TABLE "
            "supabase_migrations.schema_migrations",
            normalized,
        )
        self.assertNotRegex(
            executable,
            r"(?i)(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+)?"
            r"supabase_migrations\.schema_migrations",
        )
        self.assertIs(PREVIEW["sourceBoundary"]["isSupabaseMigration"], False)
        self.assertIs(PREVIEW["sourceBoundary"]["automaticExecutionPathPresent"], False)
        self.assertNotIn(PROVISIONING_PATH.relative_to(ROOT).as_posix(), G037_WORKFLOW)

    def test_v3_provisioning_requires_all_eight_membership_predicates(self) -> None:
        expected = (
            "parent_membership_count <> 0",
            "member_count <> 1",
            "current_user_member_count <> 1",
            "current_user_nonsuperuser_createrole_count <> 1",
            "superuser_grantor_count <> 1",
            "admin_option_count <> 1",
            "set_option_count <> 0",
            "inherit_option_count <> 0",
        )
        for predicate in expected:
            self.assertEqual(
                len(re.findall(rf"(?m)^\s+OR {re.escape(predicate)}$", PROVISIONING)),
                1,
            )
        self.assertEqual(PREVIEW["correction"]["provisioningMembershipPredicateCount"], 8)
        for unchanged in (
            "grantSetChanged",
            "rolePropertiesChanged",
            "transactionBoundaryChanged",
        ):
            self.assertIs(PREVIEW["correction"][unchanged], False)

    def test_v3_readback_is_one_bounded_mutation_free_statement(self) -> None:
        self.assertEqual(PREVIEW["readbackSql"]["topLevelStatementCount"], 1)
        self.assertIs(PREVIEW["readbackSql"]["mutationFree"], True)
        self.assertIs(PREVIEW["readbackSql"]["boundedOutput"], True)
        executable = re.sub(r"(?m)^\s*--.*$", "", READBACK)
        self.assertNotRegex(
            executable,
            r"(?im)^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b",
        )
        for key in (
            "parent_membership_count",
            "member_count",
            "member_is_current_user",
            "current_user_nonsuperuser_createrole",
            "grantor_superuser",
            "admin_option",
            "no_set_option",
            "no_inherit_option",
            "creator_membership_shape_exact",
        ):
            self.assertEqual(READBACK.count(f"'{key}'"), 1)
        self.assertEqual(READBACK.count("role_row.rolname"), 1)
        self.assertNotIn("'role_name'", READBACK)

    def test_controller_requires_thirty_three_checks_and_strict_null_acl(self) -> None:
        self.assertEqual(
            sha256(CONTROLLER_PATH),
            "188095df7df30edbe890d3cb0df9b1d69f59b7942dd449ae5f0b7b8fad5e89b0",
        )
        self.assertEqual(PREVIEW["controllerAdmission"]["predicateCount"], 33)
        self.assertIn("if rows != [(True,)*33]", CONTROLLER)
        for predicate in (
            "parent_membership_count FROM membership_shape)=0",
            "member_count FROM membership_shape)=1",
            "member_nonsuperuser_createrole_count FROM membership_shape)=1",
            "superuser_grantor_count FROM membership_shape)=1",
            "admin_option_count FROM membership_shape)=1",
            "set_option_count FROM membership_shape)=0",
            "inherit_option_count FROM membership_shape)=0",
        ):
            self.assertIn(predicate, CONTROLLER)
        self.assertEqual(
            CONTROLLER.count("pg_catalog.aclexplode(attribute_row.attacl)"), 2
        )
        self.assertNotIn("COALESCE(attribute_row.attacl", CONTROLLER)
        self.assertNotIn(PROVISIONING_PATH.relative_to(ROOT).as_posix(), G037_WORKFLOW)

    def test_local_validation_and_syntax_evidence_are_explicitly_bounded(self) -> None:
        self.assertEqual(
            PREVIEW["syntaxValidation"],
            {
                "parser": "pglast",
                "parserVersion": "7.10",
                "provisioningStatementCount": 16,
                "readbackStatementCount": 1,
                "hostedConnectionUsed": False,
            },
        )
        self.assertEqual(
            PREVIEW["localValidation"],
            {
                "postgresVersion": "17.11",
                "executorPrivilegeClass": "database_owner_nonsuperuser_createrole",
                "provisioningCommitted": True,
                "rolePresentAfterApply": True,
                "creatorMembershipShapeExact": True,
                "targetExecuteDenied": True,
                "ownedObjectCount": 0,
                "scratchClusterMovedToRecoverableTrash": True,
                "hostedConnectionUsed": False,
            },
        )

    def test_machine_gates_stop_after_role_only_apply(self) -> None:
        preview_sha = sha256(PREVIEW_PATH)
        gate = CONTRACT["provisioningGate"]
        controller = DECISION["controllerGate"]
        self.assertEqual(
            gate["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertEqual(gate["currentPreviewSha256"], preview_sha)
        self.assertEqual(controller["currentReadonlyCredentialPreviewSha256"], preview_sha)
        self.assertIs(gate["currentPreviewOwnerApprovalPresent"], True)
        self.assertIs(controller["currentReadonlyCredentialPreviewApproved"], True)
        self.assertIs(gate["correctedProvisioningV3PreviewApproved"], True)
        self.assertIs(gate["hostedApplyAuthorizationPresent"], True)
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)
        self.assertIs(gate["roleReadbackPresent"], True)
        for closed in (
            gate["repositorySecretPresent"],
            gate["controllerRetryAuthorized"],
        ):
            self.assertIs(closed, False)

    def test_tasks_docs_and_security_workflow_are_current(self) -> None:
        self.assertIn("- [x]! 7.296 ", TASKS)
        for task_id in range(302, 335):
            marker = "!" if task_id in range(304, 310) else "*" if task_id in (329, 330) else ""
            self.assertIn(f"- [x]{marker} 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.335 ", TASKS)
        self.assertIn("- [x]! 7.336 ", TASKS)
        for task_id in range(337, 342):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            for digest in (
                sha256(PREVIEW_PATH),
                sha256(PROVISIONING_PATH),
                sha256(READBACK_PATH),
                sha256(CONTROLLER_PATH),
            ):
                self.assertIn(digest, normalized)
        paths = (
            AUTHORIZATION_PATH,
            ATTEMPT_PATH,
            PREVIEW_PATH,
            PROVISIONING_PATH,
            READBACK_PATH,
        )
        for path in paths:
            relative = path.relative_to(ROOT).as_posix()
            self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_v3_source",
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
