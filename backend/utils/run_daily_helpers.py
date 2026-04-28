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
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


FRAME_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".webp"}
UPLOAD_SCHEMA_VERSION = 1


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
    return _parse_bool(value)


def _optional_path(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _utc_now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _safe_int(value: Optional[str], default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _frame_candidate_paths(frames_dir: Path, recent_minutes: int, now_epoch: Optional[float] = None) -> Iterable[Tuple[Path, str]]:
    if not frames_dir.is_dir():
        return []

    now = time.time() if now_epoch is None else now_epoch
    cutoff = now - (recent_minutes * 60)
    candidates: List[Tuple[Path, str]] = []
    for path in frames_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in FRAME_UPLOAD_EXTENSIONS:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_mtime >= cutoff:
            candidates.append((path, "new_frame"))
    return candidates


def _dedupe_key(relative_path: str, size: int, mtime_epoch: int) -> str:
    return f"{relative_path}:{size}:{mtime_epoch}"


def _manifest_item(path: Path, frames_dir: Path, reason: str, required: bool = True) -> dict:
    stat = path.stat()
    relative_path = path.relative_to(frames_dir).as_posix()
    mtime_epoch = int(stat.st_mtime)
    size = int(stat.st_size)
    return {
        "relativePath": relative_path,
        "size": size,
        "mtimeEpoch": mtime_epoch,
        "dedupeKey": _dedupe_key(relative_path, size, mtime_epoch),
        "required": bool(required),
        "reason": reason,
    }


def _load_residual_items(path: Optional[Path], frames_dir: Path, now_epoch: Optional[float] = None, retention_days: int = 7) -> List[dict]:
    if path is None or not path.is_file():
        return []

    now = time.time() if now_epoch is None else now_epoch
    retention_seconds = retention_days * 24 * 60 * 60
    items: List[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = entry.get("item") if isinstance(entry, dict) else None
        if not isinstance(item, dict):
            continue
        relative_path = item.get("relativePath")
        if not isinstance(relative_path, str) or not relative_path:
            continue
        candidate_path = frames_dir / relative_path
        if not candidate_path.is_file():
            continue
        first_seen_epoch = _safe_int(str(entry.get("firstSeenEpoch", "")), int(now))
        if now - first_seen_epoch > retention_seconds:
            continue
        fresh_item = _manifest_item(candidate_path, frames_dir, "residual_retry", bool(item.get("required", True)))
        items.append(fresh_item)
    return items


def build_gdrive_upload_expected(args: argparse.Namespace) -> dict:
    generated_at = args.generated_at or _utc_now_iso()
    frames_dir = Path(args.frames_dir)
    residual_queue_path = Path(args.residual_queue) if args.residual_queue else None
    items_by_key: Dict[str, dict] = {}

    for path, reason in _frame_candidate_paths(frames_dir, args.recent_minutes):
        item = _manifest_item(path, frames_dir, reason)
        items_by_key[item["dedupeKey"]] = item

    for item in _load_residual_items(residual_queue_path, frames_dir, retention_days=args.retention_days):
        items_by_key[item["dedupeKey"]] = item

    items = sorted(items_by_key.values(), key=lambda item: item["relativePath"])
    return {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "runId": args.run_id,
        "sourceRoot": args.source_root or str(frames_dir),
        "remoteRoot": args.remote_root,
        "recentMinutes": args.recent_minutes,
        "residualQueuePath": str(residual_queue_path) if residual_queue_path else None,
        "expectedCount": len(items),
        "items": items,
    }


def _write_files_from(path: Path, items: Sequence[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [str(item["relativePath"]) for item in items]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _load_expected_manifest(path: Path) -> dict:
    if not path.is_file():
        return {
            "schemaVersion": UPLOAD_SCHEMA_VERSION,
            "expectedCount": 0,
            "items": [],
        }
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("expected upload manifest must be a JSON object")
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("expected upload manifest items must be a list")
    return payload


def _load_queue_entries(path: Path) -> List[dict]:
    if not path.is_file():
        return []
    entries: List[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            entries.append(entry)
    return entries


def _write_queue(path: Path, entries: Sequence[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not entries:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "".join(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n" for entry in entries),
        encoding="utf-8",
    )


def _prune_queue_entries(entries: Sequence[dict], frames_dir: Path, retention_days: int) -> List[dict]:
    now = int(time.time())
    retention_seconds = retention_days * 24 * 60 * 60
    retained: List[dict] = []
    for entry in entries:
        item = entry.get("item")
        if not isinstance(item, dict):
            continue
        relative_path = item.get("relativePath")
        if not isinstance(relative_path, str) or not relative_path:
            continue
        if not (frames_dir / relative_path).is_file():
            continue
        first_seen_epoch = _safe_int(str(entry.get("firstSeenEpoch", "")), now)
        if now - first_seen_epoch > retention_seconds:
            continue
        retained.append(entry)
    return retained


def build_gdrive_upload_status(args: argparse.Namespace) -> dict:
    generated_at = args.completed_at or _utc_now_iso()
    expected = _load_expected_manifest(Path(args.expected_manifest))
    expected_items = list(expected.get("items", []))
    expected_count = len(expected_items)
    exit_code = args.exit_code
    timed_out = _parse_bool(args.timeout)
    skipped = _parse_bool(args.skipped)

    if skipped:
        status = "skipped"
        uploaded_count = 0
        uploaded_confidence = "exact"
        skipped_existing_count = 0
        residual_items: List[dict] = []
    elif exit_code == 0 and not timed_out:
        status = "complete"
        # rclone with --ignore-existing does not expose a stable per-file copied
        # vs already-existing count across versions. Do not fabricate newly
        # uploaded counts; treat a clean exit as delivered/existing coverage and
        # mark the uploaded count confidence honestly.
        uploaded_count = 0
        uploaded_confidence = "unknown"
        skipped_existing_count = expected_count
        residual_items = []
    else:
        status = "partial" if timed_out else "failed"
        uploaded_count = 0
        uploaded_confidence = "unknown"
        skipped_existing_count = 0
        residual_items = expected_items

    residual_count = len(residual_items)
    residual_queue_path = Path(args.residual_queue) if args.residual_queue else None
    max_residual_attempts = 0
    if residual_queue_path is not None:
        previous_entries = _load_queue_entries(residual_queue_path)
        source_root = args.source_root or expected.get("sourceRoot") or ""
        previous_entries = _prune_queue_entries(previous_entries, Path(source_root), args.retention_days)
        current_keys = {str(item.get("dedupeKey", "")) for item in expected_items}
        retained = [entry for entry in previous_entries if str((entry.get("item") or {}).get("dedupeKey", "")) not in current_keys]
        now_epoch = int(time.time())
        if residual_items:
            previous_by_key = {
                str((entry.get("item") or {}).get("dedupeKey", "")): entry
                for entry in previous_entries
                if isinstance(entry.get("item"), dict)
            }
            for item in residual_items:
                key = str(item.get("dedupeKey", ""))
                previous = previous_by_key.get(key, {})
                attempts = _safe_int(str(previous.get("attempts", "0")), 0) + 1
                max_residual_attempts = max(max_residual_attempts, attempts)
                retained.append(
                    {
                        "schemaVersion": UPLOAD_SCHEMA_VERSION,
                        "firstSeenAt": previous.get("firstSeenAt") or generated_at,
                        "firstSeenEpoch": previous.get("firstSeenEpoch") or now_epoch,
                        "lastAttemptAt": generated_at,
                        "attempts": attempts,
                        "lastExitCode": exit_code,
                        "item": item,
                    }
                )
        _write_queue(residual_queue_path, retained)

    policy = args.policy
    if residual_count and max_residual_attempts >= args.backfill_threshold_attempts:
        policy = "backfill_required"
    payload = {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "runId": args.run_id or expected.get("runId", ""),
        "policy": policy,
        "sourceRoot": args.source_root or expected.get("sourceRoot"),
        "remoteRoot": args.remote_root or expected.get("remoteRoot"),
        "startedAt": args.started_at or None,
        "completedAt": generated_at,
        "expectedCount": expected_count,
        "attemptedCount": 0 if skipped else expected_count,
        "uploadedCount": uploaded_count,
        "uploadedCountConfidence": uploaded_confidence,
        "skippedExistingCount": skipped_existing_count,
        "residualCount": residual_count,
        "maxResidualAttempts": max_residual_attempts,
        "backfillThresholdAttempts": args.backfill_threshold_attempts,
        "timeout": timed_out,
        "exitCode": exit_code,
        "status": status,
        "dedupeKey": "relativePath:size:mtime",
        "residualQueuePath": str(residual_queue_path) if residual_queue_path else None,
        "notes": list(args.note or []),
    }
    if status == "complete" and expected_count:
        payload["notes"].append("rclone success confirms delivered-or-existing set; per-file uploaded vs existing split is not parsed")

    if payload["expectedCount"] != payload["uploadedCount"] + payload["skippedExistingCount"] + payload["residualCount"]:
        payload["status"] = "failed"
        payload["notes"].append("accounting invariant failed")

    return payload


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


def _add_gdrive_expected_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--frames-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--files-from-output", required=True)
    parser.add_argument("--residual-queue", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-root", default="")
    parser.add_argument("--recent-minutes", type=int, default=120)
    parser.add_argument("--retention-days", type=int, default=7)
    parser.add_argument("--generated-at", default="")


def _add_gdrive_status_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--summary-manifest", default="")
    parser.add_argument("--residual-queue", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--policy", choices=("required", "warn", "backfill_required"), default="warn")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-root", default="")
    parser.add_argument("--started-at", default="")
    parser.add_argument("--completed-at", default="")
    parser.add_argument("--exit-code", required=True, type=int)
    parser.add_argument("--timeout", default="false")
    parser.add_argument("--skipped", default="false")
    parser.add_argument("--retention-days", type=int, default=7)
    parser.add_argument("--backfill-threshold-attempts", type=int, default=3)
    parser.add_argument("--note", action="append", default=[])


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="run_daily.sh helper commands")
    subparsers = parser.add_subparsers(dest="command", required=True)

    count_parser = subparsers.add_parser("count-pending-jsonl")
    count_parser.add_argument("--source-dir", required=True)
    count_parser.add_argument("--target-dir", required=True)

    manifest_parser = subparsers.add_parser("write-summary-manifest")
    _add_manifest_args(manifest_parser)

    gdrive_expected_parser = subparsers.add_parser("write-gdrive-upload-expected")
    _add_gdrive_expected_args(gdrive_expected_parser)

    gdrive_status_parser = subparsers.add_parser("write-gdrive-upload-status")
    _add_gdrive_status_args(gdrive_status_parser)

    args = parser.parse_args(argv)

    if args.command == "count-pending-jsonl":
        print(count_pending_jsonl(Path(args.source_dir), Path(args.target_dir)))
        return 0

    if args.command == "write-summary-manifest":
        payload = build_summary_manifest(args)
        write_json(Path(args.output), payload)
        return 0

    if args.command == "write-gdrive-upload-expected":
        payload = build_gdrive_upload_expected(args)
        write_json(Path(args.output), payload)
        _write_files_from(Path(args.files_from_output), payload["items"])
        return 0

    if args.command == "write-gdrive-upload-status":
        payload = build_gdrive_upload_status(args)
        write_json(Path(args.output), payload)
        summary_manifest = _optional_path(args.summary_manifest)
        if summary_manifest:
            summary_path = Path(summary_manifest)
            summary_payload = {}
            if summary_path.is_file():
                summary_payload = json.loads(summary_path.read_text(encoding="utf-8"))
                if not isinstance(summary_payload, dict):
                    raise ValueError("summary manifest must be a JSON object")
            summary_payload["gdriveUpload"] = payload
            write_json(summary_path, summary_payload)
        return 0

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
