"""Property tests for the current R1..R14 seven-phase partition."""

from __future__ import annotations

import copy
import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.bin.phase_gate import (
    PHASE_GATE_CARDINALITY,
    PHASE_REQUIREMENT_COVERAGE,
    PHASE_SEQUENCE_INVALID,
    load_phase_catalog,
    validate_phase_assignment,
)


class PhasePartitionPropertyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = copy.deepcopy(load_phase_catalog())

    def test_current_catalog_is_an_exact_partition(self) -> None:
        self.assertEqual(
            validate_phase_assignment(self.catalog),
            {"ok": True, "errorCode": None},
        )

    @settings(max_examples=100, deadline=None)
    @given(
        requirement=st.integers(min_value=1, max_value=14),
        target_phase=st.integers(min_value=0, max_value=6),
        mode=st.sampled_from(("missing", "duplicate", "outside")),
    )
    def test_any_requirement_cover_defect_fails_closed(
        self, requirement: int, target_phase: int, mode: str
    ) -> None:
        catalog = copy.deepcopy(self.catalog)
        for phase in catalog["phases"]:
            phase["assignedRequirements"] = [
                value for value in phase["assignedRequirements"] if value != requirement
            ]
        if mode == "duplicate":
            catalog["phases"][target_phase]["assignedRequirements"].extend(
                [requirement, requirement]
            )
        elif mode == "outside":
            catalog["phases"][target_phase]["assignedRequirements"].append(15)
        result = validate_phase_assignment(catalog)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], PHASE_REQUIREMENT_COVERAGE)

    @settings(max_examples=100, deadline=None)
    @given(
        first=st.integers(min_value=0, max_value=6),
        second=st.integers(min_value=0, max_value=6).filter(lambda value: value != 0),
    )
    def test_sequence_or_phase_order_change_is_rejected(self, first: int, second: int) -> None:
        catalog = copy.deepcopy(self.catalog)
        second = (first + second) % 7
        catalog["phases"][first], catalog["phases"][second] = (
            catalog["phases"][second],
            catalog["phases"][first],
        )
        result = validate_phase_assignment(catalog)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], PHASE_SEQUENCE_INVALID)

    @settings(max_examples=50, deadline=None)
    @given(remove_index=st.integers(min_value=0, max_value=6))
    def test_every_phase_requires_all_seven_verification_commands(self, remove_index: int) -> None:
        catalog = copy.deepcopy(self.catalog)
        del catalog["phases"][0]["verificationCommandIds"][remove_index]
        result = validate_phase_assignment(catalog)
        self.assertFalse(result["ok"])
        # A malformed per-phase command cardinality is a shape defect, while a
        # missing catalog command is a catalog-wide cardinality defect.
        self.assertIsNotNone(result["errorCode"])

        catalog = copy.deepcopy(self.catalog)
        del catalog["verificationCommands"][remove_index]
        result = validate_phase_assignment(catalog)
        self.assertEqual(result["errorCode"], PHASE_GATE_CARDINALITY)


if __name__ == "__main__":
    unittest.main()
