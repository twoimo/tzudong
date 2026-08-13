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
EXPECTED_MANIFEST_SHA256 = "bba79f264f26158d2fd93f62a0632f44ff8a0575619b50928e23ecefccf8ab95"
TOP_KEYS = {"schemaVersion", "ledgerTerminalVersion", "closureTerminalVersion", "requiredLaterPromotionGate", "migrations", "excludedVersions", "cloneBackupRecoveryRequired"}
ENTRY_KEYS = {"version", "name", "path", "sha256"}
HASH = re.compile(r"[0-9a-f]{64}\Z")
RISK = re.compile(r"(?im)^\s*(?:begin|commit|rollback|savepoint|release\s+savepoint)\b|\b(?:drop\s+(?:table|schema|database|type|function)|truncate|delete\s+from|update\s+\w+|alter\s+table\s+\w+\s+drop)\b")
EXPECTED_SEMANTICS = {
    "schemaVersion": 1,
    "ledgerTerminalVersion": "20260531084516",
    "closureTerminalVersion": "20260801000300",
    "requiredLaterPromotionGate": "20260713002500_g014_catalog_contract.sql",
    "cloneBackupRecoveryRequired": True,
}
EXPECTED_EXCLUDED_VERSIONS = ("20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002500", "20260713002600", "20260713002700")
TRACKED_APPROVAL_SOURCE = ROOT / "backend/supabase/migrations/20260417_harden_submission_identity_duplicate_checks.sql"
TRACKED_APPROVAL_SOURCE_SHA256 = "d3a0068674d985cb0ba52b8f3d2d0d909bc0f684ce159f9642ff25105dfc7789"
TRACKED_APPROVAL_FUNCTIONS = (
    (
        "public.approve_submission_item(uuid,uuid,jsonb)",
        "public",
        "approve_submission_item",
        "2950 2950 3802",
        (
            "p_item_id",
            "p_admin_user_id",
            "p_restaurant_data",
            "success",
            "message",
            "created_restaurant_id",
        ),
        "f11100ddf81a000dbdcc69d31d93e680d0a3e7e65b7a963f6f82a0c409dfc63b",
    ),
    (
        "public.approve_edit_submission_item(uuid,uuid,jsonb)",
        "public",
        "approve_edit_submission_item",
        "2950 2950 3802",
        (
            "p_item_id",
            "p_admin_user_id",
            "p_updated_data",
            "success",
            "message",
            "restaurant_id",
        ),
        "fd1de9a09b4427b84c3d76cf4c894e5593e9d805eb275f8c32721d6963eb5ad4",
    ),
)
APPROVAL_CATALOG_ATTRIBUTES = (
    "f",
    "plpgsql",
    True,
    ("search_path=public",),
    True,
    2249,
    (2950, 2950, 3802, 16, 25, 2950),
    ("i", "i", "i", "t", "t", "t"),
)
CREATE_FUNCTION = re.compile(
    r"(?im)^\s*create\s+or\s+replace\s+function\s+public\s*\.\s*([a-z_][a-z0-9_]*)\s*\("
)
DOLLAR_DELIMITER = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")
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
def body_fingerprint(body):
    normalized = re.sub(r"\s+", " ", body.lower()).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def extract_dollar_quoted_body(definition):
    delimiters = DOLLAR_DELIMITER.findall(definition)
    if len(delimiters) != 2 or delimiters[0] != delimiters[1]:
        raise ValueError("malformed-dollar-quoted-body")
    opener = re.search(r"(?is)\bas\s+" + re.escape(delimiters[0]), definition)
    if opener is None:
        raise ValueError("missing-dollar-quoted-body")
    body_start = opener.end()
    body_end = definition.find(delimiters[0], body_start)
    if body_end < body_start:
        raise ValueError("mismatched-dollar-delimiter")
    return definition[body_start:body_end]


