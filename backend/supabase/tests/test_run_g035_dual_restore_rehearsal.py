from __future__ import annotations

import argparse
import copy
import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/run_g035_dual_restore_rehearsal.py"
SPEC = importlib.util.spec_from_file_location("run_g035_dual_restore_rehearsal", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
dual = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dual)


COMMIT = "a" * 40
RUNTIME_ROOT = "b" * 64
PRODUCER_SHA = "c" * 64


def runtime_configuration() -> dict[str, object]:
    body: dict[str, object] = {
        "contract": "pinned-postgres-runtime-v1",
        "configFile": "/etc/postgresql/postgresql.conf",
        "dataDirectory": "/var/lib/postgresql/data",
        "hbaFile": dual.HARDENED_HBA_PATH,
        "unixSocketDirectories": "/var/run/postgresql",
        "sessionPreloadLibraries": "supautils",
        "serverVersionNum": "170006",
        "fileSettingsEntries": 61,
        "fileSettingsErrors": 1,
        "fileSettingsNotApplied": 1,
        "criticalSourceSha256": dual.POSTGRES_CRITICAL_SOURCE_SHA256,
        "criticalSourceCount": 16,
        "hbaBytes": len(dual.HARDENED_HBA),
        "hbaSha256": dual.HARDENED_HBA_SHA256,
        "configFiles": [
            {"path": path, "bytes": size, "sha256": digest}
            for path, size, digest in dual.POSTGRES_CONFIG_FILES
        ],
        "postgresCustomTreeRoot": dual.POSTGRES_CUSTOM_TREE_ROOT,
        "configFileSetSha256": dual.POSTGRES_CONFIG_FILE_SET_SHA256,
    }
    return {**body, "runtimeConfigurationSha256": dual._digest(body)}


def owned_write(path: Path, value: bytes) -> None:
    path.write_bytes(value)
    path.chmod(0o600)


def g035_receipt(mode: str, status: str, evidence: dict[str, object], prior: list[str]) -> dict[str, object]:
    body: dict[str, object] = {
        "schema": dual.G035_RECEIPT_SCHEMA,
        "mode": mode,
        "status": status,
        "manifest_sha256": dual.G035_MANIFEST_SHA256,
        "prior_receipt_sha256": prior,
        "evidence": evidence,
    }
    return {**body, "receipt_sha256": dual._digest(body)}


