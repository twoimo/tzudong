import hashlib
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / 'backend/supabase/scripts'
sys.path.insert(0, str(SCRIPTS))

import admin_management_group_plan as accepted  # noqa: E402
import verify_admin_user_management_rpc_forward_replay as replay  # noqa: E402


FORWARD = ROOT / 'backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql'
ACCEPTED = ROOT / 'backend/supabase/migrations/20260906053936_admin_management_group_catalog_slice.sql'
GENERATOR = ROOT / 'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh'


class AdminUserManagementRpcForwardReplayTest(unittest.TestCase):
    def test_exact_forward_reuses_the_accepted_dependency_and_target_contract(self) -> None:
        source = FORWARD.read_bytes()
        accepted_source = ACCEPTED.read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), replay.SOURCE_SHA)
        self.assertEqual(hashlib.sha256(accepted_source).hexdigest(), accepted.SOURCE_SHA)
        forward_text = source.decode('utf-8')
        for kind in ('DEPENDENCY', 'TARGET'):
            self.assertEqual(replay.section(forward_text, kind), accepted.section(kind))

    def test_pg15_verifier_is_read_only_and_keeps_operating_requirements_explicit(self) -> None:
        sql = replay.verification_sql(FORWARD.read_bytes(), ACCEPTED.read_bytes())
        text = sql.decode('utf-8')
        self.assertEqual(hashlib.sha256(sql).hexdigest(),
                         'd40a19e1a3564a6a22b92d857e6aece7968a097311cf37a8a7782d917266dbb7')
        self.assertTrue(text.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'))
        self.assertTrue(text.endswith('ROLLBACK;\n'))
        self.assertIn("current_setting('server_version_num')::int/10000<>15", text)
        self.assertIn("'operating_sql_executed',false", text)
        self.assertIn("'required_operating_server_version_num',170006", text)
        self.assertIn("'required_operating_ledger_count',85", text)
        for mutation in ('CREATE FUNCTION', 'GRANT privacy_workflow_owner', 'GRANTED BY',
                         'inherit_option', 'set_option', 'INSERT INTO', 'UPDATE public.', 'DELETE FROM'):
            self.assertNotIn(mutation, text)

    def test_source_or_accepted_predecessor_drift_is_denied(self) -> None:
        source = FORWARD.read_bytes()
        accepted_source = ACCEPTED.read_bytes()
        with self.assertRaisesRegex(ValueError, 'admin_user_rpc_forward_replay_source_binding_denied'):
            replay.verification_sql(source + b'\n', accepted_source)
        with self.assertRaisesRegex(ValueError, 'admin_user_rpc_forward_replay_source_binding_denied'):
            replay.verification_sql(source, accepted_source + b'\n')

    def test_cli_writes_the_exact_verifier_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'verification.sql'
            prior = sys.argv
            try:
                sys.argv = [
                    'verify_admin_user_management_rpc_forward_replay.py',
                    '--source', str(FORWARD),
                    '--predecessor', str(ACCEPTED),
                    '--output', str(output),
                ]
                replay.main()
            finally:
                sys.argv = prior
            self.assertEqual(output.read_bytes(),
                             replay.verification_sql(FORWARD.read_bytes(), ACCEPTED.read_bytes()))
            with self.assertRaises(FileExistsError):
                prior = sys.argv
                try:
                    sys.argv = [
                        'verify_admin_user_management_rpc_forward_replay.py',
                        '--source', str(FORWARD),
                        '--predecessor', str(ACCEPTED),
                        '--output', str(output),
                    ]
                    replay.main()
                finally:
                    sys.argv = prior

    def test_generate_job_uses_the_supported_read_only_replay_contract(self) -> None:
        generator = GENERATOR.read_text(encoding='utf-8')
        case = generator.split(
            '    20261009101645_admin_user_management_rpc_forward.sql)', 1
        )[1].split('      ;;', 1)[0]
        self.assertIn('verify_admin_user_management_rpc_forward_replay.py', case)
        self.assertIn('--predecessor "$backend_migrations_dir/20260906053936_admin_management_group_catalog_slice.sql"', case)
        self.assertIn('.operating_sql_executed == false', case)
        self.assertIn('.required_operating_server_version_num == 170006', case)
        self.assertIn('.required_operating_ledger_count == 85', case)
        self.assertNotIn('<"$migration"', case)

        artifact_manifest = generator.rsplit(
            '  cd -- "$staging_dir"\n', 1
        )[1].split('    LC_ALL=C sort >artifact-manifest.txt', 1)[0]
        for artifact in (
            'admin-user-rpc-forward-overlap-verification.sql',
            'admin-user-rpc-forward-overlap-receipt.json',
        ):
            self.assertEqual(artifact_manifest.count(artifact), 1)


if __name__ == '__main__':
    unittest.main()
