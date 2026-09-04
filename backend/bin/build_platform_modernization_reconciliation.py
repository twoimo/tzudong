#!/usr/bin/env python3
"""Build the exhaustive parked platform-modernization reconciliation manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = (
    ROOT
    / ".kiro/specs/crawler-pipeline-operational-readiness/"
    "platform-modernization-reconciliation.v1.json"
)
DEFAULT_BASE = "3f4ca55742aa33869b776291e0d035a16024eef1"
DEFAULT_SOURCE = "880bf06d375dbc6ebe8dcf108419c3f455048a97"

ABSENT_DISPOSITIONS: dict[str, set[str]] = {
    "superseded_spec_source": {
        ".kiro/specs/platform-modernization/.config.kiro",
        ".kiro/specs/platform-modernization/design.md",
        ".kiro/specs/platform-modernization/requirements.md",
        ".kiro/specs/platform-modernization/tasks.md",
        ".kiro/specs/platform-modernization/tasks.meta.json",
    },
    "queued_phase_gate_recovery": {
        "backend/bin/phase_gate.py",
        "backend/bin/run_p1_gate.py",
        "backend/bin/run_p2_gate.py",
        "backend/bin/run_p3_gate.py",
        "backend/bin/run_p4_gate.py",
        "backend/bin/run_p5_gate.py",
        "backend/bin/run_p6_gate.py",
        "backend/bin/run_p7_gate.py",
        "backend/bin/tests/test_run_p1_gate_unittest.py",
        "backend/bin/tests/test_run_p2_gate_unittest.py",
        "backend/bin/tests/test_run_p3_gate_unittest.py",
        "backend/bin/tests/test_run_p4_gate_unittest.py",
        "backend/bin/tests/test_run_p5_gate_unittest.py",
        "backend/bin/tests/test_run_p6_gate_unittest.py",
        "backend/bin/tests/test_run_p7_gate_unittest.py",
        "backend/pipeline_control/test_phase_partition_pbt.py",
        "backend/pipeline_control/test_rollback_plan_pbt.py",
    },
    "queued_publication_recovery": {
        "apps/web/app/api/admin/publish-jobs/route.ts",
        "apps/web/lib/admin-publish-jobs.ts",
        "apps/web/tests-unit/publish-jobs-request-contract.test.ts",
        "backend/bin/tests/test_publication_isolation_pbt.py",
        "backend/deploy/publication-set.v1.json",
        "backend/deploy/publish-schedule.approved.json",
        "backend/pipeline_control/publish_worker.py",
        "backend/pipeline_control/test_publication_set_unittest.py",
        "backend/pipeline_control/test_publish_apply_unittest.py",
        "backend/pipeline_control/test_publish_batch_pbt.py",
        "backend/pipeline_control/test_publish_codes_pbt.py",
        "backend/pipeline_control/test_publish_hash_pbt.py",
        "backend/pipeline_control/test_publish_idempotency_pbt.py",
        "backend/pipeline_control/test_publish_payload_pbt.py",
        "backend/pipeline_control/test_publish_readback_pbt.py",
        "backend/pipeline_control/test_publish_schedule_unittest.py",
        "backend/pipeline_control/test_publish_worker_unittest.py",
        "backend/pipeline_control/tests/test_batch_upsert_publication_allowlist.py",
        "backend/supabase/migrations/20260901000100_local_analytics_schema.sql",
        "backend/supabase/migrations/20260901000200_pipeline_batch_upsert_publication_allowlist.sql",
    },
    "queued_supply_chain_recovery": {
        ".github/workflows/dependency-freshness.yml",
        "apps/web/scripts/verify-dependency-freshness.mjs",
        "apps/web/tests-unit/dependency-candidate-split.test.ts",
        "apps/web/tests-unit/dependency-freshness-workflow.test.ts",
        "apps/web/tests-unit/image-tag-fixity.test.ts",
        "apps/web/tests-unit/pin-contract.test.ts",
        "apps/web/tests-unit/sanitize-leak.test.ts",
        "apps/web/tests-unit/supabase-entrypoint-source.test.ts",
        "apps/web/tests-unit/verify-pin-contract-source.test.ts",
        "backend/bin/tests/test_tooling_gate_unittest.py",
        "backend/bin/tooling_gate.py",
        "backend/deploy/tooling-selection.v1.json",
        "backend/pipeline_control/test_tag_fixity_pbt.py",
        "backend/pipeline_control/test_tooling_selection_unittest.py",
    },
    "deferred_layout_migration": {
        "backend/deploy/pipeline-control/otel-collector.yaml",
    },
    "deferred_empty_scaffold": {
        "backend/deploy/argocd/.gitkeep",
        "backend/deploy/registry/.gitkeep",
    },
}

REVIEWED_CURRENT_LAYOUT_MODIFICATIONS = {
    "backend/DATA_CONTRACTS.md",
    "backend/pipeline_control/dsn_guard.py",
    "backend/pipeline_control/metrics.py",
    "backend/pipeline_control/tests/test_container_runtime.py",
    "backend/pipeline_control/tests/test_events.py",
    "backend/pipeline_control/tests/test_events_observability.py",
    "backend/pipeline_control/tests/test_metrics.py",
    "backend/utils/tests/test_tracked_document_integrity.py",
}

RATIONALES = {
    "candidate_transformed_present": (
        "The candidate differs from both Git endpoints because current-layout, "
        "security, or compatibility hardening has been applied."
    ),
    "current_layout_retained": (
        "The parked path move or deletion stays unapplied so backend/pipeline-control "
        "remains the sole owned compose tree."
    ),
    "current_layout_adaptation_reviewed": (
        "The parked byte change only adopts the rejected deploy/pipeline-control path; "
        "the current-path base bytes are intentionally retained."
    ),
    "deferred_empty_scaffold": (
        "The empty deployment scaffold remains absent until its parent deployment "
        "or registry decision is authorized."
    ),
    "deferred_layout_migration": (
        "The source assumes the rejected duplicate deploy/pipeline-control tree and "
        "remains deferred with no second control-plane owner."
    ),
    "queued_phase_gate_recovery": (
        "Rebuild this gate from reconciled current inputs instead of reviving the "
        "parked branch's historical completion claims."
    ),
    "queued_publication_recovery": (
        "Review as a fail-closed source-only publication capability; no hosted apply "
        "or migration execution is authorized."
    ),
    "queued_supply_chain_recovery": (
        "Review against current npm, Bun, Rust, and workflow pins before restoring "
        "the historical source."
    ),
    "source_exact_present": (
        "The candidate working-tree blob exactly matches the parked source blob and "
        "is therefore byte-for-byte recovered."
    ),
    "superseded_spec_source": (
        "Current decisions live in the operational-readiness spec; the exact "
        "historical source remains addressable by Git commit."
    ),
}


def _run(*args: str) -> str:
    return subprocess.run(
        args, cwd=ROOT, capture_output=True, check=True, text=True
    ).stdout.strip()


def _safe_path(value: str) -> Path:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe repository path: {value}")
    return ROOT.joinpath(*path.parts)


def _tree_blob(commit: str, path: str) -> str | None:
    result = subprocess.run(
        ["git", "rev-parse", f"{commit}:{path}"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def _working_blob(path: str) -> str | None:
    candidate = _safe_path(path)
    if not candidate.is_file():
        return None
    return _run("git", "hash-object", str(candidate))


def _source_delta(base: str, source: str) -> list[tuple[str, str, str]]:
    output = _run("git", "diff", "--name-status", "--find-renames", base, source)
    rows = []
    for line in output.splitlines():
        fields = line.split("\t")
        status = fields[0]
        base_path = fields[1]
        source_path = fields[2] if status.startswith("R") else fields[1]
        rows.append((status, base_path, source_path))
    return rows


def _absent_disposition(path: str) -> str:
    matches = [name for name, paths in ABSENT_DISPOSITIONS.items() if path in paths]
    if len(matches) != 1:
        raise ValueError(f"absent source must have one disposition: {path}: {matches}")
    return matches[0]


def _content_state(
    candidate: str | None, base: str | None, source: str | None
) -> str:
    if candidate is None:
        return "candidate_absent"
    if candidate == source and candidate == base:
        return "source_and_base_exact"
    if candidate == source:
        return "source_exact"
    if candidate == base:
        return "base_exact"
    return "candidate_transformed"


def build(base: str, source: str) -> dict[str, object]:
    entries = []
    dispositions: Counter[str] = Counter()
    states: Counter[str] = Counter()
    for status, base_path, source_path in _source_delta(base, source):
        inspection_path = base_path if status.startswith("R") or status == "D" else source_path
        base_blob = _tree_blob(base, base_path)
        source_blob = _tree_blob(source, source_path)
        candidate_blob = _working_blob(inspection_path)
        state = _content_state(candidate_blob, base_blob, source_blob)

        if status.startswith("R") or status == "D":
            disposition = "current_layout_retained"
        elif state in {"source_exact", "source_and_base_exact"}:
            disposition = "source_exact_present"
        elif state == "candidate_transformed":
            disposition = "candidate_transformed_present"
        elif state == "base_exact" and source_path in REVIEWED_CURRENT_LAYOUT_MODIFICATIONS:
            disposition = "current_layout_adaptation_reviewed"
        elif state == "candidate_absent":
            disposition = _absent_disposition(source_path)
        else:
            raise ValueError(
                f"unclassified source delta: {status} {source_path} ({state})"
            )

        entry = {
            "sourceStatus": status,
            "basePath": base_path,
            "sourcePath": source_path,
            "candidateDeclaredPath": source_path,
            "candidateInspectionPath": inspection_path,
            "candidatePresentAtInspectionPath": candidate_blob is not None,
            "baseGitBlobSha1": base_blob,
            "sourceGitBlobSha1": source_blob,
            "candidateGitBlobSha1": candidate_blob,
            "contentState": state,
            "disposition": disposition,
            "rationale": RATIONALES[disposition],
        }
        entries.append(entry)
        dispositions[disposition] += 1
        states[state] += 1

    return {
        "schemaVersion": 3,
        "kind": "platform_modernization_reconciliation",
        "baseCommit": base,
        "sourceCommit": source,
        # HEAD changes when this manifest itself is committed. Bind candidate
        # bytes instead; the executing CI receipt records the exact commit.
        "candidateContentSha256": hashlib.sha256(
            json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "candidateWorkingTreeStateIncluded": True,
        "sourceDeltaEntryCount": len(entries),
        "dispositionCounts": dict(sorted(dispositions.items())),
        "contentStateCounts": dict(sorted(states.items())),
        "note": (
            "This is source/candidate inventory, not deployment, approval, "
            "hosted-state, migration-apply, legal, or production evidence."
        ),
        "entries": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    document = build(args.base, args.source)
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != rendered:
            print("platform_modernization_reconciliation_stale")
            return 1
        print("platform_modernization_reconciliation_current")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(f"wrote {len(document['entries'])} entries to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
