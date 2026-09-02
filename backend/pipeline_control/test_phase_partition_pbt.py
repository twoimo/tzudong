"""Property-based test for Requirement→phase assignment partitioning.

Feature: platform-modernization (Requirement 16). This test targets the phase
assignment validation surface of the Phase_Gate runner
``backend/bin/phase_gate.py`` (task 1, design section C12 / "단계 순서와
Phase_Gate"). It encodes design Property 3, uses Python ``hypothesis`` (min 100
examples), and runs under ``python -m unittest``.

This is a test-first task: the Phase_Gate runner is implemented in task 1 and
may not exist yet. Following the established convention for ``backend/bin``
scripts (which are not an importable package and carry no ``__init__.py``), and
mirroring the sibling ``test_rollback_plan_pbt.py`` (task 1.1), the test loads
``backend/bin/phase_gate.py`` by file path and skips cleanly when the module or
the targeted validator is absent. As a result ``python -m unittest`` discovery
always collects this file without error, and the encoded property runs the
moment task 1 lands the validator.

Intended interface (task 1 implements to match this contract):

  ``phase_gate.validate_phase_assignment(assignment) -> {"ok": bool, "errorCode": str|None}``
      Mirrors the ``validate_cadence`` / ``validate_rollback_plan`` contract
      already used in this package (a dict with an ``ok`` boolean and a bounded
      ``errorCode`` from a closed set; ``None`` when accepted). Per design
      Property 3 it returns ``ok=True`` if and only if all of the following
      hold for ``assignment["phases"]``:

        * every requirement number 1..15 appears in exactly one phase's
          ``assignedRequirements`` (full cover ∧ pairwise-disjoint) and no
          number outside 1..15 appears, and
        * the ``sequence`` values form a unique integer set equal to
          ``{1, 2, ..., N}`` for ``N`` phases (unique, starting at 1), and
        * every phase has exactly one Phase_Gate (``gateCount == 1``) and
          exactly one phase artifact (``artifactCount == 1``).

      On rejection ``ok`` is ``False`` and ``errorCode`` is a bounded, non-empty
      string; on acceptance ``errorCode`` is ``None`` (or empty).
"""

from __future__ import annotations

import importlib.util
import unittest
from collections import Counter
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Test-first module load: backend/bin scripts are not an importable package, so
# they are loaded by path (see backend/bin/tests/test_evaluate_new_youtube_videos.py
# and the sibling backend/pipeline_control/test_rollback_plan_pbt.py). When task 1
# has not landed phase_gate.py yet, the encoded property is skipped rather than
# failing collection.
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

_HAS_VALIDATOR = _MODULE is not None and hasattr(_MODULE, "validate_phase_assignment")


# ---------------------------------------------------------------------------
# Generator: phase_assignments().
#
# The requirement numbers under partition are exactly 1..15 (Requirement 16.1).
# The generator starts from a valid random partition (each of 1..15 dropped into
# one of N phases, a permutation of 1..N for sequences, gate/artifact counts of
# 1) and then applies independent, probabilistic perturbations that inject
# omission, duplication, out-of-range numbers, sequence corruption, and
# gate/artifact-count corruption. This yields a healthy mix of valid and invalid
# assignments so the IFF is exercised in both directions; the oracle decides the
# expected result for whatever was produced.
# ---------------------------------------------------------------------------

_REQUIREMENT_NUMBERS = tuple(range(1, 16))


