#!/usr/bin/env python3
"""Emit workflow run/step signals to structured logs and optional Supabase tables."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from urllib import error, parse, request

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
STRUCTURED_LOG_DIR = PROJECT_ROOT / "backend" / "log" / "restaurant-crawling" / "structured"

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from workflow_contract import CANONICAL_STEPS, merge_row_delta


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def looks_like_uuid(value: str | None) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except Exception:
        return False


def canonical_run_id(candidate: str | None) -> str:
    if looks_like_uuid(candidate):
        return str(uuid.UUID(str(candidate)))
    if candidate:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, candidate))
    return str(uuid.uuid4())


def append_signal(payload: Dict[str, Any]) -> None:
    STRUCTURED_LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = STRUCTURED_LOG_DIR / f"workflow_signals_{datetime.now().strftime('%Y-%m-%d')}.jsonl"
    with log_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def persist_signal_row(payload: Dict[str, Any]) -> None:
    run_id = payload.get("run_id")
    if not run_id:
        return
    row = {
        "run_id": run_id,
        "signal_type": payload.get("event", "unknown"),
        "payload": payload,
    }
    rest_write("admin_workflow_signals", [row])


def get_supabase_env() -> tuple[str | None, str | None]:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    return url, key


def db_enabled() -> bool:
    return os.environ.get("WORKFLOW_SIGNAL_DB", "1") != "0"


def rest_write(table: str, rows: list[dict[str, Any]], on_conflict: Optional[str] = None) -> None:
    url, key = get_supabase_env()
    if not db_enabled() or not url or not key:
        return

    query = ""
    if on_conflict:
        query = "?" + parse.urlencode({"on_conflict": on_conflict})

    endpoint = f"{url.rstrip('/')}/rest/v1/{table}{query}"
    data = json.dumps(rows).encode("utf-8")
    req = request.Request(endpoint, method="POST", data=data)
    req.add_header("Content-Type", "application/json")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")

    try:
        with request.urlopen(req, timeout=10):
            return
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        print(f"[workflow_signal] db write failed: {exc.code} {body}", file=sys.stderr)
    except Exception as exc:
        print(f"[workflow_signal] db write failed: {exc}", file=sys.stderr)


def init_run(args: argparse.Namespace) -> None:
    run_id = canonical_run_id(args.run_id)
    payload = {
        "event": "run_init",
        "timestamp": now_iso(),
        "run_id": run_id,
        "dispatch_request_id": args.dispatch_request_id,
        "trigger_source": args.trigger_source,
        "channel_url_raw": args.channel_url,
        "channel_url_normalized": args.channel_url_normalized,
        "channel_slug": args.channel_slug,
        "channel_id": args.channel_id,
        "workflow_file": args.workflow_file,
        "workflow_ref": args.workflow_ref,
        "github_run_id": args.github_run_id,
        "github_run_number": args.github_run_number,
        "github_run_attempt": args.github_run_attempt,
        "github_status": "in_progress",
        "correlation_state": args.correlation_state,
    }
    append_signal(payload)
    persist_signal_row(payload)

    db_row = {
        "run_id": run_id,
        "dispatch_request_id": args.dispatch_request_id or run_id,
        "correlation_key": args.correlation_key,
        "trigger_source": args.trigger_source,
        "channel_url_raw": args.channel_url,
        "channel_url_normalized": args.channel_url_normalized,
        "channel_slug": args.channel_slug,
        "channel_id": args.channel_id,
        "workflow_file": args.workflow_file,
        "workflow_ref": args.workflow_ref,
        "github_workflow_id": args.github_workflow_id,
        "github_run_id": int(args.github_run_id) if args.github_run_id else None,
        "github_run_number": int(args.github_run_number) if args.github_run_number else None,
        "github_run_attempt": int(args.github_run_attempt) if args.github_run_attempt else None,
        "github_status": "in_progress",
        "correlation_state": args.correlation_state,
        "requested_at": args.requested_at or now_iso(),
        "dispatched_at": args.dispatched_at or now_iso(),
    }
    rest_write("admin_workflow_runs", [db_row], on_conflict="run_id")

    print(run_id)


def init_steps(args: argparse.Namespace) -> None:
    run_id = canonical_run_id(args.run_id)
    timestamp = now_iso()
    signals = []
    rows = []
    for step in CANONICAL_STEPS:
        step_no = step["canonical_step_no"]
        row_delta = merge_row_delta(step_no, None)
        signals.append(
            {
                "event": "step_init",
                "timestamp": timestamp,
                "run_id": run_id,
                "canonical_step_no": step_no,
                "canonical_step_key": step["canonical_step_key"],
                "script_step_label": step["script_step_label"],
                "status": "queued",
                "row_delta": row_delta,
            }
        )
        rows.append(
            {
                "run_id": run_id,
                "canonical_step_no": step_no,
                "canonical_step_key": step["canonical_step_key"],
                "script_step_label": step["script_step_label"],
                "status": "queued",
                "attempt": 1,
                "row_delta": row_delta,
            }
        )

    for signal in signals:
        append_signal(signal)
        persist_signal_row(signal)

    rest_write("admin_workflow_steps", rows, on_conflict="run_id,canonical_step_no")


def step_start(args: argparse.Namespace) -> None:
    run_id = canonical_run_id(args.run_id)
    step_no = int(args.step_no)
    payload = {
        "event": "step_start",
        "timestamp": now_iso(),
        "run_id": run_id,
        "canonical_step_no": step_no,
        "canonical_step_key": args.step_key,
        "script_step_label": args.script_step_label,
        "status": "running",
        "message": args.message,
    }
    append_signal(payload)
    persist_signal_row(payload)

    row = {
        "run_id": run_id,
        "canonical_step_no": step_no,
        "canonical_step_key": args.step_key,
        "script_step_label": args.script_step_label,
        "status": "running",
        "message": args.message,
        "started_at": now_iso(),
        "attempt": int(args.attempt or 1),
    }
    rest_write("admin_workflow_steps", [row], on_conflict="run_id,canonical_step_no")


def step_finish(args: argparse.Namespace) -> None:
    run_id = canonical_run_id(args.run_id)
    step_no = int(args.step_no)
    row_delta = {}
    if args.row_delta_json:
        try:
            row_delta = json.loads(args.row_delta_json)
        except json.JSONDecodeError:
            row_delta = {"raw": args.row_delta_json}

    row_delta = merge_row_delta(step_no, row_delta)

    payload = {
        "event": "step_finish",
        "timestamp": now_iso(),
        "run_id": run_id,
        "canonical_step_no": step_no,
        "canonical_step_key": args.step_key,
        "script_step_label": args.script_step_label,
        "status": args.status,
        "duration_ms": int(args.duration_ms or 0),
        "message": args.message,
        "row_delta": row_delta,
    }
    append_signal(payload)
    persist_signal_row(payload)

    row = {
        "run_id": run_id,
        "canonical_step_no": step_no,
        "canonical_step_key": args.step_key,
        "script_step_label": args.script_step_label,
        "status": args.status,
        "message": args.message,
        "ended_at": now_iso(),
        "duration_ms": int(args.duration_ms or 0),
        "row_delta": row_delta,
        "attempt": int(args.attempt or 1),
    }
    rest_write("admin_workflow_steps", [row], on_conflict="run_id,canonical_step_no")


def run_complete(args: argparse.Namespace) -> None:
    run_id = canonical_run_id(args.run_id)
    payload = {
        "event": "run_complete",
        "timestamp": now_iso(),
        "run_id": run_id,
        "run_status": args.run_status,
        "github_status": args.github_status,
        "github_conclusion": args.github_conclusion,
        "correlation_state": "completed",
        "error_code": args.error_code,
        "error_message": args.error_message,
        "failure_step_no": int(args.failure_step_no) if args.failure_step_no else None,
        "failure_step_key": args.failure_step_key,
    }
    append_signal(payload)
    persist_signal_row(payload)

    row = {
        "run_id": run_id,
        "github_status": args.github_status,
        "github_conclusion": args.github_conclusion,
        "correlation_state": "completed",
        "completed_at": now_iso(),
        "error_code": args.error_code,
        "error_message": args.error_message,
    }
    rest_write("admin_workflow_runs", [row], on_conflict="run_id")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Workflow signal emitter")
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    p_init_run = subparsers.add_parser("init-run")
    p_init_run.add_argument("--run-id", required=False)
    p_init_run.add_argument("--dispatch-request-id", required=False)
    p_init_run.add_argument("--correlation-key", required=False)
    p_init_run.add_argument("--trigger-source", default="schedule")
    p_init_run.add_argument("--channel-url", required=False)
    p_init_run.add_argument("--channel-url-normalized", required=False)
    p_init_run.add_argument("--channel-slug", required=False)
    p_init_run.add_argument("--channel-id", required=False)
    p_init_run.add_argument("--workflow-file", default="daily-crawler.yml")
    p_init_run.add_argument("--workflow-ref", default="data")
    p_init_run.add_argument("--github-workflow-id", required=False)
    p_init_run.add_argument("--github-run-id", required=False)
    p_init_run.add_argument("--github-run-number", required=False)
    p_init_run.add_argument("--github-run-attempt", required=False)
    p_init_run.add_argument("--requested-at", required=False)
    p_init_run.add_argument("--dispatched-at", required=False)
    p_init_run.add_argument("--correlation-state", default="matched")

    p_init_steps = subparsers.add_parser("init-steps")
    p_init_steps.add_argument("--run-id", required=True)

    p_step_start = subparsers.add_parser("step-start")
    p_step_start.add_argument("--run-id", required=True)
    p_step_start.add_argument("--step-no", required=True)
    p_step_start.add_argument("--step-key", required=True)
    p_step_start.add_argument("--script-step-label", required=True)
    p_step_start.add_argument("--message", required=False, default="")
    p_step_start.add_argument("--attempt", required=False)

    p_step_finish = subparsers.add_parser("step-finish")
    p_step_finish.add_argument("--run-id", required=True)
    p_step_finish.add_argument("--step-no", required=True)
    p_step_finish.add_argument("--step-key", required=True)
    p_step_finish.add_argument("--script-step-label", required=True)
    p_step_finish.add_argument("--status", required=True)
    p_step_finish.add_argument("--message", required=False, default="")
    p_step_finish.add_argument("--duration-ms", required=False)
    p_step_finish.add_argument("--row-delta-json", required=False)
    p_step_finish.add_argument("--attempt", required=False)

    p_run_complete = subparsers.add_parser("run-complete")
    p_run_complete.add_argument("--run-id", required=True)
    p_run_complete.add_argument("--run-status", required=True)
    p_run_complete.add_argument("--github-status", required=True)
    p_run_complete.add_argument("--github-conclusion", required=True)
    p_run_complete.add_argument("--error-code", required=False)
    p_run_complete.add_argument("--error-message", required=False)
    p_run_complete.add_argument("--failure-step-no", required=False)
    p_run_complete.add_argument("--failure-step-key", required=False)

    return parser


def main() -> int:
    args = build_parser().parse_args()

    if args.cmd == "init-run":
        init_run(args)
    elif args.cmd == "init-steps":
        init_steps(args)
    elif args.cmd == "step-start":
        step_start(args)
    elif args.cmd == "step-finish":
        step_finish(args)
    elif args.cmd == "run-complete":
        run_complete(args)
    else:
        raise ValueError(f"Unknown command: {args.cmd}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
