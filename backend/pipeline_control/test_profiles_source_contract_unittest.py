"""Source-contract test pinning the heavy-step capability set and skip policy.

Covers task 8.4 (Requirements 2.1, 2.2, 2.5): pin, as a non-input-varying
source contract, that:

1. Each known heavy step in ``STEP_SPECS`` carries the ``heavy_compute``
   capability AND the ``skip_when_lite`` flag (R2.1, R2.2).
2. ``skip_reason_for_step`` returns a bounded optional skip -- kind
   ``optional`` with the fixed-vocabulary ``SKIP_HEAVY_REASON`` -- for each
   heavy step under the ``lite_gha`` compute profile (R2.5).
3. Non-heavy (lite) steps are NOT marked ``skip_when_lite`` and do not carry
   the ``heavy_compute`` capability, and are not skipped as heavy under
   ``lite_gha`` (R2.1).

This test asserts against the current source of truth and does not modify it.
Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import unittest

from backend.pipeline_control.graph import (
    HEAVY_CAPABILITY,
    SKIP_HEAVY_REASON,
    STEP_BY_ID,
    STEP_SPECS,
)
from backend.pipeline_control.profiles import skip_reason_for_step

# The five heavy step ids fixed by the design (R2.1/R2.2): frames extraction,
# OCR/chunk-multimodal Gemini, visual location, map-URL crawling, frame caption.
KNOWN_HEAVY_STEP_IDS = frozenset(
    {
        "03-2-visual",
        "04-frames",
        "05-map-url",
        "06-frame-caption",
        "08-chunk",
    }
)


class HeavyStepCapabilityContractTests(unittest.TestCase):
    def test_known_heavy_step_ids_exist_in_graph(self) -> None:
        for step_id in KNOWN_HEAVY_STEP_IDS:
            self.assertIn(step_id, STEP_BY_ID, step_id)

    def test_heavy_steps_carry_heavy_compute_and_skip_when_lite(self) -> None:
        for step_id in KNOWN_HEAVY_STEP_IDS:
            spec = STEP_BY_ID[step_id]
            self.assertIn(HEAVY_CAPABILITY, spec.capabilities, step_id)
            self.assertTrue(spec.skip_when_lite, step_id)

    def test_heavy_capability_set_matches_known_ids_exactly(self) -> None:
        # Guard against a heavy step being added or removed without updating the
        # pinned contract: the set of steps carrying heavy_compute must be
        # exactly the known heavy ids.
        actual = {
            spec.id
            for spec in STEP_SPECS
            if HEAVY_CAPABILITY in spec.capabilities
        }
        self.assertEqual(actual, set(KNOWN_HEAVY_STEP_IDS))

    def test_skip_when_lite_set_matches_known_heavy_ids_exactly(self) -> None:
        actual = {spec.id for spec in STEP_SPECS if spec.skip_when_lite}
        self.assertEqual(actual, set(KNOWN_HEAVY_STEP_IDS))


class LiteProfileSkipPolicyContractTests(unittest.TestCase):
    def test_heavy_steps_return_bounded_optional_skip_under_lite(self) -> None:
        for step_id in KNOWN_HEAVY_STEP_IDS:
            spec = STEP_BY_ID[step_id]
            result = skip_reason_for_step(
                spec,
                compute_profile="lite_gha",
                data_sink="artifact_only",
                skipped_or_failed=set(),
            )
            self.assertIsNotNone(result, step_id)
            kind, reason = result
            self.assertEqual(kind, "optional", step_id)
            self.assertEqual(reason, SKIP_HEAVY_REASON, step_id)

    def test_non_heavy_steps_not_marked_skip_when_lite(self) -> None:
        for spec in STEP_SPECS:
            if spec.id in KNOWN_HEAVY_STEP_IDS:
                continue
            self.assertFalse(spec.skip_when_lite, spec.id)
            self.assertNotIn(HEAVY_CAPABILITY, spec.capabilities, spec.id)

    def test_non_heavy_steps_not_skipped_as_heavy_under_lite(self) -> None:
        # A non-heavy step must not be skipped with the heavy-optional reason
        # under lite_gha (with no upstream skips/failures and a local sink so
        # mutating steps are admitted).
        for spec in STEP_SPECS:
            if spec.id in KNOWN_HEAVY_STEP_IDS:
                continue
            result = skip_reason_for_step(
                spec,
                compute_profile="lite_gha",
                data_sink="local_db",
                skipped_or_failed=set(),
            )
            if result is not None:
                _, reason = result
                self.assertNotEqual(reason, SKIP_HEAVY_REASON, spec.id)


if __name__ == "__main__":
    unittest.main()
