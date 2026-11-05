#!/usr/bin/env python3
"""Adapt only the 108 operating admission for isolated PG15 source replay."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


NAME = "20261019130000_receipt_ocr_indeterminate_recovery.sql"
SHA256 = "d3258b679cbf42ecd97edeab941a5bbaf30fa7b15d968081b60b8b600a3ecd1a"
BYTE_LENGTH = 77_499
START = b"-- BEGIN RECEIPT OCR 108 OPERATING ADMISSION\n"
END = b"-- END RECEIPT OCR 108 OPERATING ADMISSION\n"
SOURCE_ONLY_ADMISSION = b"""-- BEGIN RECEIPT OCR 108 OPERATING ADMISSION
DO $prepare$
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 15
    OR current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR pg_catalog.to_regnamespace('supabase_migrations') IS NOT NULL
    OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    OR pg_catalog.to_regnamespace('ocr_private') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_results') IS NULL
    OR pg_catalog.to_regclass('ocr_private.review_generations') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_rejection_releases') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_release_catalog_contract') IS NULL
    OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
    OR pg_catalog.to_regclass('privacy_retention.g014_nested_helper_allowlist') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_definer_contract()') IS NULL
    OR pg_catalog.to_regprocedure('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.get_receipt_ocr_credential_release_capability()') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
    OR pg_catalog.to_regprocedure('extensions.gen_random_uuid()') IS NULL
    OR ocr_private.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
    OR pg_catalog.to_regclass('ocr_private.receipt_ocr_indeterminate_recoveries') IS NOT NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_ocr_recovery_execution_leases') IS NOT NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_ocr_recovery_catalog_contract') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.preview_review_receipt_ocr_indeterminate_recovery(uuid)') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_recovery_execution_lease()') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.guard_receipt_ocr_recovery_photo_update()') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.receipt_ocr_recovery_acl_admitted_v1()') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_indeterminate_recovery_capability()') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.preview_review_receipt_ocr_indeterminate_recovery(uuid)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.get_receipt_ocr_indeterminate_recovery_capability()') IS NOT NULL
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SOURCE_REPLAY_ADMISSION_FAILED';
  END IF;
END;
$prepare$;
-- END RECEIPT OCR 108 OPERATING ADMISSION
"""


def _operating_admission(source: bytes) -> bytes:
    if source.count(START) != 1 or source.count(END) != 1:
        raise ValueError("RECEIPT_OCR_RECOVERY108_SOURCE_REPLAY_BOUNDARY_DRIFT")
    start = source.index(START)
    end = source.index(END, start) + len(END)
    return source[start:end]


def transform(source: bytes, name: str = NAME) -> bytes:
    if (
        name != NAME
        or len(source) != BYTE_LENGTH
        or hashlib.sha256(source).hexdigest() != SHA256
    ):
        raise ValueError("RECEIPT_OCR_RECOVERY108_SOURCE_REPLAY_SOURCE_DRIFT")
    original = _operating_admission(source)
    if SOURCE_ONLY_ADMISSION in source:
        raise ValueError("RECEIPT_OCR_RECOVERY108_SOURCE_REPLAY_COLLISION")
    return source.replace(original, SOURCE_ONLY_ADMISSION, 1)


def restore(transformed: bytes, original: bytes) -> bytes:
    operating = _operating_admission(original)
    if transformed.count(SOURCE_ONLY_ADMISSION) != 1:
        raise ValueError("RECEIPT_OCR_RECOVERY108_SOURCE_REPLAY_WRAPPER_DRIFT")
    restored = transformed.replace(SOURCE_ONLY_ADMISSION, operating, 1)
    if restored != original:
        raise ValueError("RECEIPT_OCR_RECOVERY108_SOURCE_REPLAY_WRAPPER_DRIFT")
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
