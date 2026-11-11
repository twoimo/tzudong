#!/usr/bin/env python3
"""Render the GoTrue migration set into plain SQL.

The gotrue image ships its migrations as Go `text/template` files whose only
variable is `{{ index .Options "Namespace" }}` (the auth schema name). Applying
them raw fails at the first placeholder, so any replay that needs `auth.sessions`
and `auth.refresh_tokens` - including the local PostgreSQL 17 transition probe -
has to render them first.

Usage:
    docker create --name gotrue-src supabase/gotrue:v2.184.0
    docker export gotrue-src | tar -x -C /tmp/gotrue usr/local/etc/auth/migrations
    python3 backend/supabase/scripts/render_gotrue_migrations.py \
        --source /tmp/gotrue/usr/local/etc/auth/migrations --output /tmp/gotrue-rendered --schema auth

Nothing here runs Docker or the database; the caller applies the result.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

NAMESPACE = re.compile(r"\{\{\s*index\s+\.Options\s+\"Namespace\"\s*\}\}")
PLACEHOLDER = re.compile(r"\{\{[^}]*\}\}")


def render(text: str, schema: str) -> str:
    return NAMESPACE.sub(schema, text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--schema", default="auth")
    args = parser.parse_args()

    sources = sorted(args.source.glob("*.sql"))
    if not sources:
        print("no .sql migrations under the source directory", file=sys.stderr)
        return 1
    args.output.mkdir(parents=True, exist_ok=True)
    leftover = 0
    for path in sources:
        rendered = render(path.read_text(encoding="utf-8"), args.schema)
        if PLACEHOLDER.search(rendered):
            leftover += 1
        (args.output / path.name).write_text(rendered, encoding="utf-8")
    if leftover:
        print(f"{leftover} migration(s) still contain template placeholders", file=sys.stderr)
        return 1
    print(f"rendered {len(sources)} migrations into {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
