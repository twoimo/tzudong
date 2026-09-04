"""Source contracts for the first exact-revision hosted G037 preflight attempt."""

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
ATTEMPT_PATH = ROOT / "backend/supabase/g037-preflight-attempt.v1.json"
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))


class G037PreflightAttemptEvidenceSourceTests(unittest.TestCase):
    def test_tasks_record_one_attempt_but_keep_controller_gate_open(self) -> None:
        self.assertIn(
            "- [ ]! 7.37 Run canonical protected read-only controller modes",
            TASKS,
        )
        for completed_id in range(117, 129):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        self.assertIn("Dispatch exactly one `preflight`", TASKS)
        self.assertIn("prohibit automatic retry", TASKS)

    def test_requirement_and_design_preserve_denial_ambiguity(self) -> None:
        requirement = " ".join(REQUIREMENTS.split())
        design = " ".join(DESIGN.split())
        for expected in (
            "status `denied` shall prove only",
            "source must not infer an invalid credential",
            "any diagnostic mode or retry requires a new explicit authorization",
        ):
            self.assertIn(expected, requirement)
        for expected in (
            "GitHub Actions run `33838590366`",
            "`preflight` receipt was `denied`",
            "`ambiguous_commit=false`",
            "`not_exposed_by_bounded_receipt`",
            "Task 7.37 remains open",
        ):
            self.assertIn(expected, design)

    def test_attempt_binds_exact_authorization_and_run_identity(self) -> None:
        self.assertEqual(ATTEMPT["schemaVersion"], 1)
        self.assertEqual(ATTEMPT["kind"], "g037_hosted_preflight_attempt")
        self.assertEqual(ATTEMPT["repository"], "twoimo/tzudong")
        self.assertEqual(ATTEMPT["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(
            ATTEMPT["authorization"],
            {
                "approverDisplayName": "최연우",
                "mode": "preflight",
                "commitSha": "3d7557f6307c9f6696018324e559bff6e57afbce",
                "evidenceBoundary": (
                    "user-provided exact-revision authorization in the current task "
                    "transcript"
                ),
            },
        )
        run = ATTEMPT["run"]
        self.assertEqual(run["id"], 33838590366)
        self.assertEqual(run["event"], "workflow_dispatch")
        self.assertEqual(run["headBranch"], "main")
        self.assertEqual(run["headSha"], ATTEMPT["authorization"]["commitSha"])
        self.assertEqual(run["conclusion"], "failure")

    def test_receipts_preserve_external_identity_and_bounded_result(self) -> None:
        validate = ATTEMPT["receipts"]["validate"]
        preflight = ATTEMPT["receipts"]["preflight"]
        self.assertEqual(validate["artifactId"], 9924134907)
        self.assertEqual(validate["status"], "valid")
        self.assertEqual(
            validate["receiptSha256"],
            "c1c045b9b5d0acecf41fbddac08a0505e4249ddf4551fa6be00d41e0a54960fa",
        )
        self.assertEqual(
            validate["fileSha256"],
            "018b3a92bb6aaa9e05c831fa7b8bc286679e1e555ae8318e4cd21cf028f49c43",
        )
        self.assertEqual(preflight["artifactId"], 9924144323)
        self.assertEqual(preflight["status"], "denied")
        self.assertIs(preflight["ambiguousCommit"], False)
        self.assertEqual(
            preflight["receiptSha256"],
            "86f40c9d892caf17fe069cf9ab9640c8491e4db4a4ddb8e454ab1a8b3d262be9",
        )
        self.assertEqual(
            preflight["fileSha256"],
            "1e612be35ffc429caff82dd7855d57ecc5a39ce5b56f46e68e7221ddc99fe960",
        )

    def test_conclusions_do_not_invent_hidden_failure_cause(self) -> None:
        self.assertEqual(
            ATTEMPT["conclusions"],
            {
                "exactRevisionMatched": True,
                "sourceValidationPassed": True,
                "secretValueRead": False,
                "mutationModeRequested": False,
                "databaseConnectionState": "unproven",
                "denialCause": "not_exposed_by_bounded_receipt",
                "task7_37": "open",
                "retryRequiresNewAuthorization": True,
            },
        )
        self.assertIn("invalid database credential", ATTEMPT["notEvidenceOf"])
        self.assertIn("successful database connection", ATTEMPT["notEvidenceOf"])
        self.assertIn("catalog or ledger conformance", ATTEMPT["notEvidenceOf"])

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
            "backend/supabase/g037-preflight-attempt.v1.json",
            "backend/supabase/tests/test_g037_preflight_attempt_evidence_source.py",
        ):
            self.assertIn(f"- '{path}'", SECURITY_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_preflight_attempt_evidence_source",
            SECURITY_WORKFLOW,
        )


if __name__ == "__main__":
    unittest.main()
