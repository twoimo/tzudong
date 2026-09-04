"""Source contracts for the bounded hosted database access confirmation."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
REQUIREMENTS = (SPEC / "requirements.md").read_text(encoding="utf-8")
DESIGN = (SPEC / "design.md").read_text(encoding="utf-8")
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
CONTROLLER_WORKFLOW = (
    ROOT / ".github/workflows/g037-hosted-closure.yml"
).read_text(encoding="utf-8")
DECISION_PATH = ROOT / "backend/supabase/hosted-db-access-decision.v1.json"
DECISION = json.loads(DECISION_PATH.read_text(encoding="utf-8"))


class HostedDatabaseAccessDecisionSourceTests(unittest.TestCase):
    def test_provisioning_prerequisite_closes_without_execution_claim(self) -> None:
        self.assertIn(
            "- [x]! 7.36 Obtain an owner-restricted production DB URL",
            TASKS,
        )
        self.assertIn(
            "- [ ]! 7.37 Run canonical protected read-only controller modes",
            TASKS,
        )
        for completed_id in range(105, 117):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        self.assertIn("without dispatching it", TASKS)
        self.assertIn("separate exact-revision authorization", TASKS)

    def test_requirement_keeps_confirmation_metadata_and_run_separate(self) -> None:
        normalized = " ".join(REQUIREMENTS.split())
        for expected in (
            "credential-provisioning prerequisite",
            "Repository-secret metadata must be read without the value",
            "shall count as a successful connection",
            "requires a separate authorization",
            "freshly read exact `main` SHA",
            "sanitized external receipt",
        ):
            self.assertIn(expected, normalized)

    def test_design_records_bounded_readback_and_expiry(self) -> None:
        normalized = " ".join(DESIGN.split())
        for expected in (
            "named owner 최연우 confirmed",
            "current production database credential",
            "restricted to the owner and approved operators",
            "secret value was neither requested nor returned",
            "This is an observation only and expires if `main` moves",
            "Neither side proves that the credential connects successfully",
            "task 7.37 remains open",
        ):
            self.assertIn(expected, normalized)

    def test_machine_readable_confirmation_is_exact_and_bounded(self) -> None:
        self.assertEqual(
            set(DECISION),
            {
                "schemaVersion",
                "kind",
                "repository",
                "projectRef",
                "secretName",
                "scope",
                "notEvidenceOf",
                "ownerConfirmation",
                "databaseRoleConfirmation",
                "repositorySecretMetadata",
                "sourceRevisionObservation",
                "controllerGate",
            },
        )
        self.assertEqual(DECISION["schemaVersion"], 1)
        self.assertEqual(
            DECISION["kind"], "supabase_hosted_database_access_decision"
        )
        self.assertEqual(DECISION["repository"], "twoimo/tzudong")
        self.assertEqual(DECISION["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(DECISION["secretName"], "SUPABASE_DB_URL")
        self.assertEqual(
            DECISION["ownerConfirmation"],
            {
                "approverDisplayName": "최연우",
                "credentialState": "current",
                "databaseEnvironment": "production",
                "accessRestriction": "owner_and_approved_operators",
                "evidenceBoundary": (
                    "user-provided named-owner confirmation in the current task "
                    "transcript; no secret value or immutable external receipt"
                ),
            },
        )
        self.assertEqual(
            DECISION["databaseRoleConfirmation"],
            {
                "privilegeClass": "database_owner",
                "ownerPrivilegesPresent": True,
                "roleNameRecorded": False,
                "evidenceBoundary": (
                    "user-provided privilege-class confirmation in the current "
                    "task transcript"
                ),
            },
        )
        self.assertEqual(
            DECISION["repositorySecretMetadata"],
            {
                "present": True,
                "provider": "github_actions_repository_secret",
                "updatedAt": "2026-08-27T17:55:52Z",
                "observedAt": "2026-09-04T04:47:08Z",
                "valueRead": False,
            },
        )
        self.assertEqual(
            DECISION["sourceRevisionObservation"],
            {
                "remoteRef": "refs/heads/main",
                "commitSha": "3d7557f6307c9f6696018324e559bff6e57afbce",
                "workflowPresent": True,
                "observationOnly": True,
            },
        )
        self.assertEqual(
            DECISION["controllerGate"]["allowedReadOnlyModes"],
            ["preflight", "readback", "runtime-probe", "reconciliation-readback"],
        )
        self.assertEqual(
            DECISION["controllerGate"]["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertEqual(
            DECISION["controllerGate"]["replacementSecretName"],
            "SUPABASE_G037_READONLY_DB_URL",
        )
        self.assertIs(
            DECISION["controllerGate"]["forbidFallbackToOwnerSecret"], True
        )
        self.assertIs(
            DECISION["controllerGate"]["priorReadonlyCredentialPreviewApproved"],
            True,
        )
        self.assertIs(
            DECISION["controllerGate"]["currentReadonlyCredentialPreviewApproved"],
            True,
        )
        self.assertIs(
            DECISION["controllerGate"]["hostedApplyAuthorizationPresent"], True
        )
        self.assertIs(
            DECISION["controllerGate"]["failedApplyAttemptRecorded"], True
        )
        self.assertEqual(DECISION["controllerGate"]["failedApplyAttemptCount"], 2)
        self.assertIs(
            DECISION["controllerGate"]["rollbackOnlyDiagnosticPreviewPresent"],
            True,
        )
        self.assertIs(
            DECISION["controllerGate"]["rollbackOnlyDiagnosticPreviewApproved"],
            True,
        )
        self.assertIs(
            DECISION["controllerGate"][
                "rollbackOnlyDiagnosticExecutionAuthorized"
            ],
            False,
        )

    def test_artifact_contains_no_secret_value_or_connection_string(self) -> None:
        raw = DECISION_PATH.read_text(encoding="utf-8").lower()
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

    def test_controller_is_exact_revision_and_read_only(self) -> None:
        self.assertIn(
            "github.repository == 'twoimo/tzudong' && github.ref == 'refs/heads/main' && github.sha == inputs.commit_sha",
            CONTROLLER_WORKFLOW,
        )
        self.assertIn(
            "options: [validate, preflight, readback, runtime-probe, reconciliation-readback]",
            CONTROLLER_WORKFLOW,
        )
        self.assertIn(
            "SUPABASE_G037_READONLY_DB_URL: ${{ secrets.SUPABASE_G037_READONLY_DB_URL }}",
            CONTROLLER_WORKFLOW,
        )
        self.assertIn(
            "--db-env SUPABASE_G037_READONLY_DB_URL", CONTROLLER_WORKFLOW
        )
        self.assertNotIn("secrets.SUPABASE_DB_URL", CONTROLLER_WORKFLOW)
        self.assertNotIn("workflow_run:", CONTROLLER_WORKFLOW)
        self.assertNotIn("schedule:", CONTROLLER_WORKFLOW)

    def test_security_workflow_runs_this_contract(self) -> None:
        for path in (
            "backend/supabase/hosted-db-access-decision.v1.json",
            "backend/supabase/tests/test_hosted_db_access_decision_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_hosted_db_access_decision_source",
            SECURITY_WORKFLOW,
        )


if __name__ == "__main__":
    unittest.main()
