"""Property tests for non-destructive, candidate-bound rollback plans."""

from __future__ import annotations

import copy
import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.bin.phase_gate import (
    ROLLBACK_FORBIDDEN_COMMAND,
    ROLLBACK_REFERENCE_MISMATCH,
    ROLLBACK_VERIFICATION_INCOMPLETE,
    ROLLBACK_WORKTREE_ESCAPE,
    load_phase_catalog,
    validate_rollback_plan,
)


TREE_ID = "b" * 64


def valid_plan(catalog, phase_index: int = 0):
    phase = catalog["phases"][phase_index]
    return {
        "schemaVersion": 1,
        "kind": "rollback_plan",
        "phaseId": phase["phaseId"],
        "planRef": phase["rollbackPlanRef"],
        "recoveryCandidateTreeId": TREE_ID,
        "affectedPaths": ["backend/bin/phase_gate.py"],
        "commands": [
            {
                "worktreeId": TREE_ID,
                "argv": ["git", "revert", "--no-edit", "c" * 40],
            }
        ],
        "postRollbackVerification": [
            {"cwd": item["cwd"], "argv": item["argv"]}
            for item in catalog["verificationCommands"]
        ],
    }


class RollbackPlanPropertyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = load_phase_catalog()

    @settings(max_examples=50, deadline=None)
    @given(phase_index=st.integers(min_value=0, max_value=6))
    def test_valid_plan_covers_every_phase(self, phase_index: int) -> None:
        plan = valid_plan(self.catalog, phase_index)
        result = validate_rollback_plan(
            plan,
            catalog=self.catalog,
            phase_id=plan["phaseId"],
            candidate_tree_id=TREE_ID,
        )
        self.assertEqual(result, {"ok": True, "errorCode": None})

    @settings(max_examples=100, deadline=None)
    @given(
        subcommand=st.sampled_from(
            ("reset", "stash", "clean", "checkout", "switch", "restore")
        ),
        suffix=st.lists(st.text(alphabet="abc012-", min_size=1, max_size=8), max_size=3),
    )
    def test_destructive_git_commands_are_always_rejected(
        self, subcommand: str, suffix: list[str]
    ) -> None:
        plan = valid_plan(self.catalog)
        plan["commands"][0]["argv"] = ["git", subcommand, *suffix]
        result = validate_rollback_plan(plan, catalog=self.catalog)
        self.assertEqual(result["errorCode"], ROLLBACK_FORBIDDEN_COMMAND)

    @settings(max_examples=50, deadline=None)
    @given(tree_id=st.text(alphabet="abcdef0123456789", min_size=64, max_size=64).filter(lambda value: value != TREE_ID))
    def test_every_command_is_bound_to_the_exact_candidate(self, tree_id: str) -> None:
        plan = valid_plan(self.catalog)
        plan["commands"][0]["worktreeId"] = tree_id
        result = validate_rollback_plan(plan, catalog=self.catalog)
        self.assertEqual(result["errorCode"], ROLLBACK_WORKTREE_ESCAPE)

    @settings(max_examples=50, deadline=None)
    @given(index=st.integers(min_value=0, max_value=6))
    def test_post_rollback_verification_must_equal_the_canonical_set(self, index: int) -> None:
        plan = valid_plan(self.catalog)
        del plan["postRollbackVerification"][index]
        result = validate_rollback_plan(plan, catalog=self.catalog)
        self.assertEqual(result["errorCode"], ROLLBACK_VERIFICATION_INCOMPLETE)

    def test_phase_and_plan_reference_must_match_catalog(self) -> None:
        plan = valid_plan(self.catalog)
        plan["planRef"] = "backend/log/phases/not-the-plan.json"
        result = validate_rollback_plan(plan, catalog=self.catalog)
        self.assertEqual(result["errorCode"], ROLLBACK_REFERENCE_MISMATCH)


if __name__ == "__main__":
    unittest.main()
