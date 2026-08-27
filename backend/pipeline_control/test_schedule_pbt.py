"""Property-based tests for cadence schedule validation and KST derivation.

Feature: crawler-pipeline-orchestration (Requirement 1). These tests target the
pure-logic module ``backend/pipeline_control/schedule.py`` and encode design
Properties 1, 2, and 3. They use Python ``hypothesis`` (min 100 examples) and
run under ``python -m unittest``.
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.schedule import (
    ERROR_BUFFER_TOO_SMALL,
    ERROR_ORDER_VIOLATION,
    ERROR_WINDOWS_OVERLAP,
    GHA_RUNNER,
    KST_UTC_OFFSET_MINUTES,
    MAC_RUNNER,
    MINUTES_PER_DAY,
    kst_offset_minutes,
    kst_to_utc_minutes,
    utc_to_kst_minutes,
    validate_cadence,
)


def _hhmm(minutes: int) -> str:
    """Format a minute-of-day as a zero-padded ``HH:MM`` 24-hour string."""

    return f"{minutes // 60:02d}:{minutes % 60:02d}"


# A single window as an integer (start, end) minute-of-day pair with end > start.
@st.composite
def _interval(draw):
    start = draw(st.integers(min_value=0, max_value=MINUTES_PER_DAY - 2))
    end = draw(st.integers(min_value=start + 1, max_value=MINUTES_PER_DAY - 1))
    return start, end


class ScheduleValidationProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 1: Valid schedule implies
    # non-overlap and buffer. For all generated sets of cadence windows, if
    # validate_cadence returns ok=true then no two windows overlap and every pair
    # of consecutive windows is separated by at least the configured minimum
    # buffer (30 minutes); and for all window sets that overlap or violate the
    # buffer, validate_cadence returns ok=false with an errorCode from the closed
    # set and a non-empty list of conflicting windows.
    # Validates: Requirements 1.1, 1.6
    @settings(max_examples=200)
    @given(
        intervals=st.lists(_interval(), min_size=1, max_size=5),
        min_buffer=st.integers(min_value=0, max_value=120),
    )
    def test_valid_schedule_implies_non_overlap_and_buffer(self, intervals, min_buffer):
        # Use generic (non GHA/Mac) runner labels so the GHA-before-Mac ordering
        # rule never fires; this isolates the property to overlap + buffer.
        windows = [
            {
                "runner": f"runner_{index}",
                "kstStart": _hhmm(start),
                "kstEnd": _hhmm(end),
            }
            for index, (start, end) in enumerate(intervals)
        ]
        config = {"minBufferMinutes": min_buffer, "windows": windows}
        result = validate_cadence(config)

        # Independent oracle mirroring the validator's overlap-then-buffer order.
        order = sorted(range(len(intervals)), key=lambda i: (intervals[i][0], intervals[i][1]))
        overlap_exists = False
        for a in range(len(order)):
            a_start, a_end = intervals[order[a]]
            for b in range(a + 1, len(order)):
                b_start, b_end = intervals[order[b]]
                if a_start < b_end and b_start < a_end:
                    overlap_exists = True
        buffer_violation = False
        if not overlap_exists:
            for pos in range(len(order) - 1):
                _, cur_end = intervals[order[pos]]
                next_start, _ = intervals[order[pos + 1]]
                if next_start - cur_end < min_buffer:
                    buffer_violation = True

        expected_ok = (not overlap_exists) and (not buffer_violation)
        self.assertEqual(result["ok"], expected_ok)

        if result["ok"]:
            # No two windows overlap.
            for a in range(len(intervals)):
                a_start, a_end = intervals[a]
                for b in range(a + 1, len(intervals)):
                    b_start, b_end = intervals[b]
                    self.assertFalse(a_start < b_end and b_start < a_end)
            # Every consecutive pair (by start) is separated by >= min_buffer.
            for pos in range(len(order) - 1):
                _, cur_end = intervals[order[pos]]
                next_start, _ = intervals[order[pos + 1]]
                self.assertGreaterEqual(next_start - cur_end, min_buffer)
            self.assertIsNone(result["errorCode"])
            self.assertEqual(result["conflictingWindows"], [])
        else:
            # Rejection uses a bounded code from the closed set and names the
            # conflicting windows.
            self.assertIn(result["errorCode"], {ERROR_WINDOWS_OVERLAP, ERROR_BUFFER_TOO_SMALL})
            self.assertTrue(result["conflictingWindows"])

    # Feature: crawler-pipeline-orchestration, Property 2: Valid schedule
    # preserves GHA-before-Mac ordering. For generated GHA/Mac window pairs, if
    # validate_cadence returns ok=true then the GHA_Runner window ends at least
    # the minimum buffer before the Mac_Runner window begins; ordering violations
    # are rejected with an order-related errorCode.
    # Validates: Requirements 1.2, 1.6
    @settings(max_examples=200)
    @given(
        gha=_interval(),
        mac=_interval(),
        min_buffer=st.integers(min_value=0, max_value=120),
    )
    def test_valid_schedule_preserves_gha_before_mac_ordering(self, gha, mac, min_buffer):
        gha_start, gha_end = gha
        mac_start, mac_end = mac

        config = {
            "minBufferMinutes": min_buffer,
            "windows": [
                {"runner": GHA_RUNNER, "kstStart": _hhmm(gha_start), "kstEnd": _hhmm(gha_end)},
                {"runner": MAC_RUNNER, "kstStart": _hhmm(mac_start), "kstEnd": _hhmm(mac_end)},
            ],
        }
        result = validate_cadence(config)

        if result["ok"]:
            # GHA ends at least the buffer before Mac begins.
            self.assertLessEqual(gha_end + min_buffer, mac_start)
            self.assertIsNone(result["errorCode"])

        # A Mac window that lies entirely before the GHA window (no overlap) is a
        # clean ordering violation and must be rejected with the ordering code.
        if mac_end <= gha_start and gha_end > mac_start:
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], ERROR_ORDER_VIOLATION)
            self.assertTrue(result["conflictingWindows"])

    # Feature: crawler-pipeline-orchestration, Property 3: KST derivation
    # round-trips with a fixed UTC+9 offset. For all minutes-of-day, converting a
    # UTC time to KST by adding 540 (mod 1440) and back to UTC is the identity,
    # and the applied offset is always exactly 540 minutes with no
    # daylight-saving adjustment.
    # Validates: Requirements 1.3
    @settings(max_examples=200)
    @given(utc_minutes=st.integers(min_value=0, max_value=MINUTES_PER_DAY - 1))
    def test_kst_derivation_round_trips_with_fixed_utc9_offset(self, utc_minutes):
        kst_minutes = utc_to_kst_minutes(utc_minutes)

        # Offset is exactly 540, applied with wraparound, no DST.
        self.assertEqual(kst_offset_minutes(), 540)
        self.assertEqual(KST_UTC_OFFSET_MINUTES, 540)
        self.assertEqual(kst_minutes, (utc_minutes + 540) % MINUTES_PER_DAY)

        # Round-trip UTC -> KST -> UTC is the identity.
        self.assertEqual(kst_to_utc_minutes(kst_minutes), utc_minutes)


if __name__ == "__main__":
    unittest.main()
