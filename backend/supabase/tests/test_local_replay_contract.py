"""Offline proof-shape validation; fixture receipts are not database evidence."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from backend.supabase.scripts import local_replay_contract as contract

ROOT = Path(__file__).resolve().parents[3]
PREDECESSOR = 'backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql'


class LocalReplayContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = {}
        cls.receipts = {}
        with tempfile.TemporaryDirectory() as directory:
            for path in contract.supported_sources():
                plan = contract.plan(path)
                verifier = next(p for p in plan['bindings'] if '/verify_' in p)
                output = Path(directory) / Path(path).name
                args = ['python3', str(ROOT / verifier), '--source', str(ROOT / path), '--output', str(output)]
                if PREDECESSOR in plan['bindings']:
                    args += ['--predecessor', str(ROOT / PREDECESSOR)]
                subprocess.run(args, check=True, capture_output=True, timeout=30)
                cls.sql[path] = output.read_bytes()
                receipt = {'source_sha256': plan['source_sha256'], 'read_only': True}
                if 'admin_user_ids' in path:
                    receipt.update(schema='admin-ids-source-replay-overlap-v1', disposition='already-present-contract-verified',
                                   body_sha256='be57e320d7a79e6e7382bce9e942b3e684fc50246beb44deaa67c408cb553acd')
                elif 'admin_management_group' in path:
                    receipt.update(schema='admin-management-group-source-overlap-v1', already_present_contract_verified=True)
                else:
                    receipt.update(schema='g014-owner-pg15-replay-v1', disposition='legacy-contract-preserved')
                if PREDECESSOR in plan['bindings']:
                    receipt['predecessor_sha256'] = plan['bindings'][PREDECESSOR]
                cls.receipts[path] = receipt

    def proof(self, path):
        return contract.assemble_proof(path, self.sql[path], json.dumps(self.receipts[path]).encode())

    def test_generated_sql_and_exact_fixture_receipts_match_all_pins(self):
        self.assertEqual(len(contract.supported_sources()), 3)
        for path in contract.supported_sources():
            proof = self.proof(path)
            self.assertNotEqual(proof['disposition'], 'applied')
            contract.validate_proof(proof, self.sql[path])

    def test_unknown_source_cannot_gain_a_replay_disposition(self):
        for path in (PREDECESSOR, '../migrations.sql', '/tmp/migration.sql'):
            with self.assertRaisesRegex(contract.ReplayContractError, 'source_unsupported'):
                contract.plan(path)

    def test_every_source_and_verifier_dependency_is_bound(self):
        for path in contract.supported_sources():
            plan = contract.plan(path)
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in plan['bindings']:
                    target = root / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / name, target)
                contract.plan(path, root=root)
                for name in plan['bindings']:
                    with self.subTest(path=path, dependency=name):
                        target = root / name
                        original = target.read_bytes()
                        target.write_bytes(original + b'\n')
                        with self.assertRaisesRegex(contract.ReplayContractError, 'source_drift'):
                            contract.plan(path, root=root)
                        target.write_bytes(original)

    def test_symlinked_sources_are_rejected_even_with_matching_bytes(self):
        path = contract.supported_sources()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'backend').symlink_to(ROOT / 'backend', target_is_directory=True)
            with self.assertRaisesRegex(contract.ReplayContractError, 'source_custody'):
                contract.plan(path, root=root)

    def test_sql_changes_and_raw_migration_bytes_are_rejected(self):
        for path in contract.supported_sources():
            for sql in (self.sql[path] + b'\n', (ROOT / path).read_bytes()):
                with self.assertRaisesRegex(contract.ReplayContractError, 'sql_drift'):
                    contract.assemble_proof(path, sql, json.dumps(self.receipts[path]).encode())

    def test_receipt_requires_exact_boolean_read_only_and_fields(self):
        for path in contract.supported_sources():
            for wrong in (False, 1, 'true', None):
                receipt = {**self.receipts[path], 'read_only': wrong}
                with self.assertRaisesRegex(contract.ReplayContractError, 'receipt_mismatch'):
                    contract.assemble_proof(path, self.sql[path], json.dumps(receipt).encode())
            receipt = {**self.receipts[path], 'applied': True}
            with self.assertRaisesRegex(contract.ReplayContractError, 'receipt_mismatch'):
                contract.assemble_proof(path, self.sql[path], json.dumps(receipt).encode())

    def test_duplicate_and_oversized_receipts_are_rejected(self):
        path = contract.supported_sources()[0]
        for raw in (b'{"read_only":false,"read_only":true}', b' ' * 16385, b'not JSON'):
            with self.assertRaises(contract.ReplayContractError):
                contract.assemble_proof(path, self.sql[path], raw)

    def test_oversized_integer_has_a_bounded_parser_failure(self):
        path = contract.supported_sources()[0]
        raw = b'{"x":' + b'9' * 5000 + b'}'
        with self.assertRaisesRegex(contract.ReplayContractError, 'replay_receipt_invalid'):
            contract.assemble_proof(path, self.sql[path], raw)

    def test_changed_proof_cannot_become_applied_or_hide_binding_drift(self):
        path = contract.supported_sources()[-1]
        for field, value in [('disposition', 'applied'), ('schema', 'local-receipt-v1'),
                             ('receipt_sha256', '0' * 64), ('bindings_sha256', '0' * 64), ('bindings', {})]:
            proof = copy.deepcopy(self.proof(path))
            proof[field] = value
            with self.assertRaisesRegex(contract.ReplayContractError, 'proof_mismatch'):
                contract.validate_proof(proof, self.sql[path])

    def test_proofs_for_different_migrations_cannot_be_swapped(self):
        paths = contract.supported_sources()
        proof = self.proof(paths[0])
        proof['migration_path'] = paths[1]
        with self.assertRaises(contract.ReplayContractError):
            contract.validate_proof(proof, self.sql[paths[1]])

    def test_executor_uses_only_pinned_read_only_sql_and_preserves_ledger(self):
        from backend.supabase.tests.test_local_migration_contract import local_migrate
        for path in contract.supported_sources():
            calls = []
            receipt = json.dumps(self.receipts[path]).encode()
            class Executor:
                def capture(self, sql, *, role="supabase_admin"):
                    calls.append((sql, role))
                    return receipt
                def run(self, sql):
                    raise AssertionError('Replay diagnosis must never write a ledger')
            proof = local_migrate.verify_replay(Executor(), path)
            expected_role = "postgres" if path.endswith("20260906064252_g014_pg17_workflow_owner_contract.sql") else "supabase_admin"
            self.assertEqual(calls, [(self.sql[path], expected_role)])
            contract.validate_proof(proof, self.sql[path])

    def test_executor_rejects_invalid_result_and_unknown_source(self):
        from backend.supabase.tests.test_local_migration_contract import local_migrate
        calls = []
        class Executor:
            def capture(self, sql):
                calls.append(sql)
                return b'{"applied":true}'
            def run(self, sql):
                raise AssertionError('Unexpected write')
        with self.assertRaisesRegex(local_migrate.LocalMigrationError, 'replay_receipt_mismatch'):
            local_migrate.verify_replay(Executor(), contract.supported_sources()[0])
        calls.clear()
        with self.assertRaisesRegex(local_migrate.LocalMigrationError, 'replay_source_unsupported'):
            local_migrate.verify_replay(Executor(), '../unknown.sql')
        self.assertEqual(calls, [])

    def test_cli_requires_explicit_local_admission(self):
        result = subprocess.run(['python3', str(ROOT / 'backend/supabase/scripts/local-migrate.py'),
                                 'verify-replay', '--migration', contract.supported_sources()[0],
                                 '--container', 'unadmitted-fixture'], capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'replay_requires_allow_local', result.stderr)

    def test_replay_batches_never_submit_raw_hosted_repair_sql(self):
        from backend.supabase.tests.test_local_migration_contract import local_migrate
        manifest = local_migrate.build_manifest()
        for item in manifest['source']['files']:
            if item['path'] not in contract.supported_sources():
                continue
            path, sql = local_migrate._execution_batch(item, item['ordinal'] - 1)
            self.assertEqual(sql, self.sql[path])
            self.assertNotIn((ROOT / path).read_bytes(), sql)
            self.assertNotIn(b'INSERT INTO _tzudong_local', sql)
            self.assertNotIn(b'GRANT privacy_workflow_owner', sql)

    def test_full_snapshot_requires_all_96_exact_sources_and_distinct_terminal_states(self):
        from backend.supabase.tests.test_local_migration_contract import local_migrate
        rows = [local_migrate._expected_snapshot_row(item) for item in local_migrate.build_manifest()['source']['files']]
        self.assertEqual(len(rows), 96)
        self.assertEqual(sum(row['status'] == 'applied' for row in rows), 93)
        self.assertEqual(sum(row['status'] == 'verified-existing' for row in rows), 2)
        self.assertEqual(sum(row['status'] == 'legacy-contract-preserved' for row in rows), 1)
        local_migrate._validate_ledger_snapshot(rows)
        for mutation in ('applied', 'missing-proof', 'missing-row', 'foreign-proof'):
            changed = copy.deepcopy(rows)
            if mutation == 'applied':
                changed[-1]['status'] = 'applied'
            elif mutation == 'missing-proof':
                changed[-1]['replayProof'] = None
            elif mutation == 'missing-row':
                changed.pop()
            else:
                changed[-1]['replayProof'] = changed[-2]['replayProof']
            with self.subTest(mutation=mutation), self.assertRaises(local_migrate.LocalMigrationError):
                local_migrate._validate_ledger_snapshot(changed)
