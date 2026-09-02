"""Property-based test for external-evidence status monotonicity.

Feature: platform-modernization, Property 4: 외부 증거 상태 단조성.

For any evidence item (the Migration_Readiness_Manifest backup / point-in-time
recovery items and the eight release-gate items), the resolved status is one of
exactly two values -- ``unresolved`` or ``external_evidence_confirmed`` -- and no
item lacking an external-evidence reference identifier is ever confirmed. A
confirmed status therefore always implies a non-empty reference.

The property is authored here in P4 and reused in P7 (Task 48 materializes
``backend/deploy/migration-readiness.v1.json`` on top of the same pure helper).

Validates: Requirements 14.8, 14.13
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control import evidence_state


# ---------------------------------------------------------------------------
# Generators: arbitrary status (valid literals, unknown strings, non-strings)
# crossed with present / absent / empty / whitespace / non-string references.
# ---------------------------------------------------------------------------

# Status field: the two admitted literals plus off-vocabulary noise so the
# generator exercises invalid-status fail-closed paths too.
_statuses = st.one_of(
    st.sampled_from(
        [
            evidence_state.STATUS_UNRESOLVED,
            evidence_state.STATUS_EXTERNAL_EVIDENCE_CONFIRMED,
        ]
    ),
    st.text(max_size=40),
    st.sampled_from([None, 0, 1, True, False, [], {}]),
)

# Reference field: absent / empty / whitespace-only (all "no reference") mixed
# with non-empty strings (a real reference) and non-string junk.
_references = st.one_of(
    st.none(),
    st.just(""),
    st.text(alphabet=" \t\r\n", min_size=1, max_size=5),  # whitespace-only
    st.text(min_size=1, max_size=40),  # may include blank or non-blank
    st.sampled_from([0, 123, True, False, [], {}]),
)


@st.composite
def _evidence_items(draw):
    """An evidence item with arbitrary status and reference presence."""

    item: dict[str, object] = {
        evidence_state.STATUS_KEY: draw(_statuses),
    }
    # Sometimes omit the reference key entirely (truly absent), otherwise carry
    # a possibly-empty / possibly-junk reference value.
    if draw(st.booleans()):
        item[evidence_state.REFERENCE_KEY] = draw(_references)
    return item


class ExternalEvidenceStatusMonotonicityProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 4: 외부 증거 상태 단조성.
    # Invariant: no external-evidence reference => not confirmed; a confirmed
    # status => a non-empty reference is present. Resolved status stays inside
    # the two-value closed set.
    # Validates: Requirements 14.8, 14.13
    @settings(max_examples=100, deadline=None)
    @given(item=_evidence_items())
    def test_no_reference_implies_not_confirmed(self, item):
        resolved = evidence_state.resolve_evidence_status(item)

        # Resolved status is always inside the two-value closed set.
        self.assertIn(resolved, evidence_state.STATUS_VALUES)

        reference = item.get(evidence_state.REFERENCE_KEY)
        has_reference = evidence_state.has_external_reference(reference)

        if not has_reference:
            # No reference => never confirmed (the core monotonicity invariant).
            self.assertNotEqual(
                resolved, evidence_state.STATUS_EXTERNAL_EVIDENCE_CONFIRMED
            )

        if resolved == evidence_state.STATUS_EXTERNAL_EVIDENCE_CONFIRMED:
            # Confirmed => a non-empty reference must be present, and the claimed
            # status must have been the confirmed literal.
            self.assertTrue(has_reference)
            self.assertEqual(
                item.get(evidence_state.STATUS_KEY),
                evidence_state.STATUS_EXTERNAL_EVIDENCE_CONFIRMED,
            )

    @settings(max_examples=100, deadline=None)
    @given(status=_statuses, reference=_references)
    def test_is_confirmed_admissible_requires_reference(self, status, reference):
        admissible = evidence_state.is_confirmed_admissible(status, reference)

        if not evidence_state.has_external_reference(reference):
            # Absent/empty reference can never yield an admissible confirmation.
            self.assertFalse(admissible)

        if admissible:
            self.assertTrue(evidence_state.has_external_reference(reference))
            self.assertEqual(
                status, evidence_state.STATUS_EXTERNAL_EVIDENCE_CONFIRMED
            )

        # The reject-style surface agrees with the predicate and never confirms
        # without a reference; its rejection code is the single bounded fixed code.
        decision = evidence_state.admit_confirmation(status, reference)
        self.assertEqual(decision["ok"], admissible)
        self.assertIn(decision["status"], evidence_state.STATUS_VALUES)
        if not admissible:
            self.assertEqual(
                decision["code"], evidence_state.EVIDENCE_REFERENCE_MISSING
            )
            self.assertNotEqual(
                decision["status"],
                evidence_state.STATUS_EXTERNAL_EVIDENCE_CONFIRMED,
            )


if __name__ == "__main__":
    unittest.main()
