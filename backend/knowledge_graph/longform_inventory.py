"""Deterministically materialize the pinned public YouTube tab memberships.

This module is deliberately offline.  It accepts three already-collected,
byte-hash-pinned membership shards and produces the schema-v1 inventory used by
``longform_analysis`` plus a deterministic readback receipt.  It never queries
YouTube, downloads media, calls a model, or writes shared graph state.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


CHANNEL_ID = "UCfpaSruWW3S4dibonKXENjA"
CHANNEL_URL = "https://www.youtube.com/@tzuyang6145"
SHARD_SCHEMA = "public-flat-membership/v1"
RECEIPT_SCHEMA = "tzudong-longform-inventory-materialization/v1"
TABS = ("videos", "streams", "shorts")
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")
MAX_SHARD_BYTES = 16 * 1024 * 1024
MAX_SHARD_ROWS = 100_000
MAX_INVENTORY_BYTES = MAX_SHARD_BYTES * 2
_SHARD_KEYS = {
    "canonicalSourceOrQueueChanged", "channelId", "entryCount", "exitCode",
    "noMediaOrCaptionsDownloaded", "noPlaylistLimit", "observedAtUtc",
    "rawPersonalContactFieldsPersisted", "rawResponseBytes",
    "rawResponseSha256", "reportedPlaylistCount", "rows", "schema",
    "sourceUrl", "tab",
}
_ROW_KEYS = {"id", "duration", "liveStatus", "channelId"}


class MaterializationError(Exception):
    """Fixed, non-sensitive error codes for CLI and callers."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def canonical(value) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError):
        raise MaterializationError("DOCUMENT_INVALID") from None


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise MaterializationError("DOCUMENT_INVALID")
        result[key] = value
    return result


def _decode(data: bytes):
    try:
        return json.loads(
            data,
            object_pairs_hook=_unique_object,
            parse_constant=lambda _: (_ for _ in ()).throw(
                MaterializationError("DOCUMENT_INVALID")
            ),
        )
    except (UnicodeError, ValueError, TypeError):
        raise MaterializationError("DOCUMENT_INVALID") from None


def read_snapshot(path: Path, *, maximum: int = MAX_SHARD_BYTES) -> bytes:
    """Read one bounded regular-file snapshot without following symlinks."""
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        raise MaterializationError("INPUT_UNAVAILABLE") from None
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise MaterializationError("INPUT_INVALID")
        chunks, remaining = [], maximum + 1
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        after = os.fstat(descriptor)
        if len(data) > maximum or len(data) != before.st_size:
            raise MaterializationError("INPUT_INVALID")
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                after.st_ctime_ns):
            raise MaterializationError("INPUT_CHANGED_DURING_READ")
        return data
    except OSError:
        raise MaterializationError("INPUT_UNAVAILABLE") from None
    finally:
        os.close(descriptor)


def verify_file_sha256(path: Path, expected_sha256: str, *, maximum: int = MAX_SHARD_BYTES) -> bytes:
    if not isinstance(expected_sha256, str) or not SHA256.fullmatch(expected_sha256):
        raise MaterializationError("EXPECTED_SHA256_INVALID")
    data = read_snapshot(path, maximum=maximum)
    if sha256_bytes(data) != expected_sha256:
        raise MaterializationError("INPUT_SHA256_MISMATCH")
    return data


def _timestamp(value) -> str:
    if not isinstance(value, str) or len(value) > 40:
        raise MaterializationError("SHARD_TIMESTAMP_INVALID")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
    except ValueError:
        raise MaterializationError("SHARD_TIMESTAMP_INVALID") from None
    return value


def _positive_integer(value) -> bool:
    return type(value) is int and value > 0


