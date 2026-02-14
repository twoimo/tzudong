import type { DashboardQualityResponse } from '@/types/dashboard';
import { hasLaajMetrics, hasRuleMetrics } from '@/lib/dashboard/classifiers';
import { getRestaurantRows } from '@/lib/dashboard/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
} | null;

let qualityCache: CacheEntry<DashboardQualityResponse> = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readEvalValueBoolean(metric: unknown): boolean | null {
  const record = asRecord(metric);
  if (!record) return null;
  const value = record.eval_value;
  return typeof value === 'boolean' ? value : null;
}

function readEvalValueNumber(metric: unknown): number | null {
  const record = asRecord(metric);
  if (!record) return null;
  const value = record.eval_value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return (a + b) / 2;
}

function round(value: number | null, digits: number): number | null {
  if (value == null) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function buildDashboardQualityFromRows(
  rows: Awaited<ReturnType<typeof getRestaurantRows>>,
  now: Date = new Date(),
): DashboardQualityResponse {
  const pipelineRows = rows.filter((row) => row.source_type === 'geminiCLI' || row.source_type === 'perplexity');

  let ruleRows = 0;
  let laajRows = 0;

  const locationMatch = { trueCount: 0, falseCount: 0, missingCount: 0 };
  const categoryValidity = { trueCount: 0, falseCount: 0, missingCount: 0 };
  const categoryTF = { trueCount: 0, falseCount: 0, missingCount: 0 };

  const reviewFaithfulnessValues: number[] = [];

  for (const row of pipelineRows) {
    const evaluationResults = row.evaluation_results;
    if (hasRuleMetrics(evaluationResults)) ruleRows += 1;
    if (hasLaajMetrics(evaluationResults)) laajRows += 1;

    const record = asRecord(evaluationResults);
    if (!record) {
      locationMatch.missingCount += 1;
      categoryValidity.missingCount += 1;
      categoryTF.missingCount += 1;
      continue;
    }

    const lmValue = readEvalValueBoolean(record.location_match_TF);
    if (lmValue === true) locationMatch.trueCount += 1;
    else if (lmValue === false) locationMatch.falseCount += 1;
    else locationMatch.missingCount += 1;

    const cvValue = readEvalValueBoolean(record.category_validity_TF);
    if (cvValue === true) categoryValidity.trueCount += 1;
    else if (cvValue === false) categoryValidity.falseCount += 1;
    else categoryValidity.missingCount += 1;

    const ctValue = readEvalValueBoolean(record.category_TF);
    if (ctValue === true) categoryTF.trueCount += 1;
    else if (ctValue === false) categoryTF.falseCount += 1;
    else categoryTF.missingCount += 1;

    const rfValue = readEvalValueNumber(record.review_faithfulness_score);
    if (rfValue != null) reviewFaithfulnessValues.push(rfValue);
  }

  const rfCount = reviewFaithfulnessValues.length;
  const rfAvg = rfCount
    ? reviewFaithfulnessValues.reduce((acc, value) => acc + value, 0) / rfCount
    : null;

  const rfMedian = median(reviewFaithfulnessValues);
  const rfMin = rfCount ? Math.min(...reviewFaithfulnessValues) : null;
  const rfMax = rfCount ? Math.max(...reviewFaithfulnessValues) : null;

  return {
    asOf: now.toISOString(),
    source: 'supabase:public.restaurants',
    totals: {
      pipelineRows: pipelineRows.length,
      withRuleMetrics: ruleRows,
      withLaajMetrics: laajRows,
    },
    locationMatch,
    categoryValidity,
    categoryTF,
    reviewFaithfulness: {
      count: rfCount,
      average: round(rfAvg, 4),
      median: round(rfMedian, 4),
      min: round(rfMin, 4),
      max: round(rfMax, 4),
    },
  };
}

async function buildQuality(): Promise<DashboardQualityResponse> {
  const rows = await getRestaurantRows(false, 'service');
  return buildDashboardQualityFromRows(rows);
}

export async function getDashboardQuality(forceRefresh = false): Promise<DashboardQualityResponse> {
  if (!forceRefresh && qualityCache && qualityCache.expiresAt > Date.now()) {
    return qualityCache.value;
  }

  const value = await buildQuality();
  qualityCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  };

  return value;
}
