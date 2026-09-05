"""Source-only contracts for the bounded Supabase advisor classification."""

from __future__ import annotations

import json
import fnmatch
import hashlib
import re
import unittest
import yaml
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CLASSIFICATION = ROOT / "backend/supabase/advisor-classification.v1.json"
FOLLOW_UP = ROOT / "backend/supabase/migrations/20260903174413_advisor_followup_hardening.sql"
G010_DELETION = ROOT / "backend/supabase/migrations/20260712000300_g010_account_deletion.sql"
G014_BOUNDARY = ROOT / "backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql"
MIGRATIONS = ROOT / "backend/supabase/migrations"
WORKFLOW = ROOT / ".github/workflows/security-audit.yml"


class AdvisorFollowUpSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.document = json.loads(CLASSIFICATION.read_text(encoding="utf-8"))
        cls.follow_up = FOLLOW_UP.read_text(encoding="utf-8")
        cls.g010 = G010_DELETION.read_text(encoding="utf-8")
        cls.g014 = G014_BOUNDARY.read_text(encoding="utf-8")
        cls.all_migrations = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted(MIGRATIONS.glob("*.sql"))
        )

    def test_classification_is_bounded_and_never_claims_apply(self) -> None:
        self.assertEqual(self.document["schemaVersion"], 1)
        self.assertEqual(self.document["kind"], "supabase_security_advisor_classification")
        self.assertEqual(
            self.document["scope"],
            "bounded catalog metadata and source reconciliation only",
        )
        self.assertIn("migration application", self.document["notEvidenceOf"])
        raw = CLASSIFICATION.read_text(encoding="utf-8").lower()
        for forbidden in (
            "access_token",
            "refresh_token",
            "service_role_key",
            "database_url",
            "connection_string",
        ):
            self.assertNotIn(forbidden, raw)

    def test_follow_up_is_immutable_and_follows_its_privacy_prerequisites(self) -> None:
        self.assertGreater(FOLLOW_UP.name, G010_DELETION.name)
        self.assertGreater(FOLLOW_UP.name, G014_BOUNDARY.name)
        # Later additive migrations are expected. Protect these exact reviewed
        # bytes rather than requiring this migration to remain globally newest.
        self.assertEqual(
            hashlib.sha256(FOLLOW_UP.read_bytes()).hexdigest(),
            "ae834917e3f6c6653d570dacd27d3894d15fcac2a4f09db86f0f9d0f51815148",
        )

    def test_definer_view_is_retained_as_a_named_owner_approved_exception(self) -> None:
        item = self.document["securityDefinerView"]
        self.assertEqual(item["identity"], "public.privacy_consent_state")
        self.assertEqual(item["advisorLevel"], "ERROR")
        self.assertEqual(
            item["disposition"],
            "owner_approved_bounded_exception",
        )
        decision = item["ownerDecision"]
        self.assertEqual(
            set(decision),
            {
                "status",
                "approverDisplayName",
                "scope",
                "evidenceBoundary",
                "notApprovalFor",
            },
        )
        self.assertEqual(decision["status"], "approved_to_retain")
        self.assertEqual(decision["approverDisplayName"], "최연우")
        self.assertEqual(
            decision["scope"],
            "public.privacy_consent_state owner-bridge security-design exception only",
        )
        self.assertIn("current task transcript", decision["evidenceBoundary"])
        self.assertIn("no immutable external receipt", decision["evidenceBoundary"])
        self.assertEqual(
            set(decision["notApprovalFor"]),
            {
                "hosted migration application",
                "legal or privacy compliance review",
                "general production security certification",
                "release readiness",
            },
        )
        self.assertIn("keep the Advisor ERROR visible", item["candidateAction"])
        for expected in (
            "WITH (security_barrier = true)",
            "WHERE event.user_id = auth.uid()",
            "ALTER VIEW public.privacy_consent_state OWNER TO privacy_workflow_owner",
            "GRANT SELECT ON TABLE public.privacy_consent_state TO authenticated",
            "ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY",
        ):
            self.assertIn(expected, self.g014)
        self.assertNotIn("ALTER VIEW public.privacy_consent_state", self.follow_up)
        self.assertNotIn("security_invoker", self.follow_up)

    def test_four_project_constraints_are_explicit_follow_up_validations(self) -> None:
        items = self.document["unvalidatedConstraints"]["projectOwned"]
        self.assertEqual(len(items), 4)
        self.assertTrue(all(item["sourceState"] == "intentional_not_valid" for item in items))
        self.assertTrue(all(item["violationCount"] == 0 for item in items))
        self.assertEqual(
            self.document["unvalidatedConstraints"]["managedConstraintExcluded"],
            "realtime.messages.messages_payload_exclusive",
        )
        for item in items:
            constraint = item["identity"].rsplit(".", 1)[-1]
            self.assertIn(f"{constraint}\n", self.g010)
            self.assertRegex(
                self.g010,
                rf"ADD CONSTRAINT {re.escape(constraint)}[\s\S]*?NOT VALID",
            )
            self.assertEqual(
                self.follow_up.count(f"VALIDATE CONSTRAINT {constraint};"),
                1,
            )
        self.assertIn("PERFORM privacy_retention.assert_g014_catalog_manifest();", self.follow_up)
        self.assertIn("DISABLE TRIGGER g014_catalog_manifest_immutable", self.follow_up)
        self.assertIn("ENABLE TRIGGER g014_catalog_manifest_immutable", self.follow_up)
        self.assertIn("GET DIAGNOSTICS v_updated = ROW_COUNT", self.follow_up)
        self.assertIn("IF v_updated <> 4", self.follow_up)
        self.assertIn("advisor_hardening_manifest_update_count", self.follow_up)
        self.assertIn("advisor_hardening_manifest_trigger_readback_failed", self.follow_up)

    def test_every_mutable_signature_has_one_fixed_path_alter(self) -> None:
        item = self.document["mutableSearchPath"]
        signatures = item["signatures"]
        self.assertEqual(item["advisorWarningCount"], 26)
        self.assertEqual(len(signatures), 26)
        self.assertEqual(len(signatures), len(set(signatures)))
        self.assertTrue(item["allSecurityInvoker"])
        self.assertEqual(item["anonymousOrPublicExecutableCount"], 0)
        for signature in signatures:
            self.assertEqual(self.follow_up.count(f"'{signature}'"), 2)
        self.assertEqual(
            self.follow_up.count(
                "'ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions'"
            ),
            1,
        )
        self.assertIn("v_oid::text", self.follow_up)

    def test_missing_hosted_trigger_function_is_recovered_with_bounded_acl(self) -> None:
        expected = "public.touch_admin_workflow_updated_at()"
        self.assertIn(f"CREATE OR REPLACE FUNCTION {expected}", self.follow_up)
        self.assertIn("NEW.updated_at = pg_catalog.now();", self.follow_up)
        self.assertIn("RETURNS trigger", self.follow_up)
        self.assertIn("SECURITY INVOKER", self.follow_up)
        self.assertIn(f"ALTER FUNCTION {expected} OWNER TO postgres;", self.follow_up)
        self.assertIn(f"REVOKE ALL ON FUNCTION {expected}", self.follow_up)
        self.assertNotIn(f"GRANT EXECUTE ON FUNCTION {expected}", self.follow_up)

    def test_fixed_path_preflight_and_readback_fail_closed(self) -> None:
        for role in ("anon", "authenticated", "service_role"):
            self.assertIn(
                f"has_schema_privilege('{role}', namespace.oid, 'CREATE')",
                self.follow_up,
            )
        self.assertIn("acl.grantee = 0", self.follow_up)
        self.assertIn("namespace.nspname IN ('public', 'extensions')", self.follow_up)
        self.assertEqual(self.follow_up.count("'public.vector'"), 2)
        self.assertEqual(self.follow_up.count("pg_catalog.quote_ident(v_vector_schema)"), 2)
        self.assertIn(
            "procedure.proconfig = ARRAY['search_path=pg_catalog, public, extensions']",
            self.follow_up,
        )
        for code in (
            "advisor_hardening_schema_not_trusted",
            "advisor_hardening_vector_schema_mismatch",
            "advisor_hardening_function_missing",
            "advisor_hardening_function_not_invoker",
            "advisor_hardening_function_readback_failed",
            "advisor_hardening_constraint_readback_failed",
        ):
            self.assertIn(code, self.follow_up)
        self.assertNotIn("GRANT EXECUTE", self.follow_up)
        self.assertNotIn("SECURITY DEFINER", self.follow_up.split("DO $harden_functions$", 1)[1])

    def test_definer_findings_equal_the_intentional_source_acl_surface(self) -> None:
        item = self.document["securityDefinerExecution"]
        self.assertEqual(item["anonymousFindingCount"], 1)
        self.assertEqual(item["authenticatedFindingCount"], 18)
        self.assertEqual(
            item["anonymousFunctions"],
            ["read_release_auth_revocation_by_operation"],
        )
        self.assertEqual(len(item["authenticatedFunctions"]), 18)
        self.assertEqual(len(set(item["authenticatedFunctions"])), 18)
        for name in item["authenticatedFunctions"]:
            in_g014_allowlist = re.search(
                rf"\('public\.{re.escape(name)}\(", self.g014
            ) is not None
            has_follow_on_grant = re.search(
                rf"GRANT EXECUTE ON FUNCTION public\.{re.escape(name)}\(",
                self.all_migrations,
            ) is not None
            has_follow_on_revoke = re.search(
                rf"REVOKE ALL ON FUNCTION public\.{re.escape(name)}\(",
                self.all_migrations,
            ) is not None
            self.assertTrue(
                in_g014_allowlist or (has_follow_on_grant and has_follow_on_revoke),
                name,
            )
        self.assertIn(
            "('public.read_release_auth_revocation_by_operation(uuid)', 'anon'::name)",
            self.g014,
        )

    def test_security_workflow_runs_this_contract(self) -> None:
        source = WORKFLOW.read_text(encoding="utf-8")
        workflow = yaml.safe_load(source)
        triggers = workflow.get('on', workflow.get(True))['pull_request']['paths']
        self.assertEqual(
            source.count("backend.supabase.tests.test_advisor_followup_source"),
            1,
        )
        for trigger in (
            "backend/supabase/advisor-classification.v1.json",
            "backend/supabase/migrations/20260903174413_advisor_followup_hardening.sql",
            "backend/supabase/tests/test_advisor_followup_source.py",
        ):
            self.assertTrue(any(fnmatch.fnmatchcase(trigger, pattern) for pattern in triggers), trigger)


if __name__ == "__main__":
    unittest.main()
