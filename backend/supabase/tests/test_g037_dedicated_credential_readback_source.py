"""Current sanitized evidence supersedes requests, without rewriting history."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
READBACK = ROOT / "backend/supabase/g037-dedicated-credential-readback.v2.json"


class DedicatedCredentialReadbackTests(unittest.TestCase):
    def test_completed_credential_tasks_have_matching_operational_evidence(self):
        data = json.loads(READBACK.read_text())
        self.assertEqual(data["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(data["repository"], "twoimo/tzudong")
        assignment = data["passwordAssignment"]
        self.assertEqual(assignment["executions"], 1)
        self.assertIs(assignment["keychainStoredAndReadback"], True)
        self.assertIs(assignment["plaintextInChatOrFiles"], False)
        self.assertIs(assignment["ownerCredentialChanged"], False)
        connection = data["connectionReadback"]
        self.assertEqual(len(connection), 20)
        for key, value in connection.items():
            if key != "schema":
                self.assertIs(value, True, key)
        role = data["ownerRoleReadback"]
        for key, expected in (("member_count", 1), ("parent_membership_count", 0), ("owned_object_count", 0)):
            self.assertEqual(role[key], expected)
        for key, value in role.items():
            if key not in {"schema", "member_count", "parent_membership_count", "owned_object_count"}:
                self.assertIs(value, True, key)
        self.assertEqual(data["repositorySecretMetadata"]["name"], "SUPABASE_G037_READONLY_DB_URL")
        for key in ("repositorySecretValueReadback", "controllerDispatched", "writeFreezeReleased", "productionDeployed", "historicalApprovalsReused"):
            self.assertIs(data[key], False, key)
        self.assertEqual(hashlib.sha256((ROOT / data["caCertificatePath"]).read_bytes()).hexdigest(), data["caCertificateSha256"])

    def test_superseded_requests_do_not_claim_retries_or_direct_ipv6_success(self):
        data = json.loads((SPEC / "credential-request-supersession.v1.json").read_text())
        self.assertEqual(data["currentEvidenceSha256"], hashlib.sha256(READBACK.read_bytes()).hexdigest())
        self.assertEqual(set(data["dispositions"]), {"7.405", "7.431", "7.451", "7.541", "7.555"})
        for key in ("historicalReceiptsChanged", "priorDeniedRequestsRetried", "directIpv6ReachabilityClaimed"):
            self.assertIs(data[key], False)
