#!/usr/bin/env python3
"""Read-only, fail-closed classifier for the G037 prefix / escaped G040 state.

This module deliberately has no connection factory, CLI, or mutation entrypoint.  The
caller supplies an already read-only cursor and a signed offline reference receipt.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping

SOURCE_COMMIT = "92894e41cddb57767c9764d1694992bc0ad9d922"
MANIFEST_SHA256 = "1f568404418009d191c27a0d8e525306b98b9e1472f4056d1f347907c500a8e1"
MIGRATION_SOURCE_SHA256 = "e1881677d58017e7075b063190814a11ad0c77de9bf0c360f9bfe10eb484ec68"
PG_IDENTITY = "PostgreSQL 17.6"
RECEIPT_SCHEMA = "g040-prefix-reference-v1"
_HEX = re.compile(r"^[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_NONCE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")

# These are the exact object names in the source-pinned migration.  Keeping these
# projections here, rather than accepting caller-provided names, prevents a receipt
# from weakening the probe surface.
TABLES = ("privacy_retention_classes", "privacy_retention_class_sources", "privacy_legal_holds", "privacy_retention_work_items", "privacy_retained_records", "privacy_retention_runs", "privacy_retention_run_items")
FUNCTIONS = (("privacy_retention", "set_updated_at", "", False), ("privacy_retention", "prevent_retention_class_history_mutation", "", False), ("privacy_retention", "prevent_active_class_source_mutation", "", False), ("privacy_retention", "prevent_legal_hold_history_mutation", "", False), ("privacy_retention", "require_service_role", "", False), ("privacy_retention", "active_hold_exists", "text, text, timestamp with time zone", False), ("privacy_retention", "write_run_audit", "privacy_retention.privacy_retention_runs, text, text", False), ("public", "privacy_resolve_audit_retention_until", "text, timestamp with time zone", False), ("public", "preview_privacy_retention_run", "text, timestamp with time zone, integer, integer", True), ("public", "confirm_privacy_retention_run", "uuid, text, text, text", True), ("public", "apply_privacy_retention_run", "uuid, text, text, integer", True), ("public", "claim_privacy_retention_storage_items", "uuid, text, text, integer", True), ("public", "ack_privacy_retention_storage_items", "uuid, text, text, uuid[], boolean", True), ("public", "finalize_privacy_retention_run", "uuid, text, text", True))
TRIGGERS = (("privacy_retention_classes", "privacy_retention_classes_updated_at"), ("privacy_retention_classes", "privacy_retention_classes_versioned"), ("privacy_retention_class_sources", "privacy_retention_class_sources_versioned"), ("privacy_legal_holds", "privacy_legal_holds_history"), ("privacy_retention_work_items", "privacy_retention_work_items_updated_at"), ("privacy_retention_runs", "privacy_retention_runs_updated_at"), ("privacy_retention_run_items", "privacy_retention_run_items_updated_at"))

# The probe text is intentionally a fixed source artifact.  Its hash is signed into
# every reference receipt; callers cannot substitute a friendlier query.
CATALOG_PROBE = """WITH expected_tables(relname) AS (VALUES ('privacy_retention_classes'),('privacy_retention_class_sources'),('privacy_legal_holds'),('privacy_retention_work_items'),('privacy_retained_records'),('privacy_retention_runs'),('privacy_retention_run_items')),
table_oids AS (SELECT c.oid,c.relname,c.relrowsecurity FROM expected_tables e JOIN pg_namespace n ON n.nspname='privacy_retention' JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.relname AND c.relkind IN ('r','p')),
actual_functions AS (SELECT p.oid,n.nspname,p.proname,oidvectortypes(p.proargtypes) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention' OR (n.nspname='public' AND p.proname IN ('privacy_resolve_audit_retention_until','preview_privacy_retention_run','confirm_privacy_retention_run','apply_privacy_retention_run','claim_privacy_retention_storage_items','ack_privacy_retention_storage_items','finalize_privacy_retention_run'))),
ledger AS (SELECT count(*)::bigint ledger_count,count(*) FILTER (WHERE version='20260712000400')::bigint v00400_count,count(*) FILTER (WHERE version='20260712000300')::bigint v00300_count,count(*) FILTER (WHERE version>'20260712000300')::bigint after_00300_count,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(string_agg(version||chr(30)||name||chr(30)||coalesce(array_to_string(statements,chr(31),'∅'),'') ORDER BY version,name),''),'UTF8'),'sha256'),'hex') ledger_sha256 FROM supabase_migrations.schema_migrations),
catalog_rows(kind,body) AS (SELECT 'schema',n.nspname||'|'||pg_get_userbyid(n.nspowner)||'|'||coalesce(n.nspacl::text,'') FROM pg_namespace n WHERE n.nspname='privacy_retention' UNION ALL SELECT 'relation',n.nspname||'.'||c.relname||'|'||c.relkind||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||coalesce(c.relacl::text,'') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' UNION ALL SELECT 'column',n.nspname||'.'||c.relname||'|'||a.attnum||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||a.attidentity||'|'||a.attgenerated||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid,true),'') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='privacy_retention' AND a.attnum>0 AND NOT a.attisdropped UNION ALL SELECT 'constraint',n.nspname||'.'||c.relname||'|'||x.conname||'|'||x.contype||'|'||pg_get_constraintdef(x.oid,true) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' UNION ALL SELECT 'index',n.nspname||'.'||ci.relname||'|'||pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class ct ON ct.oid=i.indrelid JOIN pg_namespace n ON n.oid=ct.relnamespace JOIN pg_class ci ON ci.oid=i.indexrelid WHERE n.nspname='privacy_retention' UNION ALL SELECT 'function',a.nspname||'.'||a.proname||'('||a.args||')|'||pg_get_userbyid(p.proowner)||'|'||p.prosecdef||'|'||p.provolatile||'|'||p.proparallel||'|'||coalesce(p.proconfig::text,'')||'|'||coalesce(p.proacl::text,'')||'|'||pg_get_functiondef(p.oid) FROM actual_functions a JOIN pg_proc p ON p.oid=a.oid UNION ALL SELECT 'trigger',n.nspname||'.'||c.relname||'|'||t.tgname||'|'||t.tgenabled||'|'||pg_get_triggerdef(t.oid,true) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' AND NOT t.tgisinternal UNION ALL SELECT 'default_acl',pg_get_userbyid(d.defaclrole)||'|'||d.defaclobjtype||'|'||coalesce(d.defaclacl::text,'') FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='privacy_retention'),
fingerprint AS (SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(string_agg(kind||chr(30)||body,chr(31) ORDER BY kind,body),''),'UTF8'),'sha256'),'hex') catalog_sha256 FROM catalog_rows)
SELECT l.ledger_count,l.v00400_count,(l.ledger_count=28 AND l.v00300_count=1 AND l.after_00300_count=0 AND l.v00400_count=0) ledger_prefix_shape_ok,l.ledger_sha256,(to_regnamespace('privacy_retention') IS NOT NULL) schema_exists,(SELECT count(*) FROM table_oids) expected_table_count,(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' AND c.relkind IN ('r','p')) schema_table_count,(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' AND c.relkind='i') schema_index_count,(SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' AND a.attnum>0 AND NOT a.attisdropped) column_count,(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' AND c.relkind NOT IN ('r','p','i')) schema_other_relation_count,(SELECT count(*) FROM actual_functions) touched_function_count,(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='privacy_retention' AND NOT t.tgisinternal) schema_trigger_count,(SELECT count(*) FROM table_oids WHERE relrowsecurity) rls_table_count,(SELECT count(*) FROM pg_policy p JOIN table_oids t ON t.oid=p.polrelid) policy_count,(NOT has_schema_privilege('anon','privacy_retention','USAGE') AND NOT has_schema_privilege('authenticated','privacy_retention','USAGE') AND NOT EXISTS (SELECT 1 FROM table_oids WHERE has_table_privilege('anon',oid,'SELECT') OR has_table_privilege('authenticated',oid,'SELECT')) AND NOT EXISTS (SELECT 1 FROM actual_functions WHERE has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE'))) acl_contract_ok,(current_setting('server_version_num')::int=170006) exact_pg,current_setting('server_version_num')::int server_version_num,f.catalog_sha256 FROM ledger l CROSS JOIN fingerprint f;"""
DATA_PROBE = """WITH c AS (SELECT count(*)::bigint classes_count,count(*) FILTER (WHERE code=ANY(ARRAY['access_log_1y','access_log_2y','ecommerce_advertising_6m','ecommerce_contract_5y','ecommerce_payment_supply_5y','ecommerce_dispute_3y','privacy_identity_audit','privacy_marketing_audit','privacy_account_deletion_audit','privacy_incident_audit']) AND status='disabled' AND data_class IS NULL AND basis_code IS NULL AND trigger_type IS NULL AND retention_period IS NULL AND approved_evidence_ref IS NULL AND version IS NULL AND activated_at IS NULL AND created_at IS NOT NULL AND updated_at IS NOT NULL)::bigint exact_seed_count,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(string_agg(code||chr(30)||status||chr(30)||coalesce(data_class,'∅')||chr(30)||coalesce(basis_code,'∅')||chr(30)||coalesce(trigger_type,'∅')||chr(30)||coalesce(retention_period::text,'∅')||chr(30)||coalesce(approved_evidence_ref,'∅')||chr(30)||coalesce(version,'∅')||chr(30)||coalesce(activated_at::text,'∅') ORDER BY code),''),'UTF8'),'sha256'),'hex') seed_projection_sha256 FROM privacy_retention.privacy_retention_classes),x AS (SELECT (SELECT count(*) FROM privacy_retention.privacy_retention_class_sources)::bigint class_source_count,(SELECT count(*) FROM privacy_retention.privacy_legal_holds)::bigint legal_hold_count,(SELECT count(*) FROM privacy_retention.privacy_retention_work_items)::bigint work_item_count,(SELECT count(*) FROM privacy_retention.privacy_retained_records)::bigint retained_record_count,(SELECT count(*) FROM privacy_retention.privacy_retention_runs)::bigint run_count,(SELECT count(*) FROM privacy_retention.privacy_retention_run_items)::bigint run_item_count) SELECT c.classes_count,c.exact_seed_count,(c.classes_count=10 AND c.exact_seed_count=10) seed_rows_exact,x.class_source_count,x.legal_hold_count,x.work_item_count,x.retained_record_count,x.run_count,x.run_item_count,(x.class_source_count+x.legal_hold_count+x.work_item_count+x.retained_record_count+x.run_count+x.run_item_count=0) runtime_tables_empty,c.seed_projection_sha256,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(c.seed_projection_sha256||chr(30)||c.classes_count||chr(30)||x.class_source_count||chr(30)||x.legal_hold_count||chr(30)||x.work_item_count||chr(30)||x.retained_record_count||chr(30)||x.run_count||chr(30)||x.run_item_count,'UTF8'),'sha256'),'hex') data_shape_sha256 FROM c CROSS JOIN x;"""
PROBE_TEXT_SHA256 = hashlib.sha256((CATALOG_PROBE + "\n" + DATA_PROBE).encode()).hexdigest()

class Denial(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)

@dataclass(frozen=True)
class PrefixObservation:
    status: str
    target_fingerprint: str
    final_commit: str
    runtime_source_root: str
    reference_receipt_sha256: str
    observation_nonce: str
    ledger_prefix_sha256: str
    catalog_sha256: str
    data_sha256: str | None
    classification_sha256: str

def canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")
    except Exception:
        raise Denial("serialization_input") from None

def _hex(value: Any) -> bool:
    return type(value) is str and bool(_HEX.fullmatch(value))

def begin_read_only_snapshot(cursor: Any) -> None:
    for statement in ("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL statement_timeout = '10s'", "SET LOCAL lock_timeout = '1s'", "SET LOCAL idle_in_transaction_session_timeout = '15s'", "SET LOCAL search_path = pg_catalog"):
        try:
            cursor.execute(statement)
        except Exception:
            raise Denial("snapshot_setup") from None

def _row(cursor: Any, sql: str) -> Mapping[str, Any]:
    try:
        cursor.execute(sql)
        row = cursor.fetchone()
    except Exception:
        raise Denial("probe_error") from None
    if type(row) is not dict:
        raise Denial("probe_shape")
    return row

def _reference(value: Any) -> Any:
    from g040_reference_evidence import VerifiedReference
    if type(value) is not VerifiedReference:
        raise Denial("reference_type")
    return value

def _classify_probes(cursor: Any, reference: Any, *, transaction_read_only: str) -> tuple[str, str, str, str | None]:
    if _row(cursor, "SELECT current_setting('transaction_read_only', true) AS transaction_read_only") != {"transaction_read_only": transaction_read_only}:
        raise Denial("not_read_only" if transaction_read_only == "on" else "not_read_write")
    catalog = _row(cursor, CATALOG_PROBE)
    required = {"ledger_count", "v00400_count", "ledger_prefix_shape_ok", "ledger_sha256", "schema_exists", "expected_table_count", "schema_table_count", "schema_index_count", "column_count", "schema_other_relation_count", "touched_function_count", "schema_trigger_count", "rls_table_count", "policy_count", "acl_contract_ok", "exact_pg", "server_version_num", "catalog_sha256"}
    counts = required - {"ledger_prefix_shape_ok", "ledger_sha256", "schema_exists", "acl_contract_ok", "exact_pg", "catalog_sha256"}
    if set(catalog) != required or any(type(catalog[key]) is not int for key in counts) or any(type(catalog[key]) is not bool for key in {"ledger_prefix_shape_ok", "schema_exists", "acl_contract_ok", "exact_pg"}) or not _hex(catalog["ledger_sha256"]) or not _hex(catalog["catalog_sha256"]):
        raise Denial("catalog_shape")
    if not (catalog["ledger_prefix_shape_ok"] is True and catalog["ledger_count"] == 28 and catalog["v00400_count"] == 0 and catalog["ledger_sha256"] == reference.ledger_prefix_sha256):
        raise Denial("ledger_conflict")
    absent = catalog["schema_exists"] is False and all(catalog[key] == 0 for key in ("expected_table_count", "schema_table_count", "schema_index_count", "schema_other_relation_count", "schema_trigger_count")) and catalog["catalog_sha256"] == reference.absent_catalog_sha256
    if absent:
        return "UNAPPLIED", catalog["ledger_sha256"], catalog["catalog_sha256"], None
    full = catalog["schema_exists"] is True and catalog["expected_table_count"] == 7 and catalog["schema_table_count"] == 7 and catalog["schema_index_count"] == 14 and catalog["column_count"] == 78 and catalog["schema_other_relation_count"] == 0 and catalog["touched_function_count"] == 14 and catalog["schema_trigger_count"] == 7 and catalog["rls_table_count"] == 7 and catalog["policy_count"] == 0 and catalog["acl_contract_ok"] is True and catalog["exact_pg"] is True and catalog["server_version_num"] == 170006 and catalog["catalog_sha256"] == reference.full_catalog_sha256
    if not full:
        raise Denial("partial_or_ambiguous")
    data = _row(cursor, DATA_PROBE)
    required_data = {"classes_count", "exact_seed_count", "seed_rows_exact", "class_source_count", "legal_hold_count", "work_item_count", "retained_record_count", "run_count", "run_item_count", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256"}
    count_data = required_data - {"seed_rows_exact", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256"}
    if set(data) != required_data or any(type(data[key]) is not int for key in count_data) or type(data["seed_rows_exact"]) is not bool or type(data["runtime_tables_empty"]) is not bool or not _hex(data["seed_projection_sha256"]) or not _hex(data["data_shape_sha256"]):
        raise Denial("data_shape")
    if not (data["seed_rows_exact"] is True and data["runtime_tables_empty"] is True and data["classes_count"] == 10 and data["exact_seed_count"] == 10 and all(data[key] == 0 for key in ("class_source_count", "legal_hold_count", "work_item_count", "retained_record_count", "run_count", "run_item_count")) and data["data_shape_sha256"] == reference.full_data_sha256):
        raise Denial("partial_or_ambiguous")
    return "FULL_ESCAPED", catalog["ledger_sha256"], catalog["catalog_sha256"], data["data_shape_sha256"]

def _observation(reference: Any, status: str, ledger: str, catalog: str, data: str | None) -> PrefixObservation:
    payload = {"status": status, "target_fingerprint": reference.target_fingerprint, "final_commit": reference.final_commit, "runtime_source_root": reference.runtime_source_root, "reference_receipt_sha256": reference.receipt_sha256, "observation_nonce": reference.observation_nonce, "ledger_prefix_sha256": ledger, "catalog_sha256": catalog, "data_sha256": data}
    return PrefixObservation(**payload, classification_sha256=hashlib.sha256(canonical_bytes(payload)).hexdigest())

def classify_locked_cursor(cursor: Any, reference: Any, *, consume_nonce: Callable[[str], bool]) -> PrefixObservation:
    reference = _reference(reference)
    if not callable(consume_nonce):
        raise Denial("nonce_validation")
    try:
        fresh = consume_nonce(reference.observation_nonce)
    except Exception:
        raise Denial("nonce_validation") from None
    if fresh is not True:
        raise Denial("nonce_stale")
    return _observation(reference, *_classify_probes(cursor, reference, transaction_read_only="on"))

def classify_mutation_cursor(cursor: Any, reference: Any, *, expected_prior: PrefixObservation) -> PrefixObservation:
    reference = _reference(reference)
    if type(expected_prior) is not PrefixObservation or expected_prior.status not in ("UNAPPLIED", "FULL_ESCAPED"):
        raise Denial("expected_prior")
    if (expected_prior.target_fingerprint != reference.target_fingerprint or expected_prior.final_commit != reference.final_commit or expected_prior.runtime_source_root != reference.runtime_source_root or expected_prior.reference_receipt_sha256 != reference.receipt_sha256 or expected_prior.observation_nonce != reference.observation_nonce):
        raise Denial("prior_binding")
    observed = _observation(reference, *_classify_probes(cursor, reference, transaction_read_only="off"))
    if observed != expected_prior:
        raise Denial("branch_mismatch")
    return observed

def serialize(result: PrefixObservation) -> bytes:
    if type(result) is not PrefixObservation:
        raise Denial("serialization_input")
    return canonical_bytes(result.__dict__)
