"""Bounded caption registration for validated Tzuyang longform membership.

Planning and resume are offline apart from exact OSK reads. The adapter never
downloads media or calls a model. A caption review is only an unverified,
untimed source registration; it is not full visual or audio analysis.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat

from backend.knowledge_graph import osk_projection as projection
from backend.knowledge_graph.longform_analysis import (
    AnalysisError,
    decode as strict_decode,
    file_lock,
)
from backend.knowledge_graph.osk_publication import Engine, SPACE, PublicationError


CHANNEL_ID = "UCfpaSruWW3S4dibonKXENjA"
MAX_VIDEOS = 10_000
# Historical pilot IDs remain available to the separate title migration and
# its fixtures. They are not an execution allowlist.
IDS = (
    "F93TnnxCNvY", "3Z-ngM3DVi0", "BTyT60UWiLc", "-C4280KT3S4",
    "Tsy8xRjMpB0", "xRf_bhPFZrY", "zkOBLQUSEr0", "DNGGl1-jFcU",
    "Ck5UrobZuKA",
)
PLAN_SCHEMA = "tzudong-caption-plan/v3"
COVERAGE_SCHEMA = "caption-longform-membership/v2"
CHECKPOINT_SCHEMA = "tzudong-caption-checkpoint/v2"
SOURCE_SNAPSHOT_SCHEMA = "tzudong-caption-source-snapshot/v1"
SOURCE_SNAPSHOT_FILE = "source-snapshot.json"
MAX_SOURCE_SNAPSHOT_BYTES = 128 * 1024 * 1024
RECEIPT = "## Tzudong caption registration receipt"
EVIDENCE_INTERVAL_MEANING = "Untimed source link; start=0/end=null is not viewing coverage."


def fail(code):
    raise PublicationError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    )


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("CAPTION_SOURCE_INVALID")
        result[key] = value
    return result


def _decode_json(data, code="CAPTION_SOURCE_INVALID"):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail(code)
            result[key] = value
        return result

    try:
        return json.loads(
            data, object_pairs_hook=unique_object,
            parse_constant=lambda _: (_ for _ in ()).throw(PublicationError(code)),
        )
    except PublicationError:
        raise
    except (OSError, ValueError, UnicodeError, TypeError, RecursionError):
        fail(code)


def _read_file_snapshot(path, code="CAPTION_SOURCE_INVALID", max_bytes=32 * 1024 * 1024):
    path = Path(path)
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > max_bytes:
            fail(code)
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(max_bytes + 1)
        entry = os.stat(path, follow_symlinks=False)
        if (len(data) > max_bytes or not stat.S_ISREG(entry.st_mode)
                or entry.st_dev != opened.st_dev or entry.st_ino != opened.st_ino):
            fail(code)
        return data
    except PublicationError:
        raise
    except OSError:
        fail(code)
    finally:
        if fd is not None:
            os.close(fd)


def _trusted_system_root_path(path):
    """Expand only verified macOS system-root aliases before no-follow walking."""
    absolute = Path(os.path.abspath(path))
    parts = absolute.parts
    if len(parts) < 2:
        return absolute
    aliases = {"var": Path("/private/var"), "tmp": Path("/private/tmp"),
               "etc": Path("/private/etc")}
    expected = aliases.get(parts[1])
    alias = Path("/") / parts[1]
    try:
        if expected is not None and alias.is_symlink() and alias.resolve(strict=True) == expected:
            return expected.joinpath(*parts[2:])
    except (OSError, RuntimeError):
        pass
    return absolute


def _read_anchored_file_snapshot(path, code, max_bytes=32 * 1024 * 1024):
    """Read through anchored no-follow directory descriptors for every component."""
    path = _trusted_system_root_path(path)
    parts = path.parts[1:]
    if not parts or any(part in ("", ".", "..") for part in parts):
        fail(code)
    directory_fds = []
    file_fd = None
    try:
        directory_fds.append(os.open("/", _directory_flags()))
        for part in parts[:-1]:
            directory_fds.append(os.open(
                part, _directory_flags(), dir_fd=directory_fds[-1]
            ))
        parent_fd = directory_fds[-1]
        file_fd = os.open(
            parts[-1], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd
        )
        opened = os.fstat(file_fd)
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > max_bytes:
            fail(code)
        with os.fdopen(file_fd, "rb", closefd=False) as stream:
            data = stream.read(max_bytes + 1)
        entry = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
        if (len(data) > max_bytes or not stat.S_ISREG(entry.st_mode)
                or entry.st_dev != opened.st_dev or entry.st_ino != opened.st_ino):
            fail(code)
        return data
    except PublicationError:
        raise
    except OSError:
        fail(code)
    finally:
        if file_fd is not None:
            os.close(file_fd)
        for directory_fd in reversed(directory_fds):
            os.close(directory_fd)


def _read_json_snapshot(path, code="CAPTION_SOURCE_INVALID"):
    data = _read_file_snapshot(path, code)
    return _decode_json(data, code), data


def _read_json(path, code="CAPTION_SOURCE_INVALID"):
    return _read_json_snapshot(path, code)[0]


def _bounded_max_videos(value):
    if type(value) is not int or not 1 <= value <= MAX_VIDEOS:
        fail("CAPTION_MAX_VIDEOS_INVALID")
    return value


def file_snapshot(path, root):
    try:
        root = root.resolve(strict=True)
        relative = Path(path)
        if relative.is_absolute() or ".." in relative.parts:
            fail("CAPTION_SOURCE_INVALID")
        candidate = root / relative
        resolved = candidate.resolve(strict=True)
        if (not candidate.is_file() or candidate.is_symlink()
                or not resolved.is_relative_to(root)
                or any(parent.is_symlink() for parent in candidate.parents if parent.is_relative_to(root))):
            fail("CAPTION_SOURCE_INVALID")
        data = _read_file_snapshot(candidate, "CAPTION_SOURCE_INVALID", 4 * 1024 * 1024)
    except PublicationError:
        raise
    except (OSError, RuntimeError):
        fail("CAPTION_SOURCE_INVALID")
    if len(data) > 4 * 1024 * 1024:
        fail("CAPTION_SOURCE_INVALID")
    return {"path": relative.as_posix(), "sha256": digest(data), "bytes": len(data)}, data


def file_binding(path, root):
    return file_snapshot(path, root)[0]


def _source_bindings_from_files(vid, review, files):
    review_path = f"source/analysis/{vid}/caption-review.json"
    if not isinstance(review, dict):
        fail("CAPTION_SOURCE_INVALID")
    versions = review.get("sourceVersions")
    if (review.get("videoId") != vid or not projection.VIDEO_ID.fullmatch(vid)
            or not isinstance(versions, dict) or set(versions) != {"ko", "koOrig"}):
        fail("CAPTION_SOURCE_INVALID")
    if review_path not in files:
        fail("CAPTION_SOURCE_INVALID")
    bindings = [{"path": review_path, "sha256": digest(files[review_path]),
                 "bytes": len(files[review_path])}]
    source_paths = []
    for key in sorted(versions):
        version = versions[key]
        if not isinstance(version, dict):
            fail("CAPTION_SOURCE_INVALID")
        for field, hash_keys in (
            ("subtitleFile", ("subtitleSha256", "sourceSha256")),
            ("transcriptFile", ("transcriptSha256",)),
        ):
            relative = version.get(field)
            if not isinstance(relative, str) or relative not in files:
                fail("CAPTION_SOURCE_INVALID")
            binding = {"path": relative, "sha256": digest(files[relative]),
                       "bytes": len(files[relative])}
            expected = [version.get(name) for name in hash_keys if name in version]
            if (not expected or any(not isinstance(value, str) for value in expected)
                    or any(value != binding["sha256"] for value in expected)):
                fail("CAPTION_SOURCE_HASH_MISMATCH")
            bindings.append(binding)
            source_paths.append(binding["path"])
    if len(source_paths) != len(set(source_paths)):
        fail("CAPTION_SOURCE_INVALID")
    return sorted(bindings, key=lambda item: item["path"])


def source_bindings(root, vid):
    review_path = f"source/analysis/{vid}/caption-review.json"
    review_binding, review_data = file_snapshot(review_path, root)
    review = _decode_json(review_data)
    versions = review.get("sourceVersions") if isinstance(review, dict) else None
    if not isinstance(versions, dict):
        fail("CAPTION_SOURCE_INVALID")
    files = {review_path: review_data}
    for version in versions.values():
        if not isinstance(version, dict):
            fail("CAPTION_SOURCE_INVALID")
        for field in ("subtitleFile", "transcriptFile"):
            relative = version.get(field)
            if not isinstance(relative, str):
                fail("CAPTION_SOURCE_INVALID")
            _, files[relative] = file_snapshot(relative, root)
    bindings = _source_bindings_from_files(vid, review, files)
    if bindings[0] != review_binding:
        fail("CAPTION_SOURCE_CHANGED")
    return bindings


def _membership_data(data, tab):
    value = _decode_json(data, "CAPTION_COVERAGE_INVALID")
    if not isinstance(value, dict):
        fail("CAPTION_COVERAGE_INVALID")
    rows = value.get("rows")
    if (value.get("tab") != tab or value.get("channelId") != CHANNEL_ID
            or not isinstance(rows, list) or len(rows) > 100_000
            or ("entryCount" in value and value["entryCount"] != len(rows))):
        fail("CAPTION_COVERAGE_INVALID")
    ids, admitted, blocked = [], [], []
    allowed_statuses = {None, "not_live", "was_live", "is_live", "is_upcoming", "post_live"}
    for row in rows:
        if (not isinstance(row, dict) or not projection.VIDEO_ID.fullmatch(str(row.get("id", "")))
                or row.get("channelId") not in (None, CHANNEL_ID)
                or row.get("liveStatus") not in allowed_statuses):
            fail("CAPTION_COVERAGE_INVALID")
        video_id = row["id"]
        ids.append(video_id)
        live_status = row.get("liveStatus")
        if ((tab == "videos" and live_status in (None, "not_live", "was_live"))
                or (tab == "streams" and live_status == "was_live")):
            admitted.append(video_id)
        elif tab in ("videos", "streams"):
            blocked.append(video_id)
    if len(ids) != len(set(ids)):
        fail("CAPTION_COVERAGE_INVALID")
    return {
        "tab": tab,
        "sha256": digest(data),
        "bytes": len(data),
        "entryCount": len(rows),
        "idSetSha256": digest(canonical(sorted(ids)).encode()),
    }, set(ids), set(admitted), set(blocked)


def _membership_file(path, tab):
    data = _read_anchored_file_snapshot(path, "CAPTION_COVERAGE_INVALID")
    return (*_membership_data(data, tab), data)


def _reviews_from_files(files):
    review_suffix = "/caption-review.json"
    review_paths = sorted(path for path in files if path.startswith("source/analysis/")
                          and path.endswith(review_suffix))
    raw = []
    for relative in review_paths:
        value = _decode_json(files[relative])
        video_id = value.get("videoId") if isinstance(value, dict) else None
        if not isinstance(video_id, str) or not projection.VIDEO_ID.fullmatch(video_id):
            fail("CAPTION_SOURCE_INVALID")
        raw.append((relative, video_id, value))
    ids = [video_id for _, video_id, _ in raw]
    if len(ids) != len(set(ids)):
        fail("CAPTION_REVIEW_DUPLICATE")
    discovered, used = [], set(review_paths)
    for relative, video_id, review in raw:
        if relative != f"source/analysis/{video_id}/caption-review.json":
            fail("CAPTION_SOURCE_INVALID")
        bindings = _source_bindings_from_files(video_id, review, files)
        used.update(binding["path"] for binding in bindings)
        discovered.append({"videoId": video_id, "sourceFiles": bindings})
    if used != set(files):
        fail("CAPTION_SOURCE_INVALID")
    return discovered


def _discover_reviews(root, max_total_bytes=MAX_SOURCE_SNAPSHOT_BYTES):
    try:
        root = root.resolve(strict=True)
        directory = root / "source" / "analysis"
        if directory.is_symlink() or not directory.is_dir():
            fail("CAPTION_SOURCE_INVALID")
        paths = sorted(directory.glob("*/caption-review.json"), key=lambda path: path.as_posix())
    except PublicationError:
        raise
    except OSError:
        fail("CAPTION_SOURCE_INVALID")
    files, total_bytes = {}, 0
    for path in paths:
        relative = path.relative_to(root).as_posix()
        binding, data = file_snapshot(relative, root)
        if binding["path"] != relative:
            fail("CAPTION_SOURCE_INVALID")
        value = _decode_json(data)
        video_id = value.get("videoId") if isinstance(value, dict) else None
        if not isinstance(video_id, str) or not projection.VIDEO_ID.fullmatch(video_id):
            fail("CAPTION_SOURCE_INVALID")
        if relative in files:
            fail("CAPTION_SOURCE_INVALID")
        files[relative] = data
        total_bytes += len(data)
        if total_bytes > max_total_bytes:
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
        versions = value.get("sourceVersions")
        if not isinstance(versions, dict):
            fail("CAPTION_SOURCE_INVALID")
        for version in versions.values():
            if not isinstance(version, dict):
                fail("CAPTION_SOURCE_INVALID")
            for field in ("subtitleFile", "transcriptFile"):
                source_path = version.get(field)
                if not isinstance(source_path, str):
                    fail("CAPTION_SOURCE_INVALID")
                if source_path in files:
                    continue
                _, source_data = file_snapshot(source_path, root)
                files[source_path] = source_data
                total_bytes += len(source_data)
                if total_bytes > max_total_bytes:
                    fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    return _reviews_from_files(files), files


def _inventory_from_bytes(membership_files, channel_files):
    if (not isinstance(membership_files, dict)
            or set(membership_files) != {"videos", "streams", "shorts"}
            or not all(isinstance(data, bytes) for data in membership_files.values())
            or not isinstance(channel_files, dict)
            or not all(isinstance(path, str) and isinstance(data, bytes)
                       for path, data in channel_files.items())):
        fail("CAPTION_COVERAGE_INVALID")
    inputs, ids_by_tab, admitted_longforms, blocked_live = [], {}, set(), set()
    for tab in ("videos", "streams", "shorts"):
        record, ids, admitted, blocked = _membership_data(membership_files[tab], tab)
        inputs.append(record)
        ids_by_tab[tab] = ids
        admitted_longforms.update(admitted)
        blocked_live.update(blocked)
    eligible = admitted_longforms - blocked_live - ids_by_tab["shorts"]
    reviews = _reviews_from_files(channel_files)
    review_map = {item["videoId"]: item["sourceFiles"] for item in reviews}
    candidates = sorted(eligible & review_map.keys())
    review_index = [
        {"videoId": item["videoId"], "sourceFilesSha256": digest(canonical(item["sourceFiles"]).encode())}
        for item in reviews
    ]
    coverage = {
        "schema": COVERAGE_SCHEMA,
        "channelId": CHANNEL_ID,
        "inputs": inputs,
        "eligibleCount": len(eligible),
        "eligibleSetSha256": digest(canonical(sorted(eligible)).encode()),
        "shortsExcludedCount": len(ids_by_tab["shorts"]),
        "captionReviewCount": len(reviews),
        "eligibleCaptionReviewCount": len(candidates),
        "eligibleWithoutCaptionCount": len(eligible - review_map.keys()),
        "excludedCaptionReviewCount": len(review_map.keys() - eligible),
        "captionReviewSetSha256": digest(canonical(sorted(review_map)).encode()),
        "sourceSetSha256": digest(canonical(review_index).encode()),
    }
    coverage["revision"] = digest(canonical(coverage).encode())
    return coverage, candidates, review_map


def _capture_source_inventory(root, memberships):
    if not isinstance(memberships, dict) or set(memberships) != {"videos", "streams", "shorts"}:
        fail("CAPTION_COVERAGE_INVALID")
    membership_files = {}
    membership_bytes = 0
    for tab in ("videos", "streams", "shorts"):
        _, _, _, _, membership_files[tab] = _membership_file(Path(memberships[tab]), tab)
        membership_bytes += len(membership_files[tab])
        if membership_bytes > MAX_SOURCE_SNAPSHOT_BYTES:
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    _, channel_files = _discover_reviews(root, MAX_SOURCE_SNAPSHOT_BYTES - membership_bytes)
    coverage, candidates, review_map = _inventory_from_bytes(membership_files, channel_files)
    return coverage, candidates, review_map, {
        "memberships": membership_files,
        "channelFiles": channel_files,
    }


def source_inventory(root, memberships):
    coverage, candidates, review_map, _ = _capture_source_inventory(root, memberships)
    return coverage, candidates, review_map


def append_registration(before, vid, bindings, coverage):
    if projection._metadata(before["body"]) is not None or RECEIPT in before["body"]:
        fail("CAPTION_NODE_ALREADY_REGISTERED")
    metadata = {
        "schemaVersion": 1,
        "kind": "video",
        "videoId": vid,
        "analysisStatus": "pending",
        "displayLabel": f"{vid} · 자막 1차 검토",
        "evidence": [{
            "videoId": vid,
            "startSeconds": 0,
            "endSeconds": None,
            "url": f"https://www.youtube.com/watch?v={vid}",
            "status": "unverified",
        }],
    }
    receipt = {
        "schema": "tzudong-caption-registration/v1",
        "videoId": vid,
        "originalBodySha256": digest(before["body"].encode()),
        "sourceFiles": bindings,
        "coverageRevision": coverage,
        "sourceRevisionStatus": "captured",
        "sourceRevisionMeaning": (
            "Exact immutable input version; later mutable-source currency is not asserted."
        ),
        "observation": "caption-first-pass",
        "independentFullVisualVerified": False,
        "independentAudioVerified": False,
        "evidenceIntervalMeaning": EVIDENCE_INTERVAL_MEANING,
        "modelConfigBinding": None,
    }
    result = (
        before["body"] + "\n\n" + projection.METADATA_HEADING + "\n```json\n"
        + canonical(metadata) + "\n```\n\n" + RECEIPT + "\n```json\n"
        + canonical(receipt) + "\n```\n"
    )
    if projection._metadata(result) != metadata:
        fail("CAPTION_NODE_BODY_INVALID")
    projection._evidence(metadata["evidence"])
    return result


def _section(body, heading):
    if body.count(heading) != 1:
        fail("CAPTION_NODE_ALREADY_REGISTERED")
    lines = body.split(heading, 1)[1].splitlines()
    if len(lines) < 3 or lines[1] != "```json":
        fail("CAPTION_NODE_ALREADY_REGISTERED")
    try:
        end = lines.index("```", 2)
        return json.loads("\n".join(lines[2:end]), object_pairs_hook=_unique_object)
    except (ValueError, TypeError, PublicationError):
        fail("CAPTION_NODE_ALREADY_REGISTERED")


def _registration_state(node, vid, bindings, coverage):
    body = node["body"]
    metadata = projection._metadata(body)
    has_receipt = RECEIPT in body
    if metadata is None and not has_receipt:
        return "unregistered"
    if metadata is None or not has_receipt:
        fail("CAPTION_NODE_ALREADY_REGISTERED")
    receipt = _section(body, RECEIPT)
    try:
        evidence = projection._evidence(metadata.get("evidence", []))
    except projection.ProjectionError:
        fail("CAPTION_NODE_ALREADY_REGISTERED")
    original, separator, _ = body.partition("\n\n" + projection.METADATA_HEADING)
    current = (
        metadata.get("kind") == "video"
        and metadata.get("videoId") == vid
        and metadata.get("analysisStatus") == "pending"
        and len(evidence) == 1
        and evidence[0].get("videoId") == vid
        and evidence[0].get("startSeconds") == 0
        and evidence[0].get("endSeconds") is None
        and evidence[0].get("url") == f"https://www.youtube.com/watch?v={vid}"
        and evidence[0].get("status") == "unverified"
        and bool(separator)
        and receipt.get("schema") == "tzudong-caption-registration/v1"
        and receipt.get("videoId") == vid
        and receipt.get("originalBodySha256") == digest(original.encode())
        and receipt.get("sourceFiles") == bindings
        and receipt.get("coverageRevision") == coverage
        and receipt.get("sourceRevisionStatus") == "captured"
        and receipt.get("sourceRevisionMeaning") == (
            "Exact immutable input version; later mutable-source currency is not asserted."
        )
        and receipt.get("observation") == "caption-first-pass"
        and receipt.get("independentFullVisualVerified") is False
        and receipt.get("independentAudioVerified") is False
        and receipt.get("evidenceIntervalMeaning") == EVIDENCE_INTERVAL_MEANING
        and receipt.get("modelConfigBinding") is None
    )
    return "current" if current else "stale"


def registered_caption(node, vid, bindings, coverage):
    return _registration_state(node, vid, bindings, coverage) == "current"


def check_node(node, vid):
    name = "YT-tzuyang-Video-" + vid
    if not node or node.get("name") != name or node.get("path") != SPACE + "/" + name + ".md":
        fail("CAPTION_NODE_PREIMAGE_MISMATCH")


def _target(node, vid, bindings, coverage):
    check_node(node, vid)
    if (not isinstance(node.get("id"), str) or not isinstance(node.get("meta"), dict)
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(node.get("hash")))):
        fail("CAPTION_NODE_PREIMAGE_MISMATCH")
    body = append_registration(node, vid, bindings, coverage)
    return {
        "videoId": vid,
        "name": node["name"],
        "path": node["path"],
        "id": node["id"],
        "beforeHash": node["hash"],
        "beforeBody": node["body"],
        "beforeBodySha256": digest(node["body"].encode()),
        "meta": node["meta"],
        "sourceFiles": bindings,
        "body": body,
        "targetBodySha256": digest(body.encode()),
    }


def plan(engine, root, memberships, max_videos):
    max_videos = _bounded_max_videos(max_videos)
    coverage, candidates, review_map = source_inventory(root, memberships)
    targets, registered, stale = [], [], []
    for vid in candidates:
        node = engine.read("YT-tzuyang-Video-" + vid)
        check_node(node, vid)
        registration = _registration_state(node, vid, review_map[vid], coverage)
        if registration == "current":
            registered.append(vid)
        elif registration == "stale":
            stale.append(vid)
        elif len(targets) < max_videos:
            targets.append(_target(node, vid, review_map[vid], coverage))
    selected = [target["videoId"] for target in targets]
    base = {
        "schema": PLAN_SCHEMA,
        "coverageRevision": coverage,
        "maxVideos": max_videos,
        "selection": {
            "candidateCount": len(candidates),
            "alreadyRegisteredCount": len(registered),
            "staleRegisteredCount": len(stale),
            "selectedCount": len(selected),
            "deferredCount": len(candidates) - len(registered) - len(stale) - len(selected),
            "selectedVideoIds": selected,
        },
        "targets": targets,
        "providerCalls": 0,
        "sharedVaultWrites": 0,
        "independentVideoCompletion": False,
    }
    base["planSha256"] = digest(canonical(base).encode())
    return base


def _valid_binding(value):
    return (isinstance(value, dict) and set(value) == {"path", "sha256", "bytes"}
            and isinstance(value["path"], str) and not Path(value["path"]).is_absolute()
            and ".." not in Path(value["path"]).parts
            and re.fullmatch(r"[a-f0-9]{64}", str(value["sha256"]))
            and type(value["bytes"]) is int and value["bytes"] >= 0)


def validate_plan(saved):
    if not isinstance(saved, dict) or saved.get("schema") != PLAN_SCHEMA:
        fail("CAPTION_PLAN_INVALID")
    unsigned = dict(saved)
    plan_sha = unsigned.pop("planSha256", None)
    if not isinstance(plan_sha, str) or digest(canonical(unsigned).encode()) != plan_sha:
        fail("CAPTION_PLAN_INVALID")
    max_videos = _bounded_max_videos(saved.get("maxVideos"))
    coverage = saved.get("coverageRevision")
    if not isinstance(coverage, dict):
        fail("CAPTION_PLAN_INVALID")
    unsigned_coverage = dict(coverage)
    revision = unsigned_coverage.pop("revision", None)
    if (coverage.get("schema") != COVERAGE_SCHEMA or not isinstance(revision, str)
            or digest(canonical(unsigned_coverage).encode()) != revision):
        fail("CAPTION_PLAN_INVALID")
    targets = saved.get("targets")
    selection = saved.get("selection")
    if not isinstance(targets, list) or not isinstance(selection, dict):
        fail("CAPTION_PLAN_INVALID")
    ids = [target.get("videoId") for target in targets if isinstance(target, dict)]
    if (len(ids) != len(targets) or ids != sorted(ids) or len(ids) != len(set(ids))
            or len(ids) > max_videos or selection.get("selectedVideoIds") != ids
            or selection.get("selectedCount") != len(ids)
            or any(type(selection.get(key)) is not int or selection[key] < 0 for key in (
                "candidateCount", "alreadyRegisteredCount", "staleRegisteredCount",
                "selectedCount", "deferredCount"
            ))
            or selection["candidateCount"] != selection["alreadyRegisteredCount"]
            + selection["staleRegisteredCount"] + len(ids) + selection["deferredCount"]):
        fail("CAPTION_PLAN_INVALID")
    for target in targets:
        vid = target["videoId"]
        check_node(target, vid)
        if (not projection.VIDEO_ID.fullmatch(vid) or not isinstance(target.get("beforeBody"), str)
                or digest(target["beforeBody"].encode()) != target.get("beforeBodySha256")
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(target.get("beforeHash")))
                or not isinstance(target.get("body"), str)
                or digest(target["body"].encode()) != target.get("targetBodySha256")
                or not isinstance(target.get("meta"), dict) or not isinstance(target.get("id"), str)
                or not isinstance(target.get("sourceFiles"), list)
                or target["sourceFiles"] != sorted(target["sourceFiles"], key=lambda item: item.get("path", ""))
                or not all(_valid_binding(item) for item in target["sourceFiles"])
                or append_registration({"body": target["beforeBody"]}, vid, target["sourceFiles"], coverage) != target["body"]):
            fail("CAPTION_PLAN_INVALID")
    return plan_sha


def _same_meta(current, target):
    return all(current["meta"].get(key) == value for key, value in target["meta"].items() if key != "updated")


def _before(current, target):
    return (current["id"] == target["id"] and current["hash"] == target["beforeHash"]
            and current["body"] == target["beforeBody"] and _same_meta(current, target))


def _after(current, target):
    return (current["id"] == target["id"] and current["body"] == target["body"]
            and current["path"] == target["path"] and _same_meta(current, target))


def _checkpoint_payload(plan_sha, target, coverage, source_snapshot_sha, after):
    return {
        "schema": CHECKPOINT_SCHEMA,
        "planSha256": plan_sha,
        "coverageRevision": coverage["revision"],
        "sourceSetSha256": coverage["sourceSetSha256"],
        "sourceSnapshotSha256": source_snapshot_sha,
        "videoId": target["videoId"],
        "nodeId": target["id"],
        "beforeHash": target["beforeHash"],
        "targetBodySha256": target["targetBodySha256"],
        "afterHash": after["hash"],
        "state": "readback_confirmed",
        "independentFullVisualVerified": False,
        "independentAudioVerified": False,
    }


def _checkpoint_root(path):
    path = Path(path)
    try:
        created = not path.exists()
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.is_symlink() or not path.is_dir() or (path.stat().st_mode & 0o077):
            fail("CAPTION_CHECKPOINT_INVALID")
        if created:
            os.chmod(path, 0o700)
        return path.resolve(strict=True)
    except PublicationError:
        raise
    except OSError:
        fail("CAPTION_CHECKPOINT_INVALID")


def _directory_flags():
    return os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)


def _assert_directory_entry(parent_fd, name, child_fd):
    try:
        entry = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        opened = os.fstat(child_fd)
    except OSError:
        fail("CAPTION_CHECKPOINT_INVALID")
    if (not stat.S_ISDIR(entry.st_mode) or entry.st_dev != opened.st_dev
            or entry.st_ino != opened.st_ino or (opened.st_mode & 0o077)):
        fail("CAPTION_CHECKPOINT_INVALID")


def _assert_checkpoint_scope(scope):
    try:
        root_entry = os.stat(scope["root"], follow_symlinks=False)
        root_opened = os.fstat(scope["rootFd"])
    except OSError:
        fail("CAPTION_CHECKPOINT_INVALID")
    if (not stat.S_ISDIR(root_entry.st_mode) or root_entry.st_dev != root_opened.st_dev
            or root_entry.st_ino != root_opened.st_ino):
        fail("CAPTION_CHECKPOINT_INVALID")
    _assert_directory_entry(scope["rootFd"], scope["planSha256"], scope["planFd"])


@contextmanager
def _checkpoint_plan_directory(root, plan_sha):
    root = _checkpoint_root(root)
    root_fd = plan_fd = None
    try:
        root_fd = os.open(root, _directory_flags())
        try:
            os.mkdir(plan_sha, 0o700, dir_fd=root_fd)
        except FileExistsError:
            pass
        plan_fd = os.open(plan_sha, _directory_flags(), dir_fd=root_fd)
        scope = {"root": root, "rootFd": root_fd, "planFd": plan_fd, "planSha256": plan_sha}
        _assert_checkpoint_scope(scope)
        yield scope
        _assert_checkpoint_scope(scope)
    except PublicationError:
        raise
    except OSError:
        fail("CAPTION_CHECKPOINT_INVALID")
    finally:
        if plan_fd is not None:
            os.close(plan_fd)
        if root_fd is not None:
            os.close(root_fd)


def _read_checkpoint_document(scope, filename):
    _assert_checkpoint_scope(scope)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(filename, flags, dir_fd=scope["planFd"])
    except FileNotFoundError:
        return None
    except OSError:
        fail("CAPTION_CHECKPOINT_CORRUPT")
    try:
        opened = os.fstat(fd)
        max_document_bytes = (MAX_SOURCE_SNAPSHOT_BYTES * 4 // 3) + 4 * 1024 * 1024
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > max_document_bytes:
            fail("CAPTION_CHECKPOINT_CORRUPT")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read()
        entry = os.stat(filename, dir_fd=scope["planFd"], follow_symlinks=False)
        if (not stat.S_ISREG(entry.st_mode) or entry.st_dev != opened.st_dev
                or entry.st_ino != opened.st_ino):
            fail("CAPTION_CHECKPOINT_CHANGED")
    except PublicationError:
        raise
    except OSError:
        fail("CAPTION_CHECKPOINT_CORRUPT")
    finally:
        os.close(fd)
    _assert_checkpoint_scope(scope)
    try:
        document = strict_decode(data)
    except AnalysisError:
        fail("CAPTION_CHECKPOINT_CORRUPT")
    if (not isinstance(document, dict) or set(document) != {"schemaVersion", "payload", "sha256"}
            or document.get("schemaVersion") != 1 or not isinstance(document.get("payload"), dict)
            or document.get("sha256") != digest(canonical(document["payload"]).encode())):
        fail("CAPTION_CHECKPOINT_CORRUPT")
    return document["payload"]


def _write_checkpoint_document(scope, filename, payload):
    _assert_checkpoint_scope(scope)
    if _read_checkpoint_document(scope, filename) is not None:
        fail("CAPTION_CHECKPOINT_CHANGED")
    document = {"schemaVersion": 1, "payload": payload,
                "sha256": digest(canonical(payload).encode())}
    data = canonical(document).encode()
    temporary = ".pending-" + secrets.token_hex(16)
    fd = None
    try:
        fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
            dir_fd=scope["planFd"],
        )
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        _assert_checkpoint_scope(scope)
        try:
            os.link(
                temporary, filename,
                src_dir_fd=scope["planFd"], dst_dir_fd=scope["planFd"],
                follow_symlinks=False,
            )
        except FileExistsError:
            fail("CAPTION_CHECKPOINT_CHANGED")
        os.fsync(scope["planFd"])
        _assert_checkpoint_scope(scope)
    except PublicationError:
        raise
    except OSError:
        fail("CAPTION_CHECKPOINT_READBACK_REQUIRED")
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(temporary, dir_fd=scope["planFd"])
        except FileNotFoundError:
            pass
        except OSError:
            fail("CAPTION_CHECKPOINT_READBACK_REQUIRED")
    if _read_checkpoint_document(scope, filename) != payload:
        fail("CAPTION_CHECKPOINT_READBACK_REQUIRED")


def _snapshot_entry(key, value, data):
    return {
        key: value,
        "sha256": digest(data),
        "bytes": len(data),
        "base64": base64.b64encode(data).decode("ascii"),
    }


def _source_snapshot_payload(plan_sha, coverage, raw):
    memberships = [
        _snapshot_entry("tab", tab, raw["memberships"][tab])
        for tab in ("videos", "streams", "shorts")
    ]
    channel_files = [
        _snapshot_entry("path", path, raw["channelFiles"][path])
        for path in sorted(raw["channelFiles"])
    ]
    manifest = {
        "memberships": [{key: value for key, value in item.items() if key != "base64"}
                        for item in memberships],
        "channelFiles": [{key: value for key, value in item.items() if key != "base64"}
                         for item in channel_files],
    }
    return {
        "schema": SOURCE_SNAPSHOT_SCHEMA,
        "planSha256": plan_sha,
        "coverageRevision": coverage,
        "manifestSha256": digest(canonical(manifest).encode()),
        "memberships": memberships,
        "channelFiles": channel_files,
    }


def _decode_snapshot_entries(entries, identity_key, expected_identities):
    if not isinstance(entries, list):
        fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    files, manifest, total = {}, [], 0
    for item in entries:
        if (not isinstance(item, dict)
                or set(item) != {identity_key, "sha256", "bytes", "base64"}
                or not isinstance(item.get(identity_key), str)
                or not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256")))
                or type(item.get("bytes")) is not int or item["bytes"] < 0
                or not isinstance(item.get("base64"), str)):
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
        identity = item[identity_key]
        if identity in files:
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
        try:
            data = base64.b64decode(item["base64"], validate=True)
        except (ValueError, TypeError):
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
        if (base64.b64encode(data).decode("ascii") != item["base64"]
                or len(data) != item["bytes"] or digest(data) != item["sha256"]):
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
        total += len(data)
        if total > MAX_SOURCE_SNAPSHOT_BYTES:
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
        files[identity] = data
        manifest.append({identity_key: identity, "sha256": item["sha256"], "bytes": item["bytes"]})
    if expected_identities is not None and list(files) != expected_identities:
        fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    return files, manifest, total


def _validate_source_snapshot(payload, plan_sha, saved):
    if (not isinstance(payload, dict)
            or set(payload) != {"schema", "planSha256", "coverageRevision", "manifestSha256",
                                "memberships", "channelFiles"}
            or payload.get("schema") != SOURCE_SNAPSHOT_SCHEMA
            or payload.get("planSha256") != plan_sha
            or payload.get("coverageRevision") != saved["coverageRevision"]
            or not re.fullmatch(r"[a-f0-9]{64}", str(payload.get("manifestSha256")))):
        fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    memberships, membership_manifest, membership_bytes = _decode_snapshot_entries(
        payload["memberships"], "tab", ["videos", "streams", "shorts"]
    )
    channel_files, channel_manifest, channel_bytes = _decode_snapshot_entries(
        payload["channelFiles"], "path", None
    )
    if membership_bytes + channel_bytes > MAX_SOURCE_SNAPSHOT_BYTES:
        fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    if list(channel_files) != sorted(channel_files) or any(
            Path(path).is_absolute() or ".." in Path(path).parts for path in channel_files
    ):
        fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    manifest = {"memberships": membership_manifest, "channelFiles": channel_manifest}
    if digest(canonical(manifest).encode()) != payload["manifestSha256"]:
        fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    coverage, candidates, review_map = _inventory_from_bytes(memberships, channel_files)
    if coverage != saved["coverageRevision"]:
        fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    for target in saved["targets"]:
        if (target["videoId"] not in candidates
                or review_map.get(target["videoId"]) != target["sourceFiles"]):
            fail("CAPTION_SOURCE_SNAPSHOT_INVALID")
    stats = {
        "inputFileCount": len(memberships) + len(channel_files),
        "inputBytes": membership_bytes + channel_bytes,
        "manifestFileSha256Count": len(membership_manifest) + len(channel_manifest),
    }
    return coverage, candidates, review_map, digest(canonical(payload).encode()), stats


def _load_or_capture_source_snapshot(scope, plan_sha, saved, root, memberships):
    payload = _read_checkpoint_document(scope, SOURCE_SNAPSHOT_FILE)
    captured_now = payload is None
    if payload is None:
        coverage, candidates, review_map, raw = _capture_source_inventory(root, memberships)
        if (coverage != saved["coverageRevision"]
                or any(target["videoId"] not in candidates for target in saved["targets"])
                or any(review_map.get(target["videoId"]) != target["sourceFiles"]
                       for target in saved["targets"])):
            fail("CAPTION_COVERAGE_CHANGED")
        payload = _source_snapshot_payload(plan_sha, coverage, raw)
        _validate_source_snapshot(payload, plan_sha, saved)
        _write_checkpoint_document(scope, SOURCE_SNAPSHOT_FILE, payload)
        payload = _read_checkpoint_document(scope, SOURCE_SNAPSHOT_FILE)
    coverage, candidates, review_map, snapshot_sha, stats = _validate_source_snapshot(
        payload, plan_sha, saved
    )
    stats["mutableSourceReadCount"] = stats["inputFileCount"] if captured_now else 0
    return coverage, candidates, review_map, snapshot_sha, stats


def _load_checkpoint(scope, filename, plan_sha, target, coverage, source_snapshot_sha, current):
    value = _read_checkpoint_document(scope, filename)
    if value is None:
        return None
    expected = _checkpoint_payload(plan_sha, target, coverage, source_snapshot_sha, current)
    if value != expected or not _after(current, target):
        fail("CAPTION_CHECKPOINT_CHANGED")
    return value


def apply(engine, root, memberships, saved, checkpoint_dir, max_videos):
    plan_sha = validate_plan(saved)
    if _bounded_max_videos(max_videos) != saved["maxVideos"]:
        fail("CAPTION_MAX_VIDEOS_CHANGED")
    results = []
    with _checkpoint_plan_directory(checkpoint_dir, plan_sha) as checkpoint_scope, file_lock(engine.lock):
        # Capture exact source bytes once, publish them inside the anchored
        # private checkpoint scope, then use only that immutable plan version.
        # Mutable producers are deliberately outside the OSK CAS transaction.
        coverage, _, _, source_snapshot_sha, source_snapshot_stats = _load_or_capture_source_snapshot(
            checkpoint_scope, plan_sha, saved, root, memberships
        )
        # Fence every uncheckpointed CAS preimage before the first new write.
        for target in saved["targets"]:
            current = engine.read(target["name"])
            check_node(current, target["videoId"])
            checkpoint_name = target["videoId"] + ".json"
            checkpoint = _load_checkpoint(
                checkpoint_scope, checkpoint_name, plan_sha, target, coverage,
                source_snapshot_sha, current
            )
            if checkpoint is None and not (_before(current, target) or _after(current, target)):
                fail("CAPTION_NODE_CHANGED")
        for target in saved["targets"]:
            current = engine.read(target["name"])
            check_node(current, target["videoId"])
            checkpoint_name = target["videoId"] + ".json"
            checkpoint = _load_checkpoint(
                checkpoint_scope, checkpoint_name, plan_sha, target, coverage,
                source_snapshot_sha, current
            )
            reused = checkpoint is not None or _after(current, target)
            if checkpoint is None and not reused:
                if not _before(current, target):
                    fail("CAPTION_NODE_CHANGED")
                try:
                    engine.api.update_node(
                        name=target["name"], body=target["body"], expect_hash=current["hash"]
                    )
                except Exception:
                    # Resolve an uncertain acknowledgement only by readback. Never resend.
                    pass
            after = engine.read(target["name"])
            check_node(after, target["videoId"])
            if not _after(after, target):
                fail("CAPTION_WRITE_READBACK_REQUIRED")
            payload = _checkpoint_payload(
                plan_sha, target, coverage, source_snapshot_sha, after
            )
            if checkpoint is None:
                _write_checkpoint_document(checkpoint_scope, checkpoint_name, payload)
            results.append({
                "name": target["name"],
                "afterHash": after["hash"],
                "reused": reused,
                "checkpointSha256": digest(canonical(payload).encode()),
            })
    return {
        "code": "CAPTION_REGISTRATION_READBACK",
        "planSha256": plan_sha,
        "results": results,
        "completedCount": len(results),
        "providerCalls": 0,
        "independentVideoCompletion": False,
        "independentFullVisualVerified": False,
        "coverageRevision": coverage,
        "sourceSnapshot": {
            "schema": SOURCE_SNAPSHOT_SCHEMA,
            "sha256": source_snapshot_sha,
            "coverageRevision": coverage["revision"],
            "sourceSetSha256": coverage["sourceSetSha256"],
            "status": "captured",
            "currentMutableSourcesCheckedAfterCapture": False,
            **source_snapshot_stats,
        },
    }


def write_private_output(path, result):
    data = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--channel-root", type=Path, required=True)
    parser.add_argument("--videos-membership", type=Path, required=True)
    parser.add_argument("--streams-membership", type=Path, required=True)
    parser.add_argument("--shorts-membership", type=Path, required=True)
    parser.add_argument("--max-videos", type=int, required=True)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--checkpoint-dir", type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists() or args.output.resolve().is_relative_to(args.vault.resolve()):
            fail("CAPTION_OUTPUT_INVALID")
        memberships = {
            "videos": args.videos_membership,
            "streams": args.streams_membership,
            "shorts": args.shorts_membership,
        }
        engine = Engine(args.vault, args.engine)
        engine.overview()
        if args.execute:
            if not args.plan:
                fail("CAPTION_PLAN_REQUIRED")
            if not args.checkpoint_dir:
                fail("CAPTION_CHECKPOINT_REQUIRED")
            result = apply(
                engine, args.channel_root.resolve(), memberships,
                _read_json(args.plan, "CAPTION_PLAN_INVALID"), args.checkpoint_dir,
                args.max_videos,
            )
        else:
            result = plan(engine, args.channel_root.resolve(), memberships, args.max_videos)
        write_private_output(args.output, result)
        print(json.dumps({
            "code": "CAPTION_PLAN_READY" if not args.execute else result["code"],
            "providerCalls": 0,
            "selectedCount": len(result.get("targets", result.get("results", []))),
        }))
    except Exception as exc:
        code = str(exc) if isinstance(exc, PublicationError) else "CAPTION_ADAPTER_FAILED"
        print(json.dumps({"code": code}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
