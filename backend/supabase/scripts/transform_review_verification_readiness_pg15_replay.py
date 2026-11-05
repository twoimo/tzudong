#!/usr/bin/env python3
"""Build the hash-bound PG15 replay for the PG17 readiness successor.

The checked-in migration remains the only hosted apply source. This adapter
changes only its executor-version guard so the pinned PG15 source-reconstruction
database can apply and read back the same capability function definition.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


NAME = "20261016090000_review_verification_delete_guard_readiness.sql"
SHA256 = "469dbea773cc838feecb4519ca1b5c03e9ea2fab32462007f7769c5ed1b7fed9"
BYTE_LENGTH = 19_008
PG17_VERSION_GUARD = (
    b"pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17"
)
PG15_VERSION_GUARD = (
    b"pg_catalog.current_setting('server_version_num')::integer / 10000 <> 15"
)


def transform(source: bytes, name: str = NAME) -> bytes:
    if (
        name != NAME
        or len(source) != BYTE_LENGTH
        or hashlib.sha256(source).hexdigest() != SHA256
    ):
        raise ValueError("REVIEW_VERIFICATION_READINESS_PG15_REPLAY_SOURCE_DRIFT")
    if source.count(PG17_VERSION_GUARD) != 1 or PG15_VERSION_GUARD in source:
        raise ValueError("REVIEW_VERIFICATION_READINESS_PG15_REPLAY_GUARD_DRIFT")

    transformed = source.replace(PG17_VERSION_GUARD, PG15_VERSION_GUARD, 1)
    if transformed.replace(PG15_VERSION_GUARD, PG17_VERSION_GUARD, 1) != source:
        raise ValueError("REVIEW_VERIFICATION_READINESS_PG15_REPLAY_BODY_DRIFT")
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
