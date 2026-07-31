#!/usr/bin/env python3
"""G038 local-lane historical-exclusion scanner (H4).

The acceptance rule is NOT defined here. It is frozen verbatim in the
consensus-carrying manifest (stage-06-revision.md SHA
edb9ed0f637249581587e8703086a90954459b735a0e4821997acbc423756089) and this
module implements exactly that rule and nothing else:

  * Scan set: exactly P1 and H3 -- both of which reach the database in
    Phase 2b.
  * Reject if any of these literals appears OUTSIDE a SQL comment:
    20260713002500, 20260713002600, 20260713002700, g026, G026.
  * Comment rule, frozen: a line is a comment if its first non-whitespace
    characters are '--'; a region between '/*' and '*/' is a comment.
    Matches inside comments are ignored. No other exclusion applies.
  * exact42, "row 43" and I0 are NOT scan literals. exact42 and "row 43" are
    not matchable SQL tokens; I0 is a two-character sequence that would match
    unrelated identifiers and produce false rejections. All three are enforced
    structurally instead: this lane starts no container and opens no
    connection, and neither scanned file contains a hosted connection string.
  * Exit 0 on clean; exit 1 on any hit, printing the offending file, line
    number and matched literal.

This scanner performs no network, container, database or credential action.
It reads exactly two files and writes nothing.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Frozen scan set (manifest: "exactly P1 and H3").
SCAN_SET = (
    "backend/supabase/migrations/20260728000100_g038_deterministic_contract.sql",
    "backend/supabase/tests/g038_catalog_assertions.sql",
)

# Frozen reject literals. Order is the manifest's order and is preserved so
# that reported hits are deterministic.
REJECT_LITERALS = (
    "20260713002500",
    "20260713002600",
    "20260713002700",
    "g026",
    "G026",
)

# Sentinel used to report an absent scan-set member. It is deliberately NOT a
# member of REJECT_LITERALS: an absent file is a hard failure, but it is not a
# literal match, and reporting it as one would assert a match that never
# occurred at a line that does not exist.
MISSING_TARGET = "<absent>"


def strip_sql_comments(text: str) -> list[str]:
    """Blank out SQL comment regions, preserving line count and column offsets.

    Implements exactly the manifest's frozen comment rule:
      * a line is a comment if its first non-whitespace characters are '--'
      * a region between '/*' and '*/' is a comment

    Comment characters are replaced with spaces rather than removed, so line
    numbers and column positions of surviving code are unchanged. This keeps
    reported line numbers faithful to the file on disk.
    """
    lines = text.split("\n")
    out: list[str] = []
    in_block = False

    for raw in lines:
        # Whole-line comment: first non-whitespace characters are '--'.
        if not in_block and raw.lstrip().startswith("--"):
            out.append("")
            continue

        buf: list[str] = []
        i = 0
        n = len(raw)
        while i < n:
            if in_block:
                if raw.startswith("*/", i):
                    in_block = False
                    buf.append("  ")
                    i += 2
                else:
                    buf.append(" ")
                    i += 1
                continue

            if raw.startswith("/*", i):
                in_block = True
                buf.append("  ")
                i += 2
                continue

            # NOTE: a trailing (mid-line) '--' is deliberately NOT treated as a
            # comment. The manifest's frozen rule admits exactly two comment
            # forms -- a line whose first non-whitespace characters are '--',
            # and a '/* ... */' region -- and states "No other exclusion
            # applies." Blanking a mid-line '--' remainder would be a wider
            # exclusion than the frozen rule authorizes, and it errs toward
            # permissiveness: a forbidden literal placed after a trailing '--'
            # would escape detection. Scanning it is fail-closed and conformant.

            buf.append(raw[i])
            i += 1

        out.append("".join(buf))

    return out


def scan_file(repo_root: Path, rel_path: str) -> list[tuple[str, int, str]]:
    """Return every (rel_path, line_number, literal) hit outside comments."""
    target = repo_root / rel_path
    if not target.is_file():
        # A missing scan-set member is itself a hard failure: the rule names
        # exactly two files and both must exist to be scanned. This is NOT a
        # literal match -- reporting it as one would assert a match that did
        # not occur, at a line that does not exist -- so it is returned as a
        # distinct absence record and rendered with its own message.
        return [(rel_path, 0, MISSING_TARGET)]

    text = target.read_text(encoding="utf-8")
    code_lines = strip_sql_comments(text)

    hits: list[tuple[str, int, str]] = []
    for lineno, line in enumerate(code_lines, start=1):
        for literal in REJECT_LITERALS:
            if literal in line:
                hits.append((rel_path, lineno, literal))
    return hits


def main() -> int:
    repo_root = Path(__file__).resolve().parents[3]

    all_hits: list[tuple[str, int, str]] = []
    for rel_path in SCAN_SET:
        all_hits.extend(scan_file(repo_root, rel_path))

    if all_hits:
        for rel_path, lineno, literal in all_hits:
            if literal == MISSING_TARGET:
                print(
                    f"REJECT {rel_path}: required scan-set member is absent; "
                    "both frozen files must exist to be scanned",
                    file=sys.stderr,
                )
            else:
                print(
                    f"REJECT {rel_path}:{lineno} matched excluded literal {literal!r}",
                    file=sys.stderr,
                )
        print(f"exclusion scan FAILED with {len(all_hits)} finding(s)", file=sys.stderr)
        return 1

    for rel_path in SCAN_SET:
        print(f"clean {rel_path}")
    print(f"exclusion scan PASSED over {len(SCAN_SET)} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
