"""Source-contract test for repo-root .gitignore forbidden-path coverage.

Feature: crawler-pipeline-orchestration

Requirement 8.7 mandates a repository ignore configuration that excludes from
source control every forbidden-path category:
  - crawl and evaluation data directories,
  - newline-delimited JSON dataset files,
  - environment files,
  - OAuth credential files,
  - session files,
  - cookie files, and
  - provider credential directories.

Requirement 8.2 mandates that crawl/evaluation datasets are never committed to
the public repository; the ignore configuration is the standing mechanism that
keeps those datasets out of source control.

This is a read-only contract test. It reads the committed repo-root .gitignore
and asserts each forbidden category is covered by a pattern that is actually
present. It never modifies .gitignore.
"""

from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
GITIGNORE_PATH = REPO_ROOT / ".gitignore"


def _load_patterns() -> list[str]:
    """Return the active (non-comment, non-empty) .gitignore pattern lines."""
    text = GITIGNORE_PATH.read_text(encoding="utf-8")
    patterns: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(line)
    return patterns


class GitignoreForbiddenPathsTest(unittest.TestCase):
    """Assert every Requirement 8.7 forbidden-path category is ignored."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.patterns = _load_patterns()
        cls.pattern_set = set(cls.patterns)

    def _assert_any_present(self, category: str, candidates: list[str]) -> None:
        """Assert at least one of the equivalent patterns is present."""
        present = [c for c in candidates if c in self.pattern_set]
        self.assertTrue(
            present,
            msg=(
                f"{category}: none of the expected .gitignore patterns are "
                f"present. Expected at least one of {candidates!r}."
            ),
        )

    def test_gitignore_file_exists(self) -> None:
        self.assertTrue(
            GITIGNORE_PATH.is_file(),
            msg=f"repo-root .gitignore not found at {GITIGNORE_PATH}",
        )
        self.assertTrue(self.patterns, msg=".gitignore has no active patterns")

    def test_crawl_and_evaluation_data_dirs_excluded(self) -> None:
        # Crawl dataset directory (kept Supabase + local Mac only).
        self._assert_any_present(
            "crawl data directory",
            [
                "backend/restaurant-crawling/data/tzuyang/",
                "backend/restaurant-crawling/data/frames/",
            ],
        )
        # Evaluation dataset directory.
        self._assert_any_present(
            "evaluation data directory",
            ["backend/restaurant-evaluation/data/"],
        )

    def test_jsonl_dataset_files_excluded(self) -> None:
        # Newline-delimited JSON dataset files, anywhere in the tree.
        self._assert_any_present(
            "newline-delimited JSON dataset files",
            ["**/*.jsonl"],
        )

    def test_environment_files_excluded(self) -> None:
        # Environment files, anywhere in the tree (secret safety net).
        self._assert_any_present(
            "environment files",
            ["**/.env", ".env"],
        )

    def test_oauth_credential_files_excluded(self) -> None:
        # OAuth credential files.
        self._assert_any_present(
            "OAuth credential files",
            ["**/oauth_creds.json"],
        )

    def test_session_files_excluded(self) -> None:
        # Session files (e.g. *session.json).
        self._assert_any_present(
            "session files",
            ["**/*session.json"],
        )

    def test_cookie_files_excluded(self) -> None:
        # Cookie files (txt/json forms).
        self._assert_any_present(
            "cookie files",
            ["**/cookies.txt", "**/cookies.json"],
        )

    def test_provider_credential_directories_excluded(self) -> None:
        # Provider credential directories (e.g. Gemini agent state).
        self._assert_any_present(
            "provider credential directories",
            ["**/.gemini/", ".gemini/"],
        )


if __name__ == "__main__":
    unittest.main()
