from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_successor_contract as contract


class G038SuccessorContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repository = Path(__file__).resolve().parents[3]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve(strict=True)
        for relative in (
            contract.MANIFEST_RELATIVE_PATH,
            "backend/supabase/migrations/20260713002600_g014_account_deletion_receipt_parity.sql",
            "backend/supabase/migrations/20260713002700_g028_account_deletion_reauth_proof.sql",
            "backend/supabase/scripts/g037_supabase_statement_vector.mjs",
        ):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.repository / relative, destination)
        self.manifest_path = self.root / contract.MANIFEST_RELATIVE_PATH
        self.value = json.loads(self.manifest_path.read_bytes())

    def tearDown(self):
        self.temp.cleanup()

    def write_manifest(self, value=None, *, canonical=True):
        value = self.value if value is None else value
        if canonical:
            raw = contract.canonical_json_bytes(value) + b"\n"
        else:
            raw = json.dumps(value, indent=2).encode("ascii") + b"\n"
        self.manifest_path.write_bytes(raw)

    def denied(self, callback):
        with self.assertRaisesRegex(contract.SuccessorContractError, "^G038 successor contract verification failed$"):
            callback()

    def test_exact_manifest_and_sources_select_only_two_ordered_migrations(self):
        manifest = contract.validate_sources(self.root)
        self.assertEqual(tuple(item.version for item in manifest.migrations), contract.SELECTED_VERSIONS)
        self.assertEqual(manifest.predecessor_rows, 40)
        self.assertEqual(manifest.target_rows, 42)
        self.assertEqual(manifest.predecessor_report_sha256, contract.PREDECESSOR_REPORT_SHA256)
        self.assertEqual(manifest.predecessor_commit, contract.PREDECESSOR_COMMIT)
        self.assertEqual(manifest.target_fingerprint, contract.TARGET_FINGERPRINT)
        self.assertEqual(len(contract.PREDECESSOR_PAIRS), 40)

    def test_repository_root_finds_only_regular_manifest(self):
        nested = self.root / "a/b"
        nested.mkdir(parents=True)
        self.assertEqual(contract.repository_root(nested), self.root)
        self.manifest_path.unlink()
        self.manifest_path.symlink_to(self.repository / contract.MANIFEST_RELATIVE_PATH)
        self.denied(lambda: contract.repository_root(nested))

    def test_manifest_rejects_duplicate_keys_noncanonical_bytes_and_non_ascii(self):
        raw = self.manifest_path.read_bytes()
        self.manifest_path.write_bytes(raw[:-2] + b',"schema":"g038-account-deletion-successor-v1"}\n')
        self.denied(lambda: contract.load_manifest(self.root))
        self.write_manifest(canonical=False)
        self.denied(lambda: contract.load_manifest(self.root))
        self.write_manifest()
        self.manifest_path.write_bytes(self.manifest_path.read_bytes().replace(b"G026", "Ｇ026".encode("utf-8")))
        self.denied(lambda: contract.load_manifest(self.root))

    def test_manifest_rejects_extra_missing_and_wrong_typed_keys(self):
        for mutate in (
            lambda value: value.update(extra=True),
            lambda value: value.pop("terminalSpecRoot"),
            lambda value: value.update(targetRows=True),
            lambda value: value["predecessor"].update(extra="x"),
            lambda value: value["migrations"][0].update(extra="x"),
        ):
            value = copy.deepcopy(self.value)
            mutate(value)
            self.write_manifest(value)
            self.denied(lambda: contract.load_manifest(self.root))

    def test_manifest_rejects_duplicate_extra_and_reordered_migrations(self):
        for rows in (
            [self.value["migrations"][0], self.value["migrations"][0]],
            [*self.value["migrations"], copy.deepcopy(self.value["migrations"][1])],
            list(reversed(self.value["migrations"])),
        ):
            value = copy.deepcopy(self.value)
            value["migrations"] = rows
            self.write_manifest(value)
            self.denied(lambda: contract.load_manifest(self.root))

    def test_manifest_rejects_all_pinned_binding_drift(self):
        mutations = (
            ("predecessor", "reportSha256", "0" * 64),
            ("predecessor", "commit", "0" * 40),
            ("predecessor", "targetFingerprint", "0" * 64),
            ("predecessor", "rows", 39),
            ("predecessor", "ledgerRoot", "0" * 64),
            (None, "targetRows", 41),
            (None, "excludedSources", ["20260713002500"]),
            (None, "excludedRoot", "0" * 64),
            (None, "runtimeInventory", self.value["runtimeInventory"][:-1]),
            (None, "runtimeInventoryRoot", "0" * 64),
            (None, "statementParser", {}),
            (None, "statementVectorRoot", "0" * 64),
            (None, "terminalSpecRoot", "0" * 64),
        )
        for parent, key, replacement in mutations:
            with self.subTest(key=key):
                value = copy.deepcopy(self.value)
                target = value if parent is None else value[parent]
                target[key] = replacement
                self.write_manifest(value)
                self.denied(lambda: contract.load_manifest(self.root))
    def test_manifest_requires_exact_ordered_parser_blob_parts(self):
        parser = self.value["statementParser"]
        self.assertEqual(parser["tokenBlobParts"], ["db008434246be335b9f7", "abaf0cb66a99a2b40378"])
        self.assertEqual(parser["stateBlobParts"], ["47775390d1731c0ad29e", "10b20fb2fe16c8cfcadb"])
        self.assertEqual(
            contract._parser_blob(parser["tokenBlobParts"], contract.TOKEN_BLOB_PARTS),
            "db008434246be335b9f7" + "abaf0cb66a99a2b40378",
        )
        self.assertEqual(
            contract._parser_blob(parser["stateBlobParts"], contract.STATE_BLOB_PARTS),
            "47775390d1731c0ad29e" + "10b20fb2fe16c8cfcadb",
        )
        for key in ("tokenBlobParts", "stateBlobParts"):
            parts = parser[key]
            malformed = (
                parts[:1],
                [*parts, "0" * 20],
                list(reversed(parts)),
                [parts[0].upper(), parts[1]],
                [parts[0][:-1], parts[1]],
            )
            for replacement in malformed:
                with self.subTest(key=key, replacement=replacement):
                    value = copy.deepcopy(self.value)
                    value["statementParser"][key] = replacement
                    self.write_manifest(value)
                    self.denied(lambda: contract.load_manifest(self.root))
        for key in ("tokenBlobParts", "stateBlobParts"):
            with self.subTest(missing=key):
                value = copy.deepcopy(self.value)
                value["statementParser"].pop(key)
                self.write_manifest(value)
                self.denied(lambda: contract.load_manifest(self.root))
        value = copy.deepcopy(self.value)
        value["statementParser"]["tokenBlob"] = value["statementParser"].pop("tokenBlobParts")
        self.write_manifest(value)
        self.denied(lambda: contract.load_manifest(self.root))


    def test_manifest_rejects_source_identity_and_vector_drift(self):
        for key, replacement in (
            ("version", "20260713002500"), ("name", "other"), ("path", "../escape.sql"),
            ("sourceSize", 1), ("sourceSha256", "0" * 64), ("statementCount", 1),
            ("statementVectorSha256", "0" * 64), ("transactionControl", ["BEGIN"]),
        ):
            with self.subTest(key=key):
                value = copy.deepcopy(self.value)
                value["migrations"][0][key] = replacement
                self.write_manifest(value)
                self.denied(lambda: contract.load_manifest(self.root))

    def test_sources_reject_byte_hash_size_symlink_and_directory_escape(self):
        migration = self.root / self.value["migrations"][0]["path"]
        original = migration.read_bytes()
        migration.write_bytes(original + b" ")
        self.denied(lambda: contract.validate_sources(self.root))
        migration.write_bytes(original)
        migration.unlink()
        migration.symlink_to(self.repository / self.value["migrations"][0]["path"])
        self.denied(lambda: contract.validate_sources(self.root))

    def test_parser_rejects_vector_hash_and_noncanonical_output_drift(self):
        manifest = contract.load_manifest(self.root)
        migration = manifest.migrations[0]
        good = subprocess.run(
            ["node", str(self.root / "backend/supabase/scripts/g037_supabase_statement_vector.mjs"),
             "--source", str(self.root / migration.path), "--version", migration.version,
             "--sha256", migration.sha256, "--size", str(migration.size)],
            capture_output=True, text=True, check=False, timeout=60,
        )
        value = json.loads(good.stdout)
        value["statements"][0] += " "
        drift = subprocess.CompletedProcess([], 0, contract.canonical_json_bytes(value).decode("ascii") + "\n", "")
        self.denied(lambda: contract.statement_vectors(self.root, migration, runner=lambda *args, **kwargs: drift))
        pretty = subprocess.CompletedProcess([], 0, json.dumps(json.loads(good.stdout), indent=2), "")
        self.denied(lambda: contract.statement_vectors(self.root, migration, runner=lambda *args, **kwargs: pretty))

    def test_transaction_control_requires_none_then_exact_outer_begin_commit(self):
        manifest = contract.load_manifest(self.root)
        first, second = manifest.migrations
        self.assertEqual(first.transaction_control, ())
        self.assertEqual(second.transaction_control, ("BEGIN", "COMMIT"))
        statements = ["BEGIN", "SELECT 1", "COMMIT"]
        changed = replace(second, statement_count=3, vector_sha256=contract.canonical_sha256(statements), transaction_control=("BEGIN",))
        payload = {
            "schema": contract.PARSER_SPEC["schema"],
            "source_sha256": changed.sha256,
            "source_size": changed.size,
            "statements": statements,
            "upstream": {
                "commit": contract.PARSER_SPEC["upstreamCommit"], "version": contract.PARSER_SPEC["upstreamVersion"],
                "token": {"path": contract.PARSER_SPEC["tokenPath"], "blob": contract._parser_blob(contract.PARSER_SPEC["tokenBlobParts"], contract.TOKEN_BLOB_PARTS)},
                "state": {"path": contract.PARSER_SPEC["statePath"], "blob": contract._parser_blob(contract.PARSER_SPEC["stateBlobParts"], contract.STATE_BLOB_PARTS)},
            },
            "version": changed.version,
        }
        result = subprocess.CompletedProcess([], 0, contract.canonical_json_bytes(payload).decode("ascii") + "\n", "")
        self.denied(lambda: contract.statement_vectors(self.root, changed, runner=lambda *args, **kwargs: result))


if __name__ == "__main__":
    unittest.main()