def _load_shard(path: Path, expected_sha256: str, tab: str) -> tuple[dict, dict]:
    data = verify_file_sha256(path, expected_sha256)
    document = _decode(data)
    expected_url = f"{CHANNEL_URL}/{tab}"
    if not isinstance(document, dict) or set(document) != _SHARD_KEYS:
        raise MaterializationError("SHARD_SCHEMA_INVALID")
    if (
        document.get("schema") != SHARD_SCHEMA
        or document.get("tab") != tab
        or document.get("sourceUrl") != expected_url
        or document.get("channelId") != CHANNEL_ID
        or document.get("exitCode") != 0
        or document.get("noPlaylistLimit") is not True
        or document.get("canonicalSourceOrQueueChanged") is not False
        or document.get("noMediaOrCaptionsDownloaded") is not True
        or document.get("rawPersonalContactFieldsPersisted") is not False
    ):
        raise MaterializationError("SHARD_CONTRACT_INVALID")
    rows = document.get("rows")
    if not isinstance(rows, list) or len(rows) > MAX_SHARD_ROWS:
        raise MaterializationError("SHARD_CAPACITY_EXCEEDED")
    if (
        type(document.get("entryCount")) is not int
        or type(document.get("reportedPlaylistCount")) is not int
        or document["entryCount"] != len(rows)
        or document["reportedPlaylistCount"] != len(rows)
        or type(document.get("rawResponseBytes")) is not int
        or document["rawResponseBytes"] < 0
        or not isinstance(document.get("rawResponseSha256"), str)
        or not SHA256.fullmatch(document["rawResponseSha256"])
    ):
        raise MaterializationError("SHARD_COUNT_INVALID")
    _timestamp(document.get("observedAtUtc"))

    normalized, seen = [], set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != _ROW_KEYS:
            raise MaterializationError("SHARD_ROW_INVALID")
        video_id = row.get("id")
        if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
            raise MaterializationError("SHARD_ROW_INVALID")
        if video_id in seen:
            raise MaterializationError("SHARD_DUPLICATE_VIDEO_ID")
        seen.add(video_id)
        if row.get("channelId") not in (None, CHANNEL_ID):
            raise MaterializationError("SHARD_CHANNEL_CONFLICT")
        duration, live_status = row.get("duration"), row.get("liveStatus")
        if tab == "videos" and not _positive_integer(duration):
            raise MaterializationError("SHARD_DURATION_INVALID")
        if tab == "shorts" and duration is not None:
            raise MaterializationError("SHORTS_DURATION_UNEXPECTED")
        if tab == "streams":
            if live_status not in ("was_live", "is_live", "is_upcoming", "post_live"):
                raise MaterializationError("STREAM_LIVE_STATUS_INVALID")
            if live_status == "was_live" and not _positive_integer(duration):
                raise MaterializationError("SHARD_DURATION_INVALID")
            if live_status != "was_live" and duration is not None and not _positive_integer(duration):
                raise MaterializationError("SHARD_DURATION_INVALID")
        if tab != "streams" and live_status is not None:
            raise MaterializationError("SHARD_LIVE_STATUS_INVALID")
        normalized.append({
            "videoId": video_id,
            "durationSeconds": duration,
            **({"liveStatus": live_status} if tab == "streams" else {}),
        })
    source = {
        "observedAtUtc": document["observedAtUtc"],
        "path": str(path.resolve()),
        "rawResponseSha256": document["rawResponseSha256"],
        "sha256": expected_sha256,
    }
    return {"rows": normalized, "ids": seen, "sourceUrl": expected_url,
            "observedAt": document["observedAtUtc"],
            "rawResponseSha256": document["rawResponseSha256"]}, source


def build_inventory(
    videos_path: Path,
    videos_sha256: str,
    streams_path: Path,
    streams_sha256: str,
    shorts_path: Path,
    shorts_sha256: str,
) -> tuple[dict, dict]:
    inputs = {
        "videos": _load_shard(videos_path, videos_sha256, "videos"),
        "streams": _load_shard(streams_path, streams_sha256, "streams"),
        "shorts": _load_shard(shorts_path, shorts_sha256, "shorts"),
    }
    overlaps = {
        "videosStreams": len(inputs["videos"][0]["ids"] & inputs["streams"][0]["ids"]),
        "videosShorts": len(inputs["videos"][0]["ids"] & inputs["shorts"][0]["ids"]),
        "streamsShorts": len(inputs["streams"][0]["ids"] & inputs["shorts"][0]["ids"]),
    }
    result_by_id = {}
    for tab in TABS:
        shard = inputs[tab][0]
        for row in shard["rows"]:
            evidence = {
                "complete": True,
                "evidenceSha256": shard["rawResponseSha256"],
                "observedAt": shard["observedAt"],
                "sourceUrl": shard["sourceUrl"],
            }
            if tab == "streams":
                evidence["liveStatus"] = row["liveStatus"]
            item = result_by_id.setdefault(row["videoId"], {
                "membership": {name: None for name in TABS},
                "videoId": row["videoId"],
            })
            item["membership"][tab] = evidence
            if tab == "videos" or (tab == "streams" and row["durationSeconds"] is not None):
                item["durationSeconds"] = row["durationSeconds"]
            if tab == "streams":
                item["liveStatus"] = row["liveStatus"]
    result_rows = list(result_by_id.values())
    result_rows.sort(key=lambda row: row["videoId"])
    inventory = {
        "channelId": CHANNEL_ID,
        "channelUrl": CHANNEL_URL,
        "schemaVersion": 1,
        "sources": {tab: inputs[tab][1] for tab in TABS},
        "videos": result_rows,
    }
    video_ids = inputs["videos"][0]["ids"]
    short_ids = inputs["shorts"][0]["ids"]
    completed_stream_ids = {
        row["videoId"] for row in inputs["streams"][0]["rows"]
        if row["liveStatus"] == "was_live"
    }
    active_stream_ids = inputs["streams"][0]["ids"] - completed_stream_ids
    eligible_ids = (video_ids | completed_stream_ids) - short_ids - active_stream_ids
    eligible_video_ids = eligible_ids - completed_stream_ids
    counts = {
        "videos": len(eligible_video_ids),
        "completedStreams": len(eligible_ids & completed_stream_ids),
        "shortsExcluded": len(short_ids),
        "eligibleLongform": len(eligible_ids),
        "inventoryRows": len(result_rows),
    }
    invariants = {
        "withinTabDuplicateCount": 0,
        "pairwiseIntersectionCounts": overlaps,
        "durationMissingEligibleCount": 0,
        "completedStreamStatus": "was_live",
        "shortsExcludedFromEligible": True,
        "rawTabMembershipCounts": {
            tab: len(inputs[tab][0]["rows"]) for tab in TABS
        },
    }
    return inventory, {"counts": counts, "invariants": invariants}


