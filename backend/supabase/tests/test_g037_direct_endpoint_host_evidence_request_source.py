"""Source contracts for the G037 controlled-host network evidence request."""

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
    ROOT / "backend/supabase/g037-direct-endpoint-host-evidence-request.v1.json"
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


class G037DirectEndpointHostEvidenceRequestSourceTests(unittest.TestCase):
    def test_request_is_exact_fixed_target_and_non_authorizing(self) -> None:
        self.assertEqual(
            sha256(REQUEST_PATH),
            "9055ed5533a1008300cba6bc666ddaeff6503d87ce6d81ae93f1c94fef8f103c",
        )
        self.assertEqual(REQUEST["schemaVersion"], 1)
        self.assertEqual(REQUEST["kind"], "g037_direct_endpoint_host_evidence_request")
        self.assertEqual(
            REQUEST["requestStatus"], "controlled_host_direct_endpoint_evidence_required"
        )
        probe = REQUEST["probeArtifact"]
        self.assertEqual(probe["sha256"], sha256(ROOT / probe["path"]))
        self.assertEqual(probe["mode"], "probe")
        self.assertEqual(probe["maximumExecutionCountPerHost"], 1)
        self.assertIs(probe["fixedTarget"], True)
        self.assertIs(probe["arbitraryHostOrPortInputAllowed"], False)

    def test_request_binds_current_approval_request_and_failed_attempt(self) -> None:
        continuity = REQUEST["continuity"]
        for prefix in (
            "credentialPreviewApproval",
            "passwordAssignmentRequest",
            "failedWorkspaceHostAttempt",
        ):
            self.assertEqual(
                continuity[f"{prefix}Sha256"],
                sha256(ROOT / continuity[f"{prefix}Path"]),
            )
        self.assertIs(continuity["sameWorkspaceHostRetryRequested"], False)

    def test_operator_procedure_is_one_credential_free_command(self) -> None:
        procedure = REQUEST["operatorProcedure"]
        self.assertEqual(
            procedure["requiredCommand"],
            "python3 backend/supabase/scripts/g037_direct_endpoint_network_preflight.py probe",
        )
        for required in (
            "runFromExactReviewedCandidate",
            "runOnOwnerApprovedControlledHost",
            "requireIpv6Egress",
            "copyOnlyCanonicalJsonLine",
        ):
            self.assertIs(procedure[required], True)
        for denied in (
            "credentialOrDatabaseLoginRequired",
            "copyTerminalOrNetworkDiagnostics",
            "installOrEnableNetworkService",
            "changeFirewallOrDns",
            "enableIpv4Addon",
            "usePoolerFallback",
        ):
            self.assertIs(procedure[denied], False)

    def test_accepted_evidence_is_exact_ready_shape(self) -> None:
        self.assertEqual(
            REQUEST["acceptedEvidence"],
            {
                "schema": "g037-direct-endpoint-network-preflight-v1",
                "status": "ready",
                "fixedCode": "g037_direct_endpoint_ready",
                "ipv6DnsPresent": True,
                "tcp5432Reachable": True,
                "credentialUsed": False,
                "databaseAuthenticationAttempted": False,
                "sqlExecuted": False,
                "persistentStateChanged": False,
            },
        )
        self.assertEqual(
            REQUEST["failureEvidence"]["acceptedFixedCodes"],
            [
                "g037_direct_endpoint_ipv6_dns_unavailable",
                "g037_direct_endpoint_tcp_unreachable",
            ],
        )
        self.assertTrue(
            all(
                REQUEST["failureEvidence"][key]
                for key in (
                    "doesNotAuthorizeAutomaticRetry",
                    "doesNotAuthorizePoolerFallback",
                    "doesNotAuthorizeIpv4AddonChange",
                )
            )
        )

    def test_machine_gates_bind_request_with_no_approved_host(self) -> None:
        relative = REQUEST_PATH.relative_to(ROOT).as_posix()
        request_sha = sha256(REQUEST_PATH)
        for gate in (CONTRACT["provisioningGate"], DECISION["controllerGate"]):
            self.assertIs(gate["directEndpointHostEvidenceRequestPresent"], True)
            self.assertEqual(gate["directEndpointHostEvidenceRequestPath"], relative)
            self.assertEqual(gate["directEndpointHostEvidenceRequestSha256"], request_sha)
            self.assertIs(gate["approvedControlledCredentialHostPresent"], False)
            self.assertIs(gate["directEndpointReachabilityProved"], False)
            self.assertIs(gate["passwordConfigurationAuthorizationPresent"], False)

    def test_tasks_docs_and_security_workflow_track_request_and_probe(self) -> None:
        for task_id in range(420, 431):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [ ]! 7.431 ", TASKS)
        request_sha = sha256(REQUEST_PATH)
        probe_sha = REQUEST["probeArtifact"]["sha256"]
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(request_sha, normalized)
            self.assertIn(probe_sha, normalized)
            self.assertIn(REQUEST["operatorProcedure"]["requiredCommand"], normalized)
        for relative in (
            REQUEST_PATH.relative_to(ROOT).as_posix(),
            REQUEST["probeArtifact"]["path"],
        ):
            self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        for module in (
            "backend.supabase.tests.test_g037_direct_endpoint_network_preflight",
            "backend.supabase.tests.test_g037_direct_endpoint_host_evidence_request_source",
        ):
            self.assertIn(module, SECURITY_WORKFLOW)

    def test_request_contains_no_endpoint_address_or_credential_material(self) -> None:
        raw = REQUEST_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "db.aqlcofblfxdrjhhdmarw",
            "postgres://",
            "postgresql://",
            "supabase.co",
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