class EvidenceBundle:
    def __init__(self, base: Path) -> None:
        self.root = ROOT
        self.evidence = base / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.evidence = self.evidence.resolve(strict=True)
        self.archive = self.evidence / "g035-dump.enc"
        owned_write(self.archive, b"encrypted-production-capture")
        archive_info = self.archive.lstat()
        first_migration = ROOT / "backend/supabase/migrations/20260814010000_hosted_g016_g041_catalog_reconciliation.sql"
        source = first_migration.read_text(encoding="utf-8")
        region = source[
            source.index("WITH expected(version, name) AS (") : source.index("), actual AS (")
        ]
        pairs = [list(pair) for pair in __import__("re").findall(
            r"\('([0-9]+)', '([A-Za-z0-9_-]+)'\)", region
        )]
        self.assert_exact_pairs(pairs)
        self.pairs = pairs
        self.fingerprint = {
            "ledger_pairs": pairs,
            "ledger_sha256": dual._ledger_sha256(pairs),
            "ledger_count": dual.EXPECTED_LEDGER_COUNT,
            "restorable_catalog_sha256": "d" * 64,
            "managed_catalog_sha256": "e" * 64,
            "managed_metadata_schemas_present": list(dual.EXPECTED_MANAGED_SCHEMAS),
        }
        capture_evidence: dict[str, object] = {
            "g034_preflight_receipt_id": "1" * 64,
            "repository_commit": COMMIT,
            "runtime_source_root": RUNTIME_ROOT,
            "catalog_sha256": "2" * 64,
            "source_sha256": "3" * 64,
            "capture_readiness_sha256": "4" * 64,
            "recipient_fingerprint": dual.APPROVED_AGE_RECIPIENT_SHA256,
            "dump_sha256": dual._sha256_bytes(self.archive.read_bytes()),
            "dump_bytes": self.archive.stat().st_size,
            "dump_identity": {"device": archive_info.st_dev, "inode": archive_info.st_ino},
            "schema_scope": list(dual.APPLICATION_SCHEMAS),
            "recovery_control_schema_scope": list(dual.RECOVERY_CONTROL_SCHEMAS),
            "extension_scope": [
                {"name": name, "schema": schema} for name, schema in dual.RECOVERY_EXTENSIONS
            ],
            "managed_metadata_schema_scope": list(dual.EXPECTED_MANAGED_SCHEMAS),
            "managed_table_data_exclusions": list(dual.MANAGED_TABLE_DATA_EXCLUSIONS),
            "snapshot_consumer_argv": [
                "/opt/homebrew/bin/pg_dump",
                "--format=custom",
                "--snapshot=00000001-1",
                "--blobs",
                *[
                    f"--schema={schema}"
                    for schema in (
                        *dual.APPLICATION_SCHEMAS,
                        *dual.RECOVERY_CONTROL_SCHEMAS,
                        *dual.EXPECTED_MANAGED_SCHEMAS,
                    )
                ],
                *dual.MANAGED_TABLE_DATA_EXCLUSIONS,
                *[f"--extension={name}" for name, unused_schema in dual.RECOVERY_EXTENSIONS],
                "--dbname=service=g035",
            ],
            **self.fingerprint,
            "target_fingerprint": "5" * 64,
        }
        self.capture_value = g035_receipt("capture", "captured", capture_evidence, [])
        self.capture = self.evidence / "g035-capture.json"
        owned_write(self.capture, dual._canonical_bytes(self.capture_value))
        self.destination = self.evidence / "dual"
        self.destination.mkdir(mode=0o700)
        self.restore_values: list[dict[str, object]] = []
        self.restore_paths: list[Path] = []
        restore_evidence = {
            "repository_commit": COMMIT,
            "runtime_source_root": RUNTIME_ROOT,
            **self.fingerprint,
            "restored_vector_schema": "public",
            "restore_compatibility_hook_sha256": dual.RESTORE_COMPATIBILITY_HOOK_SHA256,
            "managed_metadata_coherence":
                "managed schema DDL restored with hosted catalog parity; managed table data excluded",
            "auth_placeholder_mapping_count": dual.AUTH_PLACEHOLDER_MAPPING_COUNT,
            "auth_placeholder_mapping_sha256": dual.AUTH_PLACEHOLDER_MAPPING_SHA256,
        }
        for slot in (1, 2):
            directory = self.destination / f"clone-{slot}"
            directory.mkdir(mode=0o700)
            value = g035_receipt(
                "restore-verify",
                "restored",
                copy.deepcopy(restore_evidence),
                [self.capture_value["receipt_sha256"]],
            )
            path = directory / "restore.json"
            owned_write(path, dual._canonical_bytes(value))
            self.restore_values.append(value)
            self.restore_paths.append(path)
        docker_body = {
            "context": "local-test",
            "endpointSha256": "6" * 64,
            "socketIdentitySha256": "7" * 64,
            "clientIdentitySha256": "8" * 64,
            "serverIdentitySha256": "9" * 64,
            "clientVersion": "29.7.2",
            "serverVersion": "29.5.2",
            "binarySha256": "a" * 64,
        }
        self.docker = {**docker_body, "identityRoot": dual._digest(docker_body)}
        self.source = {
            "repositoryCommit": COMMIT,
            "producerSourceSha256": PRODUCER_SHA,
        }
        self.rebuild_dual()

    @staticmethod
    def assert_exact_pairs(pairs: list[list[str]]) -> None:
        if len(pairs) != dual.EXPECTED_LEDGER_COUNT:
            raise AssertionError("fixture ledger count mismatch")
        canonical = __import__("json").dumps(
            tuple(tuple(pair) for pair in pairs), ensure_ascii=True, separators=(",", ":")
        ).encode("ascii")
        if dual._sha256_bytes(canonical) != dual.EXPECTED_LEDGER_PAIR_SHA256:
            raise AssertionError("fixture ledger hash mismatch")

    def rebuild_dual(self) -> None:
        capture = dual._validate_capture(self.capture, self.archive, COMMIT)
        public_clones: list[dict[str, object]] = []
        for slot, path in enumerate(self.restore_paths, 1):
            restored = dual._validate_restore(path, capture, COMMIT)
            raw_clone = {
                "slot": slot,
                "cloneNonce": str(slot) * 32,
                "container": f"tzudong-g035-{'f' * 20}-{slot}-db",
                "containerId": str(slot + 1) * 64,
                "network": f"tzudong-g035-{'f' * 20}-{slot}-net",
                "networkId": str(slot + 3) * 64,
                "port": 5400 + slot,
                "runtimeConfiguration": runtime_configuration(),
            }
            public_clones.append(
                dual._public_clone_evidence(
                    raw_clone,
                    restored,
                    str(slot + 5) * 64,
                    "170006",
                    COMMIT,
                    str(capture["receiptSha256"]),
                )
            )
        cleanup_body: dict[str, object] = {
            "containerNames": [clone["containerName"] for clone in public_clones],
            "containerNameSha256": [clone["containerNameSha256"] for clone in public_clones],
            "sourceHelperNames": [
                str(clone["containerName"])[:-2] + "source" for clone in public_clones
            ],
            "sourceHelperNameSha256": [
                dual._sha256_bytes(
                    (str(clone["containerName"])[:-2] + "source").encode("ascii")
                )
                for clone in public_clones
            ],
            "networkNames": [clone["networkName"] for clone in public_clones],
            "networkNameSha256": [clone["networkNameSha256"] for clone in public_clones],
            "operationsSucceeded": True,
            "relaysAbsent": True,
            "containersAbsent": True,
            "sourceHelpersAbsent": True,
            "networksAbsent": True,
            "serviceFilesAbsent": True,
            "plaintextWorkspacesAbsent": True,
        }
        cleanup = {**cleanup_body, "cleanupReceiptSha256": dual._digest(cleanup_body)}
        value = dual._assemble_receipt(
            {
                **self.source,
                "docker": self.docker,
                "tools": {
                    name: dual._expected_tool_binding(name)
                    for name in ("python", "docker", "age", "pgRestore")
                },
            },
            capture,
            dual._comparison(capture["fingerprints"]),
            public_clones,
            cleanup,
            int(__import__("time").time()),
        )
        self.receipt = self.destination / dual.FINAL_RECEIPT_NAME
        if self.receipt.exists():
            self.receipt.unlink()
        owned_write(self.receipt, dual._canonical_bytes(value))

    def validate(self, **kwargs: object) -> dict[str, object]:
        with patch.object(dual, "_source_binding", return_value=self.source):
            return dual.validate_dual_restore_receipt(
                self.receipt,
                self.capture,
                self.archive,
                self.root,
                COMMIT,
                **kwargs,
            )


class DualRestoreReceiptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        os.chmod(self.temporary.name, 0o700)
        self.bundle = EvidenceBundle(Path(self.temporary.name))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_exact_bundle_validates_two_retained_g035_receipts(self) -> None:
        result = self.bundle.validate()
        self.assertEqual(dual.RECEIPT_SCHEMA, result["schema"])
        self.assertEqual(COMMIT, result["sourceCommit"])
        self.assertEqual(50, result["ledgerCount"])
        self.assertEqual(2, len(result["restoreRunReceiptIds"]))
        self.assertEqual(2, len(set(result["restoreRunReceiptIds"])))
        self.assertEqual(2, len(result["g035RestoreReceiptSha256"]))
        self.assertFalse(result["cleanupLiveReadback"])
        self.assertEqual(0, result["hostedMutations"])

    def test_forged_self_hashed_catalog_is_rejected_against_capture(self) -> None:
        path = self.bundle.restore_paths[1]
        value = copy.deepcopy(self.bundle.restore_values[1])
        value["evidence"]["managed_catalog_sha256"] = "9" * 64
        body = dict(value)
        body.pop("receipt_sha256")
        value["receipt_sha256"] = dual._digest(body)
        owned_write(path, dual._canonical_bytes(value))
        with self.assertRaisesRegex(dual.RehearsalError, "restore_comparison_invalid"):
            self.bundle.validate()

    def test_different_sorted_50_row_terminal_ledger_is_rejected(self) -> None:
        different = copy.deepcopy(self.bundle.capture_value["evidence"]["ledger_pairs"])
        different[0][1] = "different_but_sorted_name"
        with self.assertRaisesRegex(dual.RehearsalError, "ledger_invalid"):
            dual._canonical_ledger_pairs(different)

    def test_missing_capture_scope_is_rejected_even_with_recomputed_hash(self) -> None:
        value = copy.deepcopy(self.bundle.capture_value)
        value["evidence"].pop("managed_table_data_exclusions")
        body = dict(value)
        body.pop("receipt_sha256")
        value["receipt_sha256"] = dual._digest(body)
        owned_write(self.bundle.capture, dual._canonical_bytes(value))
        with self.assertRaisesRegex(dual.RehearsalError, "capture_contract_invalid"):
            self.bundle.validate()

    def test_duplicate_container_identity_is_rejected_after_full_rehash(self) -> None:
        value, unused_raw, unused_info = dual._read_json_receipt(self.bundle.receipt, "dual_receipt")
        value["clones"][1]["containerIdSha256"] = value["clones"][0]["containerIdSha256"]
        value["clones"][1]["restoreRunReceiptId"] = dual._restore_run_receipt_id(
            COMMIT,
            self.bundle.capture_value["receipt_sha256"],
            value["clones"][1],
        )
        body = dict(value)
        body.pop("receiptSha256")
        value["receiptSha256"] = dual._digest(body)
        owned_write(self.bundle.receipt, dual._canonical_bytes(value))
        with self.assertRaisesRegex(dual.RehearsalError, "dual_restore_not_distinct"):
            self.bundle.validate()

    def test_clone_server_version_must_equal_exact_runtime_readback(self) -> None:
        value, unused_raw, unused_info = dual._read_json_receipt(
            self.bundle.receipt,
            "dual_receipt",
        )
        value["clones"][0]["serverVersionNum"] = "170007"
        value["clones"][0]["restoreRunReceiptId"] = dual._restore_run_receipt_id(
            COMMIT,
            self.bundle.capture_value["receipt_sha256"],
            value["clones"][0],
        )
        body = dict(value)
        body.pop("receiptSha256")
        value["receiptSha256"] = dual._digest(body)
        owned_write(self.bundle.receipt, dual._canonical_bytes(value))
        with self.assertRaisesRegex(
            dual.RehearsalError,
            "dual_receipt_invalid|runtime_configuration_invalid",
        ):
            self.bundle.validate()

    def test_cleanup_false_is_rejected_after_cleanup_and_envelope_rehash(self) -> None:
        value, unused_raw, unused_info = dual._read_json_receipt(self.bundle.receipt, "dual_receipt")
        value["cleanup"]["containersAbsent"] = False
        cleanup_body = dict(value["cleanup"])
        cleanup_body.pop("cleanupReceiptSha256")
        value["cleanup"]["cleanupReceiptSha256"] = dual._digest(cleanup_body)
        body = dict(value)
        body.pop("receiptSha256")
        value["receiptSha256"] = dual._digest(body)
        owned_write(self.bundle.receipt, dual._canonical_bytes(value))
        with self.assertRaisesRegex(dual.RehearsalError, "cleanup_evidence_invalid"):
            self.bundle.validate()

    def test_restore_receipt_symlink_is_rejected(self) -> None:
        second = self.bundle.restore_paths[1]
        second.unlink()
        second.symlink_to(self.bundle.restore_paths[0])
        with self.assertRaisesRegex(dual.RehearsalError, "dual_receipt_invalid"):
            self.bundle.validate()

    def test_archive_inode_substitution_is_rejected_even_for_same_bytes(self) -> None:
        raw = self.bundle.archive.read_bytes()
        self.bundle.archive.unlink()
        owned_write(self.bundle.archive, raw)
        with self.assertRaisesRegex(dual.RehearsalError, "capture_archive_binding_invalid"):
            self.bundle.validate()

    def test_live_cleanup_readback_rechecks_exact_names_and_pinned_image(self) -> None:
        with patch.object(dual, "_binary", return_value="/docker"), patch.object(
            dual, "_local_docker_binding", return_value=self.bundle.docker
        ), patch.object(dual, "_recheck_pinned_docker_socket"), patch.object(
            dual, "_validate_image"
        ) as image, patch.object(
            dual, "_docker_absent", return_value=True
        ) as absent:
            result = self.bundle.validate(docker_binary="/docker")
        image.assert_called_once_with("/docker")
        self.assertEqual(6, absent.call_count)
        self.assertTrue(result["cleanupLiveReadback"])

    def test_live_cleanup_readback_rejects_remaining_resource(self) -> None:
        with patch.object(dual, "_binary", return_value="/docker"), patch.object(
            dual, "_local_docker_binding", return_value=self.bundle.docker
        ), patch.object(dual, "_recheck_pinned_docker_socket"), patch.object(
            dual, "_validate_image"
        ), patch.object(
            dual, "_docker_absent", side_effect=[True, True, True, True, False]
        ):
            with self.assertRaisesRegex(dual.RehearsalError, "cleanup_live_readback_invalid"):
                self.bundle.validate(docker_binary="/docker")

    def test_future_observation_timestamp_is_rejected_after_rehash(self) -> None:
        value, unused_raw, unused_info = dual._read_json_receipt(self.bundle.receipt, "dual_receipt")
        value["observedAtUnixSeconds"] = int(__import__("time").time()) + 301
        body = dict(value)
        body.pop("receiptSha256")
        value["receiptSha256"] = dual._digest(body)
        owned_write(self.bundle.receipt, dual._canonical_bytes(value))
        with self.assertRaisesRegex(dual.RehearsalError, "dual_receipt_invalid"):
            self.bundle.validate()

    def test_capture_mtime_substitution_is_rejected_without_touching_contents(self) -> None:
        previous = self.bundle.capture.stat().st_mtime_ns
        os.utime(self.bundle.capture, ns=(previous, previous + 1_000_000_000))
        with self.assertRaisesRegex(dual.RehearsalError, "dual_receipt_invalid"):
            self.bundle.validate()

    def test_one_old_capture_input_is_rejected_when_other_is_fresh(self) -> None:
        import time

        old_ns = (int(time.time()) - dual.MAX_EVIDENCE_AGE_SECONDS - 10) * 1_000_000_000
        os.utime(self.bundle.archive, ns=(old_ns, old_ns))
        value = copy.deepcopy(self.bundle.capture_value)
        archive_info = self.bundle.archive.stat()
        value["evidence"]["dump_identity"] = {
            "device": archive_info.st_dev,
            "inode": archive_info.st_ino,
        }
        body = dict(value)
        body.pop("receipt_sha256")
        value["receipt_sha256"] = dual._digest(body)
        owned_write(self.bundle.capture, dual._canonical_bytes(value))
        for path in self.bundle.restore_paths:
            restored, unused_raw, unused_info = dual._read_json_receipt(path, "restore_receipt")
            restored["prior_receipt_sha256"] = [value["receipt_sha256"]]
            restore_body = dict(restored)
            restore_body.pop("receipt_sha256")
            restored["receipt_sha256"] = dual._digest(restore_body)
            owned_write(path, dual._canonical_bytes(restored))
        self.bundle.capture_value = value
        self.bundle.rebuild_dual()
        with self.assertRaisesRegex(dual.RehearsalError, "dual_receipt_freshness_invalid"):
            self.bundle.validate()

    def test_stale_observation_is_rejected_after_full_rehash(self) -> None:
        import time

        stale_ns = (int(time.time()) - dual.MAX_EVIDENCE_AGE_SECONDS - 10) * 1_000_000_000
        os.utime(self.bundle.capture, ns=(stale_ns, stale_ns))
        os.utime(self.bundle.archive, ns=(stale_ns, stale_ns))
        self.bundle.capture_value["evidence"]["dump_identity"] = {
            "device": self.bundle.archive.stat().st_dev,
            "inode": self.bundle.archive.stat().st_ino,
        }
        body = dict(self.bundle.capture_value)
        body.pop("receipt_sha256")
        self.bundle.capture_value["receipt_sha256"] = dual._digest(body)
        owned_write(self.bundle.capture, dual._canonical_bytes(self.bundle.capture_value))
        os.utime(self.bundle.capture, ns=(stale_ns, stale_ns))
        for path in self.bundle.restore_paths:
            value, unused_raw, unused_info = dual._read_json_receipt(path, "restore_receipt")
            value["prior_receipt_sha256"] = [self.bundle.capture_value["receipt_sha256"]]
            restore_body = dict(value)
            restore_body.pop("receipt_sha256")
            value["receipt_sha256"] = dual._digest(restore_body)
            owned_write(path, dual._canonical_bytes(value))
        self.bundle.rebuild_dual()
        value, unused_raw, unused_info = dual._read_json_receipt(self.bundle.receipt, "dual_receipt")
        value["observedAtUnixSeconds"] = int(time.time())
        receipt_body = dict(value)
        receipt_body.pop("receiptSha256")
        value["receiptSha256"] = dual._digest(receipt_body)
        owned_write(self.bundle.receipt, dual._canonical_bytes(value))
        with self.assertRaisesRegex(dual.RehearsalError, "dual_receipt_freshness_invalid"):
            self.bundle.validate()


