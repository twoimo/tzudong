#!/usr/bin/env python3
"""Derive source coordinates from a private in-memory Bun JUnit stream."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import xml.etree.ElementTree as ET

MAX_INPUT = 32 * 1024 * 1024
MAX_TESTS = 10000
MAX_SITES = 64
PREFIX = "NIGHTLY_UNIT_DIAGNOSTIC="
FIELDS = {"schema", "test_count", "failure_count", "skip_count", "sites"}
SITE_FIELDS = {"file", "test_index", "line", "kind"}


def fail() -> None:
    raise ValueError("unit_diagnostic_rejected")


def inventory(root: Path) -> dict[str, int]:
    return {
        p.relative_to(root).as_posix(): len(p.read_text(encoding="utf-8").splitlines())
        for p in (root / "tests-unit").rglob("*")
        if p.is_file() and not p.is_symlink()
        and re.search(r"\.test\.(?:[cm]?[jt]sx?)$", p.name)
    }


def count(value: object, maximum: int = MAX_TESTS) -> bool:
    return type(value) is int and 0 <= value <= maximum


def validate(payload: object, files: dict[str, int]) -> dict:
    if not isinstance(payload, dict):
        fail()
    legacy = payload.get("schema") == "nightly-unit-failure-sites-v1"
    if (legacy and set(payload) != FIELDS) or (not legacy and (
        payload.get("schema") != "nightly-unit-failure-sites-v2" or set(payload) != FIELDS | {"omitted_site_count"}
    )):
        fail()
    if not all(count(payload[k]) for k in ("test_count", "failure_count", "skip_count")):
        fail()
    sites = payload["sites"]
    if not isinstance(sites, list) or len(sites) > MAX_SITES:
        fail()
    if legacy and len(sites) != payload["failure_count"]:
        fail()
    if not legacy and (
        not count(payload["omitted_site_count"])
        or len(sites) != min(payload["failure_count"], MAX_SITES)
        or payload["omitted_site_count"] != payload["failure_count"] - len(sites)
    ):
        fail()
    if payload["failure_count"] + payload["skip_count"] > payload["test_count"]:
        fail()
    identities = set()
    for site in sites:
        if not isinstance(site, dict) or set(site) != SITE_FIELDS:
            fail()
        file = site["file"]
        if not isinstance(file, str) or file not in files:
            fail()
        if not count(site["test_index"]) or type(site["line"]) is not int or not 1 <= site["line"] <= files[file]:
            fail()
        if site["kind"] not in {"failure", "error"}:
            fail()
        identity = (file, site["test_index"])
        if identity in identities:
            fail()
        identities.add(identity)
    return payload


def derive(data: dict, root: Path) -> dict:
    if set(data) not in ({"xml", "files"}, {"xml", "files", "exit_code"}) or not isinstance(data["xml"], str) or not isinstance(data["files"], list):
        fail()
    available = inventory(root)
    admitted = {}
    for file in data["files"]:
        if not isinstance(file, str) or file not in available or file in admitted:
            fail()
        admitted[file] = available[file]
    if not admitted or "<!DOCTYPE" in data["xml"] or "<!ENTITY" in data["xml"]:
        fail()
    report = ET.fromstring(data["xml"])
    if report.tag != "testsuites":
        fail()
    sites, next_index = [], {}
    total = skipped = failed = 0
    for case in report.iter("testcase"):
        raw_file = case.get("file", "").replace("\\", "/")
        file = raw_file
        if raw_file.startswith(str(root) + "/"):
            file = raw_file[len(str(root)) + 1:]
        if file not in admitted:
            fail()
        index = next_index.get(file, 0)
        next_index[file] = index + 1
        total += 1
        if total > MAX_TESTS:
            fail()
        outcomes = [child.tag for child in case if child.tag in {"failure", "error", "skipped"}]
        if len(outcomes) > 1:
            fail()
        if outcomes == ["skipped"]:
            skipped += 1
        elif outcomes:
            failed += 1
            line = case.get("line", "")
            if not line.isascii() or not line.isdigit():
                fail()
            if not 1 <= int(line) <= admitted[file]:
                fail()
            sites.append({"file": file, "test_index": index, "line": int(line), "kind": outcomes[0]})
    if not total or int(report.get("tests", "-1")) != total or int(report.get("failures", "-1")) != failed:
        fail()
    if int(report.get("skipped", "-1")) != skipped:
        fail()
    payload = validate({"schema": "nightly-unit-failure-sites-v2", "test_count": total,
                     "failure_count": failed, "skip_count": skipped, "sites": sites[:MAX_SITES],
                     "omitted_site_count": max(0, failed - MAX_SITES)}, admitted)
    if "exit_code" in data:
        code = data["exit_code"]
        if type(code) is not int or not -127 <= code <= 255 or (code == 0) != (failed == 0):
            fail()
    return payload


def main() -> int:
    root = Path(__file__).resolve().parents[2] / "apps/web"
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "--log":
            # Canonical local Nightly requires POSIX custody. Never substitute
            # a following open or pretend that Windows mode bits prove ACLs.
            if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "getuid"):
                fail()
            path = Path(sys.argv[2])
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_INPUT:
                    fail()
                body = handle.read(MAX_INPUT + 1)
                if len(body) > MAX_INPUT:
                    fail()
            records = [line[len(PREFIX):] for line in body.decode("utf-8").splitlines() if line.startswith(PREFIX)]
            if not 1 <= len(records) <= 2:
                fail()
            files = inventory(root)
            for record in records:
                print(PREFIX + json.dumps(validate(json.loads(record), files), separators=(",", ":")))
        elif len(sys.argv) == 2 and sys.argv[1] == "--run-linux":
            if not hasattr(os, "memfd_create"):
                fail()
            raw = sys.stdin.buffer.read(MAX_INPUT + 1)
            if len(raw) > MAX_INPUT:
                fail()
            data = json.loads(raw)
            if not isinstance(data, dict) or set(data) != {"files"} or not isinstance(data["files"], list):
                fail()
            files = inventory(root)
            if not data["files"] or any(not isinstance(p, str) or p not in files for p in data["files"]):
                fail()
            fd = os.memfd_create("nightly-unit-report", os.MFD_CLOEXEC)
            try:
                result = subprocess.run(
                    ["bun", "test", *data["files"], "--timeout", "30000", "--reporter", "junit",
                     "--reporter-outfile", f"/proc/self/fd/{fd}"],
                    cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    pass_fds=(fd,), check=False,
                )
                if os.fstat(fd).st_size > MAX_INPUT:
                    fail()
                os.lseek(fd, 0, os.SEEK_SET)
                report = os.read(fd, MAX_INPUT + 1).decode("utf-8")
                payload = derive({"xml": report, "files": data["files"], "exit_code": result.returncode}, root)
                print(json.dumps(payload, separators=(",", ":")))
                return result.returncode if result.returncode >= 0 else 1
            finally:
                os.close(fd)
        elif len(sys.argv) == 1:
            raw = sys.stdin.buffer.read(MAX_INPUT + 1)
            if len(raw) > MAX_INPUT:
                fail()
            print(json.dumps(derive(json.loads(raw), root), separators=(",", ":")))
        else:
            fail()
    except (ValueError, TypeError, KeyError, OSError, ET.ParseError):
        print("unit_diagnostic_unavailable", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
