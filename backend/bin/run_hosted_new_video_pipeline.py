#!/usr/bin/env python3
"""One entry for Mac and GitHub Actions: evaluate new videos then pending-apply.

Does not enable PIPELINE_HOSTED_APPLY_ENABLED. Auto approval is a separate,
explicit --review-automation feature with its own persisted operator policy.
G037_WRITE_FREEZE does not hold this path. Hosted inserts stay pending until
an admin approves them.
"""

from __future__ import annotations

import argparse
import hashlib
import time
from datetime import datetime, timezone
import os
import subprocess
import sys
import json
import re
import tempfile
import uuid
from pathlib import Path
from typing import NamedTuple

def _repo_root() -> Path:
    override = os.environ.get("TZUDONG_REPO_ROOT", "").strip()
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parents[2]


REPO_ROOT = _repo_root()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.pipeline_control.worker import (  # noqa: E402
    cadence_source_preflight,
    env_contract_preflight,
)

EVALUATE = REPO_ROOT / "backend" / "bin" / "evaluate_new_youtube_videos.py"
APPLY = REPO_ROOT / "backend" / "bin" / "apply_hosted_pending_candidates.py"
REVIEW = REPO_ROOT / "backend" / "bin" / "run_restaurant_review_automation.py"


def _load_backend_env(repo_root: Path) -> None:
    """Load backend/.env(.local) so local/Mac runs need no wrapper env wiring.

    GitHub Actions injects SUPABASE_* through job-level secrets; the launchd
    path has no such injection, so the runner self-loads the same contract.
    Existing process environment always wins (no override).
    """
    backend = repo_root / "backend"
    if not (backend / ".env").is_file() and not (backend / ".env.local").is_file():
        return
    sys.path.insert(0, str(backend))
    try:
        from utils.runtime_paths import load_backend_env

        load_backend_env(backend, prefer_local=True, override=False)
    except Exception:
        # Fail closed: apply_hosted_pending_candidates rejects empty SUPABASE_*
        pass


def _venv_site_packages(repo_root: Path) -> str | None:
    """Admit the repo-local venv site-packages for child yt-dlp/collect scripts.

    The transcript runner realpaths the interpreter (trusted-command contract),
    which drops venv context; PYTHONPATH restores it without changing PATH.
    """
    candidate = repo_root / ".venv" / "lib"
    if not candidate.is_dir():
        return None
    matches = sorted(candidate.glob("python3.*/site-packages"))
    return str(matches[-1]) if matches else None


def _apply_local_runtime_environment() -> None:
    """Mac launchd has no CI env injection; prefer explicit runtime layout."""
    if not os.environ.get("PYTHON_CMD"):
        venv_python = REPO_ROOT / ".venv" / "bin" / "python"
        if venv_python.is_file():
            os.environ["PYTHON_CMD"] = str(venv_python)
    if not os.environ.get("PYTHONPATH"):
        site_packages = _venv_site_packages(REPO_ROOT)
        if site_packages:
            os.environ["PYTHONPATH"] = site_packages


def _run(argv: list[str], *, required: bool = True) -> int:
    completed = subprocess.run(argv, cwd=REPO_ROOT, check=False)
    if required and completed.returncode != 0:
        raise SystemExit(completed.returncode)
    return completed.returncode


class ReviewReservation(NamedTuple):
    reserved_slots: int
    confirmed: bool


_GITHUB_RUN_NUMBER = re.compile(r"[1-9][0-9]{0,15}\Z")
_GITHUB_SHA = re.compile(r"[0-9a-f]{40}\Z")
_GITHUB_BRANCH_REF = re.compile(r"refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]{0,127}\Z")


def _github_run_metadata(env: dict[str, str]) -> dict | None:
    """Retain only bounded Actions identity hints; a consumer must verify them."""
    keys = ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_WORKFLOW", "GITHUB_REF")
    values = [env.get(key, "") for key in keys]
    if any(not isinstance(value, str) or len(value) > 160 for value in values):
        return None
    run_id, attempt, sha, workflow, ref = values
    if (not _GITHUB_RUN_NUMBER.fullmatch(run_id)
            or not _GITHUB_RUN_NUMBER.fullmatch(attempt)
            or int(run_id) > 2**53 - 1 or int(attempt) > 2**53 - 1
            or not _GITHUB_SHA.fullmatch(sha)
            or workflow != "Crawler"
            or not _GITHUB_BRANCH_REF.fullmatch(ref)
            or ".." in ref or "//" in ref or ref.endswith(("/", "."))):
        return None
    return {"runId": run_id, "runAttempt": attempt, "headSha": sha,
            "workflow": workflow, "ref": ref}


