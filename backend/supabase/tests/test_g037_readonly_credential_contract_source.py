"""Source contracts for the G037 owner/read-only credential split."""

from __future__ import annotations

import json
import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
REQUIREMENTS = (SPEC / "requirements.md").read_text(encoding="utf-8")
DESIGN = (SPEC / "design.md").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github/workflows/g037-hosted-closure.yml").read_text(
    encoding="utf-8"
)
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
EXECUTOR = (
    ROOT / "backend/supabase/scripts/g037_hosted_closure_executor.py"
).read_text(encoding="utf-8")
CONTRACT_PATH = ROOT / "backend/supabase/g037-readonly-credential-contract.v1.json"
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
PREVIEW_PATH = ROOT / "backend/supabase/g037-readonly-role-provisioning-preview.v1.json"
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
PROVISIONING_PATH = ROOT / "backend/supabase/scripts/g037_readonly_role_provisioning.sql"
PROVISIONING = PROVISIONING_PATH.read_text(encoding="utf-8")
READBACK_PATH = ROOT / "backend/supabase/scripts/g037_readonly_role_readback.sql"
READBACK = READBACK_PATH.read_text(encoding="utf-8")


class G037ReadonlyCredentialContractSourceTests(unittest.TestCase):
    def test_owner_confirmation_closes_source_tasks_but_not_hosted_work(self) -> None:
        self.assertIn("- [x]! 7.152 ", TASKS)
        for completed_id in range(153, 163):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        self.assertIn("- [x] 7.163 ", TASKS)
        self.assertIn("- [x]! 7.164 ", TASKS)
        for completed_id in (165, 166, 167):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        for open_id in (168, 169):
            self.assertIn(f"- [ ]! 7.{open_id} ", TASKS)
        for completed_id in range(170, 186):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        self.assertIn("- [x]! 7.186 ", TASKS)
        self.assertIn("- [x]! 7.188 ", TASKS)
        for completed_id in (187, *range(189, 195)):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        for open_id in (195,):
            self.assertIn(f"- [ ]! 7.{open_id} ", TASKS)
        self.assertIn("- [x]* 7.196 ", TASKS)
        self.assertIn("owner privileges without recording its value or role name", TASKS)
        self.assertIn("prohibit fallback to `SUPABASE_DB_URL`", TASKS)

    def test_requirement_and_design_separate_owner_and_readonly_credentials(self) -> None:
        requirement = " ".join(REQUIREMENTS.split())
        design = " ".join(DESIGN.split())
        for expected in (
            "database-owner credential shall not be admitted",
            "distinct repository secret",
            "no database ownership, superuser, BYPASSRLS, CREATEROLE, CREATEDB",
            "must never fall back to `SUPABASE_DB_URL`",
            "Preview → Confirm → Apply → Readback → Audit",
        ):
            self.assertIn(expected, requirement)
        for expected in (
            "current `SUPABASE_DB_URL` database role has owner privileges",
            "independent least-privilege blocker",
            "changes only G037 to `SUPABASE_G037_READONLY_DB_URL`",
            "new role and secret do not yet exist",
        ):
            self.assertIn(expected, design)

    def test_machine_contract_has_exact_closed_role_and_receipt_scope(self) -> None:
        self.assertEqual(
            set(CONTRACT),
            {
                "schemaVersion",
                "kind",
                "repository",
                "projectRef",
                "workflow",
                "secretName",
                "forbiddenFallbackSecretName",
                "roleNameSha256",
                "requiredRoleProperties",
                "requiredReadScope",
                "prohibitedScope",
                "receiptBoundary",
                "provisioningGate",
            },
        )
        self.assertEqual(CONTRACT["schemaVersion"], 1)
        self.assertEqual(
            CONTRACT["kind"], "g037_readonly_database_credential_contract"
        )
        self.assertEqual(CONTRACT["repository"], "twoimo/tzudong")
        self.assertEqual(CONTRACT["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(CONTRACT["secretName"], "SUPABASE_G037_READONLY_DB_URL")
        self.assertEqual(CONTRACT["forbiddenFallbackSecretName"], "SUPABASE_DB_URL")
        self.assertEqual(
            CONTRACT["roleNameSha256"],
            hashlib.sha256(b"tzudong_g037_readonly").hexdigest(),
        )
        self.assertEqual(
            CONTRACT["requiredRoleProperties"],
            {
                "login": True,
                "inherit": False,
                "databaseOwner": False,
                "superuser": False,
                "bypassRls": False,
                "createRole": False,
                "createDb": False,
                "replication": False,
                "targetMutatorExecute": False,
                "defaultTransactionReadOnly": True,
                "connectionLimit": 1,
            },
        )
        self.assertEqual(
            CONTRACT["provisioningGate"]["status"],
            "credential_custody_review_approved_direct_endpoint_reachability_required",
        )
        self.assertIs(
            CONTRACT["provisioningGate"]["priorPreviewOwnerApprovalPresent"], True
        )
        self.assertIs(
            CONTRACT["provisioningGate"]["currentPreviewOwnerApprovalPresent"],
            True,
        )
        self.assertIs(
            CONTRACT["provisioningGate"]["hostedApplyAuthorizationPresent"], True
        )
        self.assertIs(
            CONTRACT["provisioningGate"]["failedApplyAttemptRecorded"], True
        )
        self.assertEqual(CONTRACT["provisioningGate"]["failedApplyAttemptCount"], 2)
        self.assertIs(
            CONTRACT["provisioningGate"]["rollbackOnlyDiagnosticPreviewPresent"],
            True,
        )
        self.assertIs(
            CONTRACT["provisioningGate"]["rollbackOnlyDiagnosticPreviewApproved"],
            True,
        )
        self.assertIs(
            CONTRACT["provisioningGate"][
                "rollbackOnlyDiagnosticExecutionAuthorized"
            ],
            False,
        )
        self.assertIs(CONTRACT["provisioningGate"]["repositorySecretPresent"], False)
        self.assertIs(CONTRACT["provisioningGate"]["roleReadbackPresent"], True)
        self.assertIs(CONTRACT["provisioningGate"]["controllerRetryAuthorized"], False)

    def test_workflow_and_executor_have_no_owner_secret_fallback(self) -> None:
        expected = "SUPABASE_G037_READONLY_DB_URL"
        self.assertIn(f"{expected}: ${{{{ secrets.{expected} }}}}", WORKFLOW)
        self.assertIn(f"--db-env {expected}", WORKFLOW)
        self.assertNotIn("secrets.SUPABASE_DB_URL", WORKFLOW)
        self.assertIn(f'default="{expected}"', EXECUTOR)
        self.assertNotIn('default="SUPABASE_DB_URL"', EXECUTOR)
        self.assertIn("readonly_role_admission(cur)", EXECUTOR)
        self.assertIn("readonly_role_contract_denied", EXECUTOR)

    def test_provisioning_preview_is_exact_hash_bound_and_not_executed(self) -> None:
        self.assertEqual(PREVIEW["schemaVersion"], 1)
        self.assertEqual(PREVIEW["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(
            PREVIEW["roleNameSha256"],
            hashlib.sha256(b"tzudong_g037_readonly").hexdigest(),
        )
        for descriptor, path in (
            (PREVIEW["provisioningSql"], PROVISIONING_PATH),
            (PREVIEW["readbackSql"], READBACK_PATH),
        ):
            self.assertEqual(descriptor["path"], path.relative_to(ROOT).as_posix())
            self.assertEqual(
                descriptor["sha256"], hashlib.sha256(path.read_bytes()).hexdigest()
            )
        self.assertEqual(
            PREVIEW["approvalGate"],
            {
                "status": "preview_complete_owner_approval_required",
                "previewExecuted": False,
                "hostedStateChanged": False,
                "credentialConfigured": False,
                "repositorySecretChanged": False,
                "controllerRetryAuthorized": False,
            },
        )
        self.assertIs(PREVIEW["sourceBoundary"]["isSupabaseMigration"], False)
        self.assertIs(
            PREVIEW["sourceBoundary"]["automaticExecutionPathPresent"], False
        )
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

    def test_provisioning_sql_has_null_password_and_only_minimal_direct_grants(self) -> None:
        normalized = " ".join(PROVISIONING.split())
        executable = re.sub(r"(?m)^\s*--.*$", "", PROVISIONING)
        self.assertIn("CREATE ROLE tzudong_g037_readonly", PROVISIONING)
        self.assertIn("PASSWORD NULL", PROVISIONING)
        self.assertIsNone(re.search(r"(?i)PASSWORD\s+'", PROVISIONING))
        self.assertIn("NOINHERIT", PROVISIONING)
        self.assertIn("CONNECTION LIMIT 1", PROVISIONING)
        self.assertIn("SET default_transaction_read_only = 'on'", PROVISIONING)
        self.assertIn("GRANT CONNECT ON DATABASE postgres", normalized)
        self.assertIn("GRANT USAGE ON SCHEMA supabase_migrations", normalized)
        self.assertIn(
            "GRANT SELECT (version, name, statements) ON TABLE "
            "supabase_migrations.schema_migrations",
            normalized,
        )
        self.assertEqual(len(re.findall(r"(?im)^GRANT\s", PROVISIONING)), 3)
        self.assertNotRegex(
            executable,
            r"(?i)(INSERT|UPDATE|DELETE|TRUNCATE)\s+INTO\s+supabase_migrations\.schema_migrations",
        )
        self.assertNotIn("ALTER DEFAULT PRIVILEGES", PROVISIONING.upper())
        self.assertNotIn("FROM PUBLIC", PROVISIONING.upper())

    def test_provisioning_and_readback_are_never_workflow_executed(self) -> None:
        for source_path in (PROVISIONING_PATH, READBACK_PATH):
            relative = source_path.relative_to(ROOT).as_posix()
            self.assertNotIn(relative, WORKFLOW)
            self.assertEqual(SECURITY_WORKFLOW.count(relative), 1)
        readback_without_comments = re.sub(r"(?m)^\s*--.*$", "", READBACK)
        self.assertRegex(readback_without_comments.lstrip(), r"^WITH\s")
        readback_without_literals = re.sub(
            r"'(?:''|[^'])*'", "''", readback_without_comments
        )
        self.assertNotRegex(
            readback_without_literals,
            r"(?i)\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b",
        )

    def test_contract_and_sources_contain_no_connection_or_identity_material(self) -> None:
        raw = CONTRACT_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "postgres://",
            "postgresql://",
            "access_token",
            "refresh_token",
            "service_role_key",
            "database_password",
            "@aws-",
            "pooler.",
        ):
            self.assertNotIn(forbidden, raw)

    def test_security_workflow_runs_this_contract(self) -> None:
        for path in (
            "backend/supabase/g037-readonly-credential-contract.v1.json",
            "backend/supabase/g037-readonly-role-provisioning-preview.v1.json",
            "backend/supabase/scripts/g037_readonly_role_provisioning.sql",
            "backend/supabase/scripts/g037_readonly_role_readback.sql",
            "backend/supabase/tests/test_g037_readonly_credential_contract_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_credential_contract_source",
            SECURITY_WORKFLOW,
        )


if __name__ == "__main__":
    unittest.main()