def _existing_regular_bytes(path: Path) -> bytes | None:
    if not path.exists() and not path.is_symlink():
        return None
    try:
        return read_snapshot(path, maximum=MAX_INVENTORY_BYTES)
    except MaterializationError as error:
        if error.code == "INPUT_UNAVAILABLE":
            raise MaterializationError("OUTPUT_INVALID") from None
        raise MaterializationError("OUTPUT_INVALID") from None


def _path_identity(path: Path) -> tuple[int, int] | None:
    try:
        details = path.stat()
    except FileNotFoundError:
        return None
    except OSError:
        raise MaterializationError("OUTPUT_PATH_INVALID") from None
    return details.st_dev, details.st_ino


def _validate_output_isolation(source_paths: tuple[Path, ...], output_paths: tuple[Path, ...]) -> None:
    """Reject lexical, symlink-resolved, and hardlink source/output aliasing."""
    try:
        source_resolved = {path.resolve() for path in source_paths}
        output_resolved = [path.resolve() for path in output_paths]
    except OSError:
        raise MaterializationError("OUTPUT_PATH_INVALID") from None
    if any(path in source_resolved for path in output_resolved):
        raise MaterializationError("INPUT_OUTPUT_PATH_CONFLICT")
    if len(set(output_resolved)) != len(output_resolved):
        raise MaterializationError("OUTPUT_PATH_CONFLICT")

    source_identities = {identity for path in source_paths if (identity := _path_identity(path)) is not None}
    output_identities = [identity for path in output_paths if (identity := _path_identity(path)) is not None]
    if any(identity in source_identities for identity in output_identities):
        raise MaterializationError("INPUT_OUTPUT_PATH_CONFLICT")
    if len(set(output_identities)) != len(output_identities):
        raise MaterializationError("OUTPUT_PATH_CONFLICT")


def _stage(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        return temporary_path
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def _lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        raise MaterializationError("MATERIALIZATION_LOCK_UNAVAILABLE") from None
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        os.close(descriptor)


def materialize(
    *,
    videos_path: Path,
    videos_sha256: str,
    streams_path: Path,
    streams_sha256: str,
    shorts_path: Path,
    shorts_sha256: str,
    inventory_path: Path,
    receipt_path: Path,
) -> dict:
    lock_path = inventory_path.parent / f".{inventory_path.name}.materialize.lock"
    _validate_output_isolation(
        (videos_path, streams_path, shorts_path),
        (inventory_path, receipt_path, lock_path),
    )
    inventory, validation = build_inventory(
        videos_path, videos_sha256, streams_path, streams_sha256,
        shorts_path, shorts_sha256,
    )
    inventory_data = canonical(inventory)
    if len(inventory_data) > MAX_INVENTORY_BYTES:
        raise MaterializationError("INVENTORY_CAPACITY_EXCEEDED")
    inventory_hash = sha256_bytes(inventory_data)
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "kind": "private_offline_longform_inventory_materialization",
        "inputs": inventory["sources"],
        **validation,
        "inventory": {
            "path": str(inventory_path.resolve()),
            "bytes": len(inventory_data),
            "sha256": inventory_hash,
        },
        "providerCalls": 0,
        "sharedWrites": 0,
    }
    receipt_data = canonical(receipt)
    with _lock(lock_path):
        _validate_output_isolation(
            (videos_path, streams_path, shorts_path),
            (inventory_path, receipt_path, lock_path),
        )
        prior_inventory = _existing_regular_bytes(inventory_path)
        prior_receipt = _existing_regular_bytes(receipt_path)
        if prior_inventory == inventory_data and prior_receipt == receipt_data:
            return {**receipt, "reused": True,
                    "receiptSha256": sha256_bytes(receipt_data)}

        inventory_stage = None
        receipt_stage = None
        try:
            try:
                inventory_stage = _stage(inventory_path, inventory_data)
                receipt_stage = _stage(receipt_path, receipt_data)
            except BaseException:
                raise MaterializationError("MATERIALIZATION_STAGE_FAILED") from None

            committed_inventory = False
            committed_receipt = False
            try:
                os.replace(inventory_stage, inventory_path)
                committed_inventory = True
                os.replace(receipt_stage, receipt_path)
                committed_receipt = True
                _fsync_directory(inventory_path.parent)
                if receipt_path.parent != inventory_path.parent:
                    _fsync_directory(receipt_path.parent)
            except BaseException:
                if committed_inventory or committed_receipt:
                    try:
                        for target, prior, committed in (
                            (receipt_path, prior_receipt, committed_receipt),
                            (inventory_path, prior_inventory, committed_inventory),
                        ):
                            if not committed:
                                continue
                            if prior is None:
                                target.unlink(missing_ok=True)
                                continue
                            rollback = _stage(target, prior)
                            try:
                                os.replace(rollback, target)
                            finally:
                                rollback.unlink(missing_ok=True)
                        _fsync_directory(inventory_path.parent)
                        if receipt_path.parent != inventory_path.parent:
                            _fsync_directory(receipt_path.parent)
                    except BaseException:
                        raise MaterializationError("MATERIALIZATION_COMMIT_UNCERTAIN") from None
                raise MaterializationError("MATERIALIZATION_COMMIT_FAILED") from None
        finally:
            if inventory_stage is not None:
                inventory_stage.unlink(missing_ok=True)
            if receipt_stage is not None:
                receipt_stage.unlink(missing_ok=True)
    return {**receipt, "reused": False,
            "receiptSha256": sha256_bytes(receipt_data)}


