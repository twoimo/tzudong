"""Bindings and failure paths for the source-only custody catalog replay."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

from backend.supabase.scripts import transform_hosted_pending_custody_pg15_replay as replay

ROOT = Path(__file__).resolve().parents[3]
DRIVER = ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"


class HostedPendingCustodyPg15ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "backend/supabase/migrations" / replay.NAME).read_bytes()
        cls.adapted = replay.transform(cls.source)

    def test_wrong_source_or_name_is_rejected(self):
        for source, name in (
            (self.source + b"\n", replay.NAME),
            (self.source, "20261025063811_hosted_pending_atomic_delivery.sql"),
            (self.source.replace(b"150000", b"150001"), replay.NAME),
            (self.source.replace(b"GRANT EXECUTE", b"GRANT ALL"), replay.NAME),
        ):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "SOURCE_DRIFT"):
                replay.transform(source, name)

    def test_superseded_index_requires_both_exact_sources(self):
        index = (ROOT / "backend/supabase/migrations" / replay.SUPERSEDED_INDEX_NAME).read_bytes()
        receipt = replay.classify_superseded_index(index, self.source)
        self.assertEqual(receipt["source_sha256"], hashlib.sha256(index).hexdigest())
        self.assertEqual(receipt["successor_sha256"], hashlib.sha256(self.source).hexdigest())
        self.assertFalse(receipt["operating_index_dropped"])
        self.assertFalse(receipt["operating_ledger_admission_verified"])
        for old, new, name, successor_name in (
            (index + b"\n", self.source, replay.SUPERSEDED_INDEX_NAME, replay.NAME),
            (index, self.source + b"\n", replay.SUPERSEDED_INDEX_NAME, replay.NAME),
            (index, self.source, "other.sql", replay.NAME),
            (index, self.source, replay.SUPERSEDED_INDEX_NAME, "other.sql"),
        ):
            with self.subTest(name=name, successor=successor_name), self.assertRaisesRegex(ValueError, "SOURCE_DRIFT"):
                replay.classify_superseded_index(old, new, name, successor_name)

    def test_superseded_disposition_never_executes_old_sql(self):
        driver = DRIVER.read_text()
        branch = driver.split(replay.SUPERSEDED_INDEX_NAME + ")", 1)[1].split(";;", 1)[0]
        self.assertIn("--superseded-by", branch)
        self.assertIn("g026_chain_apply", branch)
        self.assertNotIn("psql", branch)
        self.assertNotIn("DROP INDEX", branch)

    def test_replay_roundtrips_and_rejects_edited_output(self):
        self.assertEqual(replay.restore(self.adapted), self.source)
        for changed in (
            self.adapted + b"\n",
            self.adapted.replace(b"PENDING_CUTOVER_PROJECTION_BOUND", b"REMOVED_BOUND"),
            self.adapted.replace(b"GRANT privacy_workflow_owner TO postgres;", b""),
        ):
            with self.assertRaisesRegex(ValueError, "BODY_DRIFT"):
                replay.restore(changed)

    def test_all_feature_function_bodies_and_wrappers_are_unchanged(self):
        # Dollar-quoted CREATE FUNCTION bodies, including the snapshot and G014
        # bridge, are immutable even when their surrounding admission differs.
        pattern = rb"CREATE FUNCTION [\s\S]*?AS (\$[A-Za-z_]*\$)[\s\S]*?\1;"
        original = re.findall(pattern, self.source)
        self.assertEqual(len(original), 14)
        source_bodies = re.finditer(pattern, self.source)
        replay_bodies = re.finditer(pattern, self.adapted)
        self.assertEqual([m[0] for m in source_bodies], [m[0] for m in replay_bodies])

    def test_guard_and_preservation_checks_remain(self):
        for marker in (
            b"current_user<>'postgres' OR session_user<>'postgres'",
            b"current_setting('is_superuser')<>'off'",
            b"current_setting('transaction_read_only')<>'off'",
            b"current_setting('transaction_isolation')<>'read committed'",
            b"pg_catalog.to_regnamespace('supabase_migrations') IS NOT NULL",
            b"pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL",
            b"pending_custody_install_outer_transaction_required",
            b"pending_custody_install_assertion_source_drift",
            b"after_members IS DISTINCT FROM before_members",
            b"IS DISTINCT FROM pg_temp.pending_custody_snapshot()",
            b"pg_temp.pending_custody_install_g014_check('pre')",
            b"pg_temp.pending_custody_install_g014_check('post')",
            b"PENDING_IDENTITY_SOURCE_DRIFT", b"PENDING_CUTOVER_INVENTORY_BOUND",
            b"PENDING_CUTOVER_PROJECTION_BOUND", b"PENDING_CUTOVER_TERMINAL_INVALID",
            b"REVOKE INSERT ON TABLE public.restaurants FROM service_role",
        ):
            self.assertIn(marker, self.adapted)
        self.assertNotIn(b"NOT inherit_option", self.adapted)
        self.assertNotIn(b"'privacy_workflow_owner','SET'", self.adapted)
        self.assertNotIn(b"arwdDxtm", self.adapted)

    def test_driver_has_exactly_one_transactional_hash_bound_branch(self):
        driver = DRIVER.read_text()
        branches = re.findall(r"^\s+([^\n]+\.sql)\)\s*$", driver, re.M)
        self.assertEqual(sum(replay.NAME in b.split("|") for b in branches), 1)
        branch = driver.split(replay.NAME + ")", 1)[1].split(";;", 1)[0]
        for marker in (
            "transform_hosted_pending_custody_pg15_replay.py", "--single-transaction", "--file=-",
            "ON_ERROR_STOP=1", "g026_chain_apply", "--receipt", "$staging_dir/",
        ):
            self.assertIn(marker, branch)
        self.assertLess(driver.index('for migration in "${effective_migrations[@]}"'),
                        driver.index(replay.NAME + ")"))

    def test_cli_evidence_is_bound_and_exclusive(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "replay.sql"
            receipt = Path(directory) / "replay.json"
            command = [sys.executable, replay.__file__, "--source",
                       str(ROOT / "backend/supabase/migrations" / replay.NAME),
                       "--output", str(output), "--receipt", str(receipt)]
            result = subprocess.run(command, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            evidence = json.loads(receipt.read_bytes())
            self.assertEqual(evidence["source_sha256"], hashlib.sha256(self.source).hexdigest())
            self.assertEqual(evidence["replay_sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
            self.assertFalse(evidence["operating_admission_executed"])
            self.assertFalse(evidence["operating_ledger_admission_verified"])
            self.assertFalse(evidence["operating_membership_options_verified"])
            before = output.read_bytes(), receipt.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True, timeout=10).returncode, 0)
            self.assertEqual((output.read_bytes(), receipt.read_bytes()), before)


if __name__ == "__main__":
    unittest.main()
