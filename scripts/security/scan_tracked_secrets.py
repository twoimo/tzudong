#!/usr/bin/env python3
"""Fail CI and local candidate checks on high-confidence secret patterns."""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("GitHub token", re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}|" + r"github" + r"_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,}")),
    ("JWT-like token", re.compile(r"ey" + r"J[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("Google API key", re.compile(r"AI" + r"za[0-9A-Za-z_-]{35}")),
    ("OpenAI API key", re.compile(r"sk" + r"-(?!ant-)[A-Za-z0-9_-]{32,}")),
    ("AWS access key", re.compile(r"AK" + r"IA[0-9A-Z]{16}")),
    ("npm access token", re.compile(r"npm" + r"_[A-Za-z0-9]{36}")),
    ("Google OAuth client secret", re.compile(r"GOCSPX" + r"-[A-Za-z0-9_-]{28,}")),
    ("SendGrid API key", re.compile(r"SG" + r"\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}")),
    ("Anthropic API key", re.compile(r"sk" + r"-ant-[A-Za-z0-9_-]{32,}")),
    ("Slack token", re.compile(r"xox" + r"[baprs]-[A-Za-z0-9-]{20,}")),
    ("Stripe webhook secret", re.compile(r"wh" + r"sec_[A-Za-z0-9]{20,}")),
    ("Private key block", re.compile(r"-----BEGIN " + r"[A-Z ]*PRIVATE KEY-----")),
]

SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz",
    ".woff", ".woff2", ".ttf", ".pyc", ".sqlite", ".db",
}
SKIP_DIR_PARTS = {".git", "node_modules", ".next", "__pycache__"}


def candidate_files() -> list[pathlib.Path]:
    out = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        text=True,
    )
    return [pathlib.Path(line) for line in dict.fromkeys(out.splitlines()) if line]


def should_skip(path: pathlib.Path) -> bool:
    return path.suffix.lower() in SKIP_SUFFIXES or any(part in SKIP_DIR_PARTS for part in path.parts)


def main() -> int:
    findings: list[str] = []
    for path in candidate_files():
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
        print("High-confidence secret patterns found in candidate files:", file=sys.stderr)
        for item in findings:
            print(f"- {item}", file=sys.stderr)
        print("Rotate/revoke the credential, remove it from git history if public, then rerun.", file=sys.stderr)
        return 1
    print("No high-confidence secret patterns found in candidate files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
