"""Independent, deterministic observation-based trend analysis.

Inspired by public descriptions of Veyra features; no Veyra implementation is
used. Rates require timestamped observations, and ranks compare like formats.
This module proposes evidence; it never approves restaurants or overlays.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from typing import Mapping, Sequence
import unicodedata


@dataclass(frozen=True)
class Observation:
    video_id: str
    channel_id: str
    format: str
    observed_at: datetime
    views: int
    keywords: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if (not self.video_id or not self.channel_id or self.format not in {"short", "long"}
                or self.observed_at.tzinfo is None or self.observed_at.utcoffset() is None
                or isinstance(self.views, bool) or not isinstance(self.views, int) or self.views < 0
                or not isinstance(self.keywords, tuple)
                or any(not isinstance(word, str) for word in self.keywords)):
            raise ValueError("invalid_trend_observation")


def canonical_keyword(value: str, aliases: Mapping[str, str] | None = None) -> str:
    def normalize(text: str) -> str:
        return " ".join(unicodedata.normalize("NFKC", text).casefold().split())
    normalized = normalize(value)
    lookup = {normalize(key): normalize(target) for key, target in (aliases or {}).items()}
    return lookup.get(normalized, normalized)


def rank_momentum(
    observations: Sequence[Observation], *,
    weights: Mapping[str, float] | None = None,
    aliases: Mapping[str, str] | None = None,
    minimum_population: int = 3,
) -> dict:
    """Use latest two/three observations for hourly velocity/acceleration.

    Exact repeated observations are idempotent. Conflicting same-time records
    and changes of channel/format fail closed. Counter corrections make the
    affected rate unavailable. Missing components keep their weight, so sparse
    evidence cannot become a maximal score through renormalization.
    """
    configured = dict(weights if weights is not None else {"velocity": .7, "acceleration": .3})
    if (set(configured) != {"velocity", "acceleration"}
            or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not isfinite(v) or v < 0 for v in configured.values())
            or sum(configured.values()) <= 0 or minimum_population < 2):
        raise ValueError("invalid_trend_ranking_config")
    total = sum(configured.values())
    normalized_weights = {key: value / total for key, value in configured.items()}
    series: dict[str, dict[datetime, Observation]] = defaultdict(dict)
    for item in observations:
        existing = series[item.video_id].get(item.observed_at)
        if existing is not None and existing != item:
            raise ValueError("conflicting_trend_observation")
        series[item.video_id][item.observed_at] = item

    rows = []
    populations: dict[tuple[str, str], list[float]] = defaultdict(list)
    keyword_channels: dict[str, set[str]] = defaultdict(set)
    keyword_videos: dict[str, set[str]] = defaultdict(set)
    for video_id, points in series.items():
        ordered = sorted(points.values(), key=lambda item: item.observed_at)
        latest = ordered[-1]
        if any((item.channel_id, item.format) != (latest.channel_id, latest.format) for item in ordered):
            raise ValueError("conflicting_trend_identity")
        velocity = acceleration = None
        warnings = []
        if len(ordered) >= 2:
            previous = ordered[-2]
            hours = (latest.observed_at - previous.observed_at).total_seconds() / 3600
            if latest.views >= previous.views:
                velocity = (latest.views - previous.views) / hours
                if len(ordered) >= 3:
                    oldest = ordered[-3]
                    previous_hours = (previous.observed_at - oldest.observed_at).total_seconds() / 3600
                    if previous.views >= oldest.views:
                        previous_velocity = (previous.views - oldest.views) / previous_hours
                        acceleration = (velocity - previous_velocity) / ((hours + previous_hours) / 2)
                    else:
                        warnings.append("counter_correction")
            else:
                warnings.append("counter_correction")
        else:
            warnings.append("comparison_missing")
        row = {"videoId": video_id, "channelId": latest.channel_id, "format": latest.format,
               "observedAt": latest.observed_at.isoformat(), "observationCount": len(ordered),
               "velocity": velocity, "acceleration": acceleration, "warnings": warnings}
        for metric in normalized_weights:
            if row[metric] is not None:
                populations[(latest.format, metric)].append(row[metric])
        for keyword in {canonical_keyword(word, aliases) for word in latest.keywords} - {""}:
            keyword_channels[keyword].add(latest.channel_id)
            keyword_videos[keyword].add(video_id)
        rows.append(row)
    for population in populations.values():
        population.sort()
    for row in rows:
        ranks = {}
        sizes = {}
        for metric in normalized_weights:
            population = populations[(row["format"], metric)]
            sizes[metric] = len(population)
            value = row[metric]
            # Midrank ties; all-equal populations carry no breakout evidence.
            ranks[metric] = (100 * (bisect_left(population, value) + bisect_right(population, value) - 1)
                             / (2 * (len(population) - 1))) if value is not None and len(population) >= minimum_population else None
        row["percentiles"] = ranks
        row["populationSizes"] = sizes
        row["score"] = round(sum(normalized_weights[key] * (ranks[key] or 0) for key in ranks), 4)
        row["stage"] = ("breakout" if row["score"] >= 80 and (row["acceleration"] or 0) > 0
                        else "rising" if (ranks["velocity"] or 0) >= 80 and (row["velocity"] or 0) > 0
                        else "insufficient_evidence" if ranks["velocity"] is None else "steady")
    rows.sort(key=lambda row: (-row["score"], row["videoId"]))
    return {"version": "observation_momentum_v1", "weights": normalized_weights,
            "rankings": rows, "keywords": [
                {"keyword": word, "distinctChannels": len(keyword_channels[word]),
                 "distinctVideos": len(keyword_videos[word])}
                for word in sorted(keyword_channels, key=lambda word: (-len(keyword_channels[word]), word))]}
