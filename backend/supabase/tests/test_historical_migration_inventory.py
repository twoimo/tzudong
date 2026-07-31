import copy
import json
import tempfile
import unittest
from pathlib import Path

from backend.supabase.scripts import verify_historical_migration_inventory as verifier


class HistoricalMigrationInventoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest_path = (
            Path(__file__).resolve().parents[1]
            / "baselines/historical/pre-20260214-application/MIGRATION_INVENTORY.v1.json"
        )
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def assert_rejected(self, manifest: dict) -> None:
        with self.assertRaises(ValueError):
            verifier.validate_inventory(manifest)

    def test_checked_in_manifest_is_a_valid_inventory_only_record(self) -> None:
        verifier.validate_inventory(self.manifest)
        self.assertEqual(0, verifier.main(["--manifest", str(self.manifest_path)]))

    def test_rejects_replay_authorization_and_wrong_endpoint_constant(self) -> None:
        replayable = copy.deepcopy(self.manifest)
        replayable["replayAuthorized"] = True
        self.assert_rejected(replayable)

        wrong_anchor = copy.deepcopy(self.manifest)
        wrong_anchor["endpointMetadata"]["anchor"]["tree"] = "0" * 40
        self.assert_rejected(wrong_anchor)

    def test_rejects_extra_keys_and_malformed_hashes(self) -> None:
        extra_key = copy.deepcopy(self.manifest)
        extra_key["replayEvidence"] = "invented"
        self.assert_rejected(extra_key)

        malformed = copy.deepcopy(self.manifest)
        malformed["records"][0]["blob"] = "not-a-git-hash"
        self.assert_rejected(malformed)
        malformed_sha256 = copy.deepcopy(self.manifest)
        malformed_sha256["records"][0]["sha256"] = "not-a-sha256"
        self.assert_rejected(malformed_sha256)

        wrong_sha256 = copy.deepcopy(self.manifest)
        wrong_sha256["records"][0]["sha256"] = "0" * 64
        self.assert_rejected(wrong_sha256)

    def test_rejects_duplicate_or_unrecognized_records(self) -> None:
        duplicate = copy.deepcopy(self.manifest)
        duplicate["records"].append(copy.deepcopy(duplicate["records"][0]))
        self.assert_rejected(duplicate)

        unknown = copy.deepcopy(self.manifest)
        unknown["records"][0]["path"] = "supabase/migrations/guessed.sql"
        self.assert_rejected(unknown)

    def test_rejects_noncanonical_replay_gaps(self) -> None:
        missing_gap = copy.deepcopy(self.manifest)
        missing_gap["unresolvedGaps"].pop()
        self.assert_rejected(missing_gap)

    def test_cli_rejects_mutated_manifest(self) -> None:
        mutated = copy.deepcopy(self.manifest)
        mutated["status"] = "replayable"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inventory.json"
            path.write_text(json.dumps(mutated), encoding="utf-8")
            self.assertEqual(1, verifier.main(["--manifest", str(path)]))


if __name__ == "__main__":
    unittest.main()
