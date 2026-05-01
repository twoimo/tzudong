from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "tag_geocoding_reprocess_failures.py"
spec = importlib.util.spec_from_file_location("tag_geocoding_reprocess_failures", SCRIPT)
tagger = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(tagger)


class StageReprocessTaggingTest(unittest.TestCase):
    def test_stage1_coarse_address_becomes_recrawl_target(self):
        record = {"origin_address": {"address": "서울특별시 서대문구 창천동"}}
        status, tags, action = tagger.tag_stage1(record, {"status": "no_result"}, live_api=True)
        self.assertEqual("unresolved", status)
        self.assertIn("source_address_too_coarse", tags)
        self.assertIn("recrawl_target", tags)
        self.assertEqual("recrawl_or_manual_source_address_enrichment", action)

    def test_stage1_live_geocode_recovery_is_reprocess_candidate(self):
        record = {"origin_address": {"address": "서울특별시 중구 세종대로 110"}}
        status, tags, action = tagger.tag_stage1(record, {"ok": True, "status": "ok"}, live_api=True)
        self.assertEqual("reprocess_candidate", status)
        self.assertIn("source_geocode_recovered", tags)
        self.assertEqual("rerun_rule_evaluation_with_recovered_source_geocode", action)

    def test_stage2_no_candidate_tags_possible_closed_or_renamed(self):
        record = {"lat": 37.5, "lng": 127.0}
        status, tags, action = tagger.tag_stage2(
            record,
            {"status": "no_result", "items": []},
            {"has_source_coordinates": True, "nearest_distance_m": None},
            live_api=True,
        )
        self.assertEqual("unresolved", status)
        self.assertIn("naver_local_no_candidate", tags)
        self.assertIn("possibly_closed_or_renamed", tags)
        self.assertEqual("manual_search_or_closed_business_check", action)

    def test_stage2_far_candidate_tags_bad_source_or_recrawl(self):
        record = {"lat": 37.5, "lng": 127.0}
        status, tags, action = tagger.tag_stage2(
            record,
            {"status": "ok", "items": [{"title": "후보"}]},
            {"has_source_coordinates": True, "nearest_distance_m": 1500.0},
            live_api=True,
        )
        self.assertEqual("unresolved", status)
        self.assertIn("candidate_far_from_source", tags)
        self.assertIn("bad_source_data_or_wrong_restaurant", tags)
        self.assertIn("recrawl_target", tags)
        self.assertEqual("recrawl_source_evidence_or_manual_geocode", action)

    def test_candidate_distance_uses_nested_origin_coordinates(self):
        summary = tagger.candidate_distance_summary(
            {"origin_address": {"lat": 37.545199, "lng": 126.968603}},
            [{"mapy": 375451990, "mapx": 1269686030}],
        )
        self.assertTrue(summary["has_source_coordinates"])
        self.assertLessEqual(summary["nearest_distance_m"], 1)

    def test_write_action_queues_creates_priority_manifest(self):
        rows = [
            {
                "trace_id": "b",
                "stage": "candidate_location_mismatch",
                "recommended_action": "manual_distance_review",
            },
            {
                "trace_id": "a",
                "stage": "source_location_unresolved",
                "recommended_action": "rerun_rule_evaluation_with_recovered_source_geocode",
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            manifest = tagger.write_action_queues(Path(tmp), rows)
            self.assertEqual(
                [
                    "10-rerun-rule-evaluation-with-recovered-source-geocode",
                    "80-manual-distance-review",
                ],
                [item["slug"] for item in manifest],
            )
            queue_dir = Path(tmp) / "next_action_queues"
            self.assertTrue((queue_dir / "manifest.json").exists())
            first_queue = queue_dir / "10-rerun-rule-evaluation-with-recovered-source-geocode.jsonl"
            self.assertEqual("a", json.loads(first_queue.read_text(encoding="utf-8"))["trace_id"])

    def test_geocoder_failed_retry_recovery(self):
        status, tags, action = tagger.tag_geocoder_failed(
            {"origin_address": "서울특별시 중구 세종대로 110"},
            {"ok": True, "status": "ok"},
            live_api=True,
        )
        self.assertEqual("reprocess_candidate", status)
        self.assertIn("geocoder_retry_recovered", tags)
        self.assertEqual("rerun_rule_evaluation_with_recovered_geocode", action)


if __name__ == "__main__":
    unittest.main()
