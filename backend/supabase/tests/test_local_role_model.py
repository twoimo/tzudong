"""Keep the local role model equal to what the migrations actually do.

The PostgreSQL 17 transition needs the role model written down, because the chain
is sensitive to it in both directions: privileged statements are refused for
`postgres`, and objects created by a privileged run are unusable by the following
`postgres` migrations. This test keeps the recorded model honest against the
migration sources so the document cannot drift from the code.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MODEL = ROOT / "backend/supabase/baselines/local/LOCAL_ROLE_MODEL.v1.json"
MIGRATIONS = ROOT / "backend/supabase/migrations"


def _sources() -> dict[str, str]:
    return {path.name: path.read_text(encoding="utf-8") for path in sorted(MIGRATIONS.glob("*.sql"))}


class LocalRoleModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.model = json.loads(MODEL.read_text(encoding="utf-8"))
        self.sources = _sources()

    def test_model_shape(self) -> None:
        self.assertEqual(self.model["schemaVersion"], 1)
        self.assertEqual(self.model["id"], "local-role-model-v1")
        self.assertTrue(self.model["rules"])
        for rule in self.model["rules"]:
            self.assertTrue(rule["id"] and rule["rule"] and rule["verifiedBy"], rule)

    def test_privileged_files_match_the_sources(self) -> None:
        expected = sorted(name for name, text in self.sources.items() if "SUPERUSER" in text)
        self.assertEqual(sorted(self.model["privilegedFiles"]), expected)

    def test_role_statement_files_match_the_sources(self) -> None:
        expected = sorted(
            name for name, text in self.sources.items() if re.search(r"(CREATE|ALTER) ROLE", text)
        )
        self.assertEqual(sorted(self.model["roleStatementFiles"]), expected)

    def test_every_privileged_file_is_also_a_role_statement_file(self) -> None:
        privileged = set(self.model["privilegedFiles"])
        self.assertTrue(privileged <= set(self.model["roleStatementFiles"]), privileged)

    def test_recorded_roles_appear_in_the_sources(self) -> None:
        combined = "\n".join(self.sources.values())
        for role in self.model["roles"]:
            if role.get("createdBy") != "migration":
                continue
            self.assertIn(role["name"], combined, role["name"])


if __name__ == "__main__":
    unittest.main()
