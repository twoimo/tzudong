from __future__ import annotations

import importlib.util
import copy
import json
import re
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.supabase.scripts import local_replay_contract


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SCANNER_PATH = REPOSITORY_ROOT / "backend/supabase/scripts/local-function-runtime-scan.py"


def load_scanner():
    spec = importlib.util.spec_from_file_location("local_function_runtime_scan_contract", SCANNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("scanner module unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LocalFunctionRuntimeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scanner = load_scanner()

    def _migration_admission_fixture(self):
        """Source-bound synthetic snapshot; no SQL or database execution."""
        scanner = self.scanner
        migrate = scanner._load_local_contract_module("local-migrate.py", "scanner_replay_test_authority")
        manifest = migrate.verify_manifest()
        records = migrate._expected_ledger_records(manifest)
        proofs = {}
        for path in local_replay_contract.supported_sources():
            receipt = copy.deepcopy(local_replay_contract._CONTRACTS[path]["receipt"])
            proofs[path] = {
                **local_replay_contract.plan(path),
                "receipt": receipt,
                "receipt_sha256": local_replay_contract.digest(local_replay_contract.canonical(receipt)),
            }
        fields = ("path", "ordinal", "sha256", "byteLength", "transactionClass", "status", "readbackSha256")
        ledger = [{**dict(zip(fields, row[1:])), "replayProof": proofs.get(row[1])} for row in records]
        bindings = {
            "manifestSha256": migrate.manifest_digest(manifest),
            "sourceChainSha256": manifest["source"]["chainSha256"],
            "prerequisiteSha256": "a" * 64,
            "platformBootstrapEvidenceSha256": "b" * 64,
            "seedSourceSha256": "c" * 64,
            "files": [{key: row[key] for key in fields[:5]} for row in ledger],
        }
        sequence = [{
            "marker": marker,
            "ordinal": ordinal,
            "evidenceSha256": evidence,
            "sourceManifestSha256": bindings["manifestSha256"],
            "closureBindingSha256": "",
        } for ordinal, (marker, evidence) in enumerate((
            ("prerequisite", bindings["prerequisiteSha256"]),
            ("migration", bindings["sourceChainSha256"]),
        ), 1)]
        return {"ledger": ledger, "sequence": sequence}, bindings

    def test_migration_admission_sql_projects_exact_authority_fields(self):
        sql = self.scanner._migration_admission_sql({}).decode()
        ledger_sql = sql.split("'ledger',", 1)[1].split("'sequence',", 1)[0]
        projected = dict(re.findall(r"'([A-Za-z0-9]+)',\s*([a-z0-9_]+)", ledger_sql))
        self.assertEqual(projected, {
            "path": "migration_id", "ordinal": "ordinal", "sha256": "source_sha256",
            "byteLength": "source_byte_length", "transactionClass": "transaction_class",
            "status": "status", "readbackSha256": "readback_sha256", "replayProof": "replay_proof",
        })
        self.assertIn("REPEATABLE READ READ ONLY", sql)

    def test_admission_accepts_exact_current_source_replay_dispositions(self):
        snapshot, bindings = self._migration_admission_fixture()
        self.assertEqual(len(snapshot["ledger"]), 96)
        self.assertEqual([row["status"] for row in snapshot["ledger"] if row["replayProof"]],
                         ["verified-existing", "verified-existing", "legacy-contract-preserved"])
        self.assertTrue(all(row["replayProof"] is None for row in snapshot["ledger"] if row["status"] == "applied"))
        self.scanner._validate_database_admission(snapshot, bindings, None)

    def test_admission_delegates_full_snapshot_to_source_authority(self):
        snapshot, bindings = self._migration_admission_fixture()
        with patch.object(self.scanner, "_load_local_contract_module") as loader:
            self.scanner._validate_database_admission(snapshot, bindings, None)
            loader.return_value._validate_ledger_snapshot.assert_called_once_with(snapshot["ledger"])
            loader.return_value._validate_ledger_snapshot.side_effect = ValueError("private diagnostic")
            with self.assertRaisesRegex(self.scanner.RuntimeScanError, "^local_migration_binding$"):
                self.scanner._validate_database_admission(snapshot, bindings, None)

    def test_admission_rejects_unproved_statuses_and_ledger_field_drift(self):
        snapshot, bindings = self._migration_admission_fixture()
        recovery = next(index for index, row in enumerate(snapshot["ledger"]) if row["replayProof"])
        owner = next(index for index, row in enumerate(snapshot["ledger"]) if row["status"] == "legacy-contract-preserved")
        for index, field, value in (
            (0, "status", "verified-existing"), (0, "status", "new-status"),
            (0, "replayProof", snapshot["ledger"][recovery]["replayProof"]),
            (0, "readbackSha256", "0" * 64), (0, "ordinal", True),
            (0, "sha256", "0" * 64), (0, "byteLength", 0),
            (0, "transactionClass", "self_committing"), (0, "extra", True),
            (recovery, "replayProof", None), (recovery, "status", "applied"),
            (owner, "status", "applied"),
            (owner, "replayProof", snapshot["ledger"][recovery]["replayProof"]),
        ):
            bad = copy.deepcopy(snapshot)
            bad["ledger"][index][field] = value
            with self.subTest(index=index, field=field):
                with self.assertRaisesRegex(self.scanner.RuntimeScanError, "^local_migration_binding$"):
                    self.scanner._validate_database_admission(bad, bindings, None)
        bad = copy.deepcopy(snapshot)
        del bad["ledger"][0]["replayProof"]
        with self.assertRaisesRegex(self.scanner.RuntimeScanError, "^local_migration_binding$"):
            self.scanner._validate_database_admission(bad, bindings, None)

    def test_admission_replay_does_not_relax_source_or_sequence_bindings(self):
        snapshot, bindings = self._migration_admission_fixture()
        stale = copy.deepcopy(bindings)
        stale["files"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(self.scanner.RuntimeScanError, "^local_migration_binding$"):
            self.scanner._validate_database_admission(snapshot, stale, None)
        for field in ("evidenceSha256", "sourceManifestSha256", "closureBindingSha256"):
            bad = copy.deepcopy(snapshot)
            bad["sequence"][0][field] = "0" * 64
            with self.subTest(field=field):
                with self.assertRaisesRegex(self.scanner.RuntimeScanError, "^local_sequence_binding$"):
                    self.scanner._validate_database_admission(bad, bindings, None)

    def test_drop_if_exists_lifecycle_uses_function_name(self):
        scanner = self.scanner
        with tempfile.TemporaryDirectory() as directory:
            sql_path = Path(directory) / "lifecycle.sql"
            sql_path.write_text(
                "DROP FUNCTION IF EXISTS public.legacy(text);\n"
                "ALTER FUNCTION public.legacy(text) RENAME TO legacy_renamed;\n",
                encoding="utf-8",
            )
            original_documents = scanner._source_documents
            scanner._source_documents = lambda: [sql_path]
            try:
                events = scanner._source_function_lifecycle()
            finally:
                scanner._source_documents = original_documents
        self.assertEqual(events[0]["action"], "drop")
        self.assertEqual(events[0]["key"], ("public", "legacy", "text"))
        self.assertEqual(events[1]["action"], "move")
        self.assertEqual(events[1]["newKey"], ("public", "legacy_renamed", "text"))

    def test_candidate_smoke_binds_every_argument_with_explicit_types(self):
        sql = self.scanner._smoke_candidate_blocks(
            [
                {
                    "schema": "public",
                    "proname": "sample_rpc",
                    "identityArgumentsNormalized": "uuid, jsonb",
                    "signature": "public.sample_rpc(uuid, jsonb)",
                }
            ]
        )
        self.assertIn("SELECT \"public\".\"sample_rpc\"(NULL::uuid, NULL::jsonb)", sql)
        self.assertNotIn("'0A000'", sql)
        self.assertNotIn("expected_sqlstate_", sql)
        self.assertIn("sqlstate_", sql)
        trigger_sql = self.scanner._smoke_candidate_blocks(
            [
                {
                    "schema": "public",
                    "proname": "set_documents_updated_at",
                    "identityArgumentsNormalized": "",
                    "signature": "public.set_documents_updated_at()",
                }
            ]
        )
        self.assertIn("'0A000'", trigger_sql)
        self.assertIn("expected_sqlstate_", trigger_sql)
        self.assertEqual(
            self.scanner.EXPECTED_CANDIDATE_SQLSTATES[
                ("public", "touch_admin_workflow_updated_at", "")
            ],
            ("0A000",),
        )

    def test_candidate_smoke_allows_privacy_incident_guard_outcomes(self):
        sql = self.scanner._smoke_candidate_blocks(
            [
                {
                    "schema": "public",
                    "proname": "preview_privacy_incident_transition",
                    "identityArgumentsNormalized": (
                        "uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid"
                    ),
                    "signature": "public.preview_privacy_incident_transition(...)",
                }
            ]
        )
        self.assertIn("'P0001'", sql)
        self.assertNotIn("'P0001', '42501'", sql)

    def test_docker_context_accepts_github_actions_root_socket_only(self):
        scanner = self.scanner
        socket_info = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o660, st_uid=0)
        admission_info = SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=0)
        selected = SimpleNamespace(returncode=0, stdout="default\n")
        inspected = SimpleNamespace(
            returncode=0,
            stdout=json.dumps([{
                "Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}},
            }]),
        )
        admission_path = Path("/run/tzudong-nightly-local-admission-123-2")
        admission_payload = b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"
        admission_read = SimpleNamespace(returncode=0, stdout=admission_payload)

        def admitted_lstat(path: Path):
            return socket_info if path == Path("/var/run/docker.sock") else admission_info

        with (
            patch.object(
                scanner.subprocess,
                "run",
                side_effect=(selected, inspected, admission_read),
            ),
            patch.object(scanner.Path, "lstat", autospec=True, side_effect=admitted_lstat),
            patch.object(scanner.os, "getuid", return_value=1000),
            patch.dict(scanner.os.environ, {
                "GITHUB_ACTIONS": "true",
                "CI": "true",
                "GITHUB_REPOSITORY": "twoimo/tzudong",
                "GITHUB_RUN_ID": "123",
                "GITHUB_RUN_ATTEMPT": "2",
                scanner.DOCKER_SOCKET_ADMISSION_ENV: str(admission_path),
            }, clear=False),
        ):
            scanner._assert_local_docker_context("docker")

        with (
            patch.object(scanner.subprocess, "run", side_effect=(selected, inspected)),
            patch.object(scanner.Path, "lstat", return_value=socket_info),
            patch.object(scanner.os, "getuid", return_value=1000),
            patch.dict(scanner.os.environ, {
                "GITHUB_ACTIONS": "true",
                "CI": "true",
                "GITHUB_REPOSITORY": "twoimo/tzudong",
                "GITHUB_RUN_ID": "123",
                "GITHUB_RUN_ATTEMPT": "2",
                scanner.DOCKER_SOCKET_ADMISSION_ENV: "",
            }, clear=False),
        ):
            with self.assertRaisesRegex(scanner.RuntimeScanError, "docker_context"):
                scanner._assert_local_docker_context("docker")

    def test_root_socket_admission_rejects_spoofed_file_contract(self):
        scanner = self.scanner
        environment = {
            "GITHUB_ACTIONS": "true",
            "CI": "true",
            "GITHUB_REPOSITORY": "twoimo/tzudong",
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "2",
            scanner.DOCKER_SOCKET_ADMISSION_ENV:
                "/run/tzudong-nightly-local-admission-123-2",
        }
        for info, payload in (
            (SimpleNamespace(st_mode=stat.S_IFLNK | 0o400, st_uid=0), b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"),
            (SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0), b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"),
            (SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=1000), b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"),
            (SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=0), b"repo=other/repo\nrun_id=123\nrun_attempt=2\n"),
        ):
            with self.subTest(mode=info.st_mode, owner=info.st_uid, payload=payload):
                with (
                    patch.dict(scanner.os.environ, environment, clear=True),
                    patch.object(scanner.Path, "lstat", return_value=info),
                    patch.object(
                        scanner.subprocess,
                        "run",
                        return_value=SimpleNamespace(returncode=0, stdout=payload),
                    ),
                ):
                    self.assertFalse(scanner._github_actions_root_socket_admission())

    def test_smoke_checks_external_effect_surface_in_runtime_catalog(self):
        sql = self.scanner._smoke_sql([])
        self.assertIn("pg_catalog.pg_extension", sql)
        self.assertIn("external_effect_surface_present", sql)
        self.assertIn("external_effect_blocked", sql)
        self.assertIn("SET LOCAL ROLE service_role", sql)
        self.assertIn("in_function_sqlstate_P0001", sql)

    def test_rescan_executes_g014_contracts_in_read_only_runtime_probe(self):
        sql = self.scanner._runtime_sql().decode("utf-8")
        self.assertIn("g014_contract AS MATERIALIZED", sql)
        self.assertEqual(
            sql.count("privacy_retention.assert_g014_definer_contract()"),
            1,
        )
        self.assertEqual(
            sql.count("privacy_retention.assert_g014_catalog_contract()"),
            1,
        )
        self.assertIn("CROSS JOIN g014_contract", sql)

    def test_search_path_parser_rejects_untrusted_tokens_before_patch_generation(self):
        scanner = self.scanner
        self.assertEqual(
            scanner._parse_trusted_search_path("'public', 'pg_catalog'"),
            ["public", "pg_catalog"],
        )
        with self.assertRaises(scanner.RuntimeScanError):
            scanner._parse_trusted_search_path("public, auth")
        with self.assertRaises(scanner.RuntimeScanError):
            scanner._parse_trusted_search_path("public, $user")

    def test_closure_candidates_preserve_explicit_empty_source_path(self):
        scanner = self.scanner
        base = {
            "name": "public.synthetic_extension_reader",
            "schema": "public",
            "proname": "synthetic_extension_reader",
            "args": "text",
            "identityArguments": "text",
            "signature": "public.synthetic_extension_reader(text)",
            "body": "BEGIN RETURN extensions.digest('x', 'sha256'); END",
            "_sourceOrder": (10_000, 0),
        }
        for explicit_path in ("''", '""'):
            with self.subTest(explicit_path=explicit_path):
                self.assertEqual(
                    scanner._candidate_functions([
                        {**base, "searchPath": explicit_path, "hasSearchPath": True}
                    ]),
                    [],
                )

        qualified = scanner._candidate_functions([
            {**base, "searchPath": "public", "hasSearchPath": True}
        ])
        self.assertEqual(len(qualified), 1)
        self.assertEqual(qualified[0]["reason"], "trusted_extension_omitted")

        missing = scanner._candidate_functions([
            {**base, "searchPath": None, "hasSearchPath": False}
        ])
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]["reason"], "missing_search_path")
        self.assertEqual(
            missing[0]["desiredSearchPath"],
            "public, extensions, pg_catalog",
        )

    def test_closure_patch_alters_only_a_runtime_missing_path(self):
        scanner = self.scanner
        candidate = {
            "name": "public.synthetic_missing_path",
            "schema": "public",
            "proname": "synthetic_missing_path",
            "identityArguments": "text",
            "identityArgumentsNormalized": "text",
            "signature": "public.synthetic_missing_path(text)",
            "desiredSearchPath": "public, extensions, pg_catalog",
            "reason": "missing_search_path",
        }
        sql = scanner._patch_sql("a" * 64, [candidate], "b" * 64)
        self.assertIn("IF target_path_count = 0 OR target_valid_path_count <> 1 THEN", sql)
        self.assertIn(
            "ELSIF target_path_count <> 1 THEN",
            sql,
        )
        self.assertIn("local_closure_runtime_path_invalid", sql)
        self.assertIn("local_closure_runtime_path_guard_invalid", sql)
        self.assertIn("'search_path=\"\"' ~*", sql)
        self.assertIn("'search_path=auth' ~*", sql)
        self.assertIn("duplicate_path_count <> 2", sql)
        self.assertIn(
            "PERFORM privacy_retention.assert_g014_definer_contract();",
            sql,
        )
        self.assertIn(
            "PERFORM privacy_retention.assert_g014_catalog_contract();",
            sql,
        )
        self.assertIn(
            "ALTER FUNCTION %s SET search_path TO public, extensions, pg_catalog",
            sql,
        )
        self.assertLess(
            sql.index("IF target_path_count = 0 OR target_valid_path_count <> 1 THEN"),
            sql.index("ALTER FUNCTION %s SET search_path TO"),
        )

    def test_frozen_source_closure_candidate_receipt_is_exact(self):
        candidates = self.scanner._candidate_functions(self.scanner._source_inventory())
        self.assertEqual(len(candidates), 48)
        target = [
            item for item in candidates
            if item["name"] == "public.approve_submission_item"
            and item["identityArgumentsNormalized"] == "uuid,uuid,jsonb"
        ]
        self.assertEqual(len(target), 1)
        self.assertEqual(target[0]["reason"], "trusted_extension_omitted")

    def test_runtime_validation_rejects_candidate_smoke_failures(self):
        scanner = self.scanner
        runtime = {
            "closureSmoke": {"status": "passed"},
            "unresolvedPathCount": 0,
            "ambiguousPathCount": 0,
            "candidateResolution": {
                "candidateCount": 1,
                "resolvedCount": 1,
                "missingCount": 0,
                "ambiguousCount": 0,
            },
            "rpcSmoke": {
                "status": "passed",
                "cases": [
                    {
                        "rpc": "external_effect_branches",
                        "status": "passed",
                        "errorClass": "external_effect_blocked",
                    },
                    {
                        "rpc": "public.preview_privacy_incident_transition:service_role_guard",
                        "class": "in_function_guard",
                        "status": "passed",
                        "errorClass": "in_function_sqlstate_P0001",
                    }
                ],
            },
            "candidateRpcSmoke": {
                "status": "failed",
                "candidateCount": 1,
                "passed": 0,
                "failed": 1,
            },
        }
        with self.assertRaises(scanner.RuntimeScanError):
            scanner._validate_runtime(runtime, require_smoke=True)
        scanner._validate_runtime(runtime)

    def test_runtime_validation_requires_bound_external_effect_case(self):
        scanner = self.scanner
        runtime = {
            "closureSmoke": {"status": "passed"},
            "unresolvedPathCount": 0,
            "ambiguousPathCount": 0,
            "candidateResolution": {
                "candidateCount": 0,
                "resolvedCount": 0,
                "missingCount": 0,
                "ambiguousCount": 0,
            },
            "rpcSmoke": {
                "status": "passed",
                "cases": [
                    {
                        "rpc": "external_effect_branches",
                        "status": "passed",
                        "errorClass": "external_effect_blocked",
                    },
                    {
                        "rpc": "public.preview_privacy_incident_transition:service_role_guard",
                        "class": "in_function_guard",
                        "status": "passed",
                        "errorClass": "in_function_sqlstate_P0001",
                    }
                ],
            },
        }
        scanner._validate_runtime(runtime)
        static_runtime = {
            **runtime,
            "rpcSmoke": {
                "status": "passed",
                "cases": [runtime["rpcSmoke"]["cases"][0]],
            },
        }
        scanner._validate_runtime(static_runtime)
        guard_case = runtime["rpcSmoke"]["cases"][1]
        for bad_guard in (
            {**guard_case, "status": "failed"},
            {**guard_case, "errorClass": "sqlstate_42501"},
        ):
            with self.assertRaisesRegex(
                scanner.RuntimeScanError,
                "runtime_privacy_incident_guard_failed",
            ):
                scanner._validate_runtime({
                    **runtime,
                    "candidateRpcSmoke": {
                        "status": "passed",
                        "candidateCount": 0,
                        "passed": 0,
                        "failed": 0,
                    },
                    "rpcSmoke": {
                        "status": "passed",
                        "cases": [runtime["rpcSmoke"]["cases"][0], bad_guard],
                    },
                }, require_smoke=True)
        for cases in (
            [],
            [
                {
                    "rpc": "external_effect_branches",
                    "status": "passed",
                    "errorClass": "external_effect_blocked",
                },
                {
                    "rpc": "external_effect_branches",
                    "status": "passed",
                    "errorClass": "external_effect_blocked",
                },
            ],
            [
                {
                    "rpc": "external_effect_branches",
                    "status": "failed",
                    "errorClass": "external_effect_surface_present",
                }
            ],
        ):
            with self.assertRaises(scanner.RuntimeScanError):
                scanner._validate_runtime({**runtime, "rpcSmoke": {"status": "passed", "cases": cases}})

    def test_closure_binding_is_deterministic_and_source_bound(self):
        scanner = self.scanner
        metadata = {
            "sourceManifestSha256": "a" * 64,
            "toolSha256": "b" * 64,
            "trustedExtensionManifestSha256": "c" * 64,
            "candidateSetSha256": "d" * 64,
            "patchSha256": "e" * 64,
        }
        first = scanner._closure_binding_sha256(metadata, "f" * 64)
        second = scanner._closure_binding_sha256(metadata, "f" * 64)
        self.assertEqual(first, second)
        with self.assertRaises(scanner.RuntimeScanError):
            scanner._closure_binding_sha256({**metadata, "toolSha256": "invalid"}, "f" * 64)


if __name__ == "__main__":
    unittest.main()
