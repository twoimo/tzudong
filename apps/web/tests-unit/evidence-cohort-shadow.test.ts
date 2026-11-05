import { describe, expect, test } from "bun:test";

import { compareCohortShadow, decay, refuseOperationalWrite, visitsMultiplier } from "../lib/evidence-engineering/scoring";

describe("cohort shadow", () => {
  test("missing and complete signal observations both block unestablished scalar comparisons", () => {
    const freshness = decay(10, 0.5, 460);
    const visits = visitsMultiplier(["abc123DEF45", "abc123DEF45"], 0.25);
    expect(visits).toBe(1);
    const signals = { freshness, visit_multiplier: visits };
    const incomplete = compareCohortShadow([
      { identity: "shop:a", operational_score: 4, candidate_signals: signals },
      { identity: "shop:b", operational_score: null, candidate_signals: null },
    ]);
    expect(incomplete.summary.live_write_allowed).toBe(false);
    expect(() => refuseOperationalWrite(incomplete.summary)).toThrow("shadow_comparison_required");

    const complete = compareCohortShadow([
      { identity: "shop:a", operational_score: 4, candidate_signals: signals },
      { identity: "shop:b", operational_score: null, candidate_signals: signals },
    ]);
    expect(complete.summary.count).toBe(2);
    expect(complete.summary.differ_count).toBeNull();
    expect(complete.records.every(row => !row.comparison_present && row.differs === null)).toBe(true);
    expect(complete.records[0]?.candidate_freshness).toBe(freshness);
    expect(complete.records[0]?.candidate_visit_multiplier).toBe(visits);
    expect(complete.records[0]?.operational_score).toBe(4);
    expect(complete.summary.live_write_allowed).toBe(false);
    expect(() => refuseOperationalWrite(complete.summary)).toThrow("shadow_comparison_required");
    // Even a separately established comparison cannot turn this helper into a writer.
    const kept = refuseOperationalWrite({ live_write_allowed: true });
    expect(kept.popularity_score).toBeNull();
    expect(kept.popularity_tier).toBeNull();
    expect(kept.overwrites_operational_values).toBe(false);
  });
});
