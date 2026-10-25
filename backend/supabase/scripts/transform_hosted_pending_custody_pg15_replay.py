#!/usr/bin/env python3
"""Exact-source PG15 catalog replay, never an operating custody installation.

The PG17 migration and operating statement vector stay immutable. This adapter
maps only the PG17 executor/membership/ACL representation to the isolated PG15
source-reconstruction contract. All feature definitions, identity/source checks,
cutover bounds, snapshots and G014 assertions still execute in one transaction.
No hosted migration ledger is admitted or manufactured by this replay.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


NAME = "20261025063810_hosted_pending_atomic_delivery.sql"
SHA256 = "02bc9c5dab0e16a46a28a7993e9c75524813d0bc713c60782881eb4d5ddd2165"
BYTE_LENGTH = 46_164

PG17_MEMBERSHIP = b"""  IF pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole)<>1
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
       AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN"""
PG15_MEMBERSHIP = b"""  -- The PG15 reconstruction has no postgres self-membership at baseline.
  IF pg_catalog.pg_has_role('postgres','privacy_workflow_owner','MEMBER')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole) THEN"""

# (original, replay, exact occurrence count). Reverse substitution must recover
# the same original bytes; nothing else may disappear from the replay artifact.
REPLACEMENTS = (
    (
        b"OR pg_catalog.current_setting('server_version_num')::integer<>170006",
        b"""OR pg_catalog.current_setting('server_version_num')::integer/10000<>15
     OR pg_catalog.to_regnamespace('supabase_migrations') IS NOT NULL
     OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL""",
        1,
    ),
    (PG17_MEMBERSHIP, PG15_MEMBERSHIP, 1),
    (
        b"345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d",
        b"5515d2269ddf0ffa26a414f21989b60dce1a41002440f0a81d3c646b34774b40",
        1,
    ),
    (
        b"GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;",
        b"GRANT privacy_workflow_owner TO postgres;",
        2,
    ),
    (
        b"REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;",
        b"REVOKE privacy_workflow_owner FROM postgres;",
        2,
    ),
    (
        b"current_setting('server_version_num')::int/10000 <> 17",
        b"current_setting('server_version_num')::int/10000 <> 15",
        1,
    ),
    (
        b"current_setting('server_version_num')<>'170006'",
        b"current_setting('server_version_num')::int/10000<>15",
        1,
    ),
    (b"{postgres=arwdDxtm/postgres}", b"{postgres=arwdDxt/postgres}", 1),
    (
        b" IF pg_has_role('postgres','privacy_workflow_owner','SET') OR pg_has_role('postgres','privacy_workflow_owner','USAGE')",
        b" IF pg_has_role('postgres','privacy_workflow_owner','MEMBER') OR pg_has_role('postgres','privacy_workflow_owner','USAGE')",
        1,
    ),
)


def transform(source: bytes, name: str = NAME) -> bytes:
    if (name != NAME or len(source) != BYTE_LENGTH
            or hashlib.sha256(source).hexdigest() != SHA256):
        raise ValueError("PENDING_CUSTODY_PG15_REPLAY_SOURCE_DRIFT")
    result = source
    for original, replay, count in REPLACEMENTS:
        if result.count(original) != count or replay in result:
            raise ValueError("PENDING_CUSTODY_PG15_REPLAY_ANCHOR_DRIFT")
        result = result.replace(original, replay)
    if restore(result) != source:
        raise ValueError("PENDING_CUSTODY_PG15_REPLAY_BODY_DRIFT")
    return result


def restore(replay: bytes) -> bytes:
    result = replay
    for original, adapted, count in reversed(REPLACEMENTS):
        if result.count(adapted) != count:
            raise ValueError("PENDING_CUSTODY_PG15_REPLAY_BODY_DRIFT")
        result = result.replace(adapted, original)
    if len(result) != BYTE_LENGTH or hashlib.sha256(result).hexdigest() != SHA256:
        raise ValueError("PENDING_CUSTODY_PG15_REPLAY_BODY_DRIFT")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()
    result = transform(args.source.read_bytes(), args.source.name)
    with args.output.open("xb") as destination:
        destination.write(result)
    receipt = {
        "schema": "hosted-pending-custody-pg15-source-replay-v1",
        "source_sha256": SHA256,
        "replay_sha256": hashlib.sha256(result).hexdigest(),
        "disposition": "source-only-schema-acl-and-cutover-replay",
        "required_replay_pg_major": 15,
        "required_operating_server_version_num": 170006,
        "transaction": "psql-single-transaction",
        "operating_admission_executed": False,
        "operating_ledger_admission_verified": False,
        "operating_membership_options_verified": False,
    }
    with args.receipt.open("x", encoding="utf-8") as destination:
        json.dump(receipt, destination, sort_keys=True, indent=2)
        destination.write("\n")


if __name__ == "__main__":
    main()
