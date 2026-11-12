#!/usr/bin/env python3
"""Build the exact-source PG15 catalog replay for the PG17 index cleanup.

The immutable checked-in migration remains the hosted and PG17 apply source.
Only its executor-version comparison changes for the isolated PG15 source
reconstruction. No statements, dependency checks or transaction guards are
removed, and this module never connects to a database or executes SQL.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


NAME = "20261112111043_deduplicate_equivalent_public_indexes.sql"
SHA256 = "600a236aa10eba6b3c5ab96932fb575867a12cf84bfc9ff03974746339fe59e1"
BYTE_LENGTH = 14_263
PG17_VERSION_GUARD = (
    b"current_setting('server_version_num')::integer / 10000 <> 17"
)
PG15_VERSION_GUARD = (
    b"current_setting('server_version_num')::integer / 10000 <> 15"
)


def transform(source: bytes, name: str = NAME) -> bytes:
    if (
        name != NAME
        or len(source) != BYTE_LENGTH
        or hashlib.sha256(source).hexdigest() != SHA256
    ):
        raise ValueError("PUBLIC_INDEX_DEDUP_PG15_REPLAY_SOURCE_DRIFT")
    if source.count(PG17_VERSION_GUARD) != 1 or PG15_VERSION_GUARD in source:
        raise ValueError("PUBLIC_INDEX_DEDUP_PG15_REPLAY_VERSION_GUARD_DRIFT")

    transformed = source.replace(PG17_VERSION_GUARD, PG15_VERSION_GUARD, 1)
    if transformed.replace(PG15_VERSION_GUARD, PG17_VERSION_GUARD, 1) != source:
        raise ValueError("PUBLIC_INDEX_DEDUP_PG15_REPLAY_BODY_DRIFT")
    return transformed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = transform(args.source.read_bytes(), args.source.name)
    with args.output.open("xb") as destination:
        destination.write(result)


if __name__ == "__main__":
    main()
