"""Verify the source-only guardian replay preserves semantics and cleanup."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "backend/supabase/scripts/transform_g014_guardian_replay.py"
spec = importlib.util.spec_from_file_location("guardian_replay", MODULE)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
SOURCE = ROOT / "backend/supabase/migrations/20260827084200_g014_8_guardian_provider_verification.sql"


class GuardianReplayTests(unittest.TestCase):
    def test_exact_migration_body_is_preserved_outside_the_two_assertion_anchors(self):
        source = SOURCE.read_bytes()
        result = replay.transform(source).decode()
        restored = result.replace(replay.BRIDGE, replay.ASSERTION).replace(replay.FINAL, replay.END)
        self.assertEqual(restored.encode(), source)

    def test_assertion_runs_after_membership_cleanup_and_before_commit(self):
        result = replay.transform(SOURCE.read_bytes()).decode()
        cleanup = result.index("'REVOKE privacy_workflow_owner FROM %I'")
        assertion = result.index("SELECT (pg_temp.g014_guardian_replay_assertion()).asserted;")
        self.assertLess(cleanup, assertion)
        self.assertLess(assertion, result.rindex("COMMIT;"))
        self.assertEqual(result.count("PERFORM privacy_retention.assert_g014_catalog_contract();"), 1)
        self.assertIn("ON COMMIT DROP", result)
        self.assertIn("RETURNS pg_temp.g014_guardian_replay_guard", result)
        self.assertIn("SET search_path = ''", result)
        self.assertIn("REVOKE ALL ON FUNCTION pg_temp.g014_guardian_replay_assertion()", result)

    def test_rejects_changed_or_already_transformed_source(self):
        for source in (SOURCE.read_bytes() + b"\n", replay.transform(SOURCE.read_bytes())):
            with self.assertRaisesRegex(ValueError, "guardian_replay_source_drift"):
                replay.transform(source)

    def test_generator_records_separate_transformed_hash_and_ci_runs_tests(self):
        generator = (ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh").read_text()
        self.assertIn('guardian-replay-assertion-window:${migration##*/}', generator)
        self.assertIn('transform_g014_guardian_replay.py', generator)
        workflow = (ROOT / '.github/workflows/g014-catalog-contract-baseline.yml').read_text()
        self.assertIn('backend.supabase.tests.test_g014_guardian_replay', workflow)
