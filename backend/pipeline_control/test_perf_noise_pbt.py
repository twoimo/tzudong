"""Property-based test for performance noise judgment.

Feature: platform-modernization, Property 9: 성능 노이즈 판정 (Requirement 3.4).

This test targets the pure-logic noise judgment in
``backend/pipeline_control/performance_evidence.py`` (Task 45):
``judge_improvement(observed_value, baseline_value, noise_budget)``, which
classifies a completed scoring run against a metric's noise budget.

It encodes design Property 9, uses Python ``hypothesis`` (min 100 examples), and
runs under ``python -m unittest``:

    python -m unittest backend.pipeline_control.test_perf_noise_pbt

Requires ``hypothesis`` (the project ``.venv`` provides it).

Property 9 invariant (design "Correctness Properties"):

    For every (observed value, baseline value, noise budget) combination, the
    observed improvement delta = baseline - observed. When |delta| is at or
    below the noise budget the judgment is EXACTLY ``no_admitted_slice`` — a
    valid result that is never marked a failure or a required rerun. When
    |delta| exceeds the noise budget the judgment is EXACTLY ``admitted_slice``.
    Either way the run is a valid, non-failing result.

Validates: Requirements 3.4
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.performance_evidence import (
    RESULT_ADMITTED_SLICE,
    RESULT_NO_ADMITTED_SLICE,
    judge_improvement,
)

# Bounded integer domain covering positive improvements, regressions, and the
# exact-boundary case, while keeping generated examples in an intelligible range.
_MEASUREMENTS = st.integers(min_value=-1_000_000, max_value=1_000_000)
# A noise budget is a non-negative magnitude.
_NOISE_BUDGETS = st.integers(min_value=0, max_value=1_000_000)


class PerfNoiseJudgmentProperty(unittest.TestCase):
    """Feature: platform-modernization, Property 9: 성능 노이즈 판정."""

    # Validates: Requirements 3.4

    @settings(max_examples=100, deadline=None)
    @given(
        observed_value=_MEASUREMENTS,
        baseline_value=_MEASUREMENTS,
        noise_budget=_NOISE_BUDGETS,
    )
    def test_noise_budget_decides_admission_iff(
        self, observed_value, baseline_value, noise_budget
    ):
        result = judge_improvement(observed_value, baseline_value, noise_budget)

        delta = baseline_value - observed_value
        within_noise = abs(delta) <= noise_budget

        # The reported improvement is exactly baseline - observed.
        self.assertEqual(result["improvement"], delta)

        # |delta| <= noise  <=>  no_admitted_slice ; otherwise admitted_slice.
        if within_noise:
            self.assertEqual(result["judgment"], RESULT_NO_ADMITTED_SLICE)
        else:
            self.assertEqual(result["judgment"], RESULT_ADMITTED_SLICE)

        # The biconditional stated directly, in both directions.
        self.assertEqual(
            result["judgment"] == RESULT_NO_ADMITTED_SLICE, within_noise
        )
        self.assertEqual(
            result["judgment"] == RESULT_ADMITTED_SLICE, not within_noise
        )

        # A completed scoring run is always a valid result, never a failure or a
        # required rerun — the noise budget only decides admission (3.4).
        self.assertTrue(result["isValidResult"])
        self.assertFalse(result["isFailure"])

    @settings(max_examples=100, deadline=None)
    @given(
        baseline_value=_MEASUREMENTS,
        noise_budget=_NOISE_BUDGETS,
    )
    def test_exact_boundary_is_no_admitted_slice(self, baseline_value, noise_budget):
        # When |delta| equals the noise budget exactly (both signs), the result
        # is a valid no_admitted_slice, never an admitted slice.
        for observed_value in (
            baseline_value - noise_budget,  # delta = +noise_budget
            baseline_value + noise_budget,  # delta = -noise_budget
        ):
            result = judge_improvement(observed_value, baseline_value, noise_budget)
            self.assertEqual(abs(result["improvement"]), noise_budget)
            self.assertEqual(result["judgment"], RESULT_NO_ADMITTED_SLICE)
            self.assertTrue(result["isValidResult"])
            self.assertFalse(result["isFailure"])


if __name__ == "__main__":
    unittest.main()
