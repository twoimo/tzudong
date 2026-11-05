#!/usr/bin/env python3
"""Wrap the held OCR successor for the isolated PG15 source-only replay.

The checked-in migration remains the only hosted apply source. The source-only
catalog generator has no operating Supabase migration ledger, while the held
successor requires that relation before installing its catalog objects. This
adapter creates one empty, exact three-column fixture, embeds the pinned raw
migration bytes, checks the unsealed held state, and removes only its fixture.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


NAME = "20261018152032_receipt_ocr_definitive_credential_rejection_release.sql"
SHA256 = "9dc92d7b42f8329d16b61ac51bf0b05a8533a1655a94faa8cd74e3d9a92fe74c"
BYTE_LENGTH = 41_664

PREFIX = b"""-- PG15 source-only replay fixture; never operating ledger state.
DO $receipt_ocr_source_replay_admission$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 15
    OR current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR pg_catalog.to_regnamespace('supabase_migrations') IS NOT NULL
    OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_SOURCE_REPLAY_LEDGER_FIXTURE_DENIED';
  END IF;
END;
$receipt_ocr_source_replay_admission$;

CREATE SCHEMA supabase_migrations AUTHORIZATION postgres;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name text,
  statements text[]
);

CREATE TEMPORARY TABLE pg_temp.receipt_ocr_source_replay_fixture_guard (
  schema_oid oid PRIMARY KEY,
  relation_oid oid UNIQUE NOT NULL,
  catalog_digest text CHECK (catalog_digest ~ '^[0-9a-f]{64}$')
) ON COMMIT PRESERVE ROWS;

INSERT INTO pg_temp.receipt_ocr_source_replay_fixture_guard (
  schema_oid,
  relation_oid
) VALUES (
  'supabase_migrations'::pg_catalog.regnamespace,
  'supabase_migrations.schema_migrations'::pg_catalog.regclass
);

DO $receipt_ocr_source_replay_fixture_readback$
DECLARE
  fixture pg_temp.receipt_ocr_source_replay_fixture_guard%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture
  FROM pg_temp.receipt_ocr_source_replay_fixture_guard;

  IF fixture.schema_oid <> 'supabase_migrations'::pg_catalog.regnamespace
    OR fixture.relation_oid <> 'supabase_migrations.schema_migrations'::pg_catalog.regclass
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = fixture.relation_oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND (
          (attribute.attname = 'version' AND attribute.atttypid = 'text'::pg_catalog.regtype)
          OR (attribute.attname = 'name' AND attribute.atttypid = 'text'::pg_catalog.regtype)
          OR (attribute.attname = 'statements' AND attribute.atttypid = 'text[]'::pg_catalog.regtype)
        )
    ) <> 3
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = fixture.relation_oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) <> 3
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = fixture.relation_oid
        AND constraint_row.contype = 'p'
        AND constraint_row.conkey = ARRAY[
          (
            SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = fixture.relation_oid
              AND attribute.attname = 'version'
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
          )
        ]::smallint[]
    )
    OR (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations) <> 0
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_SOURCE_REPLAY_LEDGER_FIXTURE_DRIFT';
  END IF;
END;
$receipt_ocr_source_replay_fixture_readback$;

"""

CATALOG_DIGEST_SQL = b"""SELECT pg_catalog.encode(
  extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'functions', (
          SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(procedure) ORDER BY procedure.oid)
          FROM pg_catalog.pg_proc AS procedure
          WHERE procedure.oid = ANY (ARRAY[
            pg_catalog.to_regprocedure('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'),
            pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'),
            pg_catalog.to_regprocedure('public.get_receipt_ocr_credential_release_capability()'),
            pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()')
          ]::oid[])
        ),
        'tables', (
          SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(relation) ORDER BY relation.oid)
          FROM pg_catalog.pg_class AS relation
          WHERE relation.oid = ANY (ARRAY[
            pg_catalog.to_regclass('ocr_private.receipt_credential_rejection_releases'),
            pg_catalog.to_regclass('ocr_private.receipt_credential_release_catalog_contract')
          ]::oid[])
        )
      )::text,
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
)"""

SUFFIX = (
    b"""
