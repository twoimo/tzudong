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
