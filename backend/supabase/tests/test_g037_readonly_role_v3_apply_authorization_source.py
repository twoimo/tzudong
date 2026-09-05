"""Source contracts for the one-time G037 provisioning v3 authorization."""

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
G037_WORKFLOW = (ROOT / ".github/workflows/g037-hosted-closure.yml").read_text(
    encoding="utf-8"
)
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
AUTHORIZATION_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-apply-authorization.v3.json"
)
AUTHORIZATION = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
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


from backend.supabase.tests.g037_reviewed_artifacts import reviewed_sha256 as sha256


class G037ReadonlyRoleV3ApplyAuthorizationSourceTests(unittest.TestCase):
    def test_named_owner_authorization_is_exact_and_one_time(self) -> None:
        self.assertEqual(
            sha256(AUTHORIZATION_PATH),
            "0bf534d0db55f220d25fdbf9a9e727c3b665b32f7d5ea6ca9989d70f3fe20adb",
        )
        self.assertEqual(AUTHORIZATION["schemaVersion"], 3)
        self.assertEqual(
            AUTHORIZATION["kind"], "g037_readonly_role_apply_authorization"
        )
        self.assertEqual(AUTHORIZATION["repository"], "twoimo/tzudong")
        self.assertEqual(AUTHORIZATION["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(AUTHORIZATION["databaseName"], "postgres")
        self.assertEqual(AUTHORIZATION["approverDisplayName"], "최연우")
        self.assertEqual(AUTHORIZATION["authorizedAt"], "2026-09-04T09:35:17Z")
        self.assertIn(
            "immediately preceding hash-bound production apply request",
            AUTHORIZATION["authorizationEvidenceBoundary"],
        )

    def test_authorization_binds_request_approval_and_all_reviewed_sources(self) -> None:
        for descriptor in (
            AUTHORIZATION["authorizationRequest"],
            AUTHORIZATION["previewApproval"],
            AUTHORIZATION["authorizedArtifact"],
            AUTHORIZATION["requiredReadback"],
            AUTHORIZATION["reviewedControllerAdmission"],
        ):
            path = ROOT / descriptor["path"]
            self.assertEqual(descriptor["sha256"], sha256(path))
        continuity = AUTHORIZATION["continuity"]
        for prefix in (
            "failedApplyAttempt",
            "creatorMembershipDiagnosticAuthorization",
            "creatorMembershipDiagnosticAttempt",
        ):
            path = ROOT / continuity[f"{prefix}Path"]
            self.assertEqual(continuity[f"{prefix}Sha256"], sha256(path))
        self.assertIs(continuity["allPriorExecutionAuthorizationsReusable"], False)

    def test_authorized_scope_is_exact_and_downstream_actions_remain_denied(self) -> None:
        scope = AUTHORIZATION["authorizedScope"]
        self.assertEqual(scope["maximumProvisioningExecutionCount"], 1)
        self.assertIs(scope["productionProvisioningV3"], True)
        self.assertIs(scope["immediateBoundedReadbackV3"], True)
        self.assertEqual(AUTHORIZATION["requiredReadback"]["maximumExecutionCount"], 1)
        self.assertIs(AUTHORIZATION["requiredReadback"]["boundedFixedKeysOnly"], True)
        self.assertIs(
            AUTHORIZATION["reviewedControllerAdmission"]["executionAuthorized"],
            False,
        )
        for denied in (
            "passwordConfiguration",
            "credentialGeneration",
            "repositorySecretMutation",
            "controllerDispatch",
            "workflowDispatch",
            "migrationLedgerMutation",
            "releaseOrDeployment",
        ):
            self.assertIs(scope[denied], False)

    def test_all_preconditions_and_terminal_failure_discipline_are_exact(self) -> None:
        self.assertEqual(len(AUTHORIZATION["preconditions"]), 14)
        self.assertTrue(all(AUTHORIZATION["preconditions"].values()))
        self.assertEqual(
            AUTHORIZATION["executionDiscipline"],
            {
                "consumeAuthorizationBeforeSql": True,
                "retryUnderSameAuthorization": False,
                "ambiguousCommitRetryAllowed": False,
                "providerErrorRetention": False,
                "fixedCodeOrBoundedReadbackOnly": True,
            },
        )
        self.assertEqual(
            AUTHORIZATION["executionStateAtAuthorization"],
            {
                "approvedExecutionCount": 1,
                "consumedExecutionCount": 0,
                "hostedApplyPerformed": False,
                "postapplyReadbackPerformed": False,
                "persistentHostedStateChanged": False,
            },
        )

    def test_machine_gates_retain_consumed_authorization_after_apply(self) -> None:
        authorization_sha = sha256(AUTHORIZATION_PATH)
        relative = AUTHORIZATION_PATH.relative_to(ROOT).as_posix()
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(
            gate["status"], "credential_custody_review_approved_direct_endpoint_reachability_required"
        )
        self.assertIs(gate["hostedApplyAuthorizationPresent"], True)
        self.assertEqual(gate["hostedApplyAuthorizationPath"], relative)
        self.assertEqual(gate["hostedApplyAuthorizationSha256"], authorization_sha)
        self.assertEqual(gate["hostedApplyApprovedExecutionCount"], 1)
        self.assertEqual(gate["hostedApplyConsumedExecutionCount"], 1)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)
        self.assertIs(gate["controllerRetryAuthorized"], False)

        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)
        self.assertEqual(controller["hostedApplyAuthorizationPath"], relative)
        self.assertEqual(controller["hostedApplyAuthorizationSha256"], authorization_sha)
        self.assertEqual(controller["hostedApplyApprovedExecutionCount"], 1)
        self.assertEqual(controller["hostedApplyConsumedExecutionCount"], 1)

    def test_tasks_docs_and_workflow_preserve_the_execution_boundary(self) -> None:
        self.assertIn("- [x]! 7.336 ", TASKS)
        self.assertIn("- [x]! 7.352 ", TASKS)
        self.assertIn("- [x] 7.353 ", TASKS)
        self.assertIn("- [x] 7.354 ", TASKS)
        self.assertIn("- [x]! 7.355 ", TASKS)
        authorization_sha = sha256(AUTHORIZATION_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(authorization_sha, normalized)
            self.assertIn("exactly one", normalized)
        relative = AUTHORIZATION_PATH.relative_to(ROOT).as_posix()
        self.assertNotIn(relative, G037_WORKFLOW)
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_v3_apply_authorization_source",
            SECURITY_WORKFLOW,
        )

    def test_authorization_contains_no_connection_or_credential_material(self) -> None:
        raw = AUTHORIZATION_PATH.read_text(encoding="utf-8").lower()
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
