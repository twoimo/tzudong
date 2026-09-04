"""Source contracts for the review-only G037 credential-custody ceremony."""

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
SECURITY_WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
G037_WORKFLOW = (ROOT / ".github/workflows/g037-hosted-closure.yml").read_text(
    encoding="utf-8"
)
PREVIEW_PATH = (
    ROOT / "backend/supabase/g037-readonly-credential-custody-preview.v1.json"
)
READBACK_PATH = (
    ROOT / "backend/supabase/scripts/g037_readonly_role_connection_readback_v1.sql"
)
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
READBACK = READBACK_PATH.read_text(encoding="utf-8")
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


class G037ReadonlyCredentialCustodyPreviewSourceTests(unittest.TestCase):
    def test_preview_is_exact_and_review_only(self) -> None:
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "43f50049495a0324491fa8fafc9e359e68e3f6bb0430c1c01a42af28c59cd113",
        )
        self.assertEqual(PREVIEW["schemaVersion"], 1)
        self.assertEqual(
            PREVIEW["kind"], "g037_readonly_credential_custody_preview"
        )
        self.assertEqual(PREVIEW["repository"], "twoimo/tzudong")
        self.assertEqual(PREVIEW["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(PREVIEW["databaseName"], "postgres")
        self.assertEqual(PREVIEW["reviewStatus"], "named_owner_review_required")

        scope = PREVIEW["requestedReviewScope"]
        self.assertIs(scope["ceremonyReview"], True)
        self.assertIs(scope["connectionReadbackSqlReview"], True)
        for denied in set(scope) - {"ceremonyReview", "connectionReadbackSqlReview"}:
            self.assertIs(scope[denied], False)
        state = PREVIEW["executionGate"]
        self.assertTrue(all(value is False or value == 0 for value in state.values()))

    def test_preview_binds_provisioning_continuity_and_reviewed_sources(self) -> None:
        continuity = PREVIEW["continuity"]
        attempt_path = ROOT / continuity["provisioningAttemptPath"]
        self.assertEqual(continuity["provisioningAttemptSha256"], sha256(attempt_path))
        self.assertEqual(
            continuity["provisioningOutcomeCode"], "g037_readonly_role_provisioned"
        )
        self.assertIs(continuity["roleProvisioned"], True)
        self.assertIs(continuity["rolePasswordNullAtProvisioning"], True)
        self.assertIs(continuity["priorProvisioningAuthorizationReusable"], False)
        for artifact in PREVIEW["reviewedArtifacts"]:
            self.assertEqual(artifact["sha256"], sha256(ROOT / artifact["path"]))

    def test_ceremony_is_ordered_non_echoing_and_fail_closed(self) -> None:
        stages = PREVIEW["ceremonyStages"]
        self.assertEqual([item["sequence"] for item in stages], [1, 2, 3, 4, 5])
        self.assertEqual(
            [item["id"] for item in stages],
            [
                "external_password_generation",
                "interactive_password_assignment",
                "dedicated_connection_readback",
                "repository_secret_write",
                "repository_secret_metadata_readback",
            ],
        )
        self.assertEqual(
            [item["persistentMutation"] for item in stages],
            [False, True, False, True, False],
        )
        assignment = stages[1]
        self.assertEqual(
            assignment["mechanism"], "psql_backslash_password_interactive_prompt"
        )
        self.assertIn("non-echoing", " ".join(assignment["requirements"]))
        discipline = PREVIEW["failureDiscipline"]
        for required in (
            "stageOrderIsMandatory",
            "passwordAssignmentAmbiguityBlocksSecretWrite",
            "failedDedicatedConnectionBlocksSecretWrite",
            "failedBooleanReadbackBlocksSecretWrite",
            "retryUnderSameExecutionAuthorization",
            "automaticPasswordRollbackAllowed",
            "controllerOrWorkflowDispatchAfterCeremonyAllowed",
        ):
            self.assertIs(discipline[required], required == "stageOrderIsMandatory" or "Blocks" in required)
        self.assertIs(discipline["secretWriteBeforeConnectionProofAllowed"], False)

    def test_connection_readback_is_single_statement_and_mutation_free(self) -> None:
        self.assertEqual(sha256(READBACK_PATH), PREVIEW["reviewedArtifacts"][0]["sha256"])
        self.assertEqual(
            PREVIEW["ceremonyStages"][2]["maximumExecutionCount"], 1
        )
        normalized = " ".join(READBACK.split())
        self.assertTrue(normalized.startswith("-- G037"))
        self.assertEqual(normalized.count("jsonb_build_object("), 1)
        for key in (
            "database_exact",
            "postgres_major_17",
            "dedicated_role_exact",
            "transaction_read_only",
            "default_transaction_read_only",
            "ledger_exact",
            "target_function_present",
            "target_execute_denied",
        ):
            self.assertIn(f"'{key}'", READBACK)
        self.assertNotRegex(
            READBACK,
            re.compile(
                r"(?im)^\s*(?:alter|call|create|delete|do|drop|grant|insert|revoke|truncate|update)\b"
            ),
        )
        self.assertNotIn("rolpassword", READBACK.lower())

    def test_transport_secret_and_receipt_boundaries_are_closed(self) -> None:
        docs = PREVIEW["documentationValidation"]
        self.assertIs(docs["supabaseChangelogReviewed"], True)
        self.assertIs(docs["relevantBreakingChangeFound"], False)
        self.assertIs(docs["passwordCommandEncryptsBeforeSending"], True)
        self.assertIs(
            docs["passwordCommandAvoidsCleartextHistoryAndServerLog"], True
        )
        self.assertIs(docs["externalServiceFileOverrideSupported"], True)
        self.assertIs(docs["directEndpointRequiresIpv6OrIpv4Addon"], True)
        transport = PREVIEW["transportRequirements"]
        self.assertIs(transport["directProductionDatabaseConnection"], True)
        self.assertIs(transport["encryptedTransportRequired"], True)
        self.assertEqual(transport["sslMode"], "verify-full")
        self.assertIs(transport["serverRootCertificateRequired"], True)
        self.assertIs(transport["directEndpointReachabilityMustBeProved"], True)
        self.assertIs(transport["ipv6OrApprovedIpv4AddonRequired"], True)
        for denied in (
            "plaintextTransportAllowed",
            "connectionPoolerAllowed",
            "silentPoolerFallbackAllowed",
            "ownerCredentialAllowedForDedicatedReadback",
            "ownerCredentialAllowedForRepositorySecret",
        ):
            self.assertIs(transport[denied], False)
        secret_stage = PREVIEW["ceremonyStages"][3]
        self.assertEqual(
            secret_stage["repositorySecretName"], "SUPABASE_G037_READONLY_DB_URL"
        )
        self.assertEqual(secret_stage["forbiddenSecretName"], "SUPABASE_DB_URL")
        self.assertIs(PREVIEW["receiptBoundary"]["repositoryReceiptAllowed"], False)

    def test_machine_gates_retain_preview_after_review_but_keep_actions_closed(self) -> None:
        relative = PREVIEW_PATH.relative_to(ROOT).as_posix()
        preview_sha = sha256(PREVIEW_PATH)
        for gate in (CONTRACT["provisioningGate"], DECISION["controllerGate"]):
            self.assertIs(gate["credentialCustodyPreviewPresent"], True)
            self.assertEqual(gate["credentialCustodyPreviewPath"], relative)
            self.assertEqual(gate["credentialCustodyPreviewSha256"], preview_sha)
            self.assertIs(gate["credentialCustodyPreviewApproved"], True)
            self.assertIs(gate["passwordConfigurationAuthorizationPresent"], False)
            self.assertIs(
                gate["dedicatedConnectionReadbackAuthorizationPresent"], False
            )
            self.assertIs(
                gate["repositorySecretMutationAuthorizationPresent"], False
            )
        self.assertIs(CONTRACT["provisioningGate"]["passwordConfigured"], False)
        self.assertIs(CONTRACT["provisioningGate"]["repositorySecretPresent"], False)
        self.assertIs(DECISION["controllerGate"]["controllerRetryAuthorized"], False)

    def test_tasks_docs_and_security_wiring_track_the_review_boundary(self) -> None:
        self.assertIn("- [x] 7.363 ", TASKS)
        for task_id in range(366, 386):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x]! 7.386 ", TASKS)
        self.assertIn("- [x] 7.387 ", TASKS)
        for task_id in (388, 389, 390):
            self.assertIn(f"- [ ]! 7.{task_id} ", TASKS)
        for task_id in range(397, 403):
            self.assertIn(f"- [x]* 7.{task_id} ", TASKS)
        for task_id in (403, 404):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [ ]! 7.405 ", TASKS)
        preview_sha = sha256(PREVIEW_PATH)
        readback_sha = sha256(READBACK_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(preview_sha, normalized)
            self.assertIn(readback_sha, normalized)
            self.assertIn("review-only", normalized)
        for path in (PREVIEW_PATH, READBACK_PATH):
            relative = path.relative_to(ROOT).as_posix()
            self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
            self.assertNotIn(relative, G037_WORKFLOW)
        self.assertIn(
            "backend.supabase.tests.test_g037_readonly_credential_custody_preview_source",
            SECURITY_WORKFLOW,
        )

    def test_preview_contains_no_connection_or_credential_material(self) -> None:
        raw = PREVIEW_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "postgres://",
            "postgresql://",
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
