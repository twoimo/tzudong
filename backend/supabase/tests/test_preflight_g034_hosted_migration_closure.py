import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "preflight_g034_hosted_migration_closure.py"
spec = importlib.util.spec_from_file_location("g034_preflight", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class G034HostedPreflightTests(unittest.TestCase):
    def test_manifest_is_exact_selected_closure_and_later_gate(self):
        data = module.load_manifest(module.MANIFEST)
        self.assertEqual(len(data["migrations"]), 27)
        self.assertEqual(data["migrations"][0]["version"], "20260627080000")
        self.assertEqual(data["migrations"][-1]["version"], "20260713002400")
        self.assertEqual(data["requiredLaterPromotionGate"], "20260713002500_g014_catalog_contract.sql")
        self.assertIn("20260713002500", data["excludedVersions"])
        self.assertNotIn("20260713002200", [entry["version"] for entry in data["migrations"]])

    def test_manifest_rejects_extra_key_duplicate_and_bad_hash(self):
        data = json.loads(module.MANIFEST.read_text())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            data["unexpected"] = True
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                module.load_manifest(path)
            path.write_text('{"schemaVersion":1,"schemaVersion":1}')
            with self.assertRaises(ValueError):
                module.load_manifest(path)
        self.assertTrue(all(module.HASH.fullmatch(e["sha256"]) for e in json.loads(module.MANIFEST.read_text())["migrations"]))

    def test_static_risk_detection_never_executes_sql(self):
        self.assertIsNotNone(module.RISK.search("BEGIN; DELETE FROM restaurants; COMMIT;"))
        self.assertIsNone(module.RISK.search("SELECT count(*) FROM pg_catalog.pg_class"))

    def test_catalog_queries_are_read_only_and_sanitized(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('cursor.execute("BEGIN READ ONLY")', source)
        self.assertIn("statement_timeout", source)
        self.assertIn("lock_timeout", source)
        self.assertIn("idle_in_transaction_session_timeout", source)
        self.assertNotIn("migration_bytes", source)
        self.assertNotIn("SUPABASE_DB_URL\"]", source.split('report =', 1)[1])
        self.assertIn('"cloneBackupRecoveryGate": False', source)
        self.assertIn('"safeToApply": False', source)

    def test_catalog_failure_is_fail_closed(self):
        report = {"blockers": []}
        previous = module.os.environ.pop("SUPABASE_DB_URL", None)
        try:
            module.catalog_preflight(report)
        finally:
            if previous is not None:
                module.os.environ["SUPABASE_DB_URL"] = previous
        self.assertIn("catalog-read-failed", report["blockers"])

    def test_validate_only_accepts_exact_sources_but_retains_promotion_blockers(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "artifact.json"
            self.assertEqual(0, module.main(["--validate-only", "--artifact", str(artifact)]))
            report = json.loads(artifact.read_text(encoding="utf-8"))
        self.assertTrue(report["sourceValid"])
        self.assertFalse(report["safeToApply"])
        self.assertIn("clone-backup-recovery-required", report["blockers"])


if __name__ == "__main__":
    unittest.main()
