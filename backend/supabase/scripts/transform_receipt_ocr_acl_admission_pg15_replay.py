#!/usr/bin/env python3
"""Adapt only the 107 operating admission for isolated PG15 source replay."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


NAME = "20261019120000_receipt_ocr_credential_release_acl_admission_v2.sql"
SHA256 = "512f778b71a196e28f092266782fe5938b7d15ec72b61bf05978f3b1696faec9"
BYTE_LENGTH = 40_205
START = b"-- BEGIN RECEIPT OCR 107 OPERATING ADMISSION\n"
END = b"-- END RECEIPT OCR 107 OPERATING ADMISSION\n"
SOURCE_ONLY_ADMISSION = b"""-- BEGIN RECEIPT OCR 107 OPERATING ADMISSION
DO $prepare$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 15
    OR current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR pg_catalog.to_regnamespace('supabase_migrations') IS NOT NULL
    OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_rejection_releases') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_release_catalog_contract') IS NULL
    OR pg_catalog.to_regprocedure('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.get_receipt_ocr_credential_release_capability()') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()') IS NULL
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
    ) <> 1
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_SOURCE_REPLAY_ADMISSION_FAILED';
  END IF;
END;
$prepare$;
-- END RECEIPT OCR 107 OPERATING ADMISSION
"""


def _operating_admission(source: bytes) -> bytes:
    if source.count(START) != 1 or source.count(END) != 1:
        raise ValueError("RECEIPT_OCR_ACL_V2_SOURCE_REPLAY_BOUNDARY_DRIFT")
    start = source.index(START)
    end = source.index(END, start) + len(END)
    return source[start:end]


def transform(source: bytes, name: str = NAME) -> bytes:
    if (
        name != NAME
        or len(source) != BYTE_LENGTH
        or hashlib.sha256(source).hexdigest() != SHA256
    ):
        raise ValueError("RECEIPT_OCR_ACL_V2_SOURCE_REPLAY_SOURCE_DRIFT")
    original = _operating_admission(source)
    if SOURCE_ONLY_ADMISSION in source:
        raise ValueError("RECEIPT_OCR_ACL_V2_SOURCE_REPLAY_COLLISION")
    return source.replace(original, SOURCE_ONLY_ADMISSION, 1)


def restore(transformed: bytes, original: bytes) -> bytes:
    operating = _operating_admission(original)
    if transformed.count(SOURCE_ONLY_ADMISSION) != 1:
        raise ValueError("RECEIPT_OCR_ACL_V2_SOURCE_REPLAY_WRAPPER_DRIFT")
    restored = transformed.replace(SOURCE_ONLY_ADMISSION, operating, 1)
    if restored != original:
        raise ValueError("RECEIPT_OCR_ACL_V2_SOURCE_REPLAY_WRAPPER_DRIFT")
    return restored


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
