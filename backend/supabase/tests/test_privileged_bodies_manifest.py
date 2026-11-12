"""Keep the privileged-body manifest equal to the migrations that need it.

PostgreSQL refuses any statement that mentions SUPERUSER for a non-superuser, even
when it owns the role and holds CREATEROLE (measured 2026-11-11). The applier can
run those bodies as the privileged role behind TZUDONG_LOCAL_PRIVILEGED_BODIES,
and this test pins the manifest to the sources plus the flag's default-off
behaviour.
"""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "backend/supabase/baselines/local/LOCAL_PRIVILEGED_BODIES.v1.json"
MIGRATIONS = ROOT / "backend/supabase/migrations"
APPLIER = ROOT / "backend/supabase/scripts/local-migrate.py"


class PrivilegedBodiesManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.sources = {path.name: path.read_text(encoding="utf-8") for path in sorted(MIGRATIONS.glob("*.sql"))}

    def test_manifest_lists_exactly_the_superuser_migrations(self) -> None:
        self.assertEqual(self.manifest["schemaVersion"], 1)
        self.assertEqual(self.manifest["id"], "local-privileged-bodies-v1")
        expected = sorted(name for name, text in self.sources.items() if "SUPERUSER" in text)
        self.assertEqual(sorted(self.manifest["migrations"]), expected)

    def test_manifest_role_is_the_privileged_role(self) -> None:
        self.assertEqual(self.manifest["role"], "supabase_admin")
        self.assertEqual(self.manifest["envFlag"], "TZUDONG_LOCAL_PRIVILEGED_BODIES")

    def test_applier_defaults_to_the_migration_role(self) -> None:
        source = APPLIER.read_text(encoding="utf-8")
        self.assertIn("TZUDONG_LOCAL_PRIVILEGED_BODIES", source)
        self.assertIn('if os.environ.get(PRIVILEGED_BODIES_ENV, "").strip() not in {"1", "true", "yes"}:', source)
        self.assertIn('body_role = "postgres"', source)
        self.assertIn("if privileged_role is not None and migration_id in _privileged_bodies():", source)

    def test_the_flag_refuses_to_run_while_the_adapters_exist(self) -> None:
        """Enabling the flag before the adapter retirement would run replacement
        bodies under the wrong role, so the applier fails closed."""
        source = APPLIER.read_text(encoding="utf-8")
        self.assertIn("privileged_bodies_require_adapter_retirement", source)
        self.assertIn("def _adapter_layer_active() -> bool:", source)
        self.assertIn('return "_canonical_source_replay_bodies" in source', source)

    def test_manifest_stays_inside_the_migration_directory(self) -> None:
        for name in self.manifest["migrations"]:
            self.assertIn(name, self.sources)


if __name__ == "__main__":
    unittest.main()
