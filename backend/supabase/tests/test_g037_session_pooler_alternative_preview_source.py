"""Source contract for the non-authorizing G037 session-pooler alternative preview."""

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
PREVIEW_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-alternative-preview.v1.json"
)
PREVIEW = json.loads(PREVIEW_PATH.read_text(encoding="utf-8"))
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


class G037SessionPoolerAlternativePreviewSourceTests(unittest.TestCase):
    def test_preview_is_exact_review_only_artifact(self) -> None:
        self.assertEqual(
            sha256(PREVIEW_PATH),
            "cdf4bd8f9c05eb2fd789228cdfffa563cf8b5dbf7e68f940b1c9689db8d8214e",
        )
        self.assertEqual(PREVIEW["schemaVersion"], 1)
        self.assertEqual(PREVIEW["kind"], "g037_session_pooler_alternative_preview")
        self.assertEqual(PREVIEW["reviewStatus"], "named_owner_review_required")
        self.assertEqual(
            PREVIEW["proposedAlternative"]["selectionStatus"],
            "not_selected_review_only",
        )
        self.assertIs(PREVIEW["requestedReviewScope"]["poolerSelection"], False)
        self.assertIs(PREVIEW["executionGate"]["anyExecutionAuthorized"], False)

    def test_current_direct_contract_and_upgrade_deferral_remain_intact(self) -> None:
        current = PREVIEW["currentContract"]
        self.assertEqual(current["transportSelection"], "direct_only")
        self.assertIs(current["directEndpointReachabilityRequired"], True)
        self.assertIs(current["sessionPoolerAllowed"], False)
        self.assertIs(current["silentFallbackAllowed"], False)
        self.assertIs(current["passwordRequestBlocked"], True)
        self.assertIs(PREVIEW["continuity"]["directHostEvidenceStillAccepted"], True)
        self.assertIs(PREVIEW["continuity"]["sameHostDirectRetryAuthorized"], False)
        self.assertIs(PREVIEW["continuity"]["ipv4AddonUpgradeStillDeferred"], True)

    def test_official_session_mode_constraints_are_bounded(self) -> None:
        docs = PREVIEW["officialDocumentation"]
        self.assertIs(docs["supabaseChangelogReviewed"], True)
        self.assertIs(docs["relevantConnectionBreakingChangeFound"], False)
        self.assertIs(docs["directConnectionRemainsPreferredForSingleSessions"], True)
        self.assertIs(docs["sessionPoolerIsDocumentedIpv4Alternative"], True)
        self.assertEqual(docs["sharedSessionPoolerPort"], 5432)
        self.assertEqual(docs["sharedTransactionPoolerPort"], 6543)
        candidate = PREVIEW["proposedAlternative"]
        self.assertEqual(candidate["transport"], "shared_supavisor_session_mode")
        self.assertEqual(candidate["port"], 5432)
        self.assertIs(candidate["transactionModePort6543Allowed"], False)
        self.assertIs(candidate["dedicatedPoolerAllowed"], False)
        self.assertIs(candidate["ipv4AddonPurchaseOrActivationRequired"], False)

    def test_project_metadata_does_not_invent_pooler_connection_fields(self) -> None:
        observation = PREVIEW["hostedMetadataObservation"]
        self.assertEqual(observation["source"], "read_only_supabase_get_project")
        self.assertIs(observation["projectRefMatched"], True)
        self.assertEqual(observation["region"], "ap-southeast-1")
        self.assertEqual(observation["projectStatus"], "ACTIVE_HEALTHY")
        self.assertEqual(observation["postgresEngineMajor"], 17)
        self.assertIs(observation["sessionPoolerHostnameReturned"], False)
        self.assertIs(observation["sessionPoolerUsernameReturned"], False)
        self.assertIs(observation["credentialReturnedOrRead"], False)
        candidate = PREVIEW["proposedAlternative"]
        self.assertIs(candidate["providerDashboardSessionMetadataRequired"], True)
        self.assertIs(candidate["hostnameOrUsernameMayBeInferredFromRegion"], False)
        self.assertIs(
            candidate["customRoleUsernameShapeRequiresProviderConfirmation"], True
        )

    def test_security_and_source_compatibility_preserve_dedicated_role(self) -> None:
        security = PREVIEW["securityInvariants"]
        self.assertEqual(security["sslMode"], "verify-full")
        for required in (
            "serverRootCertificateRequired",
            "externalPasswordManagerAndCustodianStillRequired",
            "sameDedicatedRolePasswordRequired",
            "roleAdmissionBeforeOperationalRead",
            "currentUserMustEqualDedicatedRole",
            "defaultTransactionReadOnlyMustBeTrue",
            "targetMutatorExecuteMustBeDenied",
            "boundedConnectionReadbackMustPass",
        ):
            self.assertIs(security[required], True)
        for denied in (
            "plaintextTransportAllowed",
            "connectionStringInRepositoryAllowed",
            "connectionStringInCommandArgumentsAllowed",
            "credentialInLogsArtifactsIssuesOrChatAllowed",
        ):
            self.assertIs(security[denied], False)
        compatibility = PREVIEW["sourceCompatibility"]
        for prefix in ("hostedExecutor", "hostedWorkflow", "connectionReadback"):
            self.assertEqual(
                compatibility[f"{prefix}Sha256"],
                sha256(ROOT / compatibility[f"{prefix}Path"]),
            )
        self.assertIs(compatibility["productionMutationControllerInScope"], False)
        self.assertIs(
            compatibility["currentCredentialContractMustBeExplicitlyAmendedAfterApproval"],
            True,
        )

    def test_future_sequence_is_ordered_and_every_step_unapproved(self) -> None:
        sequence = PREVIEW["requiredFutureSequence"]
        self.assertEqual([item["sequence"] for item in sequence], list(range(1, 8)))
        self.assertTrue(all(item["currentlyAuthorized"] is False for item in sequence))
        self.assertEqual(
            sequence[0]["step"], "named_owner_review_of_exact_alternative_preview"
        )
        self.assertEqual(
            sequence[-1]["step"], "fresh_exact_revision_workflow_dispatch_authorization"
        )

    def test_machine_gates_register_preview_without_selecting_it(self) -> None:
        relative = PREVIEW_PATH.relative_to(ROOT).as_posix()
        preview_sha = sha256(PREVIEW_PATH)
        for gate in (CONTRACT["provisioningGate"], DECISION["controllerGate"]):
            self.assertIs(gate["sessionPoolerAlternativePreviewPresent"], True)
            self.assertEqual(gate["sessionPoolerAlternativePreviewPath"], relative)
            self.assertEqual(gate["sessionPoolerAlternativePreviewSha256"], preview_sha)
            self.assertIs(gate["sessionPoolerAlternativePreviewApproved"], True)
            self.assertIs(gate["sessionPoolerSelected"], False)
            self.assertIs(gate["sessionPoolerExactMetadataPresent"], False)
            self.assertIs(gate["sessionPoolerReachabilityProved"], False)
            self.assertIs(gate["passwordConfigurationAuthorizationPresent"], False)

    def test_tasks_docs_and_security_workflow_track_preview(self) -> None:
        for task_id in range(432, 448):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x] 7.448 ", TASKS)
        for task_id in range(449, 452):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        preview_sha = sha256(PREVIEW_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(preview_sha, normalized)
            self.assertIn("shared Supavisor session mode", normalized)
            self.assertIn("5432", normalized)
            self.assertIn("6543", normalized)
        relative = PREVIEW_PATH.relative_to(ROOT).as_posix()
        test_relative = Path(__file__).relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{test_relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_session_pooler_alternative_preview_source",
            SECURITY_WORKFLOW,
        )

    def test_preview_contains_no_connection_or_credential_material(self) -> None:
        raw = PREVIEW_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "postgres://",
            "postgresql://",
            "@aws-",
            ".pooler.supabase.com",
            "access_token",
            "refresh_token",
            "service_role_key",
            "database_password",
            "-----begin",
        ):
            self.assertNotIn(forbidden, raw)


if __name__ == "__main__":
    unittest.main()
