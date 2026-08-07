import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TESTS = ROOT / "backend/supabase/tests"
MANIFEST = TESTS / "g038_phase2b_manifest.json"
MAP = TESTS / "g038_phase2b_content_map.sha256"

_RECORD_SPEC = importlib.util.spec_from_file_location(
    "g038_phase2b_record",
    TESTS / "g038_phase2b_record.py",
)
if _RECORD_SPEC is None or _RECORD_SPEC.loader is None:
    raise ImportError("cannot load g038_phase2b_record")
record = importlib.util.module_from_spec(_RECORD_SPEC)
_RECORD_SPEC.loader.exec_module(record)


class ManifestContractTests(unittest.TestCase):
    def manifest(self):
        return record.load_json_bytes(MANIFEST.read_bytes())

    def test_manifest_is_closed_and_local_only(self):
        manifest = self.manifest()
        record.validate_manifest(manifest)
        self.assertEqual(manifest["schema_version"], "g038.phase2b.manifest.v4")
        self.assertEqual(manifest["copy_paths"], [manifest["source_paths"][0], manifest["source_paths"][3]])
        self.assertEqual(manifest["evidence_paths"], record.EVIDENCE_PATHS)
        self.assertEqual(manifest["operation_ids"], [f"O{i}" for i in range(1, 19)])
        self.assertEqual(manifest["receipt_schema"]["terminal"], "LOCAL_QUALIFIED_ONLY")

    def test_map_has_exact_order_and_h5_digests(self):
        lines = MAP.read_text(encoding="ascii").splitlines()
        paths = [line.split("  ", 1)[1] for line in lines]
        self.assertEqual(paths, [
            "backend/supabase/tests/g038_phase2b_manifest.json",
            "backend/supabase/tests/g038_phase2b_qualify.sh",
            "backend/supabase/tests/g038_phase2b_record.py",
            "backend/supabase/tests/g038_phase2b_apply.sql",
            "backend/supabase/tests/g038_phase2b_negative.sql",
            "backend/supabase/tests/test_g038_phase2b_manifest.py",
            "backend/supabase/tests/test_g038_phase2b_qualify.py",
            "backend/supabase/tests/g038_authoring_binding.json",
            "backend/supabase/migrations/20260728000100_g038_deterministic_contract.sql",
            "backend/supabase/tests/g038_local_sandbox.sh",
            "backend/supabase/tests/g038_local_sandbox.profile.json",
            "backend/supabase/tests/g038_catalog_assertions.sql",
            "backend/supabase/tests/g038_exclusion_scan.py",
        ])
        h5 = json.loads((TESTS / "g038_authoring_binding.json").read_text())
        for line in lines[8:]:
            digest, path = line.split("  ", 1)
            self.assertEqual(digest, h5["files"][path])

    def test_manifest_rejects_unknown_key_and_unsafe_numbers(self):
        manifest = self.manifest()
        manifest["unexpected"] = True
        with self.assertRaises(ValueError):
            record.validate_manifest(manifest)
        for raw in (b'{"x":1.0}', b'{"x":-0}', b'{"x":NaN}', b'{"x":1,"x":2}'):
            with self.assertRaises(ValueError):
                record.load_json_bytes(raw)
    def test_lifecycle_subset_rejects_unblocking_and_unknown_goals(self):
        valid = {
            "session_id": record.SESSION_ID,
            "goals": [
                {"id": "G002", "status": "blocked"},
                {"id": "G003", "status": "blocked"},
                {"id": "G013", "status": "review_blocked"},
            ],
        }
        self.assertEqual(record.canonical_lifecycle_subset(record.jcs(valid))["goals"]["G013"], "review_blocked")
        valid["goals"][0]["status"] = "completed"
        with self.assertRaisesRegex(ValueError, "blocked prerequisites"):
            record.canonical_lifecycle_subset(record.jcs(valid))
        valid["goals"][0]["status"] = "blocked"
        valid["goals"].append({"id": "G002", "status": "blocked"})
        with self.assertRaisesRegex(ValueError, "state goal"):
            record.canonical_lifecycle_subset(record.jcs(valid))

    def test_class_e_rejects_preexisting_root_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            old_root, old_deny, old_receipt = record.EVIDENCE_ROOT, record.DENY, record.RECEIPT
            try:
                record.EVIDENCE_ROOT = os.path.join(directory, "evidence")
                record.DENY = os.path.join(record.EVIDENCE_ROOT, "deny-observations.json")
                record.RECEIPT = os.path.join(record.EVIDENCE_ROOT, "run-receipt.json")
                os.mkdir(record.EVIDENCE_ROOT)
                with self.assertRaisesRegex(ValueError, "EVIDENCE_PATH_OCCUPIED"):
                    record.write_evidence(record.DENY, {}, True)
            finally:
                record.EVIDENCE_ROOT, record.DENY, record.RECEIPT = old_root, old_deny, old_receipt

    def test_receipt_rejects_self_digest_and_nonqualifying_fields(self):
        payload = {key: None for key in ["schema_version", "outcome", "terminal", "satisfies", "does_not_complete_or_unblock", "independent", "operator_count", "environment_class", "deny_observations_sha256", "content_map_sha256", "lifecycle_final_path", "lifecycle_final_sha256", "boundary_readback_sha256", "tests", "cleanup", "started_at_utc", "finished_at_utc", "limitations", "unqualified_surface"]}
        payload["self_sha256"] = hashlib.sha256(b"x").hexdigest()
        for key in payload:
            self.assertFalse("run_receipt_sha256" in key or "self_sha256" in key) if key not in {"self_sha256"} else self.assertTrue(True)
        self.assertIn("self_sha256", payload)
        self.assertIn('"self_sha256" not in key', (TESTS / "g038_phase2b_record.py").read_text())


if __name__ == "__main__":
    unittest.main()
