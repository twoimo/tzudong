"""Source contracts for the committed G037 provisioning v3 attempt."""

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
CONSUMPTION_PATH = (
    ROOT / "backend/supabase/g037-readonly-role-apply-consumption.v3.json"
)
ATTEMPT_PATH = ROOT / "backend/supabase/g037-readonly-role-apply-attempt.v3.json"
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
CONSUMPTION = json.loads(CONSUMPTION_PATH.read_text(encoding="utf-8"))
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


class G037ReadonlyRoleV3ApplyAttemptSourceTests(unittest.TestCase):
    def test_consumption_precedes_execution_and_is_permanently_non_reusable(self) -> None:
        self.assertEqual(
            sha256(CONSUMPTION_PATH),
            "f9400c39d77d404f89536e101e2d4eb521df88d7b054d2559adceae4cf6db3ef",
        )
        self.assertEqual(CONSUMPTION["operationId"], ATTEMPT["operationId"])
        self.assertLess(CONSUMPTION["consumedAt"], ATTEMPT["attemptObservedAt"])
        authorization = CONSUMPTION["authorization"]
        self.assertEqual(authorization["approvedExecutionCount"], 1)
        self.assertEqual(authorization["consumedExecutionCount"], 1)
        self.assertIs(authorization["reusable"], False)
        boundary = CONSUMPTION["executionBoundary"]
        self.assertIs(boundary["productionExecutionNotYetObserved"], True)
        self.assertEqual(boundary["executionWithinThisBoundOperationRemaining"], 1)
        self.assertIs(boundary["externalRetryAllowed"], False)

    def test_attempt_is_exact_and_bound_to_every_authorized_source(self) -> None:
        self.assertEqual(
            sha256(ATTEMPT_PATH),
            "01a0c3ff861ecce1d2693a461ae989fbc7e6b2fa7bef4a7a64a9ef5c8cbba261",
        )
        self.assertEqual(ATTEMPT["schemaVersion"], 3)
        self.assertEqual(ATTEMPT["kind"], "g037_readonly_role_apply_attempt")
        self.assertEqual(ATTEMPT["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(ATTEMPT["databaseName"], "postgres")
        authorization = ATTEMPT["authorization"]
        self.assertEqual(authorization["approvedExecutionCount"], 1)
        self.assertEqual(authorization["consumedExecutionCount"], 1)
        self.assertIs(authorization["authorizationReusable"], False)
        for prefix in ("authorization", "authorizationRequest", "consumption"):
            path = ROOT / authorization[f"{prefix}Path"]
            self.assertEqual(authorization[f"{prefix}Sha256"], sha256(path))
        for descriptor in (ATTEMPT["executedArtifact"], ATTEMPT["readbackArtifact"]):
            path = ROOT / descriptor["path"]
            self.assertEqual(descriptor["sha256"], sha256(path))

    def test_precheck_and_execution_cardinality_are_exact(self) -> None:
        self.assertEqual(
            ATTEMPT["preexecutionReadback"],
            {
                "projectActiveHealthy": True,
                "postgresVersion": "17.6.1.038",
                "postgresMajorVersion": 17,
                "databaseExact": True,
                "roleAbsent": True,
                "migrationLedgerPresent": True,
                "targetFunctionPresent": True,
                "migrationCount": 50,
                "terminalMigrationVersion": "20260804000500",
            },
        )
        self.assertEqual(ATTEMPT["executedArtifact"]["executionCount"], 1)
        self.assertEqual(ATTEMPT["executedArtifact"]["retryCount"], 0)
        self.assertEqual(ATTEMPT["readbackArtifact"]["executionCount"], 1)

    def test_outcome_is_committed_and_retains_no_provider_payload(self) -> None:
        self.assertEqual(
            ATTEMPT["outcome"],
            {
                "status": "committed",
                "fixedCode": "g037_readonly_role_provisioned",
                "transactionCommitObserved": True,
                "commitConfirmedByExactRoleReadback": True,
                "persistentRolePresentAfterApply": True,
                "persistentHostedStateChanged": True,
                "providerErrorRetained": False,
                "rawProviderResultRetained": False,
            },
        )

    def test_readback_proves_every_bounded_role_invariant(self) -> None:
        readback = ATTEMPT["postapplyReadback"]
        self.assertEqual(readback["schema"], "g037-readonly-role-readback-v3")
        for key, value in readback.items():
            if key in ("schema", "parentMembershipCount", "memberCount", "ownedObjectCount"):
                continue
            with self.subTest(key=key):
                self.assertIs(value, True)
        self.assertEqual(readback["parentMembershipCount"], 0)
        self.assertEqual(readback["memberCount"], 1)
        self.assertEqual(readback["ownedObjectCount"], 0)

    def test_ledger_and_downstream_boundaries_are_honest_and_closed(self) -> None:
        self.assertEqual(
            ATTEMPT["ledgerBoundary"],
            {
                "preapplyMigrationCount": 50,
                "preapplyTerminalMigrationVersion": "20260804000500",
                "provisioningSourceContainsMigrationLedgerMutation": False,
                "separatePostapplyLedgerReadbackPerformed": False,
            },
        )
        self.assertTrue(all(value is False for value in ATTEMPT["downstreamGate"].values()))

    def test_machine_gates_require_password_review_after_role_only_apply(self) -> None:
        attempt_sha = sha256(ATTEMPT_PATH)
        gate = CONTRACT["provisioningGate"]
        self.assertEqual(gate["status"], "credential_custody_review_approved_direct_endpoint_reachability_required")
        self.assertEqual(gate["hostedApplyConsumedExecutionCount"], 1)
        self.assertIs(gate["hostedApplyAuthorizationReusable"], False)
        self.assertEqual(gate["hostedApplyAttemptSha256"], attempt_sha)
        self.assertEqual(gate["hostedApplyOutcomeCode"], "g037_readonly_role_provisioned")
        self.assertIs(gate["roleProvisioned"], True)
        self.assertIs(gate["roleReadbackPresent"], True)
        self.assertIs(gate["roleReadbackExact"], True)
        self.assertIs(gate["passwordConfigured"], False)
        self.assertIs(gate["repositorySecretPresent"], False)
        self.assertIs(gate["dedicatedRolePasswordConnectionProved"], False)
        self.assertIs(gate["controllerRetryAuthorized"], False)

        controller = DECISION["controllerGate"]
        self.assertEqual(
            controller["status"],
            "blocked_direct_endpoint_reachability_required",
        )
        self.assertIs(controller["requiresExternalRoleProvisioning"], False)
        self.assertEqual(controller["hostedApplyAttemptSha256"], attempt_sha)
        self.assertIs(controller["roleProvisioned"], True)
        self.assertIs(controller["roleReadbackExact"], True)
        self.assertIs(controller["passwordConfigured"], False)
        self.assertIs(controller["dedicatedRolePasswordConnectionProved"], False)

    def test_tasks_docs_and_security_workflow_record_apply_without_overclaim(self) -> None:
        for task_id in range(355, 360):
            self.assertIn(f"- [x]! 7.{task_id} ", TASKS)
        for task_id in range(360, 363):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x] 7.363 ", TASKS)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(sha256(CONSUMPTION_PATH), normalized)
            self.assertIn(sha256(ATTEMPT_PATH), normalized)
            self.assertIn("PASSWORD NULL", source)
        for path in (CONSUMPTION_PATH, ATTEMPT_PATH):
            relative = path.relative_to(ROOT).as_posix()
            self.assertNotIn(relative, G037_WORKFLOW)
            self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_role_v3_apply_attempt_source",
            SECURITY_WORKFLOW,
        )

    def test_attempt_contains_no_connection_or_credential_material(self) -> None:
        for path in (CONSUMPTION_PATH, ATTEMPT_PATH):
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
