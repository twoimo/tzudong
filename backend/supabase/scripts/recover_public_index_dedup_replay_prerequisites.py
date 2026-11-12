#!/usr/bin/env python3
"""Recover one source-defined index for disposable PG15 catalog replay only.

The historical reconstruction lacks this keeper. Extract its exact CREATE
statement from the pinned current prerequisite without changing the operating
migration or its PG15 adapter. This module never connects to a database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


SOURCE_PATH = "backend/supabase/baselines/local/application-prerequisites.sql"
SOURCE_SHA256 = "c4fce4f7ddaf6315474cb3a3d408eef1fb7ff538af7f39183ebdc46828630356"
SOURCE_BYTE_LENGTH = 210_720
INDEX_NAME = "idx_transcript_embeddings_bge_video_id"
INDEX_STATEMENT_SHA256 = "cb2c3de6ec909e758c0a791404c406cad4f622123f180be4b29ddc46beb29ed2"
INDEX_STATEMENT_BYTE_LENGTH = 112

PREFIX = b"""BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = pg_catalog;
DO $public_index_dedup_replay_prerequisite$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::integer / 10000 <> 15
     OR current_setting('transaction_read_only') <> 'off'
     OR to_regnamespace('supabase_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_EXECUTOR_DENIED';
  END IF;
  IF to_regclass('public.transcript_embeddings_bge') IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_TABLE_MISSING';
  END IF;
  IF to_regclass('public.idx_transcript_embeddings_bge_video_id') IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_KEEPER_ALREADY_PRESENT';
  END IF;
END;
$public_index_dedup_replay_prerequisite$;
LOCK TABLE public.transcript_embeddings_bge IN ACCESS EXCLUSIVE MODE;
"""


def recover(source: bytes) -> tuple[bytes, dict]:
    if len(source) != SOURCE_BYTE_LENGTH or hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_SOURCE_DRIFT")
    matches = re.findall(
        rb"^CREATE INDEX idx_transcript_embeddings_bge_video_id [^\n]*;\n",
        source,
        re.MULTILINE,
    )
    if (
        len(matches) != 1
        or len(matches[0]) != INDEX_STATEMENT_BYTE_LENGTH
        or hashlib.sha256(matches[0]).hexdigest() != INDEX_STATEMENT_SHA256
    ):
        raise ValueError("PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_DEFINITION_DRIFT")
    sql = PREFIX + matches[0] + b"COMMIT;\n"
    return sql, {
        "schemaVersion": 1,
        "scope": "current source-only PG15 replay prerequisite generation; not execution or hosted-state evidence",
        "sourcePath": SOURCE_PATH,
        "sourceSha256": SOURCE_SHA256,
        "sourceByteLength": SOURCE_BYTE_LENGTH,
        "outputSha256": hashlib.sha256(sql).hexdigest(),
        "indexes": [{
            "name": "public." + INDEX_NAME,
            "definitionSha256": INDEX_STATEMENT_SHA256,
            "definitionBytes": INDEX_STATEMENT_BYTE_LENGTH,
        }],
        "dataRowsCopied": 0,
        "canonicalMigrationsChanged": False,
        "publicExecutionGranted": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    sql, receipt = recover(args.source.read_bytes())
    with args.output.open("xb") as destination:
        destination.write(sql)
    with args.receipt.open("x", encoding="utf-8") as destination:
        destination.write(json.dumps(receipt, sort_keys=True, indent=2) + "\n")


if __name__ == "__main__":
    main()
