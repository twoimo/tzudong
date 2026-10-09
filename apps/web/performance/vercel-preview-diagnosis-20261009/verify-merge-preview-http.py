#!/usr/bin/env python3
"""Verify every expected merge-preview route with the existing Vercel CLI auth.

Raw response bodies, headers, credentials, and cookies stay in memory. Exit zero
is reserved for a complete, all-passing route matrix.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
WEB_ROOT = HERE.parents[1]
DEFAULT_OUTPUT = HERE / "merge-preview-http-routes.json"
MATRIX_PATH = WEB_ROOT / "performance/public-cms-followthrough-20261009/accepted-route-matrix.json"
ORIGIN = "https://tzudong-76i12vmwe-twoimos-projects.vercel.app"
PROJECT_ID = "prj_sau35J5uUtShIQ9OKofRtOVVnTSl"
TEAM_ID = "team_OUj64KeLxJI3PkEbOaFZnorA"
DEPLOYMENT_ID = "dpl_He2HgNHEkNsdbQg556dGJsreTEgr"
GIT_SHA = "614b249175c35636a7062bf05cb01ebad538b10d"
ADMIN_PATHS = [
    "/api/admin/knowledge-graph",
    "/api/admin/users",
    "/api/admin/pipeline",
    "/api/admin/restaurant-refresh-history",
]
PUBLIC_ACCEPTABLE_STATUSES = frozenset({200, 301, 302, 303, 307, 308})
ADMIN_ACCEPTABLE_STATUSES = frozenset({401, 403})
ADMIN_ERROR_CODES = frozenset({"Unauthorized", "Forbidden", "UNAUTHORIZED", "FORBIDDEN"})


def route_paths():
    matrix = json.loads(MATRIX_PATH.read_text())
    public_paths = [
        row["routePattern"]
        .replace("[code]", "invalid-public-cms-check")
        .replace("[userId]", "public-cms-check-not-real")
        for row in matrix
    ]
    public_paths.append("/admin")
    return public_paths, list(ADMIN_PATHS)


def fixed_failure(code, *, checks=None):
    return {"status": "rejected", "code": code, "checks": checks or {}}


def evaluate_records(records, public_paths, admin_paths):
    expected_paths = list(public_paths) + list(admin_paths)
    if not all(isinstance(record, dict) for record in records):
        return fixed_failure("RECORD_SET_INCOMPLETE", checks={
            "expectedRecordCount": len(expected_paths),
            "observedRecordCount": len(records),
            "completeExpectedPathSequence": False,
        })
    observed_paths = [record.get("path") for record in records]
    complete = len(records) == len(expected_paths) and observed_paths == expected_paths
    cli_exit_zero = complete and all(record.get("cliExit") == 0 for record in records)
    public = records[:len(public_paths)] if complete else []
    admin = records[len(public_paths):] if complete else []
    public_statuses = complete and all(record.get("httpStatus") in PUBLIC_ACCEPTABLE_STATUSES for record in public)
    protection_absent = complete and all(record.get("platformProtectionPage") is False for record in public)
    admin_statuses = complete and all(record.get("httpStatus") in ADMIN_ACCEPTABLE_STATUSES for record in admin)
    admin_codes = complete and all(record.get("boundedErrorCode") in ADMIN_ERROR_CODES for record in admin)
    checks = {
        "expectedRecordCount": len(expected_paths),
        "observedRecordCount": len(records),
        "completeExpectedPathSequence": complete,
        "allCliExitZero": cli_exit_zero,
        "allPublicStatusesAcceptable": public_statuses,
        "allPublicPlatformProtectionAbsent": protection_absent,
        "allAnonymousAdminStatuses401Or403": admin_statuses,
        "allAnonymousAdminCodesBounded": admin_codes,
    }
    if not complete:
        return fixed_failure("RECORD_SET_INCOMPLETE", checks=checks)
    if not cli_exit_zero:
        return fixed_failure("CLI_EXIT_NONZERO", checks=checks)
    if not public_statuses:
        return fixed_failure("PUBLIC_STATUS_UNACCEPTABLE", checks=checks)
    if not protection_absent:
        return fixed_failure("PLATFORM_PROTECTION_PAGE", checks=checks)
    if not admin_statuses:
        return fixed_failure("ADMIN_ANONYMOUS_STATUS_INVALID", checks=checks)
    if not admin_codes:
        return fixed_failure("ADMIN_ERROR_CODE_UNBOUNDED", checks=checks)
    return {"status": "passed", "code": None, "checks": checks}


def parse_response(path, response):
    raw = (response.stdout or "").replace("\r\n", "\n")
    matches = list(re.finditer(r"(?m)^HTTP/\S+ (\d+)[^\n]*\n", raw))
    status = int(matches[-1].group(1)) if matches else None
    headers = {}
    body = ""
    if matches:
        start = matches[-1].start()
        end = raw.find("\n\n", start)
        if end >= 0:
            head = raw[start:end]
            body = raw[end + 2:]
            for line in head.splitlines()[1:]:
                if ":" in line:
                    key, value = line.split(":", 1)
                    headers[key.lower()] = value.strip()
    try:
        location_path = urlsplit(headers["location"]).path if "location" in headers else None
    except ValueError:
        location_path = None
    record = {
        "path": path,
        "method": "GET",
        "cliExit": response.returncode,
        "httpStatus": status,
        "contentType": headers.get("content-type"),
        "cacheControl": headers.get("cache-control"),
        "vercelErrorCode": headers.get("x-vercel-error"),
        "bodyBytes": len(body.encode()),
        "platformProtectionPage": bool(re.search(r"Authentication Required|Vercel Authentication|Log in to Vercel", body)),
        "locationPath": location_path,
    }
    if path in ADMIN_PATHS:
        code = None
        try:
            value = json.loads(body)
            if isinstance(value, dict):
                code = value.get("code") or value.get("error")
        except (UnicodeError, ValueError, TypeError):
            pass
        record["boundedErrorCode"] = code if code in ADMIN_ERROR_CODES else "unclassified"
    return record


def failed_record(path, code):
    record = {
        "path": path,
        "method": "GET",
        "cliExit": None,
        "httpStatus": None,
        "contentType": None,
        "cacheControl": None,
        "vercelErrorCode": None,
        "bodyBytes": 0,
        "platformProtectionPage": False,
        "locationPath": None,
        "clientFailureCode": code,
    }
    if path in ADMIN_PATHS:
        record["boundedErrorCode"] = "unclassified"
    return record


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


def base_report(records):
    return {
        "deploymentId": DEPLOYMENT_ID,
        "gitSha": GIT_SHA,
        "origin": ORIGIN,
        "officialClient": "vercel curl fullURL",
        "existingCredentialOnly": True,
        "newTokensSettingsOrDeploymentWrites": 0,
        "cookiesRawHeadersBodiesOrKeysExported": False,
        "operatingMutationRequests": 0,
        "records": records,
    }


def evaluate_fixture(path, output):
    try:
        fixture = json.loads(path.read_text())
        public_paths = fixture["publicPaths"]
        admin_paths = fixture["adminPaths"]
        records = fixture["records"]
        if not all(isinstance(value, list) for value in (public_paths, admin_paths, records)):
            raise ValueError
        verification = evaluate_records(records, public_paths, admin_paths)
    except (OSError, UnicodeError, ValueError, TypeError, KeyError):
        records = []
        verification = fixed_failure("FIXTURE_INVALID")
    report = {**base_report(records), "fixtureOnly": True, "verification": verification}
    write_report(output, report)
    print(json.dumps(verification, sort_keys=True, separators=(",", ":")))
    return 0 if verification["status"] == "passed" else 1


def live_verify(output):
    records = []
    try:
        public_paths, admin_paths = route_paths()
    except (OSError, UnicodeError, ValueError, TypeError, KeyError):
        verification = fixed_failure("ROUTE_MATRIX_INVALID")
        write_report(output, {**base_report(records), "verification": verification})
        print(json.dumps(verification, sort_keys=True, separators=(",", ":")))
        return 1
    try:
        api = subprocess.run(
            ["vercel", "api", f"/v9/projects/{PROJECT_ID}?teamId={TEAM_ID}", "--method", "GET", "--non-interactive"],
            capture_output=True,
            text=True,
            timeout=40,
        )
    except (OSError, subprocess.TimeoutExpired):
        verification = fixed_failure("PROJECT_CLI_FAILED")
        write_report(output, {**base_report(records), "verification": verification})
        print(json.dumps(verification, sort_keys=True, separators=(",", ":")))
        return 1
    if api.returncode != 0:
        verification = fixed_failure("PROJECT_CLI_FAILED")
        write_report(output, {**base_report(records), "verification": verification})
        print(json.dumps(verification, sort_keys=True, separators=(",", ":")))
        return 1
    try:
        project = json.loads(api.stdout)
        if project.get("id") != PROJECT_ID or project.get("accountId") != TEAM_ID:
            raise ValueError
        existing = [
            key for key, scope in (project.get("protectionBypass") or {}).items()
            if isinstance(scope, dict) and scope.get("scope") == "automation-bypass"
        ]
        if not existing:
            raise KeyError
    except (AttributeError, UnicodeError, ValueError, TypeError):
        verification = fixed_failure("PROJECT_IDENTITY_INVALID")
        write_report(output, {**base_report(records), "verification": verification})
        print(json.dumps(verification, sort_keys=True, separators=(",", ":")))
        return 1
    except KeyError:
        verification = fixed_failure("AUTOMATION_BYPASS_UNAVAILABLE")
        write_report(output, {**base_report(records), "verification": verification})
        print(json.dumps(verification, sort_keys=True, separators=(",", ":")))
        return 1

    env = dict(os.environ, VERCEL_AUTOMATION_BYPASS_SECRET=existing[0])
    for path in public_paths + admin_paths:
        try:
            response = subprocess.run(
                ["vercel", "curl", ORIGIN + path, "--", "--silent", "--show-error", "--max-time", "30", "--request", "GET", "--dump-header", "-"],
                env=env,
                capture_output=True,
                text=True,
                timeout=45,
            )
            try:
                records.append(parse_response(path, response))
            except (AttributeError, UnicodeError, ValueError, TypeError):
                records.append(failed_record(path, "RESPONSE_PARSE_FAILED"))
        except subprocess.TimeoutExpired:
            records.append(failed_record(path, "CLI_TIMEOUT"))
        except OSError:
            records.append(failed_record(path, "CLI_UNAVAILABLE"))
    verification = evaluate_records(records, public_paths, admin_paths)
    report = {**base_report(records), "verification": verification}
    write_report(output, report)
    print(json.dumps(verification, sort_keys=True, separators=(",", ":")))
    return 0 if verification["status"] == "passed" else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evaluate-fixture", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    if args.evaluate_fixture is not None:
        return evaluate_fixture(args.evaluate_fixture, args.output)
    return live_verify(args.output)


if __name__ == "__main__":
    raise SystemExit(main())
