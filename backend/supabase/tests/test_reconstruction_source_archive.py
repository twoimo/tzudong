from __future__ import annotations

import importlib.util
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SUPABASE = Path(__file__).resolve().parents[1]
VERIFIER = SUPABASE / "scripts/verify_reconstruction_source_archive.py"
BASELINE = SUPABASE / "baselines/historical/pre-20260214-application"
ARCHIVE = BASELINE / "RECONSTRUCTION_SOURCES.v1.zip"
MANIFEST = BASELINE / "RECONSTRUCTION_SOURCES.v1.json"


class ReconstructionSourceArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.work = Path(self.tempdir.name)
        self.archive = self.work / ARCHIVE.name
        self.manifest = self.work / MANIFEST.name
        shutil.copyfile(ARCHIVE, self.archive)
        shutil.copyfile(MANIFEST, self.manifest)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def verify(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VERIFIER), "--archive", str(self.archive), "--manifest", str(self.manifest)],
            text=True,
            capture_output=True,
            check=False,
        )

    def manifest_data(self) -> dict[str, object]:
        return json.loads(self.manifest.read_text(encoding="utf-8"))

    def write_manifest(self, manifest: dict[str, object]) -> None:
        self.manifest.write_text(json.dumps(manifest) + "\n", encoding="utf-8")

    def update_archive_hash(self) -> None:
        manifest = self.manifest_data()
        manifest["archiveSha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.write_manifest(manifest)

    def test_offline_candidate_verifies(self) -> None:
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("verified 10 unauthorized ordered reconstruction source entries", result.stdout)
    def test_historical_prerequisite_is_exact_and_precedes_optimization(self) -> None:
        entries = self.manifest_data()["entries"]
        self.assertEqual(
            entries[1],
            {
                "ordinal": 1,
                "path": "supabase/migrations/temp/20251210_redesign_submissions_v2.sql",
                "blobSha1": "254765d14e47bc2754fcbbcecc1365153f944505",
                "byteLength": 16452,
                "sha256": "3e5bf820c508f24f02b3a81843707758642a53c1d90084f201bb60f7836bb674",
                "role": "historical_prerequisite_candidate",
            },
        )
        self.assertEqual(
            entries[2]["path"],
            "apps/web/supabase/migrations/20251219_db_performance_optimization.sql",
        )
        with zipfile.ZipFile(self.archive) as archive, zipfile.ZipFile(BASELINE / "HISTORICAL_SOURCES.v1.zip") as historical_archive:
            self.assertEqual(archive.namelist()[1], entries[1]["path"])
            self.assertEqual(archive.read(entries[1]["path"]), historical_archive.read(entries[1]["path"]))
    def test_truncated_function_exclusion_is_exact_and_archive_bound(self) -> None:
        manifest = self.manifest_data()
        exclusions = manifest["compatibilityExclusions"]
        self.assertEqual(
            [(item["startLine"], item["endLine"], item["byteLength"], item["sha256"], item["objectIdentity"], item["reasonCode"]) for item in exclusions],
            [(916, 954, 1252, "e30512d59c749072280bd463d932cf54fba534b8d7244740a60ff0c4fa3603e0", "public.batch_insert_restaurants_from_jsonl(jsonb[])", "truncated_legacy_function_source")],
        )
        self.assertTrue(all(item["ordinal"] == 0 and item["disposition"] == "excluded_without_replacement" and item["evidenceScope"] == "candidate_only" for item in exclusions))
        self.assertNotIn("public.refresh_materialized_views()", [item["objectIdentity"] for item in exclusions])
        self.assertNotIn("public.get_restaurant_stats()", [item["objectIdentity"] for item in exclusions])
        self.assertNotIn("public.get_user_leaderboard()", [item["objectIdentity"] for item in exclusions])
        self.assertNotIn("public.get_popular_reviews()", [item["objectIdentity"] for item in exclusions])
        spec = importlib.util.spec_from_file_location("reconstruction_verifier", VERIFIER)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        self.assertEqual(tuple(exclusions), verifier.COMPATIBILITY_EXCLUSIONS)
        with zipfile.ZipFile(self.archive) as archive:
            source = archive.read(exclusions[0]["sourcePath"])
        verifier.verify_compatibility_exclusions(source, exclusions)
        changed = bytearray(source)
        changed[sum(len(line) for line in source.splitlines(keepends=True)[:915])] ^= 1
        with self.assertRaisesRegex(verifier.VerificationError, "bytes mismatch"):
            verifier.verify_compatibility_exclusions(bytes(changed), exclusions)
        relocation = manifest["compatibilityRelocations"][0]
        self.assertEqual(
            (relocation["startLine"], relocation["endLine"], relocation["byteLength"], relocation["sha256"], relocation["identities"], relocation["reasonCode"], relocation["disposition"], relocation["evidenceScope"]),
            (1802, 1819, 860, "3c34d8721bcf7454e59b2dd15bc0895ec7bb91aed8e8caafe20acf423bc0ceb4", ["extensions schema", "pg_trgm", "uuid-ossp", "btree_gin"], "extension_prerequisites_declared_after_dependents", "relocated_before_source_without_modification", "candidate_only"),
        )
        verifier.verify_compatibility_blocks(source, exclusions, [relocation])

    def test_rejects_compatibility_exclusion_mutation_or_replacement(self) -> None:
        manifest = self.manifest_data()
        manifest["compatibilityExclusions"][0]["endLine"] = 953
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("compatibility exclusion contract drifted", result.stderr)

        manifest = self.manifest_data()
        manifest["compatibilityExclusions"][0]["endLine"] = 954
        manifest["compatibilityExclusions"][0]["replacementSql"] = "SELECT 1"
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("compatibility exclusion contract drifted", result.stderr)
        manifest = self.manifest_data()
        manifest["compatibilityExclusions"][0].pop("replacementSql")
        manifest["compatibilityRelocations"][0]["startLine"] = 1801
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("compatibility relocation contract drifted", result.stderr)

    def test_rejects_archive_byte_drift(self) -> None:
        data = bytearray(self.archive.read_bytes())
        data[len(data) // 2] ^= 1
        self.archive.write_bytes(data)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("archive SHA-256 mismatch", result.stderr)

    def test_rejects_repacked_or_reordered_archive_even_with_manifest_hash_update(self) -> None:
        with zipfile.ZipFile(self.archive, "a", compression=zipfile.ZIP_STORED) as target:
            target.writestr("extra.sql", b"select 1;", compress_type=zipfile.ZIP_STORED)
        self.update_archive_hash()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("constants drifted", result.stderr)

        shutil.copyfile(ARCHIVE, self.archive)
        with zipfile.ZipFile(self.archive) as source:
            members = [(info.filename, source.read(info)) for info in source.infolist()]
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_STORED) as target:
            for name, data in reversed(members):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                target.writestr(info, data, compress_type=zipfile.ZIP_STORED)
        self.update_archive_hash()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("constants drifted", result.stderr)

    def test_rejects_authorization_prohibited_word_and_entry_identity_drift(self) -> None:
        manifest = self.manifest_data()
        manifest["reconstructionAuthorized"] = True
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("authorized", result.stderr)

        manifest["reconstructionAuthorized"] = False
        manifest["purpose"] = "self-baseline dump"
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("prohibited", result.stderr)

        manifest["purpose"] = (
            "source-only reconstruction candidate; not historical application proof or hosted-state evidence"
        )
        manifest["archiveSha256"] = manifest["archiveSha256"].upper()
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid archive SHA-256", result.stderr)

        manifest["archiveSha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        manifest["historicalSourceArchiveSha256"] = "0" * 64
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("constants drifted", result.stderr)

        manifest["historicalSourceArchiveSha256"] = (
            "1b221e44a5a7de028a6a3eeec160562f7dc6172c6b7eb83c630a00c7149e5e11"
        )
        entries = manifest["entries"]
        self.assertIsInstance(entries, list)
        entries[1]["blobSha1"] = "0" * 40
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("entry metadata mismatch", result.stderr)

        with zipfile.ZipFile(self.archive) as source:
            members = [(info.filename, source.read(info)) for info in source.infolist()]
        changed = b"select 1;\n"
        members[1] = (members[1][0], changed)
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_STORED) as target:
            for name, data in members:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                target.writestr(info, data, compress_type=zipfile.ZIP_STORED)
        entries[1]["blobSha1"] = hashlib.sha1(b"blob 10\0" + changed).hexdigest()
        entries[1]["byteLength"] = len(changed)
        entries[1]["sha256"] = hashlib.sha256(changed).hexdigest()
        manifest["archiveSha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.write_manifest(manifest)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("constants drifted", result.stderr)
    def test_rejects_historical_manifest_baseline_drift(self) -> None:
        spec = importlib.util.spec_from_file_location("reconstruction_verifier", VERIFIER)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        historical_manifest = self.work / "HISTORICAL_SOURCES.v1.json"
        shutil.copyfile(BASELINE / historical_manifest.name, historical_manifest)
        data = json.loads(historical_manifest.read_text(encoding="utf-8"))
        data["entries"][0]["sha256"] = "0" * 64
        historical_manifest.write_text(json.dumps(data), encoding="utf-8")
        verifier.HISTORICAL_MANIFEST = historical_manifest
        entries = verifier.validate_manifest(self.manifest_data())
        with self.assertRaisesRegex(verifier.VerificationError, "source manifest"):
            verifier.verify_historical_sources(entries)


if __name__ == "__main__":
    unittest.main()
