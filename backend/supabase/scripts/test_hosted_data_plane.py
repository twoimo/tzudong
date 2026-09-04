#!/usr/bin/env python3
"""Fail-closed hosted data-plane planner tests."""

from __future__ import annotations

import unittest

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

    def test_evaluation_already_on_hosted_is_skipped(self) -> None:
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
            "skip_already_on_hosted",
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

    def test_unconfirmed_map_row_is_not_applied(self) -> None:
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
        self.assertEqual(classify_evaluation_row(row, []), "skip_unconfirmed_map")

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

    def test_active_missing_or_unknown_freeze_blocks_before_any_request(self) -> None:
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=[],
                                      hosted_youtube_ids=[], evaluation_rows=[])
        for value in (None, "", "active", "inactive", "unknown"):
            calls = []
            env = {APPROVAL_ENV: "1"}
            if value is not None:
                env["G037_WRITE_FREEZE"] = value
            with self.subTest(value=value), self.assertRaises(HostedDataPlaneError) as raised:
                apply_pending_candidates(
                    preview=preview, evaluation_rows=[], url=HOSTED_URL,
                    service_role_key="", environment=env,
                    presented_preview_sha256=preview["previewSha256"],
                    fetch=lambda *args, **kwargs: calls.append(True),
                )
            self.assertEqual(str(raised.exception), "hosted_write_freeze_not_cleared")
            self.assertEqual(calls, [])

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

    def test_apply_pending_candidates_posts_only_preview_ids(self) -> None:
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
                    "is_missing": False,
                    "is_notSelected": False,
                    "status": "approved",
                    "origin_name": "신규집",
                }
            ],
        )
        calls: list[tuple[str, object]] = []

        def fake_fetch(url, *, key, method="GET", payload=None, extra_headers=None):
            calls.append((method, payload))
            return 201, None

        result = apply_pending_candidates(
            preview=preview,
            evaluation_rows=[
                {
                    "youtube_link": "https://www.youtube.com/watch?v=newvideo111",
                    "trace_id": "trace-new",
                    "geocoding_success": True,
                    "lat": 1,
                    "lng": 2,
                    "origin_name": "신규집",
                    "status": "approved",
                },
                {
                    "youtube_link": "https://www.youtube.com/watch?v=oldvideo222",
                    "trace_id": "trace-old",
                    "geocoding_success": True,
                    "lat": 3,
                    "lng": 4,
                    "origin_name": "기존집",
                },
            ],
            url=HOSTED_URL,
            service_role_key="service-role",
            environment={APPROVAL_ENV: "1", "G037_WRITE_FREEZE": "cleared"},
            presented_preview_sha256=preview["previewSha256"],
            fetch=fake_fetch,
        )
        self.assertEqual(result["insertedVideoIds"], ["newvideo111"])
        self.assertEqual(result["insertedCount"], 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "POST")
        self.assertEqual(calls[0][1]["status"], "pending")
        self.assertEqual(calls[0][1]["trace_id"], "trace-new")

    def test_reflection_partitions_processed_set_by_identity(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[
                {
                    "youtube_link": "https://www.youtube.com/watch?v=applyvideo1",
                    "trace_id": "trace-apply",
                    "geocoding_success": True,
                    "lat": 1,
                    "lng": 2,
                    "is_missing": False,
                    "is_notSelected": False,
                },
                {
                    "youtube_link": "https://www.youtube.com/watch?v=presentvid2",
                    "trace_id": "trace-present",
                    "geocoding_success": True,
                    "lat": 3,
                    "lng": 4,
                    "is_missing": False,
                    "is_notSelected": False,
                },
                {
                    "youtube_link": "https://www.youtube.com/watch?v=unresolvid3",
                    "trace_id": "trace-unresolved",
                    "geocoding_success": True,
                    "lat": 5,
                    "lng": 6,
                    "is_missing": False,
                    "is_notSelected": False,
                },
            ],
        )
        status_by_trace = {
            "trace-apply": 201,
            "trace-present": 409,
            "trace-unresolved": 500,
        }

        def fake_fetch(url, *, key, method="GET", payload=None, extra_headers=None):
            return status_by_trace[payload["trace_id"]], None

        rows = [
            {
                "youtube_link": "https://www.youtube.com/watch?v=applyvideo1",
                "trace_id": "trace-apply",
                "geocoding_success": True,
                "lat": 1,
                "lng": 2,
            },
            {
                "youtube_link": "https://www.youtube.com/watch?v=presentvid2",
                "trace_id": "trace-present",
                "geocoding_success": True,
                "lat": 3,
                "lng": 4,
            },
            {
                "youtube_link": "https://www.youtube.com/watch?v=unresolvid3",
                "trace_id": "trace-unresolved",
                "geocoding_success": True,
                "lat": 5,
                "lng": 6,
            },
        ]
        result = apply_pending_candidates(
            preview=preview,
            evaluation_rows=rows,
            url=HOSTED_URL,
            service_role_key="service-role",
            environment={APPROVAL_ENV: "1", "G037_WRITE_FREEZE": "cleared"},
            presented_preview_sha256=preview["previewSha256"],
            fetch=fake_fetch,
        )
        reflection = result["reflection"]
        self.assertEqual(reflection["applied"], ["applyvideo1"])
        self.assertEqual(reflection["skippedAlreadyPresent"], ["presentvid2"])
        self.assertEqual(reflection["unresolved"], ["unresolvid3"])
        # Three lists are pairwise disjoint and their union is the processed set.
        applied = set(reflection["applied"])
        present = set(reflection["skippedAlreadyPresent"])
        unresolved = set(reflection["unresolved"])
        self.assertEqual(applied & present, set())
        self.assertEqual(applied & unresolved, set())
        self.assertEqual(present & unresolved, set())
        self.assertEqual(
            applied | present | unresolved,
            set(preview["applyCandidateVideoIds"]),
        )
        # Backward-compatible keys are preserved.
        self.assertEqual(result["insertedVideoIds"], ["applyvideo1"])
        self.assertEqual(result["skippedExistingVideoIds"], ["presentvid2"])
        self.assertEqual(result["insertedCount"], 1)
        self.assertEqual(result["previewSha256"], preview["previewSha256"])

    def test_unresolved_candidate_does_not_abort_or_create_record(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[
                {
                    "youtube_link": "https://www.youtube.com/watch?v=applyvideo1",
                    "trace_id": "trace-apply",
                    "geocoding_success": True,
                    "lat": 1,
                    "lng": 2,
                    "is_missing": False,
                    "is_notSelected": False,
                },
                {
                    "youtube_link": "https://www.youtube.com/watch?v=unresolvid3",
                    "trace_id": "trace-unresolved",
                    "geocoding_success": True,
                    "lat": 5,
                    "lng": 6,
                    "is_missing": False,
                    "is_notSelected": False,
                },
            ],
        )
        status_by_trace = {"trace-apply": 201, "trace-unresolved": 503}

        def fake_fetch(url, *, key, method="GET", payload=None, extra_headers=None):
            return status_by_trace[payload["trace_id"]], None

        rows = [
            {
                "youtube_link": "https://www.youtube.com/watch?v=applyvideo1",
                "trace_id": "trace-apply",
                "geocoding_success": True,
                "lat": 1,
                "lng": 2,
            },
            {
                "youtube_link": "https://www.youtube.com/watch?v=unresolvid3",
                "trace_id": "trace-unresolved",
                "geocoding_success": True,
                "lat": 5,
                "lng": 6,
            },
        ]
        # A non-2xx/non-409 insert error must not abort the whole run and must
        # not roll back the applied record (R4.6, R4.7).
        result = apply_pending_candidates(
            preview=preview,
            evaluation_rows=rows,
            url=HOSTED_URL,
            service_role_key="service-role",
            environment={APPROVAL_ENV: "1", "G037_WRITE_FREEZE": "cleared"},
            presented_preview_sha256=preview["previewSha256"],
            fetch=fake_fetch,
        )
        self.assertEqual(result["reflection"]["applied"], ["applyvideo1"])
        self.assertEqual(result["reflection"]["unresolved"], ["unresolvid3"])
        self.assertEqual(result["insertedVideoIds"], ["applyvideo1"])

    def test_apply_pending_candidates_refuses_without_approval(self) -> None:
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[],
        )
        with self.assertRaises(HostedDataPlaneError) as raised:
            apply_pending_candidates(
                preview=preview,
                evaluation_rows=[],
                url=HOSTED_URL,
                service_role_key="service-role",
                environment={},
                presented_preview_sha256=preview["previewSha256"],
                fetch=lambda *args, **kwargs: (201, None),
            )
        self.assertEqual(str(raised.exception), "approval_missing")

    def test_hosted_url_must_match_project_ref(self) -> None:
        assert_hosted_target(HOSTED_URL)
        with self.assertRaises(HostedDataPlaneError):
            assert_hosted_target("https://example.supabase.co")

    def test_r2_url_uses_issued_r2_dev_not_invented_dns(self) -> None:
        url = r2_public_object_url("abc12345def", "eval/foo.jsonl")
        self.assertEqual(url, "https://pub-abc12345def.r2.dev/eval/foo.jsonl")
        with self.assertRaises(HostedDataPlaneError):
            r2_public_object_url("NOPE", "x")


if __name__ == "__main__":
    unittest.main()
