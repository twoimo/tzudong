#!/usr/bin/env python3
"""Fetch one Naver search result page with Scrapling and emit JSON.

This helper is intentionally small and optional.  The Node review-pack builder
uses it only when `--scrapling-search` is passed, so the default CI path remains
dependency-free and deterministic.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import logging
import sys
from urllib.parse import urlencode


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--timeout-ms", type=int, default=15000)
    parser.add_argument("--impersonate", default="chrome")
    return parser.parse_args()


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")


def main() -> int:
    args = parse_args()
    url = "https://search.naver.com/search.naver?" + urlencode({"query": args.query})
    try:
        from scrapling.fetchers import Fetcher
    except Exception as exc:  # pragma: no cover - exercised from Node integration.
        emit(
            {
                "status": 0,
                "url": url,
                "html": "",
                "fetcher": "scrapling",
                "blocked_reason": f"scrapling_import_failed:{type(exc).__name__}:{exc}",
            }
        )
        return 0

    logging.getLogger("scrapling").setLevel(logging.ERROR)
    try:
        # Scrapling may log to stdout/stderr. Keep this helper stdout as strict
        # JSON so the Node caller can parse it reliably.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            page = Fetcher.get(
                url,
                impersonate=args.impersonate,
                stealthy_headers=True,
                timeout=max(1, args.timeout_ms / 1000),
            )
        body = page.body.decode("utf-8", "replace") if isinstance(page.body, (bytes, bytearray)) else str(page.body)
        emit(
            {
                "status": int(getattr(page, "status", 0) or 0),
                "url": getattr(page, "url", url),
                "html": body,
                "fetcher": "scrapling_fetcher",
                "blocked_reason": "",
            }
        )
    except Exception as exc:  # pragma: no cover - network/environment dependent.
        emit(
            {
                "status": 0,
                "url": url,
                "html": "",
                "fetcher": "scrapling_fetcher",
                "blocked_reason": f"scrapling_fetch_failed:{type(exc).__name__}:{exc}",
            }
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
