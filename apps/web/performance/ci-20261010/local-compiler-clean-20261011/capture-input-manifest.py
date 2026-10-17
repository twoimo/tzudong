#!/usr/bin/env python3
"""Bind compiler logical inputs to a completed frozen-source benchmark.

The public manifest contains logical names and content hashes only. Absolute
source and dependency paths are used for containment checks but are never
written to the artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
from pathlib import Path
from typing import Any


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def run(*argv: str, cwd: Path) -> subprocess.CompletedProcess[bytes]:
    environment = dict(os.environ)
    environment.update({"LC_ALL": "C", "LANG": "C", "NO_COLOR": "1"})
    return subprocess.run(
        list(argv),
        cwd=cwd,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def git_text(repository: Path, *arguments: str) -> str:
    completed = run("git", "-C", str(repository), *arguments, cwd=repository)
    if completed.returncode != 0:
        raise RuntimeError(f"git {' '.join(arguments)} failed")
    return completed.stdout.decode("utf-8").strip()


def contained(root: Path, target: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def package_input_name(absolute: Path) -> str | None:
    normalized = absolute.as_posix()
    marker = "/node_modules/"
    index = normalized.rfind(marker)
    if index < 0:
        return None
    remainder = normalized[index + len(marker) :].split("/")
    package_parts = remainder[:2] if remainder[0].startswith("@") else remainder[:1]
    if not package_parts or any(not part for part in package_parts):
        raise RuntimeError("malformed node_modules compiler input")
    package_root = Path(normalized[: index + len(marker)]) / "/".join(package_parts)
    try:
        metadata = json.loads((package_root / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("cannot identify a compiler dependency input") from error
    name = metadata.get("name")
    version = metadata.get("version")
    if not isinstance(name, str) or not isinstance(version, str):
        raise RuntimeError("compiler dependency package metadata is malformed")
    subpath = "/".join(remainder[len(package_parts) :])
    return f"{name}@{version}{f'/{subpath}' if subpath else ''}"


def logical_input(
    raw_path: str,
    kind: str,
    app_root: Path,
    native_lib: Path,
    compat_lib: Path,
) -> dict[str, str]:
    absolute = Path(raw_path.strip()).resolve(strict=True)
    content_hash = sha256_file(absolute)
    is_native_lib = contained(native_lib, absolute)
    is_compat_lib = contained(compat_lib, absolute)
    if is_native_lib or is_compat_lib:
        if (kind == "native" and not is_native_lib) or (
            kind == "compat" and not is_compat_lib
        ):
            raise RuntimeError(f"{kind} compiler used the opposite standard library")
        return {
            "name": f"lib:{absolute.name}",
            "compiler": "typescript@7.0.2" if kind == "native" else "typescript@6.0.2",
            "contentHash": content_hash,
            "origin": "standard-library",
        }
    package_name = package_input_name(absolute)
    if package_name is not None:
        return {
            "name": package_name,
            "contentHash": content_hash,
            "origin": "dependency",
        }
    if not contained(app_root, absolute):
        raise RuntimeError("compiler input escaped both the app and dependency roots")
    return {
        "name": absolute.relative_to(app_root).as_posix(),
        "contentHash": content_hash,
        "origin": "app",
    }


def collect_inputs(
    node: Path,
    app_root: Path,
    kind: str,
    native_lib: Path,
    compat_lib: Path,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    entrypoint = (
        app_root / "node_modules/@typescript/native/bin/tsc"
        if kind == "native"
        else app_root / "node_modules/typescript/bin/tsc6"
    )
    arguments = [
        str(node),
        str(entrypoint),
        "--project",
        str(app_root / "tsconfig.json"),
        "--noEmit",
        "--pretty",
        "false",
        "--incremental",
        "false",
        *( ["--checkers", "4"] if kind == "native" else ["--stableTypeOrdering"] ),
        "--listFilesOnly",
    ]
    completed = run(*arguments, cwd=app_root)
    if completed.returncode != 0 or completed.stderr.strip():
        raise RuntimeError(f"{kind} --listFilesOnly failed or wrote stderr")
    paths = [line for line in completed.stdout.decode("utf-8").splitlines() if line.strip()]
    if not paths:
        raise RuntimeError(f"{kind} --listFilesOnly returned no inputs")
    unique: dict[str, dict[str, str]] = {}
    for raw_path in paths:
        item = logical_input(raw_path, kind, app_root, native_lib, compat_lib)
        existing = unique.get(item["name"])
        if existing and existing["contentHash"] != item["contentHash"]:
            raise RuntimeError(f"{kind} logical input has conflicting content")
        unique[item["name"]] = item
    return sorted(unique.values(), key=lambda item: item["name"]), {
        "exitCode": completed.returncode,
        "stdoutBytes": len(completed.stdout),
        "stdoutSha256": sha256_bytes(completed.stdout),
        "stderrBytes": len(completed.stderr),
        "listedPaths": len(paths),
        "uniqueLogicalInputs": len(unique),
    }


def digest_inputs(inputs: list[dict[str, str]]) -> dict[str, Any]:
    names = [item["name"] for item in inputs]
    non_library = [
        [item["name"], item["contentHash"]]
        for item in inputs
        if not item["name"].startswith("lib:")
    ]
    libraries = [
        {
            "name": item["name"],
            "compiler": item["compiler"],
            "contentHash": item["contentHash"],
        }
        for item in inputs
        if item["name"].startswith("lib:")
    ]
    return {
        "logicalInputs": len(inputs),
        "logicalInputNamesSha256": sha256_bytes(compact_json(names).encode("utf-8")),
        "nonLibraryContentSha256": sha256_bytes(
            compact_json(non_library).encode("utf-8")
        ),
        "standardLibraryContentSha256": sha256_bytes(
            compact_json(libraries).encode("utf-8")
        ),
    }


def measured_parity_contract(raw: dict[str, Any]) -> dict[str, Any]:
    records = []
    for group in ("measuredPairs", "aaPairs"):
        for pair in raw.get(group, []):
            for sequence in pair.get("runs", []):
                for command in sequence.get("commands", []):
                    if command.get("command") == "parity":
                        records.append(
                            (
                                command.get("success"),
                                command.get("stdoutSha256"),
                                command.get("stdoutBytes"),
                            )
                        )
    if len(records) != 28 or not all(record[0] is True for record in records):
        raise RuntimeError("completed benchmark does not contain 28 successful parity commands")
    payloads = {(record[1], record[2]) for record in records}
    if len(payloads) != 1:
        raise RuntimeError("measured parity output was not deterministic")
    stdout_sha256, stdout_bytes = next(iter(payloads))
    return {
        "commands": len(records),
        "uniqueOutputs": len(payloads),
        "stdoutSha256": stdout_sha256,
        "stdoutBytes": stdout_bytes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--expected-source-tree", required=True)
    args = parser.parse_args()
    repository = args.repository.resolve(strict=True)
    app_root = (repository / "apps/web").resolve(strict=True)
    output = args.output.resolve()
    if output.exists():
        raise RuntimeError("output already exists")
    head = git_text(repository, "rev-parse", "--verify", "HEAD^{commit}")
    source_tree = git_text(repository, "rev-parse", "--verify", "HEAD:apps/web")
    status = git_text(
        repository,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        "apps/web",
    )
    if head != args.expected_head or source_tree != args.expected_source_tree or status:
        raise RuntimeError("input-manifest source is not the expected clean Git tree")
    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    if raw.get("status") != "completed":
        raise RuntimeError("benchmark raw evidence is not complete")
    measured_contract = measured_parity_contract(raw)
    parity = run(
        str(args.node),
        "scripts/run-typecheck.mjs",
        "--compiler",
        "parity",
        cwd=app_root,
    )
    if parity.returncode != 0 or parity.stderr:
        raise RuntimeError("post-measurement parity command failed")
    if (
        sha256_bytes(parity.stdout) != measured_contract["stdoutSha256"]
        or len(parity.stdout) != measured_contract["stdoutBytes"]
    ):
        raise RuntimeError("post-measurement parity output differs from every measured run")
    parity_payload = json.loads(parity.stdout)
    machine = platform.machine()
    native_lib = (
        app_root / f"node_modules/@typescript/typescript-{platform.system().lower()}-{machine}/lib"
    ).resolve(strict=True)
    compat_lib = (app_root / "node_modules/@typescript/old/lib").resolve(strict=True)
    native_inputs, native_command = collect_inputs(
        args.node, app_root, "native", native_lib, compat_lib
    )
    compat_inputs, compat_command = collect_inputs(
        args.node, app_root, "compat", native_lib, compat_lib
    )
    native_digest = digest_inputs(native_inputs)
    compat_digest = digest_inputs(compat_inputs)
    native_names = [item["name"] for item in native_inputs]
    compat_names = [item["name"] for item in compat_inputs]
    native_non_library = [
        [item["name"], item["contentHash"]]
        for item in native_inputs
        if not item["name"].startswith("lib:")
    ]
    compat_non_library = [
        [item["name"], item["contentHash"]]
        for item in compat_inputs
        if not item["name"].startswith("lib:")
    ]
    if native_names != compat_names or native_non_library != compat_non_library:
        raise RuntimeError("native and compatibility logical inputs differ")
    if parity_payload != {
        "status": "passed",
        "diagnostics": 0,
        "logicalInputs": native_digest["logicalInputs"],
        "logicalInputNamesSha256": native_digest["logicalInputNamesSha256"],
        "nonLibraryContentSha256": native_digest["nonLibraryContentSha256"],
        "standardLibraryContentSha256": {
            "native": native_digest["standardLibraryContentSha256"],
            "compat": compat_digest["standardLibraryContentSha256"],
        },
    }:
        raise RuntimeError("captured --listFilesOnly manifest does not bind to parity output")
    tracked = {
        path.removeprefix("apps/web/")
        for path in git_text(repository, "ls-tree", "-r", "--name-only", "HEAD", "apps/web").splitlines()
    }
    app_inputs = [item for item in native_inputs if item["origin"] == "app"]
    untracked_app_inputs = sorted(
        item["name"] for item in app_inputs if item["name"] not in tracked
    )
    dependency_inputs = [
        {"name": item["name"], "contentHash": item["contentHash"]}
        for item in native_inputs
        if item["origin"] == "dependency"
    ]
    app_manifest = [
        {"name": item["name"], "contentHash": item["contentHash"]}
        for item in app_inputs
    ]
    manifest = {
        "schema": "tzudong-ci-performance/v1/compiler-input-manifest",
        "gitHead": head,
        "sourceTreeSha": source_tree,
        "benchmarkRawSha256": sha256_file(args.raw),
        "measuredParityOutput": measured_contract,
        "postMeasurementParityPayload": parity_payload,
        "postMeasurementParityStdoutSha256": sha256_bytes(parity.stdout),
        "listFilesOnlyCommands": {"native": native_command, "compat": compat_command},
        "logicalInputDigests": {
            "native": native_digest,
            "compat": compat_digest,
        },
        "sourceCoverage": {
            "allAppInputsTracked": not untracked_app_inputs,
            "appInputs": len(app_manifest),
            "trackedAppInputs": len(app_manifest) - len(untracked_app_inputs),
            "untrackedOrIgnoredAppInputs": untracked_app_inputs,
            "dependencyInputs": len(dependency_inputs),
            "nativeStandardLibraryInputs": sum(
                item["origin"] == "standard-library" for item in native_inputs
            ),
            "compatStandardLibraryInputs": sum(
                item["origin"] == "standard-library" for item in compat_inputs
            ),
        },
        "appInputManifest": app_manifest,
        "dependencyInputManifest": dependency_inputs,
        "privacy": {
            "absolutePathsRetained": False,
            "logicalNamesAndContentHashesOnly": True,
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical_json(manifest), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
