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
import tarfile
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple


FRAME_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".webp"}
UPLOAD_SCHEMA_VERSION = 2
STRONG_COMPLETION_PROOFS = {"remote_size_check", "remote_manifest_check"}
QUEUE_STATES = {"pending_local", "staged", "missing_local", "remote_verified", "failed_permanent"}
TOP_LEVEL_STATUSES = {"skipped", "complete", "partial", "backfill_required", "backfill_complete", "failed"}


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


def _remote_join(root: Optional[str], relative_path: str) -> Optional[str]:
    if not root:
        return None
    return f"{root.rstrip('/')}/{relative_path.lstrip('/')}"


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


def _manifest_item(path: Path, frames_dir: Path, reason: str, required: bool = True, remote_root: Optional[str] = None) -> dict:
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
        "sourceState": "local",
        "state": "pending_local",
        "stagingShard": None,
        "remotePath": _remote_join(remote_root, relative_path),
    }


def _copy_item(item: dict) -> dict:
    copied = dict(item)
    relative_path = str(copied.get("relativePath", ""))
    size = _safe_int(str(copied.get("size", "0")), 0)
    mtime_epoch = _safe_int(str(copied.get("mtimeEpoch", "0")), 0)
    copied.setdefault("dedupeKey", _dedupe_key(relative_path, size, mtime_epoch))
    copied.setdefault("required", True)
    copied.setdefault("reason", "residual_retry")
    copied.setdefault("sourceState", "missing_local")
    copied.setdefault("state", "missing_local")
    copied.setdefault("stagingShard", None)
    copied.setdefault("remotePath", None)
    return copied


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


def _load_residual_items(path: Optional[Path], frames_dir: Path, now_epoch: Optional[float] = None, retention_days: int = 7, remote_root: Optional[str] = None) -> List[dict]:
    if path is None or not path.is_file():
        return []

    now = time.time() if now_epoch is None else now_epoch
    retention_seconds = retention_days * 24 * 60 * 60
    items: List[dict] = []
    for entry in _load_queue_entries(path):
        item = entry.get("item") if isinstance(entry, dict) else None
        if not isinstance(item, dict):
            continue
        relative_path = item.get("relativePath")
        if not isinstance(relative_path, str) or not relative_path:
            continue
        first_seen_epoch = _safe_int(str(entry.get("firstSeenEpoch", "")), int(now))
        state = str(entry.get("state") or item.get("state") or "")
        staging_shard = entry.get("stagingShard") or item.get("stagingShard")
        # Missing local residuals must never disappear silently, even when their
        # first-seen timestamp exceeds the normal retry retention window. Only
        # still-local retry entries are eligible to age out.
        durable_state = state in {"staged", "missing_local", "failed_permanent"} or bool(staging_shard)
        candidate_path = frames_dir / relative_path
        if not durable_state and candidate_path.is_file() and now - first_seen_epoch > retention_seconds:
            continue
        if candidate_path.is_file():
            fresh_item = _manifest_item(candidate_path, frames_dir, "residual_retry", bool(item.get("required", True)), remote_root)
            fresh_item["attempts"] = _safe_int(str(entry.get("attempts", "0")), 0)
            items.append(fresh_item)
            continue
        missing_item = _copy_item(item)
        missing_item["reason"] = "residual_retry"
        missing_item["sourceState"] = "missing_local"
        if staging_shard:
            missing_item["state"] = "staged"
            missing_item["stagingShard"] = staging_shard
        else:
            missing_item["state"] = "missing_local"
        if not missing_item.get("remotePath"):
            missing_item["remotePath"] = _remote_join(remote_root, relative_path)
        missing_item["attempts"] = _safe_int(str(entry.get("attempts", "0")), 0)
        items.append(missing_item)
    return items


def _is_uploadable_item(item: dict) -> bool:
    return str(item.get("sourceState")) == "local" or str(item.get("state")) == "pending_local"


def _is_strong_proof(value: str) -> bool:
    return value in STRONG_COMPLETION_PROOFS


def _load_path_set(path: Optional[str]) -> Set[str]:
    resolved = _optional_path(path)
    if not resolved:
        return set()
    source = Path(resolved)
    if not source.is_file():
        return set()
    return {line.strip() for line in source.read_text(encoding="utf-8").splitlines() if line.strip()}


