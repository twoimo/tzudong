#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import stat
import sys

ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TESTS = os.path.join(ROOT, "backend", "supabase", "tests")
EVIDENCE_ROOT = os.path.join(TESTS, "g038_phase2b_evidence_g13")
DENY = os.path.join(EVIDENCE_ROOT, "deny-observations.json")
RECEIPT = os.path.join(EVIDENCE_ROOT, "run-receipt.json")
MAX_BYTES = 16 * 1024
HEX64 = re.compile(r"^[0-9a-f]{64}$")
UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
SESSION_ID = "d367f506-f4bf-46b1-adf2-0945db47bb73"
EVIDENCE_PATHS = [
    "backend/supabase/tests/g038_phase2b_evidence_g13/deny-observations.json",
    "backend/supabase/tests/g038_phase2b_evidence_g13/run-receipt.json",
]
LIMITATIONS = [
    "solo_operator_cannot_self_certify_isolation",
    "postgres_17_local_results_do_not_transfer_to_shared_15_or_hosted",
    "docker_host_operator_privilege_and_container_Config_Env_password_lifetime_remain",
    "only_catalog_and_three_negative_paths_qualified",
]
UNQUALIFIED = [
    "inventory-58", "inventory-59-scheduler-jobs", "inventory-60", "inventory-61",
    "inventory-62", "inventory-63", "inventory-64", "inventory-65",
    "all-execution-deferred-to-phase-2b", "valid_create_lookup_replay",
    "route_digest_conflict", "nonce_and_route_unique_conflicts",
    "fixed_string_validation", "concurrency_and_40001", "lock_ladder", "ttl",
    "durability", "hosted", "provider", "protected", "independent",
]
PROTECTED = ("http://", "https://", "postgres://", "SUPABASE_", "SERVICE_ROLE", "GITHUB_TOKEN")


def reject_constant(value):
    raise ValueError("non-finite number")
def reject_integer(value):
    if value == "-0":
        raise ValueError("negative zero")
    return int(value)

def reject_float(value):
    raise ValueError("floating point values are prohibited")



def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def load_json_bytes(raw, max_bytes=MAX_BYTES):
    if len(raw) > max_bytes:
        raise ValueError("JSON exceeds byte limit")
    text = raw.decode("utf-8")
    return json.loads(
        text,
        object_pairs_hook=no_duplicates,
        parse_constant=reject_constant,
        parse_int=reject_integer,
        parse_float=reject_float,
    )


def reject_unsafe(value, depth=0):
    if depth > 16:
        raise ValueError("JSON exceeds depth limit")
    if isinstance(value, float):
        raise ValueError("floating point values are prohibited")
    if isinstance(value, str):
        if len(value) > 4096 or "\x00" in value or any(ord(c) < 32 for c in value):
            raise ValueError("invalid string")
        if any(token in value for token in PROTECTED):
            raise ValueError("protected reference")
    elif isinstance(value, list):
        for item in value:
            reject_unsafe(item, depth + 1)
    elif isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("non-string key")
            reject_unsafe(key, depth + 1)
            reject_unsafe(item, depth + 1)


def jcs(value):
    reject_unsafe(value)
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_BYTES:
        raise ValueError("JSON exceeds 16 KiB")
    if load_json_bytes(encoded) != value:
        raise ValueError("JSON round-trip failure")
    return encoded


def require(condition, message):
    if not condition:
        raise ValueError(message)


def utc_timestamp(value, message):
    require(isinstance(value, str) and UTC.fullmatch(value) is not None, message)
    try:
        import datetime
        return datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise ValueError(message) from error


def require_hex(value, message):
    require(isinstance(value, str) and HEX64.fullmatch(value) is not None, message)


