from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
import unittest

from backend.trend.momentum import Observation, rank_momentum
from backend.trend.dry_run import run_trend_dry_run


def point(video, hour, views, channel="channel", format="long", keywords=()):
    return Observation(video, channel, format, datetime(2026, 9, 8, tzinfo=timezone.utc) + timedelta(hours=hour), views, keywords)


class MomentumTests(unittest.TestCase):
    def test_irregular_intervals_use_rate_midpoints(self):
        result = rank_momentum([point("a", 0, 0), point("a", 1, 100), point("a", 3, 500)])
        row = result["rankings"][0]
        self.assertEqual(row["velocity"], 200)
        self.assertAlmostEqual(row["acceleration"], 100 / 1.5)
        self.assertEqual(row["stage"], "insufficient_evidence")

    def test_like_formats_only_and_ties_do_not_break_out(self):
        points = [point(video, hour, views, format=format) for video, format, views in
                  [("a", "long", 100), ("b", "long", 100), ("c", "long", 100), ("d", "short", 100000)]
                  for hour, views in [(0, 0), (1, views)]]
        rows = {row["videoId"]: row for row in rank_momentum(points)["rankings"]}
        self.assertEqual(rows["a"]["percentiles"]["velocity"], 50)
        self.assertEqual(rows["a"]["stage"], "steady")
        self.assertIsNone(rows["d"]["percentiles"]["velocity"])

    def test_rank_and_breakout_are_deterministic(self):
        points = [point(video, hour, value) for video, values in
                  [("a", [0, 10, 20]), ("b", [0, 10, 30]), ("c", [0, 10, 110])]
                  for hour, value in enumerate(values)]
        result = rank_momentum(points)
        self.assertEqual(result, rank_momentum(list(reversed(points)) + points))
        self.assertEqual(result["rankings"][0]["videoId"], "c")
        self.assertEqual(result["rankings"][0]["stage"], "breakout")
        self.assertEqual(result["rankings"][0]["score"], 100)

    def test_channel_breadth_is_distinct_and_aliases_normalized(self):
        points = [point("a", 0, 1, keywords=("  RAMEN ", "라멘")),
                  point("b", 0, 1, keywords=("ramen",)),
                  point("c", 0, 1, channel="second", keywords=("라멘",))]
        result = rank_momentum(points, aliases={"ramen": "라멘"})
        self.assertEqual(result["keywords"], [{"keyword": "라멘", "distinctChannels": 2, "distinctVideos": 3}])

    def test_observation_is_immutable_and_conflicts_rejected(self):
        original = point("a", 0, 10)
        with self.assertRaises(FrozenInstanceError):
            original.views = 20
        with self.assertRaisesRegex(ValueError, "conflicting_trend_observation"):
            rank_momentum([original, point("a", 0, 11)])
        with self.assertRaisesRegex(ValueError, "conflicting_trend_identity"):
            rank_momentum([original, point("a", 1, 11, channel="other")])

    def test_missing_and_corrected_counters_do_not_make_fake_growth(self):
        rows = rank_momentum([point("a", 0, 10), point("a", 1, 9), point("b", 0, 0)])["rankings"]
        self.assertTrue(all(row["velocity"] is None and row["score"] == 0 for row in rows))
        self.assertIn("counter_correction", rows[0]["warnings"])

    def test_invalid_weights_fail_closed(self):
        for weights in [{"velocity": float("nan"), "acceleration": 1}, {"velocity": 0, "acceleration": 0}, {}]:
            with self.assertRaisesRegex(ValueError, "invalid_trend_ranking_config"):
                rank_momentum([], weights=weights)

    def test_dry_run_exposes_analysis_without_overlay_write(self):
        result = run_trend_dry_run(candidates=[], momentum_observations=[point("a", 0, 10)])
        self.assertEqual(result["momentumAnalysis"]["rankings"][0]["observationCount"], 1)
        self.assertEqual(result["approvedOverlayWrites"], [])


if __name__ == "__main__":
    unittest.main()
