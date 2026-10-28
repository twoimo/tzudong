import copy
import importlib.util
import json
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
from utils import runtime_paths
from utils.sponsorship_disclosure import analyze_disclosure
from utils.sponsorship_projection import confirmed_sponsorship_fields

SPEC = importlib.util.spec_from_file_location('migrate_meta_sponsorship', Path(__file__).parents[1] / '02-1-migrate-meta-to-supabase.py')
migrate = importlib.util.module_from_spec(SPEC)
with patch.object(runtime_paths, 'load_backend_env', return_value=None):
    SPEC.loader.exec_module(migrate)


class MemoryClient:
    """SDK boundary fake; enforces insert-ignore and partial updates, no network."""
    def __init__(self, rows=None, concurrent_insert=None, empty_readback=False):
        self.rows = copy.deepcopy(rows or {})
        self.calls = []
        self.concurrent_insert = concurrent_insert
        self.empty_readback = empty_readback

    def table(self, name):
        assert name == 'videos'
        return self

    def upsert(self, rows, *, on_conflict, ignore_duplicates):
        assert on_conflict == 'id' and ignore_duplicates is True
        self.calls.append(('insert-ignore', copy.deepcopy(rows)))
        self.operation = ('insert', rows)
        return self

    def update(self, fields):
        self.calls.append(('update', copy.deepcopy(fields)))
        self.operation = ('update', fields)
        return self

    def eq(self, key, value):
        assert key == 'id'
        self.target = value
        return self

    def execute(self):
        kind, value = self.operation
        if kind == 'insert':
            if self.concurrent_insert:
                self.rows[self.concurrent_insert['id']] = copy.deepcopy(self.concurrent_insert)
            for row in value:
                self.rows.setdefault(row['id'], copy.deepcopy(row))
            return SimpleNamespace(data=[])
        row = self.rows.get(self.target)
        if row is not None:
            row.update(value)
        return SimpleNamespace(data=[] if self.empty_readback or row is None else [copy.deepcopy(row)])


class SponsorshipMigrationTests(unittest.TestCase):
    def test_actual_jsonl_migration_updates_base_and_retains_remote_attribution(self):
        with TemporaryDirectory() as directory:
            meta = Path(directory) / 'fixture' / 'meta'
            meta.mkdir(parents=True)
            old = {'id': 'video', 'is_ads': True, 'advertisers': ['RemoteCo']}
            row = {'youtube_link': 'https://www.youtube.com/watch?v=video', 'title': 'base title',
                   'ads_info': {'is_ads': None, 'what_ads': None, 'sponsor_analysis': {'status': 'unknown', 'outcome': 'unknown'}}}
            file = meta / 'video.jsonl'
            file.write_text(json.dumps(row) + '\n')
            before = file.read_bytes()
            client = MemoryClient({'video': old})
            with patch.object(migrate, 'DATA_DIR', Path(directory)), patch.object(migrate, 'live_insert_quota', return_value=None), redirect_stdout(io.StringIO()):
                migrate.migrate_meta(client, 'fixture')
            self.assertEqual(client.rows['video']['title'], 'base title')
            self.assertTrue(client.rows['video']['is_ads'])
            self.assertEqual(client.rows['video']['advertisers'], ['RemoteCo'])
            self.assertEqual(file.read_bytes(), before)

    def test_shared_fixtures_publish_only_confirmed_fields(self):
        fixtures = json.loads((BACKEND / 'utils/tests/fixtures/sponsorship-disclosure.json').read_text())
        self.assertGreaterEqual(len(fixtures), 55)
        for fixture in fixtures:
            with self.subTest(case=fixture['id']):
                fields = confirmed_sponsorship_fields(analyze_disclosure(fixture['description']))
                if fixture['outcome'] == 'unknown':
                    self.assertEqual(fields, {})
                else:
                    self.assertEqual(fields, {'is_ads': fixture['outcome'] == 'detected', 'advertisers': fixture['names'] or []})

    def test_unknown_updates_base_only_and_preserves_existing_positive_and_negative(self):
        for decision in [True, False]:
            with self.subTest(decision=decision):
                old = {'id': 'video', 'is_ads': decision, 'advertisers': ['SavedCo'] if decision else [], 'title': 'old'}
                client = MemoryClient({'video': old})
                unknown = {'is_ads': decision, 'what_ads': old['advertisers'], 'sponsor_analysis': {'status': 'unknown', 'outcome': 'unknown', 'retained_previous': True}}
                row = {'id': 'video', 'title': 'new', **confirmed_sponsorship_fields(unknown)}
                self.assertEqual(migrate.publish_metadata_batch(client, [row]), 1)
                self.assertEqual(client.rows['video'], {**old, 'title': 'new'})
                self.assertNotIn('is_ads', client.calls[-1][1])
                self.assertNotIn('advertisers', client.calls[-1][1])

    def test_fresh_unknown_inserts_null_instead_of_database_false_default(self):
        client = MemoryClient()
        migrate.publish_metadata_batch(client, [{'id': 'new', 'title': 'base complete'}])
        self.assertEqual(client.rows['new'], {'id': 'new', 'title': 'base complete', 'is_ads': None, 'advertisers': None})

    def test_concurrent_confirmed_insert_cannot_be_overwritten_by_unknown(self):
        winner = {'id': 'video', 'is_ads': True, 'advertisers': ['ConcurrentCo']}
        client = MemoryClient(concurrent_insert=winner)
        migrate.publish_metadata_batch(client, [{'id': 'video', 'title': 'updated'}])
        self.assertEqual(client.rows['video'], {**winner, 'title': 'updated'})

    def test_confirmed_writes_and_legacy_positive_without_names(self):
        client = MemoryClient({'video': {'id': 'video', 'is_ads': True, 'advertisers': ['SavedCo']}})
        for ads, expected in [({'is_ads': True, 'what_ads': None}, ['SavedCo']),
                              ({'is_ads': False, 'what_ads': None}, []),
                              ({'is_ads': True, 'what_ads': ['NewCo']}, ['NewCo'])]:
            migrate.publish_metadata_batch(client, [{'id': 'video', **confirmed_sponsorship_fields(ads)}])
            self.assertEqual(client.rows['video']['advertisers'], expected)
            self.assertEqual(client.rows['video']['is_ads'], ads['is_ads'])

    def test_unverified_write_is_not_counted_as_completed(self):
        with self.assertRaisesRegex(RuntimeError, '^metadata_base_write_unverified$'):
            migrate.publish_metadata_batch(MemoryClient(empty_readback=True), [{'id': 'video', 'title': 'new'}])

    def test_malformed_and_failed_analysis_never_publishes_confirmed_fields(self):
        for ads in [{'is_ads': False, 'what_ads': {}}, {'is_ads': False, 'sponsor_analysis': None},
                    {'is_ads': True, 'what_ads': ['A'], 'sponsor_analysis': {'status': 'completed', 'outcome': 'detected', 'retained_previous': 'false'}},
                    {'is_ads': True, 'what_ads': ['A'], 'sponsor_analysis': {'status': 'failed'}},
                    {'is_ads': False, 'what_ads': ['Contradiction']}]:
            self.assertEqual(confirmed_sponsorship_fields(ads), {})


if __name__ == '__main__':
    unittest.main()