def canonical_lifecycle_subset(raw):
    state = load_json_bytes(raw, max_bytes=1024 * 1024)
    require(isinstance(state, dict) and isinstance(state.get("goals"), list), "state envelope")
    statuses = {}
    targets = {"G002", "G003", "G013"}
    for goal in state["goals"]:
        require(isinstance(goal, dict), "state goal")
        goal_id = goal.get("id")
        if goal_id not in targets:
            continue
        require(
            isinstance(goal.get("status"), str) and goal_id not in statuses,
            "state goal",
        )
        statuses[goal_id] = goal["status"]
    require(set(statuses) == targets, "state goal set")
    require(statuses["G002"] == "blocked" and statuses["G003"] == "blocked", "blocked prerequisites")
    require(statuses["G013"] in {"active", "review_blocked"}, "G013 state")
    return {
        "session_id": SESSION_ID,
        "goals": {key: statuses[key] for key in ("G002", "G003", "G013")},
        "terminal": "LOCAL_QUALIFIED_ONLY",
        "satisfies": [],
        "does_not_complete_or_unblock": ["G002", "G003", "aggregate"],
    }


def validate_lifecycle(state_raw, final_path, content_map_sha):
    require_hex(content_map_sha, "map SHA")
    require(
        final_path == ".gjc/_session-aa808c94-d9d5-4798-9524-6e239ec7b6cb/plans/ralplan/aa808c94-d9d5-4798-9524-6e239ec7b6cb/stage-17-final.md",
        "lifecycle path",
    )
    absolute = real_regular(final_path)
    raw = open(absolute, "rb").read()
    require(len(raw) <= MAX_BYTES, "lifecycle final exceeds byte limit")
    text = raw.decode("utf-8")
    require(
        "backend/supabase/tests/g038_phase2b_content_map.sha256" in text
        and content_map_sha in text
        and "LOCAL_QUALIFIED_ONLY" in text
        and '"satisfies":[]' in text
        and '"does_not_complete_or_unblock":["G002","G003","aggregate"]' in text,
        "lifecycle final binding",
    )
    subset = canonical_lifecycle_subset(state_raw)
    return hashlib.sha256(jcs(subset)).hexdigest(), hashlib.sha256(raw).hexdigest()


def validate_manifest(manifest):
    required = {
        "schema_version", "content_map_path", "phase2a_h5_path", "image", "source_paths",
        "copy_paths", "operation_ids", "prestart_predicates", "apply_script_path",
        "negative_script_path", "receipt_schema", "incident_schema", "limitations",
        "unqualified_surface", "evidence_paths",
    }
    require(set(manifest) == required, "manifest keys")
    require(manifest["schema_version"] == "g038.phase2b.manifest.v4", "schema version")
    require(manifest["content_map_path"] == "backend/supabase/tests/g038_phase2b_content_map.sha256", "map path")
    require(manifest["phase2a_h5_path"] == "backend/supabase/tests/g038_authoring_binding.json", "H5 path")
    require(manifest["image"] == {"database": "g009_local", "name": "supabase/postgres:17.6.1.147", "repo_digest": "sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"}, "image")
    source_paths = [
        "backend/supabase/migrations/20260728000100_g038_deterministic_contract.sql",
        "backend/supabase/tests/g038_local_sandbox.sh",
        "backend/supabase/tests/g038_local_sandbox.profile.json",
        "backend/supabase/tests/g038_catalog_assertions.sql",
        "backend/supabase/tests/g038_exclusion_scan.py",
    ]
    require(manifest["source_paths"] == source_paths, "source paths")
    require(manifest["copy_paths"] == [source_paths[0], source_paths[3]], "copy paths")
    require(manifest["operation_ids"] == [f"O{i}" for i in range(1, 19)], "operation IDs")
    require(manifest["apply_script_path"] == "backend/supabase/tests/g038_phase2b_apply.sql", "apply path")
    require(manifest["negative_script_path"] == "backend/supabase/tests/g038_phase2b_negative.sql", "negative path")
    require(manifest["evidence_paths"] == EVIDENCE_PATHS, "Class-E paths")
    require(manifest["limitations"] == LIMITATIONS, "limitations")
    require(manifest["unqualified_surface"] == UNQUALIFIED, "unqualified surface")
    require(manifest["receipt_schema"] == {"required": ["schema_version", "outcome", "terminal", "satisfies", "does_not_complete_or_unblock", "independent", "operator_count", "environment_class", "deny_observations_sha256", "content_map_sha256", "lifecycle_final_path", "lifecycle_final_sha256", "boundary_readback_sha256", "tests", "cleanup", "started_at_utc", "finished_at_utc", "limitations", "unqualified_surface"], "terminal": "LOCAL_QUALIFIED_ONLY"}, "receipt schema")
    require(manifest["prestart_predicates"] == ["content_map_authenticated", "manifest_valid", "source_preflight_passed", "exclusion_scan_passed", "evidence_root_absent", "image_repo_digest_pinned", "image_volumes_null", "container_network_none", "container_mount_count_zero", "container_port_binding_count_zero", "deny_observation_durable", "docker_create_bounded_30_seconds", "readiness_probe_bounded_2_seconds", "authoritative_lifecycle_subset_validated"], "prestart predicates")
    require(manifest["incident_schema"] == {"required": ["schema_version", "outcome", "terminal", "reason_code", "cleanup", "started_at_utc", "finished_at_utc", "independent", "operator_count", "environment_class", "limitations", "unqualified_surface"], "terminal": None}, "incident schema")
    jcs(manifest)


