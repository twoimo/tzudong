"""Reject tracked documents accidentally replaced by bounded read-tool output."""

from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DOCUMENT_SUFFIXES = frozenset({".md", ".mdx", ".rst", ".txt"})
LINE_PREFIX_PATTERNS = (
    re.compile(r"^\s*\d+[→│]\s?"),
    re.compile(r"^\s*L\d+[:→]\s?"),
    re.compile(r"^\s*\d+[A-Za-z]{1,12}\|{1,2}\s?"),
)
TRUNCATION_PATTERNS = (
    re.compile(r"\[Showing (?:first|last|lines)\b", re.IGNORECASE),
    re.compile(r"Warning:\s*truncated output", re.IGNORECASE),
    re.compile(r"\.{3}\d+\s+(?:chars|tokens|lines)\s+truncated\.{3}", re.IGNORECASE),
    re.compile(r"\boriginal token count:\s*\d+\b", re.IGNORECASE),
)


def corruption_markers(text: str) -> list[str]:
    markers: list[str] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if any(pattern.search(line) for pattern in LINE_PREFIX_PATTERNS):
            markers.append(f"line {line_number}: read-tool prefix")
    for pattern in TRUNCATION_PATTERNS:
        match = pattern.search(text)
        if match is not None:
            markers.append(f"offset {match.start()}: truncation marker")
    return markers


def tracked_documents() -> list[Path]:
    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return sorted(
        REPO_ROOT / Path(raw.decode("utf-8"))
        for raw in completed.stdout.split(b"\0")
        if raw and Path(raw.decode("utf-8")).suffix.lower() in DOCUMENT_SUFFIXES
    )


class TrackedDocumentIntegrityTests(unittest.TestCase):
    def test_marker_detector_catches_read_prefix_and_truncation_footer(self) -> None:
        damaged = (
            "1→# Contract\n"
            "40xd|| GDrive evidence\n"
            "41cg| Additional evidence\n"
            "[Showing last 20 lines of 84 total lines]\n"
        )
        self.assertEqual(len(corruption_markers(damaged)), 4)

    def test_marker_detector_ignores_normal_markdown_numbers_and_inline_locations(self) -> None:
        legitimate = (
            "12. Ordered list item\n"
            "| 12 | table value |\n"
            "The relevant source location is L12:3.\n"
            "`40xd||` is quoted as a corruption example, not a line prefix.\n"
        )
        self.assertEqual(corruption_markers(legitimate), [])

    def test_tracked_documents_have_no_read_tool_corruption_markers(self) -> None:
        findings: list[str] = []
        for path in tracked_documents():
            text = path.read_text(encoding="utf-8")
            findings.extend(
                f"{path.relative_to(REPO_ROOT)}: {marker}"
                for marker in corruption_markers(text)
            )
        self.assertEqual(findings, [], "\n".join(findings[:20]))
    def test_n3_live_evidence_docs_do_not_claim_completed_parity(self) -> None:
        forbidden = (
            "after N=3 healthy live parity",
            "removed after N=3 healthy live parity",
            "Isolated cutover removed",
        )
        docs = (
            REPO_ROOT / "backend" / "ARCHITECTURE.md",
            REPO_ROOT / "backend" / "deploy" / "pipeline-control" / "lite-gha.md",
            REPO_ROOT / "backend" / "deploy" / "pipeline-control" / "harbor-tags.md",
        )
        findings: list[str] = []
        for path in docs:
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden:
                if phrase in text:
                    findings.append(f"{path.relative_to(REPO_ROOT)}: {phrase}")
            self.assertIn("`liveEvidenceEligible` stays false", text)
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()
