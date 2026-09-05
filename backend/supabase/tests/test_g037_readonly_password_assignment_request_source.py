"""Source contracts for the blocked G037 password-assignment request."""

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
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
REQUEST_PATH = (
    ROOT / "backend/supabase/g037-readonly-password-assignment-authorization-request.v1.json"
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


class G037ReadonlyPasswordAssignmentRequestSourceTests(unittest.TestCase):
    def test_request_is_exact_blocked_and_non_authorizing(self) -> None:
        self.assertEqual(
            sha256(REQUEST_PATH),
            "7b3602efed38f21d68b2015c8788baa19dabebb7da9d5e30b4d845be7a8bab7f",
        )
        self.assertEqual(REQUEST["schemaVersion"], 1)
        self.assertEqual(
            REQUEST["kind"], "g037_readonly_password_assignment_authorization_request"
        )
        self.assertEqual(
            REQUEST["requestStatus"],
            "blocked_direct_endpoint_reachability_required_before_execution_authorization",
        )
        state = REQUEST["authorizationState"]
        self.assertTrue(all(value is False or value == 0 for value in state.values()))

    def test_request_binds_approval_preview_readback_and_continuity(self) -> None:
        for descriptor in (
            REQUEST["reviewApproval"],
            REQUEST["reviewedPreview"],
            REQUEST["requiredReadback"],
        ):
            self.assertEqual(descriptor["sha256"], sha256(ROOT / descriptor["path"]))
        provisioning = REQUEST["provisioningContinuity"]
        self.assertEqual(
            provisioning["attemptSha256"], sha256(ROOT / provisioning["attemptPath"])
        )
        self.assertIs(provisioning["roleProvisioned"], True)
        self.assertIs(provisioning["passwordNullAtProvisioning"], True)
        self.assertIs(provisioning["provisioningAuthorizationReusable"], False)
        network = REQUEST["networkContinuity"]
        self.assertEqual(
            network["latestAttemptSha256"],
            sha256(ROOT / network["latestAttemptPath"]),
        )
        self.assertIs(network["directEndpointReachabilityProved"], False)
        self.assertIs(network["sameHostAutomaticRetryAllowed"], False)

    def test_requested_scope_is_one_password_operation_without_secret_write(self) -> None:
        scope = REQUEST["requestedScope"]
        self.assertEqual(scope["maximumCredentialGenerationCount"], 1)
        self.assertEqual(scope["maximumPasswordAssignmentCount"], 1)
        self.assertEqual(scope["maximumDedicatedConnectionReadbackCount"], 1)
        for allowed in (
            "externalPasswordManagerGeneration",
            "interactiveNonEchoingPasswordAssignment",
            "directEncryptedDedicatedConnection",
            "boundedConnectionReadback",
        ):
            self.assertIs(scope[allowed], True)
        for denied in (
            "repositorySecretMutation",
            "repositorySecretMetadataReadback",
            "ownerSecretMutation",
            "controllerDispatch",
            "workflowDispatch",
            "migrationLedgerMutation",
            "releaseOrDeployment",
        ):
            self.assertIs(scope[denied], False)

    def test_missing_external_preconditions_prevent_authorization(self) -> None:
        preconditions = REQUEST["mandatoryPreconditions"]
        for present in (
            "reviewApprovalHashMatches",
            "previewHashMatches",
            "connectionReadbackSqlHashMatches",
            "provisioningAttemptHashMatches",
            "roleProvisionedReadbackExact",
            "priorProvisioningAuthorizationSpent",
        ):
            self.assertIs(preconditions[present], True)
        for missing in set(preconditions) - {
            "reviewApprovalHashMatches",
            "previewHashMatches",
            "connectionReadbackSqlHashMatches",
            "provisioningAttemptHashMatches",
            "roleProvisionedReadbackExact",
            "priorProvisioningAuthorizationSpent",
        }:
            self.assertIs(preconditions[missing], False)
        self.assertTrue(REQUEST["failureDiscipline"]["allPreconditionsRequiredBeforeAuthorization"])
        self.assertFalse(REQUEST["failureDiscipline"]["automaticPoolerFallback"])
        self.assertFalse(REQUEST["failureDiscipline"]["automaticIpv4AddonChange"])

    def test_machine_gates_bind_request_as_blocked(self) -> None:
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        request_sha = sha256(REQUEST_PATH)
        for gate in (CONTRACT["provisioningGate"], DECISION["controllerGate"]):
            self.assertIs(gate["passwordAssignmentAuthorizationRequestPresent"], True)
            self.assertEqual(gate["passwordAssignmentAuthorizationRequestPath"], relative)
            self.assertEqual(
                gate["passwordAssignmentAuthorizationRequestSha256"], request_sha
            )
            self.assertIs(gate["passwordAssignmentAuthorizationRequestBlocked"], True)
            self.assertIs(gate["passwordConfigurationAuthorizationPresent"], False)

    def test_tasks_docs_and_security_workflow_track_the_request(self) -> None:
        self.assertIn("- [x] 7.387 ", TASKS)
        for task_id in range(415, 420):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        request_sha = sha256(REQUEST_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(request_sha, normalized)
            self.assertIn("non-authorizing", normalized)
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_password_assignment_request_source",
            SECURITY_WORKFLOW,
        )

    def test_request_contains_no_connection_or_credential_material(self) -> None:
        raw = REQUEST_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "postgres://",
            "postgresql://",
            "db.aqlcofblfxdrjhhdmarw",
            "access_token",
            "refresh_token",
            "service_role_key",
            "database_password",
            "pooler.",
            "-----begin",
        ):
            self.assertNotIn(forbidden, raw)


if __name__ == "__main__":
    unittest.main()
