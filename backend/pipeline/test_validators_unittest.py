"""Regression tests for backend.pipeline.validators using stdlib unittest."""

from __future__ import annotations

import unittest
import typing


if not hasattr(typing, "Annotated"):
    class _AnnotatedCompat:
        """Minimal runtime compatibility shim for Python < 3.9."""

        def __class_getitem__(cls, item):
            if isinstance(item, tuple) and item:
                return item[0]
            return item

    typing.Annotated = _AnnotatedCompat  # type: ignore[attr-defined]

from backend.pipeline.validators import (
    cross_validate,
    error_summary,
    has_blocking_errors,
    validate_gemini_output,
    validate_laaj_results,
    validate_rule_results,
    validate_selection,
    validate_transform_output,
)


class ValidatorsRegressionTests(unittest.TestCase):
    def test_validate_gemini_output_handles_missing_required_and_structure_errors(self) -> None:
        errors = validate_gemini_output(
            "vid-1",
            {
                # youtube_link intentionally missing
                "restaurants": "not-a-list",
            },
        )

        rules = {error["rule"] for error in errors}
        self.assertIn("required_field", rules)
        self.assertIn("type_error", rules)

    def test_validate_gemini_output_detects_critical_restaurant_level_issues(self) -> None:
        errors = validate_gemini_output(
            "vid-2",
            {
                "youtube_link": "https://youtube.com/watch?v=abc",
                "restaurants": [
                    {
                        "origin_name": "테스트식당",
                        "address": "Unknown City, Some Street 123",
                        "lat": "40.5",
                        "lng": "127.1",
                        "category": "외계음식",
                        "reasoning_basis": "근거짧음",
                        "youtuber_review": "리뷰짧음",
                    }
                ],
            },
        )

        rules = {error["rule"] for error in errors}
        self.assertIn("coordinate_range", rules)
        self.assertIn("invalid_category", rules)
        self.assertIn("address_format", rules)
        self.assertIn("short_text", rules)

    def test_validate_selection_detects_missing_and_extra_names(self) -> None:
        errors = validate_selection(
            "vid-3",
            {
                "restaurants": [
                    {"origin_name": "식당A"},
                    {"origin_name": "식당B"},
                ],
                "evaluation_target": {
                    "식당A": {"selected": True},
                    "식당C": {"selected": False},
                },
            },
        )

        mismatches = [e for e in errors if e["rule"] == "name_mismatch"]
        self.assertEqual(2, len(mismatches))
        severities = {e["severity"] for e in mismatches}
        self.assertIn("error", severities)
        self.assertIn("warning", severities)

    def test_validate_rule_results_detects_location_contract_regressions(self) -> None:
        errors = validate_rule_results(
            "vid-4",
            {
                "evaluation_results": {
                    "location_match_TF": [
                        {
                            "origin_name": "식당A",
                            "eval_value": True,
                            "matched_name": "식당A",
                            "google_name": "식당A",
                            "evidence_families": ["provider_candidate"],
                        },
                        {"origin_name": "식당B", "eval_value": False},
                    ],
                    "category_validity_TF": [],
                }
            },
        )

        rules = {error["rule"] for error in errors}
        self.assertIn("insufficient_evidence_families", rules)
        self.assertIn("missing_false_message", rules)
        self.assertIn("missing_pending_reason", rules)
        self.assertIn("empty_category_validity", rules)

    def test_validate_rule_results_checks_second_pass_timeout_and_duplicate_evidence(self) -> None:
        errors = validate_rule_results(
            "vid-4b",
            {
                "evaluation_results": {
                    "location_match_TF": [
                        {
                            "origin_name": "식당A",
                            "eval_value": True,
                            "matched_name": "식당A",
                            "naver_name": "식당A",
                            "evidence_families": ["provider_candidate", "provider_candidate"],
                        },
                        {
                            "origin_name": "식당B",
                            "eval_value": False,
                            "pending_reason": "timeout",
                            "falseMessage": "timeout",
                            "second_pass": {"attempted": True, "provider": "google", "timed_out": False},
                        },
                    ],
                    "category_validity_TF": [{"name": "식당A", "eval_value": True}],
                }
            },
        )

        rules = {error["rule"] for error in errors}
        self.assertIn("duplicated_evidence_family", rules)
        self.assertIn("insufficient_evidence_families", rules)
        self.assertIn("inconsistent_second_pass_state", rules)

    def test_validate_laaj_results_detects_score_and_type_regressions(self) -> None:
        errors = validate_laaj_results(
            "vid-5",
            {
                "restaurants": [{"origin_name": "식당A"}],
                "evaluation_results": {
                    "visit_authenticity": [
                        {"name": "식당A", "eval_value": 3, "eval_basis": "충분한 근거 문장"}
                    ],
                    "rb_inference_score": [
                        {"name": "식당A", "eval_value": "NaN-ish", "eval_basis": "충분한 근거 문장"}
                    ],
                    "rb_grounding_TF": [
                        {"name": "식당A", "eval_value": "true"}
                    ],
                    "review_faithfulness_score": [
                        {"name": "식당A", "eval_value": 0.8, "eval_basis": "짧음"}
                    ],
                    "category_TF": [{"name": "식당A", "eval_value": True}],
                },
            },
        )

        rules = {error["rule"] for error in errors}
        self.assertIn("score_range", rules)
        self.assertIn("score_type", rules)
        self.assertIn("type_error", rules)
        self.assertIn("missing_basis", rules)

    def test_cross_validate_detects_inter_stage_contradictions(self) -> None:
        errors = cross_validate(
            "vid-6",
            {
                "restaurants": [{"origin_name": "식당A"}],
                "evaluation_results": {
                    "location_match_TF": [{"origin_name": "식당A", "eval_value": False}],
                    "category_validity_TF": [{"name": "식당A", "eval_value": False}],
                },
            },
            {
                "restaurants": [{"name": "식당A"}],
                "evaluation_results": {
                    "visit_authenticity": [{"name": "식당A", "eval_value": 2}],
                    "category_TF": [{"name": "식당A", "eval_value": True}],
                },
            },
        )

        rules = {error["rule"] for error in errors}
        self.assertIn("location_visit_contradiction", rules)
        self.assertIn("category_contradiction", rules)

    def test_validate_transform_output_detects_required_fields_and_duplicates(self) -> None:
        errors = validate_transform_output(
            "vid-7",
            [
                {
                    "trace_id": "trace-1",
                    "youtube_link": "https://youtube.com/watch?v=abc",
                    "channel_name": "채널",
                    "name": "식당A",
                    # source_type intentionally missing
                    "lat": 37.5,
                    "lng": 127.0,
                    "evaluation_results": {},
                },
                {
                    "trace_id": "trace-1",
                    "youtube_link": "https://youtube.com/watch?v=def",
                    "channel_name": "채널",
                    "name": "식당B",
                    "source_type": "manual",
                    "lat": 10,
                    "lng": 200,
                    "evaluation_results": {"dummy": True},
                },
            ],
        )

        rules = {error["rule"] for error in errors}
        self.assertIn("required_field", rules)
        self.assertIn("duplicate_trace_id", rules)
        self.assertIn("coordinate_range", rules)
        self.assertIn("missing_eval_results", rules)

    def test_has_blocking_errors_and_error_summary(self) -> None:
        errors = [
            {"severity": "warning", "rule": "warn_rule"},
            {"severity": "error", "rule": "error_rule"},
            {"severity": "info", "rule": "info_rule"},
        ]

        self.assertTrue(has_blocking_errors(errors))
        summary = error_summary(errors)
        self.assertIn("ERROR: 1건", summary)
        self.assertIn("WARNING: 1건", summary)
        self.assertIn("INFO: 1건", summary)


if __name__ == "__main__":
    unittest.main()
