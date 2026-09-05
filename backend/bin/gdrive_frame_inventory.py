#!/usr/bin/env python3
"""Read-only, memory-only GDrive inventory; publish counts and hashes only."""
from __future__ import annotations

import base64
import configparser
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import zlib
from collections import Counter

FRAMES = "gdrive:04_빠른공유/tzudong_tzuyang_data/frames"
EXPECTED_FILE = Path(__file__).resolve().parents[1] / "data/gdrive-frame-inventory/expected-b5.v1.json.gz"
EXPECTED_GZIP_BYTES = 1026505
EXPECTED_RAW_BYTES = 22915062
EXPECTED_GZIP_SHA256 = "4d5f757ca08eb8754f175ccabed1bb83bb15cc94f93311090672e98069901b6b"
EXPECTED_COUNT = 192095
HISTORICAL_SOURCE_SHA256 = "c7076254b4cef5757fd305ed50be57db8209c24715578f4394a9f11c96a1a65e"
EXPECTED_IDENTITY_SHA256 = "a8df74b60b8e56f5438bcd9a038da4b410d5f586ec182a7bd9f29e4f74a94b1d"
MAX_BYTES = 256 * 1024 * 1024
MAX_REMOTE_FILES = 1000000
MD5 = re.compile(r"[a-fA-F0-9]{32}")
SHA = re.compile(r"[a-f0-9]{40}")
CONFIG_KEYS = {"type", "client_id", "client_secret", "token", "scope", "root_folder_id", "team_drive", "service_account_credentials"}


class InventoryError(Exception):
    """Only fixed codes cross the publication boundary."""


def fail(code):
    raise InventoryError(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def parse(raw):
    if len(raw) > MAX_BYTES:
        fail("INPUT_TOO_LARGE")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=lambda _: fail("JSON_INVALID"))
    except (UnicodeError, ValueError, RecursionError):
        fail("JSON_INVALID")


def relative_path(value):
    if (not isinstance(value, str) or not value or len(value) > 1024
            or any(ord(c) < 32 or ord(c) == 127 for c in value)
            or "\\" in value or ":" in value
            or any(part in {"", ".", ".."} for part in value.split("/"))):
        fail("PATH_INVALID")
    return value


def size(value):
    if type(value) is not int or not 0 <= value <= 2**53 - 1:
        fail("SIZE_INVALID")
    return value


