import {
  canPromoteReceiptOcrCandidate,
  validateReceiptOcrFixture,
  type ReceiptOcrAggregateSummary,
  type ReceiptOcrFixtureManifest,
  type ReceiptOcrGoldLabel,
} from '@/lib/ocr/evaluation';

export type ReceiptOcrPromotionGateInput = {
  manifest: ReceiptOcrFixtureManifest;
  goldLabelsByFixtureId: Record<string, ReceiptOcrGoldLabel>;
  baseline: ReceiptOcrAggregateSummary;
  candidate: ReceiptOcrAggregateSummary;
};

export type ReceiptOcrPromotionGateResult = {
  ok: boolean;
  reasons: string[];
  fixtureCount: number;
  koreanRestaurantFixtureCount: number;
};

export function evaluateReceiptOcrProductionPromotionGate(
  input: ReceiptOcrPromotionGateInput,
): ReceiptOcrPromotionGateResult {
  const reasons: string[] = [];
  let koreanRestaurantFixtureCount = 0;

  for (const fixture of input.manifest.fixtures) {
    const gold = input.goldLabelsByFixtureId[fixture.id];
    if (!gold) {
      reasons.push(`missing gold label for fixture ${fixture.id}`);
      continue;
    }
    const validation = validateReceiptOcrFixture({ manifestEntry: fixture, gold });
    reasons.push(...validation.reasons.map((reason) => `${fixture.id}: ${reason}`));
    if (fixture.language === 'ko' && /restaurant|delivery|order/.test(fixture.domain ?? '')) {
      koreanRestaurantFixtureCount += 1;
    }
  }

  const threshold = canPromoteReceiptOcrCandidate({
    baseline: input.baseline,
    candidate: input.candidate,
    fixtureCount: input.manifest.fixtures.length,
    koreanRestaurantFixtureCount,
  });
  reasons.push(...threshold.reasons);

  return {
    ok: reasons.length === 0,
    reasons,
    fixtureCount: input.manifest.fixtures.length,
    koreanRestaurantFixtureCount,
  };
}

export function assertReceiptOcrProductionPromotionAllowed(input: ReceiptOcrPromotionGateInput): void {
  const gate = evaluateReceiptOcrProductionPromotionGate(input);
  if (!gate.ok) {
    throw new Error(`Receipt OCR production promotion blocked: ${gate.reasons.join('; ')}`);
  }
}
