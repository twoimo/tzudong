function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasObjectField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function hasRuleMetrics(evaluationResults: unknown): boolean {
  const record = asRecord(evaluationResults);
  if (!record) return false;
  return (
    hasObjectField(record, 'category_validity_TF') ||
    hasObjectField(record, 'location_match_TF')
  );
}

export function hasLaajMetrics(evaluationResults: unknown): boolean {
  const record = asRecord(evaluationResults);
  if (!record) return false;
  return (
    hasObjectField(record, 'visit_authenticity') ||
    hasObjectField(record, 'rb_inference_score') ||
    hasObjectField(record, 'rb_grounding_TF') ||
    hasObjectField(record, 'review_faithfulness_score') ||
    hasObjectField(record, 'category_TF')
  );
}

export function getLocationMatchFalseMessage(evaluationResults: unknown): string | null {
  const record = asRecord(evaluationResults);
  if (!record) return null;

  const locationMatch = record.location_match_TF;
  if (!locationMatch || typeof locationMatch !== 'object' || Array.isArray(locationMatch)) {
    return null;
  }

  const lm = locationMatch as Record<string, unknown>;
  if (lm.eval_value === true) return null;

  if (typeof lm.falseMessage === 'string' && lm.falseMessage.trim().length > 0) {
    return lm.falseMessage;
  }

  return 'location_match 실패(사유 없음)';
}

export function toNotSelectionReason(params: {
  is_not_selected?: boolean | null;
  is_missing?: boolean | null;
  geocoding_false_stage?: number | null;
  geocoding_success?: boolean | null;
}): string {
  if (params.is_not_selected !== true) return '평가 미대상(기타)';

  if (params.is_missing) return '평가 미대상(missing target)';
  if (params.geocoding_false_stage === 0) return '평가 미대상(address null 등)';
  if (params.geocoding_false_stage === 1) return '평가 미대상(지오코딩 1단계 실패)';
  if (params.geocoding_false_stage === 2) return '평가 미대상(지오코딩 2단계 실패)';
  if (params.geocoding_success === false) return '평가 미대상(지오코딩 실패)';
  return '평가 미대상(기타)';
}
