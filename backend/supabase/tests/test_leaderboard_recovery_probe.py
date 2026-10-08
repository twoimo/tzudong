import importlib.util
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'backend/supabase/scripts/build-leaderboard-recovery-probe.py'
spec = importlib.util.spec_from_file_location('leaderboard_probe', SCRIPT)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class LeaderboardRecoveryProbeTests(unittest.TestCase):
    def test_probe_has_one_rollback_and_no_commit(self):
        sql = probe.build_probe()
        self.assertEqual(re.findall(r'^BEGIN;$', sql, re.M), ['BEGIN;'])
        self.assertEqual(re.findall(r'^ROLLBACK;$', sql, re.M), ['ROLLBACK;'])
        self.assertNotRegex(sql, r'(?m)^COMMIT;$')
        drop = sql.index('DROP FUNCTION public.read_public_profile_leaderboard_page')
        create = sql.index('DO $restore_leaderboard$')
        fixture = sql.index('INSERT INTO auth.users')
        rollback = sql.index('\nROLLBACK;')
        self.assertLess(drop, create)
        self.assertLess(create, fixture)
        self.assertLess(fixture, rollback)
        self.assertIn('leaderboard_recovery_probe_rollback_drift', sql)

    def test_invalid_wrappers_fail_before_emitting_an_applicable_probe(self):
        for text, terminal in [('SELECT 1;', 'COMMIT'),
                               ('BEGIN;\nBEGIN;\nCOMMIT;', 'COMMIT'),
                               ('BEGIN;\nROLLBACK;', 'COMMIT')]:
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'transaction_shape'):
                probe.unwrap(text, terminal)

    def test_no_connection_or_arbitrary_source_argument_is_admitted(self):
        result = subprocess.run(['python3', str(SCRIPT), '--container', 'not-admitted'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(), 'leaderboard_recovery_probe_invalid')


if __name__ == '__main__':
    unittest.main()
