import type { EvaluationResult, LocationMatchResult } from '@/types/evaluation';

type EvaluationNameSource = {
  approved_name?: string | null;
  restaurant_name?: string | null;
  name?: string | null;
  origin_name?: string | null;
  naver_name?: string | null;
  evaluation_results?: EvaluationResult | Record<string, unknown> | null;
};

function firstNonEmptyString(values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getLocationMatchResult(evaluationResults: EvaluationNameSource['evaluation_results']): LocationMatchResult | null {
  if (!evaluationResults || typeof evaluationResults !== 'object' || Array.isArray(evaluationResults)) {
    return null;
  }

  const locationMatch = (evaluationResults as { location_match_TF?: unknown }).location_match_TF;
  if (!locationMatch || typeof locationMatch !== 'object' || Array.isArray(locationMatch)) {
    return null;
  }

  return locationMatch as LocationMatchResult;
}

export function getRuleBasedPassedNaverName(source: EvaluationNameSource): string | null {
  const locationMatch = getLocationMatchResult(source.evaluation_results);
  const isRuleBasedPassed = locationMatch?.eval_value === true || locationMatch?.match_status === 'matched';

  if (!isRuleBasedPassed) {
    return null;
  }

  return firstNonEmptyString([
    source.naver_name,
    locationMatch?.naver_name,
    locationMatch?.matched_provider === 'naver' ? locationMatch?.matched_name : null,
  ]);
}

export function getAdminEvaluationDisplayName(source: EvaluationNameSource): string {
  return (
    firstNonEmptyString([
      source.approved_name,
      getRuleBasedPassedNaverName(source),
      source.restaurant_name,
      source.name,
      source.origin_name,
    ]) || '이름 없음'
  );
}
