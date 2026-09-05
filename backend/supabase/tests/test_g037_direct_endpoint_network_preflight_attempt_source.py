"""Source contracts for the bounded G037 direct-endpoint network attempt."""

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
ATTEMPT_PATH = (
    ROOT / "backend/supabase/g037-direct-endpoint-network-preflight-attempt.v1.json"
)
ATTEMPT = json.loads(ATTEMPT_PATH.read_text(encoding="utf-8"))
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


class G037DirectEndpointNetworkPreflightAttemptSourceTests(unittest.TestCase):
    def test_attempt_is_exact_and_bounded(self) -> None:
        self.assertEqual(
            sha256(ATTEMPT_PATH),
            "17d265b605258140f697f67caef17f3a028a16b521267d037ae85ccf48b71047",
        )
        self.assertEqual(ATTEMPT["schemaVersion"], 1)
        self.assertEqual(
            ATTEMPT["kind"], "g037_direct_endpoint_network_preflight_attempt"
        )
        self.assertEqual(ATTEMPT["projectRef"], "aqlcofblfxdrjhhdmarw")
        boundary = ATTEMPT["reviewedBoundary"]
        preview_path = ROOT / boundary["credentialCustodyPreviewPath"]
        self.assertEqual(boundary["credentialCustodyPreviewSha256"], sha256(preview_path))
        self.assertEqual(boundary["maximumResolvedAddressesTried"], 4)
        self.assertEqual(boundary["perAddressTimeoutSeconds"], 3)

    def test_observation_reports_no_credential_or_database_action(self) -> None:
        self.assertEqual(
            ATTEMPT["observation"],
            {
                "ipv6DnsPresent": True,
                "tcp5432Reachable": False,
                "credentialUsed": False,
                "databaseAuthenticationAttempted": False,
                "sqlExecuted": False,
                "persistentStateChanged": False,
            },
        )
        source = ATTEMPT["source"]
        self.assertEqual(source["hostClass"], "current_workspace_host")
        for key in (
            "credentialHostIdentityRecorded",
            "endpointRecorded",
            "addressRecorded",
            "providerErrorRecorded",
        ):
            self.assertIs(source[key], False)

    def test_unreachable_outcome_keeps_credential_work_closed(self) -> None:
        outcome = ATTEMPT["outcome"]
        self.assertEqual(outcome["status"], "blocked")
        self.assertEqual(
            outcome["fixedCode"], "g037_direct_endpoint_tcp_unreachable"
        )
        for key in (
            "directEndpointReachabilityProved",
            "passwordCeremonyAdmitted",
            "poolerFallbackAdmitted",
            "ipv4AddonChangeAdmitted",
        ):
            self.assertIs(outcome[key], False)
        next_evidence = ATTEMPT["nextEvidenceRequired"]
        self.assertIs(next_evidence["differentApprovedControlledHostAllowed"], True)
        self.assertIs(next_evidence["sameHostAutomaticRetryAllowed"], False)
        self.assertIs(
            next_evidence["freshBoundedReachabilityObservationRequired"], True
        )
        self.assertIs(
            next_evidence["namedOwnerScopeChangeRequiredForPoolerOrAddon"], True
        )

    def test_machine_gates_bind_attempt_and_remain_closed(self) -> None:
        relative = ATTEMPT_PATH.relative_to(ROOT).as_posix()
        attempt_sha = sha256(ATTEMPT_PATH)
        for gate in (CONTRACT["provisioningGate"], DECISION["controllerGate"]):
            self.assertIs(gate["directEndpointNetworkPreflightAttemptRecorded"], True)
            self.assertEqual(gate["directEndpointNetworkPreflightAttemptPath"], relative)
            self.assertEqual(
                gate["directEndpointNetworkPreflightAttemptSha256"], attempt_sha
            )
            self.assertIs(gate["directEndpointIpv6DnsPresent"], True)
            self.assertIs(gate["directEndpointTcp5432Reachable"], False)
            self.assertIs(gate["directEndpointReachabilityProved"], False)
            self.assertIs(gate["passwordCeremonyAdmitted"], False)

    def test_tasks_docs_and_workflow_track_the_blocked_attempt(self) -> None:
        self.assertIn("- [x] 7.405 ", TASKS)
        self.assertIn("- [x]* 7.406 ", TASKS)
        for task_id in (407, 408):
            self.assertIn(f"- [x] 7.{task_id} ", TASKS)
        self.assertIn("- [x] 7.409 ", TASKS)
        attempt_sha = sha256(ATTEMPT_PATH)
        for source in (DESIGN, RUNBOOK):
            normalized = " ".join(source.split())
            self.assertIn(attempt_sha, normalized)
            self.assertIn("g037_direct_endpoint_tcp_unreachable", normalized)
        relative = ATTEMPT_PATH.relative_to(ROOT).as_posix()
        self.assertEqual(SECURITY_WORKFLOW.count(f"- '{relative}'"), 1)
        self.assertIn(
            "backend.supabase.tests.test_g037_direct_endpoint_network_preflight_attempt_source",
            SECURITY_WORKFLOW,
        )

    def test_attempt_contains_no_endpoint_address_or_credential_material(self) -> None:
        raw = ATTEMPT_PATH.read_text(encoding="utf-8").lower()
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
