from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_validator():
    path = ROOT / "validate-evidence.py"
    spec = importlib.util.spec_from_file_location("compiler_provenance_validator", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATOR = load_validator()


def retained_manifest() -> dict[str, object]:
    app = [{"name": "app/a.ts", "contentHash": "a" * 64}]
    dependency = [
        {"name": "package@1.0.0/index.d.ts", "contentHash": "b" * 64}
    ]
    pairs = [[entry["name"], entry["contentHash"]] for entry in app + dependency]
    non_library_digest = VALIDATOR.sha256_bytes(
        VALIDATOR.compact_json(pairs).encode("utf-8")
    )
    compiler_digest = {
        "logicalInputs": 3,
        "logicalInputNamesSha256": "c" * 64,
        "nonLibraryContentSha256": non_library_digest,
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


def parity_fixture() -> tuple[dict[str, object], dict[str, object]]:
    manifest = retained_manifest()
    native = manifest["logicalInputDigests"]["native"]
    compat = manifest["logicalInputDigests"]["compat"]
    payload = {
        "status": "passed",
        "diagnostics": 0,
        "logicalInputs": native["logicalInputs"],
        "logicalInputNamesSha256": native["logicalInputNamesSha256"],
        "nonLibraryContentSha256": native["nonLibraryContentSha256"],
        "standardLibraryContentSha256": {
            "native": native["standardLibraryContentSha256"],
            "compat": compat["standardLibraryContentSha256"],
        },
    }
    stdout = f"{VALIDATOR.compact_json(payload)}\n".encode("utf-8")
    stdout_sha256 = VALIDATOR.sha256_bytes(stdout)
    command = {
        "command": "parity",
        "success": True,
        "stdoutSha256": stdout_sha256,
        "stdoutBytes": len(stdout),
    }
    raw = {
        group: [
            {
                "runs": [
                    {"commands": [copy.deepcopy(command)]},
                    {"commands": [copy.deepcopy(command)]},
                ]
            }
            for _ in range(7)
        ]
        for group in ("measuredPairs", "aaPairs")
    }
    manifest.update(
        {
            "measuredParityOutput": {
                "commands": 28,
                "uniqueOutputs": 1,
                "stdoutSha256": stdout_sha256,
                "stdoutBytes": len(stdout),
            },
            "postMeasurementParityPayload": payload,
            "postMeasurementParityStdoutSha256": stdout_sha256,
        }
    )
    return raw, manifest


class RetainedInputManifestTests(unittest.TestCase):
    def test_recomputes_retained_name_and_content_digest(self) -> None:
        result = VALIDATOR.validate_retained_input_manifests(retained_manifest())
        self.assertEqual(result["logicalInputs"], 2)

    def test_rejects_omitted_entry(self) -> None:
        manifest = retained_manifest()
        manifest["appInputManifest"] = []
        with self.assertRaisesRegex(RuntimeError, "app input count mismatch"):
            VALIDATOR.validate_retained_input_manifests(manifest)

    def test_rejects_duplicate_entry(self) -> None:
        manifest = retained_manifest()
        manifest["dependencyInputManifest"].append(
            copy.deepcopy(manifest["dependencyInputManifest"][0])
        )
        manifest["sourceCoverage"]["dependencyInputs"] = 2
        for compiler in ("native", "compat"):
            manifest["logicalInputDigests"][compiler]["logicalInputs"] += 1
        with self.assertRaisesRegex(RuntimeError, "duplicate logical input name"):
            VALIDATOR.validate_retained_input_manifests(manifest)

    def test_rejects_logical_name_tamper(self) -> None:
        manifest = retained_manifest()
        manifest["appInputManifest"][0]["name"] = "app/tampered.ts"
        with self.assertRaisesRegex(RuntimeError, "content digest mismatch"):
            VALIDATOR.validate_retained_input_manifests(manifest)

    def test_rejects_content_hash_tamper(self) -> None:
        manifest = retained_manifest()
        manifest["appInputManifest"][0]["contentHash"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "content digest mismatch"):
            VALIDATOR.validate_retained_input_manifests(manifest)


class MeasuredParityOutputTests(unittest.TestCase):
    def test_binds_all_28_commands_to_retained_payload(self) -> None:
        raw, manifest = parity_fixture()
        result = VALIDATOR.validate_measured_parity_outputs(raw, manifest)
        self.assertEqual(result["commands"], 28)

    def test_rejects_raw_parity_hash_tamper(self) -> None:
        raw, manifest = parity_fixture()
        command = raw["measuredPairs"][0]["runs"][0]["commands"][0]
        command["stdoutSha256"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "divergent outputs"):
            VALIDATOR.validate_measured_parity_outputs(raw, manifest)

    def test_rejects_raw_parity_bytes_tamper(self) -> None:
        raw, manifest = parity_fixture()
        raw["aaPairs"][0]["runs"][0]["commands"][0]["stdoutBytes"] += 1
        with self.assertRaisesRegex(RuntimeError, "divergent outputs"):
            VALIDATOR.validate_measured_parity_outputs(raw, manifest)

    def test_rejects_unsuccessful_parity_command(self) -> None:
        raw, manifest = parity_fixture()
        raw["aaPairs"][0]["runs"][0]["commands"][0]["success"] = False
        with self.assertRaisesRegex(RuntimeError, "command output mismatch"):
            VALIDATOR.validate_measured_parity_outputs(raw, manifest)

    def test_rejects_missing_parity_command(self) -> None:
        raw, manifest = parity_fixture()
        raw["aaPairs"][0]["runs"][0]["commands"] = []
        with self.assertRaisesRegex(RuntimeError, "command count mismatch"):
            VALIDATOR.validate_measured_parity_outputs(raw, manifest)

    def test_rejects_payload_digest_tamper(self) -> None:
        raw, manifest = parity_fixture()
        manifest["postMeasurementParityPayload"]["nonLibraryContentSha256"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "payload does not match"):
            VALIDATOR.validate_measured_parity_outputs(raw, manifest)


if __name__ == "__main__":
    unittest.main()
