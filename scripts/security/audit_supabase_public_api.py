#!/usr/bin/env python3
"""Audit Supabase public-schema Data API exposure without printing secrets.

The script reads database connection settings from an env file or the process
environment, optionally applies migration SQL inside a transaction, runs grant/RLS
readback checks, prints only object names/counts, and always rolls the transaction
back when --rollback is used.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Iterable

import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[2]
PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")

SERVICE_ONLY_RPC_SIGNATURES = {
    "make_user_admin": "target_email text",
    "batch_insert_restaurants_from_jsonl": "jsonl_array jsonb[]",
    "insert_restaurant_from_jsonl": "jsonl_data jsonb",
    "refresh_materialized_views": "",
    "cleanup_old_notifications": "days_to_keep integer",
    "approve_restaurant": "restaurant_id uuid, admin_user_id uuid",
    "reject_restaurant": "restaurant_id uuid, admin_user_id uuid, reject_reason text",
    "approve_restaurant_submission": "submission_id uuid, admin_user_id uuid",
    "reject_restaurant_submission": "p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text",
    "approve_new_restaurant_submission": "p_submission_id uuid, p_admin_user_id uuid, p_geocoded_data jsonb",
    "approve_edit_restaurant_submission": "p_submission_id uuid, p_admin_user_id uuid, p_approved_unique_ids uuid[]",
    "reject_submission": "p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text",
    "reject_submission_item": "p_item_id uuid, p_admin_user_id uuid, p_rejection_reason text",
}

AUTHENTICATED_BOUND_RPC_SIGNATURES = {
    "approve_submission_item": "p_item_id uuid, p_admin_user_id uuid, p_restaurant_data jsonb",
    "approve_edit_submission_item": "p_item_id uuid, p_admin_user_id uuid, p_updated_data jsonb",
}

TABLE_PRIVILEGE_EXPECTATIONS: dict[str, dict[str, set[str]]] = {
    "ad_banners": {"anon": {"SELECT"}, "authenticated": {"SELECT", "INSERT", "UPDATE", "DELETE"}},
    "announcements": {"anon": {"SELECT"}, "authenticated": {"SELECT", "INSERT", "UPDATE", "DELETE"}},
    "profiles": {"anon": {"SELECT"}, "authenticated": {"SELECT", "INSERT", "UPDATE"}},
    "restaurant_popular_rank_snapshots": {"anon": {"SELECT"}, "authenticated": {"SELECT"}},
    "restaurants": {"anon": {"SELECT"}, "authenticated": {"SELECT", "UPDATE"}},
    "reviews": {"anon": {"SELECT"}, "authenticated": {"SELECT", "INSERT", "UPDATE", "DELETE"}},
    "review_likes": {"anon": {"SELECT"}, "authenticated": {"SELECT", "INSERT", "DELETE"}},
    "short_urls": {"anon": {"SELECT"}, "authenticated": {"SELECT"}},
    "transcript_embeddings_bge": {"anon": {"SELECT"}, "authenticated": {"SELECT"}},
    "user_bookmarks": {"anon": {"SELECT"}, "authenticated": {"SELECT", "INSERT", "DELETE"}},
    "user_stats": {"anon": {"SELECT"}, "authenticated": {"SELECT"}},
    "video_frame_captions": {"anon": {"SELECT"}, "authenticated": {"SELECT"}},
    "videos": {"anon": {"SELECT"}, "authenticated": {"SELECT"}},
    "notifications": {"anon": set(), "authenticated": {"SELECT", "INSERT", "UPDATE", "DELETE"}},
    "ocr_logs": {"anon": set(), "authenticated": {"SELECT", "INSERT"}},
    "restaurant_requests": {"anon": set(), "authenticated": {"SELECT", "INSERT", "UPDATE"}},
    "restaurant_submissions": {"anon": set(), "authenticated": {"SELECT", "INSERT", "UPDATE", "DELETE"}},
    "restaurant_submission_items": {"anon": set(), "authenticated": {"SELECT", "INSERT", "UPDATE", "DELETE"}},
    "search_logs": {"anon": {"INSERT"}, "authenticated": {"SELECT", "INSERT"}},
    "admin_workflow_runs": {"anon": set(), "authenticated": {"SELECT"}},
    "admin_workflow_signals": {"anon": set(), "authenticated": {"SELECT"}},
    "admin_workflow_steps": {"anon": set(), "authenticated": {"SELECT"}},
    "document_embeddings": {"anon": set(), "authenticated": set()},
    "restaurants_duplicate": {"anon": set(), "authenticated": set()},
}


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def connection_kwargs(env: dict[str, str]) -> dict[str, str]:
    merged = {**env, **os.environ}
    return {
        "host": merged["SUPABASE_DB_HOST"],
        "port": merged.get("SUPABASE_DB_PORT", "5432"),
        "dbname": merged.get("SUPABASE_DB_NAME", "postgres"),
        "user": merged["SUPABASE_DB_USER"],
        "password": merged["SUPABASE_DB_PASSWORD"],
        "sslmode": merged.get("SUPABASE_DB_SSLMODE", "require"),
    }


def resolve_path(path_text: str) -> Path:
    path = Path(path_text)
    if path.is_absolute():
        return path
    return (REPO_ROOT / path).resolve()


def fetch_function_privileges(cursor, signatures: dict[str, str]) -> dict[str, dict[str, bool]]:
    result: dict[str, dict[str, bool]] = {}
    for name, args in signatures.items():
        cursor.execute(
            """
            SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
                   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = %s
              AND pg_get_function_identity_arguments(p.oid) = %s
            """,
            (name, args),
        )
        row = cursor.fetchone()
        result[f"public.{name}({args})"] = {
            "exists": row is not None,
            "anon_execute": bool(row[0]) if row else False,
            "authenticated_execute": bool(row[1]) if row else False,
        }
    return result


def fetch_table_privileges(cursor, expectations: dict[str, dict[str, set[str]]]) -> dict[str, dict[str, list[str]]]:
    result: dict[str, dict[str, list[str]]] = {}
    for table in expectations:
        result[table] = {}
        for role in ("anon", "authenticated"):
            allowed: list[str] = []
            for privilege in PRIVILEGES:
                cursor.execute("SELECT has_table_privilege(%s, %s, %s)", (role, f"public.{table}", privilege))
                if cursor.fetchone()[0]:
                    allowed.append(privilege)
            result[table][role] = allowed
    return result


def collect_violations(function_privs: dict[str, dict[str, bool]], table_privs: dict[str, dict[str, list[str]]]) -> list[str]:
    violations: list[str] = []

    for signature in [f"public.{name}({args})" for name, args in SERVICE_ONLY_RPC_SIGNATURES.items()]:
        privs = function_privs[signature]
        if not privs["exists"]:
            violations.append(f"missing rpc: {signature}")
        if privs["anon_execute"] or privs["authenticated_execute"]:
            violations.append(f"service-only rpc browser executable: {signature}")

    for signature in [f"public.{name}({args})" for name, args in AUTHENTICATED_BOUND_RPC_SIGNATURES.items()]:
        privs = function_privs[signature]
        if not privs["exists"]:
            violations.append(f"missing rpc: {signature}")
        if privs["anon_execute"]:
            violations.append(f"auth-bound rpc anon executable: {signature}")
        if not privs["authenticated_execute"]:
            violations.append(f"auth-bound rpc missing authenticated execute: {signature}")

    for table, roles in TABLE_PRIVILEGE_EXPECTATIONS.items():
        for role, expected in roles.items():
            actual = set(table_privs[table][role])
            extra = actual - expected
            missing = expected - actual
            if extra:
                violations.append(f"extra table privileges for {role} on public.{table}: {sorted(extra)}")
            if missing:
                violations.append(f"missing table privileges for {role} on public.{table}: {sorted(missing)}")

    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default="backend/.env", help="Path to env file with SUPABASE_DB_* settings")
    parser.add_argument("--rollback-migration", action="append", default=[], help="Migration SQL to apply inside a transaction before auditing")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args()

    env = load_env_file(resolve_path(args.env_file))
    applied_migrations: list[str] = []
    violations: list[str] = []
    function_privs: dict[str, dict[str, bool]] = {}
    table_privs: dict[str, dict[str, list[str]]] = {}

    conn = psycopg2.connect(**connection_kwargs(env))
    conn.autocommit = False
    try:
        with conn.cursor() as cursor:
            for migration in args.rollback_migration:
                path = resolve_path(migration)
                cursor.execute(path.read_text())
                applied_migrations.append(str(path.relative_to(REPO_ROOT)))

            function_privs.update(fetch_function_privileges(cursor, SERVICE_ONLY_RPC_SIGNATURES))
            function_privs.update(fetch_function_privileges(cursor, AUTHENTICATED_BOUND_RPC_SIGNATURES))
            table_privs = fetch_table_privileges(cursor, TABLE_PRIVILEGE_EXPECTATIONS)
            violations = collect_violations(function_privs, table_privs)
    finally:
        conn.rollback()
        conn.close()

    service_only_executable = sum(
        1 for name, args in SERVICE_ONLY_RPC_SIGNATURES.items()
        if function_privs[f"public.{name}({args})"]["anon_execute"]
        or function_privs[f"public.{name}({args})"]["authenticated_execute"]
    )
    anon_table_extras = sum(
        1 for table, roles in TABLE_PRIVILEGE_EXPECTATIONS.items()
        if set(table_privs[table]["anon"]) - roles["anon"]
    )

    output = {
        "status": "passed" if not violations else "failed",
        "rolledBack": True,
        "migrationsAppliedInRollback": applied_migrations,
        "checks": {
            "serviceOnlyRpcBrowserExecutableCount": service_only_executable,
            "anonTableUnexpectedPrivilegeTableCount": anon_table_extras,
            "tableCount": len(TABLE_PRIVILEGE_EXPECTATIONS),
            "serviceOnlyRpcCount": len(SERVICE_ONLY_RPC_SIGNATURES),
            "authenticatedBoundRpcCount": len(AUTHENTICATED_BOUND_RPC_SIGNATURES),
        },
        "violations": violations,
    }
    if args.json:
        print(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(f"status={output['status']}")
        print(f"rolledBack={output['rolledBack']}")
        for key, value in output["checks"].items():
            print(f"{key}={value}")
        for violation in violations:
            print(f"violation={violation}")
    return 0 if not violations else 1


if __name__ == "__main__":
    raise SystemExit(main())
