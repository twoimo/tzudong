"""Gated shim retirement. Never deletes without N=3 parity ledger."""

from __future__ import annotations

import argparse
from pathlib import Path

from backend.pipeline_control.parity import assert_cutover_allowed

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO_ROOT / "backend" / "log" / "cron" / "pipeline-parity-ledger.json"
SHIMS = (
    REPO_ROOT / "backend" / "run_daily.sh",
    REPO_ROOT / "backend" / "run_local_heavy.sh",
)
GHA_CALL = REPO_ROOT / ".github" / "workflows" / "daily-crawler.yml"


def plan_cutover(ledger_path: Path = DEFAULT_LEDGER) -> dict[str, object]:
    assert_cutover_allowed(ledger_path)
    return {
        "allowed": True,
        "remove": [str(path) for path in SHIMS if path.exists()],
        "rewrite": str(GHA_CALL),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        planned = plan_cutover(args.ledger)
    except PermissionError as exc:
        print(str(exc))
        return 2
    if not args.apply:
        print(planned)
        return 0
    for path in SHIMS:
        if path.exists():
            path.unlink()
    if GHA_CALL.exists():
        text = GHA_CALL.read_text(encoding="utf-8")
        GHA_CALL.write_text(
            text.replace("bash backend/run_daily.sh", "python3 -m backend.pipeline_control.worker"),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
