"""Property-based test for Rollback_Plan forbidden-command validation.

Feature: platform-modernization (Requirement 16). This test targets the
Rollback_Plan validation surface of the Phase_Gate runner
``backend/bin/phase_gate.py`` (task 1, design section C12). It encodes design
Property 37, uses Python ``hypothesis`` (min 100 examples), and runs under
``python -m unittest``.

This is a test-first task: the Phase_Gate runner is implemented in task 1 and
may not exist yet. Following the established convention for ``backend/bin``
scripts (which are not an importable package and carry no ``__init__.py``), the
test loads ``backend/bin/phase_gate.py`` by file path and skips cleanly when the
module or the targeted validator is absent. As a result ``python -m unittest``
discovery always collects this file without error, and the encoded property runs
the moment task 1 lands the validator.

Intended interface (task 1 implements to match this contract):

  ``phase_gate.VERIFICATION_COMMANDS``
      An ordered collection of the seven Requirement 16.4 verification commands,
      each expressed as a ``(cwd, argv)`` pair.

  ``phase_gate.validate_rollback_plan(plan) -> {"ok": bool, "errorCode": str|None}``
      Mirrors the ``validate_cadence`` contract already used in this package
      (a dict with an ``ok`` boolean and a bounded ``errorCode`` from a closed
      set; ``None`` when accepted). Per design Property 37 it returns
      ``ok=True`` if and only if all three hold:

        * no command in ``plan["commands"]`` is a git ``reset`` / ``stash`` /
          ``clean`` invocation, and
        * every command targets the isolated recovery-candidate worktree named
          by ``plan["recoveryCandidateWorktreeId"]`` (no command targets the
          dirty original worktree), and
        * ``plan["postRollbackVerification"]`` includes the full set of the
          seven Requirement 16.4 commands.

      On rejection ``ok`` is ``False`` and ``errorCode`` is a bounded, non-empty
      string; on acceptance ``errorCode`` is ``None`` (or empty).
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Test-first module load: backend/bin scripts are not an importable package, so
# they are loaded by path (see backend/bin/tests/test_evaluate_new_youtube_videos.py).
# When task 1 has not landed phase_gate.py yet, the encoded property is skipped
# rather than failing collection.
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).resolve().parents[2]
_PHASE_GATE_PATH = _ROOT / "backend" / "bin" / "phase_gate.py"

_MODULE = None
_LOAD_ERROR = ""
if _PHASE_GATE_PATH.exists():
    try:
        _spec = importlib.util.spec_from_file_location("phase_gate", _PHASE_GATE_PATH)
        assert _spec and _spec.loader
        _MODULE = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_MODULE)
    except Exception as exc:  # pragma: no cover - defensive for the test-first phase
        _MODULE = None
        _LOAD_ERROR = f"phase_gate.py failed to import: {type(exc).__name__}"
else:
    _LOAD_ERROR = "backend/bin/phase_gate.py not implemented yet (task 1)"

_HAS_VALIDATOR = _MODULE is not None and hasattr(_MODULE, "validate_rollback_plan")
_HAS_COMMANDS = _MODULE is not None and hasattr(_MODULE, "VERIFICATION_COMMANDS")


# ---------------------------------------------------------------------------
# Fixtures for the property.
# ---------------------------------------------------------------------------

# The seven Requirement 16.4 verification commands (design C12 VERIFICATION_COMMANDS),
# each as a ``(cwd, argv)`` pair. This is the canonical set the Rollback_Plan
# post-rollback verification items must fully cover.
REQ_16_4_COMMANDS = (
    ("apps/web", ("bun", "run", "lint")),
    ("apps/web", ("bun", "run", "test:unit")),
    ("apps/web", ("npm", "run", "typecheck:parity")),
    ("apps/web", ("npm", "run", "build")),
    (".", ("python", "-m", "unittest", "backend.utils.tests.test_run_daily_regression")),
    (".", ("python", "-m", "unittest", "backend.pipeline.test_validators_unittest")),
    (".", ("python", "-m", "unittest", "backend.pipeline.test_data_contracts_unittest")),
)

# Forbidden git subcommands per Requirement 16.5 / design Property 37.
FORBIDDEN_GIT_SUBCOMMANDS = ("reset", "stash", "clean")

# Non-destructive git subcommands a rollback may legitimately use. None of these
# tokens (nor the clean paths below) contain the forbidden words, so "any token
# in the forbidden set" and "the git subcommand is in the forbidden set" agree
# on every generated command; the property does not depend on which detection
# strategy the validator uses.
ALLOWED_GIT_SUBCOMMANDS = (
    "checkout",
    "restore",
    "switch",
    "revert",
    "status",
    "worktree",
    "rev-parse",
)

# The isolated recovery-candidate worktree the rollback commands must be confined
# to, and a distinct dirty-original worktree that must never be targeted.
RECOVERY_CANDIDATE_WORKTREE = "recovery-candidate/platform-modernization"
DIRTY_ORIGINAL_WORKTREE = "origin-dirty-worktree"

# Clean target paths (free of any forbidden token) a command may reference.
CLEAN_PATHS = (
    "backend/deploy/pipeline-control",
    "backend/rust",
    "apps/web/scripts",
    "backend/log/phases",
)

# Extra verification items that are deliberately NOT part of the seven canonical
# commands, used to confirm that supersets/near-misses do not satisfy coverage.
_NON_16_4_ITEMS = (
    ("apps/web", ("bun", "run", "lint", "--fix")),
    (".", ("python", "-m", "pytest")),
    ("backend/rust", ("cargo", "test")),
)


@st.composite
def _rollback_command(draw):
    """A single rollback command with a target worktree and a git argv."""

    worktree = draw(st.sampled_from((RECOVERY_CANDIDATE_WORKTREE, DIRTY_ORIGINAL_WORKTREE)))
    subcommand = draw(st.sampled_from(ALLOWED_GIT_SUBCOMMANDS + FORBIDDEN_GIT_SUBCOMMANDS))
    argv = ["git", subcommand]
    if draw(st.booleans()):
        argv.append(draw(st.sampled_from(CLEAN_PATHS)))
    return {"worktreeId": worktree, "argv": argv}


@st.composite
def _verification_items(draw):
    """A post-rollback verification list: any subset of the seven, plus extras.

    Keeping a random subset lets the generator exercise both complete coverage
    (all seven present) and incomplete coverage (at least one missing).
    """

    keep = draw(st.lists(st.booleans(), min_size=7, max_size=7))
    items = [
        {"cwd": cwd, "argv": list(argv)}
        for keep_it, (cwd, argv) in zip(keep, REQ_16_4_COMMANDS)
        if keep_it
    ]
    for cwd, argv in draw(st.lists(st.sampled_from(_NON_16_4_ITEMS), max_size=3)):
        items.append({"cwd": cwd, "argv": list(argv)})
    return items


@st.composite
def _rollback_plans(draw):
    """A Rollback_Plan record with commands, verification items, and metadata."""

    return {
        "targetPaths": draw(st.lists(st.sampled_from(CLEAN_PATHS), max_size=4)),
        "commands": draw(st.lists(_rollback_command(), max_size=6)),
        "postRollbackVerification": draw(_verification_items()),
        "successCriteria": "all seven verification commands pass on the recovery candidate",
        "recoveryCandidateWorktreeId": RECOVERY_CANDIDATE_WORKTREE,
    }


def _expected_ok(plan) -> bool:
    """Independent oracle for design Property 37."""

    has_forbidden = any(
        len(cmd["argv"]) >= 2
        and cmd["argv"][0] == "git"
        and cmd["argv"][1] in FORBIDDEN_GIT_SUBCOMMANDS
        for cmd in plan["commands"]
    )
    targets_dirty = any(
        cmd["worktreeId"] != plan["recoveryCandidateWorktreeId"] for cmd in plan["commands"]
    )
    present = {
        (item["cwd"], tuple(item["argv"])) for item in plan["postRollbackVerification"]
    }
    verification_complete = all(command in present for command in REQ_16_4_COMMANDS)
    return (not has_forbidden) and (not targets_dirty) and verification_complete


def _result_ok(result):
    """Extract the ``ok`` flag from a dict result (validate_cadence convention)."""

    if isinstance(result, dict):
        return result["ok"], result.get("errorCode")
    # Tolerate an attribute-style result object as a fallback.
    return bool(getattr(result, "ok")), getattr(result, "errorCode", None)


class RollbackPlanForbiddenCommandProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 37: Rollback_Plan 금지 명령 부재.
    # For all Rollback_Plan command lists, the validator returns pass IFF the
    # command list has no git reset/stash/clean and no command targeting the
    # dirty original worktree, and the post-rollback verification items include
    # the full set of the seven Requirement 16.4 commands.
    # Validates: Requirements 16.5, 16.8
    @unittest.skipUnless(_HAS_VALIDATOR, _LOAD_ERROR or "validate_rollback_plan unavailable")
    @settings(max_examples=100, deadline=None)
    @given(plan=_rollback_plans())
    def test_rollback_plan_forbidden_command_absence(self, plan):
        result = _MODULE.validate_rollback_plan(plan)
        ok, error_code = _result_ok(result)

        self.assertEqual(ok, _expected_ok(plan))

        if ok:
            # Accepted plans carry no rejection code.
            self.assertIn(error_code, (None, ""))
        else:
            # Rejections use a bounded, non-empty fixed code.
            self.assertIsInstance(error_code, str)
            self.assertGreater(len(error_code), 0)

    # The declared verification command set must be exactly the seven
    # Requirement 16.4 commands (design C12), independent of ordering.
    @unittest.skipUnless(_HAS_COMMANDS, _LOAD_ERROR or "VERIFICATION_COMMANDS unavailable")
    def test_verification_commands_cover_the_seven_requirement_16_4_commands(self):
        declared = {(cwd, tuple(argv)) for cwd, argv in _MODULE.VERIFICATION_COMMANDS}
        expected = {(cwd, tuple(argv)) for cwd, argv in REQ_16_4_COMMANDS}
        self.assertEqual(declared, expected)


if __name__ == "__main__":
    unittest.main()
