"""Offline canonical reference-to-classification contract tests."""
from __future__ import annotations
import sys
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import g040_prefix_recovery as g
import g040_reference_evidence as evidence
H = "a" * 64
SEED_PROJECTION_SHA256 = "0d38938f2e5c9ff0b0f3351fd1356fd3a9bc0d6aadf586d672020025cda807f8"

class Cursor:
    def __init__(self, *rows): self.rows = list(rows); self.sql = []
    def execute(self, sql): self.sql.append(sql)
    def fetchone(self): return self.rows.pop(0)

def reference(**changes):
    value = evidence.VerifiedReference(
        schema=g.RECEIPT_SCHEMA, base_commit=g.SOURCE_COMMIT, final_commit="b" * 40,
        runtime_source_root="c" * 64, manifest_sha256=g.MANIFEST_SHA256,
        migration_source_sha256=g.MIGRATION_SOURCE_SHA256, pg_identity=g.PG_IDENTITY,
        probe_text_sha256=g.PROBE_TEXT_SHA256, derivation_mode=evidence.DERIVATION_MODE,
        reverse_vector_sha256=evidence.REVERSE_VECTOR_SHA256, absent_catalog_sha256=H,
        full_catalog_sha256="d" * 64, full_data_sha256="e" * 64,
        ledger_prefix_sha256=H, source_plan_sha256="f" * 64, terminal_rows=40,
        terminal_ledger_root=H, terminal_catalog_root="d" * 64,
        terminal_acl_root="f" * 64, terminal_data_root="e" * 64,
        terminal_spec_root="0" * 64,
        terminal_tuple_sha256="036eada3f028220aa33449d266ce74179a164f5098751c678a1904655d3912c6",
        target_fingerprint="f" * 64,
        observation_nonce="n" * 16, issued_at_unix=1, expires_at_unix=2,
        first_clone_identity="1" * 64, first_clone_nonce="first-clone-nonce",
        first_live_identity_sha256="2" * 64, first_container_id_sha256="3" * 64,
        first_image_id_sha256="4" * 64, first_image_digest_sha256="5" * 64,
        first_endpoint_sha256="6" * 64, first_g035_restore_receipt_sha256="7" * 64,
        first_capture_receipt_sha256="8" * 64, first_restored_archive_sha256="9" * 64,
        first_capture_receipt_bytes_sha256="0" * 64, first_restore_receipt_bytes_sha256="1" * 64,
        first_lineage_attestation_sha256="2" * 64, first_lineage_signature_sha256="3" * 64,
        first_binding_receipt_sha256="6666666666666666666666666666666666666666666666666666666666666666",
        first_observation_receipt_sha256="7777777777777777777777777777777777777777777777777777777777777777",
        second_clone_identity="a" * 64, second_clone_nonce="second-clone-nonce",
        second_live_identity_sha256="b" * 64, second_container_id_sha256="c" * 64,
        second_image_id_sha256="4" * 64, second_image_digest_sha256="5" * 64,
        second_endpoint_sha256="d" * 64, second_g035_restore_receipt_sha256="e" * 64,
        second_capture_receipt_sha256="8" * 64, second_restored_archive_sha256="9" * 64,
        second_capture_receipt_bytes_sha256="2" * 64, second_restore_receipt_bytes_sha256="3" * 64,
        second_lineage_attestation_sha256="4" * 64, second_lineage_signature_sha256="5" * 64,
        second_binding_receipt_sha256="8888888888888888888888888888888888888888888888888888888888888888",
        second_observation_receipt_sha256="9999999999999999999999999999999999999999999999999999999999999999",
        reference_public_key_sha256=evidence.PUBLIC_KEY_SHA256,
        receipt_sha256="3" * 64,
    )
    return evidence.VerifiedReference(**{**value.__dict__, **changes})

