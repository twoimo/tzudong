import type { EvaluationRecord, EvaluationRecordStatus, LocationMatchResult } from '@/types/evaluation';

const AUTO_DELETEABLE_MISSING_STATUSES = new Set<EvaluationRecordStatus>([
  'pending',
  'hold',
  'missing',
  'geocoding_failed',
  'not_selected',
]);

const NON_AUTO_DELETEABLE_STATUSES = new Set<EvaluationRecordStatus>([
  'approved',
  'rejected',
  'deleted',
  'db_conflict',
  'address_review_geocode_recovered',
]);

const NO_RESULT_MESSAGE_PATTERN = /검색\s*결과\s*(?:없|없음|없습니다)|결과\s*(?:없|없음|없습니다)|찾(?:을\s*)?수\s*없|not\s*found|no\s+result/i;

export const MISSING_EVALUATION_AUTO_DELETE_MESSAGE = '맛집 검색 결과 없음으로 관리자 검수 자동 삭제';

export type MissingEvaluationAutoDeleteRow = Pick<
  EvaluationRecord,
  | 'id'
  | 'status'
  | 'is_missing'
  | 'is_not_selected'
  | 'approved_name'
  | 'naver_name'
  | 'google_name'
  | 'road_address'
  | 'jibun_address'
  | 'lat'
  | 'lng'
  | 'evaluation_results'
  | 'db_error_message'
> & {
  restaurant_name?: string | null;
  name?: string | null;
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasCoordinate(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function getLocationMatch(record: MissingEvaluationAutoDeleteRow): LocationMatchResult | null {
  return record.evaluation_results?.location_match_TF ?? null;
}

function hasProviderCandidate(record: MissingEvaluationAutoDeleteRow): boolean {
  const locationMatch = getLocationMatch(record);

  return Boolean(
    hasText(record.approved_name)
    || hasText(record.naver_name)
    || hasText(record.google_name)
    || hasText(locationMatch?.matched_name)
    || hasText(locationMatch?.naver_name)
    || hasText(locationMatch?.google_name)
    || hasText(record.road_address)
    || hasText(record.jibun_address)
    || hasCoordinate(record.lat)
    || hasCoordinate(record.lng)
  );
}

function hasNoResultEvidence(record: MissingEvaluationAutoDeleteRow): boolean {
  const locationMatch = getLocationMatch(record);
  const evidence = [
    locationMatch?.falseMessage,
    locationMatch?.match_status,
    record.db_error_message,
  ].filter(hasText).join(' ');

  return (
    locationMatch?.eval_value === false
    && (
      locationMatch.match_status === 'failed'
      || NO_RESULT_MESSAGE_PATTERN.test(evidence)
    )
  );
}

export function getMissingEvaluationAutoDeleteReason(record: MissingEvaluationAutoDeleteRow): string | null {
  if (NON_AUTO_DELETEABLE_STATUSES.has(record.status)) return null;
  if (!AUTO_DELETEABLE_MISSING_STATUSES.has(record.status)) return null;

  if (record.is_missing === true || record.status === 'missing') {
    return 'missing 플래그/상태로 맛집 검색 결과가 없음';
  }

  if (!hasProviderCandidate(record) && hasNoResultEvidence(record)) {
    return '지도 후보명·주소 없이 위치 매칭 결과가 검색 실패';
  }

  return null;
}

export function shouldAutoDeleteMissingEvaluationRecord(record: MissingEvaluationAutoDeleteRow): boolean {
  return getMissingEvaluationAutoDeleteReason(record) !== null;
}
