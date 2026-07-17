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
EXPECTED_MANIFEST_SHA256 = "f80e82633c46f5ba7128fe4f30ed084dadfd826f436b0d35e1c6d62f841175f2"
TOP_KEYS = {"schemaVersion", "ledgerTerminalVersion", "closureTerminalVersion", "requiredLaterPromotionGate", "migrations", "excludedVersions", "cloneBackupRecoveryRequired"}
ENTRY_KEYS = {"version", "name", "path", "sha256"}
HASH = re.compile(r"[0-9a-f]{64}\Z")
RISK = re.compile(r"(?im)^\s*(?:begin|commit|rollback|savepoint|release\s+savepoint)\b|\b(?:drop\s+(?:table|schema|database|type|function)|truncate|delete\s+from|update\s+\w+|alter\s+table\s+\w+\s+drop)\b")
EXPECTED_SEMANTICS = {
    "schemaVersion": 1,
    "ledgerTerminalVersion": "20260531084516",
    "closureTerminalVersion": "20260713002400",
    "requiredLaterPromotionGate": "20260713002500_g014_catalog_contract.sql",
    "cloneBackupRecoveryRequired": True,
}
EXPECTED_EXCLUDED_VERSIONS = ("20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002200", "20260713002500", "20260713002600", "20260713002700")
CATALOG_RELATIONS = (
    ("public.restaurants", "public", "restaurants"),
    ("public.restaurants_backup", "public", "restaurants_backup"),
    ("storage.objects", "storage", "objects"),
)
CATALOG_PROCEDURES = (
    ("public.approve_submission_item(uuid,uuid,jsonb)", "public", "approve_submission_item", "2950 2950 3802"),
    ("public.approve_edit_submission_item(uuid,uuid,jsonb)", "public", "approve_edit_submission_item", "2950 2950 3802"),
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

    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED_MANIFEST_SHA256:
        raise ValueError("manifest-lock-mismatch")
    data = json.loads(raw, object_pairs_hook=no_duplicates)
    if not isinstance(data, dict) or set(data) != TOP_KEYS:
        raise ValueError("manifest-schema")
    if any(data.get(key) != value for key, value in EXPECTED_SEMANTICS.items()):
        raise ValueError("manifest-semantics")
    if not isinstance(data["migrations"], list) or tuple(data["excludedVersions"]) != EXPECTED_EXCLUDED_VERSIONS:
        raise ValueError("manifest-types")
    for entry in data["migrations"]:
        if not isinstance(entry, dict) or set(entry) != ENTRY_KEYS:
            raise ValueError("manifest-entry-schema")
        values = tuple(entry[key] for key in ("version", "name", "path", "sha256"))
        if not all(isinstance(value, str) for value in values):
            raise ValueError("manifest-entry-types")
    return data


def validate_sources(manifest, report):
    entries = manifest["migrations"]
    if len(entries) != 27:
        fail(report, "manifest-closure-count")
    previous_version = None
    for entry in entries:
        version, name, relative, digest = (entry[key] for key in ("version", "name", "path", "sha256"))
        if not re.fullmatch(r"20\d{12}", version) or not re.fullmatch(r"[a-z0-9_]+", name) or not HASH.fullmatch(digest):
            fail(report, "manifest-identity")
            continue
        if relative != f"backend/supabase/migrations/{version}_{name}.sql":
            fail(report, "path-confinement")
            continue
        if previous_version is not None and version <= previous_version:
            fail(report, "manifest-order")
        previous_version = version
        source = (ROOT / relative).resolve()
        if ROOT not in source.parents or not source.is_file():
            fail(report, "missing-source")
            continue
        actual = hashlib.sha256(source.read_bytes()).hexdigest()
        report["sourceHashes"].append(actual)
        if actual != digest:
            fail(report, "source-hash-mismatch")
        if RISK.search(source.read_text(encoding="utf-8")):
            report["cloneApplyRisks"] += 1
    report["schemaVersion"] = manifest["schemaVersion"]
    report["ledgerExpectedTerminal"] = manifest["ledgerTerminalVersion"]
    report["closureTerminalVersion"] = manifest["closureTerminalVersion"]
    report["requiredLaterPromotionGate"] = manifest["requiredLaterPromotionGate"]
    report["cloneBackupRecoveryRequired"] = manifest["cloneBackupRecoveryRequired"]
    report["sourceValid"] = not report["blockers"]


def catalog_preflight(report):
    connection = None
    cursor = None
    try:
        import psycopg

        connection = psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=True)
        cursor = connection.cursor()
        cursor.execute("BEGIN READ ONLY")
        cursor.execute("SET LOCAL statement_timeout = '5000ms'")
        cursor.execute("SET LOCAL lock_timeout = '1000ms'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout = '5000ms'")
        cursor.execute("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")
        ledger = [str(row[0]) for row in cursor.fetchall()]
        report["ledgerTerminal"] = ledger[-1] if ledger else None
        report["ledgerCount"] = len(ledger)
        if report["ledgerTerminal"] != report["ledgerExpectedTerminal"] or any(version > report["ledgerExpectedTerminal"] for version in ledger):
            fail(report, "ledger-terminal")
        relation_results = []
        for lookup, namespace, name in CATALOG_RELATIONS:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class "
                "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace "
                "WHERE class.oid = pg_catalog.to_regclass(%s) "
                "AND namespace.nspname = %s AND class.relname = %s AND class.relkind = 'r')",
                (lookup, namespace, name),
            )
            relation_results.append(bool(cursor.fetchone()[0]))
        report["relations"] = sum(relation_results)
        procedure_results = []
        for lookup, namespace, name, input_type_oids in CATALOG_PROCEDURES:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS procedure "
                "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace "
                "WHERE procedure.oid = pg_catalog.to_regprocedure(%s) "
                "AND namespace.nspname = %s AND procedure.proname = %s "
                "AND procedure.proargtypes = %s::pg_catalog.oidvector "
                "AND procedure.prokind = 'f')",
                (lookup, namespace, name, input_type_oids),
            )
            procedure_results.append(bool(cursor.fetchone()[0]))
        report["targetRpcs"] = sum(procedure_results)
        cursor.execute("SELECT count(*) FROM pg_catalog.pg_locks WHERE NOT granted")
        report["lockConflictCount"] = int(cursor.fetchone()[0])
        cursor.execute("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = ANY(%s)", (["postgres", "service_role", "authenticated"],))
        report["requiredRoleCount"] = int(cursor.fetchone()[0])
        if report["relations"] != len(CATALOG_RELATIONS) or report["targetRpcs"] != len(CATALOG_PROCEDURES) or report["requiredRoleCount"] != 3 or report["lockConflictCount"]:
            fail(report, "catalog-prerequisite")
    except Exception:
        fail(report, "catalog-read-failed")
    finally:
        if cursor is not None:
            try:
                cursor.execute("ROLLBACK")
            except Exception:
                fail(report, "catalog-rollback-failed")
            try:
                cursor.close()
            except Exception:
                pass
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--artifact", type=Path, default=Path("g034-hosted-preflight.json"))
    args = parser.parse_args(argv)
    report = {"artifactVersion": 1, "sourceValid": False, "catalogChecked": False, "ledgerTerminal": None, "ledgerCount": 0, "sourceHashes": [], "cloneApplyRisks": 0, "relations": 0, "targetRpcs": 0, "requiredRoleCount": 0, "lockConflictCount": 0, "requiredLaterPromotionGate": None, "cloneBackupRecoveryRequired": None, "safeToApply": False, "blockers": []}
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
    report["blockers"] = sorted(set(report["blockers"] + ["clone-backup-recovery-required"]))
    args.artifact.write_text(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.validate_only:
        return 0 if report["sourceValid"] else 1
    return 0 if not report["blockers"] else 1


if __name__ == "__main__":
    sys.exit(main())
