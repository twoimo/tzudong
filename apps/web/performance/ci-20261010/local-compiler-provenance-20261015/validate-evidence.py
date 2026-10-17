#!/usr/bin/env python3
"""Validate and inventory the compiler provenance rerun."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
BENCHMARK_PATH = ROOT.parent / "local-compiler" / "benchmark.py"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_benchmark():
    spec = importlib.util.spec_from_file_location(
        "compiler_provenance_benchmark", BENCHMARK_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load retained benchmark scorer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and re.fullmatch(r"[0-9a-f]{64}", value) is not None
    )


def validate_retained_input_manifests(manifest: dict[str, Any]) -> dict[str, Any]:
    """Recompute every digest supported by the retained non-library inputs."""

    coverage = manifest.get("sourceCoverage")
    compiler_digests = manifest.get("logicalInputDigests")
    require(isinstance(coverage, dict), "source coverage is malformed")
    require(
        isinstance(compiler_digests, dict)
        and set(compiler_digests) == {"native", "compat"},
        "logical input digests are malformed",
    )

    retained_inputs: list[dict[str, str]] = []
    seen_names: set[str] = set()
    for manifest_key, origin, count_key in (
        ("appInputManifest", "app", "appInputs"),
        ("dependencyInputManifest", "dependency", "dependencyInputs"),
    ):
        entries = manifest.get(manifest_key)
        expected_count = coverage.get(count_key)
        require(isinstance(entries, list), f"{origin} input manifest is malformed")
        require(
            isinstance(expected_count, int)
            and not isinstance(expected_count, bool)
            and expected_count >= 0,
            f"{origin} input count is malformed",
        )
        require(len(entries) == expected_count, f"{origin} input count mismatch")
        names: list[str] = []
        for entry in entries:
            require(
                isinstance(entry, dict)
                and set(entry) == {"name", "contentHash"},
                f"{origin} input entry is malformed",
            )
            name = entry["name"]
            content_hash = entry["contentHash"]
            require(
                isinstance(name, str) and name and not name.startswith("lib:"),
                f"{origin} logical input name is malformed",
            )
            require(is_sha256(content_hash), f"{origin} content hash is malformed")
            require(name not in seen_names, f"duplicate logical input name: {name}")
            seen_names.add(name)
            names.append(name)
            retained_inputs.append({"name": name, "contentHash": content_hash})
        require(names == sorted(names), f"{origin} input manifest is not sorted")

    retained_inputs.sort(key=lambda item: item["name"])
    non_library_pairs = [
        [item["name"], item["contentHash"]] for item in retained_inputs
    ]
    recalculated = {
        "logicalInputs": len(retained_inputs),
        "nonLibraryContentSha256": sha256_bytes(
            compact_json(non_library_pairs).encode("utf-8")
        ),
    }
    native_digest = compiler_digests.get("native")
    compat_digest = compiler_digests.get("compat")
    expected_digest_keys = {
        "logicalInputs",
        "logicalInputNamesSha256",
        "nonLibraryContentSha256",
        "standardLibraryContentSha256",
    }
    for compiler, digest, count_key in (
        ("native", native_digest, "nativeStandardLibraryInputs"),
        ("compat", compat_digest, "compatStandardLibraryInputs"),
    ):
        require(
            isinstance(digest, dict) and set(digest) == expected_digest_keys,
            f"{compiler} logical input digest is malformed",
        )
        library_count = coverage.get(count_key)
        require(
            isinstance(library_count, int)
            and not isinstance(library_count, bool)
            and library_count >= 0,
            f"{compiler} standard library input count is malformed",
        )
        require(
            digest["logicalInputs"] == len(retained_inputs) + library_count,
            f"{compiler} logical input count mismatch",
        )
        require(
            digest["nonLibraryContentSha256"]
            == recalculated["nonLibraryContentSha256"],
            "retained logical input name/content digest mismatch",
        )
        require(
            is_sha256(digest["logicalInputNamesSha256"])
            and is_sha256(digest["standardLibraryContentSha256"]),
            f"{compiler} logical input hash is malformed",
        )
    require(
        native_digest["logicalInputNamesSha256"]
        == compat_digest["logicalInputNamesSha256"],
        "compiler logical input name digests differ",
    )
    require(
        native_digest["logicalInputs"] == compat_digest["logicalInputs"],
        "compiler logical input counts differ",
    )
    return recalculated


def validate_measured_parity_outputs(
    raw: dict[str, Any], manifest: dict[str, Any]
) -> dict[str, Any]:
    """Bind the retained manifest payload to all 28 measured parity commands."""

    parity_commands: list[dict[str, Any]] = []
    for group in ("measuredPairs", "aaPairs"):
        pairs = raw.get(group)
        require(isinstance(pairs, list), f"{group} is malformed")
        for pair in pairs:
            require(isinstance(pair, dict), f"{group} pair is malformed")
            runs = pair.get("runs")
            require(isinstance(runs, list), f"{group} runs are malformed")
            for sequence in runs:
                require(isinstance(sequence, dict), f"{group} sequence is malformed")
                commands = sequence.get("commands")
                require(isinstance(commands, list), f"{group} commands are malformed")
                for command in commands:
                    require(isinstance(command, dict), f"{group} command is malformed")
                    if command.get("command") == "parity":
                        parity_commands.append(command)

    measured = manifest.get("measuredParityOutput")
    require(
        isinstance(measured, dict)
        and set(measured)
        == {"commands", "uniqueOutputs", "stdoutSha256", "stdoutBytes"},
        "measured parity output is malformed",
    )
    require(
        measured["commands"] == len(parity_commands) == 28,
        "measured parity command count mismatch",
    )
    require(
        measured["uniqueOutputs"] == 1
        and is_sha256(measured["stdoutSha256"])
        and isinstance(measured["stdoutBytes"], int)
        and not isinstance(measured["stdoutBytes"], bool)
        and measured["stdoutBytes"] > 0,
        "measured parity output contract is malformed",
    )
    outputs = {
        (command.get("stdoutSha256"), command.get("stdoutBytes"))
        for command in parity_commands
    }
    require(
        len(outputs) == measured["uniqueOutputs"] == 1,
        "measured parity commands have divergent outputs",
    )
    require(
        all(
            command.get("success") is True
            and command.get("stdoutSha256") == measured["stdoutSha256"]
            and command.get("stdoutBytes") == measured["stdoutBytes"]
            for command in parity_commands
        ),
        "retained parity command output mismatch",
    )

    compiler_digests = manifest["logicalInputDigests"]
    native_digest = compiler_digests["native"]
    compat_digest = compiler_digests["compat"]
    expected_payload = {
        "status": "passed",
        "diagnostics": 0,
        "logicalInputs": native_digest["logicalInputs"],
        "logicalInputNamesSha256": native_digest["logicalInputNamesSha256"],
        "nonLibraryContentSha256": native_digest["nonLibraryContentSha256"],
        "standardLibraryContentSha256": {
            "native": native_digest["standardLibraryContentSha256"],
            "compat": compat_digest["standardLibraryContentSha256"],
        },
    }
    require(
        manifest.get("postMeasurementParityPayload") == expected_payload,
        "post-measurement parity payload does not match logical input digests",
    )
    stdout = f"{compact_json(expected_payload)}\n".encode("utf-8")
    stdout_sha256 = sha256_bytes(stdout)
    require(
        manifest.get("postMeasurementParityStdoutSha256") == stdout_sha256,
        "post-measurement parity stdout hash mismatch",
    )
    require(
        measured["stdoutSha256"] == stdout_sha256
        and measured["stdoutBytes"] == len(stdout),
        "measured parity output does not match retained parity payload",
    )
    return {
        "commands": len(parity_commands),
        "stdoutBytes": len(stdout),
        "stdoutSha256": stdout_sha256,
    }


def main() -> int:
    names = (
        "configuration.json",
        "raw.json",
        "summary.json",
        "report.md",
        "input-manifest.json",
        "compiler-provenance-inventory.json",
        "sanitization-receipt.json",
    )
    paths = {name: ROOT / name for name in names}
    for name, path in paths.items():
        require(path.is_file(), f"missing evidence: {name}")
        require(b"/Users/" not in path.read_bytes(), f"private path remains: {name}")
    config = json.loads(paths["configuration.json"].read_text(encoding="utf-8"))
    raw = json.loads(paths["raw.json"].read_text(encoding="utf-8"))
    summary = json.loads(paths["summary.json"].read_text(encoding="utf-8"))
    manifest = json.loads(paths["input-manifest.json"].read_text(encoding="utf-8"))
    inventory = json.loads(
        paths["compiler-provenance-inventory.json"].read_text(encoding="utf-8")
    )
    receipt = json.loads(
        paths["sanitization-receipt.json"].read_text(encoding="utf-8")
    )
    benchmark = load_benchmark()
    retained_input_digest = validate_retained_input_manifests(manifest)
    measured_parity = validate_measured_parity_outputs(raw, manifest)
    checks = {
        "embeddedConfigMatches": raw["metadata"]["experimentConfig"] == config,
        "benchmarkScriptHashMatches": (
            sha256_file(BENCHMARK_PATH)
            == config["expectedBenchmarkScriptSha256"]
            == raw["metadata"]["benchmarkScriptSha256"]
        ),
        "scorerRegenerationMatches": benchmark.analyze(raw) == summary,
        "sampleCountsPreserved": (
            len(raw["measuredPairs"])
            == summary["sampleCountPaired"]
            == config["pairs"]
            == 7
            and len(raw["aaPairs"])
            == summary["sampleCountAaPaired"]
            == config["aaPairs"]
            == 7
        ),
        "sourceContractUnchanged": raw["metadata"]["sourceContractUnchanged"] is True,
        "expectedNonAdmissionPreserved": (
            summary["evidenceAdmission"]["admitted"] is False
            and summary["evidenceAdmission"]["officialApproval"] is False
            and summary["evidenceAdmission"]["budgetChecks"]["noiseP95"] is False
        ),
        "inputManifestBoundToRaw": (
            manifest["benchmarkRawSha256"]
            == receipt["privateHashes"]["raw.json"]
            and manifest["gitHead"] == raw["metadata"]["gitHead"]
            and manifest["sourceTreeSha"] == raw["metadata"]["sourceTreeSha"]
            and sha256_file(paths["input-manifest.json"])
            == receipt["privateHashes"]["input-manifest.json"]
            == receipt["publicHashes"]["input-manifest.json"]
        ),
        "retainedInputEntriesRecomputeNameContentDigest": True,
        "allMeasuredParityOutputsBoundToRetainedPayload": True,
    }
    expected_hashes = config["expectedDependencyHashes"]
    checks["dependencyHashesStable"] = (
        len(expected_hashes) == 12
        and expected_hashes
        == raw["metadata"]["dependencyHashes"]
        == raw["metadata"]["snapshotDependencyHashes"]
    )
    role_paths = config["compilerProvenance"]
    roles = raw["metadata"]["compilerProvenance"]
    checks["executedCompilerRolesBound"] = (
        set(role_paths) == benchmark.COMPILER_PROVENANCE_ROLES
        and len(roles) == 8
        and all(
            roles[role]
            == {"path": relative, "sha256": expected_hashes[relative]}
            for role, relative in role_paths.items()
        )
    )
    inventory_body = {
        key: value
        for key, value in inventory.items()
        if key not in {
            "dependencyFileCount",
            "executedCompilerRoleCount",
            "inventorySha256",
        }
    }
    checks["provenanceInventorySelfHashes"] = (
        inventory["dependencyFileCount"] == 12
        and inventory["executedCompilerRoleCount"] == 8
        and inventory["inventorySha256"]
        == sha256_bytes(canonical_json(inventory_body).encode("utf-8"))
    )
    public_hashes = receipt["publicHashes"]
    checks["sanitizedPublicHashesMatch"] = all(
        public_hashes[name] == sha256_file(path)
        for name, path in paths.items()
        if name != "sanitization-receipt.json"
    )
    require(all(checks.values()), f"evidence validation failed: {checks}")
    validation = {
        "schema": "tzudong-ci-performance/v1/compiler-provenance-validation",
        "checks": checks,
        "dependencyFileCount": inventory["dependencyFileCount"],
        "executedCompilerRoleCount": inventory["executedCompilerRoleCount"],
        "provenanceInventorySha256": inventory["inventorySha256"],
        "sampleCountPaired": summary["sampleCountPaired"],
        "sampleCountAaPaired": summary["sampleCountAaPaired"],
        "retainedInputManifest": retained_input_digest,
        "measuredParityOutput": measured_parity,
        "admitted": summary["evidenceAdmission"]["admitted"],
        "failedBudgetChecks": sorted(
            key
            for key, passed in summary["evidenceAdmission"]["budgetChecks"].items()
            if not passed
        ),
    }
    validation_path = ROOT / "validation.json"
    validation_path.write_text(canonical_json(validation), encoding="utf-8")
    roles_by_name = {
        "build-evidence.py": "path sanitizer and provenance inventory builder",
        "validate-evidence.py": "deterministic evidence validator",
        "configuration.json": "pre-measurement frozen contract",
        "raw.json": "path-sanitized raw measurement",
        "summary.json": "unchanged scorer output",
        "report.md": "unchanged measurement report",
        "input-manifest.json": "logical compiler input names and content hashes",
        "compiler-provenance-inventory.json": "executed compiler byte inventory",
        "sanitization-receipt.json": "private-to-public hash and redaction receipt",
        "validation.json": "deterministic validation result",
    }
    artifacts = []
    for name, role in roles_by_name.items():
        path = ROOT / name
        require(path.is_file(), f"missing artifact-map input: {name}")
        artifacts.append(
            {
                "path": name,
                "role": role,
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    artifact_map = {
        "schema": "tzudong-ci-performance/v1/artifact-map",
        "artifacts": artifacts,
    }
    artifact_map_path = ROOT / "artifact-map.json"
    artifact_map_path.write_text(canonical_json(artifact_map), encoding="utf-8")
    (ROOT / "artifact-map.json.sha256").write_text(
        f"{sha256_file(artifact_map_path)}  artifact-map.json\n", encoding="utf-8"
    )
    print(canonical_json(validation), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
