#!/usr/bin/env python3
"""Build a deterministic, local-only final-source antithesis bundle.

This script reads explicitly selected repository text files. It never uses the
network, changes Git, mutates coordinator state, or dispatches research jobs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_BUNDLE_BYTES = 48 * 1024 * 1024

THESIS_URL = "https://chatgpt.com/c/6ad4b1ad-fc10-83ec-bbd0-abd1dec881c4"
THESIS_SHA256 = "4c5542b59d9bcb426eac29722b6da36c9c23337fa622bd9e822bd6b3ffe4ad82"
THESIS_BUNDLE_SHA256 = "bd8f5668b7a00d48a623471183863cda1ae9eb48c14a0d1dc569508e0f2058c3"
ANTITHESIS_BUNDLE_SHA256 = "10fc28e7d72ed4fbb6e7b6206acbd31143528d0831d9f836ff41c47ace018bc7"
QUEUED_JOB = "tzudong-b5d62c34-10fc28e7-antithesis-r01-r06"
QUEUED_REQUEST = "b0b3b8780cd9dd5b3ffc4875"

GROUPS: dict[str, list[str]] = {
    "immutable_context": [
        "apps/web/performance/cross-audit-20261018/master-plan.md",
        "apps/web/performance/cross-audit-20261018/chatgpt-thesis-full-report.md",
        "apps/web/performance/cross-audit-20261018/chatgpt-thesis-receipt.json",
        "apps/web/performance/cross-audit-20261018/source-manifest.json",
        "apps/web/performance/cross-audit-20261018/gemini-antithesis-plan.md",
        "apps/web/performance/cross-audit-20261018/gemini-antithesis-source-manifest.json",
        "apps/web/performance/cross-audit-20261018/final-source-antithesis-plan.md",
        "apps/web/performance/cross-audit-20261018/prepare-final-source-antithesis-bundle.py",
    ],
    "provider_budget_th001_th003": [
        "backend/utils/provider-budget.mjs",
        "backend/utils/provider_budget.py",
        "backend/utils/tests/provider-budget-js.test.mjs",
        "backend/utils/tests/test_pipeline_performance.py",
        "backend/utils/tests/gemini-client.test.mjs",
        "apps/web/performance/cross-audit-20261018/provider-findings.json",
    ],
    "review_cms_th004_th006": [
        "apps/web/components/admin/SubmissionListView.tsx",
        "apps/web/components/reviews/ReviewModal.tsx",
        "apps/web/tests-unit/review-save-submit.test.ts",
        "apps/web/tests-unit/review-modal-ocr-ux.test.ts",
        "apps/web/tests-unit/admin-console-uiux-source.test.ts",
        "apps/web/tests-unit/admin-moderation-inline-focus-browser.test.ts",
        "apps/web/tests-unit/review-close-revision-browser.test.ts",
        "apps/web/tests-unit/review-draft-revision-browser.test.ts",
        "apps/web/performance/admin-cms-followup-20261018/focus-and-dirty-interactions.json",
        "apps/web/performance/cross-audit-20261018/cms-findings.json",
        "apps/web/performance/cross-audit-20261018/inline-focus-application-readback-20261018.json",
    ],
    "longform_th009": [
        "backend/knowledge_graph/longform_analysis.py",
        "backend/knowledge_graph/claude_video_adapter.py",
        "backend/knowledge_graph/caption_osk_adapter.py",
        "backend/knowledge_graph/tests/test_longform_analysis.py",
        "backend/knowledge_graph/tests/test_longform_segments.py",
        "backend/knowledge_graph/tests/test_claude_video_adapter.py",
        "backend/knowledge_graph/tests/test_caption_osk_adapter.py",
        "apps/web/performance/cross-audit-20261018/lineage-findings.json",
    ],
    "ocr_credential_fallback": [
        "apps/web/lib/ocr/gemini.ts",
        "apps/web/lib/ocr/runtime-config.ts",
        "apps/web/lib/ocr/route-helpers.ts",
        "apps/web/lib/ocr/admin-receipt-processor.ts",
        "apps/web/app/api/ocr/extract/route.ts",
        "apps/web/app/api/ocr/extract/stream/route.ts",
        "apps/web/tests-unit/gemini-ocr.test.ts",
        "apps/web/tests-unit/ocr-runtime-config.test.ts",
        "apps/web/tests-unit/ocr-route-helpers.test.ts",
        "apps/web/tests-unit/zz-ocr-route-contract.test.ts",
        "apps/web/performance/cross-audit-20261018/remaining-request-evidence-audit.json",
    ],
    "admin_users_banners_cas": [
        "apps/web/app/admin/banners/page.tsx",
        "apps/web/hooks/use-ad-banners.tsx",
        "apps/web/types/ad-banner.ts",
        "apps/web/lib/ad-banner-url.ts",
        "apps/web/app/api/admin/banners/route.ts",
        "apps/web/components/admin/AdminUsersPanel.tsx",
        "apps/web/styles/admin-ui.css",
        "apps/web/app/api/admin/users/route.ts",
        "apps/web/app/api/admin/users/[userId]/route.ts",
        "apps/web/tests-unit/admin-banners-functional-contract.test.ts",
        "apps/web/tests-unit/admin-users-pagination-contract.test.ts",
        "apps/web/tests-unit/admin-users-mutation-scope.test.ts",
        "apps/web/tests-unit/admin-user-management-source.test.ts",
        "apps/web/tests-unit/ad-banner-url-security.test.ts",
        "apps/web/performance/cross-audit-20261018/admin-users-banners-final-diff-findings.json",
        "apps/web/performance/cross-audit-20261018/admin-users-banners-final-resolution.json",
        "apps/web/performance/cross-audit-20261018/admin-users-banners-native-resolution-review.json",
        "apps/web/performance/admin-cms-followup-20261018/root-visual-delta-readback.json",
        "apps/web/performance/admin-cms-followup-20261018/artifact-map.json",
        "apps/web/performance/admin-cms-followup-20261018/render-metrics.json",
        "apps/web/performance/cross-audit-20261018/followup-verification/verification-current.json",
    ],
    "review_verification_th007_th008": [
        "backend/supabase/migrations/20261016090000_review_verification_delete_guard_readiness.sql",
        "apps/web/tests-unit/review-verification-runtime-readiness.test.ts",
        "apps/web/performance/feature-sql-integration-20261013/pg17-existing-catalog-replay-review-verification-readiness-20261018.json",
        "apps/web/performance/feature-completion-20261013/storyboard-runtime-source-closure-20261016.json",
        "apps/web/performance/cross-audit-20261018/db-evidence-findings.json",
        "apps/web/performance/cross-audit-20261018/hosted-catalog-metadata-20261018.json",
    ],
    "evidence_prefixed_89_105": [
        ".github/review-media-sql-successor.v1.json",
        ".github/review-media-feature-sql-successor.v1.json",
        ".github/review-media-evidence-prefixed-predecessor-successor.v1.json",
        ".github/review-media-evidence-prefixed-feature-successor.v1.json",
        "apps/web/scripts/review-media-evidence-prefixed-sql-successors.mjs",
        "apps/web/scripts/review-media-evidence-prefixed-predecessor-sql-successor.mjs",
        "apps/web/scripts/review-media-evidence-prefixed-feature-sql-successor.mjs",
        "apps/web/tests-unit/review-media-evidence-prefixed-sql-successors.test.ts",
        "apps/web/tests-unit/review-media-sql-successor-harness.test.ts",
        "apps/web/tests-unit/review-media-feature-sql-successor.test.ts",
        "apps/web/performance/feature-sql-integration-20261013/verify-feature-migrations.mjs",
        "apps/web/performance/feature-sql-integration-20261013/verify-evidence-prefixed-aggregate-compiled.mjs",
        "apps/web/performance/feature-sql-integration-20261013/pg17-existing-catalog-replay-evidence-prefixed-successors-20261018.json",
        "apps/web/performance/feature-sql-integration-20261013/pg17-evidence-prefixed-aggregate-compiled-20261018.json",
        "apps/web/performance/cross-audit-20261018/evidence-prefixed-successors-local-readiness-20261018.json",
        "apps/web/performance/cross-audit-20261018/evidence-prefixed-successors-aggregate-execution-20261018.json",
        "apps/web/performance/cross-audit-20261018/evidence-prefixed-native-review.json",
        "apps/web/performance/cross-audit-20261018/evidence-prefixed-native-review-addendum.json",
        "apps/web/performance/cross-audit-20261018/evidence-prefixed-successors-source-binding-followup-20261018.json",
        "apps/web/performance/cross-audit-20261018/hosted-ledger-mapping-20261018.json",
        "apps/web/performance/cross-audit-20261018/hosted-ledger-local86-comparison-20261018.json",
        "apps/web/performance/cross-audit-20261018/hosted-ledger-successor-findings.json",
    ],
}

EXPAND_MANIFESTS = [
    ".github/review-media-sql-successor.v1.json",
    ".github/review-media-feature-sql-successor.v1.json",
    ".github/review-media-evidence-prefixed-predecessor-successor.v1.json",
    ".github/review-media-evidence-prefixed-feature-successor.v1.json",
]

FORBIDDEN_PATH_PARTS = (
    "/.env", "cookies", "supabase/.temp", "ocr-credential-fallback-raw",
    "provider-node24-results", "provider-python", "provider-integration-results",
    "source_bundle.txt", ".png", ".jpg", ".jpeg", ".webp", ".log",
)
SECRET_PATTERNS = (
    re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(rb"AIza[0-9A-Za-z_-]{35}"),
    re.compile(rb"sb_secret_[0-9A-Za-z_-]{20,}"),
    re.compile(rb"postgres(?:ql)?://[^\s/:@]+:[^\s/@]+@", re.I),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_regular(relative: str) -> bytes:
    path = REPO / relative
    if path.is_symlink() or not path.is_file():
        raise SystemExit(f"required regular file missing: {relative}")
    data = path.read_bytes()
    if len(data) > MAX_FILE_BYTES:
        raise SystemExit(f"selected file exceeds {MAX_FILE_BYTES} bytes: {relative}")
    if b"\0" in data:
        raise SystemExit(f"binary file rejected: {relative}")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SystemExit(f"non-UTF-8 file rejected: {relative}: {error}") from None
    return data


def verify_safe_path(relative: str) -> None:
    normalized = Path(relative)
    if normalized.is_absolute() or ".." in normalized.parts:
        raise SystemExit(f"unsafe path: {relative}")
    lowered = "/" + normalized.as_posix().lower()
    if any(part in lowered for part in FORBIDDEN_PATH_PARTS):
        raise SystemExit(f"forbidden path selected: {relative}")


def expand_sources() -> tuple[dict[str, str], list[str]]:
    path_groups: dict[str, str] = {}
    for group, paths in GROUPS.items():
        for relative in paths:
            previous = path_groups.setdefault(relative, group)
            if previous != group:
                raise SystemExit(f"path assigned to multiple groups: {relative}")

    for manifest_path in EXPAND_MANIFESTS:
        document = json.loads(read_regular(manifest_path))
        dynamic_paths: list[str] = []
        for key in ("migrations", "evidenceMigrations", "toolchain"):
            values = document.get(key, [])
            if not isinstance(values, list):
                raise SystemExit(f"manifest {manifest_path} has invalid {key}")
            for item in values:
                if isinstance(item, dict) and isinstance(item.get("path"), str):
                    dynamic_paths.append(item["path"])
        target = document.get("targetManifest")
        if isinstance(target, dict) and isinstance(target.get("manifestPath"), str):
            dynamic_paths.append(target["manifestPath"])
        mapping = document.get("baseMapping")
        if isinstance(mapping, dict) and isinstance(mapping.get("path"), str):
            dynamic_paths.append(mapping["path"])
        for relative in dynamic_paths:
            path_groups.setdefault(relative, "evidence_prefixed_89_105")

    selected = sorted(path_groups)
    for relative in selected:
        verify_safe_path(relative)
    return path_groups, selected


def verify_immutable_anchors() -> dict[str, object]:
    anchors = {
        "thesisReport": "apps/web/performance/cross-audit-20261018/chatgpt-thesis-full-report.md",
        "thesisBundle": "apps/web/performance/cross-audit-20261018/source_bundle.txt",
        "antithesisBundle": "apps/web/performance/cross-audit-20261018/gemini-antithesis-source_bundle.txt",
    }
    expected = {
        "thesisReport": THESIS_SHA256,
        "thesisBundle": THESIS_BUNDLE_SHA256,
        "antithesisBundle": ANTITHESIS_BUNDLE_SHA256,
    }
    values: dict[str, object] = {"thesisUrl": THESIS_URL}
    for name, relative in anchors.items():
        actual = sha256(read_regular(relative))
        if actual != expected[name]:
            raise SystemExit(f"immutable anchor changed: {relative}: {actual}")
        values[name] = {"path": relative, "sha256": actual}

    audit_path = "apps/web/performance/cross-audit-20261018/audit-state.json"
    audit_bytes = read_regular(audit_path)
    audit = json.loads(audit_bytes)
    gemini = audit.get("gemini", {})
    if (gemini.get("job") != QUEUED_JOB or gemini.get("requestId") != QUEUED_REQUEST
            or gemini.get("sourceBundleSha256") != ANTITHESIS_BUNDLE_SHA256
            or gemini.get("dispatches") != 0 or gemini.get("uploads") != 0):
        raise SystemExit("preserved queued Gemini job/hash no longer matches the preparation contract")
    values["preservedQueuedGemini"] = {
        "auditStatePath": audit_path,
        "auditStateSha256": sha256(audit_bytes),
        "job": QUEUED_JOB,
        "requestId": QUEUED_REQUEST,
        "sourceBundleSha256": ANTITHESIS_BUNDLE_SHA256,
        "status": gemini.get("status"),
        "dispatches": 0,
        "uploads": 0,
    }
    completion_path = "apps/web/performance/cross-audit-20261018/completion-manifest.json"
    values["preservedCompletionManifest"] = {
        "path": completion_path,
        "sha256": sha256(read_regular(completion_path)),
    }
    return values


def git_output(*args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True,
    )
    return completed.stdout.strip()


def scan_sources(path_groups: dict[str, str], selected: list[str]) -> tuple[list[dict[str, object]], dict[str, bytes]]:
    sources: list[dict[str, object]] = []
    contents: dict[str, bytes] = {}
    total = 0
    for relative in selected:
        data = read_regular(relative)
        for pattern in SECRET_PATTERNS:
            if pattern.search(data):
                raise SystemExit(f"possible secret pattern in selected file: {relative}")
        total += len(data)
        if total > MAX_BUNDLE_BYTES:
            raise SystemExit(f"selected source bytes exceed {MAX_BUNDLE_BYTES}")
        contents[relative] = data
        sources.append({
            "path": relative,
            "group": path_groups[relative],
            "kind": "ddl" if relative.endswith(".sql") else
                    "synthetic_receipt" if "/performance/" in relative and relative.endswith(".json") else
                    "contract_manifest" if relative.startswith(".github/") else
                    "source_or_test",
            "bytes": len(data),
            "sha256": sha256(data),
        })
    return sources, contents


def build_bundle(snapshot_label: str, source_revision: str, sources: list[dict[str, object]], contents: dict[str, bytes]) -> bytes:
    chunks = [
        b"TZUDONG FINAL SOURCE ANTITHESIS BUNDLE v1\n",
        f"SNAPSHOT LABEL {snapshot_label}\n".encode(),
        f"SOURCE REVISION {source_revision}\n".encode(),
        b"This is a fresh post-repair source snapshot. It does not replace or mutate the preserved queued antithesis job.\n\n",
    ]
    for source in sources:
        relative = str(source["path"])
        header = (f"===== BEGIN {source['kind'].upper()} {relative} "
                  f"sha256={source['sha256']} bytes={source['bytes']} group={source['group']} =====\n")
        chunks.append(header.encode())
        data = contents[relative]
        chunks.append(data)
        if not data.endswith(b"\n"):
            chunks.append(b"\n")
        chunks.append(b"===== END FILE =====\n\n")
    bundle = b"".join(chunks)
    if len(bundle) > MAX_BUNDLE_BYTES:
        raise SystemExit(f"flattened bundle exceeds {MAX_BUNDLE_BYTES}")
    return bundle


def write_new(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-label", required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", args.snapshot_label):
        raise SystemExit("snapshot label must be 1-80 safe filename characters")
    if args.check_only == (args.output_dir is not None):
        raise SystemExit("use exactly one of --check-only or --output-dir")

    anchors = verify_immutable_anchors()
    path_groups, selected = expand_sources()
    sources, contents = scan_sources(path_groups, selected)
    source_revision = git_output("rev-parse", "HEAD")
    status = git_output("status", "--porcelain=v1", "--untracked-files=all", "--", *selected)
    bundle = build_bundle(args.snapshot_label, source_revision, sources, contents)
    preview = {
        "schema": "tzudong-final-source-antithesis/v1",
        "snapshotType": "fresh_final_source_snapshot",
        "snapshotLabel": args.snapshot_label,
        "sourceRevision": source_revision,
        "selectedFiles": len(sources),
        "selectedSourceBytes": sum(int(source["bytes"]) for source in sources),
        "bundleBytes": len(bundle),
        "bundleSha256": sha256(bundle),
        "selectedPathGitStatus": status.splitlines() if status else [],
        "anchors": anchors,
        "excluded": [
            "credentials, cookies, profiles and .env files",
            "personal or operating database rows",
            "OCR images and raw OCR/provider output",
            "browser traces and media files",
            "apps/web/supabase/.temp",
            "the old flattened source bundles as nested content",
        ],
        "boundaries": [
            "No network, upload, dispatch, coordinator, Git, provider, database or deployment action is performed.",
            "PG17 receipts are local synthetic evidence unless their own metadata says otherwise.",
            "The preserved queued Gemini job remains bound to the old antithesis bundle.",
            "This new bundle is a separate source snapshot for a later root-owned audit.",
        ],
        "sources": sources,
    }
    if args.check_only:
        print(json.dumps(preview, ensure_ascii=False, sort_keys=True, indent=2))
        return 0

    output_dir = args.output_dir
    assert output_dir is not None
    output_dir = output_dir if output_dir.is_absolute() else REPO / output_dir
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    bundle_path = output_dir / "final-source-antithesis-source_bundle.txt"
    manifest_path = output_dir / "final-source-antithesis-source-manifest.json"
    manifest_data = (json.dumps(preview, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    write_new(bundle_path, bundle)
    write_new(bundle_path.with_suffix(bundle_path.suffix + ".sha256"),
              f"{sha256(bundle)}  {bundle_path.name}\n".encode())
    write_new(manifest_path, manifest_data)
    write_new(manifest_path.with_suffix(manifest_path.suffix + ".sha256"),
              f"{sha256(manifest_data)}  {manifest_path.name}\n".encode())
    print(json.dumps({
        "outputDirectory": str(output_dir),
        "bundle": {"path": str(bundle_path), "bytes": len(bundle), "sha256": sha256(bundle)},
        "manifest": {"path": str(manifest_path), "bytes": len(manifest_data), "sha256": sha256(manifest_data)},
        "selectedFiles": len(sources),
    }, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
