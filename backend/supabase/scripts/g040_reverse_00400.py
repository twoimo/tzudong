"""Literal, local-only rollback authority for G010 migration 00400."""
from __future__ import annotations

import hashlib
from typing import Final

DERIVATION_MODE: Final = "restored-full_reverse-00400_forward-00400_rollback-full-v1"
_VECTOR_DOMAIN: Final = b"g040-reverse-00400-vector-v1\x00"

# Keep this sequence literal: it is deliberately not generated from the catalog.
REVERSE_VECTOR: Final[tuple[str, ...]] = (
    "DROP TRIGGER privacy_legal_holds_history ON privacy_retention.privacy_legal_holds RESTRICT",
    "DROP TRIGGER privacy_retention_class_sources_versioned ON privacy_retention.privacy_retention_class_sources RESTRICT",
    "DROP TRIGGER privacy_retention_classes_updated_at ON privacy_retention.privacy_retention_classes RESTRICT",
    "DROP TRIGGER privacy_retention_classes_versioned ON privacy_retention.privacy_retention_classes RESTRICT",
    "DROP TRIGGER privacy_retention_run_items_updated_at ON privacy_retention.privacy_retention_run_items RESTRICT",
    "DROP TRIGGER privacy_retention_runs_updated_at ON privacy_retention.privacy_retention_runs RESTRICT",
    "DROP TRIGGER privacy_retention_work_items_updated_at ON privacy_retention.privacy_retention_work_items RESTRICT",
    "DROP FUNCTION public.finalize_privacy_retention_run(uuid, text, text) RESTRICT",
    "DROP FUNCTION public.ack_privacy_retention_storage_items(uuid, text, text, uuid[], boolean) RESTRICT",
    "DROP FUNCTION public.claim_privacy_retention_storage_items(uuid, text, text, integer) RESTRICT",
    "DROP FUNCTION public.apply_privacy_retention_run(uuid, text, text, integer) RESTRICT",
    "DROP FUNCTION public.confirm_privacy_retention_run(uuid, text, text, text) RESTRICT",
    "DROP FUNCTION public.preview_privacy_retention_run(text, timestamptz, integer, integer) RESTRICT",
    "DROP FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz) RESTRICT",
    "DROP FUNCTION privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs, text, text) RESTRICT",
    "DROP FUNCTION privacy_retention.active_hold_exists(text, text, timestamptz) RESTRICT",
    "DROP FUNCTION privacy_retention.require_service_role() RESTRICT",
    "DROP FUNCTION privacy_retention.prevent_legal_hold_history_mutation() RESTRICT",
    "DROP FUNCTION privacy_retention.prevent_active_class_source_mutation() RESTRICT",
    "DROP FUNCTION privacy_retention.prevent_retention_class_history_mutation() RESTRICT",
    "DROP FUNCTION privacy_retention.set_updated_at() RESTRICT",
    "DROP TABLE privacy_retention.privacy_retention_run_items RESTRICT",
    "DROP TABLE privacy_retention.privacy_retained_records RESTRICT",
    "DROP TABLE privacy_retention.privacy_retention_runs RESTRICT",
    "DROP TABLE privacy_retention.privacy_retention_work_items RESTRICT",
    "DROP TABLE privacy_retention.privacy_legal_holds RESTRICT",
    "DROP TABLE privacy_retention.privacy_retention_class_sources RESTRICT",
    "DROP TABLE privacy_retention.privacy_retention_classes RESTRICT",
    "DROP SCHEMA privacy_retention RESTRICT",
)


def _vector_sha256() -> str:
    digest = hashlib.sha256(_VECTOR_DOMAIN)
    for statement in REVERSE_VECTOR:
        encoded = statement.encode("ascii")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
    return digest.hexdigest()


REVERSE_VECTOR_SHA256: Final = _vector_sha256()