@st.composite
def phase_assignments(draw):
    num_phases = draw(st.integers(min_value=1, max_value=7))

    # Base valid distribution of requirements 1..15 across the phases.
    phase_reqs = [[] for _ in range(num_phases)]
    for req in _REQUIREMENT_NUMBERS:
        phase_reqs[draw(st.integers(min_value=0, max_value=num_phases - 1))].append(req)

    # Perturbation: omission — remove a requirement from every phase it is in.
    if draw(st.booleans()):
        victim = draw(st.sampled_from(_REQUIREMENT_NUMBERS))
        for lst in phase_reqs:
            if victim in lst:
                lst.remove(victim)

    # Perturbation: duplication — add an in-range requirement to some phase.
    if draw(st.booleans()):
        dup = draw(st.sampled_from(_REQUIREMENT_NUMBERS))
        phase_reqs[draw(st.integers(min_value=0, max_value=num_phases - 1))].append(dup)

    # Perturbation: out-of-range number injection.
    if draw(st.booleans()):
        extra = draw(st.integers(min_value=16, max_value=25))
        phase_reqs[draw(st.integers(min_value=0, max_value=num_phases - 1))].append(extra)

    # Base valid sequence numbers: a permutation of 1..num_phases.
    sequences = list(draw(st.permutations(list(range(1, num_phases + 1)))))

    # Perturbation: sequence corruption (may break uniqueness or the 1..N shape).
    if draw(st.booleans()):
        idx = draw(st.integers(min_value=0, max_value=num_phases - 1))
        sequences[idx] = draw(st.integers(min_value=0, max_value=num_phases + 3))

    phases = []
    for i in range(num_phases):
        gate_count = draw(st.integers(min_value=0, max_value=3)) if draw(st.booleans()) else 1
        artifact_count = draw(st.integers(min_value=0, max_value=3)) if draw(st.booleans()) else 1
        # Shuffle each phase's requirement list so ordering is not assumed.
        reqs = draw(st.permutations(phase_reqs[i]))
        phases.append(
            {
                "phaseId": f"P{i + 1}",
                "sequence": sequences[i],
                "assignedRequirements": list(reqs),
                "gateCount": gate_count,
                "artifactCount": artifact_count,
            }
        )

    return {"phases": phases}


def _expected_ok(assignment) -> bool:
    """Independent oracle for design Property 3."""

    phases = assignment["phases"]

    # Full cover ∧ pairwise-disjoint: each of 1..15 appears exactly once, and no
    # number outside 1..15 appears anywhere.
    counts = Counter(
        req for phase in phases for req in phase["assignedRequirements"]
    )
    coverage_ok = set(counts) == set(_REQUIREMENT_NUMBERS) and all(
        counts[req] == 1 for req in _REQUIREMENT_NUMBERS
    )

    # Sequence numbers: a unique set equal to {1, ..., N}.
    sequences = [phase["sequence"] for phase in phases]
    sequence_ok = sorted(sequences) == list(range(1, len(phases) + 1))

    # Exactly one Phase_Gate and one phase artifact per phase.
    counts_ok = all(
        phase["gateCount"] == 1 and phase["artifactCount"] == 1 for phase in phases
    )

    return coverage_ok and sequence_ok and counts_ok


def _result_ok(result):
    """Extract the ``ok`` flag from a dict result (validate_cadence convention)."""

    if isinstance(result, dict):
        return result["ok"], result.get("errorCode")
    # Tolerate an attribute-style result object as a fallback.
    return bool(getattr(result, "ok")), getattr(result, "errorCode", None)


class PhaseAssignmentPartitionProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 3: 요구사항 배정 분할.
    # For all phase assignments, the validator returns pass IFF requirements
    # 1..15 each appear in exactly one phase (full cover, pairwise-disjoint),
    # the sequence numbers form a unique set starting at 1, and each phase has
    # exactly one Phase_Gate and one phase artifact.
    # Validates: Requirements 16.1
    @unittest.skipUnless(
        _HAS_VALIDATOR, _LOAD_ERROR or "validate_phase_assignment unavailable"
    )
    @settings(max_examples=100, deadline=None)
    @given(assignment=phase_assignments())
    def test_phase_assignment_partition(self, assignment):
        result = _MODULE.validate_phase_assignment(assignment)
        ok, error_code = _result_ok(result)

        self.assertEqual(ok, _expected_ok(assignment))

        if ok:
            # Accepted assignments carry no rejection code.
            self.assertIn(error_code, (None, ""))
        else:
            # Rejections use a bounded, non-empty fixed code.
            self.assertIsInstance(error_code, str)
            self.assertGreater(len(error_code), 0)


if __name__ == "__main__":
    unittest.main()
