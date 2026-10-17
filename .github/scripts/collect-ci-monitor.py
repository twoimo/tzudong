#!/usr/bin/env python3
"""Bounded, read-only GitHub metadata collection with attempt-specific caching.

No workflow reruns, logs, credentials, actors or request bodies are retained.
SQLite lookups are O(log H); only changed run/attempt job sets are fetched.
Recent-list coverage is bounded and explicitly marked when it has gaps.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

SCRIPT_DIR = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ci_collection", SCRIPT_DIR / "collect-ci-performance.py")
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)
SCHEMA = "tzudong-ci-incremental-export/v1"
SAFE_SHA = re.compile(r"^[0-9a-f]{40}$")
SAFE_REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
KNOWN_JOBS = {"Admin", "Install", "Ubuntu Bun", "Ubuntu npm", "Windows Bun", "Windows npm"}
PLATFORM_JOBS = {"Ubuntu Bun", "Ubuntu npm", "Windows Bun", "Windows npm"}
STATUSES = {"queued", "in_progress", "completed", "waiting", "pending", "requested"}
CONCLUSIONS = {"success", "failure", "cancelled", "skipped", "timed_out", "action_required", "neutral", "stale", "startup_failure"}
REPRESENTATIVE_NAMES = {
    "setup": "Initialize containers", "install": "Run npm ci",
    "combined_install_build_browser_test": "Authoritative npm clean install",
    "typecheck": "typecheck:parity", "benchmark_report": "typecheck:benchmark",
    "lint": "npm run lint", "test": "test:unit", "build": "Run npm run build",
    "upload": "Upload", "other": "Other",
}


class ReadError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(canonical(value)); handle.flush(); os.fsync(handle.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)


def safe_run(raw):
    if not isinstance(raw, dict):
        raise ReadError("INVALID_RUN")
    attempt = raw["run_attempt"] if "run_attempt" in raw else 1
    if (
        not isinstance(attempt, int)
        or isinstance(attempt, bool)
        or not 1 <= attempt <= 1000
    ):
        raise ReadError("INVALID_ATTEMPT")
    result = COLLECTOR.sanitize_run(raw, [])
    result["attempt"] = attempt
    if not isinstance(result["id"], int) or isinstance(result["id"], bool) or result["id"] < 1:
        raise ReadError("INVALID_RUN_ID")
    if not SAFE_SHA.fullmatch(str(result["headSha"])):
        raise ReadError("INVALID_SOURCE_SHA")
    # The source event is a fixed API enum, not a run title.
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", str(result["event"] or "")):
        result["event"] = "unknown"
    result.pop("jobs")
    result["status"] = result["status"] if result["status"] in STATUSES else "missing"
    result["conclusion"] = result["conclusion"] if result["conclusion"] in CONCLUSIONS else None
    for key in ("createdAt", "startedAt", "updatedAt"):
        if result[key] is not None:
            try: COLLECTOR.parse_timestamp(result[key])
            except (ValueError, TypeError, COLLECTOR.CollectionError):
                raise ReadError("INVALID_RUN_TIME") from None
    return result


def safe_job(raw):
    if not isinstance(raw, dict):
        raise ReadError("INVALID_JOB")
    raw_steps = raw.get("steps")
    if raw_steps is None:
        raw_steps = []
    if (
        not isinstance(raw_steps, list)
        or any(not isinstance(step, dict) for step in raw_steps)
    ):
        raise ReadError("INVALID_JOB_STEPS")
    result = COLLECTOR.sanitize_job(raw)
    result["name"] = result["name"] if result["name"] in KNOWN_JOBS else "Other job"
    labels = " ".join(result["runnerLabels"]).lower()
    family = "windows" if "windows" in labels else "linux" if "ubuntu" in labels or "linux" in labels else "macos" if "macos" in labels else "unknown"
    result["runnerLabels"] = [family]
    result["status"] = result["status"] if result["status"] in STATUSES else "missing"
    result["conclusion"] = result["conclusion"] if result["conclusion"] in CONCLUSIONS else None
    if len(result["steps"]) > 200:
        raise ReadError("STEP_COUNT_BOUND")
    for step in result["steps"]:
        category = COLLECTOR.classify_step(step["name"])
        step["name"] = REPRESENTATIVE_NAMES[category]
        step["status"] = step["status"] if step["status"] in STATUSES else "missing"
        step["conclusion"] = step["conclusion"] if step["conclusion"] in CONCLUSIONS else None
    for item in [result] + result["steps"]:
        for key in ("createdAt", "startedAt", "completedAt"):
            if item.get(key) is not None:
                try: COLLECTOR.parse_timestamp(item[key])
                except (ValueError, TypeError, COLLECTOR.CollectionError):
                    raise ReadError("INVALID_JOB_TIME") from None
    return result


def terminal_outcome_complete(run, jobs, job_set_complete):
    """Return whether GitHub supplied a complete terminal outcome, not timing."""
    if (
        run["status"] != "completed"
        or run["conclusion"] not in CONCLUSIONS
        or not job_set_complete
    ):
        return False
    if not jobs:
        return run["conclusion"] != "success"
    return all(
        job["status"] == "completed"
        and job["conclusion"] in CONCLUSIONS
        and (job["conclusion"] != "success" or bool(job["steps"]))
        and all(
            step["status"] == "completed"
            and step["conclusion"] in CONCLUSIONS
            for step in job["steps"]
        )
        for job in jobs
    )


def cached_terminal_reusable(record):
    """Revalidate cached terminal rows when the evidence contract advances."""
    if not isinstance(record, dict):
        return False
    jobs = record.get("jobs")
    count = record.get("jobsTotalCount")
    attempt = record.get("attempt")
    jobs_attempt = record.get("jobsAttempt")
    complete = bool(
        isinstance(jobs, list)
        and all(isinstance(job, dict) for job in jobs)
        and isinstance(count, int)
        and not isinstance(count, bool)
        and count == len(jobs)
        and isinstance(attempt, int)
        and not isinstance(attempt, bool)
        and isinstance(jobs_attempt, int)
        and not isinstance(jobs_attempt, bool)
        and jobs_attempt == attempt
    )
    if not complete or not terminal_outcome_complete(record, jobs, complete):
        return False
    if record.get("conclusion") != "success":
        return True
    timing_reasons = COLLECTOR.timing_exclusion_reasons(record)
    return not timing_reasons


def execution_mode(jobs):
    platform_jobs = [job for job in jobs if job["name"] in PLATFORM_JOBS]
    if {job["name"] for job in platform_jobs} != PLATFORM_JOBS:
        return "unknown"
    benchmark_jobs = {
        job["name"]
        for job in platform_jobs
        if any(
            COLLECTOR.classify_step(step["name"]) == "benchmark_report"
            and step["conclusion"] not in (None, "skipped")
            for step in job["steps"]
        )
    }
    diagnostic_jobs = {
        job["name"]
        for job in platform_jobs
        if any(
            COLLECTOR.classify_step(step["name"]) == "typecheck"
            and step["conclusion"] not in (None, "skipped")
            for step in job["steps"]
        )
    }
    if benchmark_jobs == PLATFORM_JOBS:
        return "full_benchmark"
    if not benchmark_jobs and diagnostic_jobs == PLATFORM_JOBS:
        return "diagnostic"
    return "unknown"


class GitHubReader:
    def __init__(self):
        self.requests = 0

    def get(self, endpoint, fields=None):
        self.requests += 1
        command = ["gh", "api", "--method", "GET", endpoint]
        for key, value in sorted((fields or {}).items()): command += ["-f", f"{key}={value}"]
        try:
            result = subprocess.run(command, capture_output=True, timeout=30, check=False)
        except subprocess.TimeoutExpired:
            raise ReadError("READ_TIMEOUT") from None
        if result.returncode:
            # Only recognize the status; never echo provider diagnostics.
            if b"HTTP 404" in result.stderr: raise ReadError("NOT_FOUND")
            raise ReadError("READ_FAILED")
        if len(result.stdout) > 8 * 1024 * 1024: raise ReadError("API_BYTE_BOUND")
        try: return json.loads(result.stdout)
        except (ValueError, UnicodeDecodeError): raise ReadError("INVALID_API_JSON") from None


def database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=0.2)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS scope (id INTEGER PRIMARY KEY CHECK(id=1), repository TEXT, workflow TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS runs (run_id INTEGER, attempt INTEGER, fingerprint TEXT, terminal INTEGER, record TEXT, PRIMARY KEY(run_id,attempt))")
    db.execute("CREATE TABLE IF NOT EXISTS sources (sha TEXT PRIMARY KEY, tree_sha TEXT, workflow_revision TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS bootstrap_inventory (run_id INTEGER PRIMARY KEY)")
    db.execute("CREATE TABLE IF NOT EXISTS terminal_refresh_inventory (run_id INTEGER PRIMARY KEY)")
    db.execute("CREATE TABLE IF NOT EXISTS terminal_refresh_cycle (run_id INTEGER PRIMARY KEY)")
    db.commit()
    return db


def source_metadata(db, reader, repository, sha, workflow_path):
    cached = db.execute("SELECT tree_sha,workflow_revision FROM sources WHERE sha=?", (sha,)).fetchone()
    if cached: return cached
    commit = reader.get(f"repos/{repository}/git/commits/{sha}")
    tree = (commit.get("tree") or {}).get("sha")
    content = reader.get(f"repos/{repository}/contents/{quote(workflow_path, safe='/')}", {"ref": sha})
    revision = content.get("sha")
    if not SAFE_SHA.fullmatch(str(tree)) or not SAFE_SHA.fullmatch(str(revision)):
        raise ReadError("SOURCE_METADATA_INCOMPLETE")
    db.execute("INSERT INTO sources VALUES(?,?,?)", (sha, tree, revision))
    return tree, revision


def collect(
    repository,
    workflow,
    cache,
    reader,
    limit=20,
    max_pages=5,
    overlap_hours=48,
    now=None,
    terminal_probe_limit=20,
):
    if not SAFE_REPOSITORY.fullmatch(repository): raise ReadError("INVALID_REPOSITORY")
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.yml", workflow): raise ReadError("INVALID_WORKFLOW")
    if not 1 <= limit <= 100: raise ReadError("INVALID_RUN_BOUND")
    if not 1 <= max_pages <= 10: raise ReadError("INVALID_PAGE_BOUND")
    if not 1 <= overlap_hours <= 168: raise ReadError("INVALID_OVERLAP_BOUND")
    if not 1 <= terminal_probe_limit <= 100:
        raise ReadError("INVALID_TERMINAL_PROBE_BOUND")
    now = now or datetime.now(timezone.utc)
    started = time.monotonic()
    db = database(cache)
    alerts, export, cached_sets, refreshed_sets = [], [], 0, 0
    workflow_path = f".github/workflows/{workflow}"
    try:
        db.execute("BEGIN IMMEDIATE")
        scope = db.execute("SELECT repository,workflow FROM scope WHERE id=1").fetchone()
        if scope and tuple(scope) != (repository, workflow): raise ReadError("CACHE_SCOPE_MISMATCH")
        if not scope: db.execute("INSERT INTO scope VALUES(1,?,?)", (repository, workflow))
        watermark = db.execute("SELECT value FROM meta WHERE key='watermark'").fetchone()
        watermark_before = watermark[0] if watermark else None
        inventory = db.execute(
            "SELECT value FROM meta WHERE key='history_inventory_complete'"
        ).fetchone()
        history_inventory_complete = bool(inventory and inventory[0] == "1")
        fields = {"per_page": limit}
        first_page = 1
        if watermark:
            since = COLLECTOR.parse_timestamp(watermark[0]) - timedelta(hours=overlap_hours)
            fields["created"] = ">=" + since.isoformat().replace("+00:00", "Z")
        else:
            upper_row = db.execute(
                "SELECT value FROM meta WHERE key='bootstrap_created_upper_bound'"
            ).fetchone()
            bootstrap_upper_bound = (
                upper_row[0]
                if upper_row
                else now.isoformat().replace("+00:00", "Z")
            )
            if not upper_row:
                db.execute(
                    "INSERT INTO meta VALUES('bootstrap_created_upper_bound',?)",
                    (bootstrap_upper_bound,),
                )
            fields["created"] = "<=" + bootstrap_upper_bound
            page_row = db.execute(
                "SELECT value FROM meta WHERE key='bootstrap_next_page'"
            ).fetchone()
            try:
                first_page = int(page_row[0]) if page_row else 1
            except (TypeError, ValueError):
                raise ReadError("CACHE_BOOTSTRAP_CURSOR_INVALID") from None
            if not 1 <= first_page <= 100_000:
                raise ReadError("CACHE_BOOTSTRAP_CURSOR_INVALID")
        source_runs = []
        listed_run_ids = set()
        reported_totals = []
        duplicate_list_items = 0
        list_pages = 0
        last_page = first_page
        last_page_size = 0
        for page in range(first_page, first_page + max_pages):
            page_fields = {**fields, "page": page}
            payload = reader.get(
                f"repos/{repository}/actions/workflows/{workflow}/runs", page_fields
            )
            page_runs = payload.get("workflow_runs")
            total_count = payload.get("total_count")
            if (
                not isinstance(page_runs, list)
                or len(page_runs) > limit
                or any(not isinstance(raw, dict) for raw in page_runs)
                or not isinstance(total_count, int)
                or isinstance(total_count, bool)
                or total_count < 0
                or total_count < len(page_runs)
                or total_count > 100_000
            ):
                raise ReadError("INVALID_RUN_LIST")
            list_pages += 1
            last_page = page
            last_page_size = len(page_runs)
            reported_totals.append(total_count)
            for raw in page_runs:
                run_id = raw.get("id") if isinstance(raw, dict) else None
                if run_id in listed_run_ids:
                    duplicate_list_items += 1
                    continue
                listed_run_ids.add(run_id)
                source_runs.append(raw)
            if len(page_runs) < limit or len(listed_run_ids) >= total_count:
                break

        total_changed = len(set(reported_totals)) > 1
        reported_total = max(reported_totals, default=0)
        created_window_complete = bool(
            watermark
            and not total_changed
            and duplicate_list_items == 0
            and len(listed_run_ids) >= reported_total
        )
        bootstrap_inventory_count = 0
        bootstrap_inventory_complete = False
        bootstrap_boundary_changed = False
        if not watermark:
            total_row = db.execute(
                "SELECT value FROM meta WHERE key='bootstrap_total_count'"
            ).fetchone()
            try:
                prior_total = int(total_row[0]) if total_row else None
            except (TypeError, ValueError):
                raise ReadError("CACHE_BOOTSTRAP_TOTAL_INVALID") from None
            if prior_total is not None and prior_total != reported_total:
                total_changed = True
            prior_ids = {
                row[0] for row in db.execute("SELECT run_id FROM bootstrap_inventory")
            }
            duplicate_list_items += len(prior_ids & listed_run_ids)
            prospective_count = len(prior_ids | listed_run_ids)
            short_page_before_total = bool(
                last_page_size < limit and prospective_count < reported_total
            )
            bootstrap_boundary_changed = bool(
                total_changed or duplicate_list_items or short_page_before_total
            )
            if bootstrap_boundary_changed:
                db.execute("DELETE FROM bootstrap_inventory")
                db.execute(
                    "INSERT OR REPLACE INTO meta VALUES('bootstrap_next_page','1')"
                )
                db.execute(
                    "INSERT OR REPLACE INTO meta VALUES('bootstrap_total_count',?)",
                    (str(reported_total),),
                )
                db.execute(
                    "DELETE FROM meta WHERE key='bootstrap_newest_created_at'"
                )
            else:
                db.executemany(
                    "INSERT OR IGNORE INTO bootstrap_inventory VALUES(?)",
                    [(run_id,) for run_id in sorted(listed_run_ids)],
                )
                bootstrap_inventory_count = db.execute(
                    "SELECT count(*) FROM bootstrap_inventory"
                ).fetchone()[0]
                bootstrap_inventory_complete = bool(
                    bootstrap_inventory_count == reported_total
                )
                if not bootstrap_inventory_complete:
                    db.execute(
                        "INSERT OR REPLACE INTO meta VALUES('bootstrap_next_page',?)",
                        (str(last_page + 1),),
                    )
                    db.execute(
                        "INSERT OR REPLACE INTO meta VALUES('bootstrap_total_count',?)",
                        (str(reported_total),),
                    )
        if bootstrap_inventory_complete and not history_inventory_complete:
            db.execute(
                "INSERT OR REPLACE INTO meta VALUES('history_inventory_complete','1')"
            )
            history_inventory_complete = True
        if not watermark and not bootstrap_inventory_complete:
            alerts.append("BOUNDED_RECENT_WINDOW")
        if watermark and not created_window_complete:
            alerts.append("RECENT_WINDOW_TRUNCATED")
        if total_changed or duplicate_list_items or (
            not watermark and last_page_size < limit
            and bootstrap_inventory_count < reported_total
        ):
            alerts.append("LIST_BOUNDARY_CHANGED")
        if not history_inventory_complete:
            alerts.append("HISTORICAL_RUN_INVENTORY_INCOMPLETE")
        listed = {raw.get("id") for raw in source_runs}
        checked_run_ids = set(listed)
        active = db.execute("SELECT DISTINCT run_id FROM runs WHERE terminal=0 LIMIT 101").fetchall()
        if len(active) > 100: raise ReadError("ACTIVE_RUN_BOUND")
        for (run_id,) in active:
            if run_id in listed: continue
            checked_run_ids.add(run_id)
            try: source_runs.append(reader.get(f"repos/{repository}/actions/runs/{run_id}"))
            except ReadError as error:
                if error.code != "NOT_FOUND": raise
                alerts.append("RUN_TOMBSTONE")
                cached_attempts = db.execute(
                    "SELECT terminal,record FROM runs WHERE run_id=? ORDER BY attempt",
                    (run_id,),
                ).fetchall()
                for terminal, text in cached_attempts:
                    record = json.loads(text)
                    if not terminal:
                        record.update(
                            status="missing",
                            conclusion="stale",
                            tombstone=True,
                            jobs=[],
                            terminalOutcomeComplete=False,
                            timingUsable=False,
                            timingExclusionReasons=["no_jobs"],
                        )
                        record.update(jobsTotalCount=0, jobsAttempt=record["attempt"])
                        db.execute(
                            "UPDATE runs SET terminal=1,record=? WHERE run_id=? AND attempt=?",
                            (canonical(record).decode(), run_id, record["attempt"]),
                        )
                    export.append(record)
        # GitHub's documented list filter is keyed to the original run creation
        # time. A rerun keeps that time, so a created-time overlap cannot find a
        # new attempt of an older terminal run. Recheck a deterministic slice of
        # known terminal run IDs through the per-run endpoint. This bounds remote
        # reads while making the maximum discovery delay explicit. Runs that were
        # never inventoried remain an acknowledged coverage gap.
        terminal_rows = db.execute(
            """
            SELECT current.run_id
            FROM runs AS current
            WHERE current.terminal=1
              AND current.attempt=(
                SELECT MAX(candidate.attempt)
                FROM runs AS candidate
                WHERE candidate.run_id=current.run_id
              )
            ORDER BY current.run_id
            """
        ).fetchall()
        known_terminal_ids = [row[0] for row in terminal_rows]
        terminal_inventory_digest = digest(known_terminal_ids)
        inventory_row = db.execute(
            "SELECT value FROM meta WHERE key='terminal_refresh_inventory_digest'"
        ).fetchone()
        prior_terminal_inventory = {
            row[0]
            for row in db.execute("SELECT run_id FROM terminal_refresh_inventory")
        }
        prior_inventory_bound = bool(
            inventory_row
            and inventory_row[0] == digest(sorted(prior_terminal_inventory))
        )
        current_terminal_inventory = set(known_terminal_ids)
        if (
            not prior_inventory_bound
            or not prior_terminal_inventory.issubset(current_terminal_inventory)
        ):
            db.execute("DELETE FROM terminal_refresh_cycle")
        if (
            not prior_inventory_bound
            or prior_terminal_inventory != current_terminal_inventory
        ):
            db.execute("DELETE FROM terminal_refresh_inventory")
            db.executemany(
                "INSERT INTO terminal_refresh_inventory VALUES(?)",
                [(run_id,) for run_id in known_terminal_ids],
            )
            db.execute(
                "INSERT OR REPLACE INTO meta VALUES('terminal_refresh_inventory_digest',?)",
                (terminal_inventory_digest,),
            )
        cursor_row = db.execute(
            "SELECT value FROM meta WHERE key='terminal_probe_cursor'"
        ).fetchone()
        try:
            terminal_cursor = int(cursor_row[0]) if cursor_row else 0
        except (TypeError, ValueError):
            raise ReadError("CACHE_TERMINAL_CURSOR_INVALID") from None
        start_index = bisect.bisect(known_terminal_ids, terminal_cursor)
        ordered_terminal_ids = (
            known_terminal_ids[start_index:] + known_terminal_ids[:start_index]
        )
        probed_terminal_ids = ordered_terminal_ids[:terminal_probe_limit]
        probed_terminal_ids_found = set()
        terminal_probe_not_found = 0
        terminal_probe_api_reads = 0
        for run_id in probed_terminal_ids:
            if run_id in checked_run_ids:
                probed_terminal_ids_found.add(run_id)
                continue
            terminal_probe_api_reads += 1
            try:
                source_runs.append(
                    reader.get(f"repos/{repository}/actions/runs/{run_id}")
                )
                probed_terminal_ids_found.add(run_id)
            except ReadError as error:
                if error.code != "NOT_FOUND":
                    raise
                terminal_probe_not_found += 1
                db.execute(
                    "DELETE FROM terminal_refresh_cycle WHERE run_id=?", (run_id,)
                )
                alerts.append("KNOWN_TERMINAL_REFRESH_NOT_FOUND")
        if probed_terminal_ids:
            db.execute(
                "INSERT OR REPLACE INTO meta VALUES('terminal_probe_cursor',?)",
                (str(probed_terminal_ids[-1]),),
            )
        terminal_ids_observed_this_tick = set(known_terminal_ids) & (
            checked_run_ids | probed_terminal_ids_found
        )
        db.executemany(
            "INSERT OR IGNORE INTO terminal_refresh_cycle VALUES(?)",
            [(run_id,) for run_id in sorted(terminal_ids_observed_this_tick)],
        )
        terminal_ids_observed_in_cycle = db.execute(
            "SELECT count(*) FROM terminal_refresh_cycle"
        ).fetchone()[0]
        known_terminal_refresh_complete = bool(
            terminal_ids_observed_in_cycle == len(known_terminal_ids)
            and terminal_probe_not_found == 0
        )
        if known_terminal_refresh_complete:
            # This tick closes one stable-inventory cycle. Start the next cycle
            # empty so no later tick claims freshness from an earlier rotation.
            db.execute("DELETE FROM terminal_refresh_cycle")
        if not known_terminal_refresh_complete:
            alerts.append("KNOWN_TERMINAL_RERUN_REFRESH_INCOMPLETE")
        incremental_window_complete = bool(
            (created_window_complete or bootstrap_inventory_complete)
            and history_inventory_complete
            and known_terminal_refresh_complete
        )
        if watermark:
            newest = watermark[0]
        elif bootstrap_boundary_changed:
            newest = None
        else:
            bootstrap_newest_row = db.execute(
                "SELECT value FROM meta WHERE key='bootstrap_newest_created_at'"
            ).fetchone()
            newest = bootstrap_newest_row[0] if bootstrap_newest_row else None
        seen = set()
        for raw in source_runs:
            latest = safe_run(raw)
            if latest["id"] in seen: continue
            seen.add(latest["id"])
            if latest["createdAt"] and (newest is None or COLLECTOR.parse_timestamp(latest["createdAt"]) > COLLECTOR.parse_timestamp(newest)):
                newest = latest["createdAt"]
            if latest["attempt"] > 10: alerts.append("ATTEMPT_HISTORY_BOUND")
            for attempt in range(max(1, latest["attempt"] - 9), latest["attempt"] + 1):
                cached = db.execute("SELECT fingerprint,terminal,record FROM runs WHERE run_id=? AND attempt=?", (latest["id"], attempt)).fetchone()
                cached_record = json.loads(cached[2]) if cached else None
                cached_terminal = bool(
                    cached
                    and cached[1]
                    and cached_terminal_reusable(cached_record)
                )
                if attempt != latest["attempt"] and cached_terminal:
                    export.append(cached_record); cached_sets += 1; continue
                run = latest if attempt == latest["attempt"] else safe_run(reader.get(f"repos/{repository}/actions/runs/{latest['id']}/attempts/{attempt}"))
                if run["id"] != latest["id"] or run["attempt"] != attempt:
                    raise ReadError("ATTEMPT_BINDING_MISMATCH")
                fingerprint = digest(run)
                if cached_terminal and cached[0] == fingerprint:
                    export.append(cached_record); cached_sets += 1; continue
                jobs_payload = reader.get(f"repos/{repository}/actions/runs/{run['id']}/attempts/{attempt}/jobs", {"per_page": 100, "page": 1})
                jobs = jobs_payload.get("jobs")
                count = jobs_payload.get("total_count")
                if not isinstance(jobs, list) or len(jobs) > 100: raise ReadError("INVALID_JOB_LIST")
                complete = (
                    isinstance(count, int)
                    and not isinstance(count, bool)
                    and count == len(jobs)
                    and not (
                        run["status"] == "completed"
                        and run["conclusion"] == "success"
                        and count == 0
                    )
                )
                if not complete: alerts.append("JOB_SET_INCOMPLETE")
                record = dict(run)
                record.update(jobs=[safe_job(job) for job in jobs], jobsTotalCount=count, jobsAttempt=attempt)
                tree, revision = source_metadata(db, reader, repository, run["headSha"], workflow_path)
                topology = sorted(job["name"] for job in record["jobs"])
                record.update(sourceTree=tree, workflowRevision=revision, jobTopology=digest(topology), executionMode=execution_mode(record["jobs"]))
                timing_reasons = COLLECTOR.timing_exclusion_reasons(record)
                if count == 0 and run["conclusion"] != "success":
                    timing_reasons = [reason for reason in timing_reasons if reason != "no_jobs"]
                outcome_complete = terminal_outcome_complete(
                    run, record["jobs"], complete
                )
                timing_usable = bool(
                    run["conclusion"] == "success"
                    and outcome_complete
                    and not timing_reasons
                )
                record.update(
                    terminalOutcomeComplete=outcome_complete,
                    timingUsable=timing_usable,
                    timingExclusionReasons=sorted(set(timing_reasons)),
                )
                # Successful records with unusable timing remain refreshable so
                # a corrected GitHub snapshot can replace them. Non-success
                # terminal outcomes are immutable even when timing is absent.
                terminal = bool(
                    outcome_complete
                    and (run["conclusion"] != "success" or timing_usable)
                )
                if len(canonical(record)) > 1024 * 1024: raise ReadError("RECORD_BYTE_BOUND")
                db.execute("INSERT OR REPLACE INTO runs VALUES(?,?,?,?,?)", (run["id"], attempt, fingerprint, int(terminal), canonical(record).decode()))
                export.append(record); refreshed_sets += 1
        if not watermark and not bootstrap_boundary_changed and newest:
            db.execute(
                "INSERT OR REPLACE INTO meta VALUES('bootstrap_newest_created_at',?)",
                (newest,),
            )
        watermark_advanced = bool(
            newest
            and (
                created_window_complete
                if watermark
                else bootstrap_inventory_complete
            )
            and newest != watermark_before
        )
        if watermark_advanced:
            db.execute("INSERT OR REPLACE INTO meta VALUES('watermark',?)", (newest,))
        watermark_after = newest if watermark_advanced else watermark_before
        db.commit()
    except Exception:
        db.rollback(); raise
    finally:
        db.close()
    return {
        "schema": SCHEMA, "repository": repository, "workflow": workflow_path,
        "capturedAtUtc": now.isoformat().replace("+00:00", "Z"), "runs": export,
        "coverage": {
            "scope": "created_window_plus_known_active_and_bounded_terminal_refresh",
            "alerts": sorted(set(alerts)),
            "completeHistoryClaimed": False,
            "incrementalWindowComplete": incremental_window_complete,
            "createdWindowComplete": (
                created_window_complete or bootstrap_inventory_complete
            ),
            "historyInventoryComplete": history_inventory_complete,
            "bootstrapInventoryRunCount": bootstrap_inventory_count,
            "unlistedHistoricalRerunDiscoveryComplete": history_inventory_complete,
            "knownTerminalRerunRefreshComplete": known_terminal_refresh_complete,
            "knownTerminalRunCount": len(known_terminal_ids),
            "knownTerminalRunsExamined": terminal_ids_observed_in_cycle,
            "knownTerminalRunsExaminedThisTick": len(
                terminal_ids_observed_this_tick
            ),
            "knownTerminalRunApiReads": terminal_probe_api_reads,
            "knownTerminalRefreshNotFoundCount": terminal_probe_not_found,
            "knownTerminalRerunMaxDiscoveryTicks": (
                (len(known_terminal_ids) + terminal_probe_limit - 1)
                // terminal_probe_limit
                if known_terminal_ids
                else 0
            ),
            "knownTerminalRerunMaxDiscoveryTickBasis": (
                "stable_known_terminal_inventory_and_successful_ticks"
            ),
            "bootstrapOnly": not bool(watermark_before),
            "watermarkBefore": watermark_before,
            "watermarkAfter": watermark_after,
            "watermarkAdvanced": watermark_advanced,
            "overlapHours": overlap_hours,
            "reportedWindowRunCount": reported_total,
            "uniqueListedRunCount": len(listed_run_ids),
            "listPages": list_pages,
        },
        "collection": {
            "apiRequests": reader.requests,
            "refreshedJobSets": refreshed_sets,
            "reusedJobSets": cached_sets,
            "elapsedSeconds": round(time.monotonic() - started, 6),
            "maximumListedRunsPerPage": limit,
            "maximumListPages": max_pages,
            "maximumIncrementalListedRuns": limit * max_pages,
            "maximumKnownTerminalRunRefreshes": terminal_probe_limit,
            "asymptoticApiReads": "O(P + A + R + S), bounded by configured pages, active attempts, terminal refreshes, and uncached sources",
            "sqliteLookupCost": "O(H log H) worst-case for the local latest-terminal scan with indexed attempt lookups; O(log H) per keyed run or source lookup",
            "llmCalls": 0,
            "remoteMutations": 0,
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default="twoimo/tzudong")
    parser.add_argument("--workflow", default="web-admin-ci.yml")
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--max-pages", type=int, default=5)
    parser.add_argument("--overlap-hours", type=int, default=48)
    parser.add_argument("--terminal-probe-limit", type=int, default=20)
    args = parser.parse_args(argv)
    try:
        result = collect(
            args.repository,
            args.workflow,
            args.cache,
            GitHubReader(),
            limit=args.limit,
            max_pages=args.max_pages,
            overlap_hours=args.overlap_hours,
            terminal_probe_limit=args.terminal_probe_limit,
        )
        atomic_json(args.output, result)
        print(json.dumps({"status": "collected", **result["collection"], "coverage": result["coverage"]}, sort_keys=True))
        return 0
    except (ReadError, sqlite3.Error, OSError) as error:
        print(json.dumps({"status": "unverified", "code": getattr(error, "code", "LOCAL_STATE_FAILED")}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
