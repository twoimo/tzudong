import unittest

import local_catalog_edit_install as install
import local_catalog_workspace as catalog


class Executor:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []
    def capture(self, sql):
        self.calls.append(sql)
        return catalog.canonical(self.responses.pop(0))
    def _expected_project(self):
        return 'fixture'


class InstallationReadbackTests(unittest.TestCase):
    def test_absent_feature_needs_no_receipt_or_catalog_query(self):
        ex = Executor({'schema': False, 'receipts': False, 'public_api': False})
        self.assertEqual(install.verify_if_installed(ex), {'installed': False})
        self.assertEqual(len(ex.calls), 1)

    def test_partial_installation_is_not_reported_absent(self):
        for key in ('schema','receipts','public_api'):
            with self.subTest(key=key):
                ex = Executor({name: name == key for name in ('schema','receipts','public_api')})
                with self.assertRaisesRegex(catalog.CatalogError, 'catalog_edit_partial_installation'):
                    install.verify_if_installed(ex)

    def test_source_and_project_receipts_are_required(self):
        for receipt in (None, {'sources': {}, 'project':'fixture'}, {'sources':install.SOURCES,'project':'wrong'}):
            ex = Executor({'schema':True,'receipts':True,'public_api':True}, receipt)
            with self.assertRaisesRegex(catalog.CatalogError, 'catalog_edit_receipt_mismatch'):
                install.verify_if_installed(ex)

    def test_catalog_drift_and_missing_functions_fail_readback(self):
        receipt = {'sources':install.SOURCES,'project':'fixture','preview_sha256':'a'*64,'verification_sha256':'b'*64}
        for observed in ({'sha256':'c'*64,'snapshot':{'functions':[{}]*10}},
                         {'sha256':'b'*64,'snapshot':{'functions':[{}]*9}}):
            ex = Executor({'schema':True,'receipts':True,'public_api':True},receipt,observed)
            with self.assertRaisesRegex(catalog.CatalogError, 'catalog_edit_catalog_drift'):
                install.verify_if_installed(ex)

    def test_matching_readback_uses_database_serializer_and_only_reads(self):
        receipt = {'sources':install.SOURCES,'project':'fixture','preview_sha256':'a'*64,'verification_sha256':'b'*64}
        ex = Executor({'schema':True,'receipts':True,'public_api':True},receipt,
                      {'sha256':'b'*64,'snapshot':{'functions':[{}]*10}})
        self.assertTrue(install.verify_if_installed(ex)['installed'])
        self.assertTrue(all(sql.startswith((b'SELECT',b'BEGIN READ ONLY;')) for sql in ex.calls))


if __name__ == '__main__':
    unittest.main()
