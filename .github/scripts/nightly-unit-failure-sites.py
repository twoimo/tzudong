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
GAP_PREFIX = "NIGHTLY_UNIT_DIAGNOSTIC_GAP="
GAP_SCHEMA = "nightly-unit-diagnostic-gap-v1"
GAP_STAGES = {"memfd", "input", "input_size", "files", "spawn", "junit_size", "junit_read", "derive"}
GAP_FIELDS = {"schema", "stage", "xml_bytes", "exit_code", "signal"}
GAP_V2_SCHEMA = "nightly-unit-diagnostic-gap-v2"
GAP_V2_FIELDS = {"schema", "stage", "reason", "xml_bytes", "exit_code", "signal"}
DERIVE_REASONS = frozenset({
    "bad_input_shape", "bad_file_entry", "unknown_file", "duplicate_file",
    "empty_admitted", "doctype_or_entity", "xml_parse", "root_tag",
    "unadmitted_case_file", "max_tests", "multi_outcome", "bad_line",
    "line_range", "no_tests", "tests_mismatch", "failures_mismatch",
    "skipped_mismatch", "exit_code_type", "exit_failure_mismatch",
})


class DeriveRejected(ValueError):
    """Typed derive-stage rejection; subclasses ValueError so existing catch sites are unchanged."""

    def __init__(self, reason: str) -> None:
        if reason not in DERIVE_REASONS:
            raise ValueError("unknown derive reason")
        super().__init__(reason)
        self.reason = reason


def reject(reason: str) -> None:
    raise DeriveRejected(reason)


def fail() -> None:
    raise ValueError("unit_diagnostic_rejected")


def gap_record(stage: str, xml_bytes: int, exit_code: int | None, signal: int | None) -> str:
    return json.dumps({"schema": GAP_SCHEMA, "stage": stage, "xml_bytes": xml_bytes,
                       "exit_code": exit_code, "signal": signal}, separators=(",", ":"))


def gap_record_v2(reason: str, xml_bytes: int, exit_code: int | None, signal: int | None) -> str:
    return json.dumps({"schema": GAP_V2_SCHEMA, "stage": "derive", "reason": reason,
                       "xml_bytes": xml_bytes, "exit_code": exit_code, "signal": signal},
                      separators=(",", ":"))


