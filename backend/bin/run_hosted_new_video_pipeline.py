#!/usr/bin/env python3
"""One entry for Mac and GitHub Actions: evaluate new videos then pending-apply.

Does not enable PIPELINE_HOSTED_APPLY_ENABLED. Auto approval is a separate,
explicit --review-automation feature with its own persisted operator policy.
Existing workflow admission and producer freezes are not changed here. Hosted
inserts stay pending until the separate guarded review policy admits them.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import json
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


def _review_reserved_slot(recheck_limit: int = 1) -> ReviewReservation:
    with tempfile.TemporaryDirectory(prefix='tzudong-review-budget-') as folder:
        receipt=Path(folder)/'receipt.json'
        request_id = str(uuid.uuid4())
        status=_run([sys.executable,str(REVIEW),'--request-id',request_id,'--recheck-limit',str(recheck_limit),'--receipt-file',str(receipt)],required=False)
        if status!=0 or not receipt.is_file() or receipt.stat().st_size>2048:return ReviewReservation(1, False)
        try:
            result=json.loads(receipt.read_text(encoding='utf-8'))
            if result.get('recheckAttempted') is True:return ReviewReservation(1, True)
            if result.get('recheckAttempted') is False and type(result.get('recheckOutstanding')) is bool:
                return ReviewReservation(int(result['recheckOutstanding']), True)
        except (OSError,ValueError,AttributeError):pass
        # Uncertain work reserves one slot; never spend it again on a new video.
        return ReviewReservation(1, False)


def _recovery_reserved_slot(channel: str) -> ReviewReservation:
    """Consume one explicitly queued recovery inside the existing video budget.

    No queue creation, retry of an existing journal, scheduler or freeze change.
    An unknown outcome reserves a slot even if no result was received.
    """
    try:
        from backend.bin.run_restaurant_evidence_recovery import (
            RestTransport, run_next_recovery, resolve_privileged_supabase_rest_credentials,
        )
        result = run_next_recovery(
            RestTransport(resolve_privileged_supabase_rest_credentials()),
            channel=channel,
            state_dir=Path.home() / '.local/state/tzudong/evidence-recovery',
            allow_worker_write=True,
        )
        if (not isinstance(result, dict) or result.get('schemaVersion') != 1
                or result.get('automaticRetryAllowed') is not False
                or type(result.get('reserved_slots')) is not int or result['reserved_slots'] not in (0, 1)
                or type(result.get('attempted')) is not bool or type(result.get('outstanding')) is not bool
                or result.get('paid_attempted') is not None and type(result.get('paid_attempted')) is not bool):
            return ReviewReservation(1, False)
        if result['reserved_slots'] == 0:
            if (result.get('state'), result.get('code'), result.get('jobId'), result['attempted'], result['outstanding'], result.get('paid_attempted')) != ('idle', 'queue_empty', None, False, False, False):
                return ReviewReservation(1, False)
        elif result.get('state') not in ('draft', 'applied', 'failed', 'running', 'uncertain', 'blocked'):
            return ReviewReservation(1, False)
        return ReviewReservation(result['reserved_slots'], not result['outstanding'])
    except Exception:
        return ReviewReservation(1, False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default="tzuyang")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--review-automation", action="store_true")
    parser.add_argument("--evidence-recovery", action="store_true")
    parser.add_argument(
        "--preview-out",
        default=str(REPO_ROOT / "backend/log/cron/hosted-apply-preview.json"),
    )
    args = parser.parse_args(argv)
    if args.limit < 1 or args.limit > 3:
        print("error=limit_invalid")
        return 2
    if args.evidence_recovery and not args.review_automation:
        print("error=recovery_requires_review_automation")
        return 2
    if args.evidence_recovery and args.channel != 'tzuyang':
        print("error=recovery_channel_unsupported")
        return 2
    _load_backend_env(REPO_ROOT)
    cadence_source_preflight(REPO_ROOT)
    env_contract_preflight("hosted-pending-apply")
    _apply_local_runtime_environment()
    print(f"source={os.environ.get('TZUDONG_PIPELINE_SOURCE', 'local')}")
    new_limit = args.limit
    review_confirmed = False
    if args.review_automation and not args.dry_run:
        if args.evidence_recovery:
            recovery = _recovery_reserved_slot(args.channel)
            new_limit -= recovery.reserved_slots
        # One existing video slot is reserved for a queued recheck. Never add
        # a fourth evaluated video to the existing three-video daily budget.
        reservation = _review_reserved_slot() if new_limit > 0 else ReviewReservation(0, False)
        new_limit = max(0, new_limit - reservation.reserved_slots)
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
    evaluate_exit = _run(evaluate_command, required=False) if new_limit > 0 else 0
    print(f"evaluate_exit={evaluate_exit}")
    if evaluate_exit != 0:
        print("pipeline=evaluation_failed")
        return evaluate_exit
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
        print("pipeline=dry_run")
        return 0
    _run(apply_cmd + ["--dry-run"])
    apply_exit = _run(apply_cmd)
    if args.review_automation and review_confirmed:
        _run([sys.executable, str(REVIEW), "--recheck-limit", "0"])
    elif args.review_automation:
        print("review_followup=skipped_unconfirmed")
    print(f"apply_exit={apply_exit}")
    print("pipeline=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
