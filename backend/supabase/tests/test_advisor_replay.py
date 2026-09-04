import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("advisor_assertion_replay", ROOT / "backend/supabase/scripts/transform_advisor_replay.py")
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
SOURCE = ROOT / "backend/supabase/migrations/20260903174413_advisor_followup_hardening.sql"


class AdvisorReplayTests(unittest.TestCase):
    def test_assertions_keep_all_source_work_and_run_after_owner_cleanup(self):
        source = SOURCE.read_bytes()
        sql = replay.transform(source).decode()
        body = sql[sql.index("-- Source-only follow-up"): ]
        source_text = source.decode()
        validations = source_text[source_text.index(replay.VALIDATION_START):source_text.index(replay.VALIDATION_END)]
        restored = body.replace(
            "SET LOCAL ROLE privacy_workflow_owner;\n" + validations,
            "SET LOCAL ROLE privacy_workflow_owner;", 1,
        ).replace(replay.VALIDATION_END, validations + replay.VALIDATION_END, 1).replace(
            "PERFORM pg_temp.advisor_replay_assertion();", replay.ASSERTION
        ).encode()
        self.assertEqual(restored, source)
        self.assertEqual(body.count("VALIDATE CONSTRAINT"), 4)
        self.assertLess(body.index("SET LOCAL ROLE privacy_workflow_owner;"), body.index(replay.VALIDATION_START))
        self.assertLess(body.index(replay.VALIDATION_START), body.index("DISABLE TRIGGER"))
        self.assertEqual(sql.count("PERFORM pg_temp.advisor_replay_assertion();"), 2)
        self.assertLess(sql.index("$replay_membership_readback$;"), sql.index("DO $catalog_preflight$"))
        self.assertIn("SECURITY DEFINER SET search_path = ''", sql)
        self.assertIn("RETURNS pg_temp.advisor_replay_guard", sql)
        self.assertIn("ON COMMIT DROP", sql)
        self.assertIn("advisor_replay.membership_before", sql)
        self.assertIn("IS DISTINCT FROM", sql)
        self.assertIn("advisor_replay.restore_set_false", sql)
        self.assertIn("advisor_replay_owner_membership_not_restored", sql)
        self.assertEqual(hashlib.sha256(source).hexdigest(), replay.SOURCE_SHA256)

    def test_source_drift_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "advisor_replay_source_drift"):
            replay.transform(SOURCE.read_bytes() + b"\n")
