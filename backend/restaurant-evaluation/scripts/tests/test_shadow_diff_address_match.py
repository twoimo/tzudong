from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


MODULE_PATH = Path(__file__).resolve().parents[1] / "shadow_diff_address_match.py"


def load_module():
    spec = importlib.util.spec_from_file_location("shadow_diff_address_match", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ShadowDiffAddressMatchTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.module = load_module()
        self.tmp = TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_run_shadow_diff_writes_expected_artifacts(self) -> None:
        baseline_path = self.base / "baseline.jsonl"
        candidate_path = self.base / "candidate.jsonl"
        out_dir = self.base / "reports"

        self._write_jsonl(
            baseline_path,
            [
                self._row(
                    youtube_link="https://youtube.com/watch?v=base-1",
                    trace_id="trace-original-a",
                    origin_name="원본A",
                    trace_id_name_source="original",
                    eval_value=False,
                    match_status="pending",
                    pending_reason="insufficient_evidence",
                    false_message="후보 근거 부족",
                ),
                self._row(
                    youtube_link="https://youtube.com/watch?v=base-2",
                    trace_id="trace-b",
                    origin_name="기존B",
                    trace_id_name_source="naver",
                    eval_value=True,
                    matched_provider="naver",
                    matched_name="기존B",
                    naver_name="기존B",
                ),
            ],
        )

        self._write_jsonl(
            candidate_path,
            [
                self._row(
                    youtube_link="https://youtube.com/watch?v=base-1",
                    trace_id="trace-google-a",
                    origin_name="원본A",
                    trace_id_name_source="google",
                    eval_value=True,
                    matched_provider="google",
                    matched_name="새A",
                    google_name="새A",
                    evidence_families=["provider_candidate", "cross_provider"],
                    evidence_summary=["google candidate matched", "cross-provider agreement"],
                    second_pass={
                        "attempted": True,
                        "provider": "google",
                        "timed_out": False,
                        "rate_limited": False,
                        "duration_ms": 810,
                    },
                ),
                self._row(
                    youtube_link="https://youtube.com/watch?v=base-2",
                    trace_id="trace-b",
                    origin_name="기존B",
                    trace_id_name_source="naver",
                    eval_value=False,
                    match_status="pending",
                    pending_reason="insufficient_evidence",
                    false_message="근거 부족",
                ),
                self._row(
                    youtube_link="https://youtube.com/watch?v=thai-1",
                    trace_id="shared-trace",
                    origin_name="태국맛집1",
                    trace_id_name_source="google",
                    eval_value=True,
                    matched_provider="google",
                    matched_name="태국맛집1",
                    google_name="태국맛집1",
                    origin_address="Bangkok 10500 Thailand",
                    matched_address={"englishAddress": "Silom, Bangkok 10500, Thailand"},
                    evidence_families=["provider_candidate", "browser_verification"],
                    evidence_summary=["overseas google candidate", "browser screenshot verified"],
                    second_pass={
                        "attempted": True,
                        "provider": "browser",
                        "timed_out": False,
                        "rate_limited": False,
                        "duration_ms": 950,
                    },
                ),
                self._row(
                    youtube_link="https://youtube.com/watch?v=thai-2",
                    trace_id="shared-trace",
                    origin_name="태국맛집2",
                    trace_id_name_source="google",
                    eval_value=True,
                    matched_provider="google",
                    matched_name="태국맛집2",
                    google_name="태국맛집2",
                    origin_address="Bangkok 10500 Thailand",
                    matched_address={"englishAddress": "Silom, Bangkok 10500, Thailand"},
                    evidence_families=["provider_candidate", "browser_verification"],
                    evidence_summary=["overseas google candidate", "browser screenshot verified"],
                    second_pass={
                        "attempted": True,
                        "provider": "browser",
                        "timed_out": False,
                        "rate_limited": False,
                        "duration_ms": 910,
                    },
                ),
                self._row(
                    youtube_link="https://youtube.com/watch?v=timeout-1",
                    trace_id="trace-timeout",
                    origin_name="보류식당",
                    trace_id_name_source="original",
                    eval_value=False,
                    match_status="pending",
                    pending_reason="timeout",
                    false_message="second pass timeout",
                    second_pass={
                        "attempted": True,
                        "provider": "browser",
                        "timed_out": True,
                        "rate_limited": False,
                        "duration_ms": 1200,
                    },
                ),
            ],
        )

        exit_code = self.module.main(
            [
                "--baseline",
                str(baseline_path),
                "--candidate",
                str(candidate_path),
                "--out-dir",
                str(out_dir),
            ]
        )

        self.assertEqual(0, exit_code)

        summary = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))
        counters = json.loads((out_dir / "second-pass-counters.json").read_text(encoding="utf-8"))
        promotions = self._read_jsonl(out_dir / "promotions.jsonl")
        sample_review = self._read_jsonl(out_dir / "sample-review.jsonl")

        self.assertEqual(3, summary["added_true"])
        self.assertEqual(3, summary["promoted_to_true"])
        self.assertEqual(1, summary["removed_true"])
        self.assertEqual(1, summary["trace_id_name_source_changes"])
        self.assertEqual(1, summary["duplicate_risk_candidates_count"])
        self.assertEqual(3, summary["sample_review_size"])
        self.assertEqual(
            {
                "second_pass_attempted": 4,
                "second_pass_promoted_true": 3,
                "second_pass_timeout": 1,
                "second_pass_rate_limited": 0,
                "second_pass_left_pending": 1,
            },
            counters,
        )

        self.assertEqual(3, len(promotions))
        self.assertEqual(3, len(sample_review))

        alias_promotion = next(item for item in promotions if item["origin_name"] == "원본A")
        overseas_promotion = next(item for item in promotions if item["origin_name"] == "태국맛집1")
        self.assertEqual(["alias_mismatch"], alias_promotion["review_buckets"])
        self.assertIn("overseas", overseas_promotion["review_buckets"])

    def test_select_sample_review_keeps_edge_case_promotions(self) -> None:
        promotions = []
        for idx in range(60):
            promotions.append(
                {
                    "comparison_key": f"video-{idx}::식당{idx}",
                    "origin_name": f"식당{idx}",
                    "review_buckets": [],
                }
            )
        promotions[55]["review_buckets"] = ["alias_mismatch"]
        promotions[56]["review_buckets"] = ["overseas"]
        promotions[57]["review_buckets"] = ["multi_candidate"]

        sample = self.module.select_sample_review(promotions, limit=50, seed=7)
        sample_keys = {item["comparison_key"] for item in sample}

        self.assertEqual(50, len(sample))
        self.assertIn(promotions[55]["comparison_key"], sample_keys)
        self.assertIn(promotions[56]["comparison_key"], sample_keys)
        self.assertIn(promotions[57]["comparison_key"], sample_keys)

    def test_expand_payload_records_supports_video_level_rule_results(self) -> None:
        payload = {
            "youtube_link": "https://youtube.com/watch?v=video-level",
            "restaurants": [
                {"origin_name": "식당A", "address": "서울 중구 어딘가 1"},
                {"origin_name": "식당B", "address": "서울 중구 어딘가 2"},
            ],
            "evaluation_results": {
                "location_match_TF": [
                    {
                        "origin_name": "식당A",
                        "eval_value": True,
                        "matched_provider": "google",
                        "matched_name": "식당A 본점",
                        "google_name": "식당A 본점",
                        "evidence_families": ["provider_candidate", "cross_provider"],
                    },
                    {
                        "origin_name": "식당B",
                        "eval_value": False,
                        "match_status": "pending",
                        "pending_reason": "multi_candidate",
                        "falseMessage": "복수 후보",
                    },
                ]
            },
        }

        records = self.module.expand_payload_records(payload, MODULE_PATH, 1)

        self.assertEqual(2, len(records))
        self.assertEqual("식당A", records[0]["origin_name"])
        self.assertEqual("식당A 본점", records[0]["matched_name"])
        self.assertEqual(["provider_candidate", "cross_provider"], records[0]["evidence_families"])
        self.assertEqual("식당B", records[1]["origin_name"])
        self.assertEqual("multi_candidate", records[1]["pending_reason"])

    def _row(
        self,
        *,
        youtube_link: str,
        trace_id: str,
        origin_name: str,
        trace_id_name_source: str,
        eval_value: bool,
        match_status: str | None = None,
        pending_reason: str | None = None,
        false_message: str | None = None,
        matched_provider: str | None = None,
        matched_name: str | None = None,
        naver_name: str | None = None,
        google_name: str | None = None,
        origin_address: str | None = None,
        matched_address: dict | None = None,
        evidence_families: list[str] | None = None,
        evidence_summary: list[str] | None = None,
        second_pass: dict | None = None,
    ) -> dict:
        return {
            "youtube_link": youtube_link,
            "trace_id": trace_id,
            "origin_name": origin_name,
            "trace_id_name_source": trace_id_name_source,
            "origin_address": origin_address,
            "evaluation_results": {
                "location_match_TF": {
                    "origin_name": origin_name,
                    "eval_value": eval_value,
                    "match_status": match_status,
                    "pending_reason": pending_reason,
                    "falseMessage": false_message,
                    "matched_provider": matched_provider,
                    "matched_name": matched_name,
                    "naver_name": naver_name,
                    "google_name": google_name,
                    "matched_address": matched_address,
                    "evidence_families": evidence_families or [],
                    "evidence_summary": evidence_summary or [],
                    "second_pass": second_pass or {
                        "attempted": False,
                        "provider": None,
                        "timed_out": False,
                        "rate_limited": False,
                        "duration_ms": None,
                    },
                }
            },
        }

    def _write_jsonl(self, path: Path, rows: list[dict]) -> None:
        path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
            encoding="utf-8",
        )

    def _read_jsonl(self, path: Path) -> list[dict]:
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]


if __name__ == "__main__":
    unittest.main()
