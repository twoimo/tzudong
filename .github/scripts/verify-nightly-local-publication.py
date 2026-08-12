#!/usr/bin/env python3
"""Fail closed on the exact sanitized local-nightly publication bundle."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
ALLOWLIST_PATH = REPOSITORY_ROOT / ".github" / "nightly-local-publication-allowlist.txt"
LOCAL_MIGRATE_PATH = REPOSITORY_ROOT / "backend" / "supabase" / "scripts" / "local-migrate.py"
FUNCTION_SCANNER_PATH = (
    REPOSITORY_ROOT / "backend" / "supabase" / "scripts" / "local-function-runtime-scan.py"
)

STACK_RECEIPT_FIELDS = {
    "action",
    "config_sha256",
    "env_provenance_sha256",
    "error_code",
    "generator_version",
    "input_provenance_sha256",
    "ok",
    "project_name",
    "renderer",
    "schema",
    "services",
}
MIGRATION_SUMMARY_FIELDS = {
    "catalog_sha256",
    "closure_binding_sha256",
    "commit_sha256",
    "config_sha256",
    "env_provenance_sha256",
    "environment_contract_sha256",
    "function_source_sha256",
    "input_provenance_sha256",
    "ledger_count",
    "ledger_sha256",
    "platform_bootstrap_evidence_sha256",
    "platform_bootstrap_sha256",
    "prerequisite_sha256",
    "project_name",
    "readback_row_count",
    "readback_section_counts",
    "readback_sha256",
    "readback_sql_sha256",
    "schema",
    "seed_sha256",
    "seed_source_sha256",
    "sequence",
    "sequence_sha256",
    "service",
    "service_sha256",
    "source_chain_sha256",
    "source_manifest_sha256",
}
RUNTIME_BASE_FIELDS = {
    "schemaVersion",
    "mode",
    "functionCount",
    "localSearchPathCount",
    "unresolvedPathCount",
    "ambiguousPathCount",
    "definerMissingSearchPathCount",
    "functionMetadataDigest",
    "definitionHash",
    "extensionCatalogSha256",
    "externalEffectBindingSha256",
    "candidateResolution",
    "closureSmoke",
    "rpcSmoke",
}
EXPECTED_FIELDS = {
    "local-stack-reset.json": STACK_RECEIPT_FIELDS,
    "local-stack-status.json": STACK_RECEIPT_FIELDS,
    "local-migration-manifest.json": {"schemaVersion", "source", "exclusions"},
    "local-migration-summary.json": MIGRATION_SUMMARY_FIELDS,
    "local-closure-rescan.json": RUNTIME_BASE_FIELDS | {"closureBinding"},
    "local-closure-smoke.json": RUNTIME_BASE_FIELDS | {"candidateRpcSmoke"},
    "local-browser-route-diagnostics.json": {
        "schema", "source", "tests", "record_count", "request_count",
    },
    "local-image-pull-preflight.json": {"schema", "image_count", "images", "container_probe"},
}
EXPECTED_MARKERS = {
    "local-stack-reset.json": ("schema", "local-stack-receipt-v1"),
    "local-stack-status.json": ("schema", "local-stack-receipt-v1"),
    "local-migration-manifest.json": ("schemaVersion", "local-supabase-migration-manifest/v1"),
    "local-migration-summary.json": (
        "schema", "local-migration-publication-summary-v1",
    ),
    "local-closure-rescan.json": ("schemaVersion", "local-function-runtime-scan/v1"),
    "local-closure-smoke.json": ("schemaVersion", "local-function-runtime-scan/v1"),
    "local-browser-route-diagnostics.json": ("schema", "local-browser-route-diagnostics-v1"),
    "local-image-pull-preflight.json": ("schema", "local-image-pull-preflight-v1"),
}
BOUNDARY_MARKER = b"Local-only sanitized receipts; stack.env and credentials excluded.\n"
VALID_BASENAME = re.compile(r"[a-z0-9][a-z0-9.-]*")
SHA256 = re.compile(r"[a-f0-9]{64}")
LOCAL_PROJECT_NAME = re.compile(r"tzudong-local-[a-f0-9]{12}")
STACK_SERVICES = {
    "analytics",
    "auth",
    "db",
    "functions",
    "imgproxy",
    "kong",
    "mail",
    "meta",
    "realtime",
    "rest",
    "storage",
    "studio",
    "supavisor",
    "vector",
}
EXPECTED_LEDGER_UNITS = 74
SEQUENCE_MARKERS = (
    "prerequisite",
    "migration",
    "closure",
    "platform-bootstrap",
    "seed",
)
EXPECTED_IMAGES = {
    "supabase/studio:2025.12.17-sha-43f4f7f",
    "kong:2.8.1",
    "supabase/gotrue:v2.184.0",
    "postgrest/postgrest:v14.1",
    "supabase/realtime:v2.68.0",
    "supabase/storage-api:v1.33.0",
    "darthsim/imgproxy:v3.8.0",
    "supabase/postgres-meta:v0.95.1",
    "supabase/edge-runtime:v1.69.28",
    "supabase/logflare:1.27.0",
    "supabase/postgres:15.8.1.085",
    "timberio/vector:0.28.1-alpine",
    "supabase/supavisor:2.7.4",
    "inbucket/inbucket:3.0.3",
}
SERVICES_WITHOUT_DOCKER_HEALTHCHECK = {"functions", "rest"}
READBACK_SECTIONS = (
    "extensions",
    "roles",
    "schemas",
    "relations",
    "columns",
    "constraints",
    "indexes",
    "functions",
    "policies",
    "triggers",
    "storage_buckets",
    "storage_policies",
    "realtime_membership",
    "public_read_function_grants",
    "public_read_table_grants",
    "public_read_policies",
    "caller_bound_admin_policies",
    "admin_data_rpcs",
    "admin_data_table_grants",
    "admin_map_overlay_rpc",
    "admin_map_overlay_table_grants",
    "admin_map_overlay_policies",
    "auth_users",
    "auth_identities",
    "profiles",
    "user_roles",
    "user_account_status",
    "privacy_policy_fixture",
    "privacy_age_profile",
    "youtube_channel_snapshot",
    "restaurants",
    "announcements",
    "seed_buckets",
    "seed_realtime",
)
CATALOG_SECTIONS = READBACK_SECTIONS[:22]
SEED_SECTIONS = READBACK_SECTIONS[22:]
READBACK_ROW_LENGTHS = {
    "extensions": 5,
    "roles": 7,
    "schemas": 3,
    "relations": 5,
    "columns": 8,
    "constraints": 6,
    "indexes": 5,
    "functions": 8,
    "policies": 8,
    "triggers": 7,
    "storage_buckets": 6,
    "storage_policies": 8,
    "realtime_membership": 4,
    "public_read_function_grants": 4,
    "public_read_table_grants": 7,
    "public_read_policies": 7,
    "caller_bound_admin_policies": 8,
    "admin_data_rpcs": 11,
    "admin_data_table_grants": 6,
    "admin_map_overlay_rpc": 16,
    "admin_map_overlay_table_grants": 10,
    "admin_map_overlay_policies": 7,
    "auth_users": 6,
    "auth_identities": 4,
    "profiles": 7,
    "user_roles": 3,
    "user_account_status": 4,
    "privacy_policy_fixture": 10,
    "privacy_age_profile": 8,
    "youtube_channel_snapshot": 16,
    "restaurants": 8,
    "announcements": 9,
    "seed_buckets": 4,
    "seed_realtime": 4,
}
BROWSER_DIAGNOSTIC_RELATIONS = {
    "application-method-denied:local-web",
    "application-path-denied:local-web",
    "hosted-supabase-allowed:hosted-supabase",
    "hosted-supabase-denied:hosted-supabase",
    "hosted-supabase-method-denied:hosted-supabase",
    "local-dev-websocket:local-web",
    "local-supabase-allowed:local-supabase",
    "mutation-denied:local-web",
    "mutation-denied:local-supabase",
    "mutation-denied:hosted-supabase",
    "mutation-denied:naver-maps",
    "mutation-denied:third-party-provider",
    "mutation-denied:external-other",
    "naver-offline:naver-maps",
    "request-failed:local-web",
    "request-failed:local-supabase",
    "request-failed:hosted-supabase",
    "request-failed:naver-maps",
    "request-failed:third-party-provider",
    "request-failed:external-other",
    "supabase-method-denied:local-supabase",
    "supabase-offline:local-supabase",
    "supabase-path-denied:local-supabase",
    "third-party-provider-denied:third-party-provider",
    "unknown-destination-denied:external-other",
    "websocket-denied:hosted-supabase",
    "websocket-denied:naver-maps",
    "websocket-denied:third-party-provider",
    "websocket-denied:external-other",
    "websocket-denied:invalid-url",
    "websocket-path-denied:local-web",
    "websocket-path-denied:local-supabase",
}
CREDENTIAL_KEY = re.compile(
    r"(?i)(?:password|secret|authorization|(?:service[_-]?role|anon|api)[_-]?key|"
    r"database[_-]?url|postgres[_-]?url|access[_-]?token|refresh[_-]?token)"
)
CREDENTIAL_VALUE = re.compile(
    r"(?i)(?:postgres(?:ql)?://[^\s\"']+|bearer\s+[A-Za-z0-9._~+/-]{16,}|"
    r"eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|"
    r"-----BEGIN [A-Z ]+PRIVATE KEY-----)"
)


def fail(message: str) -> None:
    raise SystemExit(message)


def load_allowlist() -> list[str]:
    entries = [
        line.strip()
        for line in ALLOWLIST_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not entries or len(entries) != len(set(entries)):
        fail("publication allowlist must be non-empty and unique")
    if any(VALID_BASENAME.fullmatch(entry) is None for entry in entries):
        fail("publication allowlist contains an invalid basename")
    if set(entries) != set(EXPECTED_FIELDS) | {"publication-boundary.txt"}:
        fail("publication allowlist and verifier schema are out of sync")
    return entries


def reject_credential_fields(value: object, name: str) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if CREDENTIAL_KEY.search(str(key)) and nested not in (None, "", False, 0, [], {}):
                fail(f"publication artifact contains a credential-bearing field: {name}")
            reject_credential_fields(nested, name)
    elif isinstance(value, list):
        for nested in value:
            reject_credential_fields(nested, name)


def verify_stack_receipt(payload: dict[str, object], name: str) -> None:
    expected_action = "reset" if name == "local-stack-reset.json" else "status"
    if (
        payload.get("action") != expected_action
        or payload.get("ok") is not True
        or payload.get("error_code") is not None
        or payload.get("generator_version") != "local-stack-v1"
        or payload.get("renderer") != "v2.39.4"
        or not isinstance(payload.get("project_name"), str)
        or LOCAL_PROJECT_NAME.fullmatch(payload["project_name"]) is None
    ):
        fail(f"local stack success receipt contract mismatch: {name}")
    for digest_name in (
        "config_sha256",
        "env_provenance_sha256",
        "input_provenance_sha256",
    ):
        digest = payload.get(digest_name)
        if not isinstance(digest, str) or SHA256.fullmatch(digest) is None:
            fail(f"local stack digest contract mismatch: {name}")
    services = payload.get("services")
    if not isinstance(services, list) or len(services) != len(STACK_SERVICES):
        fail(f"local stack service count mismatch: {name}")
    service_names: set[str] = set()
    for service in services:
        if not isinstance(service, dict) or set(service) != {"service", "state", "health"}:
            fail(f"local stack service schema mismatch: {name}")
        service_name = service.get("service")
        if not isinstance(service_name, str) or service_name not in STACK_SERVICES:
            fail(f"local stack service name mismatch: {name}")
        service_names.add(service_name)
        expected_health = "" if service_name in SERVICES_WITHOUT_DOCKER_HEALTHCHECK else "healthy"
        if service.get("state") != "running" or service.get("health") != expected_health:
            fail(f"local stack service readiness mismatch: {name}")
    if service_names != STACK_SERVICES:
        fail(f"local stack service set mismatch: {name}")


def canonical_json(value: object) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("ascii")
    except (TypeError, ValueError, UnicodeEncodeError) as error:
        raise SystemExit("publication artifact contains a non-canonical value") from error


def serialize_rows(rows: object) -> bytes:
    if not isinstance(rows, list):
        fail("publication receipt rows are not a list")
    try:
        encoded = [
            json.dumps(
                row,
                ensure_ascii=True,
                separators=(",", ":"),
                allow_nan=False,
            )
            for row in rows
        ]
    except (TypeError, ValueError) as error:
        raise SystemExit("publication receipt rows are not canonical") from error
    return ("\n".join(encoded) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    except OSError as error:
        raise SystemExit("publication verifier source binding is unavailable") from error
    return digest.hexdigest()


def load_source_module(name: str, path: Path) -> object:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        fail("publication verifier source binding is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as error:
        raise SystemExit("publication verifier source binding is unavailable") from error
    return module


def verify_manifest(payload: dict[str, object]) -> None:
    source = payload.get("source")
    exclusions = payload.get("exclusions")
    if (
        not isinstance(source, dict)
        or set(source) != {"root", "migrationCount", "chainSha256", "files"}
        or source.get("root") != "backend/supabase/migrations"
        or source.get("migrationCount") != EXPECTED_LEDGER_UNITS
        or not isinstance(source.get("chainSha256"), str)
        or SHA256.fullmatch(source["chainSha256"]) is None
        or exclusions != [
            "apps/web/supabase/migrations",
            "backend/supabase/baselines/historical",
            "hosted release manifests",
            "historical replay-authorized-false bundles",
        ]
    ):
        fail("local migration manifest contract mismatch")
    files = source.get("files")
    if not isinstance(files, list) or len(files) != EXPECTED_LEDGER_UNITS:
        fail("local migration manifest unit count mismatch")
    for ordinal, item in enumerate(files, 1):
        if not isinstance(item, dict) or set(item) != {
            "byteLength", "ordinal", "path", "sha256", "transaction",
        }:
            fail("local migration manifest unit schema mismatch")
        transaction = item.get("transaction")
        if (
            item.get("ordinal") != ordinal
            or not isinstance(item.get("path"), str)
            or re.fullmatch(
                r"backend/supabase/migrations/[0-9][A-Za-z0-9_.-]*\.sql",
                item["path"],
            ) is None
            or not isinstance(item.get("sha256"), str)
            or SHA256.fullmatch(item["sha256"]) is None
            or type(item.get("byteLength")) is not int
            or not 1 <= item["byteLength"] <= 4 * 1024 * 1024
            or not isinstance(transaction, dict)
            or set(transaction) != {
                "class", "hasBegin", "hasCommit", "hasRollback", "hasSavepoint", "tokens",
            }
            or transaction.get("class") not in {
                "transactional", "transactional_explicit", "self_committing",
            }
            or any(type(transaction.get(key)) is not bool for key in (
                "hasBegin", "hasCommit", "hasRollback", "hasSavepoint",
            ))
            or not isinstance(transaction.get("tokens"), list)
            or any(
                token not in {"BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT"}
                for token in transaction["tokens"]
            )
        ):
            fail("local migration manifest unit contract mismatch")
    chain_parts = []
    for item in files:
        chain_parts.extend((
            item["path"].encode("utf-8"),
            b"\0",
            item["sha256"].encode("ascii"),
            b"\n",
        ))
    if source.get("chainSha256") != sha256_bytes(b"".join(chain_parts)):
        fail("local migration manifest chain digest mismatch")


def expected_unit_evidence(item: dict[str, object]) -> str:
    transaction = item["transaction"]
    assert isinstance(transaction, dict)
    return sha256_bytes(serialize_rows([[
        "unit",
        item["path"],
        item["ordinal"],
        item["sha256"],
        item["byteLength"],
        transaction["class"],
        "running",
        "",
    ]]))


def verify_migration_summary(
    payload: dict[str, object],
    manifest: dict[str, object],
) -> None:
    source = manifest["source"]
    assert isinstance(source, dict)
    manifest_digest = sha256_bytes(canonical_json(manifest))
    digest_fields = {
        "source_manifest_sha256", "source_chain_sha256", "function_source_sha256",
        "seed_source_sha256", "prerequisite_sha256", "platform_bootstrap_sha256",
        "platform_bootstrap_evidence_sha256", "sequence_sha256", "closure_binding_sha256",
        "config_sha256", "input_provenance_sha256", "env_provenance_sha256",
        "environment_contract_sha256", "readback_sql_sha256", "readback_sha256",
        "catalog_sha256", "seed_sha256", "ledger_sha256", "service_sha256",
    }
    if (
        not isinstance(payload.get("project_name"), str)
        or LOCAL_PROJECT_NAME.fullmatch(payload["project_name"]) is None
        or any(
            not isinstance(payload.get(field), str)
            or SHA256.fullmatch(payload[field]) is None
            for field in digest_fields
        )
        or payload.get("source_manifest_sha256") != manifest_digest
        or payload.get("source_chain_sha256") != source.get("chainSha256")
    ):
        fail("local migration publication summary contract mismatch")

    files = source.get("files")
    if (
        not isinstance(files, list)
        or payload.get("ledger_count") != len(files)
        or payload.get("ledger_count") != EXPECTED_LEDGER_UNITS
    ):
        fail("local migration publication ledger count mismatch")

    sequence = payload.get("sequence")
    expected_evidence = (
        payload["prerequisite_sha256"], payload["source_chain_sha256"], None,
        payload["platform_bootstrap_evidence_sha256"], payload["seed_source_sha256"],
    )
    if not isinstance(sequence, list) or len(sequence) != len(SEQUENCE_MARKERS):
        fail("local migration receipt sequence count mismatch")
    for index, row in enumerate(sequence):
        expected = expected_evidence[index]
        if (
            not isinstance(row, dict)
            or set(row) != {
                "marker", "ordinal", "evidence_sha256", "source_manifest_sha256",
            }
            or row.get("marker") != SEQUENCE_MARKERS[index]
            or row.get("ordinal") != index + 1
            or not isinstance(row.get("evidence_sha256"), str)
            or SHA256.fullmatch(row["evidence_sha256"]) is None
            or (expected is not None and row["evidence_sha256"] != expected)
            or row.get("source_manifest_sha256") != manifest_digest
        ):
            fail("local migration publication sequence mismatch")

    service = payload.get("service")
    if (
        service != {
            "server_version_num": "150008",
            "server_encoding": "UTF8",
            "timezone": "UTC",
        }
    ):
        fail("local migration publication service mismatch")
    section_counts = payload.get("readback_section_counts")
    if (
        not isinstance(section_counts, dict)
        or set(section_counts) != set(READBACK_SECTIONS)
        or any(type(value) is not int or value < 0 for value in section_counts.values())
        or any(section_counts[section] < 1 for section in READBACK_SECTIONS)
        or payload.get("readback_row_count") != sum(section_counts.values())
        or type(payload.get("readback_row_count")) is not int
        or payload["readback_row_count"] <= 0
        or not isinstance(payload.get("commit_sha256"), str)
        or re.fullmatch(r"[a-f0-9]{40}", payload["commit_sha256"]) is None
    ):
        fail("local migration publication readback summary mismatch")

    local_migrate = load_source_module(
        "nightly_publication_local_migrate",
        LOCAL_MIGRATE_PATH,
    )
    try:
        current_manifest = local_migrate.verify_manifest()
        prerequisite_path = REPOSITORY_ROOT / local_migrate.PREREQUISITE_OUTPUT
        seed_path = REPOSITORY_ROOT / local_migrate.SEED_SOURCE
        readback_path = REPOSITORY_ROOT / local_migrate.READBACK_SOURCE
        platform_sha = local_migrate._platform_bootstrap_sha256()
        platform_evidence = local_migrate._platform_bootstrap_evidence_sha256()
    except Exception as error:
        raise SystemExit("local migration publication source binding is unavailable") from error
    if current_manifest != manifest:
        fail("local migration publication manifest source drift")
    if (
        payload.get("prerequisite_sha256") != sha256_file(prerequisite_path)
        or payload.get("seed_source_sha256") != sha256_file(seed_path)
        or payload.get("readback_sql_sha256") != sha256_file(readback_path)
        or payload.get("platform_bootstrap_sha256") != platform_sha
        or payload.get("platform_bootstrap_evidence_sha256") != platform_evidence
    ):
        fail("local migration publication tracked source binding mismatch")

    expected_ledger = []
    for item in files:
        assert isinstance(item, dict)
        transaction = item["transaction"]
        assert isinstance(transaction, dict)
        expected_ledger.append([
            "ledger", item["path"], item["ordinal"], item["sha256"],
            item["byteLength"], transaction["class"], "applied",
            expected_unit_evidence(item),
        ])
    if payload.get("ledger_sha256") != sha256_bytes(serialize_rows(expected_ledger)):
        fail("local migration publication ledger digest mismatch")
    sequence_rows = [
        [
            "sequence", row["marker"], row["ordinal"], row["evidence_sha256"],
            row["source_manifest_sha256"],
        ]
        for row in sequence
    ]
    if payload.get("sequence_sha256") != sha256_bytes(serialize_rows(sequence_rows)):
        fail("local migration publication sequence digest mismatch")
    service_rows = [[
        "service", service["server_version_num"], service["server_encoding"],
        service["timezone"],
    ]]
    if payload.get("service_sha256") != sha256_bytes(serialize_rows(service_rows)):
        fail("local migration publication service digest mismatch")

    input_manifest_path = REPOSITORY_ROOT / "backend" / "supabase" / "local-inputs" / "manifest.v1.json"
    try:
        input_manifest = json.loads(input_manifest_path.read_text(encoding="utf-8"))
        function_entries = [
            entry for entry in input_manifest["inputs"]
            if entry.get("output") in (
                "functions/main/index.ts", "functions/naver-geocode/index.ts",
            )
        ]
        function_evidence = [
            {
                "path": entry["output"],
                "sha256": entry.get("source_sha256") or entry.get("template_sha256"),
            }
            for entry in function_entries
        ]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise SystemExit("local function publication source binding is unavailable") from error
    if (
        [item["path"] for item in function_evidence]
        != ["functions/main/index.ts", "functions/naver-geocode/index.ts"]
        or any(
            not isinstance(item["sha256"], str)
            or SHA256.fullmatch(item["sha256"]) is None
            for item in function_evidence
        )
        or payload.get("function_source_sha256")
        != sha256_bytes(canonical_json(function_evidence))
    ):
        fail("local function publication input binding mismatch")

    expected_commit = os.environ.get("GITHUB_SHA")
    if expected_commit is not None and (
        re.fullmatch(r"[a-f0-9]{40}", expected_commit) is None
        or payload.get("commit_sha256") != expected_commit
    ):
        fail("local migration publication commit binding mismatch")


def verify_runtime_receipt(payload: dict[str, object], name: str) -> None:
    candidate = payload.get("candidateResolution")
    closure = payload.get("closureSmoke")
    rpc = payload.get("rpcSmoke")
    if (
        payload.get("mode") != "runtime"
        or type(payload.get("functionCount")) is not int
        or payload["functionCount"] <= 0
        or payload.get("localSearchPathCount") != payload["functionCount"]
        or payload.get("unresolvedPathCount") != 0
        or payload.get("ambiguousPathCount") != 0
        or payload.get("definerMissingSearchPathCount") != 0
        or any(
            not isinstance(payload.get(field), str)
            or SHA256.fullmatch(payload[field]) is None
            for field in (
                "functionMetadataDigest", "definitionHash", "extensionCatalogSha256",
                "externalEffectBindingSha256",
            )
        )
        or not isinstance(candidate, dict)
        or set(candidate) != {
            "candidateCount", "resolvedCount", "missingCount", "ambiguousCount",
        }
        or type(candidate.get("candidateCount")) is not int
        or candidate["candidateCount"] <= 0
        or type(candidate.get("resolvedCount")) is not int
        or type(candidate.get("missingCount")) is not int
        or type(candidate.get("ambiguousCount")) is not int
        or candidate.get("missingCount") != 0
        or candidate.get("ambiguousCount") != 0
        or candidate.get("resolvedCount") != candidate.get("candidateCount")
        or not isinstance(closure, dict)
        or set(closure) != {
            "status", "unresolvedPathCount", "ambiguousPathCount",
            "candidateMissingCount", "candidateAmbiguousCount",
        }
        or closure.get("status") != "passed"
        or any(closure.get(field) != 0 for field in (
            "unresolvedPathCount", "ambiguousPathCount", "candidateMissingCount",
            "candidateAmbiguousCount",
        ))
        or not isinstance(rpc, dict)
        or set(rpc) != {"status", "passed", "failed", "ambiguous", "cases"}
        or rpc.get("status") != "passed"
        or rpc.get("failed") != 0
        or rpc.get("ambiguous") != 0
        or type(rpc.get("passed")) is not int
        or rpc["passed"] < 1
        or not isinstance(rpc.get("cases"), list)
        or not rpc["cases"]
    ):
        fail(f"local function runtime success contract mismatch: {name}")

    cases = rpc["cases"]
    assert isinstance(cases, list)
    allowed_case_classes = {
        "closure_candidate", "in_function_guard", "read_only", "mutating", "external",
    }
    seen_rpcs: set[str] = set()
    for case in cases:
        if (
            not isinstance(case, dict)
            or set(case) != {"rpc", "class", "status", "errorClass"}
            or not isinstance(case.get("rpc"), str)
            or not 1 <= len(case["rpc"]) <= 512
            or case.get("class") not in allowed_case_classes
            or case.get("status") != "passed"
            or case.get("errorClass") is not None
            and (
                not isinstance(case.get("errorClass"), str)
                or re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", case["errorClass"]) is None
            )
            or case["rpc"] in seen_rpcs
        ):
            fail(f"local function runtime case mismatch: {name}")
        seen_rpcs.add(case["rpc"])
    counted_cases = [case for case in cases if case["class"] != "closure_candidate"]
    if rpc["passed"] != len(counted_cases):
        fail(f"local function runtime case count mismatch: {name}")
    external_cases = [case for case in cases if case["rpc"] == "external_effect_branches"]
    if external_cases != [{
        "rpc": "external_effect_branches",
        "class": "external",
        "status": "passed",
        "errorClass": "external_effect_blocked",
    }]:
        fail(f"local function external-effect proof mismatch: {name}")

    if name == "local-closure-rescan.json":
        binding = payload.get("closureBinding")
        if (
            not isinstance(binding, dict)
            or set(binding) != {
                "sourceManifestSha256", "toolSha256", "trustedExtensionManifestSha256",
                "candidateSetSha256", "patchSha256", "bindingSha256",
            }
            or any(
                not isinstance(value, str) or SHA256.fullmatch(value) is None
                for value in binding.values()
            )
        ):
            fail("local function closure binding mismatch")
        if cases != external_cases:
            fail("local function rescan RPC proof mismatch")
    else:
        candidate_smoke = payload.get("candidateRpcSmoke")
        if (
            not isinstance(candidate_smoke, dict)
            or set(candidate_smoke) != {
                "status", "candidateCount", "passed", "failed", "cases",
            }
            or candidate_smoke.get("status") != "passed"
            or candidate_smoke.get("candidateCount") != candidate.get("candidateCount")
            or candidate_smoke.get("passed") != candidate_smoke.get("candidateCount")
            or candidate_smoke.get("failed") != 0
            or not isinstance(candidate_smoke.get("cases"), list)
            or len(candidate_smoke["cases"]) != candidate_smoke["candidateCount"]
        ):
            fail("local function candidate smoke mismatch")
        expected_candidate_cases = []
        for case in cases:
            if case["class"] == "closure_candidate":
                expected_candidate_cases.append({
                    "rpc": case["rpc"],
                    "status": case["status"],
                    "errorClass": case["errorClass"],
                })
        if candidate_smoke["cases"] != expected_candidate_cases:
            fail("local function candidate smoke case mismatch")
        guard_cases = [
            case for case in cases
            if case["rpc"] ==
            "public.preview_privacy_incident_transition:service_role_guard"
        ]
        if guard_cases != [{
            "rpc": "public.preview_privacy_incident_transition:service_role_guard",
            "class": "in_function_guard",
            "status": "passed",
            "errorClass": "in_function_sqlstate_P0001",
        }]:
            fail("local function privacy incident guard proof mismatch")


def verify_browser_diagnostics(payload: dict[str, object]) -> None:
    tests = payload.get("tests")
    if (
        payload.get("source") != "playwright-nightly-fixture"
        or not isinstance(tests, list)
        or not tests
        or len(tests) > 1024
    ):
        fail("local browser diagnostics contract mismatch")
    count = 0
    request_count = 0
    for index, test in enumerate(tests):
        if (
            not isinstance(test, dict)
            or set(test) != {"index", "records"}
            or test.get("index") != index
            or not isinstance(test.get("records"), list)
            or len(test["records"]) > 256
        ):
            fail("local browser diagnostics test schema mismatch")
        count += len(test["records"])
        for record in test["records"]:
            if (
                not isinstance(record, dict)
                or set(record) != {"destination", "method", "status", "class", "count"}
                or not isinstance(record.get("destination"), str)
                or not isinstance(record.get("method"), str)
                or re.fullmatch(r"[A-Z]{1,12}", record["method"]) is None
                or type(record.get("status")) is not int
                or not 0 <= record["status"] <= 599
                or not isinstance(record.get("class"), str)
                or f"{record['class']}:{record['destination']}"
                not in BROWSER_DIAGNOSTIC_RELATIONS
                or type(record.get("count")) is not int
                or not 1 <= record["count"] <= 65_535
            ):
                fail("local browser diagnostics record mismatch")
            request_count += record["count"]
    if (
        count != payload.get("record_count")
        or count > 1024
        or request_count != payload.get("request_count")
        or request_count > 1024 * 65_535
    ):
        fail("local browser diagnostics count mismatch")


def verify_image_preflight(payload: dict[str, object]) -> None:
    images = payload.get("images")
    probe = payload.get("container_probe")
    if (
        payload.get("image_count") != len(EXPECTED_IMAGES)
        or not isinstance(images, list)
        or len(images) != len(EXPECTED_IMAGES)
        or not isinstance(probe, dict)
        or probe != {"status": "passed", "failure_class": "none"}
    ):
        fail("local image pull preflight contract mismatch")
    names = set()
    for image in images:
        if (
            not isinstance(image, dict)
            or set(image) != {"image", "status", "failure_class"}
            or image.get("status") != "pulled"
            or image.get("failure_class") != "none"
            or not isinstance(image.get("image"), str)
        ):
            fail("local image pull result mismatch")
        names.add(image["image"])
    if names != EXPECTED_IMAGES:
        fail("local image pull set mismatch")


def verify_cross_artifact_bindings(payloads: dict[str, dict[str, object]]) -> None:
    reset = payloads["local-stack-reset.json"]
    status = payloads["local-stack-status.json"]
    receipt = payloads["local-migration-summary.json"]
    for field in (
        "project_name", "config_sha256", "input_provenance_sha256",
        "env_provenance_sha256",
    ):
        if reset.get(field) != status.get(field) or reset.get(field) != receipt.get(field):
            fail(f"local publication stack binding mismatch: {field}")

    rescan = payloads["local-closure-rescan.json"]
    smoke = payloads["local-closure-smoke.json"]
    for field in (
        "functionCount", "localSearchPathCount", "functionMetadataDigest",
        "definitionHash", "extensionCatalogSha256", "externalEffectBindingSha256",
        "candidateResolution", "closureSmoke",
    ):
        if rescan.get(field) != smoke.get(field):
            fail(f"local publication runtime binding mismatch: {field}")
    binding = rescan.get("closureBinding")
    sequence = receipt.get("sequence")
    if (
        not isinstance(binding, dict)
        or not isinstance(sequence, list)
        or len(sequence) < 3
        or not isinstance(sequence[2], dict)
        or binding.get("bindingSha256") != receipt.get("closure_binding_sha256")
        or rescan.get("definitionHash") != sequence[2].get("evidence_sha256")
    ):
        fail("local publication closure binding mismatch")
    function_scanner = load_source_module(
        "nightly_publication_function_scanner",
        FUNCTION_SCANNER_PATH,
    )
    try:
        _, metadata = function_scanner.generate_patch()
        expected_fields = {
            key: metadata[key]
            for key in (
                "sourceManifestSha256", "toolSha256",
                "trustedExtensionManifestSha256", "candidateSetSha256", "patchSha256",
            )
        }
        expected_binding = function_scanner._closure_binding_sha256(
            metadata,
            rescan["definitionHash"],
        )
    except Exception as error:
        raise SystemExit("local publication closure source binding is unavailable") from error
    if (
        not isinstance(binding, dict)
        or any(binding.get(key) != value for key, value in expected_fields.items())
        or binding.get("bindingSha256") != expected_binding
    ):
        fail("local publication closure tracked source binding mismatch")


def verify(root: Path) -> None:
    if not root.is_dir() or root.is_symlink():
        fail("publication artifact root is missing or unsafe")
    allowed_entries = load_allowlist()
    allowed = set(allowed_entries)
    all_paths = list(root.rglob("*"))
    if any(path.is_symlink() for path in all_paths):
        fail("publication artifact tree contains a symlink")
    files = {path.relative_to(root).as_posix() for path in all_paths if path.is_file()}
    if files != allowed:
        fail(f"unexpected publication artifacts: {sorted(files ^ allowed)}")

    artifact_size_bounds = {name: 256 * 1024 for name in allowed}
    if sum((root / name).stat().st_size for name in allowed) > 4 * 1024 * 1024:
        fail("publication bundle exceeds aggregate size bound")

    payloads: dict[str, dict[str, object]] = {}
    for name in sorted(allowed):
        path = root / name
        data = path.read_bytes()
        if len(data) > artifact_size_bounds[name]:
            fail(f"publication artifact exceeds size bound: {name}")
        if name == "publication-boundary.txt":
            if data != BOUNDARY_MARKER:
                fail("publication boundary marker is not canonical")
            continue
        try:
            payload = json.loads(data)
        except json.JSONDecodeError as error:
            raise SystemExit(f"publication artifact is not JSON: {name}") from error
        expected = EXPECTED_FIELDS[name]
        if not isinstance(payload, dict) or set(payload) != expected:
            fail(f"publication artifact schema mismatch: {name}")
        marker_key, marker_value = EXPECTED_MARKERS[name]
        if payload.get(marker_key) != marker_value:
            fail(f"publication artifact marker mismatch: {name}")
        if name in {"local-stack-reset.json", "local-stack-status.json"}:
            verify_stack_receipt(payload, name)
        serialized = json.dumps(payload, separators=(",", ":"))
        if "[REDACTED]" in serialized or CREDENTIAL_VALUE.search(serialized):
            fail(f"publication artifact contains a credential-shaped value: {name}")
        reject_credential_fields(payload, name)
        payloads[name] = payload

    verify_manifest(payloads["local-migration-manifest.json"])
    verify_migration_summary(
        payloads["local-migration-summary.json"],
        payloads["local-migration-manifest.json"],
    )
    verify_runtime_receipt(
        payloads["local-closure-rescan.json"],
        "local-closure-rescan.json",
    )
    verify_runtime_receipt(
        payloads["local-closure-smoke.json"],
        "local-closure-smoke.json",
    )
    verify_browser_diagnostics(payloads["local-browser-route-diagnostics.json"])
    verify_image_preflight(payloads["local-image-pull-preflight.json"])
    verify_cross_artifact_bindings(payloads)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    root = Path(args.root)
    if not root.is_absolute():
        root = REPOSITORY_ROOT / root
    verify(root)


if __name__ == "__main__":
    main()