def _approval_fragments(source_path=TRACKED_APPROVAL_SOURCE):
    source = source_path.read_bytes()
    if hashlib.sha256(source).hexdigest() != TRACKED_APPROVAL_SOURCE_SHA256:
        raise ValueError("tracked-approval-source-hash")
    text = source.decode("utf-8")
    declarations = list(CREATE_FUNCTION.finditer(text))
    fragments = []
    for item in TRACKED_APPROVAL_FUNCTIONS:
        lookup, namespace, name, input_type_oids, argnames, expected_fragment_hash = item
        matches = [match for match in declarations if match.group(1) == name]
        if len(matches) != 1:
            raise ValueError("tracked-approval-declaration")
        start = matches[0].start()
        following = [match.start() for match in declarations if match.start() > start]
        declaration = text[start:min(following, default=len(text))]
        opening = re.search(r"(?is)\bas\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)", declaration)
        if opening is None:
            raise ValueError("missing-dollar-quoted-body")
        delimiter = opening.group(1)
        body_end = declaration.find(delimiter, opening.end())
        if body_end < opening.end() or not declaration[body_end + len(delimiter):].startswith(";"):
            raise ValueError("malformed-dollar-quoted-body")
        fragment = declaration[:body_end + len(delimiter) + 1]
        if DOLLAR_DELIMITER.findall(fragment) != [delimiter, delimiter]:
            raise ValueError("malformed-dollar-quoted-body")
        if hashlib.sha256(fragment.encode("utf-8")).hexdigest() != expected_fragment_hash:
            raise ValueError("tracked-approval-source-fragment")
        fragments.append((item, fragment))
    return tuple(fragments)


def approval_source_statements(source_path=TRACKED_APPROVAL_SOURCE):
    return tuple(fragment for _, fragment in _approval_fragments(source_path))


def approval_body_contract(source_path=TRACKED_APPROVAL_SOURCE):
    contract = {}
    for item, fragment in _approval_fragments(source_path):
        lookup, namespace, name, input_type_oids, argnames, _ = item
        contract[lookup] = {
            "namespace": namespace,
            "name": name,
            "input_type_oids": input_type_oids,
            "argnames": argnames,
            "body_hash": body_fingerprint(extract_dollar_quoted_body(fragment)),
        }
    return contract


def tracked_approval_source_valid():
    try:
        approval_body_contract()
    except (OSError, UnicodeDecodeError, ValueError):
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
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS catalog_constraint JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = catalog_constraint.connamespace WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') AND namespace.nspname NOT LIKE 'pg_toast%%' AND pg_catalog.pg_get_constraintdef(catalog_constraint.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)')",
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
    if len(entries) != 29:
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
def approval_catalog_contract(cursor, contract=None, *, expected_proconfig=APPROVAL_CATALOG_ATTRIBUTES[3]):
    contract = approval_body_contract() if contract is None else contract
    if type(expected_proconfig) is not tuple or any(type(value) is not str for value in expected_proconfig):
        raise ValueError("approval-proconfig-contract")
    results = {}
    for lookup, expected in contract.items():
        cursor.execute(
            "SELECT pg_catalog.pg_get_functiondef(procedure.oid), procedure.prokind, language.lanname, "
            "procedure.prosecdef, procedure.proconfig, procedure.proretset, procedure.prorettype, "
            "procedure.proallargtypes, procedure.proargmodes, procedure.proargnames "
            "FROM pg_catalog.pg_proc AS procedure "
            "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace "
            "JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang "
            "WHERE procedure.oid = pg_catalog.to_regprocedure(%s) "
            "AND namespace.nspname = %s AND procedure.proname = %s "
            "AND procedure.proargtypes = %s::pg_catalog.oidvector",
            (lookup, expected["namespace"], expected["name"], expected["input_type_oids"]),
        )
        rows = cursor.fetchall()
        if len(rows) != 1:
            results[lookup] = False
            continue
        definition, prokind, language, prosecdef, proconfig, proretset, prorettype, allargtypes, argmodes, argnames = rows[0]
        try:
            body_matches = body_fingerprint(extract_dollar_quoted_body(definition)) == expected["body_hash"]
        except ValueError:
            body_matches = False
        results[lookup] = (
            not contains_restaurants_backup(definition)
            and body_matches
            and (
                prokind,
                language,
                prosecdef,
                tuple(proconfig or ()),
                proretset,
                prorettype,
                tuple(allargtypes or ()),
                tuple(argmodes or ()),
                tuple(argnames or ()),
            )
            == APPROVAL_CATALOG_ATTRIBUTES[:3] + (expected_proconfig,) + APPROVAL_CATALOG_ATTRIBUTES[4:] + (expected["argnames"],)
        )
    return results




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
        approval_results = approval_catalog_contract(cursor)
        for lookup, valid in approval_results.items():
            prerequisite = {
                "public.approve_submission_item(uuid,uuid,jsonb)": "publicApproveSubmissionItem",
                "public.approve_edit_submission_item(uuid,uuid,jsonb)": "publicApproveEditSubmissionItem",
            }[lookup]
            report["prerequisites"][prerequisite] = valid
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
