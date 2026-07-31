import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "backend/supabase/migrations/20260801000100_g016_privacy_audit_owner_policy.sql"


class PrivacyAuditOwnerPolicyMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_policy_is_scoped_to_workflow_owner(self) -> None:
        self.assertRegex(
            self.sql,
            re.compile(
                r"CREATE POLICY g016_privacy_workflow_owner_access\s+"
                r"ON privacy_retention\.privacy_audit_events\s+"
                r"FOR ALL\s+TO privacy_workflow_owner\s+"
                r"USING \(true\)\s+WITH CHECK \(true\);",
                re.IGNORECASE,
            ),
        )

    def test_direct_api_table_access_remains_revoked(self) -> None:
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
            re.compile(r"GRANT\s+.*\s+TO\s+(?:anon|authenticated|service_role)", re.IGNORECASE),
        )

    def test_catalog_manifest_appends_exact_policy_projection(self) -> None:
        self.assertIn(
            "INSERT INTO privacy_retention.g014_catalog_contract_manifest",
            self.sql,
        )
        self.assertIn(
            "FROM privacy_retention.g014_catalog_manifest_rows()",
            self.sql,
        )
        self.assertIn(
            "ON CONFLICT (manifest_kind, manifest_key) DO NOTHING",
            self.sql,
        )

    def test_migration_fails_closed_on_missing_dependencies(self) -> None:
        self.assertIn("g016_privacy_workflow_owner_missing", self.sql)
        self.assertIn("g016_privacy_audit_events_missing", self.sql)
        self.assertIn("FORCE ROW LEVEL SECURITY", self.sql)


if __name__ == "__main__":
    unittest.main()
