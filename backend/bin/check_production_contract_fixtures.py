#!/usr/bin/env python3
"""Validate small production-shaped backend fixtures for schema drift.

This checker is intentionally dependency-free and bounded. It samples JSONL
artifacts that already exist in the repo or in Actions artifacts and runs the
same validators that protect the documented backend contracts.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple
import typing

if not hasattr(typing, "Annotated"):
    class _AnnotatedCompat:
        def __class_getitem__(cls, item):
            if isinstance(item, tuple) and item:
                return item[0]
            return item

    typing.Annotated = _AnnotatedCompat  # type: ignore[attr-defined]

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.pipeline.validators import validate_transform_output  # noqa: E402


def _utc_now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _iter_jsonl(path: Path, limit: int) -> Iterable[Tuple[int, dict]]:
    if not path.is_file():
        return
    count = 0
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            yield line_number, {"__parse_error__": str(exc)}
            count += 1
        else:
            if isinstance(value, dict):
                yield line_number, value
                count += 1
            else:
                yield line_number, {"__parse_error__": f"expected object, got {type(value).__name__}"}
                count += 1
        if limit > 0 and count >= limit:
            break


def _video_id_from_link(value: object) -> str:
    if not isinstance(value, str):
        return "production-fixture"
    match = re.search(r"(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{6,})", value)
    return match.group(1) if match else "production-fixture"


def validate_transforms_jsonl(path: Path, max_records: int) -> dict:
    parse_errors: List[dict] = []
    records: List[dict] = []
    for line_number, record in _iter_jsonl(path, max_records):
        if "__parse_error__" in record:
            parse_errors.append({"line": line_number, "message": record["__parse_error__"]})
            continue
        records.append(record)

    validator_errors: List[dict] = []
    if records:
        video_id = _video_id_from_link(records[0].get("youtube_link"))
        validator_errors = validate_transform_output(video_id, records)

    error_count = len(parse_errors) + sum(1 for item in validator_errors if item.get("severity") == "error")
    warning_count = sum(1 for item in validator_errors if item.get("severity") == "warning")
    return {
        "path": str(path),
        "exists": path.is_file(),
        "checkedCount": len(records),
        "parseErrorCount": len(parse_errors),
        "errorCount": error_count,
        "warningCount": warning_count,
        "parseErrors": parse_errors[:10],
        "validationErrors": validator_errors[:20],
        "status": "error" if error_count else "warn" if warning_count else "ok",
    }


def build_report(args: argparse.Namespace) -> dict:
    transforms_path = Path(args.transforms_jsonl)
    transform_report = validate_transforms_jsonl(transforms_path, args.max_records)
    overall_status = transform_report["status"]
    return {
        "schemaVersion": 1,
        "checkedAt": args.checked_at or _utc_now_iso(),
        "status": overall_status,
        "limits": {"maxRecords": args.max_records},
        "checks": {"transformJsonl": transform_report},
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Check production-shaped backend contract fixtures for schema drift")
    parser.add_argument(
        "--transforms-jsonl",
        default=str(REPO_ROOT / "backend" / "restaurant-evaluation" / "data" / "tzuyang" / "evaluation" / "transforms.jsonl"),
    )
    parser.add_argument("--max-records", type=int, default=200)
    parser.add_argument("--output", default="")
    parser.add_argument("--checked-at", default="")
    parser.add_argument("--fail-on-error", action="store_true")
    args = parser.parse_args(argv)

    report = build_report(args)
    if args.output:
        write_json(Path(args.output), report)
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))

    if args.fail_on_error and report["status"] == "error":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
