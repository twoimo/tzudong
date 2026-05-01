from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "package_rule_rerun_matches.py"
spec = importlib.util.spec_from_file_location("package_rule_rerun_matches", SCRIPT)
package = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(package)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class PackageRuleRerunMatchesTest(unittest.TestCase):
    def test_package_report_writes_review_and_followup_queues(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            report = root / "report"
            output = root / "out"
            transforms = root / "transforms.jsonl"
            write_jsonl(
                transforms,
                [
                    {
                        "trace_id": "matched",
                        "status": "pending",
                        "geocoding_success": False,
                        "geocoding_false_stage": 2,
                    }
                ],
            )
            write_jsonl(
                report / "matched-rule-rerun-candidates.jsonl",
                [
                    {
                        "trace_id": "matched",
                        "video_id": "v1",
                        "youtube_link": "https://www.youtube.com/watch?v=v1",
                        "origin_name": "가게",
                        "origin_address_text": "서울",
                        "recommended_action": "rerun_stage1_source_geocode_then_stage2",
                    }
                ],
            )
            write_jsonl(
                report / "still-unresolved-after-rule-rerun.jsonl",
                [
                    {
                        "trace_id": "unresolved",
                        "pending_reason": "multi_candidate",
                        "recommended_action": "rerun_stage1_source_geocode_then_stage2",
                    },
                    {
                        "trace_id": "no-evidence",
                        "video_id": "v2",
                        "youtube_link": "https://www.youtube.com/watch?v=v2",
                        "origin_name": "증거부족",
                        "origin_address_text": "서울특별시 중구",
                        "pending_reason": "insufficient_evidence",
                        "recommended_action": "rerun_rule_evaluation_with_recovered_source_geocode",
                        "evidence_summary": ["Naver 실패: 1단계 실패: 검색 결과 없음"],
                    }
                ],
            )
            write_jsonl(
                report / "evaluation" / "rule_results" / "v1.jsonl",
                [
                    {
                        "evaluation_results": {
                            "location_match_TF": [
                                {
                                    "origin_name": "가게",
                                    "eval_value": True,
                                    "match_status": "matched",
                                    "matched_provider": "naver",
                                    "matched_name": "가게",
                                    "naver_name": "가게",
                                    "matched_address": {"distance": 250.0},
                                    "evidence_summary": ["ok"],
                                    "evidence_families": ["provider_candidate"],
                                }
                            ]
                        }
                    }
                ],
            )

            summary = package.package_report(report, transforms, output)

            self.assertEqual(1, summary["review_candidates"])
            self.assertEqual(2, summary["unresolved_input_rows"])
            self.assertEqual(1, summary["insufficient_evidence_rows"])
            self.assertEqual(1, summary["insufficient_evidence_bucket_counter"]["coarse_source_address_recrawl"])
            self.assertEqual(1, summary["risk_flag_counter"]["large_distance_over_200m"])
            review_rows = [json.loads(line) for line in (output / "matched-review-candidates.jsonl").read_text().splitlines()]
            self.assertEqual("admin_review_before_sync", review_rows[0]["review_recommendation"])
            self.assertEqual(250.0, review_rows[0]["matched_distance_m"])
            self.assertEqual("가게", review_rows[0]["naver_name"])
            self.assertTrue((output / "matched-review-candidates.csv").exists())
            self.assertIn("trace_id,source_line,origin_name", (output / "matched-review-candidates.csv").read_text(encoding="utf-8-sig"))
            self.assertIn("| trace_id | line | origin |", (output / "matched-review-table.md").read_text(encoding="utf-8"))
            self.assertTrue((output / "insufficient-evidence-recrawl-table.csv").exists())
            self.assertTrue((output / "insufficient_evidence_recrawl_queues" / "coarse_source_address_recrawl.jsonl").exists())
            self.assertEqual(1, summary["coarse_address_recrawl_jobs"])
            self.assertTrue((output / "coarse-address-recrawl-jobs.jsonl").exists())
            self.assertIn("증거부족", (output / "coarse-address-recrawl-jobs.md").read_text(encoding="utf-8"))
            self.assertEqual(0, summary["provider_search_review_jobs"])
            self.assertTrue((output / "provider-search-review-jobs.jsonl").exists())
            self.assertEqual(0, summary["distance_no_candidate_review_jobs"])
            self.assertTrue((output / "distance-no-candidate-review-jobs.jsonl").exists())
            self.assertEqual(0, summary["generic_evidence_gap_jobs"])
            self.assertTrue((output / "generic-evidence-gap-jobs.jsonl").exists())
            self.assertTrue((output / "unresolved_followup_queues" / "multi_candidate.jsonl").exists())

    def test_build_coarse_address_recrawl_jobs_adds_queries_and_private_flag(self):
        rows = [
            {
                "trace_id": "coarse",
                "source_line": 7,
                "video_id": "v1",
                "youtube_link": "https://www.youtube.com/watch?v=v1",
                "origin_name": "[비공개] 동해시 킹크랩 식당",
                "origin_address_text": "강원도 동해시",
                "recrawl_bucket": "coarse_source_address_recrawl",
                "problem_tags": ["coarse_source_address"],
                "source_selection_file": "selection.jsonl",
                "evidence_text": "검색 결과 없음",
            },
            {"trace_id": "other", "recrawl_bucket": "provider_search_no_result"},
        ]

        jobs = package.build_coarse_address_recrawl_jobs(rows)

        self.assertEqual(1, len(jobs))
        self.assertEqual("district_or_city_level", jobs[0]["address_precision"])
        self.assertTrue(jobs[0]["is_private_or_masked_name"])
        self.assertIn("private_masked_name_manual_review", jobs[0]["problem_tags"])
        self.assertIn("동해시 킹크랩 식당 강원도 동해시", jobs[0]["suggested_search_queries"])
        self.assertIn("강원도 동해시 동해시 킹크랩 식당", jobs[0]["suggested_search_queries"])
        self.assertNotIn("[비공개]", " ".join(jobs[0]["suggested_search_queries"]))
        self.assertEqual("recover_precise_road_or_jibun_address_from_video_evidence", jobs[0]["recrawl_instruction"])

    def test_write_coarse_address_recrawl_outputs_creates_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [
                {
                    "trace_id": "coarse",
                    "source_line": 7,
                    "video_id": "v1",
                    "youtube_link": "https://www.youtube.com/watch?v=v1",
                    "origin_name": "가게",
                    "origin_address_text": "서울특별시 마포구 연남동",
                    "recrawl_bucket": "coarse_source_address_recrawl",
                    "problem_tags": ["coarse_source_address"],
                }
            ]

            summary = package.write_coarse_address_recrawl_outputs(root, rows)

            self.assertEqual(1, summary["coarse_address_recrawl_jobs"])
            self.assertEqual(0, summary["coarse_address_private_or_masked"])
            self.assertTrue((root / "coarse-address-recrawl-jobs.jsonl").exists())
            self.assertTrue((root / "coarse-address-recrawl-jobs.csv").exists())
            self.assertTrue((root / "coarse-address-recrawl-jobs.md").exists())
            self.assertTrue((root / "coarse-address-recrawl-manifest.json").exists())
            self.assertIn("가게", (root / "coarse-address-recrawl-jobs.md").read_text(encoding="utf-8"))


    def test_build_provider_search_review_jobs_adds_query_variants_and_actions(self):
        rows = [
            {
                "trace_id": "provider",
                "source_line": 12,
                "video_id": "v1",
                "youtube_link": "https://www.youtube.com/watch?v=v1",
                "origin_name": "테그42 신림점",
                "origin_address_text": "서울특별시 관악구 신림로 340",
                "recrawl_bucket": "provider_search_no_result",
                "problem_tags": ["naver_search_no_result"],
                "source_selection_file": "selection.jsonl",
                "evidence_text": "검색 결과 없음",
            },
            {"trace_id": "other", "recrawl_bucket": "coarse_source_address_recrawl"},
        ]

        jobs = package.build_provider_search_review_jobs(rows)

        self.assertEqual(1, len(jobs))
        self.assertEqual("road_or_lot_present", jobs[0]["address_precision"])
        self.assertIn("테그42 신림점 서울특별시 관악구 신림로 340", jobs[0]["suggested_search_queries"])
        self.assertIn("테그42 서울특별시 관악구 신림로", jobs[0]["suggested_search_queries"])
        self.assertIn("name_variant_query_check", jobs[0]["problem_tags"])
        self.assertIn("correct_source_name_then_rerun_stage1_stage2", jobs[0]["next_action_options"])
        self.assertEqual("verify_closed_renamed_or_name_query_issue_before_recrawl", jobs[0]["review_instruction"])

    def test_write_provider_search_review_outputs_creates_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [
                {
                    "trace_id": "provider",
                    "source_line": 12,
                    "video_id": "v1",
                    "youtube_link": "https://www.youtube.com/watch?v=v1",
                    "origin_name": "숙달돼지 삼성점",
                    "origin_address_text": "서울특별시 강남구 삼성로104길 13",
                    "recrawl_bucket": "provider_search_no_result",
                    "problem_tags": ["naver_search_no_result"],
                }
            ]

            summary = package.write_provider_search_review_outputs(root, rows)

            self.assertEqual(1, summary["provider_search_review_jobs"])
            self.assertEqual(1, summary["provider_search_problem_tag_counter"]["provider_search_no_result"])
            self.assertTrue((root / "provider-search-review-jobs.jsonl").exists())
            self.assertTrue((root / "provider-search-review-jobs.csv").exists())
            self.assertTrue((root / "provider-search-review-jobs.md").exists())
            self.assertTrue((root / "provider-search-review-manifest.json").exists())
            self.assertIn("숙달돼지", (root / "provider-search-review-jobs.md").read_text(encoding="utf-8"))


    def test_build_distance_no_candidate_review_jobs_adds_radius_and_coordinate_flags(self):
        rows = [
            {
                "trace_id": "distance",
                "source_line": 21,
                "video_id": "v1",
                "youtube_link": "https://www.youtube.com/watch?v=v1",
                "origin_name": "치킨플러스 여의도점",
                "origin_address_text": "서울특별시 영등포구 여의도동",
                "recrawl_bucket": "distance_no_candidate_review",
                "problem_tags": ["no_candidate_within_20m"],
                "source_lat": None,
                "source_lng": None,
                "evidence_text": "20m 이내 후보 없음",
            },
            {"trace_id": "other", "recrawl_bucket": "provider_search_no_result"},
        ]

        jobs = package.build_distance_no_candidate_review_jobs(rows)

        self.assertEqual(1, len(jobs))
        self.assertEqual("dong_level", jobs[0]["address_precision"])
        self.assertEqual(20, jobs[0]["distance_threshold_m"])
        self.assertEqual([50, 100, 200, 500], jobs[0]["suggested_review_radius_m"])
        self.assertIn("missing_source_coordinates", jobs[0]["problem_tags"])
        self.assertIn("coarse_address_context", jobs[0]["problem_tags"])
        self.assertIn("correct_source_coordinates_then_rerun_stage2", jobs[0]["next_action_options"])
        self.assertEqual(
            "verify_source_coordinates_radius_or_video_evidence_before_accepting_distance_exception",
            jobs[0]["review_instruction"],
        )

    def test_write_distance_no_candidate_review_outputs_creates_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [
                {
                    "trace_id": "distance",
                    "source_line": 21,
                    "video_id": "v1",
                    "youtube_link": "https://www.youtube.com/watch?v=v1",
                    "origin_name": "인천분식",
                    "origin_address_text": "경북 구미시 선산읍 선산중앙로 78",
                    "recrawl_bucket": "distance_no_candidate_review",
                    "problem_tags": ["no_candidate_within_20m"],
                    "source_lat": 36.0,
                    "source_lng": 128.0,
                }
            ]

            summary = package.write_distance_no_candidate_review_outputs(root, rows)

            self.assertEqual(1, summary["distance_no_candidate_review_jobs"])
            self.assertEqual(0, summary["distance_no_candidate_missing_source_coordinates"])
            self.assertTrue((root / "distance-no-candidate-review-jobs.jsonl").exists())
            self.assertTrue((root / "distance-no-candidate-review-jobs.csv").exists())
            self.assertTrue((root / "distance-no-candidate-review-jobs.md").exists())
            self.assertTrue((root / "distance-no-candidate-review-manifest.json").exists())
            self.assertIn("인천분식", (root / "distance-no-candidate-review-jobs.md").read_text(encoding="utf-8"))


    def test_build_generic_evidence_gap_jobs_adds_manual_classification_options(self):
        rows = [
            {
                "trace_id": "generic",
                "source_line": 31,
                "video_id": "v1",
                "youtube_link": "https://www.youtube.com/watch?v=v1",
                "origin_name": "세븐일레븐 종로청운점",
                "origin_address_text": "서울특별시 종로구 자하문로 102",
                "recrawl_bucket": "generic_evidence_gap",
                "problem_tags": [],
                "source_lat": None,
                "source_lng": None,
                "evidence_text": "Exact-title candidate looked like a non-restaurant facility",
                "recommended_action": "rerun_stage1_source_geocode_then_stage2",
            },
            {"trace_id": "other", "recrawl_bucket": "distance_no_candidate_review"},
        ]

        jobs = package.build_generic_evidence_gap_jobs(rows)

        self.assertEqual(1, len(jobs))
        self.assertEqual("road_or_lot_present", jobs[0]["address_precision"])
        self.assertIn("non_restaurant_candidate_check", jobs[0]["problem_tags"])
        self.assertIn("missing_source_coordinates", jobs[0]["problem_tags"])
        self.assertIn("tag_non_restaurant_or_out_of_scope", jobs[0]["next_action_options"])
        self.assertEqual(
            "manually_enrich_video_or_source_evidence_and_classify_final_blocker",
            jobs[0]["review_instruction"],
        )

    def test_write_generic_evidence_gap_outputs_creates_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [
                {
                    "trace_id": "generic",
                    "source_line": 31,
                    "video_id": "v1",
                    "youtube_link": "https://www.youtube.com/watch?v=v1",
                    "origin_name": "세븐일레븐 종로청운점",
                    "origin_address_text": "서울특별시 종로구 자하문로 102",
                    "recrawl_bucket": "generic_evidence_gap",
                    "problem_tags": [],
                    "evidence_text": "Exact-title candidate looked like a non-restaurant facility",
                }
            ]

            summary = package.write_generic_evidence_gap_outputs(root, rows)

            self.assertEqual(1, summary["generic_evidence_gap_jobs"])
            self.assertEqual(1, summary["generic_evidence_gap_problem_tag_counter"]["generic_evidence_gap"])
            self.assertTrue((root / "generic-evidence-gap-jobs.jsonl").exists())
            self.assertTrue((root / "generic-evidence-gap-jobs.csv").exists())
            self.assertTrue((root / "generic-evidence-gap-jobs.md").exists())
            self.assertTrue((root / "generic-evidence-gap-manifest.json").exists())
            self.assertIn("세븐일레븐", (root / "generic-evidence-gap-jobs.md").read_text(encoding="utf-8"))

    def test_markdown_cell_escapes_pipes_and_lists(self):
        self.assertEqual("A\\|B", package.markdown_cell("A|B"))
        self.assertEqual("a, b", package.markdown_cell(["a", "b"]))

    def test_build_multi_candidate_comparisons_uses_live_candidates(self):
        rows = [
            {
                "trace_id": "trace",
                "video_id": "v1",
                "origin_name": "가게",
                "origin_address_text": "서울 중구",
                "youtube_link": "https://www.youtube.com/watch?v=v1",
            }
        ]
        transforms = {"trace": {"origin_address": {"lat": 37.5, "lng": 127.0}}}

        def fake_search(query, headers, timeout):
            return {
                "status": "ok",
                "items": [
                    {
                        "title": "<b>가게</b>",
                        "category": "한식",
                        "roadAddress": "서울 중구 테스트로 1",
                        "address": "서울 중구 테스트동 1",
                        "mapx": "1270000000",
                        "mapy": "375000000",
                    }
                ],
            }

        original = package.naver_local_search
        package.naver_local_search = fake_search
        try:
            comparisons = package.build_multi_candidate_comparisons(rows, transforms, {}, 1.0)
        finally:
            package.naver_local_search = original

        self.assertEqual(1, len(comparisons))
        self.assertEqual("가게", comparisons[0]["candidate_title"])
        self.assertEqual(1, comparisons[0]["candidate_rank"])
        self.assertLessEqual(comparisons[0]["candidate_distance_m"], 1)

    def test_write_multi_candidate_tables_creates_review_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [
                {
                    "trace_id": "trace",
                    "video_id": "v1",
                    "origin_name": "가게",
                    "candidate_rank": 1,
                    "candidate_title": "가게 후보",
                    "candidate_category": "한식",
                    "candidate_road_address": "서울",
                    "candidate_distance_m": 3.0,
                    "youtube_link": "https://www.youtube.com/watch?v=v1",
                }
            ]

            summary = package.write_multi_candidate_tables(root, rows)

            self.assertEqual(1, summary["multi_candidate_comparison_rows"])
            self.assertTrue((root / "multi-candidate-comparison.csv").exists())
            self.assertIn("가게 후보", (root / "multi-candidate-comparison.md").read_text(encoding="utf-8"))

    def test_insufficient_evidence_bucket_prioritizes_distance_review(self):
        row = {
            "recommended_action": "rerun_stage1_source_geocode_then_stage2",
            "origin_address_text": "서울특별시 중구 세종대로 1",
            "evidence_summary": ["Naver 실패: 2단계 실패: 20m 이내 후보 없음"],
        }
        bucket, action, tags = package.insufficient_evidence_bucket(row, {})

        self.assertEqual("distance_no_candidate_review", bucket)
        self.assertEqual("review_source_coordinates_or_expand_radius_with_video_evidence", action)
        self.assertIn("no_candidate_within_20m", tags)

    def test_latest_rule_rerun_prefers_expanded_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / "rule-rerun-20260101T000000Z"
            expanded = root / "rule-rerun-expanded-20260101T000000Z"
            old.mkdir()
            expanded.mkdir()

            self.assertEqual(expanded, package.latest_rule_rerun_report(root))


if __name__ == "__main__":
    unittest.main()
