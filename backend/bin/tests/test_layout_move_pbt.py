"""Property-based test for directory-move residual-path absence.

Feature: platform-modernization, Property 13: 디렉터리 이동 잔여 경로 부재
Validates: Requirements 6.4, 6.5, 6.10

This exercises ``check_directory_move`` in ``backend/bin/check_layout_manifest.py``
without any live git state. ``backend/bin`` scripts are standalone (no
``__init__.py``), so the module is loaded by path — the same loading pattern the
sibling ``test_check_layout_manifest_unittest.py`` and ``test_schema_mirror_pbt.py``
use.

The core invariant (Requirement 6.4) is a biconditional over the before/after
tracked-match counts: a declared directory move passes **iff** the before-path
tracked-match count is exactly 0 **and** the after-path tracked-match count is
exactly 1. Any other ``(before, after)`` count pair — ``(0,0)`` (nothing landed),
``(1,0)`` (moved back / never moved), ``(1,1)`` (residual copy left behind) —
fails with ``directory_move_residual_path`` and the recorded counts.

A directory path is unique in a tree, so placing *any* number of tracked files
under a path yields a match count of exactly 1 for that path, and placing none
yields 0. The generator therefore seeds N (0/1/multiple) files under the
before-path and M under the after-path and asserts the count collapses to the
0/1 present-flag and the biconditional holds. Stale-reference and alias
dimensions (Requirements 6.5, 6.10) are covered lightly: the residual before
path a move check flags is exactly the kind of leftover an alias / stale scan
would also surface, and the returned code is always confined to the checker's
closed result set.

Runnable via ``python -m unittest`` from the repo root. Requires ``hypothesis``.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Load the standalone backend/bin module by path (no package import available).
# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "backend" / "bin" / "check_layout_manifest.py"

_spec = importlib.util.spec_from_file_location("check_layout_manifest", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
clm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(clm)


# ---------------------------------------------------------------------------
# Scenario generator.
#
# The before-path and after-path are placed under disjoint top-level roots so
# neither is a prefix of the other and neither can accidentally match noise
# files. This keeps the before/after tracked-match counts independent: the
# before count reflects only before-path files and the after count only
# after-path files, so the generated (n_before, n_after) pair maps cleanly onto
# the reported (beforeMatchCount, afterMatchCount).
# ---------------------------------------------------------------------------

_SEG = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz0123456789-_",
    min_size=1,
    max_size=8,
)
_COUNT = st.integers(min_value=0, max_value=4)


@st.composite
def move_scenarios(draw):
    seg = draw(_SEG)
    # Disjoint roots -> before is never a prefix of after (or vice versa) and
    # neither collides with the "misc/" noise namespace.
    before_path = f"legacy/{seg}"
    after_path = f"deploy/{seg}"

    n_before = draw(_COUNT)  # residual files left under the moved-from path
    n_after = draw(_COUNT)  # files that landed under the moved-to path
    n_noise = draw(st.integers(min_value=0, max_value=3))

    files: list[str] = []
    for i in range(n_before):
        files.append(f"{before_path}/mod_{i}.py")
    for i in range(n_after):
        files.append(f"{after_path}/mod_{i}.py")
    for i in range(n_noise):
        files.append(f"misc/keep_{i}.txt")

    files = list(draw(st.permutations(files)))
    return {
        "before_path": before_path,
        "after_path": after_path,
        "n_before": n_before,
        "n_after": n_after,
        "files": files,
    }


class DirectoryMoveResidualPathProperty(unittest.TestCase):
    # Feature: platform-modernization, Property 13: 디렉터리 이동 잔여 경로 부재
    # Validates: Requirements 6.4, 6.5, 6.10
    @settings(max_examples=100, deadline=None)
    @given(scenario=move_scenarios())
    def test_property_13_move_residual_biconditional(self, scenario) -> None:
        before_path = scenario["before_path"]
        after_path = scenario["after_path"]
        n_before = scenario["n_before"]
        n_after = scenario["n_after"]

        result = clm.check_directory_move(before_path, after_path, scenario["files"])

        # A directory path is unique in the tree, so any positive number of
        # tracked files under a path collapses to a match count of exactly 1.
        expected_before_count = 1 if n_before > 0 else 0
        expected_after_count = 1 if n_after > 0 else 0
        self.assertEqual(result["beforeMatchCount"], expected_before_count)
        self.assertEqual(result["afterMatchCount"], expected_after_count)

        # The recorded paths are echoed back verbatim (no Forbidden_Log_Field,
        # only the two paths and their counts).
        self.assertEqual(result["beforePath"], before_path)
        self.assertEqual(result["afterPath"], after_path)

        # Requirement 6.4 core invariant: pass iff (before==0 AND after==1).
        should_pass = expected_before_count == 0 and expected_after_count == 1
        self.assertEqual(result["ok"], should_pass)

        if should_pass:
            self.assertIsNone(result["errorCode"])
        else:
            # Every other (before, after) pair — (0,0), (1,0), (1,1) — is a
            # residual/incomplete move and fails with the fixed code.
            self.assertEqual(
                result["errorCode"], clm.DIRECTORY_MOVE_RESIDUAL_PATH
            )

        # Requirements 6.5 / 6.10: whatever the verdict, the emitted code stays
        # inside the checker's closed result set (a residual before-path is the
        # same class of leftover an alias / stale-reference scan would surface).
        self.assertIn(result["errorCode"], clm.LAYOUT_CHECK_RESULT_CODES)

    @settings(max_examples=100, deadline=None)
    @given(
        seg=_SEG,
        n_before=st.integers(min_value=1, max_value=5),
        n_after=st.integers(min_value=1, max_value=5),
    )
    def test_property_13_multiple_files_collapse_to_residual(
        self, seg, n_before, n_after
    ) -> None:
        # A completed move leaves the before-path empty; if *any* residual files
        # remain there (even alongside a fully-populated after-path), the move
        # fails regardless of how many files sit on either side — the count
        # never exceeds 1 and (1, 1) is still a residual failure.
        before_path = f"legacy/{seg}"
        after_path = f"deploy/{seg}"
        files = [f"{before_path}/r_{i}.py" for i in range(n_before)]
        files += [f"{after_path}/a_{i}.py" for i in range(n_after)]

        result = clm.check_directory_move(before_path, after_path, files)

        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], clm.DIRECTORY_MOVE_RESIDUAL_PATH)
        self.assertEqual(result["beforeMatchCount"], 1)
        self.assertEqual(result["afterMatchCount"], 1)


if __name__ == "__main__":
    unittest.main()