def validate_gap(payload: object) -> dict:
    if not isinstance(payload, dict):
        fail()
    if set(payload) == GAP_FIELDS and payload["schema"] == GAP_SCHEMA:
        if payload["stage"] not in GAP_STAGES:
            fail()
    elif set(payload) == GAP_V2_FIELDS and payload["schema"] == GAP_V2_SCHEMA:
        if payload["stage"] != "derive" or payload["reason"] not in DERIVE_REASONS:
            fail()
    else:
        fail()
    if not count(payload["xml_bytes"], MAX_INPUT):
        fail()
    code = payload["exit_code"]
    sig = payload["signal"]
    if not (code is None or (type(code) is int and -127 <= code <= 255)):
        fail()
    if not (sig is None or (type(sig) is int and 1 <= sig <= 64)):
        fail()
    if (type(code) is int and code < 0) != (type(sig) is int):
        fail()
    if type(sig) is int and sig != -code:
        fail()
    return payload


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
        reject("bad_input_shape")
    available = inventory(root)
    admitted = {}
    for file in data["files"]:
        if not isinstance(file, str):
            reject("bad_file_entry")
        if file not in available:
            reject("unknown_file")
        if file in admitted:
            reject("duplicate_file")
        admitted[file] = available[file]
    if not admitted:
        reject("empty_admitted")
    if "<!DOCTYPE" in data["xml"] or "<!ENTITY" in data["xml"]:
        reject("doctype_or_entity")
    try:
        report = ET.fromstring(data["xml"])
    except ET.ParseError:
        reject("xml_parse")
    if report.tag != "testsuites":
        reject("root_tag")
    sites, next_index = [], {}
    total = skipped = failed = 0
    for case in report.iter("testcase"):
        raw_file = case.get("file", "").replace("\\", "/")
        file = raw_file
        if raw_file.startswith(str(root) + "/"):
            file = raw_file[len(str(root)) + 1:]
        if file not in admitted:
            reject("unadmitted_case_file")
        index = next_index.get(file, 0)
        next_index[file] = index + 1
        total += 1
        if total > MAX_TESTS:
            reject("max_tests")
        outcomes = [child.tag for child in case if child.tag in {"failure", "error", "skipped"}]
        if len(outcomes) > 1:
            reject("multi_outcome")
        if outcomes == ["skipped"]:
            skipped += 1
        elif outcomes:
            failed += 1
            line = case.get("line", "")
            if not line.isascii() or not line.isdigit():
                reject("bad_line")
            if not 1 <= int(line) <= admitted[file]:
                reject("line_range")
            sites.append({"file": file, "test_index": index, "line": int(line), "kind": outcomes[0]})
    if not total:
        reject("no_tests")
    if int(report.get("tests", "-1")) != total:
        reject("tests_mismatch")
    if int(report.get("failures", "-1")) != failed:
        reject("failures_mismatch")
    if int(report.get("skipped", "-1")) != skipped:
        reject("skipped_mismatch")
    payload = validate({"schema": "nightly-unit-failure-sites-v2", "test_count": total,
                     "failure_count": failed, "skip_count": skipped, "sites": sites[:MAX_SITES],
                     "omitted_site_count": max(0, failed - MAX_SITES)}, admitted)
    if "exit_code" in data:
        code = data["exit_code"]
        if type(code) is not int or not -127 <= code <= 255:
            reject("exit_code_type")
        if (code == 0) != (failed == 0):
            reject("exit_failure_mismatch")
    return payload


