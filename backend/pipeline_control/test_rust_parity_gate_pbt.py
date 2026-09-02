"""Property-based test for the parity default-switch gate counting.

Feature: platform-modernization (Requirements 2.4, 2.5, 2.10). This test
targets the N=3 consecutive-match gate of the Parity_Harness
(``backend/pipeline_control/rust_parity.py``, Task 43): the pure-logic pieces
``consecutive_matched_count`` / ``evaluate_default_switch`` that govern when the
Implementation_Selector default may flip from python to rust, and
``apply_artifact_change`` which resets the count when a Rust_Component artifact
identifier changes (design C1 / D1 invariant on ``consecutiveMatchedCount``).

It encodes design Property 8 ("패리티 게이트 계수"), uses Python ``hypothesis``
(min 100 examples), and runs under ``python -m unittest``:

    python -m unittest backend.pipeline_control.test_rust_parity_gate_pbt

Requires ``hypothesis`` (the project ``.venv`` provides it).

Property 8 invariant (design "Correctness Properties"):

    For every Parity_Result history sequence, the Implementation_Selector
    default-switch gate returns allowed IFF three qualifying ``matched=true``
    results — distinct input ids, the same Rust_Component artifact id, a
    non-empty compared-field set — are consecutive with no ``matched=false``
    between them; a result with an empty compared-field set is excluded from
    the N=3 count; and when the artifact id changes the count resets to 0 and
    the default reverts to python.

Validates: Requirements 2.4, 2.5, 2.10
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.impl_selector import (
    IMPL_PYTHON,
    IMPL_RUST,
    PARITY_GATE_COUNT,
)
from backend.pipeline_control.rust_parity import (
    CODE_PARITY_EVIDENCE_INSUFFICIENT,
    apply_artifact_change,
    consecutive_matched_count,
    evaluate_default_switch,
)

# The artifact id under evaluation, plus decoy ids used for ignorable noise.
_TARGET = "tzudong-validators@sha256:target"
_OTHER_ARTIFACTS = (
    "tzudong-validators@sha256:other-1",
    "tzudong-normalize@sha256:other-2",
)
_SLICE_ID = "R1-validators"


def _qualifying(index: int) -> dict:
    """A Parity_Result that counts toward the N=3 gate for ``_TARGET``.

    matched=true, the target artifact id, a distinct input id, and a non-empty
    compared-field set.
    """

    return {
        "rust_artifact_id": _TARGET,
        "input_id": f"qual-{index}",
        "matched": True,
        "compared_fields": ["field_a", "field_b"],
    }


@st.composite
def _ignorable_noise(draw, tag: str):
    """A Parity_Result guaranteed to neither count nor break the ``_TARGET`` streak.

    Two skippable shapes only:
      * an empty compared-field matched result for the target artifact — excluded
        from the count and not a streak breaker (Requirement 2.4); or
      * any result recorded against a *different* artifact id — ignored entirely
        by the target-scoped walk, whatever its matched flag or fields.
    """

    if draw(st.booleans()):
        return {
            "rust_artifact_id": _TARGET,
            "input_id": f"empty-{tag}",
            "matched": True,
            "compared_fields": [],
        }
    return {
        "rust_artifact_id": draw(st.sampled_from(_OTHER_ARTIFACTS)),
        "input_id": f"other-{tag}",
        "matched": draw(st.booleans()),
        "compared_fields": draw(st.sampled_from([[], ["x"], ["x", "y"]])),
    }


@st.composite
def _arbitrary_result(draw, tag: str):
    """A completely arbitrary Parity_Result, used only behind a break barrier."""

    return {
        "rust_artifact_id": draw(st.sampled_from((_TARGET,) + _OTHER_ARTIFACTS)),
        "input_id": f"prefix-{tag}-{draw(st.integers(min_value=0, max_value=3))}",
        "matched": draw(st.booleans()),
        "compared_fields": draw(st.sampled_from([[], ["a"], ["a", "b"]])),
    }


@st.composite
def _gate_scenarios(draw):
    """Build ``(results, target, expected_count)`` with an exact expected count.

    The tail holds exactly ``k`` qualifying results (distinct inputs) plus an
    arbitrary number of ignorable-noise results, interleaved in any order — so
    the target-scoped consecutive count of the tail is exactly ``k`` regardless
    of ordering. Optionally an arbitrary prefix is placed behind a
    ``matched=false`` target barrier, which the reverse walk must stop at, so
    the prefix can never contribute to the count.
    """

    k = draw(st.integers(min_value=0, max_value=6))
    tail = [_qualifying(i) for i in range(k)]

    n_noise = draw(st.integers(min_value=0, max_value=5))
    for j in range(n_noise):
        tail.append(draw(_ignorable_noise(tag=str(j))))

    tail = draw(st.permutations(tail))

    if draw(st.booleans()):
        barrier = {
            "rust_artifact_id": _TARGET,
            "input_id": "barrier",
            "matched": False,
            "compared_fields": ["field_a"],
        }
        prefix = [
            draw(_arbitrary_result(tag=str(p)))
            for p in range(draw(st.integers(min_value=0, max_value=4)))
        ]
        results = list(prefix) + [barrier] + list(tail)
    else:
        results = list(tail)

    return results, _TARGET, k


class ParityGateCountProperty(unittest.TestCase):
    # Feature: platform-modernization, Property 8: 패리티 게이트 계수.
    # For every Parity_Result history, the default-switch gate is allowed IFF
    # three qualifying matched results (distinct inputs, same artifact id,
    # non-empty compared-field set) are consecutive with no matched=false
    # between them; empty compared-field results are excluded from the count;
    # an artifact-id change resets the count to 0 and reverts the default to
    # python.
    # Validates: Requirements 2.4, 2.5, 2.10

    @settings(max_examples=100, deadline=None)
    @given(scenario=_gate_scenarios())
    def test_gate_allowed_iff_three_consecutive(self, scenario):
        results, target, expected_count = scenario

        count = consecutive_matched_count(results, target)
        self.assertEqual(count, expected_count)

        decision = evaluate_default_switch(_SLICE_ID, results, target)
        self.assertEqual(decision["consecutiveMatchedCount"], expected_count)
        # The gate allows the flip to rust exactly when the count reaches N=3.
        self.assertEqual(decision["allowed"], expected_count >= PARITY_GATE_COUNT)

        if expected_count >= PARITY_GATE_COUNT:
            self.assertEqual(decision["defaultImplementation"], IMPL_RUST)
            self.assertIsNone(decision["code"])
            evidence = decision["evidence"]
            self.assertEqual(evidence["rustArtifactId"], target)
            self.assertEqual(len(evidence["inputIds"]), PARITY_GATE_COUNT)
            # The supporting evidence carries distinct input ids only.
            self.assertEqual(len(set(evidence["inputIds"])), PARITY_GATE_COUNT)
        else:
            self.assertEqual(decision["defaultImplementation"], IMPL_PYTHON)
            self.assertIsNone(decision["evidence"])
            self.assertEqual(decision["code"], CODE_PARITY_EVIDENCE_INSUFFICIENT)

    @settings(max_examples=100, deadline=None)
    @given(
        older=st.integers(min_value=0, max_value=5),
        newer=st.integers(min_value=0, max_value=5),
    )
    def test_matched_false_breaks_the_streak(self, older, newer):
        # ``newer`` qualifying results sit after (more recent than) a
        # matched=false target result; ``older`` qualifying results sit before
        # it. The reverse walk must stop at the false marker, so only the newer
        # run counts (Requirement 2.4: no matched=false between the three).
        older_block = [_qualifying(i) for i in range(older)]
        breaker = {
            "rust_artifact_id": _TARGET,
            "input_id": "breaker",
            "matched": False,
            "compared_fields": ["field_a"],
        }
        newer_block = [_qualifying(100 + i) for i in range(newer)]
        results = older_block + [breaker] + newer_block

        self.assertEqual(consecutive_matched_count(results, _TARGET), newer)
        decision = evaluate_default_switch(_SLICE_ID, results, _TARGET)
        self.assertEqual(decision["allowed"], newer >= PARITY_GATE_COUNT)

    @settings(max_examples=100, deadline=None)
    @given(repeats=st.integers(min_value=1, max_value=8))
    def test_repeated_input_id_counts_once(self, repeats):
        # A repeated input id is not a new distinct data point: any number of
        # consecutive matched results sharing one input id count as exactly one
        # (Requirement 2.4, distinct input ids). Never enough to flip the gate.
        results = [
            {
                "rust_artifact_id": _TARGET,
                "input_id": "same-input",
                "matched": True,
                "compared_fields": ["field_a"],
            }
            for _ in range(repeats)
        ]

        self.assertEqual(consecutive_matched_count(results, _TARGET), 1)
        decision = evaluate_default_switch(_SLICE_ID, results, _TARGET)
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["code"], CODE_PARITY_EVIDENCE_INSUFFICIENT)

    @settings(max_examples=100, deadline=None)
    @given(
        old_artifact=st.sampled_from((_TARGET,) + _OTHER_ARTIFACTS),
        new_artifact=st.sampled_from((_TARGET,) + _OTHER_ARTIFACTS),
        count=st.integers(min_value=0, max_value=10),
        active=st.sampled_from((IMPL_PYTHON, IMPL_RUST)),
    )
    def test_artifact_change_resets_count_and_default(
        self, old_artifact, new_artifact, count, active
    ):
        # Requirement 2.10: when the Rust_Component artifact id changes the
        # consecutive count resets to 0 and the default reverts to python; an
        # unchanged id leaves the entry as-is. The input entry is never mutated.
        entry = {
            "sliceId": _SLICE_ID,
            "rustArtifactId": old_artifact,
            "consecutiveMatchedCount": count,
            "activeImplementation": active,
        }
        snapshot = dict(entry)

        updated = apply_artifact_change(entry, new_artifact)

        self.assertEqual(entry, snapshot)  # no mutation of the input
        self.assertEqual(updated["rustArtifactId"], new_artifact)
        if new_artifact == old_artifact:
            self.assertEqual(updated["consecutiveMatchedCount"], count)
            self.assertEqual(updated["activeImplementation"], active)
        else:
            self.assertEqual(updated["consecutiveMatchedCount"], 0)
            self.assertEqual(updated["activeImplementation"], IMPL_PYTHON)


if __name__ == "__main__":
    unittest.main()
