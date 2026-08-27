"""Unit tests for the manifest health/staleness rule and missed-window derivation.

Covers task 2.2 (Requirements 5.7, 6.2) in
``backend/pipeline_control/health.py``: only a today-dated success manifest is
healthy; a stale or absent manifest fails closed; the missed-window count is the
coalesced gap between the last-successful manifest date and the current UTC
date.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import unittest
from datetime import date

import json
import tempfile
from pathlib import Path

from backend.pipeline_control.health import (
    REPORTED_STATUS_NOT_SUCCEEDED,
    REPORTED_STATUS_SUCCEEDED,
    build_health_report,
    last_success_date_from_manifest,
    manifest_is_stale,
    missed_window_count,
    run_is_healthy,
    write_health_report,
)

TODAY = date(2026, 3, 15)


def _manifest(day: str, final_status: str = "OK") -> dict:
    return {"date": day, "finalStatus": final_status}


class RunIsHealthyTests(unittest.TestCase):
    def test_today_dated_success_is_healthy(self) -> None:
        self.assertTrue(run_is_healthy(_manifest("2026-03-15", "OK"), today=TODAY))

    def test_today_dated_success_string_status_succeeded(self) -> None:
        self.assertTrue(
            run_is_healthy(_manifest("2026-03-15", "Succeeded"), today=TODAY)
        )

    def test_today_dated_failure_is_not_healthy(self) -> None:
        self.assertFalse(run_is_healthy(_manifest("2026-03-15", "ERROR"), today=TODAY))

    def test_stale_manifest_is_not_healthy(self) -> None:
        self.assertFalse(run_is_healthy(_manifest("2026-03-14", "OK"), today=TODAY))

    def test_absent_manifest_is_not_healthy(self) -> None:
        self.assertFalse(run_is_healthy(None, today=TODAY))

    def test_future_dated_manifest_is_not_healthy(self) -> None:
        self.assertFalse(run_is_healthy(_manifest("2026-03-16", "OK"), today=TODAY))

    def test_malformed_date_is_not_healthy(self) -> None:
        self.assertFalse(run_is_healthy(_manifest("not-a-date", "OK"), today=TODAY))

    def test_missing_date_field_is_not_healthy(self) -> None:
        self.assertFalse(run_is_healthy({"finalStatus": "OK"}, today=TODAY))

    def test_accepts_date_object_manifest_date(self) -> None:
        self.assertTrue(
            run_is_healthy({"date": TODAY, "finalStatus": "OK"}, today=TODAY)
        )


class ManifestIsStaleTests(unittest.TestCase):
    def test_absent_manifest_is_stale(self) -> None:
        self.assertTrue(manifest_is_stale(None, today=TODAY))

    def test_earlier_manifest_is_stale(self) -> None:
        self.assertTrue(manifest_is_stale(_manifest("2026-03-10"), today=TODAY))

    def test_today_manifest_is_not_stale_even_on_failure(self) -> None:
        self.assertFalse(manifest_is_stale(_manifest("2026-03-15", "ERROR"), today=TODAY))


class MissedWindowCountTests(unittest.TestCase):
    def test_same_day_success_has_no_missed_window(self) -> None:
        self.assertEqual(missed_window_count("2026-03-15", today=TODAY), 0)

    def test_consecutive_day_success_has_no_missed_window(self) -> None:
        self.assertEqual(missed_window_count("2026-03-14", today=TODAY), 0)

    def test_two_day_gap_has_one_missed_window(self) -> None:
        self.assertEqual(missed_window_count("2026-03-13", today=TODAY), 1)

    def test_larger_gap_counts_coalesced_windows(self) -> None:
        # Last success five days ago -> windows on the four intervening days missed.
        self.assertEqual(missed_window_count("2026-03-10", today=TODAY), 4)

    def test_future_last_success_returns_zero(self) -> None:
        self.assertEqual(missed_window_count("2026-03-20", today=TODAY), 0)

    def test_malformed_input_returns_zero(self) -> None:
        self.assertEqual(missed_window_count("garbage", today=TODAY), 0)
        self.assertEqual(missed_window_count(None, today=TODAY), 0)


class LastSuccessFromManifestTests(unittest.TestCase):
    def test_success_manifest_yields_its_date(self) -> None:
        self.assertEqual(
            last_success_date_from_manifest(_manifest("2026-03-12", "OK")),
            date(2026, 3, 12),
        )

    def test_failed_manifest_yields_none(self) -> None:
        self.assertIsNone(last_success_date_from_manifest(_manifest("2026-03-12", "ERROR")))

    def test_absent_manifest_yields_none(self) -> None:
        self.assertIsNone(last_success_date_from_manifest(None))


class BuildHealthReportTests(unittest.TestCase):
    def test_today_success_reports_succeeded(self) -> None:
        report = build_health_report(_manifest("2026-03-15", "OK"), today=TODAY)
        self.assertTrue(report["healthy"])
        self.assertEqual(report["reportedStatus"], REPORTED_STATUS_SUCCEEDED)
        self.assertFalse(report["manifestStale"])
        self.assertTrue(report["manifestPresent"])
        self.assertEqual(report["finalStatus"], "OK")
        self.assertEqual(report["date"], "2026-03-15")
        self.assertEqual(report["missedWindowCount"], 0)

    def test_stale_manifest_reports_not_succeeded_with_missed_windows(self) -> None:
        report = build_health_report(_manifest("2026-03-12", "OK"), today=TODAY)
        self.assertFalse(report["healthy"])
        self.assertEqual(report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED)
        self.assertTrue(report["manifestStale"])
        # Last success three days before today -> two coalesced missed windows.
        self.assertEqual(report["missedWindowCount"], 2)

    def test_absent_manifest_reports_not_succeeded(self) -> None:
        report = build_health_report(None, today=TODAY)
        self.assertFalse(report["healthy"])
        self.assertEqual(report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED)
        self.assertFalse(report["manifestPresent"])
        self.assertTrue(report["manifestStale"])
        self.assertIsNone(report["finalStatus"])

    def test_today_failure_reports_not_succeeded_without_missed_windows(self) -> None:
        report = build_health_report(_manifest("2026-03-15", "ERROR"), today=TODAY)
        self.assertFalse(report["healthy"])
        self.assertEqual(report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED)
        self.assertFalse(report["manifestStale"])
        self.assertEqual(report["finalStatus"], "ERROR")
        # A failed manifest never anchors the missed-window derivation.
        self.assertEqual(report["missedWindowCount"], 0)

    def test_unknown_final_status_is_normalized_to_none(self) -> None:
        report = build_health_report(
            {"date": "2026-03-15", "finalStatus": "provider: boom"}, today=TODAY
        )
        self.assertIsNone(report["finalStatus"])
        self.assertFalse(report["healthy"])


class WriteHealthReportTests(unittest.TestCase):
    def test_writes_report_from_manifest_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "current-summary.json"
            health_path = Path(tmp) / "current-health.json"
            manifest_path.write_text(
                json.dumps(_manifest("2026-03-15", "OK")), encoding="utf-8"
            )
            report = write_health_report(manifest_path, health_path, today=TODAY)
            self.assertEqual(report["reportedStatus"], REPORTED_STATUS_SUCCEEDED)
            on_disk = json.loads(health_path.read_text(encoding="utf-8"))
            self.assertEqual(on_disk, report)

    def test_missing_manifest_file_writes_not_succeeded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "does-not-exist.json"
            health_path = Path(tmp) / "current-health.json"
            report = write_health_report(manifest_path, health_path, today=TODAY)
            self.assertEqual(report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED)
            self.assertFalse(report["manifestPresent"])
            self.assertTrue(health_path.is_file())


if __name__ == "__main__":
    unittest.main()
