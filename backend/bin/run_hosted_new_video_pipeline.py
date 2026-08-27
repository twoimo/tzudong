#!/usr/bin/env python3
"""One entry for Mac and GitHub Actions: evaluate new videos then pending-apply.

Does not enable PIPELINE_HOSTED_APPLY_ENABLED. Does not auto-approve.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

def _repo_root() -> Path:
    override = os.environ.get("TZUDONG_REPO_ROOT", "").strip()
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parents[2]


REPO_ROOT = _repo_root()
EVALUATE = REPO_ROOT / "backend" / "bin" / "evaluate_new_youtube_videos.py"
APPLY = REPO_ROOT / "backend" / "bin" / "apply_hosted_pending_candidates.py"


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default="tzuyang")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--preview-out",
        default=str(REPO_ROOT / "backend/log/cron/hosted-apply-preview.json"),
    )
    args = parser.parse_args(argv)
    _load_backend_env(REPO_ROOT)
    _apply_local_runtime_environment()
    print(f"source={os.environ.get('TZUDONG_PIPELINE_SOURCE', 'local')}")
    evaluate_exit = _run(
        [
            sys.executable,
            str(EVALUATE),
            "--channel",
            args.channel,
            "--limit",
            str(args.limit),
        ],
        required=False,
    )
    print(f"evaluate_exit={evaluate_exit}")
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
    print(f"apply_exit={apply_exit}")
    print("pipeline=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
