#!/usr/bin/env python3
"""Regenerate or verify the current source-and-evidence byte map."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any


REPOSITORY = Path(__file__).resolve().parents[4]
MAP_RELATIVE = Path("apps/web/performance/ci-20261010/source-and-evidence-map.json")
SIDECAR_RELATIVE = Path(
    "apps/web/performance/ci-20261010/source-and-evidence-map.json.sha256"
)
MAP_PATH = REPOSITORY / MAP_RELATIVE
SIDECAR_PATH = REPOSITORY / SIDECAR_RELATIVE
HISTORICAL_DIRECTORY = Path(
    "apps/web/performance/ci-20261010/"
    "historical-source-and-evidence-map-2517b68c"
)
PROVENANCE_DIRECTORY = Path(
    "apps/web/performance/ci-20261010/local-compiler-provenance-20261015"
)
MONITOR_HISTORICAL_DIRECTORY = Path(
    "apps/web/performance/ci-monitor-20261011/historical-artifact-map-73a439d4"
)
VERIFIER_RELATIVE = Path(
    "apps/web/performance/ci-20261010/verify-source-and-evidence-map.py"
)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(raw: str) -> Path:
    relative = Path(raw)
    if (
        not raw
        or relative.is_absolute()
        or "\\" in raw
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise RuntimeError(f"unsafe map path: {raw}")
    resolved = (REPOSITORY / relative).resolve(strict=True)
    try:
        resolved.relative_to(REPOSITORY)
    except ValueError:
        raise RuntimeError(f"map path escaped repository: {raw}") from None
    if not resolved.is_file():
        raise RuntimeError(f"map path is not a file: {raw}")
    return relative


def inventory_entry(relative: Path) -> dict[str, Any]:
    path = REPOSITORY / relative
    return {
        "path": relative.as_posix(),
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
    }


def atomic_write(path: Path, content: str) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def load_map() -> dict[str, Any]:
    payload = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1 or not isinstance(payload.get("files"), list):
        raise RuntimeError("source-and-evidence map schema mismatch")
    return payload


def expanded_paths(payload: dict[str, Any]) -> list[Path]:
    paths = {safe_relative(item.get("path")) for item in payload["files"]}
    paths.add(VERIFIER_RELATIVE)
    for directory in (
        HISTORICAL_DIRECTORY,
        PROVENANCE_DIRECTORY,
        MONITOR_HISTORICAL_DIRECTORY,
    ):
        absolute = REPOSITORY / directory
        if not absolute.is_dir():
            raise RuntimeError(f"required evidence directory is missing: {directory}")
        paths.update(
            path.relative_to(REPOSITORY)
            for path in absolute.iterdir()
            if path.is_file()
        )
    paths.discard(MAP_RELATIVE)
    paths.discard(SIDECAR_RELATIVE)
    return sorted(paths, key=lambda path: path.as_posix())


def write_map() -> None:
    payload = load_map()
    updated = {
        "schemaVersion": payload["schemaVersion"],
        "baseCommit": payload["baseCommit"],
        "files": [inventory_entry(path) for path in expanded_paths(payload)],
    }
    atomic_write(MAP_PATH, canonical_json(updated))
    atomic_write(
        SIDECAR_PATH,
        f"{sha256_file(MAP_PATH)}  {MAP_PATH.name}\n",
    )


def verify_map() -> dict[str, Any]:
    payload = load_map()
    paths = [safe_relative(item.get("path")) for item in payload["files"]]
    names = [path.as_posix() for path in paths]
    if names != sorted(names) or len(names) != len(set(names)):
        raise RuntimeError("map paths must be unique and sorted")
    forbidden = {MAP_RELATIVE.as_posix(), SIDECAR_RELATIVE.as_posix()}
    if forbidden & set(names):
        raise RuntimeError("map or sidecar must not hash itself")
    mismatches = []
    for item, relative in zip(payload["files"], paths):
        actual = inventory_entry(relative)
        if item != actual:
            mismatches.append(
                {
                    "path": relative.as_posix(),
                    "expectedBytes": item.get("bytes"),
                    "actualBytes": actual["bytes"],
                    "expectedSha256": item.get("sha256"),
                    "actualSha256": actual["sha256"],
                }
            )
    map_sha = sha256_file(MAP_PATH)
    expected_sidecar = f"{map_sha}  {MAP_PATH.name}\n"
    sidecar_matches = SIDECAR_PATH.read_text(encoding="utf-8") == expected_sidecar
    result = {
        "schema": "tzudong-ci-performance/v1/source-evidence-map-validation",
        "fileCount": len(paths),
        "mapSha256": map_sha,
        "sidecarMatches": sidecar_matches,
        "selfHashEntries": sorted(forbidden & set(names)),
        "mismatches": mismatches,
    }
    if mismatches or not sidecar_matches:
        raise RuntimeError(canonical_json(result).strip())
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.write:
        write_map()
    print(canonical_json(verify_map()), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
