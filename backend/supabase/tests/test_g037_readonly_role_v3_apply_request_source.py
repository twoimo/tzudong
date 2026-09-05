"""Source contracts for the non-authorizing G037 v3 apply request."""

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
REQUEST_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-apply-authorization-request.v3.json"
)
REQUEST = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
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


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class G037ReadonlyRoleV3ApplyRequestSourceTests(unittest.TestCase):
    def test_request_is_exact_and_explicitly_non_authorizing(self) -> None:
        self.assertEqual(
            sha256(REQUEST_PATH),
            "a983a4f6ca843a3dc8d5ea9991d6bb2c66de5670ddbca0c1d96ed13f17abd9ef",
        )
        self.assertEqual(REQUEST["schemaVersion"], 3)
        self.assertEqual(
            REQUEST["kind"], "g037_readonly_role_apply_authorization_request"
        )
        self.assertEqual(REQUEST["repository"], "twoimo/tzudong")
        self.assertEqual(REQUEST["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(REQUEST["databaseName"], "postgres")
        self.assertEqual(
            REQUEST["requestStatus"],
            "named_owner_one_time_production_apply_authorization_required",
        )
        state = REQUEST["authorizationState"]
        self.assertIs(state["namedOwnerAuthorizationPresent"], False)
        self.assertIs(state["authorizationArtifactPresent"], False)
        self.assertEqual(state["approvedExecutionCount"], 0)
        self.assertEqual(state["consumedExecutionCount"], 0)
        self.assertIs(state["productionSqlExecuted"], False)
        self.assertIs(state["productionReadbackPerformed"], False)
        self.assertIs(state["persistentHostedStateChanged"], False)

    def test_request_binds_approval_sources_and_consumed_history(self) -> None:
        descriptors = (
            REQUEST["reviewApproval"],
            REQUEST["requestedArtifact"],
            REQUEST["requiredReadback"],
            REQUEST["reviewedControllerAdmission"],
        )
        for descriptor in descriptors:
            path = ROOT / descriptor["path"]
            self.assertEqual(descriptor["sha256"], sha256(path))
        continuity = REQUEST["continuity"]
        for prefix in (
            "failedApplyAttempt",
            "creatorMembershipDiagnosticAuthorization",
            "creatorMembershipDiagnosticAttempt",
        ):
            path = ROOT / continuity[f"{prefix}Path"]
            self.assertEqual(continuity[f"{prefix}Sha256"], sha256(path))
        self.assertIs(continuity["allPriorExecutionAuthorizationsReusable"], False)

    def test_requested_scope_is_one_apply_one_readback_and_nothing_downstream(self) -> None:
        scope = REQUEST["requestedScope"]
        self.assertEqual(scope["maximumProvisioningExecutionCount"], 1)
        self.assertIs(scope["productionProvisioningV3"], True)
        self.assertIs(scope["immediateBoundedReadbackV3"], True)
        self.assertEqual(REQUEST["requiredReadback"]["maximumExecutionCount"], 1)
        self.assertIs(REQUEST["requiredReadback"]["boundedFixedKeysOnly"], True)
        self.assertIs(
            REQUEST["reviewedControllerAdmission"]["executionRequested"], False
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

    def test_every_precondition_is_mandatory_and_failure_is_terminal(self) -> None:
        expected_preconditions = {
            "projectMustEqualAqlcofblfxdrjhhdmarw",
            "projectMustBeActiveHealthy",
            "postgresMajorVersionMustEqual17",
            "databaseMustEqualPostgres",
            "roleMustBeAbsent",
            "migrationLedgerMustExist",
            "migrationCountMustEqual50",
            "terminalMigrationMustEqual20260804000500",
            "targetFunctionMustExist",
            "reviewApprovalHashMustMatch",
            "provisioningSqlHashMustMatch",
            "readbackSqlHashMustMatch",
            "controllerAdmissionHashMustMatch",
        }
        self.assertEqual(set(REQUEST["mandatoryPreconditions"]), expected_preconditions)
        self.assertTrue(all(REQUEST["mandatoryPreconditions"].values()))
        self.assertEqual(
            REQUEST["failureDiscipline"],
            {
                "preconditionMismatchBlocksExecution": True,
                "authorizationIsConsumedBeforeExecution": True,
                "executionRetryUnderSameAuthorization": False,
                "ambiguousCommitIsNeverRetried": True,
                "providerErrorRetention": False,
                "fixedCodeOrBoundedReadbackOnly": True,
            },
        )

    def test_machine_gates_retain_request_after_separate_authorization(self) -> None:
        request_sha = sha256(REQUEST_PATH)
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        gate = CONTRACT["provisioningGate"]
        self.assertIs(gate["hostedApplyAuthorizationRequestPresent"], True)
        self.assertEqual(gate["hostedApplyAuthorizationRequestPath"], relative)
        self.assertEqual(gate["hostedApplyAuthorizationRequestSha256"], request_sha)
        self.assertIs(gate["hostedApplyAuthorizationPresent"], True)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["roleReadbackPresent"], True)
        self.assertIs(gate["controllerRetryAuthorized"], False)

        controller = DECISION["controllerGate"]
        self.assertIs(controller["hostedApplyAuthorizationRequestPresent"], True)
        self.assertEqual(controller["hostedApplyAuthorizationRequestPath"], relative)
        self.assertEqual(
            controller["hostedApplyAuthorizationRequestSha256"], request_sha
        )
        self.assertIs(controller["hostedApplyAuthorizationPresent"], True)

    def test_tasks_docs_and_security_workflow_track_the_request(self) -> None:
        for task_id in range(342, 352):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.352 ", TASKS)
        for task_id in (353, 354):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        for task_id in (360, 361, 362):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x] 7.363 ", TASKS)
        for task_id in (355, 356, 357, 358, 359):
            self.assertIn(f"- [x]! 7.{task_id} ", TASKS)
        self.assertIn("- [x] 7.364 ", TASKS)
        self.assertIn("- [ ]! 7.365 ", TASKS)
        request_sha = sha256(REQUEST_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(request_sha, normalized)
            self.assertIn("not authorization", normalized)
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        self.assertNotIn(relative, G037_WORKFLOW)
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_v3_apply_request_source",
            SECURITY_WORKFLOW,
        )

    def test_request_contains_no_connection_or_credential_material(self) -> None:
        raw = REQUEST_PATH.read_text(encoding="utf-8").lower()
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