def md5(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not MD5.fullmatch(value):
        fail("MD5_INVALID")
    return value.lower()


def expected_identity(payload):
    if (not isinstance(payload, dict) or type(payload.get("schemaVersion")) is not int
            or set(payload) != {"schemaVersion", "remoteRoot", "expectedCount", "items"}
            or payload.get("schemaVersion") != 1
            or payload.get("remoteRoot") != FRAMES
            or not isinstance(payload.get("items"), list)
            or type(payload.get("expectedCount")) is not int
            or not 0 < payload["expectedCount"] <= EXPECTED_COUNT
            or payload["expectedCount"] != len(payload["items"])):
        fail("EXPECTED_CONTRACT_INVALID")
    rows, identities = [], set()
    for item in payload["items"]:
        if not isinstance(item, dict) or set(item) != {"relativePath", "size", "mtimeEpoch", "md5"}:
            fail("EXPECTED_ITEM_INVALID")
        rel, byte_count = relative_path(item.get("relativePath")), size(item.get("size"))
        mtime = size(item.get("mtimeEpoch"))
        identity = (rel, byte_count, mtime)
        if identity in identities:
            fail("EXPECTED_DUPLICATE_IDENTITY")
        identities.add(identity)
        rows.append({"relativePath": rel, "size": byte_count, "mtimeEpoch": mtime, "md5": md5(item.get("md5"))})
    rows.sort(key=lambda row: (row["relativePath"], row["size"], row["mtimeEpoch"]))
    return {"schemaVersion": 1, "remoteRoot": FRAMES, "expectedCount": len(rows), "items": rows}


def load_expected():
    """Load the reviewed Git fixture, with bounds before decompression or parsing."""
    try:
        with EXPECTED_FILE.open("rb") as source:
            compressed = source.read(EXPECTED_GZIP_BYTES + 1)
        if len(compressed) != EXPECTED_GZIP_BYTES or digest(compressed) != EXPECTED_GZIP_SHA256:
            fail("EXPECTED_GZIP_INTEGRITY")
        with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as source:
            raw = source.read(EXPECTED_RAW_BYTES + 1)
        if len(raw) > EXPECTED_RAW_BYTES:
            fail("EXPECTED_TOO_LARGE")
        if len(raw) != EXPECTED_RAW_BYTES or digest(raw) != EXPECTED_IDENTITY_SHA256:
            fail("EXPECTED_RAW_INTEGRITY")
        identity = expected_identity(parse(raw))
        if identity["expectedCount"] != EXPECTED_COUNT or digest(canonical(identity)) != EXPECTED_IDENTITY_SHA256:
            fail("EXPECTED_IDENTITY_DRIFT")
        return raw
    except (OSError, EOFError, zlib.error):
        fail("EXPECTED_FILE_INVALID")


def remote_records(payload):
    if not isinstance(payload, list) or len(payload) > MAX_REMOTE_FILES:
        fail("INVENTORY_INVALID")
    records = {}
    for entry in payload:
        if not isinstance(entry, dict) or entry.get("IsDir") is not False:
            fail("INVENTORY_ITEM_INVALID")
        rel = relative_path(entry.get("Path"))
        if rel in records:
            fail("INVENTORY_DUPLICATE_PATH")
        hashes = entry.get("Hashes", {})
        if not isinstance(hashes, dict):
            fail("MD5_INVALID")
        variants = [md5(v) for k, v in hashes.items() if k.lower() == "md5"]
        if len(set(variants)) > 1:
            fail("MD5_CONFLICT")
        records[rel] = (size(entry.get("Size")), variants[0] if variants else None)
    return records


def validate_inventory(expected_raw, inventory_raw, source_sha, *, expected_count=EXPECTED_COUNT,
                       identity_pin=EXPECTED_IDENTITY_SHA256):
    if not isinstance(source_sha, str) or not SHA.fullmatch(source_sha):
        fail("SOURCE_SHA_INVALID")
    identity = expected_identity(parse(expected_raw))
    identity_hash = digest(canonical(identity))
    if identity["expectedCount"] != expected_count or identity_hash != identity_pin:
        fail("EXPECTED_IDENTITY_DRIFT")
    rows, remote = identity["items"], remote_records(parse(inventory_raw))
    paths = Counter(row["relativePath"] for row in rows)
    buckets = {key: [] for key in ("verified", "missing", "mismatch", "unverified")}
    for row in rows:
        record = remote.get(row["relativePath"])
        if paths[row["relativePath"]] > 1:
            outcome = "unverified"  # Versioned identities cannot be silently collapsed.
        elif record is None:
            outcome = "missing"
        elif record[0] != row["size"]:
            outcome = "mismatch"
        elif row["md5"] is None or record[1] is None:
            outcome = "unverified"
        elif record[1] != row["md5"]:
            outcome = "mismatch"
        else:
            outcome = "verified"
        buckets[outcome].append(row)
    counts = {key + "Count": len(value) for key, value in buckets.items()}
    if sum(counts.values()) != len(rows):
        fail("COUNT_CONSERVATION_FAILED")
    conflicting_sizes = {}
    for row in rows:
        conflicting_sizes.setdefault(row["relativePath"], set()).add(row["size"])
    counts.update(expectedCount=len(rows), uniqueExpectedPathCount=len(paths),
                  duplicateExpectedPathCount=sum(n > 1 for n in paths.values()),
                  duplicateExpectedRowCount=sum(n for n in paths.values() if n > 1),
                  conflictingExpectedSizePathCount=sum(len(v) > 1 for v in conflicting_sizes.values()),
                  expectedMd5MissingCount=sum(row["md5"] is None for row in rows),
                  remoteCount=len(remote), extraRemoteCount=len(remote.keys() - paths.keys()),
                  missingExpectedPathCount=len(paths.keys() - remote.keys()),
                  presentExpectedPathCount=len(paths.keys() & remote.keys()))
    return {"schemaVersion": 1, "status": "complete" if counts["verifiedCount"] == len(rows) else "gap",
            "sourceSha": source_sha, "historicalSourceSha256": HISTORICAL_SOURCE_SHA256,
            "inputSha256": digest(expected_raw), "inventoryInputSha256": digest(inventory_raw),
            "expectedIdentitySha256": identity_hash, "counts": counts,
            "manifestHashes": {key: digest(canonical(value)) for key, value in buckets.items()}}


def child_environment(encoded):
    try:
        if not isinstance(encoded, str) or len(encoded) > 256 * 1024:
            fail("CONFIG_INVALID")
        decoded = base64.b64decode("".join(encoded.split()), validate=True).decode("utf-8")
        config = configparser.ConfigParser(interpolation=None, strict=True)
        config.read_string(decoded)
        if config.defaults() or not config.has_section("gdrive"):
            fail("CONFIG_INVALID")
        remote = dict(config.items("gdrive"))
        if set(remote) - CONFIG_KEYS or remote.get("type") != "drive":
            fail("CONFIG_INVALID")
        if not remote.get("token") and not remote.get("service_account_credentials"):
            fail("CONFIG_INVALID")
        if any("\x00" in value for value in remote.values()):
            fail("CONFIG_INVALID")
        # Never inherit other remotes, generic rclone flags, proxies or Actions credentials.
        return {"PATH": "/usr/bin:/bin", **{"RCLONE_CONFIG_GDRIVE_" + key.upper(): value for key, value in remote.items()}}
    except (ValueError, UnicodeError, configparser.Error):
        fail("CONFIG_INVALID")


def read_remote(operation, env):
    commands = {"inventory": ["lsjson", FRAMES, "--recursive", "--files-only", "--hash"]}
    if operation not in commands:
        fail("OPERATION_INVALID")
    args = ["rclone", *commands[operation], "--config", "/dev/null", "--stats", "0",
            "--log-level", "ERROR", "--drive-skip-shortcuts", "--tpslimit", "2",
            "--retries", "1", "--low-level-retries", "1", "--contimeout", "20s", "--timeout", "60s"]
    child = None
    timer = None
    timed_out = threading.Event()
    try:
        child = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, shell=False)
        def expire():
            timed_out.set()
            try:
                child.kill()
            except OSError:
                pass
        timer = threading.Timer(1200, expire)
        timer.start()
        raw = child.stdout.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            fail("INPUT_TOO_LARGE")
        if child.wait() != 0 or timed_out.is_set():
            fail("REMOTE_READ_FAILED")
        return raw
    except (OSError, subprocess.SubprocessError):
        fail("REMOTE_READ_FAILED")
    finally:
        if timer is not None:
            timer.cancel()
            timer.join()
        if child is not None:
            if child.poll() is None:
                try:
                    child.kill()
                except OSError:
                    pass
            child.wait()
            child.stdout.close()


