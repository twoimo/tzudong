#!/usr/bin/env python3
"""Fail CI on high-confidence secret patterns in tracked files only."""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("GitHub token", re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,}")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("OpenAI API key", re.compile(r"sk-[A-Za-z0-9_-]{32,}")),
    ("Stripe webhook secret", re.compile(r"whsec_[A-Za-z0-9]{20,}")),
]

SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz",
    ".woff", ".woff2", ".ttf", ".pyc", ".sqlite", ".db",
}
SKIP_DIR_PARTS = {".git", "node_modules", ".next", "__pycache__"}


def tracked_files() -> list[pathlib.Path]:
    out = subprocess.check_output(["git", "ls-files"], text=True)
    return [pathlib.Path(line) for line in out.splitlines() if line]


def should_skip(path: pathlib.Path) -> bool:
    return path.suffix.lower() in SKIP_SUFFIXES or any(part in SKIP_DIR_PARTS for part in path.parts)


def main() -> int:
    findings: list[str] = []
    for path in tracked_files():
        if should_skip(path) or not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for label, pattern in PATTERNS:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                findings.append(f"{path}:{line}: {label}")
    if findings:
        print("High-confidence secret patterns found in tracked files:", file=sys.stderr)
        for item in findings:
            print(f"- {item}", file=sys.stderr)
        print("Rotate/revoke the credential, remove it from git history if public, then rerun.", file=sys.stderr)
        return 1
    print("No high-confidence secret patterns found in tracked files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
