import { THESIS_HYPERBOLIC_LAMBDA } from "./constants";
import { EvidenceContractCodes, EvidenceContractError } from "./errors";
import { requireYouTubeVideoId, safeCount } from "./guards";
import type { PopularitySignals, UniqueCountAggregate } from "./types";

export function decay(days: number, floor: number, halfChangeDays: number): number {
  if (![days, floor, halfChangeDays].every(Number.isFinite)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (days < 0 || floor < 0 || floor >= 1 || halfChangeDays <= 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDecayParameters);
  }
  return floor + (1 - floor) / (1 + days / halfChangeDays);
}

export function hyperbolicDecay(days: number, lambda: number = THESIS_HYPERBOLIC_LAMBDA): number {
  if (!Number.isFinite(days) || !Number.isFinite(lambda)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (days < 0 || lambda <= 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDecayParameters);
  }
  return 1 / (1 + lambda * days);
}

export function hyperbolicHalfLifeDays(lambda: number): number {
  if (!Number.isFinite(lambda)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (lambda <= 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDecayParameters);
  }
  const halfLife = 1 / lambda;
  if (!Number.isFinite(halfLife)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  return halfLife;
}

export function thesisHalfLifeClaimIsExact(): boolean {
  return hyperbolicHalfLifeDays(THESIS_HYPERBOLIC_LAMBDA) === 460;
}

export function visitsMultiplier(videoIds: readonly string[], gamma: number): number {
  if (!Number.isFinite(gamma) || gamma < 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidGamma);
  }
  const uniqueIds = new Set<string>();
  for (const videoId of videoIds) {
    uniqueIds.add(requireYouTubeVideoId(videoId));
  }
  const multiplier = 1 + gamma * Math.log1p(Math.max(0, uniqueIds.size - 1));
  if (!Number.isFinite(multiplier)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  return multiplier;
}

export function platformReviewSignal(reviewCount: unknown, maximum: number): number | null {
  return safeCount(reviewCount, maximum);
}

export function assemblePopularitySignals(input: {
  videoEngagement: number;
  daysSincePublish: number;
  floor: number;
  halfChangeDays: number;
  uniqueVideoIds: readonly string[];
  gamma: number;
  platformReviewSignal: number | null;
}): PopularitySignals {
  if (!Number.isFinite(input.videoEngagement) || input.videoEngagement < 0) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (
    input.platformReviewSignal !== null &&
    (!Number.isFinite(input.platformReviewSignal) || input.platformReviewSignal < 0)
  ) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  return {
    video_engagement: input.videoEngagement,
    freshness: decay(input.daysSincePublish, input.floor, input.halfChangeDays),
    visit_multiplier: visitsMultiplier(input.uniqueVideoIds, input.gamma),
    platform_review_signal: input.platformReviewSignal,
  };
}

export function aggregateUniqueCounts(
  rows: readonly { videoId: string; count: unknown }[],
  maximum: number,
): UniqueCountAggregate {
  const grouped = new Map<string, { count: number | null; seen: boolean }>();
  const order: string[] = [];

  for (const row of rows) {
    const videoId = requireYouTubeVideoId(row.videoId);
    const parsed = safeCount(row.count, maximum);
    const existing = grouped.get(videoId);
    if (!existing) {
      grouped.set(videoId, { count: parsed, seen: true });
      order.push(videoId);
      continue;
    }
    if (existing.count !== parsed) {
      throw new EvidenceContractError(EvidenceContractCodes.duplicateVideoConflict);
    }
  }

  let knownSum = 0;
  const missingVideoIds: string[] = [];
  for (const videoId of order) {
    const groupedCount = grouped.get(videoId);
    if (!groupedCount) continue;
    if (groupedCount.count === null) {
      missingVideoIds.push(videoId);
      continue;
    }
    knownSum += groupedCount.count;
    if (!Number.isSafeInteger(knownSum)) {
      throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
    }
  }

  return {
    videoCount: order.length,
    knownSum,
    missingVideoIds,
  };
}

export type CohortShadowMember = {
  identity: string;
  operational_score: number | null;
  candidate_signals: { freshness: number; visit_multiplier: number } | null;
};

export function compareCohortShadow(members: readonly CohortShadowMember[]): {
  records: Array<{
    identity: string;
    operational_score: number | null;
    candidate_freshness: number | null;
    candidate_visit_multiplier: number | null;
    comparison_present: boolean;
    differs: null;
  }>;
  summary: { count: number; differ_count: null; live_write_allowed: false };
} {
  if (members.length === 0) throw new Error("empty_cohort");
  const seen = new Set<string>();
  const records = members.map((member) => {
    const identity = member.identity;
    if (typeof identity !== "string" || identity.trim() === "" || seen.has(identity)) {
      throw new Error("invalid_shadow_member");
    }
    seen.add(identity);
    const operational = member.operational_score;
    if (operational !== null && !Number.isFinite(operational)) {
      throw new Error("invalid_operational_score");
    }
    const signals = member.candidate_signals;
    if (signals === null) {
      return {
        identity,
        operational_score: operational,
        candidate_freshness: null,
        candidate_visit_multiplier: null,
        comparison_present: false,
        differs: null,
      };
    }
    if (!Number.isFinite(signals.freshness) || !Number.isFinite(signals.visit_multiplier)) {
      throw new Error("invalid_candidate_signals");
    }
    // These two dimensionless signals have no approved scalar score mapping.
    // Their presence cannot establish a difference from an operational score.
    return {
      identity,
      operational_score: operational,
      candidate_freshness: signals.freshness,
      candidate_visit_multiplier: signals.visit_multiplier,
      comparison_present: false,
      differs: null,
    };
  });
  return {
    records,
    summary: {
      count: records.length,
      differ_count: null,
      live_write_allowed: false,
    },
  };
}

export function refuseOperationalWrite(summary: { live_write_allowed: boolean }): {
  popularity_score: null;
  popularity_tier: null;
  writes_hosted_database: false;
  mutates_restaurant_updated_at: false;
  overwrites_operational_values: false;
} {
  if (summary.live_write_allowed !== true) throw new Error("shadow_comparison_required");
  return {
    popularity_score: null,
    popularity_tier: null,
    writes_hosted_database: false,
    mutates_restaurant_updated_at: false,
    overwrites_operational_values: false,
  };
}