-- The raw migration installs an unsealed contract in this source-only replay.
UPDATE pg_temp.receipt_ocr_source_replay_fixture_guard
SET catalog_digest = (
"""
    + CATALOG_DIGEST_SQL
    + b"""
);

DO $receipt_ocr_source_replay_terminal$
DECLARE
  fixture pg_temp.receipt_ocr_source_replay_fixture_guard%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture
  FROM pg_temp.receipt_ocr_source_replay_fixture_guard;

  IF fixture.schema_oid <> 'supabase_migrations'::pg_catalog.regnamespace
    OR fixture.relation_oid <> 'supabase_migrations.schema_migrations'::pg_catalog.regclass
    OR fixture.catalog_digest IS NULL
    OR (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations) <> 0
    OR (
      SELECT pg_catalog.count(*)
      FROM ocr_private.receipt_credential_release_catalog_contract AS contract_row
      WHERE contract_row.capability_version = 'receipt-ocr-definitive-credential-release-v1'
        AND contract_row.migration_version IS NULL
        AND contract_row.migration_name IS NULL
        AND contract_row.statement_count IS NULL
        AND contract_row.statement_vector_sha256 IS NULL
        AND contract_row.ledger_count IS NULL
        AND contract_row.ledger_identity_root IS NULL
        AND contract_row.sealed_at IS NULL
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(contract_row.function_contract)) = 4
        AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(contract_row.table_contract)) = 2
    ) <> 1
    OR public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-definitive-credential-release-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_SOURCE_REPLAY_TERMINAL_DRIFT';
  END IF;
END;
$receipt_ocr_source_replay_terminal$;

DROP TABLE supabase_migrations.schema_migrations RESTRICT;
DROP SCHEMA supabase_migrations RESTRICT;

DO $receipt_ocr_source_replay_cleanup$
DECLARE
  fixture pg_temp.receipt_ocr_source_replay_fixture_guard%ROWTYPE;
  catalog_digest_after text;
BEGIN
  SELECT * INTO STRICT fixture
  FROM pg_temp.receipt_ocr_source_replay_fixture_guard;
  SELECT * INTO STRICT catalog_digest_after FROM (
"""
    + CATALOG_DIGEST_SQL
    + b"""
  ) AS digest(value);

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    OR pg_catalog.to_regnamespace('supabase_migrations') IS NOT NULL
    OR fixture.catalog_digest IS DISTINCT FROM catalog_digest_after
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_SOURCE_REPLAY_FIXTURE_CLEANUP_DRIFT';
  END IF;
END;
$receipt_ocr_source_replay_cleanup$;

DROP TABLE pg_temp.receipt_ocr_source_replay_fixture_guard;
"""
)


def transform(source: bytes, name: str = NAME) -> bytes:
    if (
        name != NAME
        or len(source) != BYTE_LENGTH
        or hashlib.sha256(source).hexdigest() != SHA256
    ):
        raise ValueError("RECEIPT_OCR_SOURCE_REPLAY_SOURCE_DRIFT")
    if not source.startswith(b"-- Forward-only safe release") or not source.endswith(
        b"\nCOMMIT;\n"
    ):
        raise ValueError("RECEIPT_OCR_SOURCE_REPLAY_TRANSACTION_DRIFT")
    if PREFIX in source or SUFFIX in source:
        raise ValueError("RECEIPT_OCR_SOURCE_REPLAY_DELIMITER_COLLISION")
    return PREFIX + source + SUFFIX


def unwrap(transformed: bytes) -> bytes:
    if not transformed.startswith(PREFIX) or not transformed.endswith(SUFFIX):
        raise ValueError("RECEIPT_OCR_SOURCE_REPLAY_WRAPPER_DRIFT")
    return transformed[len(PREFIX) : -len(SUFFIX)]


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
