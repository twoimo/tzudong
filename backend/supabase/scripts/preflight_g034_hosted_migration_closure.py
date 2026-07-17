#!/usr/bin/env python3
"""Fail-closed, read-only hosted preflight for the G034 migration closure."""
import argparse
import hashlib
import json
import os
import re
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / ".github/g034-hosted-migration-closure.v1.json"
EXPECTED_MANIFEST_SHA256 = "1f568404418009d191c27a0d8e525306b98b9e1472f4056d1f347907c500a8e1"
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
EXPECTED_EXCLUDED_VERSIONS = ("20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002500", "20260713002600", "20260713002700")
TRACKED_APPROVAL_SOURCE = ROOT / "backend/supabase/migrations/20260417_harden_submission_identity_duplicate_checks.sql"
TRACKED_APPROVAL_SOURCE_SHA256 = "d3a0068674d985cb0ba52b8f3d2d0d909bc0f684ce159f9642ff25105dfc7789"
TRACKED_APPROVAL_FUNCTIONS = (
    ("public.approve_submission_item(uuid,uuid,jsonb)", "public", "approve_submission_item", "2950 2950 3802", "c223fadd74e35f44d0e654ad980e6111129d5810b36d7c932efdbe20b06a4ba6"),
    ("public.approve_edit_submission_item(uuid,uuid,jsonb)", "public", "approve_edit_submission_item", "2950 2950 3802", "7209c1ba8c33a732d3fd8a4ea9e9e4dab43c1f112af2d59b2220a824f6d7cb8d"),
)
CATALOG_RELATIONS = (
    ("public.restaurants", "public", "restaurants"),
    ("storage.objects", "storage", "objects"),
)
PREREQUISITE_NAMES = (
    "ledgerTerminalMatches",
    "noWaitingLocks",
    "publicApproveEditSubmissionItem",
    "publicApproveSubmissionItem",
    "publicRestaurants",
    "publicRestaurantsBackup",
    "requiredRolesPresent",
    "storageObjects",
)

