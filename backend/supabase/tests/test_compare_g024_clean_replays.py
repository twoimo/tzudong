import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "compare_g024_clean_replays.py"
spec = importlib.util.spec_from_file_location("g024_compare", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

GENERATOR_ARTIFACTS = (
    "00000000000001-auth-schema.sql", "BOOTSTRAP_SOURCES.v1.json",
    "G026_RECONSTRUCTION_BUNDLE.v4.json", "G026_RECONSTRUCTION_REPAIRS.v4.sql",
    "G026_RECONSTRUCTION_TRANSITION.v4.sql", "GOTRUE_MIGRATIONS.v1.json",
    "GOTRUE_PLATFORM.v1.json", "RECONSTRUCTION_SOURCES.v1.json",
    "RECONSTRUCTION_SOURCES.v1.zip", "STORAGE_TENANT_MIGRATIONS.v1.json",
    "auth-schema-migrations.expected.tsv", "auth-schema-migrations.tsv",
    "catalog-manifest-tuples.sql", "catalog-manifest.jsonl", "duplicate-migration-source-pairs.sha256", "evidence-scope.txt",
    "g026-behavior-receipt.json", "g026-readback-receipt.json",
    "g026-semantic-receipt.json", "g026-validation-ledger.json",
    "gotrue-container-migration-files.tsv", "gotrue-inventory-files.tsv",
    "gotrue-schema-migrations.expected.tsv", "gotrue-schema-migrations.tsv",
    "initialization-inputs.sha256", "migration-chain.txt",
    "platform-auth-schema-migrations.expected.tsv", "platform-auth-schema-migrations.manifest.tsv",
    "postgres-image-00000000000001-auth-schema.sql",
    "pre-20260214-overlap-classification.jsonl",
    "reconstruction-compatibility-exclusions.jsonl",
    "reconstruction-compatibility-relocations.jsonl", "reconstruction-source-members.tsv",
    "storage-container-migration-files.tsv", "storage-inventory-files.tsv", "storage-migration-inventory-source-map.tsv",
    "storage-migration-ledger.tsv", "storage-migration-native-file-ledger.expected.tsv",
    "storage-migration-native-source-map.tsv",
)


def make_candidate(root, **metadata_changes):
    files = {name: "artifact\n" for name in GENERATOR_ARTIFACTS}
    files.update({
        "migration-chain.txt": "001_init.sql\n",
        "catalog-manifest.jsonl": '{"id":1}\n',
        "catalog-manifest-tuples.sql": "INSERT INTO catalog VALUES (1);\n",
        "initialization-inputs.sha256": "a" * 64 + "  seed.sql\n",
        "pre-20260214-overlap-classification.jsonl": '{"classification":"unchanged"}\n',
        "RECONSTRUCTION_SOURCES.v1.zip": "archive bytes",
        "RECONSTRUCTION_SOURCES.v1.json": '[{"path":"migration.sql"}]\n',
        "reconstruction-source-members.tsv": "1\tmigration.sql\t" + "b" * 64 + "\tprivate/migration.sql\n",
        "reconstruction-compatibility-exclusions.jsonl": '{"path":"excluded.sql"}\n',
        "reconstruction-compatibility-relocations.jsonl": '{"path":"relocated.sql"}\n',
        "evidence-scope.txt": module.SCOPE + "\n",
        "G026_RECONSTRUCTION_BUNDLE.v4.json": '{"schemaVersion":4}\n',
        "G026_RECONSTRUCTION_TRANSITION.v4.sql": "BEGIN;\nCOMMIT;\n",
        "G026_RECONSTRUCTION_REPAIRS.v4.sql": "SELECT 1;\n",
        "g026-validation-ledger.json": '[{"ordinal":0},{"ordinal":6}]\n',
        "g026-semantic-receipt.json": '{"semantic":true}\n',
        "g026-readback-receipt.json": '{"readback":true}\n',
        "g026-behavior-receipt.json": '{"behavior":true}\n',
    })
    for name, content in files.items():
        (root / name).write_text(content, encoding="utf-8")
    hashes = {name: digest(root / name) for name in files}
    metadata = {name: "f" * 64 for name in module.HASH_FIELDS}
    metadata.update({
        "source_sha": "a" * 40,
        "row_count": 1,
        "reconstruction_entries": [{"path": "migration.sql"}],
        "reconstruction_compatibility_exclusions": [{"path": "excluded.sql"}],
        "reconstruction_compatibility_relocations": [{"path": "relocated.sql"}],
        "evidence_scope": module.SCOPE,
        "reconstruction_authorized": False,
        "g026_slots": {
            "phaseAAfterOrdinal": 2,
            "phaseBBeforeMigration": "20260713002000_g014_public_api_private_boundary.sql",
        },
        "g026_validation_ledger": [
            {"ordinal": 0, "mode": "off", "kind": "preexisting_ordinal0_body_deferral"},
            {"ordinal": 6, "mode": "off", "kind": "g026_ordinal6_quarantine"},
        ],
    })
    for name in module.REQUIRED_METADATA - set(metadata):
        metadata[name] = "supabase/component:v1"
    metadata.update({
        "migration_chain_sha256": hashes["migration-chain.txt"],
        "jsonl_sha256": hashes["catalog-manifest.jsonl"],
        "tuple_evidence_sha256": hashes["catalog-manifest-tuples.sql"],
        "initialization_inputs_sha256": hashes["initialization-inputs.sha256"],
        "reconstruction_archive_sha256": hashes["RECONSTRUCTION_SOURCES.v1.zip"],
        "reconstruction_manifest_sha256": hashes["RECONSTRUCTION_SOURCES.v1.json"],
        "reconstruction_members_sha256": hashes["reconstruction-source-members.tsv"],
        "overlap_report_sha256": hashes["pre-20260214-overlap-classification.jsonl"],
        "reconstruction_compatibility_exclusions_sha256": hashes["reconstruction-compatibility-exclusions.jsonl"],
        "reconstruction_compatibility_relocations_sha256": hashes["reconstruction-compatibility-relocations.jsonl"],
        "g026_bundle_sha256": hashes["G026_RECONSTRUCTION_BUNDLE.v4.json"],
        "g026_transition_sha256": hashes["G026_RECONSTRUCTION_TRANSITION.v4.sql"],
        "g026_repairs_sha256": hashes["G026_RECONSTRUCTION_REPAIRS.v4.sql"],
        "g026_validation_ledger_sha256": hashes["g026-validation-ledger.json"],
        "g026_semantic_receipt_sha256": hashes["g026-semantic-receipt.json"],
        "g026_readback_receipt_sha256": hashes["g026-readback-receipt.json"],
        "g026_behavior_receipt_sha256": hashes["g026-behavior-receipt.json"],
    })
    metadata.update(metadata_changes)
    (root / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    manifest = tuple(sorted((*files, "metadata.json", module.ARTIFACT_MANIFEST)))
    (root / module.ARTIFACT_MANIFEST).write_text("\n".join(manifest) + "\n", encoding="utf-8")
    sums = {name: digest(root / name) for name in manifest}
    (root / module.SHA256SUMS).write_text("".join(f"{sums[name]}  {name}\n" for name in manifest), encoding="utf-8")


class CompareG024CleanReplaysTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.left, self.right = self.root / "left", self.root / "right"
        self.left.mkdir(); self.right.mkdir()
        make_candidate(self.left); make_candidate(self.right)

    def tearDown(self):
        self.temp.cleanup()

    def assert_rejected(self, **changes):
        make_candidate(self.right, **changes)
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "dual-clean-replay.json")

    def test_success_writes_candidate_verdict(self):
        output = self.root / "dual-clean-replay.json"
        result = module.compare(self.left, self.right, output)
        self.assertEqual("passed", result["verdict"])
        self.assertEqual("a" * 40, result["sourceGitOid"])
        self.assertEqual("sha1", result["sourceGitOidAlgorithm"])
        self.assertNotIn("sourceSha256", result)
        self.assertEqual(result, json.loads(output.read_text(encoding="utf-8")))

    def test_success_receipt_is_symmetric_when_inputs_are_swapped(self):
        left_output = self.root / "left-first.json"
        right_output = self.root / "right-first.json"
        left_first = module.compare(self.left, self.right, left_output)
        right_first = module.compare(self.right, self.left, right_output)
        self.assertEqual(left_first, right_first)
        self.assertEqual(left_output.read_bytes(), right_output.read_bytes())

    def test_rejects_reordered_sha256sums_entries(self):
        sums_path = self.right / "SHA256SUMS"
        sums_path.write_text(
            "\n".join(reversed(sums_path.read_text(encoding="utf-8").splitlines())) + "\n",
            encoding="utf-8",
        )
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_extra_sha256sums_entry(self):
        with (self.right / "SHA256SUMS").open("a", encoding="utf-8") as handle:
            handle.write("0" * 64 + "  unexpected.txt\n")
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_missing_sha256sums_entry(self):
        sums_path = self.right / "SHA256SUMS"
        sums_path.write_text(
            "\n".join(
                line
                for line in sums_path.read_text(encoding="utf-8").splitlines()
                if not line.endswith("  metadata.json")
            ) + "\n",
            encoding="utf-8",
        )
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_reordered_artifact_manifest(self):
        manifest_path = self.right / module.ARTIFACT_MANIFEST
        manifest_path.write_text(
            "\n".join(reversed(manifest_path.read_text(encoding="utf-8").splitlines())) + "\n",
            encoding="utf-8",
        )
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_extra_or_missing_artifact_manifest_entry(self):
        manifest_path = self.right / module.ARTIFACT_MANIFEST
        lines = manifest_path.read_text(encoding="utf-8").splitlines()
        manifest_path.write_text("\n".join([*lines, "unexpected.txt"]) + "\n", encoding="utf-8")
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")
        make_candidate(self.right)
        manifest_path.write_text("\n".join(lines[1:]) + "\n", encoding="utf-8")
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_unequal_valid_manifests_symmetrically(self):
        extra_name = "additional-evidence.txt"
        (self.right / extra_name).write_text("additional\n", encoding="utf-8")
        manifest_path = self.right / module.ARTIFACT_MANIFEST
        manifest = sorted([
            *manifest_path.read_text(encoding="utf-8").splitlines(),
            extra_name,
        ])
        manifest_path.write_text("\n".join(manifest) + "\n", encoding="utf-8")
        sums_path = self.right / module.SHA256SUMS
        sums_path.write_text(
            "".join(f"{digest(self.right / name)}  {name}\n" for name in manifest),
            encoding="utf-8",
        )
        for left, right in ((self.left, self.right), (self.right, self.left)):
            with self.subTest(left=left.name):
                with self.assertRaises(module.ComparisonError):
                    module.compare(left, right, self.root / f"{left.name}.json")
    def test_rejects_directory_and_symlink_in_candidate_root(self):
        (self.right / "unexpected-directory").mkdir()
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")
        (self.right / "unexpected-directory").rmdir()
        (self.right / "unexpected-link").symlink_to(self.right / "migration-chain.txt")
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")
    def test_rejects_unexpected_regular_file_in_candidate_root(self):
        (self.right / "unexpected.txt").write_text("unexpected\n", encoding="utf-8")
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_tampered_artifact(self):
        (self.right / "migration-chain.txt").write_text("tampered\n", encoding="utf-8")
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_missing_required_file(self):
        (self.right / "RECONSTRUCTION_SOURCES.v1.json").unlink()
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")
    def test_rejects_g026_slot_or_receipt_drift(self):
        self.assert_rejected(g026_slots={})
        (self.right / "g026-behavior-receipt.json").write_text("tampered\n", encoding="utf-8")
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.root / "out.json")

    def test_rejects_scope_drift(self):
        self.assert_rejected(evidence_scope="historical proof")

    def test_rejects_secret_or_url_identity(self):
        self.assert_rejected(storage_declared_image="https://token@example.test/storage")

    def test_rejects_metadata_mismatch_and_output_in_input(self):
        self.assert_rejected(row_count=2)
        with self.assertRaises(module.ComparisonError):
            module.compare(self.left, self.right, self.left / "dual-clean-replay.json")

    def test_difference_error_names_only_drifted_contract_fields(self):
        make_candidate(self.right, partition_version="v2")
        with self.assertRaisesRegex(module.ComparisonError, r"metadata=partition_version; artifacts="):
            module.compare(self.left, self.right, self.root / "out.json")


if __name__ == "__main__":
    unittest.main()
