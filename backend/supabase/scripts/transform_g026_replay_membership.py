#!/usr/bin/env python3
"""Build one hash-bound G026 replay membership window."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

FILE_KEYS = {
    "filename",
    "sourceSha256",
    "sourceByteLength",
    "transformedSha256",
    "transformedByteLength",
    "mode",
    "anchor",
    "cleanupAnchor",
}



def build_transformed(source: bytes, item: dict[str, Any], window: dict[str, Any]) -> bytes:
    if set(item) != FILE_KEYS:
        raise ValueError("replay membership file binding drifted")
    if len(source) != item["sourceByteLength"] or hashlib.sha256(source).hexdigest() != item["sourceSha256"]:
        raise ValueError(f"replay membership immutable source hash drifted: {item.get('filename', '<unknown>')}")

    precondition = (window["precondition"] + "\n").encode("ascii")
    grant = (window["grantStatement"] + "\n").encode("ascii")
    revoke = (window["revokeStatement"] + "\n").encode("ascii")
    postcondition = (window["postcondition"] + "\n").encode("ascii")
    catalog_schema_usage_grant = (window["catalogSchemaUsageGrantStatement"] + "\n").encode("ascii")
    catalog_function_execute_grant = (window["catalogFunctionExecuteGrantStatement"] + "\n").encode("ascii")
    catalog_function_execute_revoke = (window["catalogFunctionExecuteRevokeStatement"] + "\n").encode("ascii")
    catalog_schema_usage_revoke = (window["catalogSchemaUsageRevokeStatement"] + "\n").encode("ascii")
    catalog_privilege_postcondition = (window["catalogPrivilegePostcondition"] + "\n").encode("ascii")
    cleanup_membership_grant = (window["cleanupMembershipGrantStatement"] + "\n").encode("ascii")
    cleanup_membership_revoke = (window["cleanupMembershipRevokeStatement"] + "\n").encode("ascii")
    mode = item["mode"]

    if mode == "reuse_source_transaction":
        anchor = item["anchor"].encode("ascii")
        cleanup = item["cleanupAnchor"].encode("ascii")
        if source.count(anchor) != 1 or source.count(cleanup) != 1:
            raise ValueError("replay membership transaction reuse drifted")
        transformed = source.replace(anchor, anchor + precondition + grant, 1)
        transformed = transformed.replace(cleanup, b"\n" + revoke + postcondition + b"COMMIT;", 1)
    elif mode == "revoke_before_catalog_assertion":
        anchor = item["anchor"].encode("ascii")
        if item["cleanupAnchor"] or source.count(anchor) != 1:
            raise ValueError("catalog assertion membership ordering drifted")
        transformed = b"BEGIN;\n" + precondition + grant + source.replace(
            anchor,
            catalog_schema_usage_grant
            + catalog_function_execute_grant
            + revoke
            + postcondition
            + anchor
            + cleanup_membership_grant
            + catalog_function_execute_revoke
            + catalog_schema_usage_revoke
            + cleanup_membership_revoke
            + postcondition
            + catalog_privilege_postcondition,
            1,
        ) + b"COMMIT;\n"
    elif mode == "wrapper_transaction":
        if item["anchor"] or item["cleanupAnchor"]:
            raise ValueError("replay membership wrapper anchor drifted")
        transformed = b"BEGIN;\n" + precondition + grant + source + revoke + postcondition + b"COMMIT;\n"
    else:
        raise ValueError("replay membership mode drifted")

    expected_membership_count = 2 if mode == "revoke_before_catalog_assertion" else 1
    if (transformed.count(grant) != expected_membership_count
            or transformed.count(revoke) != expected_membership_count
            or transformed.count(postcondition) != expected_membership_count):
        raise ValueError("replay membership statement count drifted")
    if mode == "revoke_before_catalog_assertion":
        catalog_statements = (
            catalog_schema_usage_grant,
            catalog_function_execute_grant,
            revoke,
            postcondition,
            anchor,
            cleanup_membership_grant,
            catalog_function_execute_revoke,
            catalog_schema_usage_revoke,
            cleanup_membership_revoke,
            postcondition,
            catalog_privilege_postcondition,
        )
        if any(transformed.count(statement) != (expected_membership_count if statement in (grant, revoke, postcondition) else 1) for statement in catalog_statements):
            raise ValueError("catalog assertion privilege statement count drifted")
        positions = [
            transformed.find(catalog_schema_usage_grant),
            transformed.find(catalog_function_execute_grant),
            transformed.find(revoke),
            transformed.find(postcondition),
            transformed.find(anchor),
            transformed.rfind(cleanup_membership_grant),
            transformed.find(catalog_function_execute_revoke),
            transformed.find(catalog_schema_usage_revoke),
            transformed.rfind(cleanup_membership_revoke),
            transformed.rfind(postcondition),
            transformed.find(catalog_privilege_postcondition),
        ]
        if positions != sorted(positions):
            raise ValueError("catalog assertion privilege order drifted")
    elif transformed.find(grant) >= transformed.find(revoke):
        raise ValueError("replay membership statement order drifted")
    return transformed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
    window = bundle.get("replayMembershipWindows")
    if not isinstance(window, dict):
        raise SystemExit("G026 replay membership window is missing")
    matches = [row for row in window.get("files", []) if row.get("filename") == args.source.name]
    if len(matches) != 1:
        raise SystemExit(f"G026 replay membership binding is missing or duplicated: {args.source.name}")
    transformed = build_transformed(args.source.read_bytes(), matches[0], window)
    if len(transformed) != matches[0]["transformedByteLength"] or hashlib.sha256(transformed).hexdigest() != matches[0]["transformedSha256"]:
        raise SystemExit(f"G026 replay membership transformed binding drifted: {args.source.name}")
    args.output.write_bytes(transformed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
