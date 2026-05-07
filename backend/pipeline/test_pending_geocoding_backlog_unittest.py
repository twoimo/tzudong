"""Regression tests for pending-geocoding backlog export/apply tooling."""

from __future__ import annotations

import csv
import importlib.util
import json
import tempfile
from pathlib import Path
import unittest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "bin" / "export_pending_geocoding_backlog.py"


def load_module():
    spec = importlib.util.spec_from_file_location("export_pending_geocoding_backlog", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError(f"failed to load {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PendingGeocodingBacklogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.input_path = self.root / "transforms.jsonl"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write_records(self, records: list[dict]) -> None:
        self.input_path.write_text(
            "\n".join(json.dumps(record, ensure_ascii=False) for record in records) + "\n",
            encoding="utf-8",
        )

    def test_export_counts_pending_backlog_and_unique_same_name_suggestion(self) -> None:
        self.write_records([
            {
                "trace_id": "known-1",
                "youtube_link": "https://www.youtube.com/watch?v=known",
                "channel_name": "tzuyang",
                "origin_name": "재사용식당",
                "source_type": "geminiCLI",
                "status": "pending",
                "lat": 37.5,
                "lng": 127.0,
                "geocoding_success": True,
            },
            {
                "trace_id": "pending-1",
                "youtube_link": "https://youtu.be/pending",
                "channel_name": "tzuyang",
                "origin_name": "재사용식당",
                "source_type": "geminiCLI",
                "status": "pending",
                "lat": None,
                "lng": None,
                "geocoding_success": False,
                "geocoding_false_stage": 2,
                "is_missing": False,
                "is_notSelected": False,
            },
            {
                "trace_id": "not-backlog",
                "youtube_link": "https://youtu.be/not",
                "channel_name": "tzuyang",
                "origin_name": "제외식당",
                "source_type": "geminiCLI",
                "status": "approved",
                "lat": None,
                "lng": None,
                "geocoding_success": False,
            },
        ])

        report = self.module.build_report(self.input_path, checked_at="2026-05-07T00:00:00Z")

        self.assertEqual("backlog", report["status"])
        self.assertEqual(1, report["pendingCount"])
        self.assertEqual({"2": 1}, report["stageCounts"])
        self.assertEqual(1, report["sameNameUniqueCoordinateSuggestionCount"])
        self.assertEqual(37.5, report["entries"][0]["suggestedKnownCoordinate"]["lat"])
        self.assertEqual("pending", report["entries"][0]["videoId"])

    def test_apply_corrections_requires_reviewed_trace_id_and_keeps_other_records(self) -> None:
        self.write_records([
            {
                "trace_id": "pending-1",
                "youtube_link": "https://youtu.be/pending",
                "channel_name": "tzuyang",
                "origin_name": "보정식당",
                "source_type": "geminiCLI",
                "status": "pending",
                "lat": None,
                "lng": None,
                "geocoding_success": False,
                "geocoding_false_stage": 1,
                "is_missing": False,
                "is_notSelected": False,
            },
            {
                "trace_id": "other-1",
                "youtube_link": "https://youtu.be/other",
                "channel_name": "tzuyang",
                "origin_name": "다른식당",
                "source_type": "geminiCLI",
                "status": "pending",
                "lat": None,
                "lng": None,
                "geocoding_success": False,
                "geocoding_false_stage": 1,
                "is_missing": False,
                "is_notSelected": False,
            },
        ])
        corrections_path = self.root / "corrections.csv"
        with corrections_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["traceId", "lat", "lng", "roadAddress"])
            writer.writeheader()
            writer.writerow({"traceId": "pending-1", "lat": "37.51", "lng": "127.02", "roadAddress": "서울시 테스트로 1"})

        output_path = self.root / "corrected.jsonl"
        result = self.module.apply_corrections(self.input_path, output_path, corrections_path)
        records = [json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines()]

        self.assertEqual(1, result["updatedCount"])
        self.assertEqual(37.51, records[0]["lat"])
        self.assertEqual(127.02, records[0]["lng"])
        self.assertTrue(records[0]["geocoding_success"])
        self.assertIsNone(records[0]["geocoding_false_stage"])
        self.assertIsNone(records[1]["lat"])


if __name__ == "__main__":
    unittest.main()
