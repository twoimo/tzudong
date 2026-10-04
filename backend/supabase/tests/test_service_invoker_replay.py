import unittest
from pathlib import Path
from backend.supabase.scripts.transform_service_invoker_replay import transform

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'backend/supabase/migrations/20261003113923_g014_service_invoker_contract.sql'
MANUAL_SOURCE = ROOT / 'backend/supabase/migrations/20261003172126_restaurant_review_manual_invoker_contract.sql'
WARNING_SOURCE = ROOT / 'backend/supabase/migrations/20261004050600_admin_evaluation_warning_invoker_contract.sql'
BUNDLE = ROOT / 'backend/supabase/baselines/historical/pre-20260214-application/G026_RECONSTRUCTION_BUNDLE.v4.json'


class ServiceInvokerReplayTests(unittest.TestCase):
    def test_immutable_body_and_one_balanced_role_window(self):
        source = SOURCE.read_bytes()
        transformed = transform(source, BUNDLE.read_bytes())
        self.assertEqual(transformed.count(b'SET LOCAL ROLE privacy_workflow_owner;'), 1)
        self.assertEqual(transformed.count(b'RESET ROLE;'), 1)
        self.assertEqual(transformed.count(b'GRANT privacy_workflow_owner TO postgres;'), 1)
        self.assertEqual(transformed.count(b'REVOKE privacy_workflow_owner FROM postgres;'), 1)
        self.assertLess(transformed.index(b'SET LOCAL ROLE'), transformed.index(b'DO $service_invoker_contract$'))
        self.assertGreater(transformed.index(b'RESET ROLE;'), transformed.index(b'$service_invoker_contract$;'))
        for line in source.splitlines():
            self.assertIn(line, transformed)

    def test_changed_source_is_denied(self):
        with self.assertRaisesRegex(ValueError, 'source_drift'):
            transform(SOURCE.read_bytes() + b'\n', BUNDLE.read_bytes())
        with self.assertRaisesRegex(ValueError, 'source_drift'):
            transform(MANUAL_SOURCE.read_bytes() + b'\n', BUNDLE.read_bytes())

    def test_manual_extension_has_one_balanced_owner_window(self):
        source = MANUAL_SOURCE.read_bytes()
        transformed = transform(source, BUNDLE.read_bytes())
        self.assertEqual(transformed.count(b'SET LOCAL ROLE privacy_workflow_owner;'), 1)
        self.assertEqual(transformed.count(b'RESET ROLE;'), 1)
        self.assertLess(transformed.index(b'SET LOCAL ROLE'), transformed.index(b'DO $manual_invoker_contract$'))
        self.assertGreater(transformed.index(b'RESET ROLE;'), transformed.index(b'$manual_invoker_contract$;'))
        for line in source.splitlines():
            self.assertIn(line, transformed)

    def test_warning_extension_preserves_body_and_balanced_owner_window(self):
        source=WARNING_SOURCE.read_bytes()
        transformed=transform(source,BUNDLE.read_bytes())
        self.assertEqual(transformed.count(b'SET LOCAL ROLE privacy_workflow_owner;'),1)
        self.assertEqual(transformed.count(b'RESET ROLE;'),1)
        self.assertLess(transformed.index(b'SET LOCAL ROLE'),transformed.index(b'DO $warning_invoker_contract$'))
        self.assertGreater(transformed.index(b'RESET ROLE;'),transformed.index(b'$warning_invoker_contract$;'))
        for line in source.splitlines():self.assertIn(line,transformed)
        with self.assertRaisesRegex(ValueError,'source_drift'):
            transform(source+b'\n',BUNDLE.read_bytes())

    def test_changed_membership_contract_is_denied(self):
        with self.assertRaisesRegex(ValueError, 'bundle_drift'):
            transform(SOURCE.read_bytes(), BUNDLE.read_bytes() + b'\n')


if __name__ == '__main__':
    unittest.main()