def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
def semantic_fingerprint(definition):
    normalized = re.sub(r"\$[A-Za-z_]*\$", "$$", definition.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    normalized = re.sub(r"\s*([(),;])\s*", r"\1", normalized)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def tracked_approval_source_valid():
    try:
        source = TRACKED_APPROVAL_SOURCE.read_bytes()
    except OSError:
        return False
    if hashlib.sha256(source).hexdigest() != TRACKED_APPROVAL_SOURCE_SHA256:
        return False
    text = source.decode("utf-8")
    marker = "$$;"
    for _, _, name, _, expected_hash in TRACKED_APPROVAL_FUNCTIONS:
        prefix = f"create or replace function public.{name}"
        try:
            start = text.index(prefix)
            end = text.index(marker, start) + len(marker)
        except ValueError:
            return False
        if semantic_fingerprint(text[start:end]) != expected_hash:
            return False
    return True


def contains_restaurants_backup(definition):
    return bool(re.search(r"(?i)(?:public\s*\.\s*)?restaurants_backup\b", definition))


def catalog_retirement_dependency_exists(cursor):
    checks = (
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname NOT LIKE 'pg_toast%%' AND CASE WHEN procedure.prokind IN ('f', 'p') THEN pg_catalog.pg_get_functiondef(procedure.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)' ELSE false END)",
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_views AS view WHERE view.schemaname NOT IN ('pg_catalog', 'information_schema') AND view.schemaname NOT LIKE 'pg_toast%%' AND view.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')",
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_matviews AS view WHERE view.schemaname NOT IN ('pg_catalog', 'information_schema') AND view.schemaname NOT LIKE 'pg_toast%%' AND view.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')",
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS trigger JOIN pg_catalog.pg_class AS class ON class.oid = trigger.tgrelid JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE NOT trigger.tgisinternal AND namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname NOT LIKE 'pg_toast%%' AND pg_catalog.pg_get_triggerdef(trigger.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')",
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite AS rule JOIN pg_catalog.pg_class AS class ON class.oid = rule.ev_class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE rule.rulename <> '_RETURN' AND namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname NOT LIKE 'pg_toast%%' AND pg_catalog.pg_get_ruledef(rule.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')",
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS constraint JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = constraint.connamespace WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname NOT LIKE 'pg_toast%%' AND pg_catalog.pg_get_constraintdef(constraint.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')",
    )
    for query in checks:
        cursor.execute(query)
        if bool(cursor.fetchone()[0]):
            return True
    return False


def repository_commit():
    try:
        value = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except Exception:
        return None
    return value if re.fullmatch(r"[0-9a-f]{40}", value) else None


def refresh_receipt(report):
    evidence = {
        "catalogFingerprint": report["catalogFingerprint"],
        "hostedLedgerFingerprint": report["hostedLedgerFingerprint"],
        "manifestHash": report["manifestHash"],
        "repositoryCommit": report["repositoryCommit"],
        "sourceFingerprint": report["sourceFingerprint"],
    }
    report["preflightReceiptId"] = fingerprint(evidence)


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
    canonical_raw = raw.replace(b"\r\n", b"\n")
    if b"\r" in canonical_raw or hashlib.sha256(canonical_raw).hexdigest() != EXPECTED_MANIFEST_SHA256:
        raise ValueError("manifest-lock-mismatch")
    data = json.loads(canonical_raw, object_pairs_hook=no_duplicates)
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
    if len(entries) != 28:
        fail(report, "manifest-closure-count")
    previous_version = None
    source_hashes = []
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
        source_hashes.append(actual)
        if actual != digest:
            fail(report, "source-hash-mismatch")
        if RISK.search(source.read_text(encoding="utf-8")):
            report["cloneApplyRisks"] += 1
    report["sourceFingerprint"] = fingerprint(
        {"closureMigrationHashes": source_hashes, "trackedApprovalSourceHash": TRACKED_APPROVAL_SOURCE_SHA256}
    )
    report["schemaVersion"] = manifest["schemaVersion"]
    report["ledgerExpectedTerminal"] = manifest["ledgerTerminalVersion"]
    report["closureTerminalVersion"] = manifest["closureTerminalVersion"]
    report["requiredLaterPromotionGate"] = manifest["requiredLaterPromotionGate"]
    report["cloneBackupRecoveryRequired"] = manifest["cloneBackupRecoveryRequired"]
    if not tracked_approval_source_valid():
        fail(report, "tracked-approval-source-invalid")
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
        report["hostedLedgerFingerprint"] = fingerprint(ledger)
        report["prerequisites"]["ledgerTerminalMatches"] = (
            bool(ledger)
            and ledger[-1] == report["ledgerExpectedTerminal"]
            and not any(version > report["ledgerExpectedTerminal"] for version in ledger)
        )
        if not report["prerequisites"]["ledgerTerminalMatches"]:
            fail(report, "ledger-terminal")
        for lookup, namespace, name in CATALOG_RELATIONS:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class "
                "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace "
                "WHERE class.oid = pg_catalog.to_regclass(%s) "
                "AND namespace.nspname = %s AND class.relname = %s AND class.relkind = 'r')",
                (lookup, namespace, name),
            )
            prerequisite = {
                "public.restaurants": "publicRestaurants",
                "storage.objects": "storageObjects",
            }[lookup]
            report["prerequisites"][prerequisite] = bool(cursor.fetchone()[0])
        for lookup, namespace, name, input_type_oids, expected_hash in TRACKED_APPROVAL_FUNCTIONS:
            cursor.execute(
                "SELECT pg_catalog.pg_get_functiondef(procedure.oid) FROM pg_catalog.pg_proc AS procedure "
                "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace "
                "WHERE procedure.oid = pg_catalog.to_regprocedure(%s) "
                "AND namespace.nspname = %s AND procedure.proname = %s "
                "AND procedure.proargtypes = %s::pg_catalog.oidvector "
                "AND procedure.prokind = 'f'",
                (lookup, namespace, name, input_type_oids),
            )
            definition = cursor.fetchone()
            prerequisite = {
                "public.approve_submission_item(uuid,uuid,jsonb)": "publicApproveSubmissionItem",
                "public.approve_edit_submission_item(uuid,uuid,jsonb)": "publicApproveEditSubmissionItem",
            }[lookup]
            report["prerequisites"][prerequisite] = (
                definition is not None
                and not contains_restaurants_backup(definition[0])
                and semantic_fingerprint(definition[0]) == expected_hash
            )
        cursor.execute(
            "SELECT pg_catalog.to_regclass('public.restaurants_backup') IS NULL "
            "AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS namespace WHERE namespace.nspname = 'public')"
        )
        table_absent = bool(cursor.fetchone()[0])
        report["prerequisites"]["publicRestaurantsBackup"] = (
            table_absent and not catalog_retirement_dependency_exists(cursor)
        )
        cursor.execute("SELECT count(*) FROM pg_catalog.pg_locks WHERE NOT granted")
        report["prerequisites"]["noWaitingLocks"] = int(cursor.fetchone()[0]) == 0
        cursor.execute("SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = ANY(%s)", (["postgres", "service_role", "authenticated"],))
        report["prerequisites"]["requiredRolesPresent"] = int(cursor.fetchone()[0]) == 3
        report["catalogFingerprint"] = fingerprint(report["prerequisites"])
        if not all(report["prerequisites"].values()):
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
    report = {
        "artifactVersion": 2,
        "blockers": [],
        "catalogChecked": False,
        "catalogFingerprint": None,
        "cloneApplyRisks": 0,
        "cloneBackupRecoveryRequired": None,
        "hostedLedgerFingerprint": None,
        "manifestHash": None,
        "preflightReceiptId": None,
        "prerequisites": {name: False for name in PREREQUISITE_NAMES},
        "repositoryCommit": repository_commit(),
        "requiredLaterPromotionGate": None,
        "safeToApply": False,
        "sourceFingerprint": None,
        "sourceValid": False,
    }
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
    refresh_receipt(report)
    args.artifact.write_text(json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.validate_only:
        return 0 if report["sourceValid"] else 1
    return 0 if not report["blockers"] else 1


if __name__ == "__main__":
    sys.exit(main())
