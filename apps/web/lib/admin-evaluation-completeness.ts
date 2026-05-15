import type { EvaluationRecord, EvaluationResult } from '@/types/evaluation';

export const EVALUATION_RERUN_NEEDED_LABEL = '평가값 확인';
export const EVALUATION_BASIS_RERUN_NEEDED_TEXT = '평가 근거 없음';

export type EvaluationMetricKey =
  | 'visit_authenticity'
  | 'rb_inference_score'
  | 'rb_grounding_TF'
  | 'review_faithfulness_score'
  | 'category_validity_TF'
  | 'category_TF';

type MetricValueType = 'number' | 'boolean';

type MetricDefinition = {
  key: EvaluationMetricKey;
  label: string;
  valueType: MetricValueType;
  basisRequired: boolean;
};

export const EVALUATION_COMPLETENESS_METRICS: MetricDefinition[] = [
  { key: 'visit_authenticity', label: '방문여부', valueType: 'number', basisRequired: true },
  { key: 'rb_inference_score', label: '추론합리', valueType: 'number', basisRequired: true },
  { key: 'rb_grounding_TF', label: '근거일치', valueType: 'boolean', basisRequired: true },
  { key: 'review_faithfulness_score', label: '리뷰충실', valueType: 'number', basisRequired: true },
  { key: 'category_validity_TF', label: '카테고리 유효', valueType: 'boolean', basisRequired: false },
  { key: 'category_TF', label: '카테고리 정합', valueType: 'boolean', basisRequired: false },
];

export type EvaluationCompletenessIssue = {
  key: EvaluationMetricKey;
  label: string;
  missingValue: boolean;
  missingBasis: boolean;
};

function hasTypedValue(value: unknown, valueType: MetricValueType): boolean {
  if (valueType === 'boolean') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isFinite(value);
}

export function hasUsableEvaluationBasis(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== '-' && trimmed !== '근거 내용 없음';
}

export function isEvaluationCompletenessCheckable(record: Pick<EvaluationRecord, 'status' | 'is_missing' | 'is_not_selected'>): boolean {
  return (
    record.status !== 'deleted' &&
    record.status !== 'missing' &&
    record.status !== 'not_selected' &&
    record.is_missing !== true &&
    record.is_not_selected !== true
  );
}

export function getEvaluationCompletenessIssues(record: Pick<EvaluationRecord, 'status' | 'is_missing' | 'is_not_selected' | 'evaluation_results'>): EvaluationCompletenessIssue[] {
  if (!isEvaluationCompletenessCheckable(record)) return [];

  const results = record.evaluation_results;
  return EVALUATION_COMPLETENESS_METRICS.flatMap((definition) => {
    const metric = results?.[definition.key] as EvaluationResult[EvaluationMetricKey] | null | undefined;
    const metricObject = metric && typeof metric === 'object' && !Array.isArray(metric) ? metric as Record<string, unknown> : null;
    const missingValue = !metricObject || !hasTypedValue(metricObject.eval_value, definition.valueType);
    const missingBasis = definition.basisRequired && (!metricObject || !hasUsableEvaluationBasis(metricObject.eval_basis));

    if (!missingValue && !missingBasis) return [];

    return [{
      key: definition.key,
      label: definition.label,
      missingValue,
      missingBasis,
    }];
  });
}

export function needsEvaluationRerun(record: Pick<EvaluationRecord, 'status' | 'is_missing' | 'is_not_selected' | 'evaluation_results'>): boolean {
  return getEvaluationCompletenessIssues(record).length > 0;
}

export function getEvaluationRerunSummary(record: Pick<EvaluationRecord, 'status' | 'is_missing' | 'is_not_selected' | 'evaluation_results'>): string {
  const issues = getEvaluationCompletenessIssues(record);
  if (issues.length === 0) return '';

  const valueMissingLabels = issues.filter((issue) => issue.missingValue).map((issue) => issue.label);
  const basisMissingLabels = issues.filter((issue) => issue.missingBasis).map((issue) => issue.label);
  const parts = [
    valueMissingLabels.length > 0 ? `값 없음: ${valueMissingLabels.join(', ')}` : null,
    basisMissingLabels.length > 0 ? `근거 없음: ${basisMissingLabels.join(', ')}` : null,
  ].filter(Boolean);

  return parts.join(' · ');
}

export function getEvaluationBasisOrRerunText(value: unknown): string {
  return hasUsableEvaluationBasis(value) ? String(value) : EVALUATION_BASIS_RERUN_NEEDED_TEXT;
}
