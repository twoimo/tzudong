import { normalizeOcrRestaurantName } from '@/lib/ocr/restaurant-matching';
import type { NvidiaNimReceiptOcrData } from '@/lib/ocr/nvidia-nim';

export type ReceiptOcrRedactionStatus = 'redacted' | 'no_sensitive_fields_detected' | 'unreviewed' | 'contains_sensitive_fields';

export type ReceiptOcrGoldLabel = Required<Pick<NvidiaNimReceiptOcrData, 'store_name' | 'date' | 'time' | 'total_amount'>> & {
  canonical_store_name?: string;
  items?: Array<{ name: string; price: number | null }>;
  restaurant_id?: string;
  address_hint?: string;
  source?: string;
  license?: string;
  redaction_status?: ReceiptOcrRedactionStatus;
  language?: string;
  domain?: string;
};

export type ReceiptOcrFixtureManifestEntry = {
  id: string;
  gold_path: string;
  image_path?: string;
  language?: string;
  domain?: string;
  source: string;
  license: string;
  redaction_status: ReceiptOcrRedactionStatus;
  committable: boolean;
};

export type ReceiptOcrFixtureManifest = {
  version: 1;
  fixtures: ReceiptOcrFixtureManifestEntry[];
};

export type ReceiptOcrEvaluationObservation = {
  fixtureId: string;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
  raw?: NvidiaNimReceiptOcrData;
  normalized?: NvidiaNimReceiptOcrData;
  gold: ReceiptOcrGoldLabel;
};

export type ReceiptOcrScoreBreakdown = {
  storeRaw: number;
  storeCanonical: number;
  date: number;
  time: number;
  totalAmount: number;
  items: number;
  overall: number;
};

function closeNameScore(actual: string | undefined, expected: string | undefined): number {
  if (!actual || !expected) return 0;
  const a = normalizeOcrRestaurantName(actual);
  const e = normalizeOcrRestaurantName(expected);
  if (!a || !e) return 0;
  if (a === e) return 1;
  if (a.includes(e) || e.includes(a)) return 0.9;
  let same = 0;
  const len = Math.max(a.length, e.length);
  for (let i = 0; i < Math.min(a.length, e.length); i += 1) if (a[i] === e[i]) same += 1;
  return len ? Math.max(0, same / len - 0.15) : 0;
}

function itemScore(actual: NvidiaNimReceiptOcrData['items'], expected: ReceiptOcrGoldLabel['items']): number {
  if (!expected?.length) return actual?.length ? 0.5 : 1;
  if (!actual?.length) return 0;
  const expectedTotal = expected.reduce((sum, item) => sum + (item.price ?? 0), 0);
  const actualTotal = actual.reduce((sum, item) => sum + (item.price ?? 0), 0);
  const priceScore = expectedTotal && actualTotal === expectedTotal ? 0.45 : 0;
  const nameScore = Math.max(...actual.flatMap((a) => expected.map((e) => closeNameScore(a.name, e.name)))) * 0.55;
  return Math.min(1, priceScore + nameScore);
}

export function scoreReceiptOcrResult(input: {
  raw: NvidiaNimReceiptOcrData;
  normalized?: NvidiaNimReceiptOcrData;
  gold: ReceiptOcrGoldLabel;
}): ReceiptOcrScoreBreakdown {
  const normalized = input.normalized ?? input.raw;
  const storeRaw = closeNameScore(input.raw.store_name, input.gold.store_name);
  const canonicalExpected = input.gold.canonical_store_name ?? input.gold.store_name;
  const storeCanonical = closeNameScore(normalized.store_name, canonicalExpected);
  const date = normalized.date === input.gold.date ? 1 : 0;
  const time = normalized.time === input.gold.time ? 1 : 0;
  const totalAmount = normalized.total_amount === input.gold.total_amount ? 1 : 0;
  const items = itemScore(normalized.items, input.gold.items);
  const overall = Math.round((storeRaw * 0.18 + storeCanonical * 0.22 + date * 0.15 + time * 0.1 + totalAmount * 0.2 + items * 0.15) * 100);
  return { storeRaw, storeCanonical, date, time, totalAmount, items, overall };
}


