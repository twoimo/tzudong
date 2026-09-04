import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "backend/supabase/scripts/recover_advisor_replay_prerequisites.py"
spec = importlib.util.spec_from_file_location("advisor_replay", MODULE)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


class AdvisorReplayPrerequisiteTests(unittest.TestCase):
    def test_only_nine_exact_invoker_definitions_are_recovered_with_no_data_or_grants(self):
        source = (ROOT / replay.SOURCE_PATH).read_bytes()
        sql, receipt = replay.recover(source)
        self.assertEqual(len(receipt["functions"]), 9)
        self.assertEqual(sql.count(b"CREATE FUNCTION public."), 9)
        self.assertEqual(sql.count(b"REVOKE ALL ON FUNCTION"), 9)
        self.assertEqual(sql.count(b"OWNER TO postgres"), 9)
        self.assertIn("public.search_restaurants_by_name(text,integer)", [entry["signature"] for entry in receipt["functions"]])
        self.assertNotIn(b"CREATE OR REPLACE", sql)
        self.assertNotIn(b"search_categories text[]", sql)
        self.assertNotIn(b"SECURITY DEFINER", sql)
        self.assertNotIn(b"GRANT ", sql)
        self.assertNotIn(b"CREATE TABLE", sql)
        self.assertNotIn(b"INSERT INTO", sql)
        self.assertEqual(receipt["outputSha256"], hashlib.sha256(sql).hexdigest())
        self.assertEqual(receipt["dataRowsCopied"], 0)

    def test_changed_source_is_denied(self):
        with self.assertRaisesRegex(ValueError, "advisor_replay_prerequisite_source_drift"):
            replay.recover((ROOT / replay.SOURCE_PATH).read_bytes() + b"\n")

    def test_generator_keeps_recovery_and_unchanged_advisor_migration_atomic_and_receipted(self):
        generator = (ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh").read_text()
        self.assertIn('g026_chain_apply "advisor-current-prerequisites" "$advisor_prerequisites"', generator)
        self.assertIn('--single-transaction -f -', generator)
        self.assertIn('cat -- "$advisor_prerequisites" "$migration"', generator)
        self.assertIn('advisor-prerequisite-recovery.json advisor-prerequisites.sql', generator)
        self.assertEqual(hashlib.sha256((ROOT / "backend/supabase/migrations/20260903174413_advisor_followup_hardening.sql").read_bytes()).hexdigest(),
                         "ae834917e3f6c6653d570dacd27d3894d15fcac2a4f09db86f0f9d0f51815148")