class ProducerContractTests(unittest.TestCase):
    def test_restore_invocation_uses_g040_bootstrap_and_identity_pipe(self) -> None:
        observed: dict[str, object] = {}
        temporary = tempfile.TemporaryDirectory()
        directory = Path(temporary.name).resolve(strict=True) / "clone"
        directory.mkdir(mode=0o700)

        class Process:
            returncode = 0

            def __init__(self, argv: list[str], **kwargs: object) -> None:
                observed["argv"] = argv
                observed["kwargs"] = kwargs
                read_fd = kwargs["pass_fds"][0]
                self.read_fd = os.dup(read_fd)

            def communicate(self, *, input: bytes, timeout: int) -> tuple[bytes, bytes]:
                observed["bootstrap"] = input
                observed["timeout"] = timeout
                observed["identity"] = os.read(self.read_fd, 4096)
                os.close(self.read_fd)
                return b"", b""

        clone = {
            "slot": 1,
            "directory": directory,
            "restoreReceipt": Path("/evidence/clone-1/restore.json"),
            "service": Path("/evidence/clone-1/pg_service.conf"),
        }
        with patch.object(dual.subprocess, "Popen", Process):
            dual._restore_clone(
                clone,
                python="/python",
                repository_root=Path("/source"),
                commit=COMMIT,
                bootstrap=b"bootstrap-source",
                capture_receipt=Path("/evidence/capture.json"),
                archive=Path("/evidence/archive.enc"),
                identity=b"AGE-SECRET-KEY-test\n",
                age="/age",
                pg_restore="/pg_restore",
            )
        argv = observed["argv"]
        self.assertEqual(["/python", "-I", "-B", "-"], argv[:4])
        self.assertIn(dual.G035_ENTRYPOINT, argv)
        self.assertEqual(1, argv.count("restore-verify"))
        self.assertNotIn("capture", argv)
        self.assertEqual(b"bootstrap-source", observed["bootstrap"])
        self.assertEqual(b"AGE-SECRET-KEY-test\n", observed["identity"])
        runtime = clone["plaintextWorkspace"]
        self.assertTrue(runtime.is_dir())
        self.assertTrue(dual._remove_owned_tree(runtime, clone["plaintextWorkspaceIdentity"], "test"))
        temporary.cleanup()

    def test_cleanup_never_removes_resource_with_mismatched_labels(self) -> None:
        with patch.object(
            dual,
            "_resource_labels",
            return_value=("a" * 64, {"io.tzudong.g035-dual-restore": "different"}),
        ), patch.object(dual, "_recheck_pinned_docker_socket"), patch.object(
            dual.subprocess, "run"
        ) as run:
            result = dual._remove_owned_resource(
                "/docker",
                "container",
                "exact-name",
                {"io.tzudong.g035-dual-restore": "expected"},
                expected_id="a" * 64,
            )
        self.assertFalse(result)
        run.assert_not_called()

    def test_cleanup_removes_by_inspected_immutable_id_not_mutable_name(self) -> None:
        identifier = "a" * 64
        completed = __import__("subprocess").CompletedProcess([], 0, b"", b"")
        with patch.object(
            dual,
            "_resource_labels",
            return_value=(identifier, {"io.tzudong.g035-dual-restore": "expected"}),
        ), patch.object(dual, "_recheck_pinned_docker_socket"), patch.object(
            dual.subprocess, "run", return_value=completed
        ) as run, patch.object(
            dual, "_docker_names", return_value=()
        ):
            result = dual._remove_owned_resource(
                "/docker",
                "container",
                "mutable-name",
                {"io.tzudong.g035-dual-restore": "expected"},
                expected_id=identifier,
            )
        self.assertTrue(result)
        self.assertEqual(["/docker", "rm", "-f", identifier], run.call_args.args[0])

    def test_docker_absence_requires_successful_inventory_not_failed_inspect(self) -> None:
        completed = __import__("subprocess").CompletedProcess(
            ["docker"],
            1,
            stdout=b"",
            stderr=b"daemon unavailable",
        )
        with patch.object(dual.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(dual.RehearsalError, "docker_inventory_unavailable"):
                dual._docker_absent("/docker", "container", "clone")

    def test_wait_for_clone_uses_bounded_subprocess_calls(self) -> None:
        results = [
            __import__("subprocess").CompletedProcess([], 0, b"", b""),
            __import__("subprocess").CompletedProcess([], 0, b"healthy\n", b""),
            __import__("subprocess").CompletedProcess([], 1, b"", b"password required"),
            __import__("subprocess").CompletedProcess([], 1, b"", b"password invalid"),
            __import__("subprocess").CompletedProcess([], 0, b"auth-ok\n", b""),
            __import__("subprocess").CompletedProcess([], 0, b"", b""),
        ]
        with patch.object(dual, "_bounded_run", side_effect=results) as run:
            dual._wait_for_clone("/docker", "clone", "secret")
        self.assertEqual(6, run.call_count)
        self.assertTrue(all(call.kwargs["timeout"] <= 10 for call in run.call_args_list))

    def test_container_contract_has_no_trust_and_pins_no_persistent_mounts(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("POSTGRES_HOST_AUTH_METHOD=trust", source)
        self.assertIn("POSTGRES_PASSWORD=", source)
        self.assertIn('config.get("Volumes") not in (None, {})', source)
        self.assertIn('host.get("Mounts") not in (None, [])', source)
        self.assertIn('len(item["Mounts"]) != 0', source)
        self.assertIn('host.get("ReadonlyRootfs") is not True', source)
        self.assertIn("/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=4g", source)
        self.assertIn('"/var/lib/postgresql/data": (', source)
        self.assertIn("/var/run/postgresql:rw,noexec,nosuid,nodev,size=16m", source)
        self.assertIn('"/var/run/postgresql": (', source)
        self.assertEqual("100", dual.PINNED_POSTGRES_UID)
        self.assertEqual("101", dual.PINNED_POSTGRES_GID)
        self.assertIn("docker-entrypoint.sh postgres -D /etc/postgresql", dual.POSTGRES_START_COMMAND)
        self.assertIn('config.get("Cmd") != ["-c", POSTGRES_START_COMMAND]', source)
        self.assertIn('"id", "-u", "postgres"', source)
        self.assertIn('"id", "-g", "postgres"', source)

    def test_repeated_exact_docker_pin_is_idempotent_and_drift_is_rejected(self) -> None:
        original_endpoint = dual._PINNED_DOCKER_ENDPOINT
        original_identity = dual._PINNED_DOCKER_SOCKET_IDENTITY
        try:
            dual._PINNED_DOCKER_ENDPOINT = None
            dual._PINNED_DOCKER_SOCKET_IDENTITY = None
            info = type("Info", (), {"st_dev": 1, "st_ino": 2, "st_uid": os.getuid()})()
            dual._pin_docker_endpoint("unix:///private/docker.sock", Path("/private/docker.sock"), info)
            dual._pin_docker_endpoint("unix:///private/docker.sock", Path("/private/docker.sock"), info)
            changed = type("Info", (), {"st_dev": 1, "st_ino": 3, "st_uid": os.getuid()})()
            with self.assertRaisesRegex(dual.RehearsalError, "docker_endpoint_already_pinned"):
                dual._pin_docker_endpoint("unix:///private/docker.sock", Path("/private/docker.sock"), changed)
        finally:
            dual._PINNED_DOCKER_ENDPOINT = original_endpoint
            dual._PINNED_DOCKER_SOCKET_IDENTITY = original_identity

    def test_runtime_configuration_rejects_any_pinned_provenance_drift(self) -> None:
        exact = runtime_configuration()
        dual._validate_runtime_configuration(exact)
        for key, value in (
            ("criticalSourceSha256", "0" * 64),
            ("configFileSetSha256", "1" * 64),
            ("hbaSha256", "2" * 64),
            ("fileSettingsEntries", 60),
        ):
            changed = copy.deepcopy(exact)
            changed[key] = value
            body = dict(changed)
            body.pop("runtimeConfigurationSha256")
            changed["runtimeConfigurationSha256"] = dual._digest(body)
            with self.subTest(key=key), self.assertRaisesRegex(
                dual.RehearsalError, "runtime_configuration_invalid"
            ):
                dual._validate_runtime_configuration(changed)

    def test_whole_deadline_bounds_commands_and_cancels(self) -> None:
        original_deadline = dual._WHOLE_DEADLINE
        original_cleanup_deadline = dual._CLEANUP_DEADLINE
        original_cancelled = dual._CANCELLATION_REQUESTED
        try:
            dual._CANCELLATION_REQUESTED = False
            dual._WHOLE_DEADLINE = 100.0
            dual._CLEANUP_DEADLINE = 125.0
            with patch.object(dual.time, "monotonic", return_value=99.25):
                self.assertEqual(0.75, dual._remaining_timeout(30))
                self.assertEqual(25.75, dual._remaining_timeout(30, cleanup=True))
            with patch.object(dual.time, "monotonic", return_value=100.0), patch.object(
                dual, "_request_cancellation"
            ) as cancel:
                with self.assertRaisesRegex(dual.RehearsalError, "rehearsal_deadline_exceeded"):
                    dual._remaining_timeout(30)
                cancel.assert_called_once()
        finally:
            dual._WHOLE_DEADLINE = original_deadline
            dual._CLEANUP_DEADLINE = original_cleanup_deadline
            dual._CANCELLATION_REQUESTED = original_cancelled

    def test_restore_started_at_whole_deadline_terminates_and_reaps_child(self) -> None:
        observed: list[tuple[str, object]] = []
        temporary = tempfile.TemporaryDirectory()
        directory = Path(temporary.name).resolve(strict=True) / "clone"
        directory.mkdir(mode=0o700)

        class Process:
            pid = 4242
            returncode = None

            def __init__(self, unused_argv: list[str], **unused_kwargs: object) -> None:
                read_fd = unused_kwargs["pass_fds"][0]
                self.read_fd = os.dup(read_fd)

            def poll(self) -> int | None:
                return self.returncode

            def communicate(
                self,
                *,
                input: bytes | None = None,
                timeout: float,
            ) -> tuple[bytes, bytes]:
                observed.append(("communicate", timeout))
                if len(observed) == 1:
                    os.read(self.read_fd, 4096)
                    os.close(self.read_fd)
                    raise __import__("subprocess").TimeoutExpired([], timeout)
                self.returncode = -15
                return b"", b""

        clone = {
            "slot": 2,
            "directory": directory,
            "restoreReceipt": Path("/evidence/clone-2/restore.json"),
            "service": Path("/evidence/clone-2/pg_service.conf"),
        }
        original = (
            dual._WHOLE_DEADLINE,
            dual._CLEANUP_DEADLINE,
            dual._CANCELLATION_REQUESTED,
        )
        try:
            dual._WHOLE_DEADLINE = 100.0
            dual._CLEANUP_DEADLINE = 400.0
            dual._CANCELLATION_REQUESTED = False
            with patch.object(dual.subprocess, "Popen", Process), patch.object(
                dual.time, "monotonic", return_value=100.0
            ), patch.object(dual.os, "killpg") as killpg:
                with self.assertRaisesRegex(dual.RehearsalError, "restore_cancelled"):
                    dual._restore_clone(
                        clone,
                        python="/python",
                        repository_root=Path("/source"),
                        commit=COMMIT,
                        bootstrap=b"bootstrap",
                        capture_receipt=Path("/evidence/capture.json"),
                        archive=Path("/evidence/archive.enc"),
                        identity=bytearray(b"AGE-SECRET-KEY-test\n"),
                        age="/age",
                        pg_restore="/pg_restore",
                    )
            self.assertIn(__import__("unittest").mock.call(4242, dual.signal.SIGTERM), killpg.call_args_list)
            self.assertIsNone(dual._ACTIVE_RESTORE_PROCESS)
        finally:
            (
                dual._WHOLE_DEADLINE,
                dual._CLEANUP_DEADLINE,
                dual._CANCELLATION_REQUESTED,
            ) = original
            runtime = clone.get("plaintextWorkspace")
            identity = clone.get("plaintextWorkspaceIdentity")
            if isinstance(runtime, Path) and type(identity) is tuple:
                dual._remove_owned_tree(runtime, identity, "test")
            temporary.cleanup()

    def test_toolchain_recheck_fails_closed_on_binary_drift(self) -> None:
        expected = {
            name: dual._expected_tool_binding(name)
            for name in ("python", "docker", "age", "pgRestore")
        }
        changed = copy.deepcopy(expected)
        changed["age"]["sha256"] = "0" * 64
        with patch.object(dual, "_live_toolchain", return_value=changed):
            with self.assertRaisesRegex(dual.RehearsalError, "toolchain_identity_changed"):
                dual._require_toolchain_unchanged(
                    expected,
                    "/python",
                    "/docker",
                    "/age",
                    "/pg_restore",
                )

    def test_stale_input_is_rejected_before_identity_or_clone_work(self) -> None:
        capture = {
            "captureReceiptMtimeNs": 1_700_000_001_000_000_000,
            "archiveMtimeNs": 1_700_000_002_000_000_000,
        }
        with patch.object(dual.time, "time_ns", return_value=2_000_000_000_000_000_000):
            with self.assertRaisesRegex(dual.RehearsalError, "input_evidence_stale"):
                dual._require_fresh_input_evidence(capture)

    def test_run_wrapper_zeroes_identity_on_failure_before_clone(self) -> None:
        identity = bytearray(b"AGE-SECRET-KEY-sensitive")
        original_identity = dual._ACTIVE_IDENTITY

        def fail(unused: object) -> dict[str, object]:
            dual._ACTIVE_IDENTITY = identity
            raise dual.RehearsalError("early_failure")

        try:
            with patch.object(dual, "_run_rehearsal_impl", side_effect=fail):
                with self.assertRaisesRegex(dual.RehearsalError, "early_failure"):
                    dual.run_rehearsal(object())
            self.assertEqual(bytearray(len(identity)), identity)
            self.assertIsNone(dual._ACTIVE_IDENTITY)
        finally:
            dual._ACTIVE_IDENTITY = original_identity

    def test_cleanup_rejects_hardlinked_service_credential(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw).resolve(strict=True)
            service = directory / "pg_service.conf"
            service.write_bytes(b"secret")
            service.chmod(0o600)
            link = directory / "credential-link"
            os.link(service, link)
            info = service.lstat()
            clone = {
                "slot": 1,
                "runNonce": "f" * 32,
                "container": "container",
                "sourceHelper": "source-helper",
                "network": "network",
                "containerId": "a" * 64,
                "networkId": "b" * 64,
                "service": service,
                "serviceIdentity": (info.st_dev, info.st_ino),
                "relay": type("Relay", (), {"closed": False, "close": lambda self: True})(),
            }
            with patch.object(dual, "_remove_owned_resource", return_value=True), patch.object(
                dual, "_docker_names", return_value=()
            ):
                with self.assertRaisesRegex(dual.RehearsalError, "clone_cleanup_failed"):
                    dual._cleanup_clones("/docker", [clone])
            self.assertTrue(service.exists())

    def test_relay_cleanup_fails_if_process_or_copy_thread_is_not_reaped(self) -> None:
        class Listener:
            descriptor = 7

            def close(self) -> None:
                self.descriptor = -1

            def fileno(self) -> int:
                return self.descriptor

        class Thread:
            def __init__(self, alive: bool) -> None:
                self.alive = alive

            def join(self, timeout: float) -> None:
                pass

            def is_alive(self) -> bool:
                return self.alive

        class Process:
            pid = 6789

            def poll(self) -> None:
                return None

            def wait(self, timeout: float) -> None:
                raise __import__("subprocess").TimeoutExpired([], timeout)

        def relay() -> object:
            value = dual._CloneRelay.__new__(dual._CloneRelay)
            value.stop = dual.threading.Event()
            value.lock = dual.threading.Lock()
            value.connections = set()
            value.processes = set()
            value.copy_threads = set()
            value.workers = []
            value.listener = Listener()
            value.acceptor = Thread(False)
            value.closed = False
            return value

        process_relay = relay()
        process = Process()
        process_relay.processes.add(process)
        with patch.object(dual.os, "killpg"):
            self.assertFalse(process_relay.close())
        self.assertIn(process, process_relay.processes)

        copy_relay = relay()
        copy = Thread(True)
        copy_relay.copy_threads.add(copy)
        self.assertFalse(copy_relay.close())
        self.assertIn(copy, copy_relay.copy_threads)

    def test_image_validation_rejects_wrong_id_and_missing_exact_digest(self) -> None:
        invalid = (
            [{"Id": "f" * 64, "RepoDigests": [dual.IMAGE_REFERENCE]}],
            [{"Id": dual.IMAGE_ID, "RepoDigests": ["supabase/postgres@sha256:" + "f" * 64]}],
        )
        for payload in invalid:
            with self.subTest(payload=payload), patch.object(dual, "_docker_json", return_value=payload):
                with self.assertRaisesRegex(dual.RehearsalError, "image_identity_invalid"):
                    dual._validate_image("/docker")
        with patch.object(
            dual,
            "_docker_json",
            return_value=[{"Id": dual.IMAGE_ID, "RepoDigests": [dual.IMAGE_REFERENCE]}],
        ):
            dual._validate_image("/docker")

    def test_source_contract_pins_image_local_scope_and_no_hosted_apply_mode(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn(dual.IMAGE_REFERENCE, source)
        self.assertIn(dual.IMAGE_ID, source)
        self.assertIn(dual.BOOTSTRAP_PATH, source)
        self.assertIn(dual.G035_ENTRYPOINT, source)
        self.assertNotRegex(source, r'"(?:db push|migration repair|link|production-capture)"')
        self.assertIn('"hostedMutations": 0', source)
        self.assertIn('"managedPitrUsed": False', source)

    def test_parser_requires_explicit_absolute_tool_arguments_for_run(self) -> None:
        args = dual.parser().parse_args(
            [
                "run",
                "--repository-root", "/source",
                "--authorized-final-commit", COMMIT,
                "--capture-receipt", "/evidence/capture.json",
                "--archive", "/evidence/archive.enc",
                "--identity-fd", "3",
                "--run-nonce", "f" * 32,
                "--destination", "/evidence/dual",
                "--python", "/python",
                "--docker", "/docker",
                "--age", "/age",
                "--pg-restore", "/pg_restore",
            ]
        )
        self.assertEqual("run", args.mode)
        self.assertEqual(Path("/evidence/dual"), args.destination)
        self.assertEqual("/docker", args.docker)

    def test_parser_and_source_expose_only_anonymous_identity_channel(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("identity-file", source)
        self.assertNotIn("identity_file", source)
        self.assertIn('run.add_argument("--identity-fd", required=True)', source)

    def test_identity_channel_requires_pipe_reads_to_eof_and_closes_original(self) -> None:
        read_fd, write_fd = os.pipe()
        os.write(write_fd, b"AGE-SECRET-KEY-test\n")
        os.close(write_fd)
        value = dual._read_inherited_identity(str(read_fd))
        self.assertEqual(b"AGE-SECRET-KEY-test\n", value)
        with self.assertRaises(OSError):
            os.fstat(read_fd)

    def test_identity_channel_reads_secret_directly_with_readv(self) -> None:
        read_fd, write_fd = os.pipe()
        os.write(write_fd, b"AGE-SECRET-KEY-readv\n")
        os.close(write_fd)
        with patch.object(dual.os, "read", side_effect=AssertionError("immutable read forbidden")):
            value = dual._read_inherited_identity(str(read_fd))
        self.assertEqual(bytearray(b"AGE-SECRET-KEY-readv\n"), value)
        value[:] = b"\0" * len(value)

    def test_identity_channel_rejects_regular_file_and_empty_pipe(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            file_fd = os.open(Path(raw) / "identity", os.O_WRONLY | os.O_CREAT, 0o600)
            os.close(file_fd)
            file_fd = os.open(Path(raw) / "identity", os.O_RDONLY)
            with self.assertRaisesRegex(dual.RehearsalError, "identity_channel_invalid"):
                dual._read_inherited_identity(str(file_fd))
        read_fd, write_fd = os.pipe()
        os.close(write_fd)
        with self.assertRaisesRegex(dual.RehearsalError, "identity_channel_invalid"):
            dual._read_inherited_identity(str(read_fd))

    def test_identity_channel_timeout_closes_unfinished_pipe(self) -> None:
        read_fd, write_fd = os.pipe()

        class Poll:
            def register(self, *unused: object) -> None:
                pass

            def poll(self, unused: int) -> list[object]:
                return []

        with patch("select.poll", return_value=Poll()), patch.object(
            dual.time, "monotonic", side_effect=[0, 31]
        ):
            with self.assertRaisesRegex(dual.RehearsalError, "identity_channel_timeout"):
                dual._read_inherited_identity(str(read_fd))
        with self.assertRaises(OSError):
            os.fstat(read_fd)
        os.close(write_fd)

    def test_plaintext_cleanup_rejects_symlink_hardlink_and_permissive_mode(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            parent = Path(raw).resolve(strict=True)
            parent.chmod(0o700)
            for kind in ("symlink", "hardlink", "mode"):
                root = parent / kind
                root.mkdir(mode=0o700)
                info = root.lstat()
                if kind == "symlink":
                    (root / "bad").symlink_to(parent)
                elif kind == "hardlink":
                    source = parent / f"{kind}-source"
                    source.write_bytes(b"x")
                    source.chmod(0o600)
                    os.link(source, root / "bad")
                else:
                    (root / "bad").write_bytes(b"x")
                    (root / "bad").chmod(0o644)
                self.assertFalse(dual._remove_owned_tree(root, (info.st_dev, info.st_ino), "test"))


if __name__ == "__main__":
    unittest.main()
