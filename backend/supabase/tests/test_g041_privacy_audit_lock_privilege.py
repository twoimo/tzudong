import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "backend/supabase/migrations/20260804000100_g041_privacy_audit_lock_privilege.sql"


class PrivacyAuditLockPrivilegeMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_grants_only_the_workflow_owner_update_privilege(self) -> None:
        self.assertRegex(
            self.sql,
            re.compile(
                r"GRANT UPDATE ON TABLE privacy_retention\.privacy_audit_events\s+"
                r"TO privacy_workflow_owner;",
                re.IGNORECASE,
            ),
        )
        self.assertRegex(
            self.sql,
            re.compile(
                r"REVOKE ALL ON TABLE privacy_retention\.privacy_audit_events\s+"
                r"FROM PUBLIC, anon, authenticated, service_role;",
                re.IGNORECASE,
            ),
        )
        self.assertNotRegex(
            self.sql,
            re.compile(r"GRANT\s+UPDATE\s+.*\s+TO\s+(?:anon|authenticated|service_role)", re.IGNORECASE),
        )

    def test_keeps_the_append_only_trigger_as_a_precondition(self) -> None:
        self.assertIn("g014_privacy_audit_events_append_only", self.sql)
        self.assertIn("g041_privacy_audit_immutability_trigger_missing", self.sql)
        self.assertNotRegex(self.sql, re.compile(r"DROP\s+TRIGGER", re.IGNORECASE))

    def test_appends_the_exact_update_grant_manifest_projection(self) -> None:
        self.assertIn("FROM privacy_retention.g014_catalog_manifest_rows()", self.sql)
        self.assertIn("'privilege', 'UPDATE'", self.sql)
        self.assertIn("ON CONFLICT (manifest_kind, manifest_key) DO NOTHING", self.sql)
        self.assertIn("g041_privacy_audit_update_manifest_missing", self.sql)

    def test_restores_hosted_membership_set_option(self) -> None:
        self.assertIn("WITH SET TRUE", self.sql)
        self.assertIn("WITH SET FALSE", self.sql)
        self.assertIn("g041.restore_set_false", self.sql)
        self.assertIn("g041.remove_membership", self.sql)

    def test_readback_fails_closed_for_missing_or_leaked_privilege(self) -> None:
        self.assertIn("g041_privacy_audit_update_lock_privilege_missing", self.sql)
        self.assertIn("g041_service_role_direct_update_privilege_detected", self.sql)
        self.assertIn("pg_catalog.has_table_privilege", self.sql)


if __name__ == "__main__":
    unittest.main()
