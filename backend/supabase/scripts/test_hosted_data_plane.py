#!/usr/bin/env python3
"""Fail-closed hosted data-plane planner tests."""

from __future__ import annotations

import unittest
import hashlib
import io
from contextlib import redirect_stdout
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
    fetch_hosted_restaurant_snapshot,
)


class HostedDataPlaneTests(unittest.TestCase):
    def test_apply_cli_reports_partial_rows_as_failure(self) -> None:
        from backend.bin.apply_hosted_pending_candidates import main

        trace = hashlib.sha256(b"unresolved").hexdigest()
        row = {"youtube_link": "https://youtu.be/abcdefghijk", "trace_id": trace,
               "geocoding_success": True, "lat": 1, "lng": 2}
        env = {"SUPABASE_URL": HOSTED_URL, "SUPABASE_SERVICE_ROLE_KEY": "key", APPROVAL_ENV: "1"}
        result = {"insertedCount": 0, "insertedVideoIds": [], "skippedExistingVideoIds": [],
                  "rowReceipts": [{"videoId": "abcdefghijk", "traceId": trace,
                                   "outcome": "unresolved", "postStatus": "500", "readbackStatus": "200"}],
                  "reflection": {"applied": [], "skippedAlreadyPresent": [], "unresolved": ["abcdefghijk"]}}
        with (
            patch.dict("os.environ", env),
            patch("backend.bin.apply_hosted_pending_candidates.fetch_hosted_restaurant_snapshot",
                  return_value=([], [], [], [])),
            patch("backend.bin.apply_hosted_pending_candidates.load_evaluation_rows",
                  return_value=[row]),
            patch("backend.bin.apply_hosted_pending_candidates.apply_pending_candidates",
                  return_value=result),
            redirect_stdout(io.StringIO()) as output,
        ):
            self.assertEqual(main([]), 2)
        self.assertIn("error=candidates_unresolved", output.getvalue())
        self.assertIn("rowReceipts=", output.getvalue())

    def test_trace_snapshot_keeps_default_tuple_and_rejects_bad_identity(self) -> None:
        trace = hashlib.sha256(b"one").hexdigest()
        hosted = [{"id": "id-one", "youtube_link": "https://youtu.be/abcdefghijk", "trace_id": trace}]
        with patch("backend.supabase.scripts.hosted_data_plane._json_request", return_value=(200, hosted)) as request:
            self.assertEqual(len(fetch_hosted_restaurant_snapshot(url=HOSTED_URL, service_role_key="key")), 2)
            self.assertEqual(fetch_hosted_restaurant_snapshot(url=HOSTED_URL, service_role_key="key", include_trace_ids=True)[2], [trace])
            self.assertIn("trace_id", request.call_args.args[0])
        for bad_trace in (None, "legacy-trace", []):
            legacy = [{"id": "id-one", "youtube_link": "https://youtu.be/abcdefghijk",
                       "trace_id": bad_trace}]
            with patch("backend.supabase.scripts.hosted_data_plane._json_request", return_value=(200, legacy)):
                self.assertEqual(fetch_hosted_restaurant_snapshot(
                    url=HOSTED_URL, service_role_key="key", include_trace_ids=True)[3], ["abcdefghijk"])
        with patch("backend.supabase.scripts.hosted_data_plane._json_request", return_value=(200, [{"id": "id-one", "trace_id": None}])):
            with self.assertRaisesRegex(HostedDataPlaneError, "hosted_identity_unscoped"):
                fetch_hosted_restaurant_snapshot(url=HOSTED_URL, service_role_key="key", include_trace_ids=True)

    def test_same_video_missing_restaurant_repaired_without_touching_approved(self) -> None:
        first = hashlib.sha256(b"first restaurant").hexdigest()
        second = hashlib.sha256(b"second restaurant").hexdigest()
        def row(trace_id: str, name: str) -> dict:
            return {"youtube_link": "https://youtu.be/abcdefghijk", "trace_id": trace_id,
                    "origin_name": name, "geocoding_success": True, "lat": 37.5, "lng": 127.0}
        rows = [row(first, "관리자 승인집"), row(second, "누락집")]
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=["approved-id"],
            hosted_youtube_ids=["abcdefghijk"], hosted_trace_ids=[first], evaluation_rows=rows)
        self.assertEqual(preview["applyCandidateTraceIds"], [second])
        self.assertEqual(preview["applyCandidateCount"], 1)
        calls = []
        def fetch(url, *, key, method="GET", payload=None, extra_headers=None):
            calls.append((method, payload))
            if method == "POST":
                return 201, [{"id": "new-id", "trace_id": second, "status": "pending"}]
            return 200, [{"id": "new-id", "trace_id": second, "status": "pending"}]
        result = apply_pending_candidates(preview=preview, evaluation_rows=rows, url=HOSTED_URL,
            service_role_key="key", environment={APPROVAL_ENV: "1"},
            presented_preview_sha256=preview["previewSha256"], fetch=fetch)
        self.assertEqual(result["insertedCount"], 1)
        self.assertEqual(result["rowReceipts"], [{"videoId": "abcdefghijk", "traceId": second,
            "outcome": "applied", "postStatus": "201", "readbackStatus": "200",
            "hostedStatus": "pending"}])
        self.assertEqual([item[0] for item in calls], ["POST", "GET"])
        self.assertEqual(calls[0][1]["status"], "pending")
        rerun = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=["approved-id", "new-id"],
            hosted_youtube_ids=["abcdefghijk", "abcdefghijk"], hosted_trace_ids=[first, second], evaluation_rows=rows)
        self.assertEqual(rerun["applyCandidateCount"], 0)

    def test_legacy_trace_blocks_its_video_but_unrelated_video_can_apply(self) -> None:
        legacy_video = "abcdefghijk"
        new_video = "newvideo111"
        new_trace = hashlib.sha256(b"new video restaurant").hexdigest()
        legacy_candidate_trace = hashlib.sha256(b"same legacy video").hexdigest()
        hosted = [{"id": "legacy-id", "youtube_link": f"https://youtu.be/{legacy_video}",
                   "trace_id": None, "status": "approved"}]
        with patch("backend.supabase.scripts.hosted_data_plane._json_request", return_value=(200, hosted)):
            ids, videos, traces, ambiguous = fetch_hosted_restaurant_snapshot(
                url=HOSTED_URL, service_role_key="key", include_trace_ids=True)
        rows = [{"youtube_link": f"https://youtu.be/{video}", "trace_id": trace,
                 "geocoding_success": True, "lat": 1, "lng": 2}
                for video, trace in ((legacy_video, legacy_candidate_trace), (new_video, new_trace))]
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=ids,
            hosted_youtube_ids=videos, hosted_trace_ids=traces,
            hosted_ambiguous_youtube_ids=ambiguous, evaluation_rows=rows)
        self.assertEqual(preview["evaluationClasses"]["skip_hosted_identity_ambiguous"], 1)
        self.assertEqual(preview["hostedAmbiguousVideoIds"], [legacy_video])
        self.assertEqual(preview["applyCandidateTraceIds"], [new_trace])
        calls = []
        def fetch(url, *, key, method="GET", payload=None, extra_headers=None):
            calls.append((method, payload))
            if method == "POST":
                return 201, [{"id": "new-id", "trace_id": new_trace, "status": "pending"}]
            return 200, [{"id": "new-id", "trace_id": new_trace, "status": "pending"}]
        result = apply_pending_candidates(preview=preview, evaluation_rows=rows,
            url=HOSTED_URL, service_role_key="key", environment={APPROVAL_ENV: "1"},
            presented_preview_sha256=preview["previewSha256"], fetch=fetch)
        self.assertEqual(result["insertedCount"], 1)
        self.assertEqual([item[1]["trace_id"] for item in calls if item[0] == "POST"], [new_trace])

    def test_readback_requires_matching_id_and_status(self) -> None:
        trace = hashlib.sha256(b"readback identity").hexdigest()
        row = {"youtube_link": "https://youtu.be/abcdefghijk", "trace_id": trace,
               "geocoding_success": True, "lat": 1, "lng": 2}
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=[],
            hosted_youtube_ids=[], hosted_trace_ids=[], evaluation_rows=[row])
        for read_row in ({"id": "other-id", "trace_id": trace, "status": "pending"},
                         {"id": "new-id", "trace_id": trace, "status": None},
                         {"id": "new-id", "trace_id": trace, "status": "deleted"}):
            def fetch(url, *, key, method="GET", payload=None, extra_headers=None):
                if method == "POST":
                    return 201, [{"id": "new-id", "trace_id": trace, "status": "pending"}]
                return 200, [read_row]
            result = apply_pending_candidates(preview=preview, evaluation_rows=[row],
                url=HOSTED_URL, service_role_key="key", environment={APPROVAL_ENV: "1"},
                presented_preview_sha256=preview["previewSha256"], fetch=fetch)
            self.assertEqual(result["insertedCount"], 0)
            self.assertEqual(result["rowReceipts"][0]["outcome"], "unresolved")

    def test_partial_failure_remains_visible_and_rerun_selects_only_missing_row(self) -> None:
        first = hashlib.sha256(b"first").hexdigest()
        second = hashlib.sha256(b"second").hexdigest()
        rows = [{"youtube_link": "https://youtu.be/abcdefghijk", "trace_id": trace,
                 "origin_name": name, "geocoding_success": True, "lat": 1, "lng": 2}
                for trace, name in ((first, "첫집"), (second, "둘째집"))]
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=[],
            hosted_youtube_ids=[], hosted_trace_ids=[], evaluation_rows=rows)
        def fetch(url, *, key, method="GET", payload=None, extra_headers=None):
            trace = payload["trace_id"] if method == "POST" else url.split("eq.")[-1]
            if trace == second and method == "POST":
                raise HostedDataPlaneError("hosted_request_failed")
            if trace == second:
                return 200, []
            return (201, [{"id": "first-id", "trace_id": first, "status": "pending"}]) if method == "POST" else (200, [{"id": "first-id", "trace_id": first, "status": "pending"}])
        result = apply_pending_candidates(preview=preview, evaluation_rows=rows, url=HOSTED_URL,
            service_role_key="key", environment={APPROVAL_ENV: "1"},
            presented_preview_sha256=preview["previewSha256"], fetch=fetch)
        self.assertEqual(result["insertedCount"], 1)
        self.assertEqual([r["outcome"] for r in result["rowReceipts"]], ["applied", "unresolved"])
        self.assertEqual(result["reflection"]["unresolved"], ["abcdefghijk"])
        rerun = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=["first-id"],
            hosted_youtube_ids=["abcdefghijk"], hosted_trace_ids=[first], evaluation_rows=rows)
        self.assertEqual(rerun["applyCandidateTraceIds"], [second])

    def test_ignored_duplicate_and_missing_readback_are_not_insertions(self) -> None:
        trace = hashlib.sha256(b"duplicate").hexdigest()
        row = {"youtube_link": "https://youtu.be/abcdefghijk", "trace_id": trace,
               "geocoding_success": True, "lat": 1, "lng": 2}
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=[],
            hosted_youtube_ids=[], hosted_trace_ids=[], evaluation_rows=[row])
        for read_rows, expected in (([{"id": "existing-id", "trace_id": trace, "status": "approved"}], "skippedAlreadyPresent"),
                                    ([], "unresolved")):
            def fetch(url, *, key, method="GET", payload=None, extra_headers=None):
                return (200, []) if method == "POST" else (200, read_rows)
            result = apply_pending_candidates(preview=preview, evaluation_rows=[row], url=HOSTED_URL,
                service_role_key="key", environment={APPROVAL_ENV: "1"},
                presented_preview_sha256=preview["previewSha256"], fetch=fetch)
            self.assertEqual(result["insertedCount"], 0)
            self.assertEqual(result["rowReceipts"][0]["outcome"], expected)

    def test_bad_trace_id_skips_and_changed_selected_payload_fails_before_write(self) -> None:
        row = {"youtube_link": "https://youtu.be/abcdefghijk", "trace_id": None,
               "geocoding_success": True, "lat": 1, "lng": 2}
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=[],
            hosted_youtube_ids=[], hosted_trace_ids=[], evaluation_rows=[row])
        self.assertEqual(preview["evaluationClasses"], {"skip_invalid_identity": 1})
        self.assertEqual(preview["applyCandidateCount"], 0)
        row["trace_id"] = hashlib.sha256(b"valid").hexdigest()
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=[],
            hosted_youtube_ids=[], hosted_trace_ids=[], evaluation_rows=[row])
        changed = dict(row, lat=3)
        with self.assertRaisesRegex(HostedDataPlaneError, "apply_payload_mismatch"):
            apply_pending_candidates(preview=preview, evaluation_rows=[changed], url=HOSTED_URL,
                service_role_key="key", environment={APPROVAL_ENV: "1"},
                presented_preview_sha256=preview["previewSha256"],
                fetch=lambda *args, **kwargs: self.fail("write before binding check"))

    def test_soft_deleted_hosted_trace_is_not_recreated(self) -> None:
        trace = hashlib.sha256(b"admin deleted").hexdigest()
        hosted = [{"id": "deleted-id", "trace_id": trace, "status": "deleted",
                   "youtube_link": "https://youtu.be/abcdefghijk"}]
        with patch("backend.supabase.scripts.hosted_data_plane._json_request", return_value=(200, hosted)):
            ids, videos, traces, ambiguous = fetch_hosted_restaurant_snapshot(
                url=HOSTED_URL, service_role_key="key", include_trace_ids=True)
        preview = build_apply_preview(local_restaurant_ids=[], hosted_restaurant_ids=ids,
            hosted_youtube_ids=videos, hosted_trace_ids=traces,
            hosted_ambiguous_youtube_ids=ambiguous,
            evaluation_rows=[{"youtube_link": "https://youtu.be/abcdefghijk", "trace_id": trace,
                              "geocoding_success": True, "lat": 1, "lng": 2}])
        self.assertEqual(preview["evaluationClasses"], {"skip_already_on_hosted": 1})
        self.assertEqual(preview["applyCandidateCount"], 0)

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

    def test_freeze_state_does_not_block_pending_review_insert(self) -> None:
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
                    "origin_name": "신규집",
                }
            ],
        )
        row = {
            "youtube_link": "https://www.youtube.com/watch?v=newvideo111",
            "trace_id": "trace-new",
            "geocoding_success": True,
            "lat": 1,
            "lng": 2,
            "origin_name": "신규집",
        }
        for value in (None, "", "active", "inactive", "unknown", "cleared"):
            calls = []
            env = {APPROVAL_ENV: "1"}
            if value is not None:
                env["G037_WRITE_FREEZE"] = value
            with self.subTest(value=value):
                result = apply_pending_candidates(
                    preview=preview,
                    evaluation_rows=[row],
                    url=HOSTED_URL,
                    service_role_key="service-role",
                    environment=env,
                    presented_preview_sha256=preview["previewSha256"],
                    fetch=lambda *args, **kwargs: calls.append(True) or (201, None),
                )
            self.assertEqual(result["insertedCount"], 1)
            self.assertEqual(calls, [True])
            self.assertEqual(result["insertedVideoIds"], ["newvideo111"])

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

    def test_skip_row_sharing_a_candidate_video_is_not_posted(self) -> None:
        candidate = {
            "youtube_link": "https://www.youtube.com/watch?v=newvideo111",
            "trace_id": "trace-new",
            "geocoding_success": True,
            "lat": 1,
            "lng": 2,
            "origin_name": "신규집",
            "evaluation_results": {"visit_authenticity": {"name": "신규집", "eval_value": 1}},
        }
        skipped = {
            "youtube_link": "https://www.youtube.com/watch?v=newvideo111",
            "trace_id": "trace-skip",
            "is_missing": True,
            "origin_name": "빠진집",
        }
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[candidate, skipped],
        )
        calls: list[dict] = []

        def fake_fetch(url, *, key, method="GET", payload=None, extra_headers=None):
            calls.append(payload)
            return 201, None

        apply_pending_candidates(
            preview=preview,
            evaluation_rows=[candidate, skipped],
            url=HOSTED_URL,
            service_role_key="service-role",
            environment={APPROVAL_ENV: "1"},
            presented_preview_sha256=preview["previewSha256"],
            fetch=fake_fetch,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["origin_name"], "신규집")
        self.assertEqual(calls[0]["status"], "pending")
        self.assertEqual(calls[0]["evaluation_results"]["visit_authenticity"]["eval_value"], 1)

    def test_changed_row_content_is_rejected_before_post(self) -> None:
        row = {
            "youtube_link": "https://www.youtube.com/watch?v=newvideo111",
            "trace_id": "trace-new",
            "geocoding_success": True,
            "lat": 1,
            "lng": 2,
            "origin_name": "신규집",
        }
        preview = build_apply_preview(
            local_restaurant_ids=[],
            hosted_restaurant_ids=[],
            hosted_youtube_ids=[],
            evaluation_rows=[row],
        )
        changed = dict(row)
        changed["origin_name"] = "다른집"
        with self.assertRaises(HostedDataPlaneError) as raised:
            apply_pending_candidates(
                preview=preview,
                evaluation_rows=[changed],
                url=HOSTED_URL,
                service_role_key="service-role",
                environment={APPROVAL_ENV: "1"},
                presented_preview_sha256=preview["previewSha256"],
                fetch=lambda *args, **kwargs: (201, None),
            )
        self.assertEqual(str(raised.exception), "apply_payload_mismatch")

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
