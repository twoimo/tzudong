"""Executable baseline for backend data-contract documentation.

These tests intentionally use stdlib ``unittest`` so they can run in the same
lightweight environments as the existing backend regression tests.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import re
import sys
import types
import typing
import unittest

if not hasattr(typing, "Annotated"):
    class _AnnotatedCompat:
        """Minimal runtime compatibility shim for Python < 3.9."""

        def __class_getitem__(cls, item):
            if isinstance(item, tuple) and item:
                return item[0]
            return item

    typing.Annotated = _AnnotatedCompat  # type: ignore[attr-defined]

from backend.pipeline.state import StepName
from backend.pipeline.validators import (
    LAAJ_EXPECTED_KEYS,
    TRANSFORM_REQUIRED_FIELDS,
    cross_validate,
    validate_gemini_output,
    validate_laaj_results,
    validate_rule_results,
    validate_selection,
    validate_transform_output,
)


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent


def _load_script_module(script_path: Path, module_name: str, *, fake_supabase: bool = False):
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"failed to load spec for {script_path}")

    module = importlib.util.module_from_spec(spec)
    previous_supabase = None
    if fake_supabase:
        fake_supabase_module = types.ModuleType("supabase")
        fake_supabase_module.Client = object
        fake_supabase_module.create_client = lambda *args, **kwargs: None
        previous_supabase = sys.modules.get("supabase")
        sys.modules["supabase"] = fake_supabase_module

    try:
        spec.loader.exec_module(module)
    finally:
        if fake_supabase:
            if previous_supabase is None:
                sys.modules.pop("supabase", None)
            else:
                sys.modules["supabase"] = previous_supabase

    return module


class DataContractBaselineTests(unittest.TestCase):
    def test_documented_stage_names_track_pipeline_step_enum(self) -> None:
        docs = (BACKEND_ROOT / "DATA_CONTRACTS.md").read_text(encoding="utf-8")

        for step in StepName:
            self.assertIn(step.value, docs)

    def test_documented_transform_required_fields_track_validator_constant(self) -> None:
        docs = (BACKEND_ROOT / "DATA_CONTRACTS.md").read_text(encoding="utf-8")

        for field in sorted(TRANSFORM_REQUIRED_FIELDS):
            self.assertIn(field, docs)

    def test_documented_codebase_paths_exist(self) -> None:
        docs = (BACKEND_ROOT / "DATA_CONTRACTS.md").read_text(encoding="utf-8")
        documented_paths = re.findall(r"`((?:apps|restaurant-[^`]+|pipeline)[^`]*)`", docs)

        self.assertTrue(documented_paths, "expected DATA_CONTRACTS.md to document codebase paths")
        missing: list[str] = []
        for raw_path in documented_paths:
            if raw_path.startswith("apps/"):
                candidate = REPO_ROOT / raw_path
            else:
                candidate = BACKEND_ROOT / raw_path
            if not candidate.exists():
                missing.append(raw_path)

        self.assertEqual([], missing)

    def test_happy_path_contract_fixtures_pass_current_validators(self) -> None:
        video_id = "contract-video-1"
        restaurant_name = "계약식당"

        crawling_output = {
            "youtube_link": "https://www.youtube.com/watch?v=contract-video-1",
            "restaurants": [
                {
                    "origin_name": restaurant_name,
                    "address": "서울특별시 강남구 테헤란로 123",
                    "lat": 37.501,
                    "lng": 127.039,
                    "category": "한식",
                    "reasoning_basis": "영상 자막과 설명에서 식당 방문 맥락이 충분히 확인됩니다.",
                    "youtuber_review": "음식과 위치에 대한 구체적인 방문 후기가 충분히 포함되어 있습니다.",
                }
            ],
        }
        self.assertEqual([], validate_gemini_output(video_id, crawling_output))

        selection_output = {
            **crawling_output,
            "evaluation_target": {restaurant_name: True},
        }
        self.assertEqual([], validate_selection(video_id, selection_output))

        rule_output = {
            **selection_output,
            "evaluation_results": {
                "location_match_TF": [
                    {
                        "origin_name": restaurant_name,
                        "matched_name": restaurant_name,
                        "naver_name": restaurant_name,
                        "eval_value": True,
                        "evidence_families": ["provider_candidate", "coordinate_distance"],
                    }
                ],
                "category_validity_TF": [
                    {"name": restaurant_name, "eval_value": True}
                ],
            },
        }
        self.assertEqual([], validate_rule_results(video_id, rule_output))

        laaj_output = {
            "youtube_link": crawling_output["youtube_link"],
            "restaurants": [{"origin_name": restaurant_name}],
            "evaluation_results": {
                "visit_authenticity": [
                    {"name": restaurant_name, "eval_value": 2, "eval_basis": "방문 장면과 언급이 확인됩니다."}
                ],
                "rb_inference_score": [
                    {"name": restaurant_name, "eval_value": 1, "eval_basis": "추론 근거가 보조적으로 존재합니다."}
                ],
                "rb_grounding_TF": [
                    {"name": restaurant_name, "eval_value": True}
                ],
                "review_faithfulness_score": [
                    {"name": restaurant_name, "eval_value": 0.9, "eval_basis": "리뷰 내용이 자막 근거와 일치합니다."}
                ],
                "category_TF": [
                    {"name": restaurant_name, "eval_value": True}
                ],
            },
        }
        self.assertEqual([], validate_laaj_results(video_id, laaj_output))
        self.assertEqual([], cross_validate(video_id, rule_output, laaj_output))

        transformed_records = [
            {
                "trace_id": "contract-video-1:contract-restaurant",
                "youtube_link": crawling_output["youtube_link"],
                "channel_name": "tzuyang",
                "origin_name": restaurant_name,
                "source_type": "geminiCLI",
                "lat": 37.501,
                "lng": 127.039,
                "evaluation_results": laaj_output["evaluation_results"],
            }
        ]
        self.assertEqual([], validate_transform_output(video_id, transformed_records))

    def test_frame_caption_observed_contract_fixture(self) -> None:
        record = {
            "video_id": "contract-video-1",
            "recollect_id": 0,
            "start_sec": 10,
            "end_sec": 20,
            "duration": 100,
            "rank": 1,
            "image_format": "jpg",
            "resolution": "360p",
            "fps": 1.0,
            "file_names": ["10.jpg", "11.jpg"],
            "frame_count": 2,
            "parsed_json": {
                "chronological_analysis": "장면 흐름 설명",
                "highlight_keywords": ["음식", "리액션"],
            },
            "raw_caption": "{\"chronological_analysis\":\"장면 흐름 설명\"}",
        }

        self.assertIsInstance(record["file_names"], list)
        self.assertEqual(len(record["file_names"]), record["frame_count"])
        self.assertIsInstance(record["raw_caption"], str)
        self.assertIn("parsed_json", record)

    def test_supabase_insert_payload_contract_tracks_build_record(self) -> None:
        script_path = BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py"
        module = _load_script_module(script_path, "supabase_insert_contract", fake_supabase=True)

        record = module.build_record(
            {
                "trace_id": "trace-1",
                "youtube_link": "https://youtu.be/contract-video-1",
                "origin_name": "계약식당",
                "category": "한식",
                "lat": 37.501,
                "lng": 127.039,
                "evaluation_results": {"location_match_TF": []},
                "source_type": "geminiCLI",
            },
            "tzuyang",
        )

        for field in [
            "trace_id",
            "youtube_link",
            "channel_name",
            "status",
            "origin_name",
            "categories",
            "lat",
            "lng",
            "evaluation_results",
            "source_type",
            "created_at",
        ]:
            self.assertIn(field, record)
        self.assertEqual("tzuyang", record["channel_name"])
        self.assertEqual(["한식"], record["categories"])

    def test_transform_trace_id_fixture_changes_with_identity_inputs(self) -> None:
        transform_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "12-transform.py",
            "transform_contract",
        )

        canonical_link = "https://www.youtube.com/watch?v=contract-video-1"
        base_trace_id = transform_module.generate_trace_id(canonical_link, "계약식당", "리뷰 A")
        changed_name_trace_id = transform_module.generate_trace_id(canonical_link, "계약식당 2", "리뷰 A")
        changed_review_trace_id = transform_module.generate_trace_id(canonical_link, "계약식당", "리뷰 B")

        self.assertNotEqual(base_trace_id, changed_name_trace_id)
        self.assertNotEqual(base_trace_id, changed_review_trace_id)
        self.assertNotEqual(changed_name_trace_id, changed_review_trace_id)

    def test_cross_stage_identity_fixture_preserves_core_fields_into_supabase_record(self) -> None:
        transform_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "12-transform.py",
            "transform_contract_record",
        )
        supabase_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py",
            "supabase_insert_contract_record",
            fake_supabase=True,
        )

        canonical_link = "https://www.youtube.com/watch?v=contract-video-1"
        short_link = "https://youtu.be/contract-video-1"
        restaurant_name = "계약식당"
        review = "정확한 식당 리뷰가 자막과 장면에 반복적으로 등장합니다."
        trace_id = transform_module.generate_trace_id(canonical_link, restaurant_name, review)

        transform_record = {
            "trace_id": trace_id,
            "youtube_link": short_link,
            "channel_name": "tzuyang",
            "origin_name": restaurant_name,
            "category": "한식",
            "youtuber_review": review,
            "lat": 37.501,
            "lng": 127.039,
            "evaluation_results": {"location_match_TF": []},
            "source_type": "geminiCLI",
        }

        record = supabase_module.build_record(transform_record, "tzuyang")

        self.assertEqual(trace_id, record["trace_id"])
        self.assertEqual("https://www.youtube.com/watch?v=contract-video-1", record["youtube_link"])
        self.assertEqual("tzuyang", record["channel_name"])
        self.assertEqual(restaurant_name, record["origin_name"])
        self.assertEqual(["한식"], record["categories"])
        self.assertEqual(transform_record["evaluation_results"], record["evaluation_results"])

    def test_results_transform_missing_target_fixture_marks_missing_without_eval_results(self) -> None:
        transform_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "12-transform.py",
            "transform_missing_contract",
        )

        transformed = transform_module.transform_json_object(
            {
                "youtube_link": "https://www.youtube.com/watch?v=contract-video-1",
                "restaurants": [],
                "evaluation_target": {"누락식당": True},
                "evaluation_results": {},
                "recollect_version": {},
            },
            "results",
            "tzuyang",
        )

        self.assertEqual(1, len(transformed))
        record = transformed[0]
        self.assertTrue(record["is_missing"])
        self.assertFalse(record["is_notSelected"])
        self.assertIsNone(record["evaluation_results"])
        self.assertEqual("original", record["trace_id_name_source"])
        self.assertEqual("누락식당", record["origin_name"])
        self.assertFalse(record["geocoding_success"])
        self.assertEqual([], validate_transform_output("contract-video-1", transformed))

    def test_notselection_transform_fixture_marks_records_without_geocoding_payload(self) -> None:
        transform_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "12-transform.py",
            "transform_notselection_contract",
        )

        transformed = transform_module.transform_json_object(
            {
                "youtube_link": "https://www.youtube.com/watch?v=contract-video-2",
                "restaurants": [
                    {
                        "origin_name": "보류식당",
                        "category": "한식",
                        "address": "서울특별시 마포구 양화로 10",
                        "lat": 37.55,
                        "lng": 126.92,
                        "youtuber_review": "후보 단계에서만 등장한 리뷰",
                    }
                ],
                "recollect_version": {},
            },
            "notSelection",
            "tzuyang",
        )

        self.assertEqual(1, len(transformed))
        record = transformed[0]
        self.assertFalse(record["is_missing"])
        self.assertTrue(record["is_notSelected"])
        self.assertIsNone(record["evaluation_results"])
        self.assertEqual(0, record["geocoding_false_stage"])
        self.assertIsNone(record["lat"])
        self.assertIsNone(record["lng"])
        self.assertIsNone(record["naver_name"])
        self.assertEqual("geminiCLI", record["source_type"])
        self.assertEqual([], validate_transform_output("contract-video-2", transformed))

    def test_results_transform_prefers_provider_backed_trace_identity_when_location_match_is_true(self) -> None:
        transform_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "12-transform.py",
            "transform_provider_identity_contract",
        )

        payload = {
            "youtube_link": "https://www.youtube.com/watch?v=contract-video-3",
            "restaurants": [
                {
                    "origin_name": "원본식당",
                    "category": "한식",
                    "address": "서울특별시 강남구 역삼로 1",
                    "lat": 37.5,
                    "lng": 127.03,
                    "youtuber_review": "provider backed review",
                }
            ],
            "evaluation_target": {"원본식당": True},
            "evaluation_results": {
                "location_match_TF": [
                    {
                        "origin_name": "원본식당",
                        "matched_provider": "naver",
                        "matched_name": "네이버식당",
                        "naver_name": "네이버식당",
                        "eval_value": True,
                    }
                ]
            },
            "recollect_version": {},
        }

        transformed = transform_module.transform_json_object(payload, "results", "tzuyang")

        self.assertEqual(1, len(transformed))
        record = transformed[0]
        expected_trace_id = transform_module.generate_trace_id(
            payload["youtube_link"],
            "네이버식당",
            "provider backed review",
        )
        self.assertEqual(expected_trace_id, record["trace_id"])
        self.assertEqual("naver", record["trace_id_name_source"])
        self.assertEqual("네이버식당", record["naver_name"])

    def test_map_url_transform_fixture_preserves_geocoded_payload_and_source_type(self) -> None:
        transform_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "12-transform.py",
            "transform_map_url_contract",
        )

        transformed = transform_module.transform_map_url_crawling_object(
            {
                "youtube_link": "https://www.youtube.com/watch?v=contract-video-4",
                "recollect_version": {},
                "restaurants": [
                    {
                        "origin_name": "지도식당",
                        "naver_name": "지도네이버식당",
                        "category": "한식",
                        "lat": 37.49,
                        "lng": 127.02,
                        "roadAddress": "서울특별시 서초구 서초대로 1",
                        "description_map_url": "https://map.naver.com/p/entry/place/123",
                        "youtuber_review": "지도 기반 식당 리뷰",
                    }
                ],
            },
            "jeongyukwang",
        )

        self.assertEqual(1, len(transformed))
        record = transformed[0]
        self.assertEqual("map_url_crawling", record["source_type"])
        self.assertTrue(record["geocoding_success"])
        self.assertFalse(record["is_missing"])
        self.assertFalse(record["is_notSelected"])
        self.assertEqual("naver", record["trace_id_name_source"])
        self.assertEqual("https://map.naver.com/p/entry/place/123", record["description_map_url"])
        self.assertEqual([], validate_transform_output("contract-video-4", transformed))

    def test_supabase_canonicalize_youtube_link_normalizes_short_and_shorts_variants(self) -> None:
        supabase_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py",
            "supabase_insert_canonical_contract",
            fake_supabase=True,
        )

        expected = "https://www.youtube.com/watch?v=contract-video-5"
        self.assertEqual(expected, supabase_module.canonicalize_youtube_link("https://youtu.be/contract-video-5"))
        self.assertEqual(expected, supabase_module.canonicalize_youtube_link("https://www.youtube.com/shorts/contract-video-5"))
        self.assertEqual(expected, supabase_module.canonicalize_youtube_link("https://youtube.com/embed/contract-video-5"))

    def test_supabase_record_fixture_covers_web_admin_consumer_fields(self) -> None:
        supabase_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py",
            "supabase_insert_consumer_contract",
            fake_supabase=True,
        )

        record = supabase_module.build_record(
            {
                "trace_id": "trace-web-1",
                "youtube_link": "https://youtu.be/contract-video-6",
                "channel_name": "tzuyang",
                "origin_name": "웹검증식당",
                "category": "한식",
                "youtuber_review": "구체적인 리뷰",
                "roadAddress": "서울특별시 송파구 올림픽로 1",
                "jibunAddress": "서울특별시 송파구 잠실동 1",
                "englishAddress": "1 Olympic-ro, Songpa-gu, Seoul",
                "addressElements": {"city": "서울"},
                "origin_address": {"address": "서울특별시 송파구 올림픽로 1"},
                "lat": 37.51,
                "lng": 127.1,
                "youtube_meta": {"title": "테스트", "publishedAt": "2024-01-01T00:00:00+09:00"},
                "evaluation_results": {"location_match_TF": []},
                "source_type": "geminiCLI",
                "geocoding_success": True,
                "geocoding_false_stage": None,
                "is_missing": False,
                "is_notSelected": False,
                "description_map_url": "https://map.naver.com/p/entry/place/456",
            },
            "tzuyang",
        )

        expected_fields = [
            "trace_id",
            "youtube_link",
            "channel_name",
            "origin_name",
            "categories",
            "tzuyang_review",
            "road_address",
            "jibun_address",
            "english_address",
            "address_elements",
            "origin_address",
            "lat",
            "lng",
            "youtube_meta",
            "evaluation_results",
            "source_type",
            "geocoding_success",
            "geocoding_false_stage",
            "status",
            "is_missing",
            "is_not_selected",
            "review_count",
            "description_map_url",
            "created_at",
        ]
        for field in expected_fields:
            self.assertIn(field, record)

        self.assertEqual(["한식"], record["categories"])
        self.assertEqual("https://www.youtube.com/watch?v=contract-video-6", record["youtube_link"])
        self.assertEqual("https://map.naver.com/p/entry/place/456", record["description_map_url"])
        self.assertEqual("구체적인 리뷰", record["tzuyang_review"])
        self.assertEqual(False, record["is_not_selected"])

    def test_transform_output_fixture_has_unique_trace_ids_and_passes_current_validator(self) -> None:
        transform_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "12-transform.py",
            "transform_uniqueness_contract",
        )

        payload = {
            "youtube_link": "https://www.youtube.com/watch?v=contract-video-7",
            "restaurants": [
                {
                    "origin_name": "계약식당A",
                    "category": "한식",
                    "address": "서울특별시 강남구 테헤란로 1",
                    "lat": 37.5,
                    "lng": 127.03,
                    "youtuber_review": "계약식당A 리뷰",
                },
                {
                    "origin_name": "계약식당B",
                    "category": "일식",
                    "address": "서울특별시 강남구 테헤란로 2",
                    "lat": 37.501,
                    "lng": 127.031,
                    "youtuber_review": "계약식당B 리뷰",
                },
            ],
            "evaluation_target": {"계약식당A": True, "계약식당B": True},
            "evaluation_results": {
                "location_match_TF": [
                    {
                        "origin_name": "계약식당A",
                        "matched_provider": "naver",
                        "matched_name": "계약식당A",
                        "naver_name": "계약식당A",
                        "matched_address": {
                            "roadAddress": "서울특별시 강남구 테헤란로 1",
                            "x": "127.03",
                            "y": "37.5",
                        },
                        "eval_value": True,
                    },
                    {
                        "origin_name": "계약식당B",
                        "matched_provider": "naver",
                        "matched_name": "계약식당B",
                        "naver_name": "계약식당B",
                        "matched_address": {
                            "roadAddress": "서울특별시 강남구 테헤란로 2",
                            "x": "127.031",
                            "y": "37.501",
                        },
                        "eval_value": True,
                    },
                ]
            },
            "recollect_version": {},
        }

        transformed = transform_module.transform_json_object(payload, "results", "tzuyang")
        trace_ids = [record["trace_id"] for record in transformed]

        self.assertEqual(2, len(transformed))
        self.assertEqual(len(trace_ids), len(set(trace_ids)))
        self.assertEqual([], validate_transform_output("contract-video-7", transformed))

    def test_supabase_payload_keeps_admin_approved_name_boundary_for_web_alias(self) -> None:
        supabase_module = _load_script_module(
            BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py",
            "supabase_insert_admin_alias_contract",
            fake_supabase=True,
        )

        record = supabase_module.build_record(
            {
                "trace_id": "trace-web-2",
                "youtube_link": "https://www.youtube.com/watch?v=contract-video-8",
                "channel_name": "tzuyang",
                "origin_name": "원본식당",
                "approved_name": "파이프라인이덮으면안됨",
                "category": "한식",
                "lat": 37.5,
                "lng": 127.03,
                "evaluation_results": {"location_match_TF": []},
                "source_type": "geminiCLI",
            },
            "tzuyang",
        )

        self.assertIn("approved_name", supabase_module.REVIEW_OWNED_FIELDS)
        self.assertNotIn("approved_name", supabase_module.PIPELINE_REFRESH_FIELDS)
        self.assertNotIn("approved_name", record)
        self.assertEqual("원본식당", record["origin_name"])

    def test_laaj_documentation_mentions_every_required_evaluation_family(self) -> None:
        docs = (BACKEND_ROOT / "DATA_CONTRACTS.md").read_text(encoding="utf-8")

        for key in sorted(LAAJ_EXPECTED_KEYS):
            self.assertIn(key, docs)


if __name__ == "__main__":
    unittest.main()
