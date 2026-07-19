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
        self.assertEqual(controller.MODES, frozenset(("validate", "diagnose", "prepare", "execute", "readback")))
        stream = io.StringIO()
        with redirect_stderr(stream), self.assertRaises(SystemExit): controller.main(["rehearse"])
        self.assertNotIn("postgres://", stream.getvalue())
    def test_public_cli_rejects_callback_and_connection_injection(self):
        for option in ("--connection-factory", "--terminal-probe", "--database-url", "--dsn"):
            with self.subTest(option=option), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                controller.main(["validate", option, "injected"])

    def test_diagnose_uses_signed_observation_and_exact_snapshot_flow(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"target_fingerprint": H})()
        cursor, conn, observed = Cursor(), None, observation()
        conn = Connection(cursor)
        args = Namespace(repository_root="/checkout", nonce_dir="/nonce", observation_receipt="/receipt")
        with patch.object(controller, "_connect_service", return_value=conn) as connect, \
             patch.object(controller.prefix, "begin_read_only_snapshot") as snapshot, \
             patch.object(controller, "_require_live_target") as target, \
             patch.object(controller, "_nonce_store", return_value=object()) as nonces, \
             patch.object(controller.prefix, "classify_locked_cursor", return_value=observed) as classify, \
             patch.object(controller, "_observation_receipt", return_value="1" * 64) as receipt:
            actual, digest = controller._diagnose(args, source, reference)
        self.assertIs(actual, observed); self.assertEqual(digest, "1" * 64)
        self.assertEqual(connect.call_args.kwargs, {"readonly": True})
        self.assertEqual(snapshot.call_args.args, (classify.call_args.args[0],)); self.assertEqual(target.call_args.args, (classify.call_args.args[0], H))
        self.assertIs(classify.call_args.args[0]._cursor, cursor); self.assertIs(classify.call_args.kwargs["consume_nonce"], nonces.return_value)
        self.assertEqual(receipt.call_args.args, (args, Path("/checkout").resolve(), observed)); self.assertTrue(conn.rolled_back and conn.closed and cursor.closed)

    def test_custody_requires_exact_signed_fresh_source_target_schema(self):
        source = type("Source", (), {"final_commit": "b" * 40, "runtime_source_root": "c" * 64})()
        reference = type("Reference", (), {"receipt_sha256": "d" * 64, "target_fingerprint": H})()
        body = {key: H for key in controller.RecoveryCustody.__annotations__}
        body.update(target_fingerprint=H, issued_at=100, expires_at=200, final_recovery_commit=source.final_commit,
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
            "20a3783ba29ba2202622daf4df0d1684a92348919b06aca4a5ca227d21865131",
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
            signature = controller._sign_receipt(b"receipt")
        private.public_key().verify(signature, b"receipt")
        self.assertEqual(restrictive.call_args.args, (controller._RECEIPT_SIGNING_KEY, "recovery receipt signing key"))
    def test_signed_receipt_writer_preserves_canonical_lf_bytes(self):
        value = {"schema": controller.SCHEMA, "kind": "aggregate-custody", "body": {"receipt": "bound"}}
        with tempfile.TemporaryDirectory() as raw, \
                patch.object(controller, "_sign_receipt", return_value=b"s" * 64), \
                patch.object(controller.authority, "_fsync_directory"):
            output = Path(raw) / "receipt.json"
            receipt_sha256 = controller._write_signed(output, value)
            expected = controller.authority.canonical_json_bytes({
                **value,
                "signature_b64": controller.base64.b64encode(b"s" * 64).decode("ascii"),
            }) + b"\n"
            self.assertEqual(output.read_bytes(), expected)
            self.assertEqual(receipt_sha256, hashlib.sha256(expected).hexdigest())

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
                "autocommit": False,
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
        authorization = type("Authorization", (), {"target_fingerprint": H, "target_catalog_root": H, "target_ledger_root": H, "target_data_root": H, "terminal_root": H})()
        native = Cursor()
        conn = Connection(native)
        terminal = {"catalog_root": H, "acl_root": H, "ledger_root": H, "terminal_spec": H}
        args = Namespace(repository_root="/checkout")
        def assert_terminal(cur, root, manifest, *, deadline):
            self.assertEqual(deadline, 230)
            cur.execute("SELECT terminal")
            return terminal
        with patch.object(controller, "_connect_service", return_value=conn), \
                patch.object(controller.prefix, "begin_read_only_snapshot"), \
                patch.object(controller, "_require_live_target"), \
                patch.object(controller, "terminal_readback_assert", side_effect=assert_terminal), \
                patch.object(controller.prefix, "probe_full_data_root", return_value=H), \
                patch.object(controller.time, "monotonic", return_value=100), \
                patch.object(controller.time, "time", return_value=200):
            controller._final_readback(args, source, reference, object(), authorization)
        self.assertEqual(native.calls, ["SET LOCAL statement_timeout = '30000ms'", "SELECT terminal"])
    def test_deadline_bound_cursor_denies_expiration_before_another_statement(self):
        native = Cursor()
        bounded = controller._DeadlineBoundG037Cursor(native, 100)
        with patch.object(controller.time, "monotonic", return_value=100):
            with self.assertRaisesRegex(controller.ControllerError, "terminal_readback"):
                bounded.execute("SELECT must_not_run")
        self.assertEqual(native.calls, [])


if __name__ == "__main__": unittest.main()