def catalog(**changes):
    row = {"ledger_count":28,"v00400_count":0,"ledger_prefix_shape_ok":True,"ledger_sha256":H,"schema_exists":False,"expected_table_count":0,"schema_table_count":0,"schema_index_count":0,"column_count":0,"schema_other_relation_count":0,"touched_function_count":0,"schema_trigger_count":0,"rls_table_count":0,"policy_count":0,"acl_contract_ok":True,"exact_pg":True,"server_version_num":170006,"catalog_sha256":H}
    row.update(changes); return row
def full_catalog(**changes):
    return catalog(
        schema_exists=True,
        expected_table_count=7,
        schema_table_count=7,
        schema_index_count=14,
        column_count=102,
        touched_function_count=14,
        schema_trigger_count=7,
        rls_table_count=7,
        catalog_sha256="d" * 64,
        **changes,
    )

def data(**changes):
    row = {"classes_count":10,"exact_seed_count":10,"seed_rows_exact":True,"class_source_count":0,"legal_hold_count":0,"work_item_count":0,"retained_record_count":0,"run_count":0,"run_item_count":0,"runtime_tables_empty":True,"seed_projection_sha256":SEED_PROJECTION_SHA256,"data_shape_sha256":"e" * 64}
    row.update(changes); return row

class Tests(unittest.TestCase):
    def test_ledger_probe_uses_explicit_row_delimiter(self):
        self.assertIn(
            "string_agg(version||chr(30)||name||chr(30)||coalesce(array_to_string(statements,chr(31),'∅'),''),chr(29) ORDER BY version,name)",
            g.CATALOG_PROBE,
        )
        self.assertIn(
            "string_agg(code||chr(30)||status",
            g.DATA_PROBE,
        )
        self.assertIn(",chr(29) ORDER BY code)", g.DATA_PROBE)
        for internal_char in (
            "c.relkind::text",
            "a.attidentity::text",
            "a.attgenerated::text",
            "x.contype::text",
            "p.provolatile::text",
            "p.proparallel::text",
            "t.tgenabled::text",
            "d.defaclobjtype::text",
        ):
            self.assertIn(internal_char, g.CATALOG_PROBE)
        self.assertIn(
            "coalesce(has_schema_privilege('anon',to_regnamespace('privacy_retention'),'USAGE'),false)",
            g.CATALOG_PROBE,
        )
    def test_catalog_probe_canonicalizes_effective_acl_role_identities(self):
        probe = g.CATALOG_PROBE
        acl_render = (
            "pg_get_userbyid(acl.grantor)||chr(30)||CASE WHEN acl.grantee=0 THEN 'PUBLIC' "
            "ELSE pg_get_userbyid(acl.grantee) END||chr(30)||acl.privilege_type||chr(30)||"
            "acl.is_grantable::text"
        )
        acl_order = (
            "ORDER BY pg_get_userbyid(acl.grantor),CASE WHEN acl.grantee=0 THEN 'PUBLIC' "
            "ELSE pg_get_userbyid(acl.grantee) END,acl.privilege_type,acl.is_grantable"
        )
        for raw_acl, object_kind, owner in (
            ("n.nspacl", "n", "n.nspowner"),
            ("c.relacl", "r", "c.relowner"),
            ("p.proacl", "f", "p.proowner"),
        ):
            self.assertIn(
                f"aclexplode(coalesce({raw_acl},acldefault('{object_kind}',{owner}))) AS acl",
                probe,
            )
            self.assertNotIn(f"{raw_acl}::text", probe)
        self.assertEqual(probe.count(acl_render), 3)
        self.assertEqual(probe.count(acl_order), 3)
        self.assertNotIn("acl.grantor::text", probe)
        self.assertNotIn("acl.grantee::text", probe)
        self.assertNotIn("ORDER BY acl.grantor,acl.grantee", probe)
        self.assertNotIn("WHERE acl.grantee", probe)
        self.assertNotIn("WHERE acl.grantor", probe)
        self.assertIn("coalesce(d.defaclacl::text,'')", probe)
    def test_source_probe_uses_only_explicit_noncolliding_acl_and_row_delimiters(self):
        probe = g.CATALOG_PROBE
        self.assertIn("chr(29) ORDER BY", probe)
        self.assertIn("chr(30)", probe)
        self.assertIn("chr(31)", probe)
        self.assertNotIn("array_to_string(statements,',')", probe)
        self.assertIn("has_schema_privilege('anon',to_regnamespace('privacy_retention'),'USAGE')", probe)
        self.assertIn("aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))", probe)
        self.assertIn("aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))", probe)
        self.assertIn("aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))", probe)

    def test_fail_closed_denials_use_exact_denial_type_and_bounded_codes(self):
        for row, expected in (
            (catalog(exact_pg=False), "postgres_version"),
            (catalog(schema_exists=True), "partial_or_ambiguous"),
        ):
            with self.subTest(expected=expected):
                with self.assertRaises(g.Denial) as raised:
                    g.classify_locked_cursor(Cursor({"transaction_read_only": "on"}, row), reference(), consume_nonce=lambda _: True)
                self.assertEqual(type(raised.exception), g.Denial)
                self.assertEqual(raised.exception.code, expected)
                self.assertEqual(str(raised.exception), expected)
    def test_unapplied_real_artifact_and_nonce_replay(self):
        consumed = set()
        consume = lambda nonce: nonce not in consumed and not consumed.add(nonce)
        observation = g.classify_locked_cursor(Cursor({"transaction_read_only":"on"}, catalog()), reference(), consume_nonce=consume)
        self.assertEqual(observation.status, "UNAPPLIED")
        with self.assertRaises(g.Denial) as denial:
            g.classify_locked_cursor(Cursor(), reference(), consume_nonce=consume)
        self.assertEqual(denial.exception.code, "nonce_stale")
    def test_tuple_probe_rows_are_rejected_but_exact_dict_rows_are_accepted(self):
        with self.assertRaisesRegex(g.Denial, "probe_shape"):
            g._row(Cursor(("on",)), "SELECT 1")
        self.assertEqual(g._row(Cursor({"transaction_read_only": "on"}), "SELECT 1"), {"transaction_read_only": "on"})
    def test_unapplied_denies_wrong_postgres_version(self):
        for changes in ({"exact_pg": False, "server_version_num": 170006}, {"exact_pg": True, "server_version_num": 170005}):
            with self.subTest(changes=changes), self.assertRaisesRegex(g.Denial, "postgres_version"):
                g.classify_locked_cursor(Cursor({"transaction_read_only": "on"}, catalog(**changes)), reference(), consume_nonce=lambda _: True)

    def test_mutation_requires_exact_prior_and_read_write(self):
        ref = reference()
        prior = g.classify_locked_cursor(Cursor({"transaction_read_only":"on"}, catalog()), ref, consume_nonce=lambda _: True)
        self.assertEqual(g.classify_mutation_cursor(Cursor({"transaction_read_only":"off"}, catalog()), ref, expected_prior=prior), prior)
        with self.assertRaises(g.Denial):
            g.classify_mutation_cursor(Cursor({"transaction_read_only":"off"}, catalog(catalog_sha256="0" * 64)), ref, expected_prior=prior)
        with self.assertRaises(g.Denial):
            g.classify_mutation_cursor(Cursor({"transaction_read_only":"on"}, catalog()), ref, expected_prior=prior)

    def test_full_partial_and_sanitized_failures(self):
        full = catalog(schema_exists=True, expected_table_count=7, schema_table_count=7, schema_index_count=14, column_count=102, touched_function_count=14, schema_trigger_count=7, rls_table_count=7, catalog_sha256="d" * 64)
        result = g.classify_locked_cursor(Cursor({"transaction_read_only":"on"}, full, data()), reference(), consume_nonce=lambda _: True)
        self.assertEqual(result.status, "FULL_ESCAPED")
        with self.assertRaises(g.Denial) as denial:
            g.classify_locked_cursor(Cursor({"transaction_read_only":"on"}, catalog(schema_exists=True)), reference(), consume_nonce=lambda _: True)
        self.assertEqual(denial.exception.code, "partial_or_ambiguous")
        self.assertNotIn("postgres", str(denial.exception).lower())
    def test_full_data_probe_rejects_each_ambiguous_or_mismatched_field(self):
        cases = (
            ("classes_count", {"classes_count": 9}, "partial_or_ambiguous"),
            ("exact_seed_count", {"exact_seed_count": 9}, "partial_or_ambiguous"),
            ("seed_rows_exact", {"seed_rows_exact": False}, "partial_or_ambiguous"),
            ("runtime_tables_empty", {"runtime_tables_empty": False}, "partial_or_ambiguous"),
            ("class_source_count", {"class_source_count": 1}, "partial_or_ambiguous"),
            ("legal_hold_count", {"legal_hold_count": 1}, "partial_or_ambiguous"),
            ("work_item_count", {"work_item_count": 1}, "partial_or_ambiguous"),
            ("retained_record_count", {"retained_record_count": 1}, "partial_or_ambiguous"),
            ("run_count", {"run_count": 1}, "partial_or_ambiguous"),
            ("run_item_count", {"run_item_count": 1}, "partial_or_ambiguous"),
            ("data_shape_sha256", {"data_shape_sha256": "0" * 64}, "partial_or_ambiguous"),
            ("seed_projection_sha256", {"seed_projection_sha256": "0" * 64}, "partial_or_ambiguous"),
            ("seed_projection_syntax", {"seed_projection_sha256": "z" * 64}, "data_shape"),
        )
        for field, changes, expected in cases:
            with self.subTest(field=field):
                cursor = Cursor({"transaction_read_only": "on"}, full_catalog(), data(**changes))
                with self.assertRaises(g.Denial) as raised:
                    g.classify_locked_cursor(cursor, reference(), consume_nonce=lambda _: True)
                self.assertEqual(type(raised.exception), g.Denial)
                self.assertEqual(raised.exception.code, expected)
                self.assertEqual(str(raised.exception), expected)
                self.assertEqual(
                    cursor.sql,
                    [
                        "SELECT current_setting('transaction_read_only', true) AS transaction_read_only",
                        g.CATALOG_PROBE,
                        g.DATA_PROBE,
                    ],
                )

    def test_classification_uses_the_supplied_deadline_statement_adapter(self):
        executed = []

        def statement_executor(sql):
            executed.append(sql)
            if len(executed) == 2:
                raise g.Denial("deadline")

        with self.assertRaisesRegex(g.Denial, "deadline"):
            g.classify_locked_cursor(
                Cursor({"transaction_read_only": "on"}, catalog()),
                reference(),
                consume_nonce=lambda _: True,
                statement_executor=statement_executor,
            )
        self.assertEqual(executed, [
            "SELECT current_setting('transaction_read_only', true) AS transaction_read_only",
            g.CATALOG_PROBE,
        ])
    def test_exact_immutable_types(self):
        class Derived(evidence.VerifiedReference): pass
        with self.assertRaises(g.Denial): g.classify_locked_cursor(Cursor(), Derived(**reference().__dict__), consume_nonce=lambda _: True)
        observation = g.PrefixObservation("UNAPPLIED", "f" * 64, "b" * 40, "c" * 64, "3" * 64, evidence.DERIVATION_MODE, evidence.REVERSE_VECTOR_SHA256, "n" * 16, H, H, None, "4" * 64)
        with self.assertRaises(FrozenInstanceError): observation.status = "FULL_ESCAPED"

if __name__ == "__main__": unittest.main()
