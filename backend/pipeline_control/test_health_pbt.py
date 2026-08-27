"""Property-based tests for manifest staleness/health and missed-window count.

Feature: crawler-pipeline-orchestration. These tests target the pure-logic
module ``backend/pipeline_control/health.py`` and encode design Properties 20
and 23 (Requirements 5.7 and 6.2). They use Python ``hypothesis`` (min 100
examples) and run under ``python -m unittest``.
"""

from __future__ import annotations

import unittest
from datetime import date, timedelta

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.health import (
    last_success_date_from_manifest,
    manifest_is_stale,
    missed_window_count,
    run_is_healthy,
    current_utc_date,
)
from backend.pipeline_control.manifest import (
    FINAL_STATUS_ERROR,
    FINAL_STATUS_OK,
    RUN_STATUS_FAILED,
    RUN_STATUS_SUCCEEDED,
)

_HEALTHY_STATUSES = (FINAL_STATUS_OK, RUN_STATUS_SUCCEEDED)
_UNHEALTHY_STATUSES = (FINAL_STATUS_ERROR, RUN_STATUS_FAILED, "", "unknown", None)

# Bound the calendar to a sane range so day arithmetic stays well-defined.
_dates = st.dates(min_value=date(2000, 1, 1), max_value=date(2100, 1, 1))


class StaleOrAbsentManifestIsNotHealthy(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 20: Stale or absent
    # manifest is not healthy. For all manifests whose date is earlier than the
    # current UTC date, and for the absence of any manifest for today,
    # run_is_healthy returns False (fail closed); only a today-dated success
    # manifest is healthy. (R5.7)
    """Validates: Requirements 5.7"""

    @settings(max_examples=200)
    @given(
        today=_dates,
        age=st.integers(min_value=1, max_value=3650),
        status=st.sampled_from(list(_HEALTHY_STATUSES) + list(_UNHEALTHY_STATUSES)),
    )
    def test_stale_manifest_is_never_healthy(self, today, age, status):
        # A manifest generated earlier than the current UTC date is stale and
        # must fail closed regardless of the status it carries.
        stale_date = today - timedelta(days=age)
        manifest = {"date": stale_date, "finalStatus": status}
        self.assertFalse(run_is_healthy(manifest, today=today))
        self.assertTrue(manifest_is_stale(manifest, today=today))

    @settings(max_examples=100)
    @given(
        today=_dates,
        absent=st.sampled_from([None, {}, {"finalStatus": FINAL_STATUS_OK}, 42, "manifest"]),
    )
    def test_absent_manifest_is_never_healthy(self, today, absent):
        # No manifest for the current UTC date -> not healthy (fail closed).
        self.assertFalse(run_is_healthy(absent, today=today))

    @settings(max_examples=200)
    @given(today=_dates, status=st.sampled_from(_HEALTHY_STATUSES))
    def test_today_dated_success_is_healthy(self, today, status):
        # Only a manifest dated the current UTC date with a success status is
        # healthy.
        manifest = {"date": today, "finalStatus": status}
        self.assertTrue(run_is_healthy(manifest, today=today))
        self.assertFalse(manifest_is_stale(manifest, today=today))
        self.assertEqual(last_success_date_from_manifest(manifest), today)

    @settings(max_examples=200)
    @given(today=_dates, status=st.sampled_from(_UNHEALTHY_STATUSES))
    def test_today_dated_failure_is_not_healthy(self, today, status):
        # A today-dated manifest without a success status is not healthy.
        manifest = {"date": today, "finalStatus": status}
        self.assertFalse(run_is_healthy(manifest, today=today))


class MissedWindowCountReflectsCoalescedGap(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 23: Missed-window count
    # reflects the coalesced gap. For all last-success dates and current dates,
    # missed_window_count equals the coalesced gap (gap-1 for gap>=2, else 0),
    # is non-negative, and carries no diagnostics. (R6.2)
    """Validates: Requirements 6.2"""

    @settings(max_examples=200)
    @given(last_success=_dates, today=_dates)
    def test_count_equals_coalesced_gap(self, last_success, today):
        result = missed_window_count(last_success, today=today)
        gap = (today - last_success).days
        expected = gap - 1 if gap >= 2 else 0

        self.assertEqual(result, expected)
        # Non-negative bounded integer that carries no provider/db diagnostics:
        # the output is a plain int, nothing else.
        self.assertIsInstance(result, int)
        self.assertGreaterEqual(result, 0)

    @settings(max_examples=100)
    @given(
        today=_dates,
        gap=st.integers(min_value=2, max_value=3650),
    )
    def test_gap_of_two_or_more_counts_missed_windows(self, today, gap):
        # A gap of two or more days yields exactly gap-1 missed windows.
        last_success = today - timedelta(days=gap)
        self.assertEqual(missed_window_count(last_success, today=today), gap - 1)

    @settings(max_examples=100)
    @given(
        today=_dates,
        gap=st.integers(min_value=0, max_value=1),
    )
    def test_same_or_consecutive_day_has_no_missed_window(self, today, gap):
        # Same-day or consecutive-day success (gap <= 1) has no missed window.
        last_success = today - timedelta(days=gap)
        self.assertEqual(missed_window_count(last_success, today=today), 0)

    @settings(max_examples=100)
    @given(today=_dates, ahead=st.integers(min_value=1, max_value=3650))
    def test_future_last_success_is_non_negative_zero(self, today, ahead):
        # A last success after the current date never yields a negative count.
        last_success = today + timedelta(days=ahead)
        self.assertEqual(missed_window_count(last_success, today=today), 0)


if __name__ == "__main__":
    # Anchor a defaulted call so current_utc_date stays exercised as public API.
    assert isinstance(current_utc_date(), date)
    unittest.main()
