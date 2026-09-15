#!/usr/bin/env python3
"""Run the backend-only trend dry-run against JSON fixtures."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from datetime import datetime

from backend.trend import run_trend_dry_run
from backend.trend.momentum import Observation


def main() -> int:
    parser = argparse.ArgumentParser(description="Run trend proposal dry-run without approved overlay writes.")
    parser.add_argument("--candidates", required=True, help="Path to candidate fixture JSON.")
    parser.add_argument("--web-fixture", help="Path to Google CSE fixture JSON.")
    parser.add_argument("--output", help="Optional output artifact path.")
    parser.add_argument("--momentum-observations", help="Timestamped public video counters and optional keyword aliases JSON.")
    args = parser.parse_args()

    candidates_payload = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    candidates = candidates_payload.get("candidates", candidates_payload)
    momentum_payload = json.loads(Path(args.momentum_observations).read_text(encoding="utf-8")) if args.momentum_observations else {}
    observations = [Observation(
        video_id=item["videoId"], channel_id=item["channelId"], format=item["format"],
        observed_at=datetime.fromisoformat(item["observedAt"].replace("Z", "+00:00")),
        views=item["views"], keywords=tuple(item.get("keywords", [])),
    ) for item in momentum_payload.get("observations", [])]
    result = run_trend_dry_run(candidates=candidates, fixture_path=args.web_fixture,
                               momentum_observations=observations,
                               keyword_aliases=momentum_payload.get("keywordAliases"))
    output = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2)
    if args.output:
        Path(args.output).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
