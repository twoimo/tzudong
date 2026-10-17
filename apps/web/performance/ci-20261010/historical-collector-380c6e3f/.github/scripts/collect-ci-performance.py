#!/usr/bin/env python3
"""Collect and score sanitized GitHub Actions CI timing metadata.

The online path reads only workflow-run and job/step metadata through ``gh api``.
The replay path performs no network access and deterministically regenerates the
analysis from the retained sanitized observations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence
from urllib.parse import quote


SCHEMA_VERSION = "tzudong-ci-performance/v1"
DEFAULT_REPOSITORY = "twoimo/tzudong"
DEFAULT_WORKFLOW = "web-admin-ci.yml"
DEFAULT_LIMIT = 10
DEFAULT_BOOTSTRAP_RESAMPLES = 10_000
DEFAULT_BOOTSTRAP_SEED = 20_261_010
MIN_SUCCESSFUL_RUNS = 7
MAX_RUNS = 10
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "apps/web/performance/ci-20261010"

RAW_SUCCESS_FILE = "successful-runs.json"
EXCLUDED_FILE = "excluded-observations.json"
COLLECTION_FILE = "collection.json"
SUMMARY_FILE = "summary.json"
REPORT_FILE = "report.md"
ARTIFACT_MAP_FILE = "artifact-map.json"
ARTIFACT_MAP_HASH_FILE = "artifact-map.json.sha256"

SECRET_ASSIGNMENT = re.compile(
    r"(?i)(\b[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|USERNAME|USER)[A-Z0-9_]*=)"
    r"(?:\"[^\"]*\"|'[^']*'|[^\s]+)"
)
SECRET_QUERY = re.compile(
    r"(?i)([?&](?:access_token|token|api_key|key|signature)=)[^&\s]+"
)

SETUP_STEP = re.compile(
    r"Initialize containers|^Run actions/checkout@|^Run actions/setup-node@|"
    r"^Run oven-sh/setup-bun@|^Pin npm authority$|"
    r"^Pin authoritative Node and npm$|^Create independent clean workspaces$",
    re.IGNORECASE,
)
INSTALL_STEP = re.compile(
    r"^Run npm ci$|^Run bun install|^Install backend dependencies|"
    r"^Supplemental Bun clean install",
    re.IGNORECASE,
)
COMBINED_STEP = re.compile(
    r"^Authoritative npm clean install", re.IGNORECASE
)
BENCHMARK_STEP = re.compile(
    r"typecheck:benchmark|^Run tree=|^Run \$root = Join-Path",
    re.IGNORECASE,
)
LINT_STEP = re.compile(r"npm run lint|npx eslint", re.IGNORECASE)
TEST_STEP = re.compile(
    r"test:unit|^Run bun test|node --test|TZUYANG_LEDGER_CI_FIXTURE",
    re.IGNORECASE,
)
TYPECHECK_STEP = re.compile(r"typecheck|tsc --noEmit", re.IGNORECASE)
BUILD_STEP = re.compile(r"^Run npm run build$", re.IGNORECASE)
UPLOAD_STEP = re.compile(r"^Upload", re.IGNORECASE)

STAGE_NAMES = (
    "setup",
    "install",
    "combined_install_build_browser_test",
    "typecheck",
    "benchmark_report",
    "lint",
    "test",
    "build",
    "upload",
    "other",
)


class CollectionError(RuntimeError):
    """Raised when collection or validation cannot produce a complete baseline."""


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.write_bytes(canonical_json(value))


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise CollectionError(f"timestamp lacks timezone: {value!r}")
    return parsed.astimezone(timezone.utc)


def seconds_between(start: str | None, end: str | None) -> int | None:
    start_time = parse_timestamp(start)
    end_time = parse_timestamp(end)
    if start_time is None or end_time is None:
        return None
    seconds = int((end_time - start_time).total_seconds())
    if seconds < 0:
        raise CollectionError(f"negative duration: {start!r} -> {end!r}")
    return seconds


def sanitize_step_name(name: Any) -> str:
    sanitized = str(name or "")
    sanitized = SECRET_ASSIGNMENT.sub(r"\1[REDACTED]", sanitized)
    sanitized = SECRET_QUERY.sub(r"\1[REDACTED]", sanitized)
    return sanitized


def gh_api(endpoint: str, fields: dict[str, str | int] | None = None) -> Any:
    command = ["gh", "api", "--method", "GET", endpoint]
    for key, value in sorted((fields or {}).items()):
        command.extend(["-f", f"{key}={value}"])

    for attempt in range(3):
        try:
            result = subprocess.run(
                command,
                cwd=REPO_ROOT,
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            result = None
        if result is None:
            if attempt < 2:
                time.sleep(2**attempt)
            continue
        if result.returncode == 0:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError as error:
                raise CollectionError(
                    f"GitHub API returned invalid JSON for {endpoint}"
                ) from error
        if attempt < 2:
            time.sleep(2**attempt)

    raise CollectionError(
        f"GitHub API read failed after 3 bounded attempts for {endpoint}"
    )


def sanitize_step(step: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": step.get("number"),
        "name": sanitize_step_name(step.get("name")),
        "status": step.get("status"),
        "conclusion": step.get("conclusion"),
        "startedAt": step.get("started_at"),
        "completedAt": step.get("completed_at"),
    }


def sanitize_job(job: dict[str, Any]) -> dict[str, Any]:
    steps = [sanitize_step(step) for step in job.get("steps") or []]
    steps.sort(key=lambda item: (item.get("number") or 0, item["name"]))
    return {
        "id": job.get("id"),
        "name": str(job.get("name") or ""),
        "status": job.get("status"),
        "conclusion": job.get("conclusion"),
        "createdAt": job.get("created_at"),
        "startedAt": job.get("started_at"),
        "completedAt": job.get("completed_at"),
        "runnerLabels": sorted(
            str(label) for label in (job.get("labels") or []) if label
        ),
        "steps": steps,
    }


def sanitize_run(run: dict[str, Any], jobs: Sequence[dict[str, Any]]) -> dict[str, Any]:
    sanitized_jobs = [sanitize_job(job) for job in jobs]
    sanitized_jobs.sort(key=lambda item: (item["name"], item.get("id") or 0))
    return {
        "id": run.get("id"),
        "attempt": run.get("run_attempt"),
        "event": run.get("event"),
        "status": run.get("status"),
        "conclusion": run.get("conclusion"),
        "headSha": run.get("head_sha"),
        "createdAt": run.get("created_at"),
        "startedAt": run.get("run_started_at"),
        "updatedAt": run.get("updated_at"),
        "jobs": sanitized_jobs,
    }


def exclusion_reasons(run: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if run.get("status") != "completed":
        reasons.append(f"run_status_{run.get('status') or 'missing'}")
    if run.get("conclusion") != "success":
        reasons.append(f"run_conclusion_{run.get('conclusion') or 'missing'}")
    if not run.get("jobs"):
        reasons.append("no_jobs")

    for job in run.get("jobs") or []:
        if job.get("status") != "completed":
            reasons.append("incomplete_job")
        if not job.get("startedAt") or not job.get("completedAt"):
            reasons.append("missing_job_timing")
    return sorted(set(reasons))


def is_censored(run: dict[str, Any]) -> bool:
    if run.get("status") != "completed":
        return True
    for job in run.get("jobs") or []:
        if (
            job.get("status") != "completed"
            or not job.get("startedAt")
            or not job.get("completedAt")
        ):
            return True
        for step in job.get("steps") or []:
            if step.get("status") != "completed" or not step.get("completedAt"):
                return True
    return run.get("conclusion") != "success"


def collect_online(
    repository: str,
    workflow: str,
    limit: int,
    captured_at: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    workflow_ref = quote(workflow, safe="")
    payload = gh_api(
        f"repos/{repository}/actions/workflows/{workflow_ref}/runs",
        {"per_page": limit},
    )
    source_runs = list(payload.get("workflow_runs") or [])[:limit]
    source_runs.sort(key=lambda item: (item.get("created_at") or "", item.get("id") or 0), reverse=True)

    sanitized_runs: list[dict[str, Any]] = []
    for run in source_runs:
        jobs_payload = gh_api(
            f"repos/{repository}/actions/runs/{run['id']}/jobs",
            {"per_page": 100},
        )
        sanitized_runs.append(sanitize_run(run, jobs_payload.get("jobs") or []))

    successful: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for run in sanitized_runs:
        reasons = exclusion_reasons(run)
        if not reasons:
            successful.append(run)
        else:
            excluded.append(
                {
                    "run": run,
                    "reasonCodes": reasons,
                    "censored": is_censored(run),
                }
            )

    if len(successful) < MIN_SUCCESSFUL_RUNS:
        raise CollectionError(
            f"only {len(successful)} successful complete runs found in the most recent "
            f"{len(source_runs)} runs; need at least {MIN_SUCCESSFUL_RUNS}"
        )

    collection = {
        "schema": f"{SCHEMA_VERSION}/collection",
        "capturedAtUtc": captured_at,
        "repository": repository,
        "workflow": workflow,
        "recentRunLimit": limit,
        "fetchedRunCount": len(sanitized_runs),
        "successfulRunCount": len(successful),
        "excludedRunCount": len(excluded),
        "orderedRunIds": [run["id"] for run in sanitized_runs],
        "apiDataScope": "workflow run plus job and step metadata only",
        "logsFetched": False,
        "actorsRetained": False,
        "runnerNamesRetained": False,
        "credentialValuesRetained": False,
    }
    successful_payload = {
        "schema": f"{SCHEMA_VERSION}/successful-runs",
        "runs": successful,
    }
    excluded_payload = {
        "schema": f"{SCHEMA_VERSION}/excluded-observations",
        "observations": excluded,
    }
    return collection, successful_payload, excluded_payload


def validate_replay_inputs(
    collection: dict[str, Any],
    successful_payload: dict[str, Any],
    excluded_payload: dict[str, Any],
) -> None:
    if collection.get("schema") != f"{SCHEMA_VERSION}/collection":
        raise CollectionError("unsupported collection schema")
    if successful_payload.get("schema") != f"{SCHEMA_VERSION}/successful-runs":
        raise CollectionError("unsupported successful-runs schema")
    if excluded_payload.get("schema") != f"{SCHEMA_VERSION}/excluded-observations":
        raise CollectionError("unsupported excluded-observations schema")
    runs = successful_payload.get("runs")
    if not isinstance(runs, list) or len(runs) < MIN_SUCCESSFUL_RUNS:
        raise CollectionError("replay input has fewer than seven successful runs")
    if len(runs) > MAX_RUNS:
        raise CollectionError("replay input exceeds the ten-run bound")
    for run in runs:
        reasons = exclusion_reasons(run)
        if reasons:
            raise CollectionError(
                f"successful run {run.get('id')} is incomplete: {', '.join(reasons)}"
            )


def resanitize_retained_steps(
    successful_payload: dict[str, Any],
    excluded_payload: dict[str, Any],
) -> None:
    runs = list(successful_payload.get("runs") or [])
    runs.extend(
        observation.get("run")
        for observation in excluded_payload.get("observations") or []
        if isinstance(observation.get("run"), dict)
    )
    for run in runs:
        for job in run.get("jobs") or []:
            for step in job.get("steps") or []:
                step["name"] = sanitize_step_name(step.get("name"))


def classify_step(name: str) -> str:
    if SETUP_STEP.search(name):
        return "setup"
    if INSTALL_STEP.search(name):
        return "install"
    if COMBINED_STEP.search(name):
        return "combined_install_build_browser_test"
    if BENCHMARK_STEP.search(name):
        return "benchmark_report"
    if LINT_STEP.search(name):
        return "lint"
    if TEST_STEP.search(name):
        return "test"
    if TYPECHECK_STEP.search(name):
        return "typecheck"
    if BUILD_STEP.search(name):
        return "build"
    if UPLOAD_STEP.search(name):
        return "upload"
    return "other"


def percentile(values: Sequence[float], fraction: float) -> float:
    if not values:
        raise CollectionError("cannot calculate percentile of empty input")
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def stable_seed(base_seed: int, label: str) -> int:
    digest = hashlib.sha256(f"{base_seed}:{label}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


class SplitMix64:
    """Small cross-Python deterministic generator for bootstrap indices."""

    MASK = (1 << 64) - 1

    def __init__(self, seed: int) -> None:
        self.state = seed & self.MASK

    def next_u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & self.MASK
        value = self.state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & self.MASK
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & self.MASK
        return value ^ (value >> 31)

    def index(self, upper_bound: int) -> int:
        if upper_bound < 1:
            raise CollectionError("bootstrap index requires a positive bound")
        return (self.next_u64() * upper_bound) >> 64


def bootstrap_interval(
    values: Sequence[float],
    statistic: Callable[[Sequence[float]], float],
    resamples: int,
    seed: int,
) -> list[float]:
    rng = SplitMix64(seed)
    sample_size = len(values)
    estimates: list[float] = []
    for _ in range(resamples):
        sample = [values[rng.index(sample_size)] for _ in range(sample_size)]
        estimates.append(float(statistic(sample)))
    return [percentile(estimates, 0.025), percentile(estimates, 0.975)]


def rounded(value: float) -> float:
    return round(float(value), 6)


def distribution(
    values: Sequence[float],
    label: str,
    resamples: int,
    seed: int,
) -> dict[str, Any]:
    numeric = [float(value) for value in values]
    if not numeric:
        raise CollectionError(f"empty distribution: {label}")
    mean_ci = bootstrap_interval(
        numeric,
        statistics.fmean,
        resamples,
        stable_seed(seed, f"{label}:mean"),
    )
    median_ci = bootstrap_interval(
        numeric,
        statistics.median,
        resamples,
        stable_seed(seed, f"{label}:median"),
    )
    return {
        "n": len(numeric),
        "min": rounded(min(numeric)),
        "p25": rounded(percentile(numeric, 0.25)),
        "median": rounded(statistics.median(numeric)),
        "p75": rounded(percentile(numeric, 0.75)),
        "max": rounded(max(numeric)),
        "mean": rounded(statistics.fmean(numeric)),
        "sampleStandardDeviation": rounded(statistics.stdev(numeric))
        if len(numeric) > 1
        else 0.0,
        "bootstrapMean95PercentileInterval": [rounded(value) for value in mean_ci],
        "bootstrapMedian95PercentileInterval": [
            rounded(value) for value in median_ci
        ],
    }


def analyze_job(job: dict[str, Any]) -> dict[str, Any]:
    queue_seconds = seconds_between(job.get("createdAt"), job.get("startedAt"))
    runtime_seconds = seconds_between(job.get("startedAt"), job.get("completedAt"))
    if queue_seconds is None or runtime_seconds is None:
        raise CollectionError(f"job {job.get('name')!r} lacks complete timing")

    stage_seconds = {stage: 0 for stage in STAGE_NAMES}
    for step in job.get("steps") or []:
        duration = seconds_between(step.get("startedAt"), step.get("completedAt"))
        if duration is None:
            continue
        stage_seconds[classify_step(step.get("name") or "")] += duration

    return {
        "name": job["name"],
        "queueSeconds": queue_seconds,
        "runnerOccupiedSeconds": runtime_seconds,
        "stageSeconds": stage_seconds,
    }


def analyze_run(run: dict[str, Any]) -> dict[str, Any]:
    analyzed_jobs = [analyze_job(job) for job in run["jobs"]]
    job_by_name = {job["name"]: job for job in run["jobs"]}
    latest_job = max(
        run["jobs"],
        key=lambda job: parse_timestamp(job.get("completedAt")) or datetime.min.replace(tzinfo=timezone.utc),
    )
    critical_path = seconds_between(run.get("createdAt"), latest_job.get("completedAt"))
    if critical_path is None:
        raise CollectionError(f"run {run.get('id')} lacks critical-path timing")

    total_runner = sum(job["runnerOccupiedSeconds"] for job in analyzed_jobs)
    total_queue = sum(job["queueSeconds"] for job in analyzed_jobs)
    benchmark_seconds = sum(
        job["stageSeconds"]["benchmark_report"] for job in analyzed_jobs
    )
    stage_totals = {
        stage: sum(job["stageSeconds"][stage] for job in analyzed_jobs)
        for stage in STAGE_NAMES
    }
    return {
        "runId": run["id"],
        "event": run.get("event"),
        "headSha": run.get("headSha"),
        "createdAt": run.get("createdAt"),
        "criticalJob": latest_job["name"],
        "criticalJobConclusion": job_by_name[latest_job["name"]].get("conclusion"),
        "criticalPathSeconds": critical_path,
        "runnerOccupiedSeconds": total_runner,
        "totalQueueSeconds": total_queue,
        "maxQueueSeconds": max(job["queueSeconds"] for job in analyzed_jobs),
        "benchmarkReportSeconds": benchmark_seconds,
        "benchmarkContributionPercent": rounded(
            100 * benchmark_seconds / total_runner if total_runner else 0
        ),
        "stageSeconds": stage_totals,
        "jobs": analyzed_jobs,
    }


def build_summary(
    collection: dict[str, Any],
    successful_payload: dict[str, Any],
    excluded_payload: dict[str, Any],
    resamples: int,
    seed: int,
) -> dict[str, Any]:
    observations = [analyze_run(run) for run in successful_payload["runs"]]
    observations.sort(key=lambda item: (item["createdAt"], item["runId"]), reverse=True)

    run_metric_units = {
        "criticalPathSeconds": "seconds",
        "runnerOccupiedSeconds": "seconds",
        "totalQueueSeconds": "seconds",
        "maxQueueSeconds": "seconds",
        "benchmarkReportSeconds": "seconds",
        "benchmarkContributionPercent": "percent",
    }
    run_distributions = {
        metric: {
            "unit": unit,
            **distribution(
                [observation[metric] for observation in observations],
                f"run:{metric}",
                resamples,
                seed,
            ),
        }
        for metric, unit in run_metric_units.items()
    }

    jobs_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        for job in observation["jobs"]:
            jobs_by_name[job["name"]].append(job)

    job_distributions: dict[str, Any] = {}
    for job_name in sorted(jobs_by_name):
        jobs = jobs_by_name[job_name]
        metrics: dict[str, list[float]] = {
            "queueSeconds": [job["queueSeconds"] for job in jobs],
            "runnerOccupiedSeconds": [job["runnerOccupiedSeconds"] for job in jobs],
        }
        for stage in STAGE_NAMES:
            metrics[f"stage.{stage}Seconds"] = [
                job["stageSeconds"][stage] for job in jobs
            ]
        job_distributions[job_name] = {
            metric: {
                "unit": "seconds",
                **distribution(
                    values,
                    f"job:{job_name}:{metric}",
                    resamples,
                    seed,
                ),
            }
            for metric, values in sorted(metrics.items())
        }

    excluded_reasons: dict[str, int] = defaultdict(int)
    censored_count = 0
    for observation in excluded_payload.get("observations") or []:
        for reason in observation.get("reasonCodes") or []:
            excluded_reasons[reason] += 1
        censored_count += int(bool(observation.get("censored")))

    return {
        "schema": f"{SCHEMA_VERSION}/summary",
        "capturedAtUtc": collection["capturedAtUtc"],
        "repository": collection["repository"],
        "workflow": collection["workflow"],
        "analysis": {
            "kind": "unpaired observational baseline",
            "successfulRunCount": len(observations),
            "excludedObservationCount": len(excluded_payload.get("observations") or []),
            "censoredObservationCount": censored_count,
            "bootstrap": {
                "method": "nonparametric percentile bootstrap",
                "randomIndexGenerator": "splitmix64-v1",
                "resamples": resamples,
                "seed": seed,
                "confidenceLevel": 0.95,
            },
            "absoluteChangeBudgetSeconds": None,
            "relativeChangeBudgetPercent": None,
            "noiseBudget": (
                "No acceptance noise budget was predeclared. Observed spread and bootstrap "
                "intervals describe this unpaired baseline and are not a pass/fail threshold."
            ),
            "counterfactuals": {
                "status": "forecast_only",
                "computed": False,
                "statement": (
                    "No before/after source comparison is included. Any projected savings "
                    "from changing jobs, platforms, or steps remain forecasts until measured "
                    "under a comparable retained run set."
                ),
                "requiredAccounting": [
                    "Retained verification, parity, and platform-test lanes must remain represented.",
                    "Coverage timing changes must be included rather than treated as zero cost.",
                    "Added full-history checkout and classifier time must be included.",
                    "Forecast gross removals cannot be reported as actual net savings.",
                ],
            },
            "performanceImprovementClaim": False,
        },
        "runObservations": observations,
        "runDistributions": run_distributions,
        "jobDistributions": job_distributions,
        "excludedObservationSummary": {
            "count": len(excluded_payload.get("observations") or []),
            "censoredCount": censored_count,
            "reasonCounts": dict(sorted(excluded_reasons.items())),
        },
        "limits": [
            "GitHub Actions API timestamps have one-second resolution.",
            "Runner-occupied seconds sum parallel jobs and are not wall-clock duration or billed-minute totals.",
            "Step categories are deterministic name-based groups; the combined Install step cannot be decomposed without logs.",
            "The benchmark_report group includes its adjacent validation/report step when GitHub gives both the same generated step-name prefix.",
            "Bootstrap intervals quantify sampling variation within these recent unpaired runs; they do not establish causality.",
        ],
    }


def format_number(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def interval_text(metric: dict[str, Any], key: str) -> str:
    low, high = metric[key]
    return f"{format_number(low)}–{format_number(high)}"


def build_report(summary: dict[str, Any]) -> str:
    lines = [
        "# CI timing baseline",
        "",
        f"Captured: `{summary['capturedAtUtc']}`",
        f"Repository/workflow: `{summary['repository']}` / `{summary['workflow']}`",
        "",
        "This is an unpaired observational baseline from recent successful CI runs. It is not a before/after comparison and makes no measured improvement claim.",
        "",
        "## Run observations",
        "",
        "| Run | Event | Critical job | Critical path (s) | Runner occupied (s) | Max queue (s) | Benchmark/report (s) | Contribution |",
        "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for observation in summary["runObservations"]:
        lines.append(
            "| {runId} | {event} | {criticalJob} | {criticalPathSeconds} | "
            "{runnerOccupiedSeconds} | {maxQueueSeconds} | {benchmarkReportSeconds} | "
            "{benchmarkContributionPercent:.2f}% |".format(**observation)
        )

    lines.extend(
        [
            "",
            "## Run-level distributions",
            "",
            "| Metric | n | Min | p25 | Median | p75 | Max | Mean | SD | Bootstrap mean 95% interval | Bootstrap median 95% interval |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for name, metric in summary["runDistributions"].items():
        lines.append(
            f"| {name} | {metric['n']} | {format_number(metric['min'])} | "
            f"{format_number(metric['p25'])} | {format_number(metric['median'])} | "
            f"{format_number(metric['p75'])} | {format_number(metric['max'])} | "
            f"{format_number(metric['mean'])} | {format_number(metric['sampleStandardDeviation'])} | "
            f"{interval_text(metric, 'bootstrapMean95PercentileInterval')} | "
            f"{interval_text(metric, 'bootstrapMedian95PercentileInterval')} |"
        )

    lines.extend(
        [
            "",
            "## Job distributions",
            "",
            "| Job | Runtime median (s) | Runtime mean 95% interval | Queue median (s) | Benchmark/report median (s) | Test median (s) | Build median (s) |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for job_name, metrics in summary["jobDistributions"].items():
        runtime = metrics["runnerOccupiedSeconds"]
        lines.append(
            f"| {job_name} | {format_number(runtime['median'])} | "
            f"{interval_text(runtime, 'bootstrapMean95PercentileInterval')} | "
            f"{format_number(metrics['queueSeconds']['median'])} | "
            f"{format_number(metrics['stage.benchmark_reportSeconds']['median'])} | "
            f"{format_number(metrics['stage.testSeconds']['median'])} | "
            f"{format_number(metrics['stage.buildSeconds']['median'])} |"
        )

    excluded = summary["excludedObservationSummary"]
    lines.extend(
        [
            "",
            "## Excluded observations",
            "",
            f"Fetched but excluded: {excluded['count']}; censored: {excluded['censoredCount']}. "
            f"Reasons: `{json.dumps(excluded['reasonCounts'], sort_keys=True)}`.",
            "",
            "The full sanitized job/step metadata for these observations is retained separately in `excluded-observations.json`.",
            "",
            "## Interpretation limits",
            "",
            "- Absolute change budget: not established.",
            "- Relative change budget: not established.",
            "- Noise budget: no acceptance threshold was predeclared; the observed distributions and bootstrap intervals describe natural variation in this sample.",
            "- Counterfactual status: forecast only. No projected saving is treated as a measured result, and no source before/after comparison is included.",
            "- Any later forecast must include retained verification/parity/platform-test coverage, coverage timing changes, and added full-history checkout/classifier time. Gross removed time is not actual net savings.",
            "- Runner-occupied seconds sum parallel jobs; they are neither wall time nor billed-minute totals.",
            "- The combined Install step bundles install, build, browser setup, and browser tests, so metadata alone cannot split its time.",
            "",
        ]
    )
    return "\n".join(lines)


def build_artifact_map(output_dir: Path, source_path: Path) -> dict[str, Any]:
    artifact_names = [
        COLLECTION_FILE,
        EXCLUDED_FILE,
        REPORT_FILE,
        RAW_SUCCESS_FILE,
        SUMMARY_FILE,
    ]
    return {
        "schema": f"{SCHEMA_VERSION}/artifact-map",
        "files": [
            {
                "path": name,
                "bytes": (output_dir / name).stat().st_size,
                "sha256": sha256_file(output_dir / name),
            }
            for name in artifact_names
        ],
        "sourceFiles": [
            {
                "path": source_path.relative_to(REPO_ROOT).as_posix(),
                "bytes": source_path.stat().st_size,
                "sha256": sha256_file(source_path),
            }
        ],
    }


def render_outputs(
    output_dir: Path,
    collection: dict[str, Any],
    successful_payload: dict[str, Any],
    excluded_payload: dict[str, Any],
    resamples: int,
    seed: int,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    resanitize_retained_steps(successful_payload, excluded_payload)
    validate_replay_inputs(collection, successful_payload, excluded_payload)
    summary = build_summary(
        collection,
        successful_payload,
        excluded_payload,
        resamples,
        seed,
    )

    write_json(output_dir / COLLECTION_FILE, collection)
    write_json(output_dir / RAW_SUCCESS_FILE, successful_payload)
    write_json(output_dir / EXCLUDED_FILE, excluded_payload)
    write_json(output_dir / SUMMARY_FILE, summary)
    (output_dir / REPORT_FILE).write_text(build_report(summary), encoding="utf-8")

    source_path = Path(__file__).resolve()
    artifact_map = build_artifact_map(output_dir, source_path)
    write_json(output_dir / ARTIFACT_MAP_FILE, artifact_map)
    artifact_map_hash = sha256_file(output_dir / ARTIFACT_MAP_FILE)
    (output_dir / ARTIFACT_MAP_HASH_FILE).write_text(
        f"{artifact_map_hash}  {ARTIFACT_MAP_FILE}\n",
        encoding="ascii",
    )
    return summary


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CollectionError(f"cannot read JSON input {path}") from error
    if not isinstance(value, dict):
        raise CollectionError(f"JSON input must be an object: {path}")
    return value


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=DEFAULT_REPOSITORY)
    parser.add_argument("--workflow", default=DEFAULT_WORKFLOW)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--input-dir",
        type=Path,
        help="Replay sanitized inputs from a prior evidence directory without network access.",
    )
    parser.add_argument(
        "--captured-at",
        help="UTC ISO-8601 capture time for online collection; defaults to current UTC.",
    )
    parser.add_argument(
        "--bootstrap-resamples",
        type=int,
        default=DEFAULT_BOOTSTRAP_RESAMPLES,
    )
    parser.add_argument("--bootstrap-seed", type=int, default=DEFAULT_BOOTSTRAP_SEED)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if not MIN_SUCCESSFUL_RUNS <= args.limit <= MAX_RUNS:
        raise CollectionError(
            f"--limit must be between {MIN_SUCCESSFUL_RUNS} and {MAX_RUNS}"
        )
    if args.bootstrap_resamples < 1_000:
        raise CollectionError("--bootstrap-resamples must be at least 1000")

    output_dir = args.output_dir.resolve()
    if args.input_dir:
        input_dir = args.input_dir.resolve()
        collection = read_json(input_dir / COLLECTION_FILE)
        successful_payload = read_json(input_dir / RAW_SUCCESS_FILE)
        excluded_payload = read_json(input_dir / EXCLUDED_FILE)
    else:
        captured_at = args.captured_at or datetime.now(timezone.utc).isoformat(
            timespec="seconds"
        ).replace("+00:00", "Z")
        parse_timestamp(captured_at)
        collection, successful_payload, excluded_payload = collect_online(
            args.repository,
            args.workflow,
            args.limit,
            captured_at,
        )

    summary = render_outputs(
        output_dir,
        collection,
        successful_payload,
        excluded_payload,
        args.bootstrap_resamples,
        args.bootstrap_seed,
    )
    print(
        json.dumps(
            {
                "status": "ok",
                "outputDir": str(output_dir),
                "successfulRuns": summary["analysis"]["successfulRunCount"],
                "excludedObservations": summary["analysis"][
                    "excludedObservationCount"
                ],
                "artifactMapSha256": sha256_file(
                    output_dir / ARTIFACT_MAP_FILE
                ),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CollectionError as error:
        print(f"collect-ci-performance: {error}", file=sys.stderr)
        raise SystemExit(2)
