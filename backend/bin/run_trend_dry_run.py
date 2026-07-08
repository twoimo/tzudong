#!/usr/bin/env python3
"""Run the backend-only trend dry-run against JSON fixtures."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.trend import run_trend_dry_run


def main() -> int:
    parser = argparse.ArgumentParser(description="Run trend proposal dry-run without approved overlay writes.")
    parser.add_argument("--candidates", required=True, help="Path to candidate fixture JSON.")
    parser.add_argument("--web-fixture", help="Path to Google CSE fixture JSON.")
    parser.add_argument("--output", help="Optional output artifact path.")
    args = parser.parse_args()

    candidates_payload = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    candidates = candidates_payload.get("candidates", candidates_payload)
    result = run_trend_dry_run(candidates=candidates, fixture_path=args.web_fixture)
    output = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2)
    if args.output:
        Path(args.output).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