def _load_staging_manifest(path: Optional[str]) -> Dict[str, dict]:
    resolved = _optional_path(path)
    if not resolved:
        return {}
    manifest_path = Path(resolved)
    if not manifest_path.is_file():
        return {}
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return {}
    staged: Dict[str, dict] = {}
    for shard in payload.get("shards", []):
        if not isinstance(shard, dict):
            continue
        remote_shard = shard.get("remoteShard") or shard.get("archivePath")
        shard_id = shard.get("shardId")
        for item in shard.get("items", []):
            if not isinstance(item, dict):
                continue
            relative_path = item.get("relativePath")
            if isinstance(relative_path, str) and relative_path:
                staged[relative_path] = {"stagingShard": remote_shard, "shardId": shard_id}
    return staged


def build_gdrive_upload_expected(args: argparse.Namespace) -> dict:
    generated_at = args.generated_at or _utc_now_iso()
    frames_dir = Path(args.frames_dir)
    residual_queue_path = Path(args.residual_queue) if args.residual_queue else None
    items_by_key: Dict[str, dict] = {}

    for path, reason in _frame_candidate_paths(frames_dir, args.recent_minutes):
        item = _manifest_item(path, frames_dir, reason, remote_root=args.remote_root)
        items_by_key[item["dedupeKey"]] = item

    for item in _load_residual_items(residual_queue_path, frames_dir, retention_days=args.retention_days, remote_root=args.remote_root):
        items_by_key[item["dedupeKey"]] = item

    all_items = sorted(items_by_key.values(), key=lambda item: item["relativePath"])
    max_items = max(0, int(args.max_items or 0))
    if max_items:
        items = all_items[:max_items]
        overflow_items = all_items[max_items:]
        _persist_overflow_queue_items(residual_queue_path, overflow_items, generated_at, frames_dir, args.retention_days)
    else:
        items = all_items
        overflow_items = []
    uploadable_count = sum(1 for item in items if _is_uploadable_item(item))
    missing_count = sum(1 for item in items if str(item.get("state")) == "missing_local")
    staged_count = sum(1 for item in items if str(item.get("state")) == "staged")
    return {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "runId": args.run_id,
        "sourceRoot": args.source_root or str(frames_dir),
        "remoteRoot": args.remote_root,
        "recentMinutes": args.recent_minutes,
        "maxItems": max_items,
        "overflowCount": len(overflow_items),
        "residualQueuePath": str(residual_queue_path) if residual_queue_path else None,
        "dedupeKey": "relativePath:size:mtime",
        "expectedCount": len(items),
        "uploadableCount": uploadable_count,
        "missingLocalCount": missing_count,
        "stagedShardItemCount": staged_count,
        "items": items,
    }


