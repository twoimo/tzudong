"""Property-based test for step terminal-status exclusivity.

Feature: platform-modernization, Property 15: 단계 종료 상태 배타성.

This test targets the pure composition policy in
``backend/pipeline_control/profiles.py:compose_step_plan`` (implemented in Task
4). For every (compute_profile, data_sink, target capability set, step outcome)
combination it asserts the invariant behind Property 15:

- the succeeded / failed / skipped step lists are mutually exclusive, and their
  union covers all 18 ``STEP_SPECS`` ids exactly once;
- every skip entry carries a reason code drawn from the bounded
  ``SKIP_REASON_CODES`` set (no free-form reason leaks into the plan);
- when a required step fails, the steps that depend on it (via ``skip_after``)
  are all marked skipped rather than succeeded (R8.10 downstream propagation).

It reuses the Hypothesis strategy vocabulary from ``test_profiles_pbt.py``
(``_CAP_TOKENS`` and ``_SAFE_SINKS``), uses Python ``hypothesis`` with
``max_examples=100``, and runs under ``python -m unittest``.

Validates: Requirements 8.1, 8.5, 8.10
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.graph import STEP_BY_ID, STEP_SPECS
from backend.pipeline_control.profiles import (
    STEP_STATUS_FAILED,
    STEP_STATUS_SKIPPED,
    STEP_STATUS_SUCCEEDED,
    SKIP_REASON_CODES,
    compose_step_plan,
)

# Reuse the strategy vocabulary defined for the profile skip-decision tests so
# the generated compute profiles, safe data sinks, and capability tokens stay in
# lockstep with the existing Property 4/5/6 coverage.
from backend.pipeline_control.test_profiles_pbt import _CAP_TOKENS, _SAFE_SINKS

# Every step id in the declarative graph. Property 15's union invariant is
# checked against this full set (18 steps).
_ALL_STEP_IDS = frozenset(spec.id for spec in STEP_SPECS)

# Both admitted compute profiles; hosted_apply is intentionally excluded from
# _SAFE_SINKS because it is fail-closed and never yields a composed plan.
_COMPUTE_PROFILES = ("heavy_local", "lite_gha")

# Outcome tokens a run-candidate step may report. Only "failed" changes the
# terminal status away from the succeeded default, but generating the other
# tokens stresses that compose_step_plan treats any non-failed outcome as a
# success rather than mis-classifying it.
_OUTCOME_TOKENS = (
    STEP_STATUS_SUCCEEDED,
    STEP_STATUS_FAILED,
    STEP_STATUS_SKIPPED,
    "unknown",
)

_outcomes_strategy = st.dictionaries(
    keys=st.sampled_from(sorted(_ALL_STEP_IDS)),
    values=st.sampled_from(_OUTCOME_TOKENS),
)


class StepCompositionExclusivityProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 15: 단계 종료 상태 배타성.
    # For all (compute profile, data sink, capability set, outcomes), the
    # succeeded/failed/skipped lists are mutually exclusive, their union is
    # exactly the 18 STEP_SPECS ids, every skip reason code is in the bounded
    # SKIP_REASON_CODES set, and any step depending on a non-succeeded step is
    # itself skipped.
    # Validates: Requirements 8.1, 8.5, 8.10
    @settings(max_examples=100)
    @given(
        compute_profile=st.sampled_from(_COMPUTE_PROFILES),
        data_sink=st.sampled_from(_SAFE_SINKS),
        capabilities=st.one_of(
            st.none(),
            st.sets(st.sampled_from(_CAP_TOKENS)),
        ),
        outcomes=_outcomes_strategy,
    )
    def test_step_terminal_status_is_exclusive_and_total(
        self, compute_profile, data_sink, capabilities, outcomes
    ):
        plan = compose_step_plan(
            compute_profile=compute_profile,
            data_sink=data_sink,
            capabilities=capabilities,
            outcomes=outcomes,
        )

        succeeded = list(plan["succeededSteps"])
        failed = list(plan["failedSteps"])
        skipped_entries = list(plan["skippedSteps"])
        skipped = [str(entry["step"]) for entry in skipped_entries]

        succeeded_set = set(succeeded)
        failed_set = set(failed)
        skipped_set = set(skipped)

        # No status list repeats a step within itself.
        self.assertEqual(len(succeeded), len(succeeded_set))
        self.assertEqual(len(failed), len(failed_set))
        self.assertEqual(len(skipped), len(skipped_set))

        # The three lists are pairwise mutually exclusive.
        self.assertEqual(succeeded_set & failed_set, set())
        self.assertEqual(succeeded_set & skipped_set, set())
        self.assertEqual(failed_set & skipped_set, set())

        # The union covers every one of the 18 steps exactly once.
        union = succeeded_set | failed_set | skipped_set
        self.assertEqual(union, set(_ALL_STEP_IDS))
        self.assertEqual(
            len(succeeded) + len(failed) + len(skipped), len(_ALL_STEP_IDS)
        )
        self.assertEqual(len(_ALL_STEP_IDS), 18)

        # The per-step "steps" record agrees with the three summary lists: every
        # step appears once with exactly one terminal status.
        status_by_id: dict[str, str] = {}
        for entry in plan["steps"]:
            step_id = str(entry["id"])
            self.assertNotIn(step_id, status_by_id, "step composed more than once")
            status_by_id[step_id] = str(entry["status"])
        self.assertEqual(set(status_by_id), set(_ALL_STEP_IDS))
        self.assertEqual(
            {sid for sid, s in status_by_id.items() if s == STEP_STATUS_SUCCEEDED},
            succeeded_set,
        )
        self.assertEqual(
            {sid for sid, s in status_by_id.items() if s == STEP_STATUS_FAILED},
            failed_set,
        )
        self.assertEqual(
            {sid for sid, s in status_by_id.items() if s == STEP_STATUS_SKIPPED},
            skipped_set,
        )

        # Every skip reason code is drawn from the bounded fixed set (R8.5): no
        # free-form reason string leaks into the composed plan.
        for entry in skipped_entries:
            self.assertIn("reasonCode", entry)
            self.assertIn(str(entry["reasonCode"]), SKIP_REASON_CODES)

        # R8.10 downstream propagation: a succeeded step can never depend on a
        # step that did not itself succeed. If its skip_after ancestor had
        # failed or been skipped, this step must have been marked skipped too.
        for step_id in succeeded_set:
            depends_on = STEP_BY_ID[step_id].skip_after
            if depends_on is not None and depends_on in status_by_id:
                self.assertEqual(
                    status_by_id[depends_on],
                    STEP_STATUS_SUCCEEDED,
                    f"{step_id} succeeded but depends on non-succeeded {depends_on}",
                )

        # finalStatus reflects whether any step failed.
        expected_final = (
            STEP_STATUS_FAILED if failed_set else STEP_STATUS_SUCCEEDED
        )
        self.assertEqual(str(plan["finalStatus"]), expected_final)


if __name__ == "__main__":
    unittest.main()
