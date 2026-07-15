from __future__ import annotations

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
VERIFIER = SUPABASE / "scripts/verify_historical_source_archive.py"
BASELINE = SUPABASE / "baselines/historical/pre-20260214-application"
ARCHIVE = BASELINE / "HISTORICAL_SOURCES.v1.zip"
MANIFEST = BASELINE / "HISTORICAL_SOURCES.v1.json"


class HistoricalSourceArchiveTests(unittest.TestCase):
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

    def update_manifest_archive_hash(self) -> None:
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        manifest["archiveSha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.manifest.write_text(json.dumps(manifest) + "\n", encoding="utf-8")

    def test_offline_artifact_verifies(self) -> None:
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("verified 35 inventory-only source entries", result.stdout)

    def test_rejects_archive_byte_tampering(self) -> None:
        data = bytearray(self.archive.read_bytes())
        data[len(data) // 2] ^= 1
        self.archive.write_bytes(data)
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)

    def test_rejects_compression_even_with_updated_archive_hash(self) -> None:
        with zipfile.ZipFile(self.archive) as source:
            entries = [(info.filename, source.read(info)) for info in source.infolist()]
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for name, data in entries:
                target.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
        self.update_manifest_archive_hash()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("metadata drifted", result.stderr)

    def test_rejects_zip_slip_extra_entry(self) -> None:
        with zipfile.ZipFile(self.archive, "a", compression=zipfile.ZIP_STORED) as target:
            target.writestr("../escape.sql", b"select 1;")
        self.update_manifest_archive_hash()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate, missing, or extra", result.stderr)

    def test_rejects_manifest_extra_key_and_authorization(self) -> None:
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        manifest["unexpected"] = True
        self.manifest.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("schema", result.stderr)

        manifest.pop("unexpected")
        manifest["reconstructionAuthorized"] = True
        self.manifest.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unauthorized inventory", result.stderr)


if __name__ == "__main__":
    unittest.main()
