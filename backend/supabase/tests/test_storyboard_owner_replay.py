from pathlib import Path
import re
import unittest
from backend.supabase.scripts.transform_storyboard_owner_replay import transform, PREFIX, SUFFIX, SOURCE_NAME, SOURCE_BINDINGS

ROOT = Path(__file__).resolve().parents[3]
class StoryboardOwnerReplayTests(unittest.TestCase):
    def test_source_is_unchanged_inside_one_bounded_transaction(self):
        source=(ROOT/'backend/supabase/migrations'/SOURCE_NAME).read_bytes()
        body=b''.join(line for line in source.splitlines(keepends=True) if line.strip(b'\r\n') not in (b'BEGIN;',b'COMMIT;'))
        actual=transform(source)
        self.assertEqual(actual,PREFIX+body+SUFFIX)
        self.assertEqual(actual.count(b'GRANT privacy_workflow_owner TO postgres;'),1)
        self.assertEqual(actual.count(b'REVOKE privacy_workflow_owner FROM postgres;'),1)
        self.assertIn(b'pg_temp.storyboard_owner_lease',actual)
        self.assertIn(b'STORYBOARD_REPLAY_MEMBERSHIP_DRIFT',actual)
        self.assertNotIn(b'WITH ADMIN OPTION',actual)
    def test_changed_source_is_denied(self):
        source=(ROOT/'backend/supabase/migrations'/SOURCE_NAME).read_bytes()
        with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):transform(source+b'\n')
    def test_historical_restore_uses_its_own_exact_source_binding(self):
        name='20260920021531_storyboard_historical_restore.sql'
        source=(ROOT/'backend/supabase/migrations'/name).read_bytes()
        self.assertEqual(set(SOURCE_BINDINGS),{SOURCE_NAME,name})
        self.assertTrue(transform(source,name).startswith(PREFIX))
        with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):transform(source,SOURCE_NAME)
    def test_generator_and_workflow_include_the_explicit_source_only_path(self):
        source=(ROOT/'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        self.assertIn("'backend/supabase/scripts/transform_storyboard_owner_replay.py'",source)
        case=source.split('20260920021531_storyboard_historical_restore.sql)',1)[1].split(';;',1)[0]
        self.assertIn('transform_storyboard_owner_replay.py',case)
        self.assertIn('storyboard-owner-lease-replay:',case)
        self.assertIn('ON_ERROR_STOP=1',case)
        # Earlier alternatives previously shadowed this branch even though
        # the transformer and its own source tests passed.
        alternatives = re.findall(r'^\s+([^\n]+\.sql)\)\s*$', source, re.M)
        for name in SOURCE_BINDINGS:
            matches = [row for row in alternatives if name in row.split('|')]
            self.assertEqual(len(matches), 1, name)
        workflow=(ROOT/'.github/workflows/g014-catalog-contract-baseline.yml').read_text()
        self.assertIn('backend/supabase/tests/test_storyboard_owner_replay.py',workflow)
        self.assertIn('backend.supabase.tests.test_storyboard_owner_replay',workflow)
