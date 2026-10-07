"""Exact custody; functional SQL and registration postconditions are unchanged."""
import unittest
from pathlib import Path
from backend.supabase.scripts import transform_registration_replay as replay

ROOT = Path(__file__).resolve().parents[3]


class RegistrationReplayTests(unittest.TestCase):
    def test_actual_sources_preserve_prefix_and_postconditions(self):
        for name in replay.SOURCES:
            with self.subTest(name=name):
                source = (ROOT/'backend/supabase/migrations'/name).read_bytes()
                result = replay.transform(source, name)
                start = source.index(replay.GUARD_START)
                end = source.index(replay.GUARD_END, start)+len(replay.GUARD_END)
                self.assertEqual(result[:start], source[:start])
                restored = result.replace(replay.LEGACY_WINDOW, source[start:end], 1).replace(replay.LEGACY_REVOKE, replay.REVOKE, 1)
                self.assertEqual(restored, source)
                for invariant in (b'after_members IS DISTINCT FROM before_members', b'proowner=', b'proconfig=', b'assert_g014_public_rpc_allowlist()', b'DROP FUNCTION pg_temp.'):
                    self.assertIn(invariant, result)
                self.assertNotIn(b'NOT inherit_option AND NOT set_option', result)
                self.assertIn(b'REGISTRATION_REPLAY_PG15_REQUIRED', result)

    def test_unknown_changed_and_transformed_sources_are_rejected(self):
        for name in replay.SOURCES:
            source = (ROOT/'backend/supabase/migrations'/name).read_bytes()
            for value, filename in ((source+b'\n',name),(source,'other.sql'),(replay.transform(source,name),name)):
                with self.subTest(name=name), self.assertRaisesRegex(ValueError,'source_drift'):
                    replay.transform(value, filename)


if __name__ == '__main__':
    unittest.main()