def source_binding(env):
    sha = env.get("EXPECTED_MAIN_SHA", "")
    if (not SHA.fullmatch(sha) or env.get("GITHUB_SHA") != sha
            or env.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
            or env.get("GITHUB_REF") != "refs/heads/main"
            or env.get("GITHUB_REF_PROTECTED") != "true"
            or env.get("GITHUB_REPOSITORY") != "twoimo/tzudong"):
        fail("SOURCE_BINDING_FAILED")
    result = subprocess.run(["git", "rev-parse", "HEAD"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env={"PATH": "/usr/bin:/bin"}, timeout=10, check=False)
    if result.returncode != 0 or result.stdout.decode("ascii").strip() != sha:
        fail("SOURCE_BINDING_FAILED")
    return sha


def main():
    report = {"schemaVersion": 1, "status": "failed", "code": "INVENTORY_FAILED"}
    try:
        sha = source_binding(os.environ)
        report["sourceSha"] = sha
        expected = load_expected()
        report["inputSha256"] = digest(expected)
        env = child_environment(os.environ.pop("GDRIVE_RCLONE_CONFIG", ""))
        inventory = read_remote("inventory", env)
        report["inventoryInputSha256"] = digest(inventory)
        report = validate_inventory(expected, inventory, sha)
        report["expectedGzipSha256"] = EXPECTED_GZIP_SHA256
    except InventoryError as error:
        report["code"] = str(error)
    except Exception:
        pass  # Never expose JSON, config, subprocess or provider diagnostics.
    report["validatorSourceSha256"] = digest(Path(__file__).read_bytes())
    print(canonical(report).decode("utf-8"))
    return 0 if report["status"] == "complete" else 2 if report["status"] == "gap" else 1


if __name__ == "__main__":
    sys.exit(main())
