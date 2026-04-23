#!/usr/bin/env python3
"""Small stdlib helpers for ``backend/run_daily.sh``.

The helpers are intentionally Python 3.8-compatible because some backend worker
lanes still run with Python 3.8. Keep this file dependency-free: it is called by
cron/GitHub Actions before the rest of the Python environment is guaranteed.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Sequence


def count_pending_jsonl(source_dir: Path, target_dir: Path) -> int:
    """Count ``*.jsonl`` basenames present in source but missing in target."""
    if not source_dir.is_dir():
        return 0

    source_names = {path.name for path in source_dir.glob("*.jsonl") if path.is_file()}
    if not source_names:
        return 0

    target_names = set()
    if target_dir.is_dir():
        target_names = {path.name for path in target_dir.glob("*.jsonl") if path.is_file()}

    return len(source_names - target_names)


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _optional_path(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def build_summary_manifest(args: argparse.Namespace) -> dict:
    """Build the stable run_daily summary manifest payload."""
    generated_at = args.generated_at or datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    manifest = {
        "generatedAt": generated_at,
        "date": args.date,
        "finalStatus": args.final_status,
        "finalExitCode": args.final_exit_code,
        "failedRequiredSteps": list(args.failed_required_step or []),
        "optionalSkips": list(args.optional_skip or []),
        "downstreamSkips": list(args.downstream_skip or []),
        "latestLogPath": _optional_path(args.latest_log_path),
        "summaryPath": _optional_path(args.summary_path),
        "noWorkShortCircuit": _truthy(args.no_work_short_circuit),
        "policyMode": args.policy_mode,
    }
    return manifest


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(str(tmp_path), str(path))


def _add_manifest_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--final-status", required=True, choices=("OK", "WARN", "ERROR"))
    parser.add_argument("--final-exit-code", required=True, type=int)
    parser.add_argument("--latest-log-path", default="")
    parser.add_argument("--summary-path", default="")
    parser.add_argument("--no-work-short-circuit", default="false")
    parser.add_argument("--policy-mode", default="end_to_end")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--failed-required-step", action="append", default=[])
    parser.add_argument("--optional-skip", action="append", default=[])
    parser.add_argument("--downstream-skip", action="append", default=[])


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="run_daily.sh helper commands")
    subparsers = parser.add_subparsers(dest="command", required=True)

    count_parser = subparsers.add_parser("count-pending-jsonl")
    count_parser.add_argument("--source-dir", required=True)
    count_parser.add_argument("--target-dir", required=True)

    manifest_parser = subparsers.add_parser("write-summary-manifest")
    _add_manifest_args(manifest_parser)

    args = parser.parse_args(argv)

    if args.command == "count-pending-jsonl":
        print(count_pending_jsonl(Path(args.source_dir), Path(args.target_dir)))
        return 0

    if args.command == "write-summary-manifest":
        payload = build_summary_manifest(args)
        write_json(Path(args.output), payload)
        return 0

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
