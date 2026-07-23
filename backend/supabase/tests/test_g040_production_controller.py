from __future__ import annotations

import hashlib
import io
import os
import sys
import tempfile
import unittest
from argparse import Namespace
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g040_production_controller as controller
from g040_reference_evidence import DERIVATION_MODE, REVERSE_VECTOR_SHA256
from g037_hosted_closure_contract import Manifest

H = "a" * 64


class Cursor:
    def __init__(self, row={"system_identifier": "system", "database_oid": "42", "server_version_num": "170006"}, rows=None):
        self.row, self.rows, self.calls, self.closed = row, list(rows or []), [], False
        self.description = ()
    def execute(self, sql): self.calls.append(sql)
    def fetchone(self): return self.row
    def fetchall(self): return self.rows
    def close(self): self.closed = True


class Connection:
    def __init__(self, cursor): self.cursor_value, self.rolled_back, self.closed = cursor, False, False
    def cursor(self): return self.cursor_value
    def rollback(self): self.rolled_back = True
    def close(self): self.closed = True


def observation(status="UNAPPLIED", data=None):
    values = dict(status=status, target_fingerprint=H, final_commit="b" * 40,
        runtime_source_root="c" * 64, reference_receipt_sha256="d" * 64,
        derivation_mode=DERIVATION_MODE, reverse_vector_sha256=REVERSE_VECTOR_SHA256,
        observation_nonce="nonce_0123456789", ledger_prefix_sha256="e" * 64,
        catalog_sha256="f" * 64, data_sha256=data, classification_sha256="0" * 64)
    values["classification_sha256"] = controller._hash({k: v for k, v in values.items() if k != "classification_sha256"})
    return controller.prefix.PrefixObservation(**values)


