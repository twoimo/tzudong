#!/usr/bin/env python3
"""Fail-closed hosted data-plane planner tests."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.supabase.scripts.hosted_data_plane import (
    APPROVAL_ENV,
    HOSTED_URL,
    HostedDataPlaneError,
    apply_pending_candidates,
    assert_apply_authorized,
    assert_hosted_target,
    build_apply_preview,
    classify_blob,
    classify_evaluation_row,
    classify_local_docker_restaurants,
    pending_insert_payload,
    r2_public_object_url,
    load_evaluation_rows,
    _json_request,
)


class HostedDataPlaneTests(unittest.TestCase):
    def test_disjoint_synthetic_local_restaurants_are_forbidden(self) -> None:
        label = classify_local_docker_restaurants(
            [
                "00000000-0000-4000-8000-000000000101",
                "4935b782-b124-4764-badf-c60cdd1bc505",
            ],
            ["dc35ae29-2b6d-4791-bc51-d5ad99500700"],
        )
        self.assertEqual(label, "forbidden_disjoint_local_test_db")

    def test_existing_video_requires_row_reconciliation(self) -> None:
        row = {
            "youtube_link": "https://www.youtube.com/watch?v=abcdefghijk",
            "geocoding_success": True,
            "lat": 37.5,
            "lng": 127.0,
            "is_missing": False,
            "is_notSelected": False,
        }
        self.assertEqual(
            classify_evaluation_row(row, ["abcdefghijk"]),
            "apply_candidate_pending_geocoded",
        )

    def test_geocoded_eval_only_row_is_apply_candidate(self) -> None:
        row = {
            "youtube_link": "https://youtu.be/newvideo111",
            "geocoding_success": True,
            "lat": 35.1,
            "lng": 129.0,
            "is_missing": False,
            "is_notSelected": False,
        }
        self.assertEqual(
            classify_evaluation_row(row, ["abcdefghijk"]),
            "apply_candidate_pending_geocoded",
        )

    def test_failed_geocode_is_not_applied(self) -> None:
        row = {
            "youtube_link": "https://youtu.be/nogeocode11",
            "geocoding_success": False,
            "lat": None,
            "lng": None,
        }
        self.assertEqual(classify_evaluation_row(row, []), "skip_no_geocode")

    def test_unconfirmed_map_row_stays_in_the_review_queue(self) -> None:
        row = {
            "youtube_link": "https://youtu.be/chainstore1",
            "geocoding_success": True,
            "lat": 37.5,
            "lng": 127.0,
            "is_missing": False,
            "is_notSelected": False,
            "evaluation_results": {
                "location_match_TF": {
                    "pending_reason": "ambiguous_chain",
                    "match_status": None,
                }
            },
        }
        self.assertEqual(classify_evaluation_row(row, []), "apply_candidate_pending_review")

    def test_video_confirmed_unconfirmed_reason_can_apply(self) -> None:
        row = {
            "youtube_link": "https://youtu.be/confirmed11",
            "geocoding_success": True,
            "lat": 37.5,
            "lng": 127.0,
            "is_missing": False,
            "is_notSelected": False,
            "evaluation_results": {
                "location_match_TF": {
                    "pending_reason": "insufficient_evidence",
                    "match_status": "confirmed_from_video",
                }
            },
        }
        self.assertEqual(
            classify_evaluation_row(row, []),
            "apply_candidate_pending_geocoded",
        )

    def test_large_crawl_blob_is_r2_not_postgres(self) -> None:
        self.assertEqual(
            classify_blob(
                "backend/restaurant-crawling/data/tzuyang/heatmap/a.jsonl",
                1_900_000_000,
            ),
            "r2_offload",
        )

    def test_preview_forbids_docker_apply_and_lists_eval_candidates(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=["00000000-0000-4000-8000-000000000101"],
            hosted_restaurant_ids=["dc35ae29-2b6d-4791-bc51-d5ad99500700"],
            hosted_youtube_ids=["abcdefghijk"],
            evaluation_rows=[
                {
                    "youtube_link": "https://www.youtube.com/watch?v=newvideo111",
                    "geocoding_success": True,
                    "lat": 1,
                    "lng": 2,
                    "is_missing": False,
                    "is_notSelected": False,
                    "status": "pending",
                }
            ],
        )
        self.assertEqual(
            preview["dockerRestaurantClass"], "forbidden_disjoint_local_test_db"
        )
        self.assertEqual(preview["dockerRestaurantApply"], [])
        self.assertEqual(preview["applyCandidateVideoIds"], ["newvideo111"])
        self.assertEqual(preview["insertStatus"], "pending")

    def test_apply_without_approval_env_fails_closed(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[],
        )
        with self.assertRaises(HostedDataPlaneError) as raised:
            assert_apply_authorized(
                preview,
                environment={},
                presented_preview_sha256=preview["previewSha256"],
            )
        self.assertEqual(str(raised.exception), "approval_missing")

    def test_apply_rejects_preview_hash_mismatch(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[],
        )
        with self.assertRaises(HostedDataPlaneError) as raised:
            assert_apply_authorized(
                preview,
                environment={APPROVAL_ENV: "1", "G037_WRITE_FREEZE": "cleared"},
                presented_preview_sha256="0" * 64,
            )
        self.assertEqual(str(raised.exception), "preview_hash_mismatch")

    def test_apply_authorized_when_preview_matches(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[],
        )
        assert_apply_authorized(
            preview,
            environment={APPROVAL_ENV: "1", "G037_WRITE_FREEZE": "cleared"},
            presented_preview_sha256=preview["previewSha256"],
        )

    def test_freeze_state_does_not_block_pending_review_insert(self):
        preview=build_apply_preview(local_restaurant_ids=[],hosted_restaurant_ids=[],hosted_youtube_ids=[],evaluation_rows=[])
        for value in (None,"","active","inactive","unknown","cleared"):
            environment={APPROVAL_ENV:"1"}
            if value is not None:environment["G037_WRITE_FREEZE"]=value
            assert_apply_authorized(preview,environment=environment,presented_preview_sha256=preview["previewSha256"])

    def test_pending_payload_never_stays_approved(self) -> None:
        payload = pending_insert_payload(
            {
                "youtube_link": "https://youtu.be/newvideo111",
                "status": "approved",
                "origin_name": "x",
                "lat": 1,
                "lng": 2,
                "geocoding_success": True,
            }
        )
        self.assertEqual(payload["status"], "pending")
        self.assertIn("newvideo111", payload["youtube_link"])

    def test_pending_insert_survives_the_review_source_boundary(self) -> None:
        from backend.bin.run_restaurant_review_automation import stored_extraction
        from backend.pipeline_control.targets import admitted_target

        payload = pending_insert_payload({
            "youtube_link": "https://youtu.be/newvideo111",
            "channel_name": "tzuyang",
            "recollect_version": {"meta": 2, "transcript": 3},
            "origin_name": "fixture restaurant",
            "reasoning_basis": "public source evidence",
            "youtuber_review": "public restaurant review",
            "origin_address": {"address": "public business address"},
            "youtube_meta": {"title": "fixture video"},
            "category": ["한식"],
            "status": "approved",
            "updated_by_admin_id": "must-not-copy",
        })
        self.assertIn("evaluate", admitted_target(payload["channel_name"])["capabilities"])
        extraction, metadata = stored_extraction(payload, "newvideo111")
        self.assertEqual(extraction["recollect_version"], {"meta": 2, "transcript": 3})
        self.assertEqual(extraction["restaurants"][0]["reasoning_basis"], "public source evidence")
        self.assertEqual(metadata["recollect_id"], 2)
        self.assertEqual(payload["status"], "pending")
        self.assertNotIn("updated_by_admin_id", payload)





    def test_hosted_url_must_match_project_ref(self) -> None:
        assert_hosted_target(HOSTED_URL)
        with self.assertRaises(HostedDataPlaneError):
            assert_hosted_target("https://example.supabase.co")

    def test_r2_url_uses_issued_r2_dev_not_invented_dns(self) -> None:
        url = r2_public_object_url("abc12345def", "eval/foo.jsonl")
        self.assertEqual(url, "https://pub-abc12345def.r2.dev/eval/foo.jsonl")
        with self.assertRaises(HostedDataPlaneError):
            r2_public_object_url("NOPE", "x")

    def test_changing_candidate_ids_without_rehash_is_rejected(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[
                {
                    "youtube_link": "https://www.youtube.com/watch?v=newvideo111",
                    "trace_id": "trace-new",
                    "geocoding_success": True,
                    "lat": 1,
                    "lng": 2,
                    "origin_name": "신규집",
                }
            ],
        )
        preview["applyCandidateVideoIds"] = ["othervideo1"]
        with self.assertRaises(HostedDataPlaneError) as raised:
            assert_apply_authorized(
                preview,
                environment={APPROVAL_ENV: "1"},
                presented_preview_sha256=preview["previewSha256"],
            )
        self.assertEqual(str(raised.exception), "preview_hash_mismatch")



    def test_invalid_evaluation_json_fails_closed(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rows.jsonl"
            path.write_text("{not json}\n", encoding="utf-8")
            with self.assertRaises(HostedDataPlaneError) as raised:
                load_evaluation_rows(str(path))
        self.assertEqual(str(raised.exception), "evaluation_row_invalid")

    def test_network_failure_is_a_hosted_data_plane_error(self) -> None:
        from urllib.error import URLError

        with patch("urllib.request.urlopen", side_effect=URLError("down")):
            with self.assertRaises(HostedDataPlaneError) as raised:
                _json_request(HOSTED_URL + "/rest/v1/restaurants", key="service-role")
        self.assertEqual(str(raised.exception), "hosted_request_failed")


if __name__ == "__main__":
    unittest.main()
