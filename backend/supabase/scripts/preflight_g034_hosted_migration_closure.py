#!/usr/bin/env python3
"""Fail-closed, read-only hosted preflight for the G034 migration closure."""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / ".github/g034-hosted-migration-closure.v1.json"
TOP_KEYS = {"schemaVersion", "ledgerTerminalVersion", "closureTerminalVersion", "requiredLaterPromotionGate", "migrations", "excludedVersions", "cloneBackupRecoveryRequired"}
ENTRY_KEYS = {"version", "name", "path", "sha256"}
HASH = re.compile(r"[0-9a-f]{64}\Z")
RISK = re.compile(r"(?im)^\s*(?:begin|commit|rollback|savepoint|release\s+savepoint)\b|\b(?:drop\s+(?:table|schema|database|type|function)|truncate|delete\s+from|update\s+\w+|alter\s+table\s+\w+\s+drop)\b")
EXPECTED_IDENTITIES = (
    "20260627080000:storyboard_custom_gpt_rag_documents",
    "20260627153000:storyboard_documents_hybrid_v2_indexes",
    "20260627154500:storyboard_documents_hybrid_rrf_type_fix",
    "20260702000100:restaurant_request_review_lifecycle",
    "20260704000100:restaurant_submission_submit_contract",
    "20260704000200:restaurant_destructive_admin_audit",
    "20260707000100:admin_restaurant_map_overlays",
    "20260707000200:admin_restaurant_map_overlay_audit_apply",
    "20260707000300:admin_trend_schema_foundation",
    "20260707000400:admin_trend_job_request_rpcs",
    "20260707000500:admin_trend_proposal_review_rpc",
    "20260707000600:admin_trend_proposal_approval_rpc",
    "20260711000100:release_auth_session_revocation",
    "20260712000100:g010_privacy_foundation",
    "20260712000200:g010_notification_marketing",
    "20260712000300:g010_account_deletion",
    "20260712000400:g010_retention_separation",
    "20260712000500:g010_incident_workflow",
    "20260712000600:g010_ocr_log_minimization",
    "20260713000100:g013_short_url_security",
    "20260713000200:g013_ocr_quota_security",
    "20260713000300:g013_admin_provider_budgets",
    "20260713000450:g013_address_admin_approval",
    "20260713002000:g014_public_api_private_boundary",
    "20260713002100:g014_privacy_workflows",
    "20260713002300:g014_account_deletion_state_machine",
    "20260713002400:g014_retention_adapters_receipts",
)


def fail(report, code):
    report["blockers"].append(code)


def load_manifest(path):
    def no_duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate-json-key")
            result[key] = value
        return result
    data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=no_duplicates)
    if set(data) != TOP_KEYS or data.get("schemaVersion") != 1:
        raise ValueError("manifest-schema")
    if not isinstance(data["migrations"], list) or not isinstance(data["excludedVersions"], list):
        raise ValueError("manifest-types")
    return data


def validate_sources(manifest, report):
    entries = manifest["migrations"]
    versions = []
    identities = []
    for entry in entries:
        if set(entry) != ENTRY_KEYS or not all(isinstance(entry[k], str) for k in ENTRY_KEYS):
            fail(report, "manifest-entry-schema"); continue
        version, name, relative, digest = entry["version"], entry["name"], entry["path"], entry["sha256"]
        versions.append(version)
        identities.append((version, name))
        if not re.fullmatch(r"20\d{12}", version) or not re.fullmatch(r"[a-z0-9_]+", name) or not HASH.fullmatch(digest): fail(report, "manifest-identity")
        if not relative.startswith("backend/supabase/migrations/") or Path(relative).is_absolute() or ".." in Path(relative).parts: fail(report, "path-confinement"); continue
        source = (ROOT / relative).resolve()
        if ROOT not in source.parents or not source.is_file(): fail(report, "missing-source"); continue
        actual = hashlib.sha256(source.read_bytes()).hexdigest()
        report["sourceHashes"].append(actual)
        if actual != digest: fail(report, "source-hash-mismatch")
        if RISK.search(source.read_text(encoding="utf-8")): report["cloneApplyRisks"] += 1
    if tuple(f"{version}:{name}" for version, name in identities) != EXPECTED_IDENTITIES or versions != sorted(versions) or len(versions) != 27:
        fail(report, "manifest-order-or-terminal")
    if len(set(versions)) != len(versions): fail(report, "duplicate-version")
    forbidden = set(manifest["excludedVersions"])
    required_exclusions = {"20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002200", "20260713002500", "20260713002600", "20260713002700"}
    if forbidden != required_exclusions or any(v in forbidden for v in versions) or manifest["requiredLaterPromotionGate"] != "20260713002500_g014_catalog_contract.sql": fail(report, "excluded-migration")
    report["sourceValid"] = not report["blockers"]