def _write_files_from(path: Path, items: Sequence[dict], only_uploadable: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    source_items = [item for item in items if (not only_uploadable or _is_uploadable_item(item))]
    lines = [str(item["relativePath"]) for item in source_items]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _load_expected_manifest(path: Path) -> dict:
    if not path.is_file():
        return {
            "schemaVersion": UPLOAD_SCHEMA_VERSION,
            "expectedCount": 0,
            "uploadableCount": 0,
            "items": [],
        }
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("expected upload manifest must be a JSON object")
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("expected upload manifest items must be a list")
    payload.setdefault("schemaVersion", 1)
    payload.setdefault("expectedCount", len(items))
    payload.setdefault("uploadableCount", sum(1 for item in items if isinstance(item, dict) and _is_uploadable_item(item)))
    return payload


def _write_queue(path: Path, entries: Sequence[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not entries:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "".join(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n" for entry in entries),
        encoding="utf-8",
    )


def _queue_entry(
    item: dict,
    generated_at: str,
    now_epoch: int,
    *,
    previous: Optional[dict] = None,
    attempts_increment: int = 0,
    last_exit_code: int = 0,
) -> dict:
    previous = previous or {}
    attempts = _safe_int(str(previous.get("attempts", "0")), 0) + attempts_increment
    return {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "firstSeenAt": previous.get("firstSeenAt") or generated_at,
        "firstSeenEpoch": previous.get("firstSeenEpoch") or now_epoch,
        "lastAttemptAt": generated_at,
        "attempts": attempts,
        "lastExitCode": last_exit_code,
        "item": item,
    }


def _persist_overflow_queue_items(
    residual_queue_path: Optional[Path],
    items: Sequence[dict],
    generated_at: str,
    frames_dir: Path,
    retention_days: int,
) -> None:
    """Keep unattempted upload overflow durable for the next bounded run."""

    if residual_queue_path is None or not items:
        return

    previous_entries = _prune_queue_entries(_load_queue_entries(residual_queue_path), frames_dir, retention_days)
    previous_by_key = {
        str((entry.get("item") or {}).get("dedupeKey", "")): entry
        for entry in previous_entries
        if isinstance(entry.get("item"), dict)
    }
    overflow_keys = {str(item.get("dedupeKey", "")) for item in items}
    retained = [
        entry
        for entry in previous_entries
        if str((entry.get("item") or {}).get("dedupeKey", "")) not in overflow_keys
    ]
    now_epoch = int(time.time())
    for item in items:
        key = str(item.get("dedupeKey", ""))
        retained.append(
            _queue_entry(
                item,
                generated_at,
                now_epoch,
                previous=previous_by_key.get(key),
                attempts_increment=0,
                last_exit_code=0,
            )
        )
    _write_queue(residual_queue_path, retained)


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
        state = str(entry.get("state") or item.get("state") or "")
        staging_shard = entry.get("stagingShard") or item.get("stagingShard")
        if state in {"staged", "missing_local", "failed_permanent"} or staging_shard:
            retained.append(entry)
            continue
        if not (frames_dir / relative_path).is_file():
            retained_entry = dict(entry)
            retained_entry["state"] = "missing_local"
            retained_entry["rehydrateStrategy"] = "manual"
            retained.append(retained_entry)
            continue
        first_seen_epoch = _safe_int(str(entry.get("firstSeenEpoch", "")), now)
        if now - first_seen_epoch > retention_seconds:
            continue
        retained.append(entry)
    return retained


def _batch_uploadable_items(items: Sequence[dict], max_files: int, max_bytes: int) -> List[List[dict]]:
    batches: List[List[dict]] = []
    current: List[dict] = []
    current_bytes = 0
    max_files = max(1, max_files)
    max_bytes = max(1, max_bytes)
    for item in [item for item in items if _is_uploadable_item(item)]:
        item_size = max(0, _safe_int(str(item.get("size", "0")), 0))
        would_exceed_files = len(current) >= max_files
        would_exceed_bytes = current and current_bytes + item_size > max_bytes
        if would_exceed_files or would_exceed_bytes:
            batches.append(current)
            current = []
            current_bytes = 0
        current.append(item)
        current_bytes += item_size
    if current:
        batches.append(current)
    return batches


def build_gdrive_upload_batches(args: argparse.Namespace) -> dict:
    expected = _load_expected_manifest(Path(args.expected_manifest))
    items = [item for item in expected.get("items", []) if isinstance(item, dict)]
    batches = _batch_uploadable_items(items, args.max_files, args.max_bytes)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_batches: List[dict] = []
    for index, batch_items in enumerate(batches, start=1):
        batch_id = f"batch-{index:04d}"
        files_from = output_dir / f"{batch_id}.txt"
        _write_files_from(files_from, batch_items, only_uploadable=False)
        manifest_batches.append(
            {
                "batchId": batch_id,
                "filesFrom": str(files_from),
                "itemCount": len(batch_items),
                "byteCount": sum(_safe_int(str(item.get("size", "0")), 0) for item in batch_items),
                "items": batch_items,
            }
        )
    payload = {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "generatedAt": args.generated_at or _utc_now_iso(),
        "runId": args.run_id or expected.get("runId", ""),
        "sourceRoot": args.source_root or expected.get("sourceRoot"),
        "remoteRoot": args.remote_root or expected.get("remoteRoot"),
        "batchCount": len(manifest_batches),
        "uploadableCount": sum(batch["itemCount"] for batch in manifest_batches),
        "batches": manifest_batches,
    }
    return payload


def create_gdrive_staging_shards(args: argparse.Namespace) -> dict:
    expected = _load_expected_manifest(Path(args.expected_manifest))
    verified_paths = _load_path_set(args.verified_files_from)
    source_root = Path(args.source_root or expected.get("sourceRoot") or ".")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    residual_local_items = []
    missing_items = []
    for item in expected.get("items", []):
        if not isinstance(item, dict):
            continue
        relative_path = str(item.get("relativePath", ""))
        if not relative_path or relative_path in verified_paths:
            continue
        candidate = source_root / relative_path
        if _is_uploadable_item(item) and candidate.is_file():
            residual_local_items.append(item)
        else:
            missing_items.append(item)
    batches = _batch_uploadable_items(residual_local_items, args.max_files, args.max_bytes)
    shards = []
    for index, shard_items in enumerate(batches, start=1):
        shard_id = f"shard-{index:04d}"
        archive_path = output_dir / f"{shard_id}.tar.gz"
        with tarfile.open(str(archive_path), "w:gz") as archive:
            for item in shard_items:
                relative_path = str(item["relativePath"])
                archive.add(str(source_root / relative_path), arcname=relative_path)
        remote_shard = _remote_join(args.remote_staging_root, archive_path.name)
        shard_payload = {
            "shardId": shard_id,
            "archivePath": str(archive_path),
            "archiveName": archive_path.name,
            "remoteShard": remote_shard,
            "itemCount": len(shard_items),
            "byteCount": sum(_safe_int(str(item.get("size", "0")), 0) for item in shard_items),
            "items": shard_items,
        }
        (output_dir / f"{shard_id}.manifest.json").write_text(
            json.dumps(shard_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        shards.append(shard_payload)
    payload = {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "generatedAt": args.generated_at or _utc_now_iso(),
        "runId": args.run_id or expected.get("runId", ""),
        "sourceRoot": str(source_root),
        "remoteStagingRoot": args.remote_staging_root,
        "verifiedCount": len(verified_paths),
        "stagedShardCount": len(shards),
        "stagedShardItemCount": sum(shard["itemCount"] for shard in shards),
        "missingLocalCount": len(missing_items),
        "shards": shards,
        "missingItems": missing_items,
    }
    return payload


def _derive_policy(status: str, input_policy: str, missing_local_count: int, failed_permanent_count: int, max_residual_attempts: int, threshold: int) -> str:
    if status == "backfill_required":
        return "backfill_required"
    if missing_local_count > 0 or failed_permanent_count > 0:
        return "backfill_required"
    if max_residual_attempts >= threshold and max_residual_attempts > 0:
        return "backfill_required"
    if input_policy == "required":
        return "required"
    return "warn"


def _validate_status_policy(status: str, policy: str) -> None:
    if status not in TOP_LEVEL_STATUSES:
        raise ValueError(f"invalid upload status: {status}")
    if status == "backfill_required" and policy != "backfill_required":
        raise ValueError("status=backfill_required requires policy=backfill_required")
    if policy == "backfill_required" and status in {"complete", "backfill_complete", "skipped"}:
        raise ValueError(f"policy=backfill_required conflicts with status={status}")


def build_gdrive_upload_status(args: argparse.Namespace) -> dict:
    generated_at = args.completed_at or _utc_now_iso()
    expected = _load_expected_manifest(Path(args.expected_manifest))
    expected_items = [item for item in expected.get("items", []) if isinstance(item, dict)]
    expected_count = len(expected_items)
    verified_paths = _load_path_set(args.verified_files_from)
    completion_proof = args.completion_proof
    strong_proof = _is_strong_proof(completion_proof)
    upload_mode = args.upload_mode
    exit_code = args.exit_code
    timed_out = _parse_bool(args.timeout)
    skipped = _parse_bool(args.skipped)
    staging_by_path = _load_staging_manifest(args.staging_manifest)

    verified_items = [item for item in expected_items if str(item.get("relativePath", "")) in verified_paths and strong_proof]
    verified_count = len(verified_items)
    verified_path_set = {str(item.get("relativePath", "")) for item in verified_items}
    residual_items = [item for item in expected_items if str(item.get("relativePath", "")) not in verified_path_set]
    residual_count = len(residual_items)
    terminal_status = "backfill_complete" if upload_mode == "backfill" else "complete"

    if skipped and expected_count == 0:
        status = "skipped"
        attempted_count = 0
        residual_items = []
        residual_count = 0
    elif expected_count == 0:
        status = "skipped"
        attempted_count = 0
    elif residual_count == 0 and strong_proof:
        status = terminal_status
        attempted_count = expected.get("uploadableCount", expected_count)
    elif timed_out or exit_code != 0:
        status = "partial"
        attempted_count = expected.get("uploadableCount", expected_count)
    else:
        # A clean copy exit without a remote proof is not a terminal success.
        status = "backfill_required"
        attempted_count = expected.get("uploadableCount", expected_count)
        if completion_proof == "none":
            completion_proof = "rclone_exit_zero" if exit_code == 0 else "none"

    residual_queue_path = Path(args.residual_queue) if args.residual_queue else None
    max_residual_attempts = 0
    pending_local_count = 0
    staged_shard_item_count = 0
    missing_local_count = 0
    failed_permanent_count = 0
    retained_unmatched_count = 0
    if residual_queue_path is not None:
        previous_entries = _load_queue_entries(residual_queue_path)
        source_root = args.source_root or expected.get("sourceRoot") or ""
        previous_entries = _prune_queue_entries(previous_entries, Path(source_root), args.retention_days)
        current_keys = {str(item.get("dedupeKey", "")) for item in expected_items}
        retained = [entry for entry in previous_entries if str((entry.get("item") or {}).get("dedupeKey", "")) not in current_keys]
        retained_unmatched_count = len(retained)
        now_epoch = int(time.time())
        previous_by_key = {
            str((entry.get("item") or {}).get("dedupeKey", "")): entry
            for entry in previous_entries
            if isinstance(entry.get("item"), dict)
        }
        for item in residual_items:
            key = str(item.get("dedupeKey", ""))
            relative_path = str(item.get("relativePath", ""))
            previous = previous_by_key.get(key, {})
            attempts = _safe_int(str(previous.get("attempts", item.get("attempts", "0"))), 0)
            if not skipped:
                attempts += 1
            max_residual_attempts = max(max_residual_attempts, attempts)
            queue_item = _copy_item(item)
            staged_info = staging_by_path.get(relative_path)
            if staged_info and staged_info.get("stagingShard"):
                state = "staged"
                queue_item["state"] = state
                queue_item["sourceState"] = "missing_local"
                queue_item["stagingShard"] = staged_info.get("stagingShard")
                rehydrate_strategy = "staging_shard"
            elif str(item.get("state")) == "staged" and item.get("stagingShard"):
                state = "staged"
                queue_item["state"] = state
                queue_item["sourceState"] = "missing_local"
                queue_item["stagingShard"] = item.get("stagingShard")
                rehydrate_strategy = "staging_shard"
            elif _is_uploadable_item(item) and (Path(source_root) / relative_path).is_file():
                state = "pending_local"
                queue_item["state"] = state
                queue_item["sourceState"] = "local"
                rehydrate_strategy = "local"
            else:
                state = "missing_local"
                queue_item["state"] = state
                queue_item["sourceState"] = "missing_local"
                rehydrate_strategy = "manual"
            if state not in QUEUE_STATES:
                raise ValueError(f"invalid queue state: {state}")
            if completion_proof == "rclone_exit_zero":
                queue_item["verificationRequired"] = True
            entry = {
                "schemaVersion": UPLOAD_SCHEMA_VERSION,
                "firstSeenAt": previous.get("firstSeenAt") or generated_at,
                "firstSeenEpoch": previous.get("firstSeenEpoch") or now_epoch,
                "lastAttemptAt": generated_at,
                "attempts": attempts,
                "state": state,
                "lastExitCode": exit_code,
                "item": queue_item,
                "stagingShard": queue_item.get("stagingShard"),
                "rehydrateStrategy": rehydrate_strategy,
            }
            retained.append(entry)
        for entry in retained:
            max_residual_attempts = max(max_residual_attempts, _safe_int(str(entry.get("attempts", "0")), 0))
            state = str(entry.get("state") or (entry.get("item") or {}).get("state") or "")
            if state == "pending_local":
                pending_local_count += 1
            elif state == "staged":
                staged_shard_item_count += 1
            elif state == "missing_local":
                missing_local_count += 1
            elif state == "failed_permanent":
                failed_permanent_count += 1
        _write_queue(residual_queue_path, retained)
    else:
        for item in residual_items:
            state = str(item.get("state") or "")
            if state == "pending_local" or _is_uploadable_item(item):
                pending_local_count += 1
            elif state == "staged":
                staged_shard_item_count += 1
            else:
                missing_local_count += 1

    effective_expected_count = expected_count + retained_unmatched_count
    residual_count = residual_count + retained_unmatched_count
    if status == "skipped" and retained_unmatched_count > 0:
        status = "backfill_required"
    if status == "complete" and retained_unmatched_count > 0:
        status = "backfill_required"
    if status == "partial" and (missing_local_count > 0 or staged_shard_item_count > 0 or max_residual_attempts >= args.backfill_threshold_attempts):
        status = "backfill_required"

    policy = _derive_policy(status, args.policy, missing_local_count, failed_permanent_count, max_residual_attempts, args.backfill_threshold_attempts)
    _validate_status_policy(status, policy)

    uploaded_count = 0
    uploaded_confidence = "unknown" if expected_count else "exact"
    skipped_existing_count = 0
    pending_backlog_count = pending_local_count + staged_shard_item_count + missing_local_count
    terminal_incomplete = status in {"partial", "backfill_required", "failed"}
    payload = {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "runId": args.run_id or expected.get("runId", ""),
        "policy": policy,
        "inputPolicy": args.policy,
        "sourceRoot": args.source_root or expected.get("sourceRoot"),
        "remoteRoot": args.remote_root or expected.get("remoteRoot"),
        "startedAt": args.started_at or None,
        "completedAt": generated_at,
        "uploadMode": upload_mode,
        "expectedCount": effective_expected_count,
        "attemptedCount": attempted_count,
        "uploadedCount": uploaded_count,
        "uploadedCountConfidence": uploaded_confidence,
        "skippedExistingCount": skipped_existing_count,
        "verifiedCount": verified_count,
        "residualCount": residual_count,
        "pendingBacklogCount": pending_backlog_count,
        "pendingLocalCount": pending_local_count,
        "stagedShardItemCount": staged_shard_item_count,
        "missingLocalCount": missing_local_count,
        "stagedShardCount": len({info.get("shardId") for info in staging_by_path.values() if info.get("shardId")}),
        "maxResidualAttempts": max_residual_attempts,
        "backfillThresholdAttempts": args.backfill_threshold_attempts,
        "timeout": timed_out,
        "exitCode": exit_code,
        "status": status,
        "terminalIncomplete": terminal_incomplete,
        "completionProof": completion_proof,
        "verificationRequired": bool(residual_count and completion_proof == "rclone_exit_zero"),
        "dedupeKey": "relativePath:size:mtime",
        "residualQueuePath": str(residual_queue_path) if residual_queue_path else None,
        "notes": list(args.note or []),
    }
    if completion_proof == "rclone_exit_zero":
        payload["notes"].append("rclone copy exited zero but remote proof is required before terminal success")
    if payload["expectedCount"] != payload["verifiedCount"] + payload["skippedExistingCount"] + payload["residualCount"]:
        payload["status"] = "failed"
        payload["terminalIncomplete"] = True
        payload["notes"].append("accounting invariant failed")
    if payload["status"] in {"complete", "backfill_complete"} and not _is_strong_proof(payload["completionProof"]):
        payload["status"] = "failed"
        payload["terminalIncomplete"] = True
        payload["notes"].append("terminal status requires strong remote completion proof")
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
    parser.add_argument("--max-items", type=int, default=0)
    parser.add_argument("--generated-at", default="")


def _add_gdrive_batches_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", default="")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-root", default="")
    parser.add_argument("--max-files", type=int, default=400)
    parser.add_argument("--max-bytes", type=int, default=384 * 1024 * 1024)
    parser.add_argument("--generated-at", default="")


def _add_gdrive_staging_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--verified-files-from", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-staging-root", default="")
    parser.add_argument("--max-files", type=int, default=1000)
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    parser.add_argument("--generated-at", default="")


def _add_gdrive_status_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--summary-manifest", default="")
    parser.add_argument("--residual-queue", default="")
    parser.add_argument("--verified-files-from", default="")
    parser.add_argument("--staging-manifest", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--policy", choices=("required", "warn", "backfill_required"), default="warn")
    parser.add_argument("--upload-mode", choices=("direct_batch", "backfill", "skip"), default="direct_batch")
    parser.add_argument("--completion-proof", choices=("none", "rclone_exit_zero", "remote_size_check", "remote_manifest_check"), default="none")
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

    gdrive_batches_parser = subparsers.add_parser("write-gdrive-upload-batches")
    _add_gdrive_batches_args(gdrive_batches_parser)

    gdrive_staging_parser = subparsers.add_parser("write-gdrive-staging-shards")
    _add_gdrive_staging_args(gdrive_staging_parser)

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

    if args.command == "write-gdrive-upload-batches":
        payload = build_gdrive_upload_batches(args)
        write_json(Path(args.output), payload)
        return 0

    if args.command == "write-gdrive-staging-shards":
        payload = create_gdrive_staging_shards(args)
        write_json(Path(args.output), payload)
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