def main() -> int:
    root = Path(__file__).resolve().parents[2] / "apps/web"
    try:
        gaps: list = []
        if len(sys.argv) in {3, 5} and sys.argv[1] == "--log":
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
            gaps = [validate_gap(json.loads(line[len(GAP_PREFIX):]))
                    for line in body.decode("utf-8").splitlines() if line.startswith(GAP_PREFIX)]
            if len(gaps) > 2:
                fail()
            files = inventory(root)
            # The runner emits one record for the general batch, then one record
            # per isolated file, stopping at the first failing isolated file.
            # Admit that real stream: at most one general record plus one record
            # per inventoried test file. The 32MiB body cap bounds every line.
            if not 1 <= len(records) <= 1 + len(files):
                fail()
            payloads = [validate(json.loads(record), files) for record in records]
            # Legacy single records pass through; mixed legacy streams cannot be
            # aggregated safely.
            if any(payload["schema"] == "nightly-unit-failure-sites-v1" for payload in payloads) and len(payloads) != 1:
                fail()
            # General failure stops the runner; isolated files run only after
            # general success, and the runner exits at the first failing
            # isolated file, so a failing record can only be the last one.
            # A partial success cannot describe a full run.
            if len(payloads) == 1 and payloads[0]["failure_count"] == 0:
                fail()
            if payloads[0]["failure_count"] != 0 and len(payloads) != 1:
                fail()
            if any(payload["failure_count"] != 0 for payload in payloads[1:-1]):
                fail()
            if len(sys.argv) == 5:
                code = sys.argv[4]
                if sys.argv[3] != "--exit-code" or not code.isascii() or not code.isdigit() or not 0 <= int(code) <= 255:
                    fail()
                complete_success = all(p["failure_count"] == 0 for p in payloads)
                if (int(code) == 0) != complete_success:
                    fail()
            if len(payloads) == 1:
                aggregate = payloads[0]
            else:
                failures = sum(p["failure_count"] for p in payloads)
                # Keep the public single-line shape: one aggregate v2 record.
                aggregate = validate({
                    "schema": "nightly-unit-failure-sites-v2",
                    "test_count": sum(p["test_count"] for p in payloads),
                    "failure_count": failures,
                    "skip_count": sum(p["skip_count"] for p in payloads),
                    "sites": [site for p in payloads for site in p["sites"]][:MAX_SITES],
                    "omitted_site_count": failures - min(failures, MAX_SITES),
                }, files)
            print(PREFIX + json.dumps(aggregate, separators=(",", ":")))
        elif len(sys.argv) == 2 and sys.argv[1] == "--run-linux":
            if not hasattr(os, "memfd_create"):
                fail()
            # On rejection, emit one bounded gap record (stage and counters
            # only - never log content) so a killed or non-emitting runner no
            # longer collapses into an unexplained unavailable diagnostic.
            stage = "input"
            xml_bytes = 0
            code: int | None = None
            try:
                raw = sys.stdin.buffer.read(MAX_INPUT + 1)
                if len(raw) > MAX_INPUT:
                    stage = "input_size"
                    fail()
                data = json.loads(raw)
                if not isinstance(data, dict) or set(data) != {"files"} or not isinstance(data["files"], list):
                    fail()
                stage = "files"
                files = inventory(root)
                if not data["files"] or any(not isinstance(p, str) or p not in files for p in data["files"]):
                    fail()
                stage = "memfd"
                fd = os.memfd_create("nightly-unit-report", os.MFD_CLOEXEC)
                try:
                    stage = "spawn"
                    result = subprocess.run(
                        ["bun", "test", *data["files"], "--timeout", "30000", "--reporter", "junit",
                         "--reporter-outfile", f"/proc/self/fd/{fd}"],
                        cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        pass_fds=(fd,), check=False,
                    )
                    code = result.returncode
                    stage = "junit_size"
                    if os.fstat(fd).st_size > MAX_INPUT:
                        fail()
                    os.lseek(fd, 0, os.SEEK_SET)
                    stage = "junit_read"
                    report = os.read(fd, MAX_INPUT + 1).decode("utf-8")
                    xml_bytes = len(report.encode("utf-8"))
                    stage = "derive"
                    payload = derive({"xml": report, "files": data["files"], "exit_code": code}, root)
                    print(json.dumps(payload, separators=(",", ":")))
                    return code if code >= 0 else 1
                finally:
                    os.close(fd)
            except DeriveRejected as rejected:
                print(GAP_PREFIX + gap_record_v2(rejected.reason, xml_bytes, code,
                                                 -code if type(code) is int and code < 0 else None))
                return 1
            except (ValueError, TypeError, KeyError, OSError, ET.ParseError):
                print(GAP_PREFIX + gap_record(stage, xml_bytes, code,
                                              -code if type(code) is int and code < 0 else None))
                return 1
        elif len(sys.argv) == 1:
            raw = sys.stdin.buffer.read(MAX_INPUT + 1)
            if len(raw) > MAX_INPUT:
                fail()
            data = json.loads(raw)
            try:
                print(json.dumps(derive(data, root), separators=(",", ":")))
            except DeriveRejected as rejected:
                xml = data.get("xml") if isinstance(data, dict) else None
                code = data.get("exit_code") if isinstance(data, dict) else None
                print(GAP_PREFIX + gap_record_v2(
                    rejected.reason,
                    len(xml.encode("utf-8")) if isinstance(xml, str) else 0,
                    code if type(code) is int and -127 <= code <= 255 else None,
                    -code if type(code) is int and -127 <= code < 0 else None))
                return 1
        else:
            fail()
    except (ValueError, TypeError, KeyError, OSError, ET.ParseError):
        # The validation bound above also bounds emission: never re-emit
        # more records than a well-formed runner log may carry.
        for gap in gaps[:2]:
            print(GAP_PREFIX + json.dumps(gap, separators=(",", ":")))
        print("unit_diagnostic_unavailable", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