def _review_reserved_slot() -> ReviewReservation:
    with tempfile.TemporaryDirectory(prefix='tzudong-review-budget-') as folder:
        receipt=Path(folder)/'receipt.json'
        request_id = str(uuid.uuid4())
        status=_run([sys.executable,str(REVIEW),'--request-id',request_id,'--recheck-limit','1','--receipt-file',str(receipt)],required=False)
        if status!=0 or not receipt.is_file() or receipt.stat().st_size>2048:return ReviewReservation(1, False)
        try:
            result=json.loads(receipt.read_text(encoding='utf-8'))
            if result.get('recheckAttempted') is True:return ReviewReservation(1, True)
            if result.get('recheckAttempted') is False and type(result.get('recheckOutstanding')) is bool:
                return ReviewReservation(int(result['recheckOutstanding']), True)
        except (OSError,ValueError,AttributeError):pass
        # Uncertain work reserves one slot; never spend it again on a new video.
        return ReviewReservation(1, False)


def _write_run_receipt(path: Path, report: dict) -> None:
    """Persist bounded metadata; generatedAt is file creation, not run completion."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".hosted-run-", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump({**report, "generatedAt": datetime.now(timezone.utc).isoformat()}, handle, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default="tzuyang")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--review-automation", action="store_true")
    parser.add_argument(
        "--preview-out",
        default=str(REPO_ROOT / "backend/log/cron/hosted-apply-preview.json"),
    )
    parser.add_argument("--receipt-out", default="")
    args = parser.parse_args(argv)
    if args.limit < 1 or args.limit > 3:
        print("error=limit_invalid")
        return 2
    started = time.monotonic()
    report = {
        "schemaVersion": 1,
        "executionId": str(uuid.uuid4()),
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "runnerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "source": "unknown",
        "limit": args.limit,
        "dryRun": args.dry_run,
        "reviewRequested": args.review_automation,
        "reviewConfirmed": False,
        "stage": "preflight",
        "state": "failed",
        "exitCode": 2,
        "publicationVerified": False,
    }
    try:
        _load_backend_env(REPO_ROOT)
        source = os.environ.get("TZUDONG_PIPELINE_SOURCE", "local")
        report["source"] = source if source in {"local", "mac", "github_actions"} else "unknown"
        if report["source"] == "github_actions":
            github = _github_run_metadata(os.environ)
            report["githubMetadataStatus"] = "metadata_available" if github else "unavailable"
            if github:
                report["github"] = github
        cadence_source_preflight(REPO_ROOT)
        env_contract_preflight("hosted-pending-apply")
        _apply_local_runtime_environment()
        print(f"source={report['source']}")
        new_limit = args.limit
        review_confirmed = False
        if args.review_automation and not args.dry_run:
            # Reserve one of this invocation's video slots for a queued recheck.
            # The three-slot limit is per invocation, not a shared daily budget.
            reservation = _review_reserved_slot()
            new_limit -= reservation.reserved_slots
            review_confirmed = reservation.confirmed
        evaluate_command = [
                sys.executable,
                str(EVALUATE),
                "--channel",
                args.channel,
                "--limit",
                str(new_limit),
                *(["--dry-run"] if args.dry_run else []),
            ]
        report["stage"] = "evaluation"
        report["newVideoLimit"] = new_limit
        report["reviewConfirmed"] = review_confirmed
        evaluate_exit = _run(evaluate_command, required=False) if new_limit > 0 else 0
        report["evaluateExit"] = evaluate_exit
        print(f"evaluate_exit={evaluate_exit}")
        if evaluate_exit != 0:
            print("pipeline=evaluation_failed")
            report["exitCode"] = evaluate_exit
            return evaluate_exit
        report["stage"] = "pending_preview"
        preview = Path(args.preview_out)
        preview.parent.mkdir(parents=True, exist_ok=True)
        apply_cmd = [
            sys.executable,
            str(APPLY),
            "--preview-out",
            str(preview),
        ]
        if args.dry_run:
            apply_cmd.append("--dry-run")
            _run(apply_cmd)
            report.update(state="dry_run", exitCode=0)
            print("pipeline=dry_run")
            return 0
        _run(apply_cmd + ["--dry-run"])
        report["stage"] = "pending_apply"
        apply_exit = _run(apply_cmd)
        report["applyExit"] = apply_exit
        if args.review_automation and review_confirmed:
            report["stage"] = "review_followup"
            _run([sys.executable, str(REVIEW), "--recheck-limit", "0"])
        elif args.review_automation:
            report.update(state="review_unconfirmed", exitCode=1)
            print("review_followup=skipped_unconfirmed")
            return 1
        print(f"apply_exit={apply_exit}")
        report.update(stage="finished", state="execution_completed", exitCode=0)
        print("pipeline=ok")
        return 0

    except SystemExit as exc:
        report["exitCode"] = (0 if exc.code is None else int(exc.code)
                              if isinstance(exc.code, int) else 1)
        raise
    except OSError:
        print("error=pipeline_runtime_unavailable")
        return 2
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["elapsedMs"] = max(0, round((time.monotonic() - started) * 1000))
        if args.receipt_out:
            _write_run_receipt(Path(args.receipt_out), report)


if __name__ == "__main__":
    raise SystemExit(main())
