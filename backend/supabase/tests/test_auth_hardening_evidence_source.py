"""Source contracts for the bounded hosted Auth hardening decision."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / ".kiro/specs/crawler-pipeline-operational-readiness"
TASKS = (SPEC / "tasks.md").read_text(encoding="utf-8")
REQUIREMENTS = (SPEC / "requirements.md").read_text(encoding="utf-8")
DESIGN = (SPEC / "design.md").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github/workflows/security-audit.yml").read_text(
    encoding="utf-8"
)
DECISION_PATH = ROOT / "backend/supabase/auth-hardening-decision.v1.json"
DECISION = json.loads(DECISION_PATH.read_text(encoding="utf-8"))


class AuthHardeningEvidenceSourceTests(unittest.TestCase):
    def test_authorization_is_bounded_and_not_claimed_as_activation(self) -> None:
        self.assertIn(
            "- [x]! 7.35 Obtain owner-authorized activation or documented deferral evidence",
            TASKS,
        )
        for completed_id in range(88, 93):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        self.assertIn("- [x]! 7.93 ", TASKS)
        for open_id in range(94, 97):
            self.assertIn(f"- [ ]! 7.{open_id} ", TASKS)
        for completed_id in range(100, 105):
            self.assertIn(f"- [x] 7.{completed_id} ", TASKS)
        self.assertIn("exact project ref `aqlcofblfxdrjhhdmarw`", TASKS)
        self.assertIn("setting-level approval does not authorize purchase", TASKS)
        self.assertIn("final disabled value", TASKS)
        self.assertIn("new named-owner decision later supersedes the deferral", TASKS)

    def test_requirement_separates_plan_purchase_apply_and_readback(self) -> None:
        normalized = " ".join(REQUIREMENTS.split())
        for expected in (
            "shall not be treated as activation",
            "no paid-plan upgrade may be inferred",
            "single-setting apply",
            "saved-state readback",
            "bounded external receipt",
            "require a new named-owner decision",
        ):
            self.assertIn(expected, normalized)

    def test_design_records_only_bounded_preflight_facts(self) -> None:
        normalized = " ".join(DESIGN.split())
        for expected in (
            "named owner 최연우 authorized enabling leaked-password protection only",
            "project ref `aqlcofblfxdrjhhdmarw`",
            "did not include a paid-plan purchase",
            "setting as disabled",
            "Free plan",
            "available only on Pro and above",
            "zero settings changed",
            "final value remained disabled",
            "deferred the paid-plan upgrade",
            "does not claim activation or an immutable hosted receipt",
            "Activation remains disabled",
        ):
            self.assertIn(expected, normalized)

    def test_machine_readable_deferral_is_bounded(self) -> None:
        self.assertEqual(
            set(DECISION),
            {
                "schemaVersion",
                "kind",
                "projectRef",
                "control",
                "scope",
                "notEvidenceOf",
                "ownerDecision",
                "currentState",
                "resumeRequirements",
            },
        )
        self.assertEqual(DECISION["schemaVersion"], 1)
        self.assertEqual(DECISION["kind"], "supabase_auth_hardening_decision")
        self.assertEqual(DECISION["projectRef"], "aqlcofblfxdrjhhdmarw")
        self.assertEqual(
            DECISION["control"], "auth.password.leaked_password_protection"
        )
        self.assertEqual(
            DECISION["ownerDecision"],
            {
                "approverDisplayName": "최연우",
                "decision": "defer_paid_plan_upgrade",
                "evidenceBoundary": (
                    "user-provided named-owner decision in the current task "
                    "transcript; no immutable external receipt"
                ),
            },
        )
        self.assertEqual(
            DECISION["currentState"],
            {
                "organizationPlan": "Free",
                "planEligible": False,
                "leakedPasswordProtection": "disabled",
                "settingsChanged": 0,
                "blockerCode": "subscription_plan_eligibility_free_plan",
            },
        )
        self.assertEqual(
            DECISION["resumeRequirements"],
            [
                "new named-owner Pro-plan decision",
                "eligible-plan readback",
                "exact-setting apply",
                "reload readback",
                "sanitized external receipt",
            ],
        )
        raw = DECISION_PATH.read_text(encoding="utf-8").lower()
        for forbidden in (
            "access_token",
            "refresh_token",
            "service_role",
            "credit_card",
            "billing_address",
            "email_address",
            "cookie",
        ):
            self.assertNotIn(forbidden, raw)

    def test_security_workflow_runs_this_contract(self) -> None:
        path = "backend/supabase/tests/test_auth_hardening_evidence_source.py"
        self.assertIn(f"- '{path}'", WORKFLOW)
        self.assertIn(
            "- 'backend/supabase/auth-hardening-decision.v1.json'",
            WORKFLOW,
        )
        self.assertIn(
            "backend.supabase.tests.test_auth_hardening_evidence_source",
            WORKFLOW,
        )


if __name__ == "__main__":
    unittest.main()