class G040ProductionControllerTests(unittest.TestCase):
    def test_public_surface_has_only_fixed_file_contract_modes(self):
        self.assertEqual(controller.MODES, frozenset(("validate-source", "validate", "diagnose", "prepare", "execute", "readback", "production-backup")))
        stream = io.StringIO()
        with redirect_stderr(stream), self.assertRaises(SystemExit): controller.main(["rehearse"])
        self.assertNotIn("postgres://", stream.getvalue())
    def test_execution_denials_expose_only_bounded_source_identity(self):
        statement = "LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE"
        denial = controller.ExecutionDenial(version="secret-version", ordinal=2, statement=statement)
        expected = f"execution_statement_2_{hashlib.sha256(statement.encode()).hexdigest()}"
        self.assertEqual(controller._bounded_execution_denial(denial), expected)
        self.assertNotIn("secret-version", expected)
        self.assertEqual(
            controller._bounded_execution_denial(controller.prefix.Denial("branch_mismatch")),
            "executor_branch_mismatch",
        )
        self.assertEqual(
            controller._bounded_execution_denial(controller.prefix.Denial("provider_secret")),
            "execute_failed",
        )
        self.assertEqual(
            controller._bounded_execution_denial(type("HostileDenial", (controller.prefix.Denial,), {})("leak")),
            "execute_failed",
        )
    def test_validate_source_isolated_to_source_contract_and_receipt(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        args = Namespace(repository_root="/checkout", source_commit=source.final_commit, source_receipt="/source-receipt")
        plan = object()
        body = {"validation_sha256": H}
        with patch.object(controller, "_source", return_value=source) as load_source, \
                patch.object(controller, "validate_sources", return_value=object()) as validate_sources, \
                patch.object(controller, "build_source_validation_plan", return_value=plan) as build, \
                patch.object(controller, "_source_validation_body", return_value=body), \
                patch.object(controller, "_outside", return_value=Path("/source-receipt")) as outside, \
                patch.object(controller, "_write_signed", return_value="d" * 64) as write:
            result = controller.validate_source(args)
        self.assertEqual(dict(result), {"schema": controller.SCHEMA, "mode": "validate-source", "status": "source-valid",
                                        "source_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
                                        "source_validation_sha256": H, "source_receipt_sha256": "d" * 64})
        load_source.assert_called_once_with(args)
        validate_sources.assert_called_once_with(Path("/checkout").resolve())
        build.assert_called_once_with(Path("/checkout").resolve(), validate_sources.return_value, source=source)
        outside.assert_called_once_with("/source-receipt", Path("/checkout").resolve(), fresh=True)
        self.assertEqual(write.call_args.args, (Path("/source-receipt"), {"schema": controller.SCHEMA, "kind": "source-validation-v1", "body": body}))

    def test_validate_source_parser_rejects_reference_and_target_options_without_dispatch(self):
        base = ["validate-source", "--repository-root", "/checkout", "--source-commit", "a" * 40, "--source-receipt", "/receipt"]
        for option in ("--reference", "--target-fingerprint", "--authorization", "--database-url"):
            secret = "source-mode-secret"
            stream = io.StringIO()
            with self.subTest(option=option), redirect_stderr(stream), self.assertRaises(SystemExit):
                controller.main([*base, option, secret])
            self.assertNotIn(secret, stream.getvalue())

    def test_proof_receipt_is_fresh_and_contains_only_bound_terminal_evidence(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"receipt_sha256": "d" * 64})()
        authorization = type("Authorization", (), {"target_fingerprint": H, "authorization_sha256": "e" * 64})()
        migration = lambda version, name, sha256: type("Migration", (), {"version": version, "name": name, "sha256": sha256})()
        manifest = type("Manifest", (), {"migrations": (
            migration("20260713002300", "g014_account_deletion_state_machine", "1" * 64),
            migration("20260712000400", "g010_retention_separation", "2" * 64),
            migration("20260713002400", "g014_retention_adapters_receipts", "3" * 64),
        )})()
        readback = {"readback_sha256": "4" * 64, "terminal_rows": 40, "catalog_root": "5" * 64,
                    "acl_root": "6" * 64, "ledger_root": "7" * 64, "data_root": "8" * 64, "terminal_spec_root": "9" * 64}
        args = Namespace(repository_root="/checkout", proof_receipt="/proof")
        with patch.object(controller, "_outside", return_value=Path("/proof")) as outside, \
                patch.object(controller, "_write_signed", return_value="f" * 64) as write, \
                patch.object(controller.time, "time", return_value=100):
            receipt = controller._write_proof(args, source, reference, manifest, authorization, readback)
        self.assertEqual(receipt, "f" * 64)
        outside.assert_called_once_with("/proof", Path("/checkout").resolve(), fresh=True)
        signed = write.call_args.args[1]
        self.assertEqual(write.call_args.args[0], Path("/proof"))
        self.assertEqual(set(signed), {"schema", "kind", "body"})
        self.assertEqual(signed["kind"], "account-deletion-privacy-retention-proof-v1")
        body = signed["body"]
        self.assertEqual(set(body), {"schema", "issued_at", "target_fingerprint", "final_recovery_commit",
                                     "runtime_source_root", "reference_receipt_sha256", "authorization_sha256",
                                     "terminal_readback_sha256", "terminal_rows", "terminal_catalog_root",
                                     "terminal_acl_root", "terminal_ledger_root", "terminal_data_root",
                                     "terminal_spec_root", "privacy_retention", "account_deletion", "proof_sha256"})
        self.assertEqual(body["proof_sha256"], controller._hash({key: value for key, value in body.items() if key != "proof_sha256"}))
        self.assertEqual(body["terminal_readback_sha256"], readback["readback_sha256"])
        self.assertEqual(body["privacy_retention"]["data_root"], readback["data_root"])
        self.assertEqual(body["account_deletion"]["migration"]["source_sha256"], "1" * 64)
    def test_public_cli_rejects_injection_before_dispatch_without_echoing_values(self):
        base = [
            "validate", "--repository-root", "/checkout", "--source-commit", "a" * 40,
            "--target-fingerprint", "b" * 64, "--reference", "/reference",
        ]
        for option in ("--connection-factory", "--terminal-probe", "--database-url", "--dsn"):
            secret = "injected-secret-value"
            stream = io.StringIO()
            with self.subTest(option=option), redirect_stderr(stream), \
                    patch.object(controller, "validate") as dispatch, self.assertRaises(SystemExit):
                controller.main([*base, option, secret])
            dispatch.assert_not_called()
            self.assertNotIn(secret, stream.getvalue())

    def test_diagnose_uses_signed_observation_and_exact_snapshot_flow(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"target_fingerprint": H})()
        cursor, conn, observed = Cursor(), None, observation()
        conn = Connection(cursor)
        args = Namespace(repository_root="/checkout", nonce_dir="/nonce", observation_receipt="/receipt")
        with patch.object(controller, "_connect_service", return_value=conn) as connect, \
             patch.object(controller, "_begin_controller_transaction") as transaction, \
             patch.object(controller.prefix, "begin_read_only_snapshot") as snapshot, \
             patch.object(controller, "_require_live_target") as target, \
             patch.object(controller, "_nonce_store", return_value=object()) as nonces, \
             patch.object(controller.prefix, "classify_locked_cursor", return_value=observed) as classify, \
             patch.object(controller, "_observation_receipt", return_value="1" * 64) as receipt:
            actual, digest = controller._diagnose(args, source, reference)
        self.assertIs(actual, observed); self.assertEqual(digest, "1" * 64)
        self.assertEqual(connect.call_args.kwargs, {"readonly": True})
        transaction.assert_called_once_with(classify.call_args.args[0], readonly=True)
        self.assertEqual(target.call_args.args, (classify.call_args.args[0], H))
        self.assertIs(classify.call_args.args[0]._cursor, cursor); self.assertIs(classify.call_args.kwargs["consume_nonce"], nonces.return_value)
        self.assertEqual(receipt.call_args.args, (args, Path("/checkout").resolve(), observed, reference)); self.assertTrue(conn.rolled_back and conn.closed and cursor.closed)

    def test_custody_requires_exact_signed_fresh_source_target_schema(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"receipt_sha256": "d" * 64, "target_fingerprint": H})()
        body = {key: H for key in controller.RecoveryCustody.__annotations__}
        body.update(target_fingerprint=H, freeze_expires_at=200, archive_bytes=1, issued_at=100, expires_at=200, final_recovery_commit=source.final_commit,
                    runtime_source_root=source.runtime_source_root, reference_receipt_sha256=reference.receipt_sha256)
        args = Namespace(custody="/custody", repository_root="/checkout", custody_receipt_sha256=None)
        with patch.object(controller, "_outside", return_value=Path("/custody")), patch.object(controller, "_stable_bytes", return_value=b"exact"), patch.object(controller, "_signed_document", return_value=body), patch.object(controller.time, "time", return_value=150):
            custody = controller._custody(args, source, reference)
        self.assertIs(type(custody), controller.RecoveryCustody)
        for key, value in (("extra", 1), ("expires_at", 100), ("runtime_source_root", H), ("target_fingerprint", "b" * 64)):
            broken = dict(body); broken[key] = value
            with patch.object(controller, "_outside", return_value=Path("/custody")), patch.object(controller, "_stable_bytes", return_value=b"exact"), patch.object(controller, "_signed_document", return_value=broken), patch.object(controller.time, "time", return_value=150):
                with self.assertRaisesRegex(controller.ControllerError, "custody_binding"): controller._custody(args, source, reference)
    def test_fixed_receipt_public_key_hash_is_exact(self):
        self.assertEqual(
            hashlib.sha256(controller._RECEIPT_PUBLIC_KEY_PEM.encode("ascii")).hexdigest(),
            "cd576d9c8558c067e987193394627abbbfc37e75df8183039a13efaea3f8c498",
        )
    def test_receipts_use_distinct_fixed_verifier_and_reject_wrong_key(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

        receipt_key, wrong_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        public = receipt_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
        body = {"receipt": "bound"}
        unsigned = controller.authority.canonical_json_bytes({
            "schema": controller.SCHEMA, "kind": "aggregate-custody", "body": body,
        })
        value = {
            "schema": controller.SCHEMA, "kind": "aggregate-custody", "body": body,
            "signature_b64": controller.base64.b64encode(receipt_key.sign(unsigned)).decode("ascii"),
        }
        raw = controller.authority.canonical_json_bytes(value) + b"\n"
        with patch.object(controller, "_RECEIPT_PUBLIC_KEY_PEM", public.decode("ascii")), \
                patch.object(controller, "_RECEIPT_PUBLIC_KEY_SHA256", hashlib.sha256(public).hexdigest()), \
                patch.object(controller.authority, "_verify", side_effect=AssertionError("offline verifier used")):
            self.assertEqual(controller._signed_document(raw, "aggregate-custody"), body)
            forged = dict(value, signature_b64=controller.base64.b64encode(wrong_key.sign(unsigned)).decode("ascii"))
            with self.assertRaisesRegex(controller.ControllerError, "receipt_invalid"):
                controller._signed_document(controller.authority.canonical_json_bytes(forged) + b"\n", "aggregate-custody")
            wrong_kind_unsigned = {
                "schema": controller.SCHEMA, "kind": "local-state-preparation", "body": body,
            }
            wrong_kind = {
                **wrong_kind_unsigned,
                "signature_b64": controller.base64.b64encode(
                    receipt_key.sign(controller.authority.canonical_json_bytes(wrong_kind_unsigned))
                ).decode("ascii"),
            }
            with self.assertRaisesRegex(controller.ControllerError, "receipt_invalid"):
                controller._signed_document(
                    controller.authority.canonical_json_bytes(wrong_kind) + b"\n",
                    "aggregate-custody",
                )

    def test_receipt_signing_uses_only_receipt_private_key(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat
        private = Ed25519PrivateKey.generate()
        private_pem = private.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
        public = private.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
        fd = os.open(os.devnull, os.O_RDONLY)
        with patch.object(controller.authority, "restrictive_regular_file", return_value=controller._RECEIPT_SIGNING_KEY) as restrictive, \
                patch.object(controller.authority, "_open_custody", return_value=(fd, private_pem)), \
                patch.object(controller, "_RECEIPT_PUBLIC_KEY_PEM", public.decode("ascii")), \
                patch.object(controller, "_RECEIPT_PUBLIC_KEY_SHA256", hashlib.sha256(public).hexdigest()):
            signature = controller._sign_receipt(b"receipt", Path("/checkout"))
        private.public_key().verify(signature, b"receipt")
        self.assertEqual(restrictive.call_args.args, (controller._RECEIPT_SIGNING_KEY, "recovery receipt signing key", Path("/checkout")))
    def test_signed_receipt_writer_preserves_canonical_lf_bytes(self):
        value = {"schema": controller.SCHEMA, "kind": "aggregate-custody", "body": {"receipt": "bound"}}
        with tempfile.TemporaryDirectory() as raw, \
                patch.object(controller, "_sign_receipt", return_value=b"s" * 64), \
                patch.object(controller.authority, "_fsync_directory"):
            output = Path(raw) / "receipt.json"
            receipt_sha256 = controller._write_signed(output, value, repository_root=Path(raw))
            expected = controller.authority.canonical_json_bytes({
                **value,
                "signature_b64": controller.base64.b64encode(b"s" * 64).decode("ascii"),
            }) + b"\n"
            self.assertEqual(output.read_bytes(), expected)
            self.assertEqual(receipt_sha256, hashlib.sha256(expected).hexdigest())
    def test_restrictive_publication_never_clobbers_or_exposes_partial_bytes(self):
        raw = b"complete signed receipt"
        with tempfile.TemporaryDirectory() as directory, patch.object(controller.authority, "_fsync_directory"):
            output = Path(directory) / "receipt.json"
            def write_with_visibility_check(fd, data):
                os.write(fd, data[:5])
                self.assertFalse(output.exists())
                os.write(fd, data[5:])
            with patch.object(controller.authority, "_write_all", side_effect=write_with_visibility_check):
                controller._publish_restrictive(output, raw)
            self.assertEqual(output.read_bytes(), raw)
            self.assertEqual(list(Path(directory).glob(".receipt.json.*.tmp")), [])
            output.write_bytes(b"existing")
            with self.assertRaisesRegex(controller.ControllerError, "^receipt_exists$"):
                controller._publish_restrictive(output, b"replacement")
            self.assertEqual(output.read_bytes(), b"existing")
            self.assertEqual(list(Path(directory).glob(".receipt.json.*.tmp")), [])

    def test_nonce_store_is_directory_backed_and_replay_safe(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            args = Namespace(nonce_dir=outside)
            with patch.object(controller, "_outside", return_value=Path(outside)), patch.object(controller.authority, "_journal_parent", return_value=Path(outside)), patch.object(controller.authority, "_fsync_directory"):
                consume = controller._nonce_store(args, Path(root))
                self.assertTrue(consume("nonce_0123456789")); self.assertFalse(consume("nonce_0123456789"))
                self.assertTrue(any(Path(outside).iterdir()))

    def test_live_target_hash_denies_mismatch_without_preimage(self):
        cursor = Cursor()
        expected = "f" * 64
        with self.assertRaisesRegex(controller.ControllerError, "live_target") as raised: controller._require_live_target(cursor, expected)
        self.assertNotIn("system", str(raised.exception)); self.assertEqual(len(cursor.calls), 1)
    def test_live_target_uses_valid_control_system_composite_field_and_exact_identity_hash(self):
        cursor = Cursor()
        self.assertEqual(
            controller._live_target(cursor),
            hashlib.sha256(b'["system","42","170006"]').hexdigest(),
        )
        self.assertEqual(
            cursor.calls,
            ["SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_oid, current_setting('server_version_num') AS server_version_num"],
        )
        self.assertNotIn("pg_control_system().system_identifier", cursor.calls[0])

    def test_service_file_replacement_closes_connection_before_denial(self):
        args = Namespace(repository_root="/checkout", database_url=None, dsn=None, service_file="/service", service_name="locked")
        connection = type("Conn", (), {"closed": False, "close": lambda self: setattr(self, "closed", True)})()
        psycopg = type("P", (), {"rows": type("Rows", (), {"dict_row": object()})(), "connect": staticmethod(lambda **_: connection)})()
        with patch.object(controller.authority, "restrictive_regular_file", return_value=Path("/service")), patch.object(controller, "_stable_bytes", side_effect=[b"before", b"after"]), patch.dict(sys.modules, {"psycopg": psycopg}):
            with self.assertRaisesRegex(controller.ControllerError, "service_replaced"): controller._connect_service(args, readonly=True)
        self.assertTrue(connection.closed)
    def test_g037_adapter_converts_dict_rows_to_terminal_tuples(self):
        native = Cursor(rows=[{"version": "00400", "name": "migration", "statements": ["SELECT 1"]}])
        native.description = tuple(type("Column", (), {"name": name})() for name in ("version", "name", "statements"))
        self.assertEqual(controller._G037TupleFetchallCursor(native).fetchall(), [("00400", "migration", ["SELECT 1"])])
    def test_connection_sets_service_file_only_during_successful_connect(self):
        args = Namespace(repository_root="/checkout", database_url=None, dsn=None, service_file="/supplied-service", service_name="locked")
        connection = object()
        dict_row = object()
        def connect(**kwargs):
            self.assertEqual(os.environ["PGSERVICEFILE"], str(Path("/validated-service").resolve()))
            self.assertEqual(kwargs, {
                "service": "locked",
                "autocommit": True,
                "connect_timeout": 20,
                "options": "-c default_transaction_read_only=on",
                "row_factory": dict_row,
            })
            return connection
        psycopg = type("P", (), {"rows": type("Rows", (), {"dict_row": dict_row})(), "connect": staticmethod(connect)})()
        with patch.dict(os.environ, {}, clear=True), \
                patch.object(controller.authority, "restrictive_regular_file", return_value=Path("/validated-service")), \
                patch.object(controller, "_stable_bytes", return_value=b"stable"), \
                patch.dict(sys.modules, {"psycopg": psycopg}):
            self.assertIs(controller._connect_service(args, readonly=True), connection)
            self.assertNotIn("PGSERVICEFILE", os.environ)
    def test_controller_owns_single_repeatable_read_transaction_before_local_settings(self):
        class TransactionCursor(Cursor):
            def __init__(self):
                super().__init__()
                self.rows = [
                    {"transaction_read_only": "on", "transaction_isolation": "repeatable read"},
                    {"transaction_read_only": "on", "transaction_isolation": "repeatable read"},
                ]
            def fetchone(self):
                return self.rows.pop(0)

        cursor = TransactionCursor()
        controller._begin_controller_transaction(cursor, readonly=True)
        self.assertEqual(cursor.calls[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        self.assertEqual(cursor.calls[1:3], [
            "SELECT current_setting('transaction_read_only', true) AS transaction_read_only, current_setting('transaction_isolation', true) AS transaction_isolation",
            "SELECT current_setting('transaction_read_only', true) AS transaction_read_only, current_setting('transaction_isolation', true) AS transaction_isolation",
        ])
        self.assertEqual(cursor.calls[3:], [
            "SET LOCAL lock_timeout = '5s'",
            "SET LOCAL statement_timeout = '30s'",
            "SET LOCAL idle_in_transaction_session_timeout = '35s'",
            "SET LOCAL search_path = pg_catalog, public",
        ])

    def test_historical_admission_accepts_expired_signed_observation_and_custody_only_for_readback(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"receipt_sha256": "d" * 64, "target_fingerprint": H, "issued_at_unix": 100, "expires_at_unix": 200})()
        observed = observation()
        observation_body = {**observed.__dict__, "issued_at": 100, "expires_at": 200}
        custody_body = {key: H for key in controller.RecoveryCustody.__annotations__}
        custody_body.update(target_fingerprint=H, freeze_expires_at=200, archive_bytes=1, issued_at=100, expires_at=200, final_recovery_commit=source.final_commit, runtime_source_root=source.runtime_source_root, reference_receipt_sha256=reference.receipt_sha256)
        args = Namespace(repository_root="/checkout", observation="/observation", custody="/custody")
        with patch.object(controller, "_outside", side_effect=lambda path, *_args, **_kwargs: Path(path)), \
                patch.object(controller, "_stable_bytes", return_value=b"signed"), \
                patch.object(controller, "_signed_document", side_effect=[observation_body, custody_body]), \
                patch.object(controller.time, "time", return_value=300):
            window = controller._load_observation(args, source, reference, require_fresh=False)
            loaded, _ = window
            custody = controller._custody(args, source, reference, require_fresh=False)
        self.assertEqual(loaded, observed)
        self.assertEqual(window.issued_at, 100)
        self.assertEqual(window.expires_at, 200)
        self.assertEqual(window.status, observed.status)
        self.assertIsInstance(custody, controller.RecoveryCustody)
    def test_connection_restores_prior_service_file_after_success(self):
        args = Namespace(repository_root="/checkout", database_url=None, dsn=None, service_file="/supplied-service", service_name="locked")
        def connect(**_):
            self.assertEqual(os.environ["PGSERVICEFILE"], str(Path("/validated-service").resolve()))
            return object()
        psycopg = type("P", (), {"rows": type("Rows", (), {"dict_row": object()})(), "connect": staticmethod(connect)})()
        with patch.dict(os.environ, {"PGSERVICEFILE": "/prior-service"}, clear=True), \
                patch.object(controller.authority, "restrictive_regular_file", return_value=Path("/validated-service")), \
                patch.object(controller, "_stable_bytes", return_value=b"stable"), \
                patch.dict(sys.modules, {"psycopg": psycopg}):
            controller._connect_service(args, readonly=False)
            self.assertEqual(os.environ["PGSERVICEFILE"], "/prior-service")
    def test_connection_failure_restores_absent_service_file_without_leaking_path(self):
        args = Namespace(repository_root="/checkout", database_url=None, dsn=None, service_file="/secret-service", service_name="locked")
        def connect(**_):
            self.assertEqual(os.environ["PGSERVICEFILE"], str(Path("/validated-secret-service").resolve()))
            raise RuntimeError("password=/do-not-leak")
        psycopg = type("P", (), {"rows": type("Rows", (), {"dict_row": object()})(), "connect": staticmethod(connect)})()
        with patch.dict(os.environ, {}, clear=True), \
                patch.object(controller.authority, "restrictive_regular_file", return_value=Path("/validated-secret-service")), \
                patch.object(controller, "_stable_bytes", return_value=b"stable"), \
                patch.dict(sys.modules, {"psycopg": psycopg}):
            with self.assertRaisesRegex(controller.ControllerError, "^connection_unavailable$") as raised:
                controller._connect_service(args, readonly=True)
            self.assertNotIn("PGSERVICEFILE", os.environ)
        self.assertNotIn("/secret-service", str(raised.exception))
        self.assertNotIn("password", str(raised.exception))
    def test_connection_failure_restores_prior_service_file(self):
        args = Namespace(repository_root="/checkout", database_url=None, dsn=None, service_file="/supplied-service", service_name="locked")
        psycopg = type("P", (), {
            "rows": type("Rows", (), {"dict_row": object()})(),
            "connect": staticmethod(lambda **_: (_ for _ in ()).throw(RuntimeError("connect failed"))),
        })()
        with patch.dict(os.environ, {"PGSERVICEFILE": "/prior-service"}, clear=True), \
                patch.object(controller.authority, "restrictive_regular_file", return_value=Path("/validated-service")), \
                patch.object(controller, "_stable_bytes", return_value=b"stable"), \
                patch.dict(sys.modules, {"psycopg": psycopg}):
            with self.assertRaisesRegex(controller.ControllerError, "^connection_unavailable$"):
                controller._connect_service(args, readonly=True)
            self.assertEqual(os.environ["PGSERVICEFILE"], "/prior-service")
    def test_final_readback_passes_g037_a_utc_deadline_under_a_monotonic_statement_budget(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = object()
        authorization = type("Authorization", (), {"target_fingerprint": H, "target_catalog_root": H, "target_acl_root": H, "target_ledger_root": H, "target_data_root": H, "terminal_root": H})()
        native = Cursor()
        conn = Connection(native)
        terminal = {"catalog_root": H, "acl_root": H, "ledger_root": H, "terminal_spec": H}
        args = Namespace(repository_root="/checkout")
        def assert_terminal(cur, root, manifest, *, deadline):
            self.assertEqual(deadline, 230)
            cur.execute("SELECT terminal")
            return terminal
        with patch.object(controller, "_connect_service", return_value=conn), \
                patch.object(controller, "_begin_controller_transaction"), \
                patch.object(controller.prefix, "begin_read_only_snapshot"), \
                patch.object(controller, "_require_live_target"), \
                patch.object(controller, "terminal_readback_assert", side_effect=assert_terminal), \
                patch.object(controller.prefix, "probe_full_data_root", return_value=H), \
                patch.object(controller.time, "monotonic", return_value=100), \
                patch.object(controller.time, "time", return_value=200):
            controller._terminal_readback(args, source, reference, object(), authorization)
        self.assertEqual(native.calls, ["SET LOCAL statement_timeout = '30000ms'", "SELECT terminal"])
    def test_final_readback_denial_closes_cursor_and_connection(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        authorization = type("Authorization", (), {"target_fingerprint": H})()
        native = Cursor()
        conn = Connection(native)
        with patch.object(controller, "_connect_service", return_value=conn), \
                patch.object(controller, "_begin_controller_transaction"), \
                patch.object(controller.prefix, "begin_read_only_snapshot"), \
                patch.object(controller, "_require_live_target", side_effect=controller.ControllerError("live_target")):
            with self.assertRaisesRegex(controller.ControllerError, "^live_target$"):
                controller._terminal_readback(Namespace(repository_root="/checkout"), source, object(), object(), authorization)
        self.assertTrue(native.closed)
        self.assertTrue(conn.rolled_back)
        self.assertTrue(conn.closed)
    def test_deadline_bound_cursor_denies_expiration_before_another_statement(self):
        native = Cursor()
        bounded = controller._DeadlineBoundG037Cursor(native, 100)
        with patch.object(controller.time, "monotonic", return_value=100):
            with self.assertRaisesRegex(controller.ControllerError, "terminal_readback"):
                bounded.execute("SELECT must_not_run")
        self.assertEqual(native.calls, [])
    def test_production_backup_captures_current_g035_receipt_and_archive_before_signing(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"receipt_sha256": "d" * 64, "target_fingerprint": H, "expires_at_unix": 150})()
        observed = observation()
        manifest = object()
        capture_path, archive_path, output_path = Path("/custody/capture.json"), Path("/custody/g035-dump.enc"), Path("/custody/backup.json")
        archive_raw = b"encrypted-current-archive"
        captured = {
            "manifest_sha256": "e" * 64,
            "evidence": {
                "source_sha256": "f" * 64,
                "target_fingerprint": H,
                "dump_sha256": hashlib.sha256(archive_raw).hexdigest(),
                "dump_bytes": len(archive_raw),
            },
        }
        captured["receipt_sha256"] = controller.g035.digest(captured)
        capture_raw = controller.g035.canonical_bytes(captured)
        args = Namespace(
            repository_root="/checkout", destination="/custody", capture_receipt=str(capture_path),
            service_file="/custody/service.conf", recipient="age1" + "q" * 58,
            g034_artifact="/custody/g034.json", pg_dump="pg_dump", encrypt_command="age",
            freeze_assertion="/custody/freeze.json", freeze_evidence=["/custody/e1", "/custody/e2", "/custody/e3", "/custody/e4", "/custody/e5"],
            output=str(output_path),
        )
        def outside(path, root, *, fresh=False):
            self.assertEqual(root, Path("/checkout").resolve())
            if Path(path) == output_path:
                self.assertTrue(fresh)
            return Path(path)
        def stable(path, _root):
            if path.name == "capture.json":
                return capture_raw
            raise AssertionError(path)
        with patch.object(controller, "_source", return_value=source), \
                patch.object(controller, "_reference", return_value=reference), \
                patch.object(controller, "_load_observation", return_value=controller.LoadedObservation(observed, "1" * 64, 90, 160)), \
                patch.object(controller, "validate_sources", return_value=manifest) as validate, \
                patch.object(controller, "_backup_freeze", return_value=("2" * 64, "3" * 64, 200, "4" * 64)) as freeze, \
                patch.object(controller.g035, "capture_to_custody", return_value=captured) as capture, \
                patch.object(controller, "_outside", side_effect=outside), \
                patch.object(controller, "_stable_bytes", side_effect=stable), \
                patch.object(controller, "_archive_digest", return_value=(hashlib.sha256(archive_raw).hexdigest(), len(archive_raw))), \
                patch.object(controller, "_write_signed", return_value="4" * 64) as write, \
                patch.object(controller.time, "time", return_value=100):
            result = controller.production_backup(args)
        self.assertEqual(dict(result), {"schema": controller.SCHEMA, "mode": "production-backup", "status": "captured", "receipt_sha256": "4" * 64})
        validate.assert_called_once_with(Path("/checkout").resolve())
        freeze.assert_called_once_with(args, source, manifest)
        captured_args, captured_manifest = capture.call_args.args
        self.assertIs(captured_manifest, manifest)
        self.assertEqual(vars(captured_args), {
            "destination": "/custody", "capture_receipt": str(capture_path), "service_file": "/custody/service.conf",
            "recipient": "age1" + "q" * 58, "g034_artifact": "/custody/g034.json", "pg_dump": "pg_dump", "encrypt_command": "age",
        })
        self.assertEqual(write.call_args.args[0], output_path)
        signed = write.call_args.args[1]
        self.assertEqual(signed["kind"], "g040-production-backup-v1")
        self.assertEqual(signed["body"]["capture_receipt_sha256"], hashlib.sha256(capture_raw).hexdigest())
        self.assertEqual(signed["body"]["archive_sha256"], hashlib.sha256(archive_raw).hexdigest())
        self.assertEqual(signed["body"]["archive_bytes"], len(archive_raw))
        self.assertEqual(signed["body"]["expires_at"], 150)
    def test_archive_digest_streams_large_archive_in_64_kib_chunks(self):
        payload = (b"x" * (64 * 1024 * 2)) + b"tail"
        with tempfile.TemporaryDirectory() as raw:
            archive = Path(raw) / "g035-dump.enc"
            archive.write_bytes(payload)
            original_read = os.read
            with patch.object(controller.authority, "restrictive_regular_file", return_value=archive), \
                    patch.object(controller.os, "read", wraps=original_read) as read:
                digest, count = controller._archive_digest(archive, Path(raw) / "repository")
        self.assertEqual((digest, count), (hashlib.sha256(payload).hexdigest(), len(payload)))
        self.assertEqual([call.args[1] for call in read.call_args_list], [64 * 1024] * 4)

    def test_archive_digest_rejects_symlink_custody(self):
        with tempfile.TemporaryDirectory() as raw:
            target, archive = Path(raw) / "target.enc", Path(raw) / "g035-dump.enc"
            target.write_bytes(b"ciphertext")
            try:
                archive.symlink_to(target)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"symlinks unavailable: {error}")
            with patch.object(controller.authority, "restrictive_regular_file", return_value=archive):
                with self.assertRaisesRegex(controller.ControllerError, "^backup_capture$"):
                    controller._archive_digest(archive, Path(raw) / "repository")

    def test_archive_digest_rejects_path_replacement_during_stream(self):
        payload = b"x" * (64 * 1024 + 1)
        replacement = b"replacement"
        with tempfile.TemporaryDirectory() as raw:
            archive, staged = Path(raw) / "g035-dump.enc", Path(raw) / "replacement.enc"
            archive.write_bytes(payload)
            original_read, calls = os.read, 0

            def replace_after_first_chunk(fd, size):
                nonlocal calls
                chunk = original_read(fd, size)
                calls += 1
                if calls == 1:
                    staged.write_bytes(replacement)
                    os.replace(staged, archive)
                return chunk

            with patch.object(controller.authority, "restrictive_regular_file", return_value=archive), \
                    patch.object(controller.os, "read", side_effect=replace_after_first_chunk):
                with self.assertRaisesRegex(controller.ControllerError, "^backup_capture$"):
                    controller._archive_digest(archive, Path(raw) / "repository")

    def test_production_backup_rejects_stale_or_mismatched_capture_artifacts_without_leaking_values(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"receipt_sha256": "d" * 64, "target_fingerprint": H, "expires_at_unix": 150})()
        args = Namespace(repository_root="/checkout", destination="/custody", capture_receipt="/custody/capture.json", service_file="/custody/service", recipient="secret-recipient", g034_artifact="/custody/g034", pg_dump="pg_dump", encrypt_command="age", freeze_assertion="/custody/freeze", freeze_evidence=[], output="/custody/output")
        invalid = {"manifest_sha256": H, "evidence": {"source_sha256": H, "dump_sha256": H, "dump_bytes": 1}, "receipt_sha256": H}
        mismatched = {"manifest_sha256": H, "evidence": {"source_sha256": H, "dump_sha256": hashlib.sha256(b"original").hexdigest(), "dump_bytes": len(b"original")}}
        mismatched["receipt_sha256"] = controller.g035.digest(mismatched)
        for captured, capture_raw, archive_raw in (
            (invalid, b"stale", b"archive"),
            (invalid, controller.g035.canonical_bytes(invalid), b"archive"),
            (mismatched, controller.g035.canonical_bytes(mismatched), b"replacement"),
        ):
            with self.subTest(capture_raw=capture_raw), \
                    patch.object(controller, "_source", return_value=source), \
                    patch.object(controller, "_reference", return_value=reference), \
                    patch.object(controller, "_load_observation", return_value=controller.LoadedObservation(observation(), H, 90, 160)), \
                    patch.object(controller, "validate_sources", return_value=object()), \
                    patch.object(controller, "_backup_freeze", return_value=(H, H, 200, H)), \
                    patch.object(controller.g035, "capture_to_custody", return_value=captured), \
                    patch.object(controller, "_outside", side_effect=lambda value, *_args, **_kwargs: Path(value)), \
                    patch.object(controller, "_stable_bytes", return_value=capture_raw), \
                    patch.object(controller, "_archive_digest", return_value=(hashlib.sha256(archive_raw).hexdigest(), len(archive_raw))):
                with self.assertRaisesRegex(controller.ControllerError, "^backup_capture$") as raised:
                    controller.production_backup(args)
            self.assertNotIn("secret-recipient", str(raised.exception))

    def test_backup_freeze_requires_current_assertion_and_five_matching_residual_evidence(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        manifest = Manifest((), frozenset(), "20260531084516", "20260713002400")
        channels = ("no_owner_write", "no_dashboard_write", "no_provider_write", "no_out_of_band_write", "producer_stop")
        evidence = [f"/custody/{channel}" for channel in channels]
        values = [f"evidence-{index}".encode() for index in range(5)]
        assertion = {
            "freeze_id": "current-freeze", "origin": "operator", "relation_root": H, "acl_root": "b" * 64,
            "issued_at": 99, "expires_at": 200,
            "attestations": {channel: {"evidence_sha256": hashlib.sha256(raw).hexdigest()} for channel, raw in zip(channels, values)},
        }
        raw = controller.authority.canonical_json_bytes(assertion)
        args = Namespace(repository_root="/checkout", freeze_assertion="/custody/freeze", freeze_evidence=evidence)
        def stable(path, _root):
            return raw if path.name == "freeze" else values[channels.index(path.name)]
        with patch.object(controller, "_outside", side_effect=lambda value, *_args, **_kwargs: Path(value)), \
                patch.object(controller, "_stable_bytes", side_effect=stable), \
                patch.object(controller, "validate_operator_assertion") as validate, \
                patch.object(controller.time, "time", return_value=100):
            freeze_root, inventory_root, freeze_expires_at, target_acl_root = controller._backup_freeze(args, source, manifest)
        self.assertEqual(freeze_root, hashlib.sha256(raw).hexdigest())
        self.assertEqual(inventory_root, controller._hash({"g040-freeze-inventory-v1": {"relation_root": H, "acl_root": "b" * 64}}))
        self.assertEqual((freeze_expires_at, target_acl_root), (200, "b" * 64))
        validate.assert_called_once_with(
            assertion,
            freeze_id="current-freeze",
            origin="operator",
            relation_root=H,
            acl_root="b" * 64,
            commit="b" * 40,
            source_root=controller.g037_digest([]),
            terminal_spec=controller.terminal_spec(manifest),
            now=100,
        )
        for retired, assertion_error, residual in (
            ("40b54cf8-e59f-4eb3-a37c-88e3bf983442", None, evidence),
            ("current-freeze", ValueError("expired"), evidence),
            ("current-freeze", None, evidence[:-1]),
        ):
            changed = dict(assertion, freeze_id=retired)
            changed_raw = controller.authority.canonical_json_bytes(changed)
            changed_args = Namespace(repository_root="/checkout", freeze_assertion="/custody/freeze", freeze_evidence=residual)
            with patch.object(controller, "_outside", side_effect=lambda value, *_args, **_kwargs: Path(value)), \
                patch.object(controller, "_stable_bytes", side_effect=lambda path, _root: changed_raw if path.name == "freeze" else values[channels.index(path.name)]), \
                    patch.object(controller, "validate_operator_assertion", side_effect=assertion_error), \
                    patch.object(controller.time, "time", return_value=100):
                with self.assertRaisesRegex(controller.ControllerError, "^backup_freeze$"):
                    controller._backup_freeze(changed_args, source, manifest)

    def test_production_backup_cli_rejects_receipt_or_hash_shortcuts_with_sanitized_output(self):
        base = ["production-backup", "--repository-root", "/checkout", "--source-commit", "a" * 40, "--target-fingerprint", "b" * 64, "--reference", "/reference"]
        for option in ("--capture-receipt-sha256", "--archive-sha256", "--receipt"):
            stream = io.StringIO()
            with self.subTest(option=option), redirect_stderr(stream), patch.object(controller, "production_backup") as dispatch, self.assertRaises(SystemExit):
                controller.main([*base, option, "secret-shortcut"])
            dispatch.assert_not_called()
            self.assertNotIn("secret-shortcut", stream.getvalue())


if __name__ == "__main__": unittest.main()
