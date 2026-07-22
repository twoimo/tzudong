from __future__ import annotations

import ast
import hashlib
import inspect
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g040_clone_rehearsal as rehearsal
import g040_reverse_00400 as reverse


_READ_ONLY_SNAPSHOT_QUERY = (
    "SELECT current_setting('transaction_read_only', true) AS transaction_read_only, "
    "current_setting('transaction_isolation', true) AS transaction_isolation"
)

class FakeCursor:
    def __init__(self):
        self.full = True
        self.rollbacks = 0
        self.last = ""
        self.statements = []
        self.session_user = "supabase_admin"
        self.current_user = "supabase_admin"
        self.database_name = "g035_local"
        self.role_switch_user = "postgres"
        self.snapshot_rows = []
    def execute(self, sql, *params):
        self.last = sql
        self.statements.append(sql)
        if sql == "SELECT 1":
            self.full = True
        if sql.startswith("DROP SCHEMA privacy_retention"):
            self.full = False
        if sql == "SET LOCAL ROLE postgres":
            self.current_user = self.role_switch_user
        if sql == "ROLLBACK":
            self.full = True
            self.current_user = self.session_user
            self.rollbacks += 1
    def fetchone(self):
        if self.last == rehearsal._REFERENCE_CUSTODY_QUERY:
            return {
                "session_user": self.session_user,
                "current_user": self.current_user,
                "database_name": self.database_name,
            }
        if self.last == _READ_ONLY_SNAPSHOT_QUERY:
            row = {
                "transaction_read_only": "on",
                "transaction_isolation": "repeatable read",
            }
            self.snapshot_rows.append(row)
            return row
        if "pg_control_system" in self.last:
            return {"system_identifier": "74234234234", "database_oid": "16384", "database_name": "g035_local", "server_version": "17.6", "server_version_num": 170006}
        if self.last == rehearsal.DATA_PROBE:
            return {"classes_count": 10, "exact_seed_count": 10, "seed_rows_exact": True, "class_source_count": 0, "legal_hold_count": 0, "work_item_count": 0, "retained_record_count": 0, "run_count": 0, "run_item_count": 0, "runtime_tables_empty": True, "seed_projection_sha256": "0d38938f2e5c9ff0b0f3351fd1356fd3a9bc0d6aadf586d672020025cda807f8", "data_shape_sha256": "d" * 64}
        full = self.full
        return {
            "ledger_count": 28, "v00400_count": 0, "ledger_prefix_shape_ok": True,
            "ledger_sha256": "b" * 64, "schema_exists": full,
            "expected_table_count": 7 if full else 0, "schema_table_count": 7 if full else 0,
            "schema_index_count": 14 if full else 0, "column_count": 102 if full else 0,
            "schema_other_relation_count": 0, "touched_function_count": 14 if full else 0,
            "schema_trigger_count": 7 if full else 0, "rls_table_count": 7 if full else 0,
            "policy_count": 0, "acl_contract_ok": True, "exact_pg": True,
            "server_version_num": 170006, "catalog_sha256": ("f" if full else "c") * 64,
        }
    def close(self): pass


class FakeConnection:
    def __init__(self):
        self.cursor_value = FakeCursor()
        self.rollback_count = 0
        self.commit_count = 0
        self.info = type("Info", (), {"host": "127.0.0.1", "port": 55401})()
    def cursor(self): return self.cursor_value
    def rollback(self): self.rollback_count += 1
    def commit(self): self.commit_count += 1
    def close(self): pass


class Item:
    version = "20260712000400"
    name = "g010_retention_separation"


class Manifest:
    migrations = [None] * 16 + [Item()]