def readback(inventory_path: Path, receipt_path: Path) -> dict:
    inventory_data = read_snapshot(inventory_path, maximum=MAX_INVENTORY_BYTES)
    receipt_data = read_snapshot(receipt_path, maximum=1024 * 1024)
    receipt = _decode(receipt_data)
    if (
        not isinstance(receipt, dict)
        or receipt.get("schema") != RECEIPT_SCHEMA
        or not isinstance(receipt.get("inventory"), dict)
        or receipt["inventory"].get("path") != str(inventory_path.resolve())
        or receipt["inventory"].get("bytes") != len(inventory_data)
        or receipt["inventory"].get("sha256") != sha256_bytes(inventory_data)
        or receipt.get("providerCalls") != 0
        or receipt.get("sharedWrites") != 0
    ):
        raise MaterializationError("MATERIALIZATION_READBACK_FAILED")
    inventory = _decode(inventory_data)
    if not isinstance(inventory, dict) or inventory.get("schemaVersion") != 1:
        raise MaterializationError("MATERIALIZATION_READBACK_FAILED")
    inputs = receipt.get("inputs")
    if not isinstance(inputs, dict) or set(inputs) != set(TABS):
        raise MaterializationError("MATERIALIZATION_READBACK_FAILED")
    try:
        rebuilt, validation = build_inventory(
            Path(inputs["videos"]["path"]), inputs["videos"]["sha256"],
            Path(inputs["streams"]["path"]), inputs["streams"]["sha256"],
            Path(inputs["shorts"]["path"]), inputs["shorts"]["sha256"],
        )
    except (KeyError, TypeError, MaterializationError):
        raise MaterializationError("MATERIALIZATION_READBACK_FAILED") from None
    expected_receipt = {
        "schema": RECEIPT_SCHEMA,
        "kind": "private_offline_longform_inventory_materialization",
        "inputs": rebuilt["sources"],
        **validation,
        "inventory": {
            "path": str(inventory_path.resolve()),
            "bytes": len(inventory_data),
            "sha256": sha256_bytes(inventory_data),
        },
        "providerCalls": 0,
        "sharedWrites": 0,
    }
    if canonical(rebuilt) != inventory_data or canonical(expected_receipt) != receipt_data:
        raise MaterializationError("MATERIALIZATION_READBACK_FAILED")
    return {**receipt, "receiptSha256": sha256_bytes(receipt_data)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for tab in TABS:
        parser.add_argument(f"--{tab}", type=Path, required=True)
        parser.add_argument(f"--{tab}-sha256", required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = materialize(
            videos_path=args.videos, videos_sha256=args.videos_sha256,
            streams_path=args.streams, streams_sha256=args.streams_sha256,
            shorts_path=args.shorts, shorts_sha256=args.shorts_sha256,
            inventory_path=args.inventory, receipt_path=args.receipt,
        )
        readback(args.inventory, args.receipt)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except MaterializationError as error:
        print(json.dumps({"error": error.code}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
