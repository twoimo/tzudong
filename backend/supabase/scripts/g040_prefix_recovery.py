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
    """Typed fail-closed denial with no provider/database detail."""
    def __init__(self, code: str): self.code = code; super().__init__(code)

@dataclass(frozen=True)
class Classification:
    status: str
    evidence: Mapping[str, Any]

def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")

def _safe_bool(v: Any) -> bool: return type(v) is bool and v

def _hex(v: Any) -> bool: return isinstance(v, str) and bool(_HEX.fullmatch(v))

def load_receipt(raw: bytes | str) -> Mapping[str, Any]:
    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        if not isinstance(text, str):
            raise ValueError
        def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate")
                result[key] = value
            return result
        value = json.loads(text, object_pairs_hook=unique)
    except Exception:
        raise Denial("receipt_encoding") from None
    if not isinstance(value, Mapping):
        raise Denial("receipt_fields")
    return value

def _validate_receipt(receipt: Mapping[str, Any], verify: Callable[[bytes, Mapping[str, Any]], bool], *, final_commit: str, runtime_source_root: str) -> None:
    fields = {"schema", "base_commit", "final_commit", "runtime_source_root", "manifest_sha256", "migration_source_sha256", "pg_identity", "probe_text_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "target_fingerprint", "observation_nonce", "signature"}
    if not isinstance(receipt, Mapping) or set(receipt) != fields:
        raise Denial("receipt_fields")
    for key in fields - {"schema", "pg_identity", "target_fingerprint", "observation_nonce", "signature", "base_commit", "final_commit", "runtime_source_root"}:
        if not _hex(receipt[key]):
            raise Denial("receipt_hash")
    if (not isinstance(receipt["base_commit"], str) or not _COMMIT.fullmatch(receipt["base_commit"])
            or not isinstance(receipt["final_commit"], str) or not _COMMIT.fullmatch(receipt["final_commit"])
            or not _hex(receipt["runtime_source_root"])):
        raise Denial("receipt_hash")
    if (receipt["schema"] != RECEIPT_SCHEMA or receipt["base_commit"] != SOURCE_COMMIT
            or receipt["final_commit"] != final_commit or receipt["runtime_source_root"] != runtime_source_root
            or receipt["manifest_sha256"] != MANIFEST_SHA256
            or receipt["migration_source_sha256"] != MIGRATION_SOURCE_SHA256
            or receipt["pg_identity"] != PG_IDENTITY or receipt["probe_text_sha256"] != PROBE_TEXT_SHA256
            or not isinstance(receipt["target_fingerprint"], str) or not receipt["target_fingerprint"]
            or not isinstance(receipt["signature"], Mapping)
            or not isinstance(receipt["observation_nonce"], str) or not _NONCE.fullmatch(receipt["observation_nonce"])):
        raise Denial("receipt_binding")
    body = {key: receipt[key] for key in fields - {"signature"}}
    try:
        ok = verify(canonical_bytes(body), receipt["signature"])
    except Exception:
        raise Denial("receipt_verification") from None
    if ok is not True:
        raise Denial("receipt_verification")

def begin_read_only_snapshot(cursor: Any) -> None:
    """Diagnostic-only transaction setup; locked integrations must not call this."""
    for statement in (
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        "SET LOCAL statement_timeout = '10s'",
        "SET LOCAL lock_timeout = '1s'",
        "SET LOCAL idle_in_transaction_session_timeout = '15s'",
        "SET LOCAL search_path = pg_catalog",
    ):
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
    if not isinstance(row, Mapping):
        raise Denial("probe_shape")
    return row

def _evidence(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items()
            if type(value) is bool or (type(value) is int) or _hex(value)}

def classify_locked_cursor(cursor: Any, receipt: Mapping[str, Any], verify_receipt: Callable[[bytes, Mapping[str, Any]], bool], *, observation_nonce: str, target_fingerprint: str, final_commit: str, runtime_source_root: str, consume_nonce: Callable[[str], bool]) -> Classification:
    """Classify a caller-owned locked read-only transaction without transaction SQL."""
    if not isinstance(final_commit, str) or not _COMMIT.fullmatch(final_commit) or not _hex(runtime_source_root):
        raise Denial("source_binding")
    _validate_receipt(receipt, verify_receipt, final_commit=final_commit, runtime_source_root=runtime_source_root)
    if observation_nonce != receipt["observation_nonce"] or not isinstance(observation_nonce, str):
        raise Denial("nonce_binding")
    try:
        fresh = consume_nonce(observation_nonce)
    except Exception:
        raise Denial("nonce_validation") from None
    if fresh is not True:
        raise Denial("nonce_stale")
    if not isinstance(target_fingerprint, str) or not target_fingerprint or target_fingerprint != receipt["target_fingerprint"]:
        raise Denial("target_binding")
    state = _row(cursor, "SELECT current_setting('transaction_read_only', true) AS transaction_read_only")
    if set(state) != {"transaction_read_only"} or state["transaction_read_only"] != "on":
        raise Denial("not_read_only")
    catalog = _row(cursor, CATALOG_PROBE)
    required = {"ledger_count", "v00400_count", "ledger_prefix_shape_ok", "ledger_sha256", "schema_exists", "expected_table_count", "schema_table_count", "schema_index_count", "column_count", "schema_other_relation_count", "touched_function_count", "schema_trigger_count", "rls_table_count", "policy_count", "acl_contract_ok", "exact_pg", "server_version_num", "catalog_sha256"}
    if set(catalog) != required:
        raise Denial("catalog_shape")
    counts = ("ledger_count", "v00400_count", "expected_table_count", "schema_table_count", "schema_index_count", "column_count", "schema_other_relation_count", "touched_function_count", "schema_trigger_count", "rls_table_count", "policy_count", "server_version_num")
    if (any(type(catalog[key]) is not int for key in counts) or not _hex(catalog["ledger_sha256"]) or not _hex(catalog["catalog_sha256"]) or type(catalog["schema_exists"]) is not bool or type(catalog["acl_contract_ok"]) is not bool or type(catalog["exact_pg"]) is not bool):
        raise Denial("catalog_shape")
    if not (_safe_bool(catalog["ledger_prefix_shape_ok"]) and catalog["ledger_count"] == 28 and catalog["v00400_count"] == 0 and catalog["ledger_sha256"] == receipt["ledger_prefix_sha256"]):
        raise Denial("ledger_conflict")
    # The absent catalog root includes the pre-existing public 00100 resolver, body and ACL.
    absent = (not catalog["schema_exists"] and catalog["expected_table_count"] == 0 and catalog["schema_table_count"] == 0 and catalog["schema_index_count"] == 0 and catalog["schema_other_relation_count"] == 0 and catalog["schema_trigger_count"] == 0 and catalog["catalog_sha256"] == receipt["absent_catalog_sha256"])
    if absent:
        return Classification("UNAPPLIED", MappingProxyType(_evidence(catalog)))
    full = (catalog["schema_exists"] is True and catalog["expected_table_count"] == 7 and catalog["schema_table_count"] == 7 and catalog["schema_index_count"] == 14 and catalog["column_count"] == 78 and catalog["schema_other_relation_count"] == 0 and catalog["touched_function_count"] == 14 and catalog["schema_trigger_count"] == 7 and catalog["rls_table_count"] == 7 and catalog["policy_count"] == 0 and catalog["acl_contract_ok"] is True and catalog["exact_pg"] is True and catalog["server_version_num"] == 170006 and catalog["catalog_sha256"] == receipt["full_catalog_sha256"])
    if not full:
        raise Denial("partial_or_ambiguous")
    data = _row(cursor, DATA_PROBE)
    required_data = {"classes_count", "exact_seed_count", "seed_rows_exact", "class_source_count", "legal_hold_count", "work_item_count", "retained_record_count", "run_count", "run_item_count", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256"}
    if set(data) != required_data or any(type(data[key]) is not int for key in required_data - {"seed_rows_exact", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256"}):
        raise Denial("data_shape")
    if not (_safe_bool(data["seed_rows_exact"]) and _safe_bool(data["runtime_tables_empty"]) and data["classes_count"] == 10 and data["exact_seed_count"] == 10 and all(data[key] == 0 for key in ("class_source_count", "legal_hold_count", "work_item_count", "retained_record_count", "run_count", "run_item_count")) and _hex(data["seed_projection_sha256"]) and _hex(data["data_shape_sha256"]) and data["data_shape_sha256"] == receipt["full_data_sha256"]):
        raise Denial("partial_or_ambiguous")
    return Classification("FULL_ESCAPED", MappingProxyType({**_evidence(catalog), **_evidence(data)}))

def serialize(result: Classification) -> bytes:
    if type(result) is not Classification or type(result.evidence) is not MappingProxyType:
        raise Denial("serialization_input")
    return canonical_bytes({"status": result.status, "evidence": _evidence(result.evidence)})
