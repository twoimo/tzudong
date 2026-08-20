"""Operator parity entrypoint. Does not delete shims."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.pipeline_control.manifest import (
    compare_policy,
    deletion_allowed,
    load_json,
    record_parity_attempt,
    refuse_shim_deletion,
)

DEFAULT_BASELINE = Path("/Users/twoimo/Documents/projects/tzudong/backend/log/cron/current-summary.json")
DEFAULT_CANDIDATE = Path("backend/log/cron/current-summary.json")
DEFAULT_LEDGER = Path("backend/log/cron/pipeline-parity-ledger.json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare control-plane summary vs last .sh baseline")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--candidate", type=Path, default=DEFAULT_CANDIDATE)
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    args = parser.parse_args(argv)
    baseline = load_json(args.baseline)
    candidate = load_json(args.candidate)
    result = compare_policy(baseline, candidate)
    ledger = record_parity_attempt(
        args.ledger,
        matched=bool(result["matched"]),
        candidate=candidate,
    )
    print(
        json.dumps(
            {
                "matched": result["matched"],
                "consecutiveMatches": ledger["consecutiveMatches"],
                "deletionAllowed": deletion_allowed(ledger),
            },
            sort_keys=True,
        )
    )
    return 0 if result["matched"] else 1


def assert_cutover_allowed(ledger_path: Path) -> None:
    if not ledger_path.exists():
        raise PermissionError("shim_deletion_blocked_until_n3_parity")
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    refuse_shim_deletion(ledger)


if __name__ == "__main__":
    raise SystemExit(main())