def catalog_preflight(report):
    try:
        import psycopg
        with psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=False) as connection:
            with connection.cursor() as cursor:
                cursor.execute("BEGIN READ ONLY")
                cursor.execute("SET LOCAL statement_timeout = '5000ms'")
                cursor.execute("SET LOCAL lock_timeout = '1000ms'")
                cursor.execute("SET LOCAL idle_in_transaction_session_timeout = '5000ms'")
                cursor.execute("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")
                ledger = [str(row[0]) for row in cursor.fetchall()]
                report["ledgerTerminal"] = ledger[-1] if ledger else None
                report["ledgerCount"] = len(ledger)
                if report["ledgerTerminal"] != "20260531084516" or any(v > "20260531084516" for v in ledger): fail(report, "ledger-terminal")
                required = [("relations", "SELECT count(*) FROM pg_catalog.pg_class WHERE relname = ANY(%s)", (["restaurants", "restaurants_backup", "objects"],)), ("targetRpcs", "SELECT count(*) FROM pg_catalog.pg_proc WHERE proname = ANY(%s)", (["submit_restaurant_request", "approve_submission_item"],))]
                for label, query, params in required:
                    cursor.execute(query, params); report[label] = int(cursor.fetchone()[0])
                cursor.execute("SELECT count(*) FROM pg_catalog.pg_locks WHERE NOT granted")
                report["lockConflictCount"] = int(cursor.fetchone()[0])
                cursor.execute("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = ANY(%s)", (["postgres", "service_role", "authenticated"],))
                report["requiredRoleCount"] = int(cursor.fetchone()[0])
                if report["relations"] < 3 or report["targetRpcs"] < 2 or report["requiredRoleCount"] < 3 or report["lockConflictCount"]:
                    fail(report, "catalog-prerequisite")
    except Exception:
        fail(report, "catalog-read-failed")


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--artifact", type=Path, default=Path("g034-hosted-preflight.json"))
    args = parser.parse_args(argv)
    report = {"artifactVersion": 1, "sourceValid": False, "catalogChecked": False, "ledgerTerminal": None, "ledgerCount": 0, "sourceHashes": [], "cloneApplyRisks": 0, "relations": 0, "targetRpcs": 0, "requiredRoleCount": 0, "lockConflictCount": 0, "requiredLaterPromotionGate": "20260713002500_g014_catalog_contract.sql", "cloneBackupRecoveryGate": False, "safeToApply": False, "blockers": []}
    try:
        manifest = load_manifest(MANIFEST)
        validate_sources(manifest, report)
        report["manifestHash"] = hashlib.sha256(MANIFEST.read_bytes()).hexdigest()
    except Exception:
        fail(report, "manifest-invalid")
    if not args.validate_only:
        if os.environ.get("SUPABASE_DB_URL"):
            report["catalogChecked"] = True
            catalog_preflight(report)
        else:
            fail(report, "database-url-missing")
    if report["cloneApplyRisks"]:
        fail(report, "clone-required")
    # Source validation can pass independently; hosted promotion remains blocked
    # until clone, backup, and recovery evidence is reviewed.
    report["blockers"] = sorted(set(report["blockers"] + ["clone-backup-recovery-required"]))
    args.artifact.write_text(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.validate_only:
        return 0 if report["sourceValid"] else 1
    return 0 if not report["blockers"] else 1

if __name__ == "__main__":
    sys.exit(main())