class CloneRehearsalTests(unittest.TestCase):
    def service(self, root: Path, *, host="127.0.0.1", db="g035_local") -> Path:
        path = root / "service.conf"
        path.write_text(f"[g035-local]\nhost={host}\nport=55401\ndbname={db}\nuser=supabase_admin\nsslmode=disable\napplication_name=g035-local-clone\npassword=never-print\n")
        return path
    def test_parser_excludes_online_signing_surfaces(self):
        parser = rehearsal._parser()
        help_text = parser.format_help()
        self.assertNotIn("--private-key", help_text)
        self.assertIn("build-reference-request", help_text)
        self.assertIn("finalize-reference", help_text)
        self.assertIn("build-lineage-request", help_text)
    def test_clone_runner_signed_writes_pass_resolved_repository_root(self):
        source = Path(rehearsal.__file__).read_text(encoding="utf-8")
        calls = [
            node for node in ast.walk(ast.parse(source))
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "_write_signed"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "controller"
        ]
        self.assertGreater(len(calls), 0)
        for call in calls:
            keywords = {keyword.arg: keyword.value for keyword in call.keywords}
            self.assertEqual(set(keywords), {"repository_root"})
            self.assertIsInstance(keywords["repository_root"], ast.Name)
            self.assertEqual(keywords["repository_root"].id, "root")

    def test_live_identity_uses_a_real_cursor(self):
        connection = FakeConnection()
        identity = rehearsal._live_identity(connection)
        self.assertEqual(identity["server_version_num"], 170006)
        self.assertIn("pg_control_system", connection.cursor_value.last)

    def test_read_only_classifier_and_replay_recovery_accept_only_terminal_state(self):
        reference = types.SimpleNamespace()
        start = {"ledger": "a" * 64, "catalog": "b" * 64, "data": "c" * 64}
        terminal = {"terminal_rows": 40, "ledger": "d" * 64, "catalog": "e" * 64,
                    "acl": "f" * 64, "data": "0" * 64, "terminal_spec": "1" * 64}
        cursor = FakeCursor()
        with patch.object(rehearsal, "_query_one", side_effect=[
                {"transaction_read_only": "on"},
                {"ledger_sha256": terminal["ledger"], "catalog_sha256": terminal["catalog"]},
        ]), patch.object(rehearsal, "_valid_probe") as valid:
            self.assertEqual(
                rehearsal._classify_read_only_state(
                    cursor, reference, start=start, terminal=terminal),
                "TERMINAL")
        valid.assert_called_once_with(
            {"ledger_sha256": terminal["ledger"], "catalog_sha256": terminal["catalog"]},
            full=False)
        connection = FakeConnection()
        binding = {"binding_receipt_sha256": "a" * 64}
        args = types.SimpleNamespace(
            service_file="service.conf", service_name="g035-local", container="clone",
            docker="docker")
        with patch.object(rehearsal, "_connect_service", return_value=(connection, {"port": 55401})) as connect, \
                patch.object(rehearsal, "_assert_observation_binding"), \
                patch.object(rehearsal, "begin_read_only_snapshot"), \
                patch.object(rehearsal, "_classify_read_only_state", return_value="TERMINAL"):
            recovered = rehearsal._replay_readback(args, Path("."), binding, reference,
                                                    Manifest(), start, terminal)
        self.assertEqual(recovered["terminal_readback_sha256"],
                         rehearsal._sha(rehearsal._canonical(terminal)))
        self.assertEqual(connection.cursor_value.statements, [
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "ROLLBACK"])
        self.assertEqual(connection.commit_count, 0)
        self.assertTrue(connect.call_args.kwargs["readonly"])
    def test_read_only_snapshot_opener_rolls_back_before_explicit_repeatable_read(self):
        connection = FakeConnection()
        cursor = connection.cursor_value
        with patch.object(rehearsal, "begin_read_only_snapshot") as snapshot:
            rehearsal._open_read_only_snapshot(connection, cursor)
        self.assertEqual(connection.rollback_count, 1)
        self.assertEqual(cursor.statements, [
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"])
        snapshot.assert_called_once_with(cursor)

    def test_read_only_classifier_reaches_start_and_rejects_partial_state(self):
        reference = types.SimpleNamespace()
        start = {"ledger": "a" * 64, "catalog": "b" * 64, "data": "c" * 64}
        terminal = {"terminal_rows": 40, "ledger": "d" * 64, "catalog": "e" * 64,
                    "acl": "f" * 64, "data": "0" * 64, "terminal_spec": "1" * 64}
        cursor = FakeCursor()
        with patch.object(rehearsal, "_query_one", side_effect=[
                {"transaction_read_only": "on"},
                {"ledger_sha256": start["ledger"], "catalog_sha256": start["catalog"]},
        ]), patch.object(rehearsal, "probe_full_data_root", return_value=start["data"]), \
                patch.object(rehearsal, "terminal_readback_assert") as terminal_assert:
            self.assertEqual(rehearsal._classify_read_only_state(
                cursor, reference, start=start, terminal=terminal, manifest=Manifest()), "START")
        terminal_assert.assert_not_called()
        with patch.object(rehearsal, "_query_one", side_effect=[
                {"transaction_read_only": "on"},
                {"ledger_sha256": start["ledger"], "catalog_sha256": terminal["catalog"]},
        ]), patch.object(rehearsal, "terminal_readback_assert") as terminal_assert:
            self.assertEqual(rehearsal._classify_read_only_state(
                cursor, reference, start=start, terminal=terminal, manifest=Manifest()), "AMBIGUOUS")
        terminal_assert.assert_called_once()
        with patch.object(rehearsal, "_query_one", side_effect=[
                {"transaction_read_only": "on"},
                {"ledger_sha256": terminal["ledger"], "catalog_sha256": terminal["catalog"]},
        ]), patch.object(rehearsal, "terminal_readback_assert", return_value={
                "ledger_root": terminal["ledger"],
                "catalog_root": terminal["catalog"],
                "acl_root": terminal["acl"],
                "terminal_spec": terminal["terminal_spec"],
        }), patch.object(rehearsal, "probe_terminal_data_root", return_value=terminal["data"]) as terminal_data, \
                patch.object(rehearsal, "probe_full_data_root") as full_data:
            self.assertEqual(rehearsal._classify_read_only_state(
                cursor, reference, start=start, terminal=terminal, manifest=Manifest()), "TERMINAL")
        terminal_data.assert_called_once_with(cursor, reference)
        full_data.assert_not_called()
    def test_service_schema_exact_image_and_secret_safe_cli(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); service = self.service(root)
            self.assertEqual(rehearsal.parse_local_service(service)["port"], 55401)
            with self.assertRaises(rehearsal.RehearsalError): rehearsal.parse_local_service(self.service(root, host="localhost"))
            with self.assertRaises(rehearsal.RehearsalError): rehearsal.parse_local_service(self.service(root, db="postgres"))
            (root / "unknown.conf").write_text(
                "[g035-local]\nhost=127.0.0.1\nhostaddr=127.0.0.1\nport=55401\ndbname=g035_local\nuser=supabase_admin\n"
                "sslmode=disable\napplication_name=g035-local-clone\npassword=never-print\n"
            )
            with self.assertRaises(rehearsal.RehearsalError):
                rehearsal.parse_local_service(root / "unknown.conf")
            admitted = rehearsal.admit_image("supabase/postgres:17.6.1.147", {"server_version_num": 170006, "extensions": ["pg_trgm", "uuid-ossp", "btree_gin", "vector", "pgcrypto"], "roles": ["postgres", "supabase_admin"]})
            self.assertTrue(admitted["extensions_admitted"])
            with self.assertRaises(rehearsal.RehearsalError): rehearsal.admit_image("postgres:17.6", {"server_version_num": 170006, "extensions": [], "roles": []})
    def test_preflight_aliases_version_for_dict_rows(self):
        version_query = "SELECT current_setting('server_version_num')::integer AS server_version_num"

        class DictCursor:
            def __init__(self):
                self.last = ""
                self.statements = []

            def execute(self, sql):
                self.last = sql
                self.statements.append(sql)

            def fetchone(self):
                if self.last == version_query:
                    return {"server_version_num": 170006}
                return {"current_setting": 170006}

            def fetchall(self):
                if self.last == "SELECT extname FROM pg_extension":
                    return [{"extname": name} for name in ("pg_trgm", "uuid-ossp", "btree_gin", "vector", "pgcrypto")]
                if self.last == "SELECT rolname FROM pg_roles":
                    return [{"rolname": name} for name in ("postgres", "supabase_admin")]
                raise AssertionError("unexpected preflight query")

            def close(self):
                pass

        class DictConnection:
            def __init__(self):
                self.cursor_value = DictCursor()

            def cursor(self):
                return self.cursor_value

            def rollback(self):
                pass

            def close(self):
                pass

        with tempfile.TemporaryDirectory() as raw:
            metadata = Path(raw) / "image.json"
            metadata.write_bytes(json.dumps({"image": "supabase/postgres:17.6.1.147"}, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii"))
            connection = DictConnection()
            with patch.object(rehearsal, "_connect_service", return_value=(connection, {})):
                result = rehearsal.preflight(
                    service_file=Path(raw) / "service.conf",
                    service_name="g035-local",
                    image="supabase/postgres:17.6.1.147",
                    image_metadata=metadata,
                )
        self.assertEqual(result["server_version_num"], 170006)
        self.assertEqual(connection.cursor_value.statements[0], version_query)

    def test_verified_observation_window_preserves_signed_bounds(self):
        projection = {"observation_receipt_sha256": rehearsal._sha(b"signed")}
        with patch.object(rehearsal, "_verified_observation", return_value=projection), \
                patch.object(rehearsal.controller, "_outside", return_value=Path("observation")), \
                patch.object(rehearsal.controller, "_stable_bytes", return_value=b"signed"), \
                patch.object(rehearsal.controller, "_signed_document", return_value={
                    "issued_at": 100,
                    "expires_at": 200,
                }):
            observed, issued_at, expires_at = rehearsal._verified_observation_window(
                "observation",
                source=types.SimpleNamespace(),
                target_fingerprint="a" * 64,
                repository_root=".",
                now=150,
            )
        self.assertIs(observed, projection)
        self.assertEqual((issued_at, expires_at), (100, 200))

        with patch.object(rehearsal, "_verified_observation", return_value=projection), \
                patch.object(rehearsal.controller, "_outside", return_value=Path("observation")), \
                patch.object(rehearsal.controller, "_stable_bytes", return_value=b"replaced"), \
                patch.object(rehearsal.controller, "_signed_document", return_value={
                    "issued_at": 100,
                    "expires_at": 200,
                }):
            with self.assertRaisesRegex(rehearsal.RehearsalError, "reference_input"):
                rehearsal._verified_observation_window(
                    "observation",
                    source=types.SimpleNamespace(),
                    target_fingerprint="a" * 64,
                    repository_root=".",
                    now=150,
                )
    def test_observation_rechecks_exact_endpoint_binding(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); service = self.service(root); connection = FakeConnection()
            live = {"system_identifier": "74234234234", "database_oid": "16384", "database_name": "g035_local", "server_version": "17.6", "server_version_num": 170006}
            proof = {"container_id_sha256": "e" * 64, "image_id_sha256": "f" * 64, "image_digest_sha256": "0" * 64, "endpoint_sha256": "1" * 64}
            binding = {**proof, "live_identity_sha256": rehearsal._sha(rehearsal._canonical(live)), "capture_receipt_path": "capture", "restore_receipt_path": "restore", "encrypted_dump_path": "dump", "clone_nonce": "clone-lineage-nonce", "lineage_attestation_path": "attestation", "lineage_signature_path": "signature", "lineage_attestation_sha256": "a" * 64, "lineage_signature_sha256": "b" * 64}
            hashes = {"lineage_attestation_sha256": "a" * 64, "lineage_signature_sha256": "b" * 64}
            with patch.object(rehearsal, "_restore_lineage", return_value={}), patch.object(rehearsal, "_docker_clone_proof", return_value=proof), patch.object(rehearsal, "_live_identity", return_value=live), patch.object(rehearsal, "_custody_bytes", return_value=b"{}"), patch.object(rehearsal, "_verify_lineage_attestation", return_value=hashes):
                rehearsal._assert_observation_binding(binding, verified_port=55401, container="clone-a-container", docker="docker", conn=connection, repository_root=root)
            with patch.object(rehearsal, "_restore_lineage", return_value={}), patch.object(rehearsal, "_docker_clone_proof", return_value={**proof, "endpoint_sha256": "2" * 64}), patch.object(rehearsal, "_live_identity", return_value=live):
                with self.assertRaises(rehearsal.RehearsalError):
                    rehearsal._assert_observation_binding(binding, verified_port=55401, container="clone-a-container", docker="docker", conn=connection, repository_root=root)
    def test_observation_rejects_controller_signed_forged_lineage_hashes(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); service = self.service(root); connection = FakeConnection()
            live = {"system_identifier": "74234234234", "database_oid": "16384", "database_name": "g035_local", "server_version": "17.6", "server_version_num": 170006}
            proof = {"container_id_sha256": "e" * 64, "image_id_sha256": "f" * 64, "image_digest_sha256": "0" * 64, "endpoint_sha256": "1" * 64}
            binding = {**proof, "clone_nonce": "clone-lineage-nonce", "live_identity_sha256": rehearsal._sha(rehearsal._canonical(live)), "capture_receipt_path": "capture", "restore_receipt_path": "restore", "encrypted_dump_path": "dump", "lineage_attestation_path": "attestation", "lineage_signature_path": "signature", "lineage_attestation_sha256": "a" * 64, "lineage_signature_sha256": "b" * 64}
            with patch.object(rehearsal, "_restore_lineage", return_value={}), patch.object(rehearsal, "_docker_clone_proof", return_value=proof), patch.object(rehearsal, "_live_identity", return_value=live), patch.object(rehearsal, "_custody_bytes", return_value=b"{}"), patch.object(rehearsal, "_verify_lineage_attestation", return_value={"lineage_attestation_sha256": "c" * 64, "lineage_signature_sha256": "d" * 64}):
                with self.assertRaises(rehearsal.RehearsalError):
                    rehearsal._assert_observation_binding(binding, verified_port=55401, container="clone-a-container", docker="docker", conn=connection, repository_root=root)
    def test_observation_signs_one_receipt_after_validating_full_states_and_binding(self):
        connection = FakeConnection()
        writes, probe_states, data_validations, binding_checks = {}, [], [], []
        binding = {key: "a" * 64 for key in ("binding_receipt_sha256", "clone_identity", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256")}
        binding["clone_nonce"] = "clone-observation-nonce"
        valid_probe, valid_data = rehearsal._valid_probe, rehearsal._valid_data
        validate_data_root = rehearsal.validate_full_data_root

        def checked_probe(row, *, full):
            valid_probe(row, full=full)
            probe_states.append(full)

        def checked_data(row):
            valid_data(row)
            data_validations.append(row["data_shape_sha256"])

        def checked_data_root(row, root):
            validate_data_root(row, root)
            self.assertEqual(row["data_shape_sha256"], root)

        def checked_binding(*args, **kwargs):
            binding_checks.append((kwargs["verified_port"], kwargs["container"]))
            self.assertEqual(Path(kwargs["repository_root"]).resolve(), Path(".").resolve())
            self.assertIs(kwargs["conn"], connection)

        def write_signed(path, document, *, repository_root):
            self.assertEqual(probe_states, [True, True, False, True, True])
            self.assertEqual(data_validations, ["d" * 64] * 4)
            self.assertEqual(binding_checks, [(55401, "clone")] * 3)
            self.assertEqual(document["schema"], rehearsal.controller.SCHEMA)
            self.assertEqual(document["kind"], "local-clone-observation")
            self.assertEqual(document["body"]["target_fingerprint"], "c" * 64)
            self.assertEqual(document["body"]["binding_receipt_sha256"], "a" * 64)
            self.assertEqual(Path(repository_root).resolve(), Path(".").resolve())
            writes[str(path)] = document
            return rehearsal._sha(rehearsal._canonical(document))

        def derive_terminal(connection, **kwargs):
            self.assertEqual(kwargs["deadline_monotonic"], 100 + rehearsal._LOCAL_MUTATION_TIMEOUT_SECONDS)
            connection.cursor_value.full = True
            return terminal

        terminal = types.SimpleNamespace(
            plan_sha256="e" * 64, terminal_rows=rehearsal.executor._TERMINAL_ROWS,
            terminal_ledger_root="f" * 64, terminal_catalog_root="1" * 64,
            terminal_acl_root="2" * 64, terminal_data_root="d" * 64,
            terminal_spec_root="3" * 64,
        )
        with patch.object(rehearsal, "_binding", return_value=binding), \
                patch.object(rehearsal, "_source", return_value=types.SimpleNamespace(final_commit="a" * 40, runtime_source_root="b" * 64)), \
                patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                patch.object(rehearsal.time, "monotonic", return_value=100), \
                patch.object(rehearsal, "build_source_validation_plan", return_value=object()), \
                patch.object(rehearsal, "_derive_clone_terminal_expectation", side_effect=derive_terminal), \
                patch.object(rehearsal, "vectors", return_value=((), ("SELECT 1",))), \
                patch.object(rehearsal, "_connect_service", return_value=(connection, {"port": 55401})), \
                patch.object(rehearsal, "_assert_observation_binding", side_effect=checked_binding), \
                patch.object(rehearsal, "_valid_probe", side_effect=checked_probe), \
                patch.object(rehearsal, "_valid_data", side_effect=checked_data), \
                patch.object(rehearsal, "validate_full_data_root", side_effect=checked_data_root), \
                patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root, fresh=False: Path(path)), \
                patch.object(rehearsal.controller, "_write_signed", side_effect=write_signed):
            rehearsal.observe_reference(
                repository_root=".",
                binding_path="binding.json",
                service_file="service.conf",
                service_name="g035-local",
                source_commit="a" * 40,
                target_fingerprint="c" * 64,
                output="observation.json",
                container="clone",
            )
        self.assertEqual(len(writes), 1)
        projection_source = inspect.getsource(rehearsal._verified_observation).split(
            "return MappingProxyType", 1
        )[1]
        self.assertNotIn('"issued_at":', projection_source)
        self.assertNotIn('"expires_at":', projection_source)
        statements = connection.cursor_value.statements
        self.assertNotIn("GRANT CREATE ON DATABASE g035_local TO postgres", statements)
        self.assertNotIn("GRANT CREATE ON SCHEMA public TO postgres", statements)
        self.assertNotIn("SET LOCAL ROLE postgres", statements)
        self.assertIn(rehearsal.REVERSE_VECTOR[0], statements)
        snapshot_queries = [
            index for index, statement in enumerate(statements)
            if statement == _READ_ONLY_SNAPSHOT_QUERY
        ]
        self.assertEqual(len(snapshot_queries), 2)
        self.assertLess(snapshot_queries[0], statements.index(rehearsal.CATALOG_PROBE))
        self.assertLess(snapshot_queries[1], statements.index(rehearsal.CATALOG_PROBE, snapshot_queries[1]))
        self.assertNotIn("COMMIT", statements)
        self.assertEqual(connection.cursor_value.snapshot_rows, [
            {"transaction_read_only": "on", "transaction_isolation": "repeatable read"},
        ] * 2)
        self.assertEqual(connection.cursor_value.full, True)
        self.assertNotIn("COMMIT", statements)
    def test_reference_custody_rejects_wrong_pregrant_identity_and_postswitch_role(self):
        cases = (
            ("session", {"session_user": "postgres"}),
            ("current_role", {"current_user": "postgres"}),
            ("database", {"database_name": "postgres"}),
            ("post_switch_role", {"role_switch_user": "supabase_admin"}),
        )
        for name, values in cases:
            with self.subTest(name=name):
                cursor = FakeCursor()
                for key, value in values.items():
                    setattr(cursor, key, value)
                expected_current_user = "postgres" if name == "post_switch_role" else "supabase_admin"
                if name == "post_switch_role":
                    cursor.execute("SET LOCAL ROLE postgres")
                with self.assertRaisesRegex(rehearsal.RehearsalError, "reference_custody"):
                    rehearsal._assert_reference_custody(cursor, current_user=expected_current_user)
    def test_reverse_vector_is_literal_restrict_only_and_domain_hashed(self):
        self.assertEqual(type(rehearsal.REVERSE_VECTOR), tuple)
        self.assertEqual(rehearsal.DERIVATION_MODE, reverse.DERIVATION_MODE)
        self.assertTrue(all(statement.startswith("DROP ") and statement.endswith(" RESTRICT") for statement in rehearsal.REVERSE_VECTOR))
        self.assertTrue(all("CASCADE" not in statement and "IF EXISTS" not in statement for statement in rehearsal.REVERSE_VECTOR))
        self.assertEqual(rehearsal.REVERSE_VECTOR_SHA256, reverse._vector_sha256())
    def test_reference_request_cli_uses_detached_finalization_only(self):
        parser = rehearsal._parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(["build-reference", "--private-key", "key"])
        request = parser.parse_args([
            "build-reference-request", "--repository-root", "root",
            "--source-commit", "a" * 40, "--target-fingerprint", "b" * 64,
            "--nonce", "reference-observation-nonce", "--first-observation", "one",
            "--second-observation", "two", "--output", "request",
        ])
        self.assertEqual(request.mode, "build-reference-request")
        self.assertFalse(hasattr(request, "private_key"))
    def test_service_custody_rejects_repository_file_replacement_and_effective_peer_mismatch(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); service = self.service(root)
            with self.assertRaises(rehearsal.RehearsalError):
                rehearsal._service_custody(service, root)

        class Connection:
            def __init__(self, host, port):
                self.info = types.SimpleNamespace(host=host, port=port)
                self.closed = False
            def close(self):
                self.closed = True

        service_path = Path("C:/outside/service.conf")
        raw = b"[g035-local]\nhost=127.0.0.1\nport=55401\ndbname=g035_local\nuser=supabase_admin\nsslmode=disable\napplication_name=g035-local-clone\npassword=never-print\n"
        psycopg = types.ModuleType("psycopg")
        rows = types.ModuleType("psycopg.rows"); rows.dict_row = object()
        psycopg.rows = rows
        seen = []
        for after, connection in (
            ((service_path, raw, (1, 2)), Connection("127.0.0.1", 55401)),
            ((service_path, raw, (1, 1)), Connection("127.0.0.2", 55401)),
        ):
            def connect(**kwargs):
                seen.append((dict(kwargs), rehearsal.os.environ.get("PGSERVICEFILE"), {key: rehearsal.os.environ.get(key) for key in ("PGUSER", "PGPASSWORD", "PGDATABASE", "PGHOST", "PGPORT")}))
                return connection
            psycopg.connect = connect
            with patch.dict(sys.modules, {"psycopg": psycopg, "psycopg.rows": rows}), patch.object(rehearsal, "_service_custody", side_effect=[(service_path, raw, (1, 1)), after]), patch.dict(rehearsal.os.environ, {"PGSERVICEFILE": "original-service-file", "PGUSER": "ambient-user", "PGPASSWORD": "ambient-password", "PGDATABASE": "ambient-database", "PGHOST": "ambient-host", "PGPORT": "9999"}):
                with self.assertRaises(rehearsal.RehearsalError):
                    rehearsal._connect_service(service_path, "g035-local", readonly=True, repository_root=Path("C:/repository"))
                self.assertEqual(rehearsal.os.environ["PGSERVICEFILE"], "original-service-file")
        self.assertTrue(seen)
        self.assertTrue(all("servicefile" not in kwargs and service == str(service_path) and all(value is None for value in identity.values()) for kwargs, service, identity in seen))
    def test_lineage_attestation_rejects_wrong_key_expiry_self_hash_forgery_and_binding_drift(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); repo = root / "repo"; repo.mkdir()
            expected = {"schema": rehearsal._LINEAGE_SCHEMA, "clone_nonce": "clone-lineage-nonce", "issued_at_unix": 100, "expires_at_unix": 200, "lineage_public_key_sha256": rehearsal._LINEAGE_PUBLIC_KEY_SHA256}
            attestation, signature = root / "attestation.json", root / "attestation.sig"
            attestation.write_bytes(rehearsal._canonical(expected)); signature.write_bytes(b"detached")
            with patch.object(rehearsal, "_custody_bytes", side_effect=lambda path, _: Path(path).read_bytes()), patch.object(rehearsal.crypto, "_source_public_key") as public_key, patch.object(rehearsal.crypto, "openssl_verify", return_value=True):
                public_key.return_value.__enter__.return_value.validate.return_value = None
                verified = rehearsal._verify_lineage_attestation(attestation=attestation, signature=signature, expected=expected, repository_root=repo, now_unix=150)
            self.assertEqual(verified["lineage_attestation_sha256"], rehearsal._sha(attestation.read_bytes()))
            for now, altered, valid in ((201, expected, True), (150, {**expected, "g035_restore_receipt_sha256": "f" * 64}, True), (150, {**expected, "clone_nonce": "replacement-clone-nonce"}, True), (150, expected, False)):
                with self.subTest(now=now, altered=altered != expected, valid=valid):
                    attestation.write_bytes(rehearsal._canonical(altered))
                    with patch.object(rehearsal, "_custody_bytes", side_effect=lambda path, _: Path(path).read_bytes()), patch.object(rehearsal.crypto, "_source_public_key") as public_key, patch.object(rehearsal.crypto, "openssl_verify", return_value=valid):
                        public_key.return_value.__enter__.return_value.validate.return_value = None
                        with self.assertRaises(rehearsal.RehearsalError):
                            rehearsal._verify_lineage_attestation(attestation=attestation, signature=signature, expected=expected, repository_root=repo, now_unix=now)
    def test_docker_clone_proof_requires_pinned_image_and_isolated_labeled_container(self):
        container_id = "a" * 64
        image_id = "sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
        digest = "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
        labels = {
            "com.tzudong.g040.rehearsal": "true",
            "com.tzudong.g040.run": "clone-run-000000",
            "com.tzudong.g040.slot": "clone-slot-00000",
        }
        container = {
            "Id": container_id,
            "Image": image_id,
            "Config": {
                "Image": "supabase/postgres:17.6.1.147",
                "ExposedPorts": {"5432/tcp": {}},
                "Labels": labels,
            },
            "HostConfig": {
                "NetworkMode": "g040-rehearsal",
                "Privileged": False,
                "Binds": [],
                "Mounts": [],
                "CapAdd": [],
                "CapDrop": [],
                "PortBindings": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}]},
            },
            "Mounts": [],
            "NetworkSettings": {
                "Networks": {"g040-rehearsal": {"NetworkID": "network-identity"}},
                "Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}]},
            },
        }
        network = {
            "Id": "network-identity",
            "Internal": True,
            "Attachable": False,
            "Labels": labels,
            "Containers": {container_id: {}},
        }
        image = {"Id": image_id, "RepoDigests": [digest]}

        def proof_for(candidate, candidate_network=network, candidate_image=image):
            def docker_run(command, **kwargs):
                if command[1:4] == ["inspect", "--type", "container"]:
                    raw = [candidate]
                elif command[1:3] == ["network", "inspect"]:
                    raw = [candidate_network]
                elif command[1:3] == ["image", "inspect"]:
                    raw = [candidate_image]
                else:
                    self.fail(f"unexpected Docker command: {command}")
                return subprocess.CompletedProcess(command, 0, json.dumps(raw).encode())

            with patch.object(rehearsal.subprocess, "run", side_effect=docker_run):
                return rehearsal._docker_clone_proof("clone-a-container", 55401)

        proof = proof_for(container)
        self.assertEqual(proof["image_id_sha256"], rehearsal._sha(image_id.encode()))
        self.assertEqual(proof["image_digest_sha256"], rehearsal._sha(digest.encode()))
        self.assertEqual(proof["endpoint_sha256"], rehearsal._sha(rehearsal._canonical({"host": "127.0.0.1", "port": 55401})))

        cases = (
            ("different_digest", container, network, {**image, "RepoDigests": ["supabase/postgres@sha256:" + "b" * 64]}),
            ("mutable_digest", container, network, {**image, "RepoDigests": ["supabase/postgres:17.6.1.147"]}),
            ("different_image_id", {**container, "Image": "sha256:" + "b" * 64}, network, image),
            ("default_network", {**container, "HostConfig": {**container["HostConfig"], "NetworkMode": "default"}}, network, image),
            ("bridge_network", {**container, "HostConfig": {**container["HostConfig"], "NetworkMode": "bridge"}}, network, image),
            ("egress_network", container, {**network, "Internal": False}, image),
            ("attachable_network", container, {**network, "Attachable": True}, image),
            ("unlabeled_network", container, {**network, "Labels": {}}, image),
            ("multi_peer_network", container, {**network, "Containers": {container_id: {}, "foreign-peer": {}}}, image),
            ("wrong_run_label", {**container, "Config": {**container["Config"], "Labels": {**labels, "com.tzudong.g040.run": "wrong-run-000000"}}}, network, image),
            ("wrong_slot_label", {**container, "Config": {**container["Config"], "Labels": {**labels, "com.tzudong.g040.slot": "wrong-slot-00000"}}}, network, image),
            ("privileged", {**container, "HostConfig": {**container["HostConfig"], "Privileged": True}}, network, image),
            ("bind_mount", {**container, "HostConfig": {**container["HostConfig"], "Binds": ["/host:/container"]}}, network, image),
            ("host_mount", {**container, "HostConfig": {**container["HostConfig"], "Mounts": [{"Target": "/container"}]}}, network, image),
            ("mount", {**container, "Mounts": [{"Source": "/host"}]}, network, image),
            ("added_capability", {**container, "HostConfig": {**container["HostConfig"], "CapAdd": ["NET_ADMIN"]}}, network, image),
            ("dropped_capability", {**container, "HostConfig": {**container["HostConfig"], "CapDrop": ["NET_ADMIN"]}}, network, image),
            ("extra_port", {**container, "NetworkSettings": {**container["NetworkSettings"], "Ports": {**container["NetworkSettings"]["Ports"], "6432/tcp": []}}}, network, image),
            ("non_loopback_port", {**container, "HostConfig": {**container["HostConfig"], "PortBindings": {"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "55401"}]}}, "NetworkSettings": {**container["NetworkSettings"], "Ports": {"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "55401"}]}}}, network, image),
        )
        for name, candidate, candidate_network, candidate_image in cases:
            with self.subTest(name=name), self.assertRaisesRegex(rehearsal.RehearsalError, "docker_"):
                proof_for(candidate, candidate_network, candidate_image)

    def test_internal_docker_exec_proof_binds_live_identity_and_rejects_drift(self):
        container_id = "a" * 64
        image_id = rehearsal._IMAGE_ID
        labels = {
            rehearsal._LABEL: "true",
            rehearsal._RUN_LABEL: "clone-run-000000",
            rehearsal._SLOT_LABEL: "clone-slot-00000",
        }
        live = {
            "system_identifier": "74234234234", "database_oid": "16384",
            "database_name": "g035_local", "server_version": "17.6",
            "server_version_num": 170006,
        }
        container = {
            "Id": container_id, "Image": image_id,
            "Config": {"Image": rehearsal._IMAGE, "ExposedPorts": {"5432/tcp": {}}, "Labels": labels},
            "HostConfig": {"NetworkMode": "g040-rehearsal", "Privileged": False, "Binds": [],
                           "Mounts": [], "CapAdd": [], "CapDrop": [], "PortBindings": {}},
            "Mounts": [],
            "NetworkSettings": {"Networks": {"g040-rehearsal": {"NetworkID": "network-identity"}},
                                "Ports": {"5432/tcp": None}},
        }
        network = {"Id": "network-identity", "Internal": True, "Attachable": False,
                   "Labels": labels, "Containers": {container_id: {}}}
        image = {"Id": image_id, "RepoDigests": [rehearsal._IMAGE_DIGEST]}
        record = b"74234234234\x1f16384\x1fg035_local\x1f17.6\x1f170006\n"

        def proof_for(candidate=container, candidate_network=network, candidate_image=image, probe=record,
                      recheck_container=None, recheck_network=None):
            commands = []

            network_inspections = 0

            def docker_run(command, **kwargs):
                nonlocal network_inspections
                commands.append(command)
                if command[1:4] == ["inspect", "--type", "container"]:
                    value = recheck_container if command[-1] == container_id and recheck_container is not None else candidate
                    raw = json.dumps([value]).encode()
                elif command[1:3] == ["network", "inspect"]:
                    network_inspections += 1
                    value = recheck_network if network_inspections > 1 and recheck_network is not None else candidate_network
                    raw = json.dumps([value]).encode()
                elif command[1:3] == ["image", "inspect"]:
                    raw = json.dumps([candidate_image]).encode()
                elif command[1:2] == ["exec"]:
                    self.assertEqual(command, ["docker", "exec", container_id, "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "/usr/bin/psql", "-X", "--host", "/var/run/postgresql", "--port", "5432", "--username", "supabase_admin", "--dbname", "g035_local", "-A", "-t", "-F", "\x1f", "-c", rehearsal._INTERNAL_IDENTITY_QUERY])
                    raw = probe
                else:
                    self.fail(f"unexpected Docker command: {command}")
                return subprocess.CompletedProcess(command, 0, raw)

            with patch.object(rehearsal.subprocess, "run", side_effect=docker_run):
                proof = rehearsal._docker_clone_proof("clone-a-container", 55401, live)
            return proof, commands

        proof, commands = proof_for()
        self.assertEqual(proof["endpoint_sha256"], rehearsal._sha(rehearsal._canonical({
            "domain": "internal-docker-exec-proxy-v1", "host": "127.0.0.1",
            "port": 55401, "container_id_sha256": rehearsal._sha(container_id.encode()),
        })))
        self.assertEqual(len([command for command in commands if command[1:2] == ["exec"]]), 1)
        docker_hub_proof, docker_hub_commands = proof_for(
            candidate_image={**image, "RepoDigests": [f"docker.io/{rehearsal._IMAGE_DIGEST}"]},
        )
        self.assertEqual(docker_hub_proof, proof)
        self.assertEqual(len([command for command in docker_hub_commands if command[1:3] == ["image", "inspect"]]), 1)
        docker_29_container = {
            **container,
            "NetworkSettings": {
                **container["NetworkSettings"],
                "Ports": {"5432/tcp": []},
            },
        }
        docker_29_proof, docker_29_commands = proof_for(docker_29_container)
        self.assertEqual(docker_29_proof, proof)
        self.assertEqual(len([command for command in docker_29_commands if command[1:2] == ["exec"]]), 1)
        hostile_environment = {**container, "Config": {**container["Config"], "Env": [
            "PGHOST=attacker.invalid", "PGPORT=6543", "PGSERVICE=attacker",
            "PGDATABASE=wrong", "PGUSER=wrong", "PGOPTIONS=-csearch_path=wrong",
        ]}}
        hostile_proof, _ = proof_for(hostile_environment)
        self.assertEqual(hostile_proof, proof)

        cases = (
            ("missing_member", container, {**network, "Containers": {}}, image, record),
            ("extra_member", container, {**network, "Containers": {container_id: {}, "foreign": {}}}, image, record),
            ("target_port_publication", {**container, "HostConfig": {**container["HostConfig"], "PortBindings": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}]}}}, network, image, record),
            ("malformed_probe", container, network, image, b"bad\nextra\n"),
            ("mismatched_probe", container, network, image, b"wrong\x1f16384\x1fg035_local\x1f17.6\x1f170006\n"),
            ("mismatched_database_oid", container, network, image, b"74234234234\x1f99999\x1fg035_local\x1f17.6\x1f170006\n"),
            ("mismatched_database_name", container, network, image, b"74234234234\x1f16384\x1fwrong\x1f17.6\x1f170006\n"),
            ("mismatched_server_version", container, network, image, b"74234234234\x1f16384\x1fg035_local\x1f17.5\x1f170006\n"),
            ("mismatched_server_version_num", container, network, image, b"74234234234\x1f16384\x1fg035_local\x1f17.6\x1f170005\n"),
            ("carriage_return_probe", container, network, image, b"74234234234\x1f16384\x1fg035_local\x1f17.6\x1f170006\r\n"),
            ("empty_field_probe", container, network, image, b"74234234234\x1f\x1fg035_local\x1f17.6\x1f170006\n"),
            ("non_ascii_probe", container, network, image, b"74234234234\x1f16384\x1fg035_local\x1f17.6\x1f17000\xff\n"),
            ("nonnumeric_version_probe", container, network, image, b"74234234234\x1f16384\x1fg035_local\x1f17.6\x1fseventeen\n"),
            ("wrong_field_count_probe", container, network, image, b"74234234234\x1f16384\x1fg035_local\x1f17.6\n"),
            ("wrong_image", {**container, "Image": "sha256:" + "b" * 64}, network, image, record),
            ("wrong_labels", {**container, "Config": {**container["Config"], "Labels": {**labels, rehearsal._LABEL: "false"}}}, network, image, record),
            ("privileged", {**container, "HostConfig": {**container["HostConfig"], "Privileged": True}}, network, image, record),
        )
        for name, candidate, candidate_network, candidate_image, probe in cases:
            with self.subTest(name=name), self.assertRaisesRegex(rehearsal.RehearsalError, "docker_"):
                proof_for(candidate, candidate_network, candidate_image, probe)
        with self.assertRaisesRegex(rehearsal.RehearsalError, "docker_identity"):
            proof_for(recheck_container={**container, "Image": "sha256:" + "b" * 64})
        with self.assertRaisesRegex(rehearsal.RehearsalError, "docker_identity"):
            proof_for(recheck_network={**network, "Containers": {}})
        published = {**container,
                     "HostConfig": {**container["HostConfig"], "PortBindings": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}]}},
                     "NetworkSettings": {**container["NetworkSettings"], "Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}]}}}
        _, commands = proof_for(published)
        self.assertFalse(any(command[1:2] == ["exec"] for command in commands))
    def test_archive_digest_streams_once_in_bounded_chunks_and_denies_custody_drift(self):
        payload = b"archive-block-" * (64 * 1024)
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive = root / "encrypted.dump"
            archive.write_bytes(payload)
            original_read = os.read
            reads = []

            def counted_read(fd, size):
                reads.append(size)
                return original_read(fd, size)

            with patch.object(rehearsal.controller.authority, "restrictive_regular_file", return_value=archive), \
                    patch.object(rehearsal.os, "read", side_effect=counted_read):
                digest, count, identity = rehearsal._archive_digest(archive, root)
            self.assertEqual((digest, count), (rehearsal._sha(payload), len(payload)))
            self.assertEqual(len(reads), (len(payload) + 65_535) // 65_536 + 1)
            self.assertTrue(reads and all(size == 65_536 for size in reads))
            self.assertEqual(identity, (archive.stat().st_dev, archive.stat().st_ino))

            def deny_with_read(read, expected="lineage_replacement"):
                with patch.object(rehearsal.controller.authority, "restrictive_regular_file", return_value=archive), \
                        patch.object(rehearsal.os, "read", side_effect=read):
                    with self.assertRaisesRegex(rehearsal.RehearsalError, expected):
                        rehearsal._archive_digest(archive, root)

            first_read = True
            def truncated_read(fd, size):
                nonlocal first_read
                if first_read:
                    first_read = False
                    return original_read(fd, size)
                return b""
            deny_with_read(truncated_read)

            archive.write_bytes(payload)
            replacement = root / "replacement.dump"
            replacement.write_bytes(b"replacement")
            replaced = False
            def replacing_read(fd, size):
                nonlocal replaced
                chunk = original_read(fd, size)
                if not chunk and not replaced:
                    os.replace(replacement, archive)
                    replaced = True
                return chunk
            deny_with_read(replacing_read, "lineage_(?:custody|replacement)")

            archive.write_bytes(payload)
            original_fstat = os.fstat
            fstat_calls = 0
            def changed_size(fd):
                nonlocal fstat_calls
                result = original_fstat(fd)
                fstat_calls += 1
                if fstat_calls == 2:
                    return types.SimpleNamespace(
                        st_mode=result.st_mode, st_dev=result.st_dev, st_ino=result.st_ino,
                        st_size=result.st_size + 1,
                    )
                return result
            with patch.object(rehearsal.controller.authority, "restrictive_regular_file", return_value=archive), \
                    patch.object(rehearsal.os, "fstat", side_effect=changed_size):
                with self.assertRaisesRegex(rehearsal.RehearsalError, "lineage_replacement"):
                    rehearsal._archive_digest(archive, root)
    def test_probe_rows_use_exact_prefix_schema_and_fail_closed(self):
        cursor = FakeCursor()
        cursor.full = False
        absent = cursor.fetchone()
        rehearsal._valid_probe(absent, full=False)
        cursor.full = True
        full = cursor.fetchone()
        rehearsal._valid_probe(full, full=True)
        for invalid in (
            {key: value for key, value in absent.items() if key != "server_version_num"},
            {**absent, "legacy_alias": 0},
        ):
            with self.assertRaises(rehearsal.RehearsalError):
                rehearsal._valid_probe(invalid, full=False)

    def test_replay_branch_mints_only_exact_local_capability_and_signs_full_terminal_receipt(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = types.SimpleNamespace(
            receipt_sha256="c" * 64, target_fingerprint="d" * 64,
            ledger_prefix_sha256="e" * 64, full_catalog_sha256="f" * 64,
            full_data_sha256="0" * 64, absent_catalog_sha256="a" * 64,
            expires_at_unix=200,
            source_plan_sha256="b" * 64, terminal_rows=40,
            terminal_ledger_root="6" * 64, terminal_catalog_root="7" * 64,
            terminal_acl_root="8" * 64, terminal_data_root="0" * 64,
            terminal_spec_root="a" * 64,
            terminal_tuple_sha256=rehearsal._sha(rehearsal._canonical({
                "terminal_rows": 40, "terminal_ledger_root": "6" * 64,
                "terminal_catalog_root": "7" * 64, "terminal_acl_root": "8" * 64,
                "terminal_data_root": "0" * 64, "terminal_spec_root": "a" * 64})),
        )
        hosted = types.SimpleNamespace(
            status="FULL_ESCAPED", ledger_prefix_sha256="e" * 64,
            catalog_sha256="f" * 64, data_sha256="0" * 64,
        )
        clone = {
            "binding_receipt_sha256": "1" * 64, "clone_identity": "2" * 64,
            "clone_nonce": "clone-local-nonce", "live_identity_sha256": "3" * 64,
            "container_id_sha256": "4" * 64, "endpoint_sha256": "5" * 64,
        }
        evidence = types.SimpleNamespace(
            terminal_rows=40, terminal_ledger_root="6" * 64,
            terminal_catalog_root="7" * 64, terminal_acl_root="8" * 64,
            terminal_data_root="0" * 64, terminal_spec_root="a" * 64,
            evidence_sha256="b" * 64,
        )
        args = rehearsal.SimpleNamespace(
            repository_root=".", source_commit=source.final_commit,
            target_fingerprint=reference.target_fingerprint, reference="reference.json",
            observation="hosted.json", binding="binding.json",
            clone_observation="clone.json", service_file="service.conf",
            service_name="g035-local", container="clone-local-container",
            docker="docker", selected_branch="UNAPPLIED", preparation="preparation.json",
            intent_output="replay.intent", output="replay.json",
        )
        connection = FakeConnection()
        written, admitted = {}, []

        def apply(cursor, *, plan, verified_clone_capability, deadline_monotonic):
            self.assertIs(type(verified_clone_capability), rehearsal.executor._VerifiedCloneCapability)
            self.assertEqual(
                (verified_clone_capability.clone_identity, verified_clone_capability.clone_nonce,
                 verified_clone_capability.target_fingerprint),
                (clone["clone_identity"], clone["clone_nonce"], reference.target_fingerprint),
            )
            self.assertGreater(deadline_monotonic, 0)
            admitted.append((cursor, plan))
            return evidence

        with patch.object(rehearsal, "_source", return_value=source), \
                patch.object(rehearsal.controller, "_reference", return_value=reference), \
                patch.object(rehearsal.controller, "_load_observation", return_value=(hosted, "c" * 64)), \
                patch.object(rehearsal, "_verified_observation", return_value={**clone, "observation_receipt_sha256": "d" * 64}), \
                patch.object(rehearsal, "_binding", return_value=clone), \
                patch.object(rehearsal, "_verified_preparation", return_value={"preparation_receipt_sha256": "f" * 64, "expires_at": 200}), \
                patch.object(rehearsal, "_expected_prefix", return_value=types.SimpleNamespace(status="UNAPPLIED", ledger_prefix_sha256="e" * 64, catalog_sha256="a" * 64, data_sha256=None)), \
                patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                patch.object(rehearsal, "_connect_service", return_value=(connection, {"port": 55401})), \
                patch.object(rehearsal, "_assert_observation_binding") as binding_check, \
                patch.object(rehearsal, "compile_branch_plan", return_value=types.SimpleNamespace(terminal_spec_root="a" * 64)), \
                patch.object(rehearsal, "_apply_rehearsal_locked_cursor", side_effect=apply), \
                patch.object(rehearsal, "_replay_readback", return_value={
                    "terminal_rows": 40, "ledger": "6" * 64, "catalog": "7" * 64,
                    "acl": "8" * 64, "data": "0" * 64, "terminal_spec": "a" * 64,
                    "terminal_readback_sha256": "b" * 64}), \
                patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root, fresh=False: Path(path)), \
                patch.object(rehearsal.controller, "_write_signed", side_effect=lambda path, document, *, repository_root: written.update(document=document) or "e" * 64), \
                patch.object(rehearsal.time, "time", return_value=100), \
                patch.object(rehearsal.time, "monotonic", return_value=10):
            result = rehearsal.replay_branch(args)

        self.assertEqual(result["receipt_sha256"], "e" * 64)
        self.assertEqual(connection.rollback_count, 0)
        self.assertEqual(connection.cursor_value.statements.count("BEGIN"), 1)
        self.assertEqual(connection.commit_count, 1)
        self.assertEqual(len(admitted), 1)
        binding_check.assert_called_once()
        body = written["document"]["body"]
        self.assertEqual(written["document"]["kind"], "local-branch-replay")
        self.assertEqual(
            {key: body[key] for key in (
                "terminal_rows", "terminal_ledger_root", "terminal_catalog_root",
                "terminal_acl_root", "terminal_data_root", "terminal_spec_root",
                "replay_intent_receipt_sha256", "terminal_readback_sha256",
            )},
            {
                "terminal_rows": 40, "terminal_ledger_root": "6" * 64,
                "terminal_catalog_root": "7" * 64, "terminal_acl_root": "8" * 64,
                "terminal_data_root": "0" * 64, "terminal_spec_root": "a" * 64,
                "replay_intent_receipt_sha256": "e" * 64,
                "terminal_readback_sha256": "b" * 64,
            },
        )
        self.assertEqual(body["unapplied_provenance"], "prepared-from-full-escaped")
        self.assertNotIn("authorization", vars(args))
        self.assertNotIn("custody", vars(args))
    def test_full_replay_uses_reference_clone_under_hosted_unapplied(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = types.SimpleNamespace(
            receipt_sha256="c" * 64, target_fingerprint="d" * 64,
            ledger_prefix_sha256="e" * 64, full_catalog_sha256="f" * 64,
            full_data_sha256="0" * 64, absent_catalog_sha256="1" * 64,
            expires_at_unix=200,
            source_plan_sha256="b" * 64, terminal_rows=40,
            terminal_ledger_root="8" * 64, terminal_catalog_root="9" * 64,
            terminal_acl_root="a" * 64, terminal_data_root="0" * 64,
            terminal_spec_root="c" * 64,
            terminal_tuple_sha256=rehearsal._sha(rehearsal._canonical({
                "terminal_rows": 40, "terminal_ledger_root": "8" * 64,
                "terminal_catalog_root": "9" * 64, "terminal_acl_root": "a" * 64,
                "terminal_data_root": "0" * 64, "terminal_spec_root": "c" * 64})),
        )
        hosted = types.SimpleNamespace(
            status="UNAPPLIED", ledger_prefix_sha256=reference.ledger_prefix_sha256,
            catalog_sha256=reference.absent_catalog_sha256, data_sha256=None,
        )
        clone = {
            "binding_receipt_sha256": "2" * 64, "clone_identity": "3" * 64,
            "clone_nonce": "full-clone-nonce", "live_identity_sha256": "4" * 64,
            "container_id_sha256": "5" * 64, "endpoint_sha256": "6" * 64,
            "ledger_prefix_sha256": reference.ledger_prefix_sha256,
            "full_catalog_sha256": reference.full_catalog_sha256,
            "full_data_sha256": reference.full_data_sha256,
            "observation_receipt_sha256": "7" * 64,
        }
        evidence = types.SimpleNamespace(
            terminal_rows=40, terminal_ledger_root="8" * 64,
            terminal_catalog_root="9" * 64, terminal_acl_root="a" * 64,
            terminal_data_root="0" * 64, terminal_spec_root="c" * 64,
            evidence_sha256="d" * 64,
        )
        args = rehearsal.SimpleNamespace(
            repository_root=".", source_commit=source.final_commit, reference="reference.json",
            observation="hosted.json", binding="binding.json", clone_observation="clone.json",
            service_file="service.conf", service_name="g035-local", container="clone",
            docker="docker", selected_branch="FULL_ESCAPED", preparation=None,
            intent_output="replay.intent", output="replay.json",
        )
        connection, written = FakeConnection(), {}

        def expected(reference, status, ledger, catalog, data):
            return types.SimpleNamespace(
                status=status, ledger_prefix_sha256=ledger, catalog_sha256=catalog, data_sha256=data,
            )

        with patch.object(rehearsal, "_source", return_value=source), \
                patch.object(rehearsal.controller, "_reference", return_value=reference), \
                patch.object(rehearsal.controller, "_load_observation", return_value=(hosted, "e" * 64)), \
                patch.object(rehearsal, "_verified_observation", return_value=clone), \
                patch.object(rehearsal, "_binding", return_value=clone), \
                patch.object(rehearsal, "_expected_prefix", side_effect=expected), \
                patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                patch.object(rehearsal, "_connect_service", return_value=(connection, {"port": 55401})), \
                patch.object(rehearsal, "_assert_observation_binding"), \
                patch.object(rehearsal, "_admit_custody_verified_clone", return_value=object()), \
                patch.object(rehearsal, "compile_branch_plan", return_value=types.SimpleNamespace(terminal_spec_root="c" * 64)) as compile_plan, \
                patch.object(rehearsal, "_apply_rehearsal_locked_cursor", return_value=evidence), \
                patch.object(rehearsal, "_replay_readback", return_value={
                    "terminal_rows": 40, "ledger": "8" * 64, "catalog": "9" * 64,
                    "acl": "a" * 64, "data": "0" * 64, "terminal_spec": "c" * 64,
                    "terminal_readback_sha256": rehearsal._sha(rehearsal._canonical({"terminal_rows": 40, "ledger": "8" * 64, "catalog": "9" * 64, "acl": "a" * 64, "data": "0" * 64, "terminal_spec": "c" * 64}))}), \
                patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root, fresh=False: Path(path)), \
                patch.object(rehearsal.controller, "_write_signed", side_effect=lambda path, document, *, repository_root: written.update(document=document) or "f" * 64), \
                patch.object(rehearsal.time, "time", return_value=100), \
                patch.object(rehearsal.time, "monotonic", return_value=10):
            self.assertEqual(rehearsal.replay_branch(args)["receipt_sha256"], "f" * 64)

        observation = compile_plan.call_args.kwargs["observation"]
        self.assertEqual(
            (observation.status, observation.ledger_prefix_sha256, observation.catalog_sha256,
             observation.data_sha256),
            ("FULL_ESCAPED", reference.ledger_prefix_sha256, reference.full_catalog_sha256,
             reference.full_data_sha256),
        )
        body = written["document"]["body"]
        self.assertEqual(body["hosted_observation_receipt_sha256"], "e" * 64)
        self.assertEqual(
            (body["starting_roots"]["ledger"], body["starting_roots"]["catalog"],
             body["starting_roots"]["data"]),
            (reference.ledger_prefix_sha256, reference.full_catalog_sha256,
             reference.full_data_sha256),
        )
        native = {
            **body, "prefix_classification": "UNAPPLIED", "selected_branch": "UNAPPLIED",
            "clone_binding_receipt_sha256": "8" * 64,
            "clone_observation_receipt_sha256": "9" * 64,
            "clone_identity": "a" * 64, "clone_nonce": "native-clone-nonce",
            "live_identity_sha256": "b" * 64, "container_id_sha256": "c" * 64,
            "endpoint_sha256": "d" * 64,
            "starting_roots": {"ledger": reference.ledger_prefix_sha256,
                               "catalog": reference.absent_catalog_sha256, "data": None},
            "unapplied_provenance": "native-hosted-unapplied",
        }
        documents = {
            path: {**document, "intent_body_sha256": rehearsal._intent_body_sha256({
                **{key: value for key, value in document.items() if key not in {
                    "replay_intent_receipt_sha256", "terminal_readback_sha256"}},
                "schema": "g040-local-branch-replay-intent-v2",
            })}
            for path, document in {"full.json": body, "unapplied.json": native}.items()
        }
        replay_plan = lambda branch: types.SimpleNamespace(
            branch=branch, terminal_spec_root=reference.terminal_spec_root, compiled=())
        documents = {
            path: {**document, "replay_plan_sha256": rehearsal._replay_plan_sha256(
                replay_plan(document["selected_branch"]), reference.source_plan_sha256)}
            for path, document in documents.items()
        }
        documents = {
            path: {**document, "intent_body_sha256": rehearsal._intent_body_sha256({
                **{key: value for key, value in document.items() if key not in {
                    "replay_intent_receipt_sha256", "terminal_readback_sha256"}},
                "schema": "g040-local-branch-replay-intent-v2",
            })}
            for path, document in documents.items()
        }
        raw_documents = {rehearsal._canonical(value): value for value in documents.values()}
        compare_args = rehearsal.SimpleNamespace(
            repository_root=".", source_commit=source.final_commit, reference="reference.json",
            hosted_observation="hosted.json", first_replay="full.json",
            second_replay="unapplied.json", output="comparison.json",
        )
        self.assertEqual(
            rehearsal._validated_replay(
                documents["full.json"], source=source, reference=reference, hosted=hosted,
                hosted_receipt="e" * 64, now=100),
            documents["full.json"],
        )
        with patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                patch.object(rehearsal, "_expected_prefix",
                             side_effect=lambda reference, status, *_, **__: types.SimpleNamespace(status=status)), \
                patch.object(rehearsal, "compile_branch_plan",
                             side_effect=lambda _root, _manifest, *, source, reference, observation:
                             replay_plan(observation.status)):
            self.assertEqual(
                rehearsal._validated_replay(
                    documents["full.json"], source=source, reference=reference, hosted=hosted,
                    hosted_receipt="e" * 64, now=100, repository_root=Path(".")),
                documents["full.json"],
            )
        with patch.object(rehearsal, "_source", return_value=source), \
                patch.object(rehearsal.controller, "_reference", return_value=reference), \
                patch.object(rehearsal.controller, "_load_observation", return_value=(hosted, "e" * 64)), \
                patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root, fresh=False: Path(path)), \
                patch.object(rehearsal.controller, "_stable_bytes", side_effect=lambda path, *_: rehearsal._canonical(documents[str(path)])), \
                patch.object(rehearsal.controller, "_signed_document", side_effect=lambda raw, kind: raw_documents[raw]), \
                patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                patch.object(rehearsal, "_expected_prefix",
                             side_effect=lambda reference, status, *_, **__: types.SimpleNamespace(status=status)), \
                patch.object(rehearsal, "compile_branch_plan",
                             side_effect=lambda _root, _manifest, *, source, reference, observation:
                             replay_plan(observation.status)), \
                patch.object(rehearsal.controller, "_write_signed", return_value="f" * 64), \
                patch.object(rehearsal.time, "time", return_value=100):
            self.assertEqual(rehearsal.compare_replays(compare_args)["receipt_sha256"], "f" * 64)

    def test_replay_requires_preparation_for_unapplied_and_rejects_it_for_full(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = types.SimpleNamespace(receipt_sha256="c" * 64, target_fingerprint="d" * 64)
        full = types.SimpleNamespace(status="FULL_ESCAPED")
        base = dict(repository_root=".", source_commit=source.final_commit, reference="reference.json",
                    observation="hosted.json", selected_branch="UNAPPLIED", preparation=None)
        with patch.object(rehearsal, "_source", return_value=source), \
                patch.object(rehearsal.controller, "_reference", return_value=reference), \
                patch.object(rehearsal.controller, "_load_observation", return_value=(full, "e" * 64)):
            with self.assertRaisesRegex(rehearsal.RehearsalError, "preparation_required"):
                rehearsal.replay_branch(rehearsal.SimpleNamespace(**base))
            with self.assertRaisesRegex(rehearsal.RehearsalError, "preparation_forbidden"):
                rehearsal.replay_branch(rehearsal.SimpleNamespace(
                    **{**base, "selected_branch": "FULL_ESCAPED", "preparation": "prep.json"}))
    def test_signed_unapplied_preparation_denies_signature_kind_binding_and_root_drift_before_connect(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = types.SimpleNamespace(
            receipt_sha256="c" * 64, target_fingerprint="d" * 64,
            ledger_prefix_sha256="e" * 64, full_catalog_sha256="f" * 64,
            full_data_sha256="0" * 64, absent_catalog_sha256="1" * 64,
        )
        hosted = types.SimpleNamespace(status="FULL_ESCAPED")
        binding = {
            "binding_receipt_sha256": "2" * 64,
            "clone_identity": "3" * 64,
            "clone_nonce": "clone-preparation-nonce",
            "live_identity_sha256": "5" * 64,
            "container_id_sha256": "6" * 64,
            "endpoint_sha256": "7" * 64,
        }
        clone = {**binding, "observation_receipt_sha256": "4" * 64,
                 "live_identity_sha256": "5" * 64, "container_id_sha256": "6" * 64,
                 "endpoint_sha256": "7" * 64}
        args = rehearsal.SimpleNamespace(
            repository_root=None, source_commit=source.final_commit, reference="reference.json",
            observation="hosted.json", binding="binding.json", clone_observation="clone.json",
            service_file="service.conf", service_name="g035-local", container="clone",
            docker="docker", selected_branch="UNAPPLIED", preparation=None, output="replay.json",
        )
        key = Ed25519PrivateKey.generate()
        public = key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)

        def preparation(**changes):
            body = {
                "schema": "g040-local-state-preparation-v3", "issued_at": 100,
                "expires_at": 200, "final_recovery_commit": source.final_commit,
                "runtime_source_root": source.runtime_source_root,
                "reference_receipt_sha256": reference.receipt_sha256,
                "hosted_observation_receipt_sha256": "5" * 64,
                "clone_binding_receipt_sha256": binding["binding_receipt_sha256"],
                "clone_observation_receipt_sha256": clone["observation_receipt_sha256"],
                "clone_identity": binding["clone_identity"], "clone_nonce": binding["clone_nonce"],
                "reverse_vector_sha256": rehearsal.REVERSE_VECTOR_SHA256,
                "starting_ledger_root": reference.ledger_prefix_sha256,
                "starting_catalog_root": reference.full_catalog_sha256,
                "starting_data_root": reference.full_data_sha256,
                "resulting_ledger_root": reference.ledger_prefix_sha256,
                "resulting_catalog_root": reference.absent_catalog_sha256,
                "resulting_data_root": rehearsal.controller._ABSENT_DATA_ROOT,
                "preparation_intent_receipt_sha256": "6" * 64,
                "preparation_intent_body_sha256": "7" * 64,
                "terminal_readback_sha256": rehearsal._sha(rehearsal._canonical({
                    "state": "UNAPPLIED", "ledger": reference.ledger_prefix_sha256,
                    "catalog": reference.absent_catalog_sha256,
                    "data": rehearsal.controller._ABSENT_DATA_ROOT,
                })),
                "target_fingerprint": reference.target_fingerprint,
                "live_identity_sha256": clone["live_identity_sha256"],
                "container_id_sha256": clone["container_id_sha256"],
                "endpoint_sha256": clone["endpoint_sha256"],
                "intent_body_sha256": "7" * 64,
            }
            body.update(changes)
            unsigned = {"schema": rehearsal.controller.SCHEMA, "kind": "local-state-preparation", "body": body}
            return rehearsal.controller.authority.canonical_json_bytes({
                **unsigned,
                "signature_b64": rehearsal.controller.base64.b64encode(
                    key.sign(rehearsal.controller.authority.canonical_json_bytes(unsigned))
                ).decode("ascii"),
            }) + b"\n"

        def wrong_signature(raw):
            envelope = json.loads(raw)
            signature = bytearray(rehearsal.controller.base64.b64decode(envelope["signature_b64"], validate=True))
            signature[0] ^= 1
            envelope["signature_b64"] = rehearsal.controller.base64.b64encode(signature).decode("ascii")
            return rehearsal.controller.authority.canonical_json_bytes(envelope) + b"\n"

        cases = {
            "wrong_signature": wrong_signature,
            "wrong_kind": lambda raw: rehearsal.controller.authority.canonical_json_bytes({
                "schema": rehearsal.controller.SCHEMA, "kind": "aggregate-custody",
                "body": json.loads(raw)["body"],
                "signature_b64": rehearsal.controller.base64.b64encode(key.sign(
                    rehearsal.controller.authority.canonical_json_bytes({
                        "schema": rehearsal.controller.SCHEMA, "kind": "aggregate-custody",
                        "body": json.loads(raw)["body"],
                    })
                )).decode("ascii"),
            }) + b"\n",
            "source": lambda raw: preparation(final_recovery_commit="9" * 40),
            "reference": lambda raw: preparation(reference_receipt_sha256="6" * 64),
            "clone": lambda raw: preparation(clone_identity="7" * 64),
            "starting_root": lambda raw: preparation(starting_catalog_root="8" * 64),
            "resulting_root": lambda raw: preparation(resulting_catalog_root="8" * 64),
        }
        with tempfile.TemporaryDirectory() as raw, tempfile.TemporaryDirectory() as artifact_raw:
            root = Path(raw)
            args.repository_root = root
            valid_path = Path(artifact_raw) / "valid.json"
            valid_raw = preparation()
            valid_path.write_bytes(valid_raw)
            with patch.object(rehearsal.controller, "_outside", return_value=valid_path), \
                    patch.object(rehearsal.controller, "_stable_bytes", return_value=valid_raw), \
                    patch.object(rehearsal.controller, "_RECEIPT_PUBLIC_KEY_PEM", public.decode("ascii")), \
                    patch.object(rehearsal.controller, "_RECEIPT_PUBLIC_KEY_SHA256", rehearsal.hashlib.sha256(public).hexdigest()):
                self.assertEqual(
                    rehearsal.controller._signed_document(valid_raw, "local-state-preparation")["schema"],
                    "g040-local-state-preparation-v3",
                )
                verified = rehearsal._verified_preparation(
                    valid_path, source=source, reference=reference, hosted_receipt="5" * 64,
                    binding=binding, clone=clone, repository_root=root, now=150,
                )
            self.assertEqual(verified["preparation_receipt_sha256"], rehearsal._sha(valid_raw))
            self.assertEqual(
                (verified["resulting_ledger_root"], verified["resulting_catalog_root"],
                 verified["resulting_data_root"]),
                (reference.ledger_prefix_sha256, reference.absent_catalog_sha256,
                 rehearsal.controller._ABSENT_DATA_ROOT),
            )
            for name, mutate in cases.items():
                with self.subTest(name=name):
                    preparation_path = Path(artifact_raw) / f"{name}.json"
                    original = preparation()
                    preparation_path.write_bytes(mutate(original))
                    args.preparation = str(preparation_path)
                    with patch.object(rehearsal, "_source", return_value=source), \
                            patch.object(rehearsal.controller, "_reference", return_value=reference), \
                            patch.object(rehearsal.controller, "_outside", return_value=preparation_path), \
                            patch.object(rehearsal.controller, "_stable_bytes", side_effect=lambda path, *_: preparation_path.read_bytes()), \
                            patch.object(rehearsal.controller, "_load_observation", return_value=(hosted, "5" * 64)), \
                            patch.object(rehearsal, "_verified_observation", return_value=clone), \
                            patch.object(rehearsal, "_binding", return_value=binding), \
                            patch.object(rehearsal, "validate_sources") as validate, \
                            patch.object(rehearsal, "_connect_service") as connect, \
                            patch.object(rehearsal.controller, "_RECEIPT_PUBLIC_KEY_PEM", public.decode("ascii")), \
                            patch.object(rehearsal.controller, "_RECEIPT_PUBLIC_KEY_SHA256", rehearsal.hashlib.sha256(public).hexdigest()), \
                            patch.object(rehearsal.time, "time", return_value=150):
                        with self.assertRaisesRegex(rehearsal.RehearsalError, "preparation_receipt"):
                            rehearsal.replay_branch(args)
                    validate.assert_not_called()
                    connect.assert_not_called()
    def test_replay_branch_rolls_back_on_failure_without_writing_receipt(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = types.SimpleNamespace(receipt_sha256="c" * 64, target_fingerprint="d" * 64,
                                          ledger_prefix_sha256="e" * 64,
                                          absent_catalog_sha256="f" * 64)
        hosted = types.SimpleNamespace(status="FULL_ESCAPED")
        clone = {"binding_receipt_sha256": "1" * 64, "clone_identity": "2" * 64,
                 "clone_nonce": "clone-local-nonce", "live_identity_sha256": "3" * 64}
        args = rehearsal.SimpleNamespace(
            repository_root=".", source_commit=source.final_commit, reference="reference.json",
            observation="hosted.json", binding="binding.json", clone_observation="clone.json",
            service_file="service.conf", service_name="g035-local", container="clone-local-container",
            docker="docker", selected_branch="UNAPPLIED", preparation="preparation.json", output="replay.json",
        )
        connection = FakeConnection()
        with patch.object(rehearsal, "_source", return_value=source), \
                patch.object(rehearsal.controller, "_reference", return_value=reference), \
                patch.object(rehearsal.controller, "_load_observation", return_value=(hosted, "c" * 64)), \
                patch.object(rehearsal, "_verified_observation", return_value={**clone, "observation_receipt_sha256": "d" * 64}), \
                patch.object(rehearsal, "_binding", return_value=clone), \
                patch.object(rehearsal, "_verified_preparation", return_value={"preparation_receipt_sha256": "e" * 64, "expires_at": 200}), \
                patch.object(rehearsal, "_expected_prefix", return_value=types.SimpleNamespace(status="UNAPPLIED")), \
                patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                patch.object(rehearsal, "_connect_service", return_value=(connection, {"port": 55401})), \
                patch.object(rehearsal, "_assert_observation_binding"), \
                patch.object(rehearsal, "compile_branch_plan", return_value=object()), \
                patch.object(rehearsal, "_apply_rehearsal_locked_cursor", side_effect=RuntimeError("fail")), \
                patch.object(rehearsal.controller, "_write_signed") as write:
            with self.assertRaisesRegex(rehearsal.RehearsalError, "replay_failed"):
                rehearsal.replay_branch(args)
        self.assertEqual(connection.cursor_value.statements.count("BEGIN"), 1)
        self.assertEqual(connection.rollback_count, 1)
        write.assert_not_called()

    def test_compare_replays_requires_one_full_one_unapplied_and_distinct_clones(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        terminal = {"terminal_rows": 40, "ledger": "f" * 64, "catalog": "0" * 64,
                    "acl": "1" * 64, "data": "d" * 64, "terminal_spec": "3" * 64}
        common = {
            "schema": "g040-local-branch-replay-v3", "issued_at": 100, "expires_at": 200,
            "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "reference_receipt_sha256": "c" * 64, "hosted_observation_receipt_sha256": "d" * 64,
            "target_fingerprint": "e" * 64, "terminal_rows": 40,
            "terminal_ledger_root": "f" * 64, "terminal_catalog_root": "0" * 64,
            "terminal_acl_root": "1" * 64, "terminal_data_root": "d" * 64,
            "terminal_spec_root": "3" * 64, "source_plan_sha256": "4" * 64,
            "replay_plan_sha256": "5" * 64,
            "terminal_tuple_sha256": rehearsal._sha(rehearsal._canonical(terminal)),
            "intent_body_sha256": "0" * 64, "replay_intent_receipt_sha256": "6" * 64,
            "terminal_readback_sha256": rehearsal._sha(rehearsal._canonical(terminal)),
        }
        full = {
            **common, "prefix_classification": "FULL_ESCAPED", "selected_branch": "FULL_ESCAPED",
            "clone_binding_receipt_sha256": "5" * 64, "clone_observation_receipt_sha256": "6" * 64,
            "clone_identity": "7" * 64, "clone_nonce": "first-clone-nonce",
            "live_identity_sha256": "8" * 64, "container_id_sha256": "9" * 64,
            "endpoint_sha256": "a" * 64,
            "starting_roots": {"ledger": "b" * 64, "catalog": "c" * 64, "data": "d" * 64},
        }
        unapplied = {
            **common, "prefix_classification": "UNAPPLIED", "selected_branch": "UNAPPLIED",
            "clone_binding_receipt_sha256": "e" * 64, "clone_observation_receipt_sha256": "f" * 64,
            "clone_identity": "0" * 64, "clone_nonce": "second-clone-nonce",
            "live_identity_sha256": "1" * 64, "container_id_sha256": "2" * 64,
            "endpoint_sha256": "3" * 64,
            "starting_roots": {"ledger": "b" * 64, "catalog": "4" * 64, "data": None},
            "unapplied_provenance": "prepared-from-full-escaped",
            "preparation_receipt_sha256": "5" * 64,
        }
        args = rehearsal.SimpleNamespace(
            repository_root=".", source_commit=source.final_commit, target_fingerprint="e" * 64,
            reference="reference.json", hosted_observation="hosted.json",
            first_replay="first.json", second_replay="second.json", output="combined.json")

        def compare(second, status="FULL_ESCAPED"):
            documents = {"first.json": full, "second.json": second}
            reference = types.SimpleNamespace(
                receipt_sha256="c" * 64, target_fingerprint="e" * 64,
                ledger_prefix_sha256="b" * 64, absent_catalog_sha256="4" * 64,
                full_catalog_sha256="c" * 64, full_data_sha256="d" * 64,
                terminal_rows=40, terminal_ledger_root="f" * 64,
                terminal_catalog_root="0" * 64, terminal_acl_root="1" * 64,
                terminal_data_root="d" * 64, terminal_spec_root="3" * 64,
                terminal_tuple_sha256=rehearsal._sha(rehearsal._canonical(terminal)),
                source_plan_sha256="4" * 64,
            )
            replay_plan = lambda branch: types.SimpleNamespace(
                branch=branch, terminal_spec_root=reference.terminal_spec_root, compiled=())
            documents = {
                path: {**document, "replay_plan_sha256": rehearsal._replay_plan_sha256(
                    replay_plan(document["selected_branch"]), reference.source_plan_sha256)}
                for path, document in documents.items()
            }
            documents = {
                path: {**document, "intent_body_sha256": rehearsal._intent_body_sha256({
                    **{key: value for key, value in document.items() if key not in {
                        "replay_intent_receipt_sha256", "terminal_readback_sha256"}},
                    "schema": "g040-local-branch-replay-intent-v2",
                })}
                for path, document in documents.items()
            }
            by_raw = {rehearsal._canonical(value): value for value in documents.values()}
            hosted = types.SimpleNamespace(status=status)
            with patch.object(rehearsal, "_source", return_value=source), \
                    patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root, fresh=False: Path(path)), \
                    patch.object(rehearsal.controller, "_stable_bytes", side_effect=lambda path, *_: rehearsal._canonical(documents[str(path)])), \
                    patch.object(rehearsal.controller, "_signed_document", side_effect=lambda raw, kind: by_raw[raw]), \
                    patch.object(rehearsal.controller, "_reference", return_value=reference), \
                    patch.object(rehearsal.controller, "_load_observation", return_value=(hosted, "d" * 64)), \
                    patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                    patch.object(rehearsal, "_expected_prefix",
                                 side_effect=lambda reference, status, *_, **__: types.SimpleNamespace(status=status)), \
                    patch.object(rehearsal, "compile_branch_plan",
                                 side_effect=lambda _root, _manifest, *, source, reference, observation:
                                 replay_plan(observation.status)), \
                    patch.object(rehearsal.controller, "_write_signed", return_value="c" * 64), \
                    patch.object(rehearsal.time, "time", return_value=150):
                return rehearsal.compare_replays(args)

        self.assertEqual(compare(unapplied)["receipt_sha256"], "c" * 64)
        for field, value in (
            ("selected_branch", "FULL_ESCAPED"),
            ("clone_identity", full["clone_identity"]),
            ("terminal_data_root", "9" * 64),
        ):
            with self.subTest(field=field), self.assertRaisesRegex(rehearsal.RehearsalError, "replay_comparison"):
                compare({**unapplied, field: value})
        native = {
            key: value for key, value in unapplied.items() if key != "preparation_receipt_sha256"
        }
        native["unapplied_provenance"] = "native-hosted-unapplied"
        native["intent_body_sha256"] = rehearsal._intent_body_sha256({
            **{key: value for key, value in native.items() if key not in {
                "replay_intent_receipt_sha256", "terminal_readback_sha256"}},
            "schema": "g040-local-branch-replay-intent-v2",
        })
        native_reference = types.SimpleNamespace(
            receipt_sha256="c" * 64, target_fingerprint="e" * 64,
            ledger_prefix_sha256="b" * 64, absent_catalog_sha256="4" * 64,
            full_catalog_sha256="c" * 64, full_data_sha256="d" * 64,
            terminal_rows=40, terminal_ledger_root="f" * 64,
            terminal_catalog_root="0" * 64, terminal_acl_root="1" * 64,
            terminal_data_root="d" * 64, terminal_spec_root="3" * 64,
            source_plan_sha256="4" * 64,
            terminal_tuple_sha256=rehearsal._sha(rehearsal._canonical(terminal)),
        )
        native_hosted = types.SimpleNamespace(status="UNAPPLIED")
        self.assertEqual(
            rehearsal._validated_replay(
                native, source=source, reference=native_reference, hosted=native_hosted,
                hosted_receipt="d" * 64, now=150),
            native,
        )
        self.assertEqual(compare(native, status="UNAPPLIED")["receipt_sha256"], "c" * 64)
        for mutation in (
            {**full, "reference_receipt_sha256": "9" * 64},
            {**full, "starting_catalog_root": "9" * 64},
            {**full, "unapplied_provenance": "native-hosted-unapplied"},
            {**native, "hosted_observation_receipt_sha256": "9" * 64},
            {**native, "preparation_receipt_sha256": "5" * 64},
            {**native, "unapplied_provenance": "prepared-from-full-escaped"},
            {**unapplied, "unapplied_provenance": "native-hosted-unapplied"},
            {**native, "starting_catalog_root": "5" * 64},
        ):
            with self.assertRaisesRegex(rehearsal.RehearsalError, "replay_comparison"):
                rehearsal._validated_replay(
                    mutation, source=source, reference=native_reference, hosted=native_hosted,
                    hosted_receipt="d" * 64, now=150)

    def test_aggregate_cli_uses_only_artifact_paths_and_no_retired_raw_roots(self):
        parser = rehearsal._parser()
        args = parser.parse_args([
            "aggregate-custody", "--repository-root", ".", "--source-commit", "a" * 40,
            "--target-fingerprint", "b" * 64, "--reference", "reference.json",
            "--hosted-observation", "hosted.json", "--freeze-assertion", "freeze.json",
            "--freeze-evidence", "freeze-1.json", "--freeze-evidence", "freeze-2.json",
            "--freeze-evidence", "freeze-3.json", "--freeze-evidence", "freeze-4.json",
            "--freeze-evidence", "freeze-5.json", "--production-backup", "backup.json",
            "--g035-capture", "capture.json", "--g035-archive", "archive.enc",
            "--clone-rehearsal", "rehearsal.json", "--first-replay", "first.json",
            "--second-replay", "second.json", "--output", "aggregate.json",
        ])
        self.assertEqual(
            (args.hosted_observation, args.freeze_assertion, args.production_backup,
             args.g035_capture, args.g035_archive, args.clone_rehearsal,
             args.first_replay, args.second_replay),
            ("hosted.json", "freeze.json", "backup.json", "capture.json", "archive.enc",
             "rehearsal.json", "first.json", "second.json"),
        )
        retired = {"freeze_root", "inventory_root", "backup_receipt_sha256",
                   "capture_receipt_sha256", "clone_rehearsal_receipt_sha256",
                   "target_ledger_root", "target_catalog_root", "target_data_root",
                   "observation_hash", "terminal_hash"}
        self.assertTrue(retired.isdisjoint(vars(args)))

    def test_aggregate_signed_rejects_real_ed25519_signature_and_kind_mutations(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

        key = Ed25519PrivateKey.generate()
        public = key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
        artifacts = (
            ("hosted", "prefix-observation"),
            ("backup", "g040-production-backup-v1"),
            ("rehearsal", "clone-rehearsal"),
            ("full-replay", "local-branch-replay"),
            ("unapplied-replay", "local-branch-replay"),
        )

        def envelope(kind, body):
            unsigned = {"schema": rehearsal.controller.SCHEMA, "kind": kind, "body": body}
            return {
                **unsigned,
                "signature_b64": rehearsal.controller.base64.b64encode(
                    key.sign(rehearsal.controller.authority.canonical_json_bytes(unsigned))
                ).decode("ascii"),
            }

        with tempfile.TemporaryDirectory() as raw, tempfile.TemporaryDirectory() as artifacts_raw:
            root = Path(raw)
            with patch.object(rehearsal.controller, "_RECEIPT_PUBLIC_KEY_PEM", public.decode("ascii")), \
                    patch.object(rehearsal.controller, "_RECEIPT_PUBLIC_KEY_SHA256",
                                 hashlib.sha256(public).hexdigest()), \
                    patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root: Path(path)), \
                    patch.object(rehearsal.controller, "_stable_bytes", side_effect=lambda path, *_: Path(path).read_bytes()):
                for name, kind in artifacts:
                    with self.subTest(artifact=name):
                        path = Path(artifacts_raw) / f"{name}.json"
                        valid = envelope(kind, {"artifact": name})
                        path.write_bytes(rehearsal.controller.authority.canonical_json_bytes(valid) + b"\n")
                        self.assertEqual(rehearsal._aggregate_signed(path, kind, root)[0], {"artifact": name})

                        flipped = dict(valid)
                        signature = bytearray(rehearsal.controller.base64.b64decode(flipped["signature_b64"]))
                        signature[0] ^= 1
                        flipped["signature_b64"] = rehearsal.controller.base64.b64encode(signature).decode("ascii")
                        path.write_bytes(rehearsal.controller.authority.canonical_json_bytes(flipped) + b"\n")
                        with self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
                            rehearsal._aggregate_signed(path, kind, root)

                        wrong_kind = envelope("aggregate-custody", {"artifact": name})
                        path.write_bytes(rehearsal.controller.authority.canonical_json_bytes(wrong_kind) + b"\n")
                        with self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
                            rehearsal._aggregate_signed(path, kind, root)
    def test_aggregate_custody_derives_roots_from_verified_artifacts_and_denies_bad_evidence(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = types.SimpleNamespace(
            receipt_sha256="c" * 64, target_fingerprint="d" * 64,
            ledger_prefix_sha256="1" * 64, absent_catalog_sha256="2" * 64,
            full_catalog_sha256="4" * 64, full_data_sha256="5" * 64,
            derivation_mode=rehearsal.DERIVATION_MODE, reverse_vector_sha256="3" * 64,
            observation_nonce="hosted-observation-nonce", issued_at_unix=100,
            terminal_rows=40, terminal_ledger_root="d" * 64,
            terminal_catalog_root="e" * 64, terminal_acl_root="8" * 64,
            terminal_data_root="5" * 64, terminal_spec_root="0" * 64,
            source_plan_sha256="1" * 64,
            terminal_tuple_sha256=rehearsal._sha(rehearsal._canonical({
                "terminal_rows": 40, "ledger": "d" * 64, "catalog": "e" * 64,
                "acl": "8" * 64, "data": "5" * 64, "terminal_spec": "0" * 64,
            })),
        )
        hosted = {
            "status": "FULL_ESCAPED", "target_fingerprint": reference.target_fingerprint,
            "final_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "reference_receipt_sha256": reference.receipt_sha256, "derivation_mode": reference.derivation_mode,
            "reverse_vector_sha256": reference.reverse_vector_sha256, "observation_nonce": reference.observation_nonce,
            "ledger_prefix_sha256": reference.ledger_prefix_sha256, "catalog_sha256": reference.full_catalog_sha256,
            "data_sha256": reference.full_data_sha256, "classification_sha256": "",
            "issued_at": 100, "expires_at": 200,
        }
        hosted["classification_sha256"] = hashlib.sha256(json.dumps(
            {key: value for key, value in hosted.items() if key != "classification_sha256"},
            sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False,
        ).encode("ascii")).hexdigest()
        g035_source_sha256 = rehearsal.g035._source_fingerprint(
            rehearsal.g035.validate_sources(Path(".").resolve()))
        backup = {
            "issued_at": 100, "expires_at": 190, "final_recovery_commit": source.final_commit,
            "runtime_source_root": source.runtime_source_root, "reference_receipt_sha256": reference.receipt_sha256,
            "target_fingerprint": reference.target_fingerprint, "hosted_observation_receipt_sha256": "e" * 64,
            "hosted_observation_classification_sha256": hosted["classification_sha256"], "freeze_root": "7" * 64,
            "freeze_expires_at": 190, "target_acl_root": "8" * 64, "inventory_root": "9" * 64,
            "capture_receipt_sha256": "", "g035_receipt_sha256": "", "archive_sha256": "a" * 64,
            "archive_bytes": 9, "g035_manifest_sha256": rehearsal.g035.MANIFEST_SHA256,
            "g035_source_sha256": g035_source_sha256,
        }
        terminal = {"terminal_rows": 40, "ledger": "d" * 64, "catalog": "e" * 64,
                    "acl": backup["target_acl_root"], "data": "5" * 64, "terminal_spec": "0" * 64}
        replay_common = {
            "schema": "g040-local-branch-replay-v3", "issued_at": 100, "expires_at": 180,
            "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "reference_receipt_sha256": reference.receipt_sha256, "hosted_observation_receipt_sha256": "e" * 64,
            "target_fingerprint": reference.target_fingerprint, "terminal_rows": 40,
            "terminal_ledger_root": "d" * 64, "terminal_catalog_root": "e" * 64,
            "terminal_acl_root": backup["target_acl_root"], "terminal_data_root": "5" * 64,
            "terminal_spec_root": "0" * 64, "source_plan_sha256": "1" * 64,
            "replay_plan_sha256": "2" * 64, "terminal_tuple_sha256": reference.terminal_tuple_sha256,
            "intent_body_sha256": "3" * 64, "replay_intent_receipt_sha256": "4" * 64,
            "terminal_readback_sha256": rehearsal._sha(rehearsal._canonical(terminal)),
        }
        full = {
            **replay_common, "prefix_classification": "FULL_ESCAPED", "selected_branch": "FULL_ESCAPED",
            "clone_binding_receipt_sha256": "2" * 64, "clone_observation_receipt_sha256": "3" * 64,
            "clone_identity": "4" * 64, "clone_nonce": "full-clone-nonce",
            "live_identity_sha256": "5" * 64, "container_id_sha256": "6" * 64,
            "endpoint_sha256": "7" * 64,
            "starting_roots": {"ledger": hosted["ledger_prefix_sha256"], "catalog": hosted["catalog_sha256"], "data": hosted["data_sha256"]},
        }
        unapplied = {
            **replay_common, "prefix_classification": "UNAPPLIED", "selected_branch": "UNAPPLIED",
            "clone_binding_receipt_sha256": "8" * 64, "clone_observation_receipt_sha256": "9" * 64,
            "clone_identity": "a" * 64, "clone_nonce": "unapplied-clone-nonce",
            "live_identity_sha256": "b" * 64, "container_id_sha256": "c" * 64,
            "endpoint_sha256": "d" * 64,
            "starting_roots": {"ledger": reference.ledger_prefix_sha256, "catalog": reference.absent_catalog_sha256, "data": None},
            "unapplied_provenance": "prepared-from-full-escaped",
            "preparation_receipt_sha256": "e" * 64,
        }
        rehearsal_body = {
            "schema": "g040-clone-rehearsal-v1", "issued_at": 100, "expires_at": 170,
            "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "reference_receipt_sha256": reference.receipt_sha256, "hosted_observation_receipt_sha256": "e" * 64,
            "target_fingerprint": reference.target_fingerprint, "full_replay_receipt_sha256": "1" * 64,
            "unapplied_replay_receipt_sha256": "2" * 64, "full_clone_identity": full["clone_identity"],
            "unapplied_clone_identity": unapplied["clone_identity"],
            **{key: full[key] for key in ("terminal_rows", "terminal_ledger_root", "terminal_catalog_root",
                                          "terminal_acl_root", "terminal_data_root", "terminal_spec_root")},
        }
        args = rehearsal._parser().parse_args([
            "aggregate-custody", "--repository-root", ".", "--source-commit", source.final_commit,
            "--target-fingerprint", reference.target_fingerprint, "--reference", "reference.json",
            "--hosted-observation", "hosted.json", "--freeze-assertion", "freeze.json",
            *sum((["--freeze-evidence", f"freeze-{index}.json"] for index in range(5)), []),
            "--production-backup", "backup.json", "--g035-capture", "capture.json", "--g035-archive", "archive.enc",
            "--clone-rehearsal", "rehearsal.json", "--first-replay", "first.json", "--second-replay", "second.json", "--output", "aggregate.json",
        ])
        capture = {"schema": rehearsal.g035.RECEIPT_SCHEMA, "mode": "capture", "status": "captured",
                   "evidence": {"dump_sha256": backup["archive_sha256"], "dump_bytes": backup["archive_bytes"]}}
        capture["receipt_sha256"] = rehearsal._sha(rehearsal._canonical(capture))
        capture_raw = rehearsal._canonical(capture)
        backup["capture_receipt_sha256"] = rehearsal._sha(capture_raw)
        backup["g035_receipt_sha256"] = capture["receipt_sha256"]
        def sealed_replay(document):
            return {
                **document,
                "intent_body_sha256": rehearsal._intent_body_sha256({
                    **{key: value for key, value in document.items() if key not in {
                        "replay_intent_receipt_sha256", "terminal_readback_sha256"}},
                    "schema": "g040-local-branch-replay-intent-v2",
                }),
            }
        replay_plan = lambda branch: types.SimpleNamespace(
            branch=branch, terminal_spec_root=reference.terminal_spec_root, compiled=())
        full["replay_plan_sha256"] = rehearsal._replay_plan_sha256(
            replay_plan("FULL_ESCAPED"), reference.source_plan_sha256)
        unapplied["replay_plan_sha256"] = rehearsal._replay_plan_sha256(
            replay_plan("UNAPPLIED"), reference.source_plan_sha256)
        full = sealed_replay(full)
        unapplied = sealed_replay(unapplied)
        signed = {"hosted.json": (hosted, "e" * 64), "backup.json": (backup, "f" * 64),
                  "rehearsal.json": (rehearsal_body, "0" * 64), "first.json": (full, "1" * 64),
                  "second.json": (unapplied, "2" * 64)}

        def invoke(documents=signed, writes=None, freeze=("7" * 64, "9" * 64, 190, "8" * 64, 100)):
            writes = [] if writes is None else writes
            with patch.object(rehearsal, "_source", return_value=source), \
                    patch.object(rehearsal.controller, "_reference", return_value=reference), \
                    patch.object(rehearsal, "_aggregate_signed", side_effect=lambda path, kind, root: documents[str(path)]), \
                    patch.object(rehearsal, "_aggregate_freeze", return_value=freeze), \
                    patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root, fresh=False: Path(path)), \
                    patch.object(rehearsal.controller, "_stable_bytes", return_value=capture_raw), \
                    patch.object(rehearsal, "_archive_digest", return_value=(backup["archive_sha256"], backup["archive_bytes"], (1, 1))), \
                    patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                    patch.object(rehearsal, "_expected_prefix",
                                 side_effect=lambda reference, status, *_, **__: types.SimpleNamespace(status=status)), \
                    patch.object(rehearsal, "compile_branch_plan",
                                 side_effect=lambda _root, _manifest, *, source, reference, observation:
                                 replay_plan(observation.status)), \
                    patch.object(rehearsal.time, "time", return_value=150), \
                    patch.object(rehearsal.controller, "_write_signed", side_effect=lambda path, document, *, repository_root: writes.append(document) or "f" * 64):
                result = rehearsal.build_aggregate_custody(args)
            return result, writes

        result, writes = invoke()
        self.assertEqual(result["receipt_sha256"], "f" * 64)
        self.assertEqual(writes, [{
            "schema": rehearsal.controller.SCHEMA,
            "kind": "aggregate-custody",
            "body": {
                "issued_at": 150, "expires_at": 170,
                "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
                "reference_receipt_sha256": reference.receipt_sha256, "target_fingerprint": reference.target_fingerprint,
                "freeze_root": "7" * 64, "freeze_expires_at": 190, "target_acl_root": "8" * 64,
                "inventory_root": "9" * 64, "backup_receipt_sha256": "f" * 64,
                "capture_receipt_sha256": rehearsal._sha(capture_raw), "archive_sha256": backup["archive_sha256"],
                "archive_bytes": backup["archive_bytes"], "clone_rehearsal_receipt_sha256": "0" * 64,
                "target_ledger_root": full["terminal_ledger_root"],
                "target_catalog_root": full["terminal_catalog_root"],
                "target_data_root": full["terminal_data_root"],
            },
        }])
        native_hosted = {
            **hosted, "status": "UNAPPLIED",
            "catalog_sha256": reference.absent_catalog_sha256, "data_sha256": None,
        }
        native_hosted["classification_sha256"] = rehearsal._sha(rehearsal.prefix.canonical_bytes(
            {key: value for key, value in native_hosted.items()
             if key != "classification_sha256"}))
        native_full = {**full, "hosted_observation_receipt_sha256": "e" * 64}
        native_unapplied = {
            key: value for key, value in unapplied.items()
            if key != "preparation_receipt_sha256"
        }
        native_unapplied["unapplied_provenance"] = "native-hosted-unapplied"
        native_full = sealed_replay(native_full)
        native_unapplied = sealed_replay(native_unapplied)
        native_rehearsal = {
            **rehearsal_body, "full_replay_receipt_sha256": "3" * 64,
            "unapplied_replay_receipt_sha256": "4" * 64,
        }
        native_backup = {
            **backup,
            "hosted_observation_classification_sha256": native_hosted["classification_sha256"],
        }
        native_signed = {
            **signed, "hosted.json": (native_hosted, "e" * 64),
            "backup.json": (native_backup, "f" * 64),
            "rehearsal.json": (native_rehearsal, "0" * 64),
            "first.json": (native_full, "3" * 64),
            "second.json": (native_unapplied, "4" * 64),
        }
        self.assertEqual(invoke(native_signed)[0]["receipt_sha256"], "f" * 64)
        invalid_native = {
            **native_signed,
            "second.json": ({**native_unapplied,
                             "hosted_observation_receipt_sha256": "9" * 64}, "4" * 64),
        }
        with self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
            denied_writes = []
            invoke(invalid_native, denied_writes)
        self.assertEqual(denied_writes, [])
        def hosted_before_reference():
            backdated_hosted = {**hosted, "issued_at": reference.issued_at_unix - 1}
            backdated_hosted["classification_sha256"] = rehearsal._sha(
                rehearsal.prefix.canonical_bytes({
                    key: value for key, value in backdated_hosted.items()
                    if key != "classification_sha256"
                })
            )
            hosted_receipt = "6" * 64
            backdated_backup = {
                **backup,
                "hosted_observation_receipt_sha256": hosted_receipt,
                "hosted_observation_classification_sha256": backdated_hosted["classification_sha256"],
            }
            backdated_full = {**full, "hosted_observation_receipt_sha256": hosted_receipt}
            backdated_unapplied = {**unapplied, "hosted_observation_receipt_sha256": hosted_receipt}
            backdated_rehearsal = {
                **rehearsal_body,
                "hosted_observation_receipt_sha256": hosted_receipt,
                "full_replay_receipt_sha256": "8" * 64,
                "unapplied_replay_receipt_sha256": "9" * 64,
            }
            return {
                "hosted.json": (backdated_hosted, hosted_receipt),
                "backup.json": (backdated_backup, "7" * 64),
                "rehearsal.json": (backdated_rehearsal, "a" * 64),
                "first.json": (backdated_full, "8" * 64),
                "second.json": (backdated_unapplied, "9" * 64),
            }

        with self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
            denied_writes = []
            invoke(hosted_before_reference(), denied_writes)
        self.assertEqual(denied_writes, [])

        def altered(path, field, value):
            body, receipt = signed[path]
            if field == "__keyset_extra__":
                return {**signed, path: ({**body, "unexpected_pin_sha256": value}, receipt)}
            return {**signed, path: ({**body, field: value}, receipt)}

        matrix = (
            ("freeze_backup_acl", "backup.json", "target_acl_root", "9" * 64),
            ("backup_freeze_root", "backup.json", "freeze_root", "9" * 64),
            ("backup_inventory_root", "backup.json", "inventory_root", "8" * 64),
            ("backup_freeze_expiry", "backup.json", "freeze_expires_at", 189),
            ("backup_hosted_receipt", "backup.json", "hosted_observation_receipt_sha256", "9" * 64),
            ("capture_receipt", "backup.json", "capture_receipt_sha256", "9" * 64),
            ("capture_g035_receipt", "backup.json", "g035_receipt_sha256", "9" * 64),
            ("archive_digest", "backup.json", "archive_sha256", "9" * 64),
            ("archive_bytes", "backup.json", "archive_bytes", 10),
            ("rehearsal_hosted_receipt", "rehearsal.json", "hosted_observation_receipt_sha256", "9" * 64),
            ("full_replay_receipt", "rehearsal.json", "full_replay_receipt_sha256", "9" * 64),
            ("unapplied_replay_receipt", "rehearsal.json", "unapplied_replay_receipt_sha256", "9" * 64),
            ("full_clone_identity", "rehearsal.json", "full_clone_identity", "9" * 64),
            ("unapplied_clone_identity", "rehearsal.json", "unapplied_clone_identity", "9" * 64),
            ("full_starting_ledger", "first.json", "starting_ledger_root", "9" * 64),
            ("full_starting_catalog", "first.json", "starting_catalog_root", "9" * 64),
            ("full_starting_data", "first.json", "starting_data_root", "9" * 64),
            ("unapplied_starting_ledger", "second.json", "starting_ledger_root", "9" * 64),
            ("unapplied_starting_catalog", "second.json", "starting_catalog_root", "9" * 64),
            ("unapplied_starting_data", "second.json", "starting_data_root", "9" * 64),
            ("terminal_rows", "second.json", "terminal_rows", ["different"]),
            ("terminal_ledger", "second.json", "terminal_ledger_root", "9" * 64),
            ("terminal_catalog", "second.json", "terminal_catalog_root", "9" * 64),
            ("terminal_acl", "second.json", "terminal_acl_root", "9" * 64),
            ("terminal_data", "second.json", "terminal_data_root", "9" * 64),
            ("terminal_spec", "second.json", "terminal_spec_root", "9" * 64),
            ("hosted_expiry", "hosted.json", "expires_at", 149),
            ("backup_expiry", "backup.json", "expires_at", 149),
            ("full_expiry", "first.json", "expires_at", 149),
            ("unapplied_expiry", "second.json", "expires_at", 149),
            ("rehearsal_expiry", "rehearsal.json", "expires_at", 149),
        )
        exhaustive_matrix = (
            ("hosted_source", "hosted.json", "final_commit", "9" * 40),
            ("hosted_runtime_root", "hosted.json", "runtime_source_root", "9" * 64),
            ("hosted_reference_receipt", "hosted.json", "reference_receipt_sha256", "9" * 64),
            ("hosted_target_fingerprint", "hosted.json", "target_fingerprint", "9" * 64),
            ("hosted_max_age", "hosted.json", "issued_at", -751),
            ("hosted_keyset", "hosted.json", "__keyset_extra__", "9" * 64),
            ("backup_source", "backup.json", "final_recovery_commit", "9" * 40),
            ("backup_runtime_root", "backup.json", "runtime_source_root", "9" * 64),
            ("backup_reference_receipt", "backup.json", "reference_receipt_sha256", "9" * 64),
            ("backup_target_fingerprint", "backup.json", "target_fingerprint", "9" * 64),
            ("backup_hosted_classification", "backup.json", "hosted_observation_classification_sha256", "9" * 64),
            ("backup_g035_manifest", "backup.json", "g035_manifest_sha256", "9" * 64),
            ("backup_g035_source", "backup.json", "g035_source_sha256", "9" * 64),
            ("backup_max_age", "backup.json", "issued_at", -751),
            ("backup_keyset", "backup.json", "__keyset_extra__", "9" * 64),
            ("rehearsal_source", "rehearsal.json", "final_recovery_commit", "9" * 40),
            ("rehearsal_runtime_root", "rehearsal.json", "runtime_source_root", "9" * 64),
            ("rehearsal_reference_receipt", "rehearsal.json", "reference_receipt_sha256", "9" * 64),
            ("rehearsal_target_fingerprint", "rehearsal.json", "target_fingerprint", "9" * 64),
            ("rehearsal_terminal_rows", "rehearsal.json", "terminal_rows", ["different"]),
            ("rehearsal_terminal_ledger", "rehearsal.json", "terminal_ledger_root", "9" * 64),
            ("rehearsal_terminal_catalog", "rehearsal.json", "terminal_catalog_root", "9" * 64),
            ("rehearsal_terminal_acl", "rehearsal.json", "terminal_acl_root", "9" * 64),
            ("rehearsal_terminal_data", "rehearsal.json", "terminal_data_root", "9" * 64),
            ("rehearsal_terminal_spec", "rehearsal.json", "terminal_spec_root", "9" * 64),
            ("rehearsal_max_age", "rehearsal.json", "issued_at", -751),
            ("rehearsal_keyset", "rehearsal.json", "__keyset_extra__", "9" * 64),
            ("full_replay_source", "first.json", "final_recovery_commit", "9" * 40),
            ("full_replay_runtime_root", "first.json", "runtime_source_root", "9" * 64),
            ("full_replay_reference_receipt", "first.json", "reference_receipt_sha256", "9" * 64),
            ("full_replay_target_fingerprint", "first.json", "target_fingerprint", "9" * 64),
            ("full_replay_max_age", "first.json", "issued_at", -751),
            ("full_replay_keyset", "first.json", "__keyset_extra__", "9" * 64),
            ("unapplied_replay_source", "second.json", "final_recovery_commit", "9" * 40),
            ("unapplied_replay_runtime_root", "second.json", "runtime_source_root", "9" * 64),
            ("unapplied_replay_reference_receipt", "second.json", "reference_receipt_sha256", "9" * 64),
            ("unapplied_replay_hosted_receipt", "second.json", "hosted_observation_receipt_sha256", "9" * 64),
            ("unapplied_replay_target_fingerprint", "second.json", "target_fingerprint", "9" * 64),
            ("unapplied_replay_max_age", "second.json", "issued_at", -751),
            ("unapplied_replay_keyset", "second.json", "__keyset_extra__", "9" * 64),
        )
        self.assertEqual(len(matrix) + len(exhaustive_matrix) + 2, 73)
        for name, path, field, value in (*matrix, *exhaustive_matrix):
            with self.subTest(name=name), self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
                denied_writes = []
                invoke(altered(path, field, value), denied_writes)
            self.assertEqual(denied_writes, [])

        for name, path, field, value in (
            ("hosted_status", "hosted.json", "status", "UNAPPLIED"),
            ("hosted_derivation", "hosted.json", "derivation_mode", "wrong"),
            ("hosted_reverse_vector", "hosted.json", "reverse_vector_sha256", "9" * 64),
            ("hosted_nonce", "hosted.json", "observation_nonce", "different-observation-nonce"),
            ("hosted_ledger", "hosted.json", "ledger_prefix_sha256", "9" * 64),
            ("hosted_catalog", "hosted.json", "catalog_sha256", "9" * 64),
            ("hosted_data", "hosted.json", "data_sha256", None),
            ("hosted_classification_hash", "hosted.json", "classification_sha256", "9" * 64),
            ("hosted_future_issued", "hosted.json", "issued_at", 151),
            ("backup_future_issued", "backup.json", "issued_at", 151),
            ("backup_invalid_interval", "backup.json", "expires_at", 100),
            ("backup_exceeds_freeze_horizon", "backup.json", "expires_at", 191),
        ):
            with self.subTest(name=name), self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
                denied_writes = []
                invoke(altered(path, field, value), denied_writes)
            self.assertEqual(denied_writes, [])
        for name, path, field, value in (
            ("backup_before_freeze_and_hosted", "backup.json", "issued_at", 99),
            ("full_replay_before_hosted_and_reference", "first.json", "issued_at", 99),
            ("unapplied_replay_before_hosted_and_reference", "second.json", "issued_at", 99),
            ("rehearsal_before_replays", "rehearsal.json", "issued_at", 99),
            ("hosted_bool_issued", "hosted.json", "issued_at", True),
            ("backup_bool_expires", "backup.json", "expires_at", True),
            ("full_replay_bool_issued", "first.json", "issued_at", True),
            ("unapplied_replay_bool_expires", "second.json", "expires_at", True),
            ("rehearsal_bool_issued", "rehearsal.json", "issued_at", True),
        ):
            with self.subTest(name=name), self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
                denied_writes = []
                invoke(altered(path, field, value), denied_writes)
            self.assertEqual(denied_writes, [])

        with self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
            denied_writes = []
            invoke(altered("backup.json", "expires_at", 201), denied_writes,
                   freeze=("7" * 64, "9" * 64, 210, "8" * 64, 100))
        self.assertEqual(denied_writes, [])

        with self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
            denied_writes = []
            invoke(writes=denied_writes, freeze=("7" * 64, "9" * 64, 190, "8" * 64, 151))
        self.assertEqual(denied_writes, [])

        for name, freeze in (
            ("freeze_acl", ("7" * 64, "9" * 64, 190, "9" * 64, 100)),
            ("freeze_expiry", ("7" * 64, "9" * 64, 149, "8" * 64, 100)),
        ):
            with self.subTest(name=name), self.assertRaisesRegex(rehearsal.RehearsalError, "aggregate_custody"):
                denied_writes = []
                invoke(writes=denied_writes, freeze=freeze)
            self.assertEqual(denied_writes, [])

    def test_label_only_cleanup_uses_exact_discovery_and_removal_argv(self):
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, "abc\n", "")
        with patch.object(rehearsal.subprocess, "run", side_effect=run):
            result = rehearsal.cleanup("clone-run-000000", "docker")
        labels = ["--filter", "label=com.tzudong.g040.rehearsal=true", "--filter", "label=com.tzudong.g040.run=clone-run-000000"]
        self.assertEqual(result["removed"], {"container": 1, "volume": 1, "network": 1})
        self.assertEqual(
            [call[0] for call in calls],
            [
                ["docker", "ps", "-aq", *labels], ["docker", "rm", "-f", "abc"],
                ["docker", "volume", "ls", "-q", *labels], ["docker", "volume", "rm", "abc"],
                ["docker", "network", "ls", "-q", *labels], ["docker", "network", "rm", "abc"],
            ],
        )
        self.assertTrue(all(kwargs.get("check") is True for _, kwargs in calls))
        with self.assertRaisesRegex(rehearsal.RehearsalError, "cleanup_guard"):
            rehearsal.cleanup("short", "docker")

    def test_cleanup_denies_malformed_discovery_and_command_failures_without_removal(self):
        for stdout, failure in (("../foreign\n", None), ("abc\n", subprocess.CalledProcessError(1, ["docker"]))):
            with self.subTest(stdout=stdout, failure=failure):
                calls = []
                def run(argv, **kwargs):
                    calls.append(argv)
                    if failure:
                        raise failure
                    return subprocess.CompletedProcess(argv, 0, stdout, "")
                with patch.object(rehearsal.subprocess, "run", side_effect=run):
                    with self.assertRaisesRegex(rehearsal.RehearsalError, "cleanup_"):
                        rehearsal.cleanup("clone-run-000000", "docker")
                self.assertEqual(calls, [["docker", "ps", "-aq", "--filter", "label=com.tzudong.g040.rehearsal=true", "--filter", "label=com.tzudong.g040.run=clone-run-000000"]])


class PreparationRecoveryTests(unittest.TestCase):
    def _recover(self, classifier_state):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = types.SimpleNamespace(
            receipt_sha256="c" * 64, target_fingerprint="d" * 64,
            ledger_prefix_sha256="e" * 64, full_catalog_sha256="f" * 64,
            full_data_sha256="0" * 64, absent_catalog_sha256="1" * 64,
        )
        hosted = types.SimpleNamespace(issued_at=100, expires_at=200)
        binding = {
            "binding_receipt_sha256": "2" * 64, "clone_identity": "3" * 64,
            "clone_nonce": "preparation-recovery-nonce", "live_identity_sha256": "4" * 64,
            "container_id_sha256": "5" * 64, "endpoint_sha256": "6" * 64,
        }
        clone = {"observation_receipt_sha256": "7" * 64}
        intent = {
            "schema": "g040-local-state-preparation-intent-v2", "issued_at": 150,
            "expires_at": 180, "final_recovery_commit": source.final_commit,
            "runtime_source_root": source.runtime_source_root,
            "target_fingerprint": reference.target_fingerprint,
            "reference_receipt_sha256": reference.receipt_sha256,
            "hosted_observation_receipt_sha256": "8" * 64,
            "clone_binding_receipt_sha256": binding["binding_receipt_sha256"],
            "clone_observation_receipt_sha256": clone["observation_receipt_sha256"],
            **{key: binding[key] for key in (
                "clone_identity", "clone_nonce", "live_identity_sha256",
                "container_id_sha256", "endpoint_sha256")},
            "reverse_vector_sha256": rehearsal.REVERSE_VECTOR_SHA256,
            "starting_roots": {
                "ledger": reference.ledger_prefix_sha256, "catalog": reference.full_catalog_sha256,
                "data": reference.full_data_sha256,
            },
            "expected_terminal": {
                "state": "UNAPPLIED", "ledger": reference.ledger_prefix_sha256,
                "catalog": reference.absent_catalog_sha256, "data": rehearsal.controller._ABSENT_DATA_ROOT,
            },
        }
        intent["intent_body_sha256"] = rehearsal._intent_body_sha256(intent)
        args = types.SimpleNamespace(
            repository_root=".", source_commit=source.final_commit, binding="binding",
            intent="intent", clone_observation="clone", output="output",
        )
        readback = {"classifier_state": classifier_state}
        if classifier_state == "TERMINAL":
            value = {
                "state": "UNAPPLIED", "ledger": reference.ledger_prefix_sha256,
                "catalog": reference.absent_catalog_sha256, "data": rehearsal.controller._ABSENT_DATA_ROOT,
            }
            readback.update(value, terminal_readback_sha256=rehearsal._sha(rehearsal._canonical(value)))
        with patch.object(rehearsal, "_source", return_value=source), \
                patch.object(rehearsal.controller, "_reference", return_value=reference), \
                patch.object(rehearsal.controller, "_load_observation", return_value=(hosted, "8" * 64)), \
                patch.object(rehearsal, "_binding", return_value=binding), \
                patch.object(rehearsal, "_signed_intent", return_value=(intent, "9" * 64)), \
                patch.object(rehearsal, "_verified_observation_window", return_value=(clone, 100, 200)), \
                patch.object(rehearsal, "_historical_anchor_valid") as historical, \
                patch.object(rehearsal, "_preparation_readback", return_value=readback) as readback_call, \
                patch.object(rehearsal, "_publish_or_verify_terminal", return_value="a" * 64) as publish:
            result = rehearsal.recover_local_state(args)
        return result, historical, readback_call, publish

    def test_recover_local_state_publishes_terminal_with_intent_time_lineage(self):
        result, historical, readback, publish = self._recover("TERMINAL")
        self.assertEqual(result["receipt_sha256"], "a" * 64)
        historical.assert_called_once()
        self.assertEqual(readback.call_args.kwargs["lineage_now"], 150)
        publish.assert_called_once()

    def test_recover_local_state_maps_only_exact_start_to_not_committed(self):
        with self.assertRaisesRegex(rehearsal.RehearsalError, "preparation_not_committed"):
            self._recover("START")

    def test_recover_local_state_denies_partial_and_failed_probe_as_ambiguous(self):
        for state in ("AMBIGUOUS", "FAILED_PROBE"):
            with self.subTest(state=state):
                with self.assertRaisesRegex(rehearsal.RehearsalError, "preparation_recovery_ambiguous"):
                    self._recover(state)

    def test_preparation_readback_returns_ambiguous_for_probe_failure_and_preserves_lineage_denial(self):
        args = types.SimpleNamespace(service_file="service.conf", service_name="g035-local",
                                     container="clone", docker="docker")
        reference = types.SimpleNamespace(
            ledger_prefix_sha256="a" * 64, full_catalog_sha256="b" * 64,
            full_data_sha256="c" * 64, absent_catalog_sha256="d" * 64,
        )
        with patch.object(rehearsal, "_connect_service", side_effect=RuntimeError("probe failed")):
            self.assertEqual(
                rehearsal._preparation_readback(args, Path("."), {}, reference)["classifier_state"],
                "AMBIGUOUS",
            )
        with patch.object(rehearsal, "_connect_service", side_effect=rehearsal.RehearsalError("lineage_denial")):
            with self.assertRaisesRegex(rehearsal.RehearsalError, "lineage_denial"):
                rehearsal._preparation_readback(args, Path("."), {}, reference)

class ReplayTerminalContractTests(unittest.TestCase):
    def _body(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        terminal = {"terminal_rows": rehearsal.executor._TERMINAL_ROWS, "ledger": "2" * 64,
                    "catalog": "3" * 64, "acl": "4" * 64, "data": "0" * 64,
                    "terminal_spec": "5" * 64}
        reference = types.SimpleNamespace(
            receipt_sha256="c" * 64, target_fingerprint="d" * 64,
            ledger_prefix_sha256="e" * 64, full_catalog_sha256="f" * 64,
            full_data_sha256="0" * 64, absent_catalog_sha256="1" * 64,
            terminal_rows=terminal["terminal_rows"], terminal_ledger_root=terminal["ledger"],
            terminal_catalog_root=terminal["catalog"], terminal_acl_root=terminal["acl"],
            terminal_data_root=terminal["data"], terminal_spec_root=terminal["terminal_spec"],
            terminal_tuple_sha256=rehearsal._sha(rehearsal._canonical(terminal)),
        )
        body = {
            "schema": "g040-local-branch-replay-v3", "issued_at": 100, "expires_at": 200,
            "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "target_fingerprint": reference.target_fingerprint, "reference_receipt_sha256": reference.receipt_sha256,
            "hosted_observation_receipt_sha256": "6" * 64, "clone_binding_receipt_sha256": "7" * 64,
            "clone_observation_receipt_sha256": "8" * 64, "clone_identity": "9" * 64,
            "clone_nonce": "terminal-contract-nonce", "live_identity_sha256": "a" * 64,
            "container_id_sha256": "b" * 64, "endpoint_sha256": "c" * 64,
            "prefix_classification": "FULL_ESCAPED", "selected_branch": "FULL_ESCAPED",
            "starting_roots": {"ledger": "e" * 64, "catalog": "f" * 64, "data": "0" * 64},
            "source_plan_sha256": "d" * 64, "replay_plan_sha256": "e" * 64,
            "terminal_tuple_sha256": reference.terminal_tuple_sha256,
            "replay_intent_receipt_sha256": "f" * 64,
            "terminal_readback_sha256": rehearsal._sha(rehearsal._canonical(terminal)),
            "terminal_rows": terminal["terminal_rows"], "terminal_ledger_root": terminal["ledger"],
            "terminal_catalog_root": terminal["catalog"], "terminal_acl_root": terminal["acl"],
            "terminal_data_root": terminal["data"], "terminal_spec_root": terminal["terminal_spec"],
        }
        body["intent_body_sha256"] = rehearsal._intent_body_sha256({
            **{key: value for key, value in body.items() if key not in {
                "replay_intent_receipt_sha256", "terminal_readback_sha256"}},
            "schema": "g040-local-branch-replay-intent-v2",
        })
        return body, source, reference

    def _reject(self, mutation):
        body, source, reference = self._body()
        with self.assertRaisesRegex(rehearsal.RehearsalError, "replay_comparison"):
            rehearsal._validated_replay({**body, **mutation}, source=source, reference=reference,
                hosted=types.SimpleNamespace(status="FULL_ESCAPED"), hosted_receipt="6" * 64, now=150)

    def test_rejects_list_terminal_rows(self): self._reject({"terminal_rows": []})
    def test_rejects_terminal_row_drift(self): self._reject({"terminal_rows": 39})
    def test_rejects_terminal_data_drift(self): self._reject({"terminal_data_root": "f" * 64})
    def test_rejects_terminal_spec_drift(self): self._reject({"terminal_spec_root": "f" * 64})
    def test_rejects_readback_hash_drift(self): self._reject({"terminal_readback_sha256": "f" * 64})
    def test_rejects_mutation_evidence_in_intent(self):
        self._reject({"expected_terminal": {"ledger": "f" * 64}})
    def test_rejects_start_root_extra_key(self):
        body, *_ = self._body(); body["starting_roots"]["acl"] = "f" * 64
        self._reject({"starting_roots": body["starting_roots"]})
    def test_rejects_v1_terminal_receipt(self): self._reject({"schema": "g040-local-branch-replay-v1"})
class PreparationLockScopeTests(unittest.TestCase):
    def test_full_escaped_reverse_does_not_lock_not_yet_created_terminal_relations(self):
        source = inspect.getsource(rehearsal.prepare_local_state)
        self.assertIn("for sql in executor._LOCK_SQL:", source)
        self.assertNotIn("executor._LOCK_SQL + executor._DATA_LOCK_SQL", source)


if __name__ == "__main__":
    unittest.main()