export type ReceiptOcrAggregateSummary = {
  count: number;
  successfulCount: number;
  errorCount: number;
  errorRate: number;
  overallAvg: number;
  storeRawAvg: number;
  storeCanonicalAvg: number;
  dateAvg: number;
  timeAvg: number;
  totalAmountAvg: number;
  itemsAvg: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
};

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function validateReceiptOcrFixture(input: {
  manifestEntry: ReceiptOcrFixtureManifestEntry;
  gold: ReceiptOcrGoldLabel;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.manifestEntry.id.trim()) reasons.push('fixture id is required');
  if (!input.manifestEntry.gold_path.trim()) reasons.push('gold_path is required');
  if (!input.manifestEntry.source.trim() || !input.gold.source?.trim()) reasons.push('source is required on manifest and gold label');
  if (!input.manifestEntry.license.trim() || !input.gold.license?.trim()) reasons.push('license is required on manifest and gold label');
  const safeRedaction = input.manifestEntry.redaction_status === 'redacted'
    || input.manifestEntry.redaction_status === 'no_sensitive_fields_detected';
  if (!safeRedaction || input.manifestEntry.redaction_status !== input.gold.redaction_status) {
    reasons.push('redaction_status must be redacted/no_sensitive_fields_detected and match the gold label');
  }
  if (input.manifestEntry.committable && input.manifestEntry.redaction_status === 'contains_sensitive_fields') {
    reasons.push('committable fixtures cannot contain sensitive fields');
  }
  return { ok: reasons.length === 0, reasons };
}

export function summarizeReceiptOcrEvaluations(
  observations: ReceiptOcrEvaluationObservation[],
): ReceiptOcrAggregateSummary {
  const successful = observations.filter((observation) => !observation.error && observation.raw);
  const scores = successful.map((observation) => scoreReceiptOcrResult({
    raw: observation.raw ?? {},
    normalized: observation.normalized,
    gold: observation.gold,
  }));
  const latencies = observations.map((observation) => observation.latencyMs).filter(Number.isFinite);
  return {
    count: observations.length,
    successfulCount: successful.length,
    errorCount: observations.length - successful.length,
    errorRate: observations.length ? (observations.length - successful.length) / observations.length : 0,
    overallAvg: average(scores.map((score) => score.overall)),
    storeRawAvg: average(scores.map((score) => score.storeRaw * 100)),
    storeCanonicalAvg: average(scores.map((score) => score.storeCanonical * 100)),
    dateAvg: average(scores.map((score) => score.date * 100)),
    timeAvg: average(scores.map((score) => score.time * 100)),
    totalAmountAvg: average(scores.map((score) => score.totalAmount * 100)),
    itemsAvg: average(scores.map((score) => score.items * 100)),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
  };
}

export function canPromoteReceiptOcrCandidate(input: {
  candidate: ReceiptOcrAggregateSummary;
  baseline: ReceiptOcrAggregateSummary;
  fixtureCount: number;
  koreanRestaurantFixtureCount: number;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.fixtureCount < 10) reasons.push('requires at least 10 validated gold fixtures');
  if (input.koreanRestaurantFixtureCount < 5) reasons.push('requires at least 5 Korean restaurant/order fixtures');
  if (input.candidate.errorRate > 0.05) reasons.push('candidate error/timeout rate exceeds 5%');
  const beatsAccuracy = input.candidate.overallAvg >= input.baseline.overallAvg + 3;
  const tiedButFaster = Math.abs(input.candidate.overallAvg - input.baseline.overallAvg) <= 1
    && input.candidate.p95LatencyMs <= input.baseline.p95LatencyMs * 0.8;
  if (!beatsAccuracy && !tiedButFaster) reasons.push('candidate does not beat accuracy threshold or latency tie-breaker');
  if (input.candidate.storeCanonicalAvg < input.baseline.storeCanonicalAvg - 2) reasons.push('canonical store score regresses by more than 2 points');
  if (input.candidate.dateAvg < input.baseline.dateAvg - 2) reasons.push('date score regresses by more than 2 points');
  if (input.candidate.totalAmountAvg < input.baseline.totalAmountAvg - 2) reasons.push('total amount score regresses by more than 2 points');
  return { ok: reasons.length === 0, reasons };
}
