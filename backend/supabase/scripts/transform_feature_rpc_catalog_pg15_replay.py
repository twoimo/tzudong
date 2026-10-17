#!/usr/bin/env python3
"""Build the hash-bound PG15 replay for the PG17 feature-RPC migration.

The checked-in migration remains the only hosted apply source.  This transform
only adapts the executor-version check and the PG17 role-membership option
window so the pinned PG15 source-reconstruction database can exercise the
same catalog changes and readback assertions.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


NAME = "20261013190100_g014_feature_rpc_catalog_contract.sql"
SHA256 = "0c3f8b4cadc1d4bb0d88b53de49be34ef8e2751a47bfc18ebad89ae543b4c370"
BYTE_LENGTH = 25_506

PG17_VERSION_GUARD = (
    b"pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17"
)
PG15_VERSION_GUARD = (
    b"pg_catalog.current_setting('server_version_num')::integer / 10000 <> 15"
)

MEMBERSHIP_START = (
    b"CREATE TEMPORARY TABLE pg_temp.g014_feature_self_membership_before ("
)
MEMBERSHIP_END = b"$lease_workflow_owner$;"
RESTORE_START = b"DO $restore_workflow_owner_membership$"
RESTORE_END = b"$restore_workflow_owner_membership$;"

PG15_MEMBERSHIP_WINDOW = b"""-- The pinned source-only database is PG15, where GRANT has no INHERIT/SET
-- options.  Admit one default-option membership only for SET ROLE; the
-- migration's full before/after membership snapshot proves its restoration.
DO $feature_rpc_pg15_membership$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 15
     OR current_user <> 'postgres'
     OR session_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_PG15_REPLAY_DENIED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = 'privacy_workflow_owner'::regrole
      AND membership.member = 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_PG15_SELF_MEMBERSHIP_DENIED';
  END IF;
END;
$feature_rpc_pg15_membership$;

GRANT privacy_workflow_owner TO postgres;"""

PG15_RESTORE_ASSERTION = b"""REVOKE privacy_workflow_owner FROM postgres;

DO $restore_workflow_owner_membership$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = 'privacy_workflow_owner'::regrole
      AND membership.member = 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_PG15_MEMBERSHIP_DRIFT';
  END IF;
END;
$restore_workflow_owner_membership$;"""


def _bounded_block(source: bytes, start: bytes, end: bytes) -> bytes:
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError("G014_FEATURE_RPC_PG15_REPLAY_ANCHOR_DRIFT")
    start_offset = source.index(start)
    end_offset = source.index(end, start_offset) + len(end)
    return source[start_offset:end_offset]


def transform(source: bytes, name: str = NAME) -> bytes:
    if (
        name != NAME
        or len(source) != BYTE_LENGTH
        or hashlib.sha256(source).hexdigest() != SHA256
    ):
        raise ValueError("G014_FEATURE_RPC_PG15_REPLAY_SOURCE_DRIFT")
    if source.count(PG17_VERSION_GUARD) != 1:
        raise ValueError("G014_FEATURE_RPC_PG15_REPLAY_VERSION_GUARD_DRIFT")

    membership_block = _bounded_block(source, MEMBERSHIP_START, MEMBERSHIP_END)
    restore_block = _bounded_block(source, RESTORE_START, RESTORE_END)
    transformed = source.replace(PG17_VERSION_GUARD, PG15_VERSION_GUARD, 1)
    transformed = transformed.replace(membership_block, PG15_MEMBERSHIP_WINDOW, 1)
    transformed = transformed.replace(restore_block, PG15_RESTORE_ASSERTION, 1)

    restored = transformed.replace(PG15_VERSION_GUARD, PG17_VERSION_GUARD, 1)
    restored = restored.replace(PG15_MEMBERSHIP_WINDOW, membership_block, 1)
    restored = restored.replace(PG15_RESTORE_ASSERTION, restore_block, 1)
    if restored != source:
        raise ValueError("G014_FEATURE_RPC_PG15_REPLAY_BODY_DRIFT")
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
