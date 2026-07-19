from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g040_clone_rehearsal as rehearsal
import g040_reverse_00400 as reverse


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
        if "pg_control_system" in self.last:
            return {"system_identifier": "74234234234", "database_oid": "16384", "database_name": "g035_local", "server_version": "17.6", "server_version_num": 170006}
        if self.last == rehearsal.DATA_PROBE:
            return {"classes_count": 10, "exact_seed_count": 10, "seed_rows_exact": True, "class_source_count": 0, "legal_hold_count": 0, "work_item_count": 0, "retained_record_count": 0, "run_count": 0, "run_item_count": 0, "runtime_tables_empty": True, "seed_projection_sha256": "e" * 64, "data_shape_sha256": "d" * 64}
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
        self.info = type("Info", (), {"host": "127.0.0.1", "port": 55401})()
    def cursor(self): return self.cursor_value
    def rollback(self): self.rollback_count += 1
    def close(self): pass


class Item:
    version = "20260712000400"
    name = "g010_retention_separation"


class Manifest:
    migrations = [None] * 16 + [Item()]


class CloneRehearsalTests(unittest.TestCase):
    def service(self, root: Path, *, host="127.0.0.1", db="g035_local") -> Path:
        path = root / "service.conf"
        path.write_text(f"[g035-local]\nhost={host}\nport=55401\ndbname={db}\nsslmode=disable\napplication_name=g035-local-clone\npassword=never-print\n")
        return path
    def test_live_identity_uses_a_real_cursor(self):
        connection = FakeConnection()
        identity = rehearsal._live_identity(connection)
        self.assertEqual(identity["server_version_num"], 170006)
        self.assertIn("pg_control_system", connection.cursor_value.last)

    def test_service_schema_exact_image_and_secret_safe_cli(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); service = self.service(root)
            self.assertEqual(rehearsal.parse_local_service(service)["port"], 55401)
            with self.assertRaises(rehearsal.RehearsalError): rehearsal.parse_local_service(self.service(root, host="localhost"))
            with self.assertRaises(rehearsal.RehearsalError): rehearsal.parse_local_service(self.service(root, db="postgres"))
            (root / "unknown.conf").write_text(
                "[g035-local]\nhost=127.0.0.1\nhostaddr=127.0.0.1\nport=55401\ndbname=g035_local\n"
                "sslmode=disable\napplication_name=g035-local-clone\npassword=never-print\n"
            )
            with self.assertRaises(rehearsal.RehearsalError):
                rehearsal.parse_local_service(root / "unknown.conf")
            admitted = rehearsal.admit_image("supabase/postgres:17.6.1.147", {"server_version_num": 170006, "extensions": ["pg_trgm", "uuid-ossp", "btree_gin", "vector", "pgcrypto"], "roles": ["postgres", "supabase_admin"]})
            self.assertTrue(admitted["extensions_admitted"])
            with self.assertRaises(rehearsal.RehearsalError): rehearsal.admit_image("postgres:17.6", {"server_version_num": 170006, "extensions": [], "roles": []})

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
    def test_observation_derives_absent_then_recreates_and_rolls_back_to_full(self):
        connection = FakeConnection()
        writes = {}
        with patch.object(rehearsal, "_binding", return_value={}), \
                patch.object(rehearsal, "_source"), \
                patch.object(rehearsal, "validate_sources", return_value=Manifest()), \
                patch.object(rehearsal, "vectors", return_value=((), ("SELECT 1",))), \
                patch.object(rehearsal, "_connect_service", return_value=(connection, {"port": 55401})), \
                patch.object(rehearsal, "_assert_observation_binding"), \
                patch.object(rehearsal, "_observation", side_effect=lambda binding, state, *values: {"state": state}), \
                patch.object(rehearsal, "_write", side_effect=lambda path, value: writes.setdefault(str(path), value)):
            rehearsal.observe_reference(
                repository_root=".",
                binding_path="binding.json",
                service_file="service.conf",
                service_name="g035-local",
                source_commit="a" * 40,
                absent_output="absent.json",
                full_output="full.json",
                container="clone",
            )
        self.assertGreaterEqual(connection.rollback_count, 4)
        self.assertEqual(writes["absent.json"]["state"], "absent")
        self.assertEqual(writes["full.json"]["state"], "full")
        statements = connection.cursor_value.statements
        self.assertLess(statements.index(rehearsal._REFERENCE_CUSTODY_QUERY), statements.index("GRANT CREATE ON DATABASE g035_local TO postgres"))
        self.assertLess(statements.index("GRANT CREATE ON DATABASE g035_local TO postgres"), statements.index("GRANT CREATE ON SCHEMA public TO postgres"))
        self.assertLess(statements.index("GRANT CREATE ON SCHEMA public TO postgres"), statements.index("SET LOCAL ROLE postgres"))
        custody_queries = [index for index, statement in enumerate(statements) if statement == rehearsal._REFERENCE_CUSTODY_QUERY]
        self.assertEqual(len(custody_queries), 2)
        self.assertLess(statements.index("SET LOCAL ROLE postgres"), custody_queries[1])
        mutation_search_path = statements.index(
            'SET LOCAL search_path = "$user", public, auth, extensions',
            statements.index("SET LOCAL ROLE postgres"),
        )
        self.assertLess(custody_queries[1], mutation_search_path)
        self.assertLess(statements.index("SET LOCAL ROLE postgres"), mutation_search_path)
        self.assertLess(mutation_search_path, statements.index(rehearsal.REVERSE_VECTOR[0]))
        read_only_search_paths = [
            index for index, statement in enumerate(statements)
            if statement == "SET LOCAL search_path = pg_catalog"
        ]
        self.assertEqual(len(read_only_search_paths), 2)
        self.assertTrue(all(index < statements.index("SET LOCAL ROLE postgres") or index > statements.index("SELECT 1") for index in read_only_search_paths))
        self.assertLess(statements.index(rehearsal.REVERSE_VECTOR[0]), statements.index("SELECT 1"))
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
    def test_reference_revalidation_preserves_exact_v2_derivation_fields(self):
        observation = {
            "clone_nonce": "clone-lineage-nonce",
            "live_identity_sha256": "0" * 64,
            "container_id_sha256": "1" * 64,
            "image_id_sha256": "2" * 64,
            "image_digest_sha256": "3" * 64,
            "endpoint_sha256": "4" * 64,
            "g035_restore_receipt_sha256": "5" * 64,
            "g035_capture_receipt_sha256": "6" * 64,
            "restored_archive_sha256": "7" * 64,
            "capture_receipt_bytes_sha256": "8" * 64,
            "restore_receipt_bytes_sha256": "9" * 64,
            "archive_bytes": "a" * 64,
            "g035_manifest_sha256": "b" * 64,
            "source_sha256": "c" * 64,
            "lineage_attestation_path": "attestation",
            "lineage_signature_path": "signature",
            "lineage_attestation_sha256": "d" * 64,
            "lineage_signature_sha256": "e" * 64,
            "derivation_mode": rehearsal.DERIVATION_MODE,
            "reverse_vector_sha256": rehearsal.REVERSE_VECTOR_SHA256,
        }
        hashes = {
            "lineage_attestation_sha256": observation["lineage_attestation_sha256"],
            "lineage_signature_sha256": observation["lineage_signature_sha256"],
        }
        with patch.object(rehearsal, "_custody_bytes", return_value=b"{}"), \
                patch.object(rehearsal, "_load_bytes", return_value={"issued_at_unix": 1, "expires_at_unix": 2}), \
                patch.object(rehearsal, "_verify_lineage_attestation", return_value=hashes):
            projected = rehearsal._revalidate_observation_lineage(observation, ".")
        self.assertEqual(projected["derivation_mode"], rehearsal.DERIVATION_MODE)
        self.assertEqual(projected["reverse_vector_sha256"], rehearsal.REVERSE_VECTOR_SHA256)

    def test_build_reference_rejects_missing_or_wrong_v2_derivation_before_signing(self):
        observation = {
            "clone_nonce": "clone-lineage-nonce",
            "live_identity_sha256": "0" * 64,
            "container_id_sha256": "1" * 64,
            "image_id_sha256": "2" * 64,
            "image_digest_sha256": "3" * 64,
            "endpoint_sha256": "4" * 64,
            "g035_restore_receipt_sha256": "5" * 64,
            "g035_capture_receipt_sha256": "6" * 64,
            "restored_archive_sha256": "7" * 64,
            "capture_receipt_bytes_sha256": "8" * 64,
            "restore_receipt_bytes_sha256": "9" * 64,
            "archive_bytes": "a" * 64,
            "g035_manifest_sha256": "b" * 64,
            "source_sha256": "c" * 64,
            "lineage_attestation_path": "attestation",
            "lineage_signature_path": "signature",
            "lineage_attestation_sha256": "d" * 64,
            "lineage_signature_sha256": "e" * 64,
        }
        for invalid in (
            observation,
            {**observation, "derivation_mode": "wrong-derivation-mode", "reverse_vector_sha256": rehearsal.REVERSE_VECTOR_SHA256},
            {**observation, "derivation_mode": rehearsal.DERIVATION_MODE, "reverse_vector_sha256": "f" * 64},
        ):
            with self.subTest(invalid=invalid):
                with patch.object(rehearsal, "_load", return_value=invalid), \
                        patch.object(rehearsal, "sign_reference") as sign_reference:
                    with self.assertRaisesRegex(rehearsal.RehearsalError, "reference_input"):
                        rehearsal.build_reference(
                            source=types.SimpleNamespace(final_commit="a" * 40, runtime_source_root="0" * 64),
                            target_fingerprint="f" * 64,
                            nonce="reference-nonce-01",
                            first_absent="first-absent",
                            first_full="first-full",
                            second_absent="second-absent",
                            second_full="second-full",
                            private_key="private-key",
                            output="reference.json",
                            repository_root=".",
                        )
                    sign_reference.assert_not_called()
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
        raw = b"[g035-local]\nhost=127.0.0.1\nport=55401\ndbname=g035_local\nsslmode=disable\napplication_name=g035-local-clone\npassword=never-print\n"
        psycopg = types.ModuleType("psycopg")
        rows = types.ModuleType("psycopg.rows"); rows.dict_row = object()
        psycopg.rows = rows
        seen = []
        for after, connection in (
            ((service_path, raw, (1, 2)), Connection("127.0.0.1", 55401)),
            ((service_path, raw, (1, 1)), Connection("127.0.0.2", 55401)),
        ):
            def connect(**kwargs):
                seen.append((dict(kwargs), rehearsal.os.environ.get("PGSERVICEFILE")))
                return connection
            psycopg.connect = connect
            with patch.dict(sys.modules, {"psycopg": psycopg, "psycopg.rows": rows}), patch.object(rehearsal, "_service_custody", side_effect=[(service_path, raw, (1, 1)), after]), patch.dict(rehearsal.os.environ, {"PGSERVICEFILE": "original-service-file"}):
                with self.assertRaises(rehearsal.RehearsalError):
                    rehearsal._connect_service(service_path, "g035-local", readonly=True, repository_root=Path("C:/repository"))
                self.assertEqual(rehearsal.os.environ["PGSERVICEFILE"], "original-service-file")
        self.assertTrue(seen)
        self.assertTrue(all("servicefile" not in kwargs and service == str(service_path) for kwargs, service in seen))
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
    def test_docker_endpoint_requires_one_exact_numeric_loopback_binding(self):
        container = {
            "Id": "a" * 64,
            "Image": "sha256:" + "b" * 64,
            "Config": {"Image": rehearsal._IMAGE, "Labels": {rehearsal._LABEL: "true"}},
            "HostConfig": {"NetworkMode": "bridge"},
            "NetworkSettings": {
                "Networks": {"rehearsal": {}},
                "Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}]},
            },
        }
        image = [{"RepoDigests": ["supabase/postgres@sha256:" + "c" * 64]}]

        def docker_run(command, **kwargs):
            raw = [container] if command[1:3] == ["inspect", "--type"] else image
            return subprocess.CompletedProcess(command, 0, json.dumps(raw).encode())

        with patch.object(rehearsal.subprocess, "run", side_effect=docker_run):
            proof = rehearsal._docker_clone_proof("clone-a-container", 55401)
        self.assertEqual(proof["endpoint_sha256"], rehearsal._sha(rehearsal._canonical({"host": "127.0.0.1", "port": 55401})))

        for ports, networks in (
            ({"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55402"}]}, {"rehearsal": {}}),
            ({"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}, {"HostIp": "127.0.0.1", "HostPort": "55401"}]}, {"rehearsal": {}}),
            ({"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "55401"}]}, {"ssh-tunnel": {}}),
        ):
            with self.subTest(ports=ports, networks=networks):
                container["NetworkSettings"]["Ports"] = ports
                container["NetworkSettings"]["Networks"] = networks
                with patch.object(rehearsal.subprocess, "run", side_effect=docker_run):
                    with self.assertRaises(rehearsal.RehearsalError):
                        rehearsal._docker_clone_proof("clone-a-container", 55401)
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

    def test_branch_adapters_bind_controller_to_loaded_observation_receipt(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            service = self.service(root)
            args = rehearsal.SimpleNamespace(
                repository_root=str(root), source_commit="a" * 40, service_file=str(service),
                service_name="g035-local", selected_branch="UNAPPLIED",
                observation_receipt_sha256="untrusted-cli-hash",
            )
            source = rehearsal.SourceBinding("a" * 40, "b" * 64)
            reference = object()
            observation = type("Observation", (), {"status": "UNAPPLIED"})()
            prepared = {"schema": rehearsal.controller.SCHEMA, "bindings_sha256": "c" * 64}
            applied = {"prepared_receipt_sha256": "d" * 64, "final_receipt_sha256": "e" * 64}
            with patch.object(rehearsal, "_source", return_value=source), \
                    patch.object(rehearsal.controller, "_reference", return_value=reference), \
                    patch.object(rehearsal.controller, "_load_observation", return_value=(observation, "f" * 64)) as load, \
                    patch.object(rehearsal.controller, "prepare", return_value=prepared) as prepare, \
                    patch.object(rehearsal.controller, "execute", return_value=applied) as execute:
                self.assertEqual(rehearsal.prepare_branch(args)["bindings_sha256"], "c" * 64)
                self.assertEqual(prepare.call_args.args[0].observation_receipt_sha256, "f" * 64)
                self.assertEqual(rehearsal.apply_branch(args)["final_receipt_sha256"], "e" * 64)
                self.assertEqual(execute.call_args.args[0].observation_receipt_sha256, "f" * 64)
                self.assertEqual(load.call_count, 2)

    def test_terminal_readback_binds_verified_loaded_receipt(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            service = self.service(root)
            args = rehearsal.SimpleNamespace(
                repository_root=str(root), source_commit="a" * 40, service_file=str(service),
                service_name="g035-local", selected_branch="UNAPPLIED",
                observation_receipt_sha256="untrusted-cli-hash",
            )
            source = rehearsal.SourceBinding("a" * 40, "b" * 64)
            reference = object()
            observation = type("Observation", (), {"status": "UNAPPLIED"})()
            custody = object()
            manifest = object()
            bindings = {"selected_branch": "execute-00400-then-suffix"}
            terminal = {
                "terminal_rows": 40, "ledger_root": "1" * 64, "catalog_root": "2" * 64,
                "acl_root": "3" * 64, "data_root": "4" * 64, "terminal_spec_root": "5" * 64,
            }
            with patch.object(rehearsal, "_source", return_value=source), \
                    patch.object(rehearsal.controller, "_reference", return_value=reference), \
                    patch.object(rehearsal.controller, "_load_observation", return_value=(observation, "6" * 64)) as load, \
                    patch.object(rehearsal.controller, "_custody", return_value=custody), \
                    patch.object(rehearsal, "validate_sources", return_value=manifest), \
                    patch.object(rehearsal.controller, "_bindings", return_value=bindings) as bind, \
                    patch.object(rehearsal.controller, "_authorization", return_value=object()), \
                    patch.object(rehearsal.controller, "_final_readback", return_value=terminal):
                receipt = rehearsal.terminal_readback(args)
            self.assertEqual(receipt["data_sha256"], "4" * 64)
            self.assertEqual(load.call_count, 1)
            self.assertEqual(bind.call_args.args[-1], "6" * 64)

    def test_aggregate_custody_uses_controller_receipt_signing_boundary(self):
        source = rehearsal.SourceBinding("a" * 40, "b" * 64)
        reference = type("Reference", (), {"receipt_sha256": "c" * 64, "target_fingerprint": "d" * 64})()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            output = root.parent / "aggregate-custody.json"
            args = rehearsal._parser().parse_args([
                "aggregate-custody", "--repository-root", str(root), "--source-commit", source.final_commit,
                "--target-fingerprint", reference.target_fingerprint, "--reference", str(root.parent / "reference.json"),
                "--freeze-root", "e" * 64, "--backup-receipt-sha256", "f" * 64,
                "--capture-receipt-sha256", "0" * 64, "--clone-rehearsal-receipt-sha256", "1" * 64,
                "--inventory-root", "2" * 64, "--target-ledger-root", "3" * 64,
                "--target-catalog-root", "4" * 64, "--target-data-root", "5" * 64,
                "--output", str(output),
            ])
            written = {}
            def signed(path, document):
                written["path"], written["document"] = path, document
                return "6" * 64
            with patch.object(rehearsal, "_source", return_value=source), patch.object(rehearsal.controller, "_reference", return_value=reference), patch.object(rehearsal.controller, "_outside", side_effect=lambda path, root, fresh: Path(path)), patch.object(rehearsal.controller, "_write_signed", side_effect=signed) as receipt_signer:
                result = rehearsal.build_aggregate_custody(args)
            self.assertEqual(result["receipt_sha256"], "6" * 64)
            self.assertEqual(receipt_signer.call_count, 1)
            self.assertIs(receipt_signer.call_args.args[0], written["path"])
            self.assertEqual(set(written["document"]), {"schema", "kind", "body"})
            self.assertEqual(written["document"]["schema"], rehearsal.controller.SCHEMA)
            self.assertEqual(written["document"]["kind"], "aggregate-custody")
            self.assertEqual(set(written["document"]["body"]), {
                "issued_at", "expires_at", "final_recovery_commit", "runtime_source_root",
                "reference_receipt_sha256", "target_fingerprint", "freeze_root",
                "backup_receipt_sha256", "capture_receipt_sha256", "clone_rehearsal_receipt_sha256",
                "inventory_root", "target_ledger_root", "target_catalog_root", "target_data_root",
            })

    def test_bind_restore_cli_serializes_immutable_receipt(self):
        receipt = types.MappingProxyType({
            "schema": "g040-clone-restore-binding-v4",
            "binding_receipt_sha256": "a" * 64,
        })
        with patch.object(rehearsal, "bind_restore", return_value=receipt):
            self.assertEqual(rehearsal.main([
                "bind-restore",
                "--service-file", "service.conf",
                "--clone-nonce", "nonce",
                "--capture-receipt", "capture.json",
                "--restore-receipt", "restore.json",
                "--encrypted-dump", "dump.enc",
                "--lineage-attestation", "lineage.json",
                "--lineage-signature", "lineage.sig",
                "--repository-root", ".",
                "--container", "clone",
                "--output", "binding.json",
            ]), 0)
    def test_terminal_and_aggregate_cli_paths_use_operational_receipts(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            service = self.service(root)
            output = root / "terminal.json"
            terminal = {
                "schema": "g040-clone-terminal-v1", "selected_branch": "UNAPPLIED",
                "terminal_rows": 40, "ledger_sha256": "1" * 64, "catalog_sha256": "2" * 64,
                "acl_sha256": "3" * 64, "data_sha256": "4" * 64, "terminal_spec_root": "5" * 64,
            }
            with patch.object(rehearsal, "terminal_readback", return_value=terminal):
                self.assertEqual(rehearsal.main([
                    "terminal-readback", "--repository-root", str(root), "--source-commit", "a" * 40,
                    "--service-file", str(service), "--target-fingerprint", "b" * 64,
                    "--reference", str(root / "reference.json"), "--observation", str(root / "observation.json"),
                    "--observation-receipt-sha256", "c" * 64, "--custody", str(root / "custody.json"),
                    "--authorization", str(root / "authorization.json"), "--authorization-signature", str(root / "authorization.sig"),
                    "--selected-branch", "UNAPPLIED", "--output", str(output),
                ]), 0)
            self.assertEqual(rehearsal._load(output)["data_sha256"], "4" * 64)
            aggregate_output = root.parent / "aggregate.json"
            with patch.object(rehearsal, "build_aggregate_custody", return_value={"schema": rehearsal.controller.SCHEMA, "receipt_sha256": "6" * 64}):
                self.assertEqual(rehearsal.main([
                    "aggregate-custody", "--repository-root", str(root), "--source-commit", "a" * 40,
                    "--target-fingerprint", "b" * 64, "--reference", str(root.parent / "reference.json"),
                    "--freeze-root", "1" * 64, "--backup-receipt-sha256", "2" * 64,
                    "--capture-receipt-sha256", "3" * 64, "--clone-rehearsal-receipt-sha256", "4" * 64,
                    "--inventory-root", "5" * 64, "--target-ledger-root", "6" * 64,
                    "--target-catalog-root", "7" * 64, "--target-data-root", "8" * 64,
                    "--output", str(aggregate_output),
                ]), 0)
            custody = type("Custody", (), {"target_fingerprint": "b" * 64})()
            with patch.object(rehearsal, "_source", return_value=rehearsal.SourceBinding("a" * 40, "c" * 64)), patch.object(rehearsal.controller, "_reference", return_value=type("Reference", (), {"receipt_sha256": "d" * 64, "target_fingerprint": "b" * 64})()), patch.object(rehearsal.controller, "_custody", return_value=custody) as verify:
                self.assertEqual(rehearsal.main([
                    "verify-aggregate-custody", "--repository-root", str(root), "--source-commit", "a" * 40,
                    "--target-fingerprint", "b" * 64, "--reference", str(root.parent / "reference.json"),
                    "--custody", str(root.parent / "aggregate.json"),
                ]), 0)
            verify.assert_called_once()
    def test_terminal_equality_both_branches_and_bounds(self):
        for branch in ("UNAPPLIED", "FULL_ESCAPED"):
            receipt = {"schema": "g040-clone-terminal-v1", "selected_branch": branch, "terminal_rows": 40, "ledger_sha256": "1" * 64, "catalog_sha256": "2" * 64, "acl_sha256": "3" * 64, "data_sha256": "4" * 64, "terminal_spec_root": "5" * 64}
            self.assertEqual(rehearsal.compare_terminal(receipt, dict(receipt))["terminal_rows"], 40)
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); (root / "ok.json").write_text("{}")
            rehearsal.index_artifacts(root, ["ok.json"], root / "index.json")
            with self.assertRaises(rehearsal.RehearsalError): rehearsal.index_artifacts(root, ["../ok.json"], root / "bad.json")

    def test_label_only_cleanup_uses_safe_argv(self):
        calls = []
        def run(argv, **kwargs):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, "abc\n", "")
        with patch.object(rehearsal.subprocess, "run", side_effect=run):
            result = rehearsal.cleanup("clone-run-000000", "docker")
        self.assertEqual(result["removed"], {"container": 1, "volume": 1, "network": 1})
        self.assertTrue(all("--filter" in call or call[:3] in (["docker", "rm", "-f"], ["docker", "volume", "rm"], ["docker", "network", "rm"]) for call in calls))
        with self.assertRaises(rehearsal.RehearsalError): rehearsal.cleanup("short", "docker")


if __name__ == "__main__":
    unittest.main()
