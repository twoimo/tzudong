"""Property-based test for performance evidence path separation.

Feature: platform-modernization (Requirement 3; design C1, D3/D4). This test
targets the two-directional path separation surface implemented in task 45,
``backend.pipeline_control.performance_evidence.check_evidence_path_separation``.
It encodes design Property 10 ("성능 증거 경로 분리"), uses Python ``hypothesis``
(min 100 examples), and runs under ``python -m unittest``.

The property is the biconditional in Requirements 3.6 and 3.9: a set of raw
artifact paths and budget-input paths is a ``performance_evidence_path_violation``
IF AND ONLY IF the paths cross the boundary — i.e. a Rust_Component raw artifact
lives under ``apps/web/performance/*`` or outside ``backend/performance/``, or a
canonical budget input lives under ``backend/performance/`` or outside
``apps/web/performance/*``. When no path crosses, the check must pass. Both
directions are exercised by the generator.
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control import performance_evidence as pe

# ---------------------------------------------------------------------------
# Independent oracle for design Property 10.
#
# Reimplements the path normalization (forward-slash, drop leading "./") and the
# two-directional boundary rule directly from Requirements 3.6/3.9 so the test
# does not lean on the module's own predicates.
# ---------------------------------------------------------------------------
_BACKEND_PREFIX = "backend/performance/"
_WEB_PREFIX = "apps/web/performance/"


def _normalize(path: str) -> str:
    text = str(path).strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text


def _under_backend(path: str) -> bool:
    return _normalize(path).startswith(_BACKEND_PREFIX)


def _under_web(path: str) -> bool:
    return _normalize(path).startswith(_WEB_PREFIX)


def _expected_violation(raw_paths, budget_paths) -> bool:
    """True IFF any path crosses the backend/web performance boundary."""

    for raw in raw_paths:
        # A raw artifact under the web tree, or one not under the backend tree,
        # is a crossing.
        if _under_web(raw) or not _under_backend(raw):
            return True
    for budget in budget_paths:
        # A canonical budget input under the backend tree, or one not under the
        # web tree, is a crossing.
        if _under_backend(budget) or not _under_web(budget):
            return True
    return False


# ---------------------------------------------------------------------------
# Generators.
#
# Paths are drawn from four categories so both a compliant configuration and
# every kind of crossing (raw-under-web, raw-outside-backend, budget-under-
# backend, budget-outside-web) appear with meaningful frequency. Separators are
# occasionally corrupted with backslashes and leading "./" to exercise
# normalization, and the two lists are independently allowed to be empty (an
# empty configuration must never be a violation).
# ---------------------------------------------------------------------------
_SEGMENT = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz0123456789-_.",
    min_size=1,
    max_size=8,
).filter(lambda s: s not in (".", ".."))

_SUFFIX = st.lists(_SEGMENT, min_size=1, max_size=3).map(lambda parts: "/".join(parts))


def _decorate(draw, path: str) -> str:
    """Optionally add a leading ``./`` or convert to backslash separators."""

    if draw(st.booleans()):
        path = "./" + path
    if draw(st.booleans()):
        path = path.replace("/", "\\")
    return path


@st.composite
def _paths(draw):
    """Draw ``(raw_artifact_paths, budget_input_paths)`` across all categories."""

    def one_path():
        category = draw(
            st.sampled_from(
                ("backend_perf", "web_perf", "other_backend", "other_root")
            )
        )
        suffix = draw(_SUFFIX)
        if category == "backend_perf":
            base = _BACKEND_PREFIX + suffix
        elif category == "web_perf":
            base = _WEB_PREFIX + suffix
        elif category == "other_backend":
            base = "backend/" + suffix
        else:
            base = suffix
        return _decorate(draw, base)

    raw_count = draw(st.integers(min_value=0, max_value=4))
    budget_count = draw(st.integers(min_value=0, max_value=4))
    raw_paths = [one_path() for _ in range(raw_count)]
    budget_paths = [one_path() for _ in range(budget_count)]
    return raw_paths, budget_paths


class PerformanceEvidencePathSeparationProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 10: 성능 증거 경로 분리.
    # For all sets of raw artifact paths and budget-input paths, the check
    # returns performance_evidence_path_violation IF AND ONLY IF a path crosses
    # the boundary (a raw artifact under apps/web/performance/* or outside
    # backend/performance/, or a canonical budget input under backend/performance/
    # or outside apps/web/performance/*).
    # Validates: Requirements 3.6, 3.9
    @settings(max_examples=100, deadline=None)
    @given(paths=_paths())
    def test_path_separation_biconditional(self, paths):
        raw_paths, budget_paths = paths
        result = pe.check_evidence_path_separation(raw_paths, budget_paths)

        expected_violation = _expected_violation(raw_paths, budget_paths)

        if expected_violation:
            # A crossing must be rejected with the dedicated fixed code.
            self.assertFalse(result["ok"])
            self.assertEqual(result["code"], pe.CODE_PATH_VIOLATION)
        else:
            # No crossing must pass and carry no rejection code.
            self.assertTrue(result["ok"])
            self.assertIsNone(result["code"])


if __name__ == "__main__":
    unittest.main()
