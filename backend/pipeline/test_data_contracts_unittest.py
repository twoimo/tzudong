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
                "name": restaurant_name,
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
        spec = importlib.util.spec_from_file_location("supabase_insert_contract", script_path)
        self.assertIsNotNone(spec)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        fake_supabase = types.ModuleType("supabase")
        fake_supabase.Client = object
        fake_supabase.create_client = lambda *args, **kwargs: None
        previous_supabase = sys.modules.get("supabase")
        sys.modules["supabase"] = fake_supabase
        try:
            spec.loader.exec_module(module)
        finally:
            if previous_supabase is None:
                sys.modules.pop("supabase", None)
            else:
                sys.modules["supabase"] = previous_supabase

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

    def test_laaj_documentation_mentions_every_required_evaluation_family(self) -> None:
        docs = (BACKEND_ROOT / "DATA_CONTRACTS.md").read_text(encoding="utf-8")

        for key in sorted(LAAJ_EXPECTED_KEYS):
            self.assertIn(key, docs)


if __name__ == "__main__":
    unittest.main()
