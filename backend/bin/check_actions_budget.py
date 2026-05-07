#!/usr/bin/env python3
"""Write a non-blocking GitHub Actions budget posture ledger.

The ledger is observational: it estimates private-equivalent minutes from recent
run wall-clock durations, highlights manual reruns/backfill bursts, and exits
non-zero only when explicitly requested.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

DEFAULT_WORKFLOWS = ["daily-crawler.yml", "gdrive-frame-backfill.yml"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def parse_time(value: object) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def estimate_minutes(created_at: object, updated_at: object) -> float:
    created = parse_time(created_at)
    updated = parse_time(updated_at)
    if not created or not updated or updated < created:
        return 0.0
    return max(0.0, (updated - created).total_seconds() / 60.0)


def summarize_runs(workflow: str, runs: Iterable[dict]) -> dict:
    run_items = list(runs)
    total_minutes = sum(estimate_minutes(run.get("created_at"), run.get("updated_at")) for run in run_items)
    manual_runs = [run for run in run_items if run.get("event") == "workflow_dispatch"]
    reruns = [run for run in run_items if int(run.get("run_attempt") or 1) > 1]
    failed_runs = [run for run in run_items if run.get("conclusion") not in (None, "success", "skipped")]
    return {
        "workflow": workflow,
        "runCount": len(run_items),
        "estimatedMinutes": round(total_minutes, 2),
        "manualRunCount": len(manual_runs),
        "rerunAttemptCount": len(reruns),
        "failedRunCount": len(failed_runs),
        "latestRuns": [
            {
                "id": run.get("id"),
                "event": run.get("event"),
                "status": run.get("status"),
                "conclusion": run.get("conclusion"),
                "runAttempt": run.get("run_attempt"),
                "createdAt": run.get("created_at"),
                "updatedAt": run.get("updated_at"),
                "url": run.get("html_url"),
            }
            for run in run_items[:5]
        ],
    }


def build_offline_report(args: argparse.Namespace, reason: str) -> dict:
    return build_report(args, workflow_summaries=[], repository_private=None, detail=reason)


def build_report(
    args: argparse.Namespace,
    workflow_summaries: List[dict],
    repository_private: Optional[bool],
    detail: Optional[str] = None,
) -> dict:
    total_minutes = sum(float(item.get("estimatedMinutes") or 0) for item in workflow_summaries)
    monthly_projection = total_minutes * (30.0 / max(1, args.lookback_days))
    usage_ratio = monthly_projection / max(1, args.budget_minutes)
    soft_gate = "ok"
    if usage_ratio >= 0.90:
        soft_gate = "critical"
    elif usage_ratio >= 0.80:
        soft_gate = "high"
    elif usage_ratio >= 0.75:
        soft_gate = "watch"

    manual_run_count = sum(int(item.get("manualRunCount") or 0) for item in workflow_summaries)
    rerun_attempt_count = sum(int(item.get("rerunAttemptCount") or 0) for item in workflow_summaries)
    backfill_minutes = sum(
        float(item.get("estimatedMinutes") or 0)
        for item in workflow_summaries
        if "backfill" in str(item.get("workflow") or "")
    )

    status = "unknown" if detail and not workflow_summaries else soft_gate
    return {
        "schemaVersion": 1,
        "checkedAt": args.checked_at or utc_now().isoformat().replace("+00:00", "Z"),
        "repository": args.repository,
        "repositoryVisibility": "private" if repository_private is True else "public" if repository_private is False else "unknown",
        "lookbackDays": args.lookback_days,
        "budgetMinutes": args.budget_minutes,
        "estimatedLookbackMinutes": round(total_minutes, 2),
        "estimatedMonthlyPrivateEquivalentMinutes": round(monthly_projection, 2),
        "usageRatio": round(usage_ratio, 4),
        "softGate": soft_gate,
        "status": status,
        "manualRunCount": manual_run_count,
        "rerunAttemptCount": rerun_attempt_count,
        "backfillEstimatedMinutes": round(backfill_minutes, 2),
        "workflows": workflow_summaries,
        **({"detail": detail} if detail else {}),
    }


def github_get_json(url: str, token: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "tzudong-actions-budget-check",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_workflow_runs(repository: str, workflow: str, token: str, created_after: datetime) -> List[dict]:
    encoded_repo = urllib.parse.quote(repository, safe="/")
    encoded_workflow = urllib.parse.quote(workflow, safe="")
    created_filter = urllib.parse.quote(f">={created_after.isoformat().replace('+00:00', 'Z')}")
    url = f"https://api.github.com/repos/{encoded_repo}/actions/workflows/{encoded_workflow}/runs?per_page=100&created={created_filter}"
    payload = github_get_json(url, token)
    runs = payload.get("workflow_runs")
    return runs if isinstance(runs, list) else []


def fetch_repository_private(repository: str, token: str) -> Optional[bool]:
    encoded_repo = urllib.parse.quote(repository, safe="/")
    payload = github_get_json(f"https://api.github.com/repos/{encoded_repo}", token)
    value = payload.get("private")
    return value if isinstance(value, bool) else None


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Write GitHub Actions budget posture ledger")
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--workflow", action="append", dest="workflows", default=[])
    parser.add_argument("--lookback-days", type=int, default=30)
    parser.add_argument("--budget-minutes", type=int, default=3000)
    parser.add_argument("--output", default="")
    parser.add_argument("--checked-at", default="")
    parser.add_argument("--fail-on-soft-gate", choices=["watch", "high", "critical"], default="")
    args = parser.parse_args(argv)
    args.workflows = args.workflows or list(DEFAULT_WORKFLOWS)

    token = os.environ.get("GITHUB_TOKEN", "")
    if not args.repository or not token:
        report = build_offline_report(args, "repository_or_token_missing")
    else:
        created_after = utc_now() - timedelta(days=max(1, args.lookback_days))
        try:
            repository_private = fetch_repository_private(args.repository, token)
            summaries = [
                summarize_runs(workflow, fetch_workflow_runs(args.repository, workflow, token, created_after))
                for workflow in args.workflows
            ]
            report = build_report(args, summaries, repository_private)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            report = build_offline_report(args, f"github_api_unavailable:{type(exc).__name__}")

    if args.output:
        write_json(Path(args.output), report)
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))

    gate_order = {"": 99, "watch": 1, "high": 2, "critical": 3}
    current = gate_order.get(str(report.get("softGate")), 0)
    threshold = gate_order.get(args.fail_on_soft_gate, 99)
    return 1 if current >= threshold else 0


if __name__ == "__main__":
    raise SystemExit(main())
