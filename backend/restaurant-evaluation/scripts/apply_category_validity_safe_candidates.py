#!/usr/bin/env python3
"""Apply operator-approved category_validity_TF projections to transforms.jsonl.

The script is intentionally narrow:
- input candidates must come from the safe-apply report package,
- target rows are matched by source_line plus trace_id/youtube/origin guards,
- only evaluation_results.category_validity_TF is replaced,
- default mode is dry-run; --apply is required for file mutation,
- no Supabase or external writes are performed.
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_TRANSFORMS_PATH = Path("restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl")
DEFAULT_CANDIDATES_PATH = Path(
    "../.omx/reports/refined-data/category-validity-safe-apply-20260501T141011Z/"
    "category-validity-safe-apply-candidates-report-only.jsonl"
)
DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")
SAFE_STATUS = "ready_for_operator_approved_apply"
SAFE_QUEUE = "safe_category_validity_projection"
SAFE_DIFF_STATUS = "false_to_true"


class SafeApplyError(RuntimeError):
    """Raised when the safe apply preconditions fail."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(path)
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            row["__jsonl_line_number"] = line_number
            rows.append(row)
    return rows


def read_jsonl_lines(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(path)
    return path.read_text(encoding="utf-8").splitlines()


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def dump_row(row: dict[str, Any]) -> str:
    return json.dumps(row, ensure_ascii=False)


def projected_value(candidate: dict[str, Any]) -> dict[str, Any]:
    projection = candidate.get("projected_category_validity_TF")
    if not isinstance(projection, dict):
        raise SafeApplyError(f"candidate {candidate.get('safe_apply_id')} has no projection object")
    if projection.get("eval_value") is not True:
        raise SafeApplyError(f"candidate {candidate.get('safe_apply_id')} projection is not true")
    return dict(projection)


def validate_candidate(candidate: dict[str, Any]) -> None:
    cid = candidate.get("safe_apply_id")
    checks = {
        "safe_apply_status": candidate.get("safe_apply_status") == SAFE_STATUS,
        "review_queue": candidate.get("review_queue") == SAFE_QUEUE,
        "diff_status": candidate.get("diff_status") == SAFE_DIFF_STATUS,
        "before_category_validity": candidate.get("before_category_validity") is False,
        "after_category_validity": candidate.get("after_category_validity") is True,
        "blocked_reasons": not candidate.get("blocked_reasons"),
        "source_line": isinstance(candidate.get("source_line"), int) and candidate.get("source_line") > 0,
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise SafeApplyError(f"candidate {cid} failed preconditions: {', '.join(failed)}")
    projected_value(candidate)


def validate_target_match(candidate: dict[str, Any], target_row: dict[str, Any]) -> None:
    cid = candidate.get("safe_apply_id")
    for field in ("trace_id", "youtube_link", "origin_name"):
        if candidate.get(field) != target_row.get(field):
            raise SafeApplyError(
                f"candidate {cid} target guard mismatch on {field}: "
                f"candidate={candidate.get(field)!r} target={target_row.get(field)!r}"
            )
    evals = target_row.get("evaluation_results")
    if not isinstance(evals, dict):
        raise SafeApplyError(f"candidate {cid} target row has no evaluation_results object")
    current = evals.get("category_validity_TF")
    if not isinstance(current, dict):
        raise SafeApplyError(f"candidate {cid} target row has no category_validity_TF object")
    if current.get("eval_value") is not False:
        raise SafeApplyError(
            f"candidate {cid} target category_validity_TF is not currently false: {current.get('eval_value')!r}"
        )


def build_changes(transforms_lines: list[str], candidates: list[dict[str, Any]]) -> tuple[list[str], list[dict[str, Any]], dict[str, Any]]:
    seen_source_lines: set[int] = set()
    output_lines = list(transforms_lines)
    changes: list[dict[str, Any]] = []

    for candidate in candidates:
        validate_candidate(candidate)
        source_line = candidate["source_line"]
        if source_line in seen_source_lines:
            raise SafeApplyError(f"duplicate source_line in candidates: {source_line}")
        seen_source_lines.add(source_line)
        if source_line > len(transforms_lines):
            raise SafeApplyError(f"candidate {candidate.get('safe_apply_id')} source_line out of range: {source_line}")

        target_row = json.loads(transforms_lines[source_line - 1])
        validate_target_match(candidate, target_row)
        before_value = dict(target_row["evaluation_results"]["category_validity_TF"])
        after_value = projected_value(candidate)
        target_row["evaluation_results"]["category_validity_TF"] = after_value
        output_lines[source_line - 1] = dump_row(target_row)
        changes.append(
            {
                "safe_apply_id": candidate.get("safe_apply_id"),
                "category_diff_id": candidate.get("category_diff_id"),
                "source_line": source_line,
                "trace_id": candidate.get("trace_id"),
                "youtube_link": candidate.get("youtube_link"),
                "origin_name": candidate.get("origin_name"),
                "category": candidate.get("category"),
                "before_category_validity_TF": before_value,
                "after_category_validity_TF": after_value,
                "changed_field": "evaluation_results.category_validity_TF",
            }
        )

    summary = {
        "candidate_rows": len(candidates),
        "planned_or_applied_changes": len(changes),
        "target_total_rows": len(transforms_lines),
        "changed_field_counter": dict(Counter(change["changed_field"] for change in changes)),
    }
    return output_lines, changes, summary


def write_report(output_dir: Path, *, mode: str, target_path: Path, candidates_path: Path, changes: list[dict[str, Any]], summary: dict[str, Any], backup_path: Path | None) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    changes_path = output_dir / f"category-validity-safe-apply-{mode}-changes.jsonl"
    summary_path = output_dir / f"category-validity-safe-apply-{mode}-summary.json"
    write_jsonl(changes_path, changes)
    report = {
        **summary,
        "generated_at": utc_now(),
        "mode": mode,
        "safety_scope": "category_validity_TF_only_no_supabase_write",
        "target_transforms_path": str(target_path),
        "candidates_path": str(candidates_path),
        "changes_jsonl": str(changes_path),
        "summary_json": str(summary_path),
        "backup_path": str(backup_path) if backup_path else None,
    }
    summary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def apply_safe_candidates(target_path: Path, candidates_path: Path, output_dir: Path, *, apply: bool) -> dict[str, Any]:
    transforms_lines = read_jsonl_lines(target_path)
    candidates = load_jsonl(candidates_path)
    for candidate in candidates:
        candidate.pop("__jsonl_line_number", None)
    output_lines, changes, summary = build_changes(transforms_lines, candidates)

    mode = "apply" if apply else "dry-run"
    backup_path: Path | None = None
    if apply:
        backup_path = output_dir / f"{target_path.name}.before-category-validity-safe-apply.bak"
        output_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target_path, backup_path)
        target_path.write_text("\n".join(output_lines) + "\n", encoding="utf-8")

    report = write_report(
        output_dir,
        mode=mode,
        target_path=target_path,
        candidates_path=candidates_path,
        changes=changes,
        summary=summary,
        backup_path=backup_path,
    )
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS_PATH)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES_PATH)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--apply", action="store_true", help="mutate the target transforms file after creating a backup")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir or DEFAULT_REPORT_ROOT / f"category-validity-safe-apply-execution-{timestamp_slug()}"
    report = apply_safe_candidates(args.transforms, args.candidates, output_dir, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
