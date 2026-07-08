"""Regression tests for backend-only trend dry-run and scorer contracts."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from backend.trend.dry_run import run_trend_dry_run
from backend.trend.scoring import score_latest_only_youtube_kpi, score_trend_candidate
from backend.trend.web_provider import (
    collect_google_cse_fixture_observations,
    load_google_cse_fixture,
    resolve_google_cse_provider_status,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_FIXTURE = REPO_ROOT / "fixtures" / "trend-web-search" / "google-cse-allowlist.fixture.json"
SCORING_FIXTURE = REPO_ROOT / "fixtures" / "trend-scoring" / "scoring-v1.fixture.json"


class TrendDryRunTests(unittest.TestCase):
    def _scoring_fixture(self) -> dict:
        return json.loads(SCORING_FIXTURE.read_text(encoding="utf-8"))

    def test_weighted_fixture_scores_66_5_and_passes_threshold(self) -> None:
        candidate = self._scoring_fixture()["candidates"][0]
        breakdown = score_trend_candidate(candidate)

        self.assertEqual(breakdown["version"], "trend_overlay_scoring_v1")
        self.assertEqual(breakdown["score"], 66.5)
        self.assertTrue(breakdown["isProposal"])
        self.assertEqual(breakdown["blockedReasons"], [])

    def test_coordinates_missing_blocks_even_when_score_passes(self) -> None:
        candidate = self._scoring_fixture()["candidates"][1]
        breakdown = score_trend_candidate(candidate)

        self.assertEqual(breakdown["score"], 66.5)
        self.assertFalse(breakdown["isProposal"])
        self.assertIn("restaurant_coordinates_missing", breakdown["blockedReasons"])

    def test_no_key_provider_warning_keeps_non_web_score_eligible(self) -> None:
        candidate = self._scoring_fixture()["candidates"][2]
        breakdown = score_trend_candidate(candidate, provider_warning="web_search_provider_missing")

        self.assertEqual(breakdown["score"], 74.5)
        self.assertTrue(breakdown["isProposal"])
        self.assertIn("web_search_provider_missing", breakdown["warnings"])
        self.assertEqual(breakdown["components"]["webContext"]["score"], 0.0)

    def test_latest_only_youtube_kpi_is_deterministic_and_capped(self) -> None:
        payload = self._scoring_fixture()["latestOnlyKpi"]
        result = score_latest_only_youtube_kpi(
            latest_views=payload["latestViews"],
            benchmark_views=payload["benchmarkViews"],
            latest_likes=payload["latestLikes"],
            latest_comments=payload["latestComments"],
            benchmark_engagement=payload["benchmarkEngagement"],
            published_at=payload["publishedAt"],
            now=datetime(2026, 7, 7, tzinfo=timezone.utc),
        )

        self.assertEqual(result["debug"]["latestOnlyViewScore"], 55.0)
        self.assertLessEqual(result["score"], 55.0)
        self.assertIn("youtube_comparison_missing", result["warnings"])
        self.assertIn("youtube_latest_only_capped_55", result["warnings"])

    def test_google_cse_fixture_allowlist_discards_disallowed_without_raw_fetch(self) -> None:
        fixture = load_google_cse_fixture(WEB_FIXTURE)
        collected = collect_google_cse_fixture_observations(fixture)

        self.assertGreaterEqual(collected["summary"]["allowedResultCount"], 1)
        self.assertGreaterEqual(collected["summary"]["discardedDisallowedDomainCount"], 1)
        for observation in collected["observations"]:
            self.assertEqual(observation["source_type"], "web_search")
            self.assertLessEqual(len(observation["raw_excerpt"]), 500)
            self.assertTrue(observation["provenance"]["allowlisted"])
        for observation in collected["discarded"]:
            self.assertEqual(observation["discardReason"], "discarded_disallowed_domain")
            self.assertFalse(observation["provenance"]["allowlisted"])

    def test_provider_disabled_and_missing_key_are_non_fatal(self) -> None:
        disabled = resolve_google_cse_provider_status({})
        missing = resolve_google_cse_provider_status({
            "TREND_WEB_SEARCH_ENABLED": "1",
            "TREND_WEB_SEARCH_PROVIDER": "google_cse",
        })

        self.assertEqual(disabled["status"], "web_search_disabled")
        self.assertFalse(disabled["fatal"])
        self.assertEqual(missing["status"], "web_search_provider_missing")
        self.assertFalse(missing["fatal"])

    def test_dry_run_outputs_proposals_only_and_no_approved_overlay_writes(self) -> None:
        candidates = self._scoring_fixture()["candidates"]
        result = run_trend_dry_run(
            candidates=candidates,
            fixture_path=WEB_FIXTURE,
            env={"TREND_WEB_SEARCH_ENABLED": "0"},
        )

        self.assertEqual(result["mode"], "dry_run")
        self.assertEqual(result["approvedOverlayWrites"], [])
        self.assertEqual(result["providerStatus"]["status"], "web_search_disabled")
        self.assertGreaterEqual(result["summary"]["proposalCount"], 2)
        self.assertTrue(all(proposal["proposalStatus"] == "pending" for proposal in result["proposals"]))
        self.assertTrue(any(item["candidateId"] == "coordinates-missing-blocked" for item in result["skippedCandidates"]))

    def test_provider_module_has_no_raw_page_fetch_dependencies(self) -> None:
        provider_source = (REPO_ROOT / "trend" / "web_provider.py").read_text(encoding="utf-8")
        forbidden_fragments = [
            "requests.",
            "urllib.request",
            "httpx",
            "aiohttp",
            "BeautifulSoup",
            "selenium",
            "playwright",
        ]
        for fragment in forbidden_fragments:
            self.assertNotIn(fragment, provider_source)


if __name__ == "__main__":
    unittest.main()
