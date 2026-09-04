"""Source contracts for the first exact-revision G037 runtime-probe attempt."""

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
ATTEMPT_PATH = ROOT / "backend/supabase/g037-runtime-probe-attempt.v1.json"
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))


class G037RuntimeProbeAttemptEvidenceSourceTests(unittest.TestCase):
    def test_tasks_record_one_probe_but_keep_controller_gate_open(self) -> None:
        self.assertIn(
            "- [ ]! 7.37 Run canonical protected read-only controller modes",
            TASKS,
        )
        for completed_id in range(129, 149):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        self.assertIn("Dispatch exactly one `runtime-probe`", TASKS)
        self.assertIn("prohibit an automatic retry", TASKS)

    def test_requirement_and_design_keep_all_failed_phases_unproven(self) -> None:
        requirement = " ".join(REQUIREMENTS.split())
        design = " ".join(DESIGN.split())
        for expected in (
            "status `authorization-denied`",
            "connection, function-presence, and privilege-denial states unproven",
            "closed source-defined allowlist",
            "Unknown errors shall collapse to a generic contract-denied code",
        ):
            self.assertIn(expected, requirement)
        for expected in (
            "GitHub Actions run `33839536300`",
            "runtime-probe receipt was `denied`",
            "contains neither field",
            "all remain unproven",
            "consumed authorization cannot be reused",
        ):
            self.assertIn(expected, design)

    def test_attempt_binds_exact_authorization_and_run_identity(self) -> None:
        self.assertEqual(ATTEMPT["schemaVersion"], 1)
        self.assertEqual(ATTEMPT["kind"], "g037_hosted_runtime_probe_attempt")
        self.assertEqual(ATTEMPT["repository"], "twoimo/tzudong")
        self.assertEqual(ATTEMPT["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(ATTEMPT["authorization"]["approverDisplayName"], "최연우")
        self.assertEqual(ATTEMPT["authorization"]["mode"], "runtime-probe")
        run = ATTEMPT["run"]
        self.assertEqual(run["id"], 33839536300)
        self.assertEqual(run["event"], "workflow_dispatch")
        self.assertEqual(run["headBranch"], "main")
        self.assertEqual(run["headSha"], ATTEMPT["authorization"]["commitSha"])
        self.assertEqual(run["conclusion"], "failure")

    def test_receipts_bind_external_identity_and_missing_success_evidence(self) -> None:
        validate = ATTEMPT["receipts"]["validate"]
        probe = ATTEMPT["receipts"]["runtimeProbe"]
        self.assertEqual(validate["artifactId"], 9924426677)
        self.assertEqual(validate["status"], "valid")
        self.assertEqual(
            validate["fileSha256"],
            "018b3a92bb6aaa9e05c831fa7b8bc286679e1e555ae8318e4cd21cf028f49c43",
        )
        self.assertEqual(probe["artifactId"], 9924434587)
        self.assertEqual(probe["status"], "denied")
        self.assertIs(probe["ambiguousCommit"], False)
        self.assertIs(probe["runtimeAuthorizationDeniedEvidencePresent"], False)
        self.assertEqual(
            probe["receiptSha256"],
            "2542a96f065985f08008e467d428c730a387f0c999cfcb8b3faaad7927ec9c59",
        )
        self.assertEqual(
            probe["fileSha256"],
            "efa577e54590d54669cc8c98c721e825978a1e96ffcd95f56686c39a9b67d34b",
        )

    def test_conclusions_do_not_invent_hidden_failure_phase(self) -> None:
        conclusions = ATTEMPT["conclusions"]
        for field in (
            "databaseConnectionState",
            "terminalMutatorState",
            "executePrivilegeDenialState",
        ):
            self.assertEqual(conclusions[field], "unproven")
        self.assertEqual(
            conclusions["denialCause"], "not_exposed_by_bounded_receipt"
        )
        self.assertEqual(conclusions["task7_37"], "open")
        self.assertIs(conclusions["retryRequiresNewAuthorization"], True)
        self.assertEqual(
            ATTEMPT["ownerRoleFollowup"],
            {
                "ownerPrivilegesPresent": True,
                "roleNameRecorded": False,
                "independentBlocker": (
                    "owner_credential_not_admitted_for_future_readonly_controller_runs"
                ),
                "causedThisAttemptDenial": "unproven",
                "evidenceBoundary": (
                    "user-provided privilege-class confirmation in the current "
                    "task transcript"
                ),
            },
        )

    def test_attempt_index_contains_no_credential_or_downloaded_receipt(self) -> None:
        raw = ATTEMPT_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "postgres://",
            "postgresql://",
            "access_token",
            "refresh_token",
            "service_role_key",
            "database_password",
            "supabase_db_url",
        ):
            self.assertNotIn(forbidden, raw)

    def test_security_workflow_runs_this_contract(self) -> None:
        for path in (
            "backend/supabase/g037-runtime-probe-attempt.v1.json",
            "backend/supabase/tests/test_g037_runtime_probe_attempt_evidence_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_runtime_probe_attempt_evidence_source",
            SECURITY_WORKFLOW,
        )


if __name__ == "__main__":
    unittest.main()
