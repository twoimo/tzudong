import subprocess
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
LEGACY_SCRIPT = REPOSITORY_ROOT / "backend" / "supabase" / "migrate_storage.sh"


class LocalStorageMigrationBoundaryTests(unittest.TestCase):
    def test_legacy_hosted_storage_copy_fails_closed_without_reading_credentials(self) -> None:
        source = LEGACY_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("not an admitted Supabase recovery path", source)
        self.assertNotIn("PGPASSWORD=", source)
        self.assertNotIn("Authorization: Bearer", source)
        self.assertNotIn("/tmp/storage_migration", source)

        result = subprocess.run(
            ["bash", str(LEGACY_SCRIPT)],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            env={},
        )
        self.assertEqual(2, result.returncode)
        self.assertEqual("", result.stdout)
        self.assertIn("Disabled:", result.stderr)
        self.assertNotIn("http", result.stderr)


if __name__ == "__main__":
    unittest.main()
