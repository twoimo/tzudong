#!/usr/bin/env python3
"""Audit the completed crawler-orchestration spec and optionally run its tests."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.pipeline_control.readiness import (  # noqa: E402
    REPORT_STATUS_READY,
    audit_and_maybe_test,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fail-closed readiness audit for the crawler pipeline orchestration spec"
        )
    )
    parser.add_argument(
        "--run-tests",
        action="store_true",
        help="run the focused 22-module verification suite after static preflight",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=180,
        help="bounded timeout for the focused suite (default: 180)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="print only the machine-readable bounded report",
    )
    args = parser.parse_args(argv)
    if args.timeout_seconds < 1 or args.timeout_seconds > 1800:
        parser.error("--timeout-seconds must be between 1 and 1800")

    report = audit_and_maybe_test(
        REPO_ROOT,
        run_tests=args.run_tests,
        timeout_seconds=args.timeout_seconds,
    )
    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        execution = report["testPlan"]["execution"]
        print(
            "crawler-orchestration-readiness "
            f"status={report['status']} "
            f"tasks={report['spec']['completedCount']}/{report['spec']['totalCount']} "
            f"traceability={report['traceability']['mappedTaskCount']}/"
            f"{report['traceability']['taskCount']} "
            f"artifacts={report['artifacts']['presentCount']}/"
            f"{report['artifacts']['requiredCount']} "
            f"tests={execution['status']}"
        )
        if report["blockerCodes"]:
            print("blocker codes: " + ", ".join(report["blockerCodes"]))
        if report["dependencies"]["missing"]:
            print(
                "missing test dependencies: "
                + ", ".join(report["dependencies"]["missing"])
            )

    return 0 if report["status"] == REPORT_STATUS_READY else 1


if __name__ == "__main__":
    raise SystemExit(main())
