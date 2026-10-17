from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CAPTURE = load_module("compiler_input_manifest", ROOT / "capture-input-manifest.py")
VALIDATOR = load_module("compiler_evidence_validator", ROOT / "validate-evidence.py")


class RetainedInputManifestTests(unittest.TestCase):
    def manifest(self) -> dict[str, object]:
        app = [{"name": "app/a.ts", "contentHash": "a" * 64}]
        dependency = [
            {"name": "package@1.0.0/index.d.ts", "contentHash": "b" * 64}
        ]
        retained = sorted(
            [
                {**entry, "origin": origin}
                for entries, origin in ((app, "app"), (dependency, "dependency"))
                for entry in entries
            ],
            key=lambda entry: entry["name"],
        )
        digest = CAPTURE.digest_inputs(retained)
        compiler_digest = {
            **digest,
            "logicalInputs": digest["logicalInputs"] + 1,
            "logicalInputNamesSha256": "c" * 64,
            "standardLibraryContentSha256": "d" * 64,
        }
        return {
            "appInputManifest": app,
            "dependencyInputManifest": dependency,
            "logicalInputDigests": {
                "native": compiler_digest,
                "compat": {**compiler_digest, "standardLibraryContentSha256": "e" * 64},
            },
            "sourceCoverage": {
                "appInputs": 1,
                "dependencyInputs": 1,
                "nativeStandardLibraryInputs": 1,
                "compatStandardLibraryInputs": 1,
            },
        }

    def test_recomputes_name_and_content_digest_from_retained_entries(self) -> None:
        result = VALIDATOR.validate_retained_input_manifests(
            self.manifest(), CAPTURE.digest_inputs
        )
        self.assertEqual(result["logicalInputs"], 2)

    def test_rejects_omitted_entry(self) -> None:
        manifest = self.manifest()
        manifest["appInputManifest"] = []
        with self.assertRaisesRegex(RuntimeError, "app input count mismatch"):
            VALIDATOR.validate_retained_input_manifests(
                manifest, CAPTURE.digest_inputs
            )

    def test_rejects_duplicate_entry(self) -> None:
        manifest = self.manifest()
        manifest["dependencyInputManifest"].append(
            copy.deepcopy(manifest["dependencyInputManifest"][0])
        )
        manifest["sourceCoverage"]["dependencyInputs"] = 2
        for compiler in ("native", "compat"):
            manifest["logicalInputDigests"][compiler]["logicalInputs"] += 1
        with self.assertRaisesRegex(RuntimeError, "duplicate logical input name"):
            VALIDATOR.validate_retained_input_manifests(
                manifest, CAPTURE.digest_inputs
            )

    def test_rejects_logical_name_tamper(self) -> None:
        manifest = self.manifest()
        manifest["appInputManifest"][0]["name"] = "app/tampered.ts"
        with self.assertRaisesRegex(RuntimeError, "content digest mismatch"):
            VALIDATOR.validate_retained_input_manifests(
                manifest, CAPTURE.digest_inputs
            )

    def test_rejects_content_hash_tamper(self) -> None:
        manifest = self.manifest()
        manifest["appInputManifest"][0]["contentHash"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "content digest mismatch"):
            VALIDATOR.validate_retained_input_manifests(
                manifest, CAPTURE.digest_inputs
            )


if __name__ == "__main__":
    unittest.main()