def real_regular(path):
    absolute = os.path.realpath(os.path.join(ROOT, path))
    require(absolute == os.path.join(ROOT, path), "noncanonical source path")
    mode = os.lstat(absolute).st_mode
    require(stat.S_ISREG(mode) and not stat.S_ISLNK(mode), "source is not a regular file")
    return absolute


def source_preflight(paths):
    h5 = load_json_bytes(
        open(os.path.join(TESTS, "g038_authoring_binding.json"), "rb").read(),
        max_bytes=1024 * 1024,
    )
    files = h5["files"]
    for path in paths:
        require(path in files, "unbound source path")
        absolute = real_regular(path)
        raw = open(absolute, "rb").read()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("source is not UTF-8") from error
        require(
            "\x00" not in text
            and "/*" not in text
            and "*/" not in text
            and not any(token in text for token in ("20260713002500", "20260713002600", "20260713002700", "g026", "G026")),
            "source exclusion",
        )
        require(not any(token in text for token in PROTECTED), "protected source reference")
        digest = hashlib.sha256(raw).hexdigest()
        require(digest == files[path], "source digest mismatch")
        print(f"SOURCE_OK {os.path.basename(path)} {digest}")


def canonical_evidence_path(path):
    require(path in (DENY, RECEIPT), "unlisted evidence leaf")
    require(os.path.realpath(TESTS) == TESTS and not os.path.islink(TESTS), "tests root is noncanonical")
    require(os.path.dirname(path) == EVIDENCE_ROOT, "evidence parent")
    return path


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_evidence(path, payload, create_root):
    canonical_evidence_path(path)
    if create_root:
        require(not os.path.lexists(EVIDENCE_ROOT), "EVIDENCE_PATH_OCCUPIED")
        os.mkdir(EVIDENCE_ROOT, 0o700)
        fsync_directory(TESTS)
    require(os.path.isdir(EVIDENCE_ROOT) and not os.path.islink(EVIDENCE_ROOT), "invalid evidence root")
    require(os.path.realpath(EVIDENCE_ROOT) == EVIDENCE_ROOT, "noncanonical evidence root")
    require(not os.path.lexists(path), "EVIDENCE_PATH_OCCUPIED")
    data = jcs(payload)
    temporary = os.path.join(EVIDENCE_ROOT, "." + os.path.basename(path) + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.replace(temporary, path)
        fsync_directory(EVIDENCE_ROOT)
        require(os.path.realpath(path) == path and not os.path.islink(path), "noncanonical evidence leaf")
        persisted = open(path, "rb").read()
        require(persisted == data and load_json_bytes(persisted) == payload, "evidence reopen validation")
    except Exception:
        if os.path.lexists(temporary):
            os.unlink(temporary)
        raise
    return hashlib.sha256(data).hexdigest()


def exact_keys(value, keys):
    require(set(value) == set(keys), "receipt keys")


def deny(args):
    payload = {
        "container_id_sha256": hashlib.sha256(args.container_id.encode("utf-8")).hexdigest(),
        "content_map_sha256": args.content_map_sha,
        "image_volumes_json": args.volumes,
        "mount_count": args.mounts,
        "network_mode": args.network,
        "observed_at_utc": args.observed_at,
        "port_binding_count": args.ports,
        "repo_digests_json": args.repo_digests,
    }
    require(HEX64.fullmatch(payload["content_map_sha256"]) is not None, "map SHA")
    require(HEX64.fullmatch(args.container_id) is not None, "container ID")
    require(
        json.loads(payload["repo_digests_json"])
        and "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
        in json.loads(payload["repo_digests_json"])
        and json.loads(payload["image_volumes_json"]) is None,
        "image observation",
    )
    require(
        payload["network_mode"] == "none"
        and payload["mount_count"] == "0"
        and payload["port_binding_count"] == "0",
        "isolation observation",
    )
    require(
        re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", payload["observed_at_utc"]) is not None,
        "observation time",
    )
    print(write_evidence(DENY, payload, True))


def receipt(args):
    payload = load_json_bytes(args.input.encode("utf-8"))
    require(isinstance(payload, dict), "receipt object")
    for key in payload:
        require("self_sha256" not in key and "run_receipt_sha256" not in key, "self digest")
    if args.kind == "qualified":
        required = ["schema_version", "outcome", "terminal", "satisfies", "does_not_complete_or_unblock", "independent", "operator_count", "environment_class", "deny_observations_sha256", "content_map_sha256", "lifecycle_final_path", "lifecycle_final_sha256", "boundary_readback_sha256", "tests", "cleanup", "started_at_utc", "finished_at_utc", "limitations", "unqualified_surface"]
        exact_keys(payload, required)
        require(payload["schema_version"] == "g038.phase2b.receipt.v1", "receipt schema")
        require(payload["outcome"] == "qualified" and payload["terminal"] == "LOCAL_QUALIFIED_ONLY", "qualified terminal")
        require(payload["satisfies"] == [] and payload["does_not_complete_or_unblock"] == ["G002", "G003", "aggregate"], "non-unblocking")
        require(payload["independent"] is False and payload["operator_count"] == 1 and payload["environment_class"] == "LOCAL_DISPOSABLE_ONLY", "scope")
        require(payload["limitations"] == LIMITATIONS and payload["unqualified_surface"] == UNQUALIFIED, "scope arrays")
        for key in ("deny_observations_sha256", "content_map_sha256", "lifecycle_final_sha256", "boundary_readback_sha256"):
            require_hex(payload[key], key)
        require(hashlib.sha256(open(os.path.join(TESTS, "g038_phase2b_content_map.sha256"), "rb").read()).hexdigest() == payload["content_map_sha256"], "map reference")
        require(
            payload["lifecycle_final_path"]
            == ".gjc/_session-aa808c94-d9d5-4798-9524-6e239ec7b6cb/plans/ralplan/aa808c94-d9d5-4798-9524-6e239ec7b6cb/stage-17-final.md",
            "lifecycle path",
        )
        require(os.path.isfile(DENY) and hashlib.sha256(open(DENY, "rb").read()).hexdigest() == payload["deny_observations_sha256"], "deny reference")
        lifecycle = real_regular(payload["lifecycle_final_path"])
        require(hashlib.sha256(open(lifecycle, "rb").read()).hexdigest() == payload["lifecycle_final_sha256"], "lifecycle reference")
        require(isinstance(payload["tests"], dict) and set(payload["tests"]) == {"apply", "negative", "readiness_attempts"}, "tests shape")
        require(payload["tests"]["apply"] == "PASS|P1_H3_CATALOG" and payload["tests"]["negative"] == "three_zero_write_cases", "tests")
        require(isinstance(payload["tests"]["readiness_attempts"], int) and not isinstance(payload["tests"]["readiness_attempts"], bool) and 1 <= payload["tests"]["readiness_attempts"] <= 60, "readiness")
        require(payload["cleanup"] == {"container_absent": True, "scratch_absent": True}, "cleanup")
        require(utc_timestamp(payload["started_at_utc"], "started time") <= utc_timestamp(payload["finished_at_utc"], "finished time"), "receipt time order")
    else:
        required = ["schema_version", "outcome", "terminal", "reason_code", "cleanup", "started_at_utc", "finished_at_utc", "independent", "operator_count", "environment_class", "limitations", "unqualified_surface"]
        exact_keys(payload, required)
        require(payload["schema_version"] == "g038.phase2b.incident.v1", "incident schema")
        require(
            payload["outcome"] == "incident"
            and payload["terminal"] is None
            and isinstance(payload["reason_code"], str)
            and re.fullmatch(r"post_deny_failure_(?:[1-9][0-9]*)", payload["reason_code"]),
            "incident terminal",
        )
        require(
            payload["independent"] is False
            and payload["operator_count"] == 1
            and payload["environment_class"] == "LOCAL_DISPOSABLE_ONLY"
            and payload["limitations"] == LIMITATIONS
            and payload["unqualified_surface"] == UNQUALIFIED
            and isinstance(payload["cleanup"], dict)
            and set(payload["cleanup"]) == {"container_absent", "scratch_absent"}
            and all(isinstance(value, bool) for value in payload["cleanup"].values()),
            "scope",
        )
        require(utc_timestamp(payload["started_at_utc"], "started time") <= utc_timestamp(payload["finished_at_utc"], "finished time"), "incident time order")
    print(write_evidence(RECEIPT, payload, False))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate-manifest")
    validate.add_argument("manifest")
    preflight = sub.add_parser("source-preflight")
    preflight.add_argument("paths", nargs="+")
    lifecycle = sub.add_parser("validate-lifecycle")
    lifecycle.add_argument("--state-file", required=True)
    lifecycle.add_argument("--final", required=True)
    lifecycle.add_argument("--content-map-sha", required=True)
    deny_parser = sub.add_parser("deny")
    deny_parser.add_argument("--repo-digests", required=True)
    deny_parser.add_argument("--volumes", required=True)
    deny_parser.add_argument("--network", required=True)
    deny_parser.add_argument("--mounts", required=True)
    deny_parser.add_argument("--ports", required=True)
    deny_parser.add_argument("--container-id", required=True)
    deny_parser.add_argument("--content-map-sha", required=True)
    deny_parser.add_argument("--observed-at", required=True)
    receipt_parser = sub.add_parser("receipt")
    receipt_parser.add_argument("--kind", choices=("qualified", "incident"), required=True)
    receipt_parser.add_argument("--input", required=True)
    args = parser.parse_args()
    if args.command == "validate-manifest":
        manifest = load_json_bytes(open(args.manifest, "rb").read())
        validate_manifest(manifest)
        print("MANIFEST_VALID")
    elif args.command == "source-preflight":
        source_preflight(args.paths)
    elif args.command == "deny":
        deny(args)
    elif args.command == "validate-lifecycle":
        boundary_sha, final_sha = validate_lifecycle(open(args.state_file, "rb").read(), args.final, args.content_map_sha)
        print(f"{boundary_sha} {final_sha}")
    else:
        receipt(args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(64)
