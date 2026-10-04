"""Immutable history, explicit aliases and isolated replay admission contracts."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend.supabase.scripts.materialize_migration_workspace import ROOT, RECEIPTS, prepare
from backend.supabase.scripts.transform_storyboard_history_replay import transform


class StoryboardHistoryTests(unittest.TestCase):
    def setUp(self):
        self.manifest=json.loads((ROOT/RECEIPTS/'manifest.json').read_text())
        self.bundle=(ROOT/'backend/supabase/baselines/historical/pre-20260214-application/G026_RECONSTRUCTION_BUNDLE.v4.json').read_bytes()

    def ledger(self):
        return {'migrations':[{'version':Path(item['archivedReceipt']).name[:14],
             'name':Path(item['archivedReceipt']).stem[15:],'statement_count':1,'statements_sha256':item['sha256']}
             for item in self.manifest['receipts']]}

    def test_original_and_applied_sources_remain_immutable(self):
        for item in self.manifest['receipts']:
            self.assertEqual(hashlib.sha256((ROOT/item['archivedReceipt']).read_bytes()).hexdigest(),item['sha256'])
            self.assertEqual(hashlib.sha256((ROOT/item['originalMigration']).read_bytes()).hexdigest(),item['originalSha256'])
            self.assertFalse((ROOT/'backend/supabase/migrations'/Path(item['archivedReceipt']).name).exists())

    def test_fresh_database_gets_original_sql_and_no_unapplied_receipts(self):
        with tempfile.TemporaryDirectory() as temp:
            destination=Path(temp)/'fresh'
            report=prepare(ROOT,{'migrations':[]},destination)
            self.assertEqual(report['aliases'],[])
            for item in self.manifest['receipts']:
                original=Path(item['originalMigration']).name
                self.assertEqual((destination/'supabase/migrations'/original).read_bytes(),(ROOT/item['originalMigration']).read_bytes())
                self.assertFalse((destination/'supabase/migrations'/Path(item['archivedReceipt']).name).exists())

    def test_applied_receipts_produce_explicit_noop_aliases_without_ddl(self):
        with tempfile.TemporaryDirectory() as temp:
            destination=Path(temp)/'applied'
            report=prepare(ROOT,self.ledger(),destination)
            self.assertEqual(len(report['aliases']),2)
            self.assertFalse(report['databaseMutations'])
            for item in self.manifest['receipts']:
                original=destination/'supabase/migrations'/Path(item['originalMigration']).name
                self.assertTrue(all(line.startswith('-- ') for line in original.read_text().splitlines()))
                receipt=destination/'supabase/migrations'/Path(item['archivedReceipt']).name
                self.assertEqual(receipt.read_bytes(),(ROOT/item['archivedReceipt']).read_bytes())

    def test_existing_original_history_never_becomes_a_noop(self):
        ledger=self.ledger()
        ledger['migrations'] += [{'version':Path(item['originalMigration']).name[:14],
            'name':Path(item['originalMigration']).stem[15:]} for item in self.manifest['receipts']]
        with tempfile.TemporaryDirectory() as temp:
            report=prepare(ROOT,ledger,Path(temp)/'both')
            self.assertEqual(report['aliases'],[])

    def test_registry_dependency_precedes_verification_without_source_changes(self):
        registry='20261003065736_g014_current_service_rpc_registry.sql'
        restoration='20261003095444_restore_service_identity_helpers.sql'
        canonical=(ROOT/'backend/supabase/migrations'/registry).read_bytes()
        dependency=(ROOT/'backend/supabase/migrations'/restoration).read_bytes()
        with tempfile.TemporaryDirectory() as temp:
            destination=Path(temp)/'fresh'
            report=prepare(ROOT,{'migrations':[]},destination)
            self.assertEqual((destination/'supabase/migrations'/registry).read_bytes(),dependency+b'\n'+canonical)
            self.assertEqual(len(report['dependencyAdapters']),2)
            self.assertEqual((ROOT/'backend/supabase/migrations'/registry).read_bytes(),canonical)
        with tempfile.TemporaryDirectory() as temp:
            destination=Path(temp)/'already_applied'
            invoker='20261003113923_g014_service_invoker_contract.sql'
            report=prepare(ROOT,{'migrations':[{'version':name[:14], 'name':Path(name).stem[15:]} for name in [registry,invoker]]},destination)
            self.assertEqual(report['dependencyAdapters'],[])
            self.assertEqual((destination/'supabase/migrations'/registry).read_bytes(),canonical)

    def test_storyboard_invoker_prerequisite_is_adapted_before_immutable_contract(self):
        invoker='20261003113923_g014_service_invoker_contract.sql'
        bridge='20261003182338_storyboard_service_role_bridge.sql'
        canonical=(ROOT/'backend/supabase/migrations'/invoker).read_bytes()
        predecessor=(ROOT/'backend/supabase/migrations'/bridge).read_bytes()
        with tempfile.TemporaryDirectory() as temp:
            destination=Path(temp)/'fresh'
            report=prepare(ROOT,{'migrations':[]},destination)
            self.assertEqual((destination/'supabase/migrations'/invoker).read_bytes(),predecessor+b'\n'+canonical)
            adapter=next(item for item in report['dependencyAdapters'] if item['target']==invoker)
            self.assertEqual(adapter['predecessor'],bridge)
            self.assertEqual(adapter['predecessorSha256'],hashlib.sha256(predecessor).hexdigest())
            self.assertEqual((ROOT/'backend/supabase/migrations'/invoker).read_bytes(),canonical)

    def test_unverified_receipts_and_duplicate_history_fail_before_files(self):
        for change in ('hash','name','count','duplicate'):
            ledger=self.ledger()
            if change=='hash':ledger['migrations'][0]['statements_sha256']='0'*64
            if change=='name':ledger['migrations'][0]['name']='different'
            if change=='count':ledger['migrations'][0]['statement_count']=2
            if change=='duplicate':ledger['migrations'].append(copy.deepcopy(ledger['migrations'][0]))
            with self.subTest(change=change),tempfile.TemporaryDirectory() as temp:
                destination=Path(temp)/'rejected'
                with self.assertRaises(ValueError):prepare(ROOT,ledger,destination)
                self.assertFalse(destination.exists())

    def test_owner_replay_has_one_balanced_window_and_unchanged_sql(self):
        paths=[item['originalMigration'] for item in self.manifest['receipts']]
        paths.append('backend/supabase/migrations/20261003000812_storyboard_gemini_only.sql')
        paths.append('backend/supabase/migrations/20261003182338_storyboard_service_role_bridge.sql')
        for path in paths:
            original=(ROOT/path).read_bytes()
            transformed=transform(original,self.bundle)
            self.assertEqual(transformed.count(b'GRANT privacy_workflow_owner TO postgres;'),1)
            self.assertEqual(transformed.count(b'REVOKE privacy_workflow_owner FROM postgres;'),1)
            self.assertNotIn(b'SET LOCAL ROLE',transformed)
            for line in original.splitlines():self.assertIn(line,transformed)
            with self.assertRaisesRegex(ValueError,'source_drift'):transform(original+b'\n',self.bundle)
        with self.assertRaisesRegex(ValueError,'bundle_drift'):transform((ROOT/paths[0]).read_bytes(),self.bundle+b'\n')


if __name__=='__main__':unittest.main()
