import type { EvaluationRecord, LocationMatchResult } from '@/types/evaluation';

export type AddressConsistencyStatus = 'true' | 'false' | 'failed' | 'review' | 'candidate' | 'not_applicable' | 'unknown';

interface AddressConsistencyInput {
  geocoding_success?: boolean | null;
  geocoding_false_stage?: number | null;
  status?: string | null;
  is_not_selected?: boolean | null;
  is_missing?: boolean | null;
  db_error_message?: string | null;
  db_error_details?: unknown;
  origin_address?: unknown;
  origin_name?: string | null;
  approved_name?: string | null;
  restaurant_name?: string | null;
  name?: string | null;
  road_address?: string | null;
  jibun_address?: string | null;
  naver_name?: string | null;
  google_name?: string | null;
  phone?: string | null;
  youtube_meta?: {
    title?: string | null;
    publishedAt?: string | null;
  } | null;
  reasoning_basis?: string | null;
  description_map_url?: string | null;
  trace_id_name_source?: string | null;
  updated_by_admin_id?: string | null;
  evaluation_results?: {
    location_match_TF?: LocationMatchResult | null;
  } | null;
}

export const UNCONFIRMED_MAP_REASONS = new Set([
  'ambiguous_chain',
  'multi_candidate',
]);

export const GEO_TRUE_UNCONFIRMED_MAP_REASONS = new Set([
  'insufficient_evidence',
]);

const PENDING_REASON_LABELS: Record<string, string> = {
  insufficient_evidence: '후보를 확정할 독립 근거가 부족합니다.',
  cross_country_mismatch: '원본 위치와 후보 위치의 국가/지역이 서로 맞지 않습니다.',
  ambiguous_chain: '동일/유사 상호 체인점이 여러 개라 지점을 확정할 수 없습니다.',
  multi_candidate: '추가 검토 사유가 남아 단일 주소로 확정할 수 없습니다.',
  timeout: '2차 검증이 제한 시간 안에 완료되지 않았습니다.',
  rate_limited: '외부 주소/검색 공급자 호출 제한으로 검증이 중단되었습니다.',
};

const EVIDENCE_FAMILY_LABELS: Record<string, string> = {
  provider_candidate: '외부 주소 검색 결과',
  source_geo: '원본 좌표/주소 비교',
  cross_provider: '복수 지도 공급자 교차 확인',
  browser_verification: '브라우저 검증',
  llm_verification: 'LLM 보조 검증',
  geocode_provider: '주소 지오코딩 공급자',
};

const PROVIDER_LABELS: Record<string, string> = {
  naver: '네이버',
  google: '구글',
  playwright: '브라우저',
  gemini: '제미나이',
  ncp_geocode: 'NCP 지오코딩',
};

const MATCH_STATUS_LABELS: Record<string, string> = {
  matched: '정합',
  pending: '검토 필요',
  failed: '실패',
};

export const ADDRESS_REVIEW_GEOCODE_RECOVERED_QUEUE = 'geocode_recovered_review';
export const ADMIN_DERIVED_STATUS_ADDRESS_REVIEW_GEOCODE_RECOVERED = 'address_review_geocode_recovered';

export interface AddressConsistencyReviewQueueInfo {
  queue: string;
  label: string;
  reason: string;
}


function getObjectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getAddressConsistencyReview(record: Pick<AddressConsistencyInput, 'db_error_details'>): Record<string, unknown> | null {
  const details = getObjectValue(record.db_error_details);
  return getObjectValue(details?.address_consistency_review);
}

export function getAddressConsistencyReviewQueueInfo(record: Pick<AddressConsistencyInput, 'db_error_details'>): AddressConsistencyReviewQueueInfo | null {
  const review = getAddressConsistencyReview(record);
  const queue = typeof review?.queue === 'string' ? review.queue : null;
  if (!queue) return null;

  if (queue === ADDRESS_REVIEW_GEOCODE_RECOVERED_QUEUE) {
    return {
      queue,
      label: '검토',
      reason: typeof review?.reason_ko === 'string'
        ? review.reason_ko
        : '주소 지오코딩은 회복됐지만 지도 상호 후보가 부족해 관리자 확인이 필요합니다.',
    };
  }

  return {
    queue,
    label: '검토',
    reason: typeof review?.reason_ko === 'string' ? review.reason_ko : '주소 정합성 추가 검토가 필요합니다.',
  };
}

export function isGeocodeRecoveredReviewQueue(record: Pick<AddressConsistencyInput, 'db_error_details'>): boolean {
  return getAddressConsistencyReviewQueueInfo(record)?.queue === ADDRESS_REVIEW_GEOCODE_RECOVERED_QUEUE;
}

function compact(items: Array<string | null | undefined | false>): string[] {
  return items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function getOriginAddressText(originAddress: unknown): string | null {
  if (typeof originAddress === 'string') return originAddress.trim() || null;
  if (!originAddress || typeof originAddress !== 'object' || Array.isArray(originAddress)) return null;
  const value = (originAddress as Record<string, unknown>).address;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
export function hasUnconfirmedPublicMapLocation(record: AddressConsistencyInput): boolean {
  const reason = record.evaluation_results?.location_match_TF?.pending_reason;
  if (typeof reason !== 'string') return false;
  if (UNCONFIRMED_MAP_REASONS.has(reason)) return true;
  return record.geocoding_success === true && GEO_TRUE_UNCONFIRMED_MAP_REASONS.has(reason);
}

export function getAddressConsistencyStatus(record: AddressConsistencyInput): AddressConsistencyStatus {
  if (
    record.status === 'deleted'
    || record.status === 'not_selected'
    || record.status === 'missing'
    || record.is_not_selected === true
    || record.is_missing === true
  ) return 'not_applicable';
  if (hasUnconfirmedPublicMapLocation(record)) return 'review';
  if (record.geocoding_success === true) return 'true';
  if (record.geocoding_success === false && record.geocoding_false_stage === null) return 'failed';
  if (isAddressPromotionCandidate(record)) return 'candidate';
  if (record.geocoding_success === false && isGeocodeRecoveredReviewQueue(record)) return 'review';
  if (record.geocoding_success === false) return 'false';
  return 'unknown';
}

export function getAddressConsistencyLabel(record: AddressConsistencyInput): string {
  switch (getAddressConsistencyStatus(record)) {
    case 'true':
      return 'True';
    case 'false':
      return 'False';
    case 'failed':
      return 'Failed';
    case 'review':
      return 'Review';
    case 'candidate':
      return 'Candidate';
    case 'not_applicable':
    case 'unknown':
    default:
      return '-';
  }
}

export function getAddressConsistencyDisplayLabel(record: AddressConsistencyInput): string {
  switch (getAddressConsistencyStatus(record)) {
    case 'true':
      return '일치';
    case 'false':
      return '불일치';
    case 'failed':
      return '실패';
    case 'review':
      return '검토';
    case 'candidate':
      return '검토';
    case 'not_applicable':
    case 'unknown':
    default:
      return '-';
  }
}

function toKoreanProvider(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return PROVIDER_LABELS[provider] ?? provider;
}

function toKoreanMatchStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  return MATCH_STATUS_LABELS[status] ?? status;
}

function isMostlyKorean(value: string): boolean {
  return /[가-힣]/.test(value);
}

function toKoreanReadableMessage(value: string | null, replacementMessage: string): string | null {
  if (!value) return null;
  return isMostlyKorean(value) ? value : replacementMessage;
}

function stageReason(stage: number | null | undefined): string | null {
  if (stage === 0) return '원본 주소가 없거나 평가 미대상으로 분류되어 주소 후보 검증을 진행할 수 없었습니다.';
  if (stage === 1) return '1단계 지오코딩 검색에서 원본 상호/주소로 유효한 주소 후보를 찾지 못했습니다.';
  if (stage === 2) return '2단계 후보 검증에서 거리/주소 조건을 통과한 후보가 없어 최종 주소로 확정하지 못했습니다.';
  return null;
}

function getEvidenceSummary(locationMatch: LocationMatchResult | null): string[] {
  const summaries = Array.isArray(locationMatch?.evidence_summary)
    ? locationMatch.evidence_summary.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const families = Array.isArray(locationMatch?.evidence_families)
    ? locationMatch.evidence_families.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  const secondPass = locationMatch?.second_pass;
  const secondPassSummary = secondPass
    ? compact([
      secondPass.attempted ? '시도됨' : '시도 안 됨',
      secondPass.provider ? `공급자 ${toKoreanProvider(secondPass.provider) ?? secondPass.provider}` : null,
      secondPass.timed_out ? '시간 초과' : null,
      secondPass.rate_limited ? '호출 제한' : null,
      typeof secondPass.duration_ms === 'number' ? `${secondPass.duration_ms}ms` : null,
    ])
    : [];

  const koreanSummaries = summaries.filter(isMostlyKorean);
  const englishOnlyCount = summaries.length - koreanSummaries.length;
  const familyLabels = families.map((family) => EVIDENCE_FAMILY_LABELS[family] ?? family);

  return compact([
    ...koreanSummaries.map((summary) => `검증 근거: ${summary}`),
    englishOnlyCount > 0 ? `검증 근거: 원문 근거 ${englishOnlyCount}건은 내부 데이터에 보존되어 있습니다.` : null,
    familyLabels.length > 0 ? `증거 유형: ${familyLabels.join(', ')}` : null,
    secondPassSummary.length > 0 ? `재검증 결과: ${secondPassSummary.join(', ')}` : null,
  ]);
}

export interface AddressConsistencyExplanation {
  label: string;
  headline: string;
  reason: string;
  evidence: string[];
}

export type AddressConsistencyTriageTone = 'success' | 'neutral' | 'warning' | 'danger' | 'info';

export interface AddressConsistencyOperatorGuidance {
  label: string;
  tone: AddressConsistencyTriageTone;
  possibleCause: string;
  recommendedAction: string;
  safeguard: string;
}

export interface AddressConsistencyAhpSummary {
  score: number | null;
  label: string;
  topFailingCriterion: string;
  evidenceFamilies: string[];
  suggestedAction: string;
  hardGate: string;
}

export type AddressConsistencyTriageSignalKind =
  | 'promotion_candidate'
  | 'business_state_risk'
  | 'legacy_alias_risk'
  | 'name_conflict_risk'
  | 'duplicate_risk';

export interface AddressConsistencyTriageSignal {
  kind: AddressConsistencyTriageSignalKind;
  label: string;
  tone: AddressConsistencyTriageTone;
  message: string;
  evidence: string[];
}

const AHP_CRITERION_LABELS: Record<string, string> = {
  place_identity: '장소 동일성',
  address_coordinate: '주소·좌표 정합',
  source_video: '영상 근거 적합성',
  business_state: '영업상태 신호',
  data_lineage: '데이터 이력 위험',
  audit_readiness: '감사·복구 준비',
};

const AHP_EVIDENCE_FAMILY_LABELS: Record<string, string> = {
  ...EVIDENCE_FAMILY_LABELS,
  provider_candidate: '주소 후보',
  source_geo: '원본 주소·좌표',
};

const AHP_LABELS = new Set([
  '정정 승인 후보',
  '주소 후보 검토',
  '재수집 필요',
  '영업상태 확인',
  '원천 품질 문제',
  'AHP 미산정',
]);

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function getAhpBand(score: number): string {
  if (score >= 98) return '정정 승인 후보';
  if (score >= 90) return '주소 후보 검토';
  if (score >= 75) return '재수집 필요';
  if (score >= 50) return '영업상태 확인';
  return '원천 품질 문제';
}

function normalizeAhpScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function getReviewAhpScore(record: AddressConsistencyInput): number | null {
  return normalizeAhpScore(getAddressConsistencyReview(record)?.ahp_score);
}

function normalizeAhpLabel(value: unknown, score: number | null): string {
  if (typeof value === 'string' && AHP_LABELS.has(value.trim())) {
    return value.trim();
  }

  return score === null ? 'AHP 미산정' : getAhpBand(score);
}

function localizeAhpEvidenceFamilies(value: unknown): string[] {
  return getStringArray(value).map((family) => AHP_EVIDENCE_FAMILY_LABELS[family] ?? '기타 운영 근거');
}

function getOperatorSafeSuggestedAction(value: unknown, guidance: AddressConsistencyOperatorGuidance): string {
  if (typeof value !== 'string' || !value.trim() || !isMostlyKorean(value)) {
    return guidance.recommendedAction;
  }

  const unsafeActionPattern = /자동|삭제|승인|apply|guarded|pipeline|batch|script|overwrite/i;
  return unsafeActionPattern.test(value) ? guidance.recommendedAction : value.trim();
}

function getHardGateLabel(record: AddressConsistencyInput): string {
  if (record.status === 'deleted') return '삭제된 항목 제외';
  if (record.is_missing || record.status === 'missing') return 'Missing 항목 제외';
  if (record.is_not_selected || record.status === 'not_selected') return '평가 미대상 제외';
  if (record.updated_by_admin_id) return '관리자 수정 이력 우선';
  if (getAddressConsistencyStatus(record) === 'candidate') return '사람 확인 후 정정 승인';
  return '사람 확인 후 적용';
}

function normalizeIdentityText(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, ' ')
    .replace(/(?:^|\s)(?:구|현|전)(?:\s|$)/g, ' ')
    .replace(/[\s·・ㆍ._\-–—,，()（）\[\]{}<>《》"'`´’‘“”:：]/g, '')
    .trim();
}

function resolveOriginName(record: AddressConsistencyInput): string | null {
  return [record.origin_name, record.restaurant_name, record.name]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim() ?? null;
}

function resolveCandidateName(record: AddressConsistencyInput, locationMatch?: LocationMatchResult | null): string | null {
  return [
    record.approved_name,
    record.naver_name,
    record.google_name,
    locationMatch?.matched_name,
    locationMatch?.naver_name,
    locationMatch?.google_name,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null;
}

function hasNameCompatibility(originName: string | null, candidateName: string | null): boolean {
  const origin = normalizeIdentityText(originName);
  const candidate = normalizeIdentityText(candidateName);
  if (!origin || !candidate) return true;
  return origin === candidate
    || (origin.length >= 3 && candidate.includes(origin))
    || (candidate.length >= 3 && origin.includes(candidate));
}

function hasLegacyAliasHint(value: string | null | undefined): boolean {
  return /(?:\(|（|\[)\s*(?:구|현|전)\s*(?:\)|）|\])|(?:구|현|전)\s*상호|구상호|옛\s*상호|상호\s*변경|이전\s*상호/.test(String(value || ''));
}

function getRecordTexts(record: AddressConsistencyInput, locationMatch: LocationMatchResult | null): string[] {
  const review = getAddressConsistencyReview(record);
  return compact([
    record.youtube_meta?.title ? `영상 제목: ${record.youtube_meta.title}` : null,
    record.reasoning_basis ? `추론 근거: ${record.reasoning_basis}` : null,
    record.description_map_url ? `영상 설명 지도 URL: ${record.description_map_url}` : null,
    record.trace_id_name_source ? `이름 출처: ${record.trace_id_name_source}` : null,
    record.db_error_message ?? null,
    typeof review?.reason_ko === 'string' ? review.reason_ko : null,
    typeof locationMatch?.falseMessage === 'string' ? locationMatch.falseMessage : null,
    ...(Array.isArray(locationMatch?.evidence_summary) ? locationMatch.evidence_summary : []),
  ]);
}

function hasBusinessStateRisk(record: AddressConsistencyInput, locationMatch: LocationMatchResult | null): boolean {
  return getRecordTexts(record, locationMatch).some((text) => /폐업|휴업|영업\s*종료|이전|상호\s*변경|구상호|옛\s*상호/.test(text));
}

function hasDuplicateRisk(record: AddressConsistencyInput): boolean {
  const details = getObjectValue(record.db_error_details);
  return record.status === 'db_conflict'
    || details?.error_type === 'duplicate'
    || Boolean(details?.conflicting_restaurant)
    || (typeof details?.similarity_score === 'number' && details.similarity_score >= 0.85);
}

function getEvidenceFamilies(record: AddressConsistencyInput, locationMatch: LocationMatchResult | null): string[] {
  const reviewFamilies = getStringArray(getAddressConsistencyReview(record)?.evidence_families);
  const matchFamilies = Array.isArray(locationMatch?.evidence_families)
    ? locationMatch.evidence_families.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  return [...new Set([...reviewFamilies, ...matchFamilies])];
}

function isAddressPromotionCandidate(record: AddressConsistencyInput): boolean {
  const locationMatch = record.evaluation_results?.location_match_TF ?? null;
  if (record.geocoding_success !== false || record.geocoding_false_stage === null) return false;
  if (record.status === 'deleted' || record.status === 'missing' || record.status === 'not_selected' || record.is_missing || record.is_not_selected) return false;
  if (record.updated_by_admin_id || hasDuplicateRisk(record) || hasBusinessStateRisk(record, locationMatch)) return false;
  if (['cross_country_mismatch', 'ambiguous_chain', 'multi_candidate'].includes(locationMatch?.pending_reason ?? '')) return false;
  if (!hasNameCompatibility(resolveOriginName(record), resolveCandidateName(record, locationMatch))) return false;

  const score = getReviewAhpScore(record);
  const review = getAddressConsistencyReview(record);
  const label = normalizeAhpLabel(review?.ahp_label, score);
  const families = getEvidenceFamilies(record, locationMatch);
  const hasEnoughEvidence = families.includes('provider_candidate') && families.some((family) => family === 'source_geo' || family === 'cross_provider' || family === 'browser_verification');
  return score !== null && score >= 98 && label === '정정 승인 후보' && hasEnoughEvidence;
}

function getGuidanceForPendingReason(pendingReason: string | null): AddressConsistencyOperatorGuidance | null {
  if (pendingReason === 'multi_candidate' || pendingReason === 'ambiguous_chain') {
    return {
      label: '불일치',
      tone: 'warning',
      possibleCause: '같은 이름이거나 비슷한 체인/지점 후보가 여러 개라 자동으로 한 곳을 고르기 어렵습니다.',
      recommendedAction: '영상 근거, 원본 주소, 주소 후보의 지점명·전화번호·상세주소를 비교해 한 곳만 확정하거나 보류하세요.',
      safeguard: '확정 전에는 승인하지 말고, 선택 근거를 결정 기록에 남긴 뒤 적용 후 다시 조회합니다.',
    };
  }

  if (pendingReason === 'timeout' || pendingReason === 'rate_limited') {
    return {
      label: '불일치',
      tone: 'warning',
      possibleCause: '주소/검색 공급자 호출이 시간 초과되었거나 제한되어 검증이 끝나지 않았습니다.',
      recommendedAction: '재시도 또는 공급자 교차 확인 후 같은 결과가 반복되면 수동 검토 큐로 남겨두세요.',
      safeguard: '자동 승인하지 말고 재조회 시점과 근거를 남겨 같은 항목이 반복 처리되지 않게 합니다.',
    };
  }

  if (pendingReason === 'cross_country_mismatch') {
    return {
      label: '불일치',
      tone: 'danger',
      possibleCause: '원본 위치와 후보 위치의 국가/지역이 달라 같은 가게로 보기 어렵습니다.',
      recommendedAction: '원본 영상 설명·상호·주소를 다시 확인하고, 실제 이전/폐업/동명이점 여부를 먼저 판별하세요.',
      safeguard: '지역이 다른 후보를 그대로 승인하지 말고 수정 또는 삭제/보류 결정을 분리해 기록합니다.',
    };
  }
  return null;
}

export function getAddressConsistencyOperatorGuidance(record: AddressConsistencyInput): AddressConsistencyOperatorGuidance {
  const status = getAddressConsistencyStatus(record);
  const locationMatch = record.evaluation_results?.location_match_TF ?? null;
  const pendingReason = locationMatch?.pending_reason ?? null;
  const reviewQueueInfo = getAddressConsistencyReviewQueueInfo(record);

  if (status === 'true') {
    return {
      label: '승인 가능',
      tone: 'success',
      possibleCause: '주소 후보와 좌표가 정합 판정되어 주소 문제는 크지 않습니다.',
      recommendedAction: '다른 평가 항목까지 통과했는지 확인한 뒤 승인하세요.',
      safeguard: '승인 전 영상 근거와 카테고리 판정도 함께 확인합니다.',
    };
  }

  if (status === 'not_applicable' || status === 'unknown') {
    return {
      label: '검토 제외',
      tone: 'neutral',
      possibleCause: record.is_missing ? 'Missing 항목이라 주소 정합을 평가할 기준 가게가 없습니다.' : '주소 정합 평가값이 아직 없거나 평가 미대상입니다.',
      recommendedAction: 'Missing 등록 또는 평가 미대상 사유를 먼저 정리한 뒤 필요할 때 보류 상태로 되돌리세요.',
      safeguard: '검토 제외 항목은 주소 실패 처리량과 분리해 봅니다.',
    };
  }

  if (status === 'candidate') {
    return {
      label: '검토',
      tone: 'info',
      possibleCause: 'AHP 98점 이상과 복수 근거가 있어 정정 검토 대상으로 볼 수 있지만, 현재 원본 판정은 아직 불일치 계열입니다.',
      recommendedAction: '영상 제목·발행일, 원본명, 후보 주소, 지도 URL/추론 근거를 한 번 더 대조한 뒤 수정 승인으로 전환하세요.',
      safeguard: '자동 일치 처리하지 말고 사람이 최종 근거를 남긴 뒤 승인합니다.',
    };
  }

  if (record.updated_by_admin_id) {
    return {
      label: '수정됨',
      tone: 'info',
      possibleCause: '이미 관리자가 건드린 항목이라 자동 재분류보다 사람이 남긴 맥락이 우선입니다.',
      recommendedAction: '이전 수정 의도를 확인한 뒤 수동으로 수정·보류·삭제 중 하나를 결정하세요.',
      safeguard: '자동 재처리로 덮어쓰지 말고 결정 기록과 적용 후 재확인을 남깁니다.',
    };
  }

  const pendingReasonGuidance = getGuidanceForPendingReason(pendingReason);
  if (pendingReasonGuidance) return pendingReasonGuidance;
  if (
    status === 'review'
    && typeof pendingReason === 'string'
    && GEO_TRUE_UNCONFIRMED_MAP_REASONS.has(pendingReason)
    && hasUnconfirmedPublicMapLocation(record)
  ) {
    return {
      label: '검토',
      tone: 'warning',
      possibleCause: '좌표는 있지만 영상·자막에서 같은 가게·지점을 확정할 독립 근거가 부족합니다.',
      recommendedAction: '간판·지점명·도로명 자막을 대조하고, 네이버 첫 검색만으로 승인하지 마세요.',
      safeguard: '미확정 좌표는 공개 지도에 올리지 말고 보류 큐에 남깁니다.',
    };
  }


  if (reviewQueueInfo?.queue === ADDRESS_REVIEW_GEOCODE_RECOVERED_QUEUE) {
    return {
      label: '검토',
      tone: 'info',
      possibleCause: '주소는 어느 정도 회복됐지만 같은 상호의 주소 검색 결과가 부족합니다. 실제 영업 중인데 검색 로직이 못 찾았거나, 상호 변경·이전·폐업 가능성이 모두 남아 있습니다.',
      recommendedAction: '카카오맵/네이버 지도, 우체국 공식 주소, 최근 블로그·리뷰를 작게 교차 확인한 뒤 수정 또는 보류하세요.',
      safeguard: '한 출처만으로 확정하지 말고 최소 두 근거를 비교해 결정 기록에 남깁니다.',
    };
  }

  if (status === 'failed') {
    return {
      label: '실패',
      tone: 'danger',
      possibleCause: '주소 후보나 좌표를 만들기 전 단계에서 멈췄습니다. 원본 주소 누락, 공급자 장애, 주소 표기 오류 가능성이 큽니다.',
      recommendedAction: '원본 주소를 짧은 도로명/지번 단위로 정리해 재지오코딩하고, 후보가 없으면 보류 또는 삭제 판단으로 넘기세요.',
      safeguard: '좌표가 없는 상태에서는 사용자 지도에 노출하지 않습니다.',
    };
  }

  if (record.geocoding_false_stage === 1) {
    return {
      label: '불일치',
      tone: 'warning',
      possibleCause: '원본 상호/주소 조합으로 유효한 주소 후보를 찾지 못했습니다. 실제 폐업·이전·상호 변경 또는 검색어 정규화 실패가 가능합니다.',
      recommendedAction: '상호에서 지점/괄호/특수문자를 줄이고 주소의 시군구·건물번호를 기준으로 다시 확인하세요.',
      safeguard: '후보가 새로 나오면 바로 승인하지 말고 영상 시점과 현재 장소가 같은지 확인합니다.',
    };
  }

  if (record.geocoding_false_stage === 2) {
    return {
      label: '불일치',
      tone: 'warning',
      possibleCause: '주소 후보는 있었지만 거리·주소·상호 조건을 통과하지 못했습니다. 동명이점, 이전 매장, 지점 혼동 가능성이 큽니다.',
      recommendedAction: '후보 주소와 원본 주소를 나란히 비교하고, 같은 가게로 볼 근거가 부족하면 보류하세요.',
      safeguard: '거리/주소가 어긋나는 후보는 사용자 노출 전에 반드시 사람이 확정합니다.',
    };
  }

  return {
    label: '불일치',
    tone: 'warning',
    possibleCause: '실패 원인이 구조화되어 있지 않아 현재 UI만으로는 자동 판별이 어렵습니다.',
    recommendedAction: '상세 근거를 확인해 폐업·이전·상호변경·로직 누락 중 하나로 운영 메모를 남기세요.',
    safeguard: '분류되지 않은 항목은 일괄 승인하지 않습니다.',
  };
}

export function getAddressConsistencyTriageSignals(record: AddressConsistencyInput): AddressConsistencyTriageSignal[] {
  const locationMatch = record.evaluation_results?.location_match_TF ?? null;
  const originName = resolveOriginName(record);
  const candidateName = resolveCandidateName(record, locationMatch);
  const sourceTexts = getRecordTexts(record, locationMatch);
  const signals: AddressConsistencyTriageSignal[] = [];

  if (isAddressPromotionCandidate(record)) {
    const score = getReviewAhpScore(record);
    signals.push({
      kind: 'promotion_candidate',
      label: '검토',
      tone: 'info',
      message: '복수 근거와 AHP 점수상 정정 검토 대상입니다. 단, 자동 일치가 아니라 관리자 확인 후 수정 승인 대상입니다.',
      evidence: compact([
        score !== null ? `AHP ${score}점` : null,
        ...getEvidenceFamilies(record, locationMatch).map((family) => `근거 유형: ${AHP_EVIDENCE_FAMILY_LABELS[family] ?? family}`),
      ]).slice(0, 5),
    });
  }

  if (hasBusinessStateRisk(record, locationMatch)) {
    signals.push({
      kind: 'business_state_risk',
      label: '폐업·이전 확인',
      tone: 'warning',
      message: '수집 근거에 폐업, 이전, 상호 변경, 구상호 가능성이 있습니다. 현재 지도 후보만으로 일치 확정하면 오매칭 위험이 있습니다.',
      evidence: sourceTexts.filter((text) => /폐업|휴업|영업\s*종료|이전|상호\s*변경|구상호|옛\s*상호/.test(text)).slice(0, 3),
    });
  }

  if (hasLegacyAliasHint(originName) || hasLegacyAliasHint(record.trace_id_name_source) || hasLegacyAliasHint(record.reasoning_basis)) {
    signals.push({
      kind: 'legacy_alias_risk',
      label: '구상호·별칭 확인',
      tone: 'warning',
      message: '영상 근거가 구상호/현상호/별칭을 포함할 수 있습니다. 후보명이 달라도 같은 가게일 수 있어 별칭 근거 확인이 필요합니다.',
      evidence: compact([
        originName ? `원본명: ${originName}` : null,
        record.trace_id_name_source ? `이름 출처: ${record.trace_id_name_source}` : null,
      ]),
    });
  }

  if (originName && candidateName && !hasNameCompatibility(originName, candidateName)) {
    signals.push({
      kind: 'name_conflict_risk',
      label: '상호 충돌',
      tone: 'danger',
      message: '영상에서 추출한 상호와 지도 후보명이 호환되지 않습니다. 주소가 가까워도 다른 가게일 수 있습니다.',
      evidence: [`원본명: ${originName}`, `후보명: ${candidateName}`],
    });
  }

  if (hasDuplicateRisk(record)) {
    const details = getObjectValue(record.db_error_details);
    const conflict = getObjectValue(details?.conflicting_restaurant);
    signals.push({
      kind: 'duplicate_risk',
      label: '중복 의심',
      tone: 'warning',
      message: '같은 영상 또는 기존 맛집과 중복될 가능성이 있어 승인/수정/삭제 전 병합 여부를 먼저 봐야 합니다.',
      evidence: compact([
        typeof conflict?.name === 'string' ? `기존 후보: ${conflict.name}` : null,
        typeof conflict?.jibun_address === 'string' ? `기존 주소: ${conflict.jibun_address}` : null,
        typeof details?.similarity_score === 'number' ? `유사도: ${Math.round(details.similarity_score * 100)}%` : null,
      ]),
    });
  }

  const unique = new Map<AddressConsistencyTriageSignalKind, AddressConsistencyTriageSignal>();
  for (const signal of signals) unique.set(signal.kind, signal);
  return [...unique.values()];
}

export function getAddressConsistencyAhpSummary(record: AddressConsistencyInput): AddressConsistencyAhpSummary {
  const review = getAddressConsistencyReview(record);
  const score = normalizeAhpScore(review?.ahp_score);
  const label = normalizeAhpLabel(review?.ahp_label, score);
  const rawCriterion = typeof review?.top_failing_criterion === 'string' ? review.top_failing_criterion : null;
  const guidance = getAddressConsistencyOperatorGuidance(record);

  return {
    score,
    label,
    topFailingCriterion: rawCriterion ? AHP_CRITERION_LABELS[rawCriterion] ?? '기타 운영 기준' : '장소 동일성·주소·영업상태를 우선 확인',
    evidenceFamilies: localizeAhpEvidenceFamilies(review?.evidence_families),
    suggestedAction: getOperatorSafeSuggestedAction(review?.suggested_action, guidance),
    hardGate: getHardGateLabel(record),
  };
}

export function canApproveAddressConsistencyRecord(record: AddressConsistencyInput): boolean {
  return getAddressConsistencyStatus(record) === 'true' && record.status !== 'approved' && record.status !== 'deleted';
}

export function explainAddressConsistency(record: AddressConsistencyInput): AddressConsistencyExplanation {
  const locationMatch = record.evaluation_results?.location_match_TF ?? null;
  const label = getAddressConsistencyDisplayLabel(record);
  const status = getAddressConsistencyStatus(record);
  const originAddress = getOriginAddressText(record.origin_address);
  const originName = resolveOriginName(record);
  const candidateName = resolveCandidateName(record, locationMatch);
  const candidateAddress = locationMatch?.matched_address?.roadAddress || locationMatch?.matched_address?.jibunAddress || record.road_address || record.jibun_address || null;
  const pendingReason = locationMatch?.pending_reason ? PENDING_REASON_LABELS[locationMatch.pending_reason] ?? locationMatch.pending_reason : null;
  const rawFalseMessage = typeof locationMatch?.falseMessage === 'string' && locationMatch.falseMessage.trim().length > 0
    ? locationMatch.falseMessage.trim()
    : null;
  const falseMessage = toKoreanReadableMessage(rawFalseMessage, '규칙 판정 원문은 내부 데이터에 보존되어 있습니다.');
  const dbErrorMessage = toKoreanReadableMessage(record.db_error_message ?? null, '시스템 오류 원문은 내부 데이터에 보존되어 있습니다.');
  const reviewQueueInfo = getAddressConsistencyReviewQueueInfo(record);
  const stage = stageReason(record.geocoding_false_stage);
  const evidenceSummary = getEvidenceSummary(locationMatch);
  const sourceEvidence = compact([
    record.youtube_meta?.title ? `영상 제목: ${record.youtube_meta.title}` : null,
    record.youtube_meta?.publishedAt ? `영상 게시일: ${record.youtube_meta.publishedAt}` : null,
    record.trace_id_name_source ? `이름 출처: ${record.trace_id_name_source}` : null,
    record.description_map_url ? `영상 설명 지도 URL: ${record.description_map_url}` : null,
    record.reasoning_basis ? `추론 근거: ${record.reasoning_basis.slice(0, 160)}${record.reasoning_basis.length > 160 ? '…' : ''}` : null,
    originName ? `원본명: ${originName}` : null,
  ]);

  if (status === 'true') {
    return {
      label,
      headline: '일치 · 주소 후보가 정합 판정되었습니다.',
      reason: '지오코딩 결과가 승인 가능한 주소와 좌표로 확정되었습니다.',
      evidence: compact([
        candidateName ? `확정 후보: ${candidateName}` : null,
        candidateAddress ? `확정 주소: ${candidateAddress}` : null,
        originAddress ? `원본 주소: ${originAddress}` : null,
        ...sourceEvidence,
        ...evidenceSummary,
      ]),
    };
  }

  if (status === 'failed') {
    return {
      label,
      headline: '실패 · 지오코딩 자체가 완료되지 않았습니다.',
      reason: dbErrorMessage
        ? `시스템/DB 오류로 주소 후보를 만들지 못했습니다: ${dbErrorMessage}`
        : '주소 검색 후보, 좌표, 도로명/지번 주소가 생성되지 않아 정합성 비교 단계까지 도달하지 못했습니다.',
      evidence: compact([
        falseMessage ? `규칙 판정: ${falseMessage}` : null,
        pendingReason ? `보류 사유: ${pendingReason}` : null,
        originAddress ? `원본 주소: ${originAddress}` : '원본 주소: 없음',
        ...sourceEvidence,
        ...evidenceSummary,
      ]),
    };
  }

  if (status === 'candidate') {
    const score = getReviewAhpScore(record);
    return {
      label,
      headline: '검토 · 복수 근거가 강하지만 자동 일치 처리하지 않고 관리자 확인이 필요합니다.',
      reason: score !== null
        ? `AHP ${score}점으로 정정 검토 대상이나, 원본 판정이 불일치 계열이라 영상·상호·주소 근거를 최종 대조해야 합니다.`
        : '정정 검토 대상이나, 원본 판정이 불일치 계열이라 영상·상호·주소 근거를 최종 대조해야 합니다.',
      evidence: compact([
        reviewQueueInfo ? `운영 큐: ${reviewQueueInfo.label} · ${reviewQueueInfo.reason}` : null,
        falseMessage ? `규칙 판정: ${falseMessage}` : null,
        originAddress ? `원본 주소: ${originAddress}` : null,
        candidateName ? `검토 후보: ${candidateName}` : null,
        candidateAddress ? `검토 주소: ${candidateAddress}` : null,
        ...sourceEvidence,
        ...evidenceSummary,
      ]),
    };
  }

  if (status === 'review') {
    const unconfirmedReason = typeof locationMatch?.pending_reason === 'string' ? locationMatch.pending_reason : null;
    const isUnconfirmedPublicPin = hasUnconfirmedPublicMapLocation(record);
    const isGeoTrueInsufficientEvidence = isUnconfirmedPublicPin
      && unconfirmedReason !== null
      && GEO_TRUE_UNCONFIRMED_MAP_REASONS.has(unconfirmedReason);
    const isUnconfirmedChain = isUnconfirmedPublicPin && unconfirmedReason !== null && UNCONFIRMED_MAP_REASONS.has(unconfirmedReason);

    if (isGeoTrueInsufficientEvidence) {
      return {
        label,
        headline: '검토 · 좌표는 있지만 영상에서 같은 가게로 확정할 근거가 부족합니다.',
        reason: pendingReason || '주소 후보는 있어도 간판·지점명·도로명 자막이 없어 공개 지도에 올릴 수 없습니다.',
        evidence: compact([
          reviewQueueInfo ? `운영 큐: ${reviewQueueInfo.label} · ${reviewQueueInfo.reason}` : null,
          falseMessage ? `규칙 판정: ${falseMessage}` : null,
          originAddress ? `원본 주소: ${originAddress}` : null,
          candidateName ? `검토 후보: ${candidateName}` : null,
          candidateAddress ? `검토 주소: ${candidateAddress}` : null,
          locationMatch?.match_status ? `매칭 상태: ${toKoreanMatchStatus(locationMatch.match_status) ?? locationMatch.match_status}` : null,
          ...sourceEvidence,
          ...evidenceSummary,
        ]),
      };
    }

    if (isUnconfirmedChain) {
      return {
        label,
        headline: '검토 · 체인/복수 후보라 지점을 확정할 수 없습니다.',
        reason: pendingReason || '동일·유사 상호 후보가 여러 곳이라 네이버 첫 검색만으로 공개 지도에 올릴 수 없습니다.',
        evidence: compact([
          reviewQueueInfo ? `운영 큐: ${reviewQueueInfo.label} · ${reviewQueueInfo.reason}` : null,
          falseMessage ? `규칙 판정: ${falseMessage}` : null,
          originAddress ? `원본 주소: ${originAddress}` : null,
          candidateName ? `검토 후보: ${candidateName}` : null,
          candidateAddress ? `검토 주소: ${candidateAddress}` : null,
          locationMatch?.match_status ? `매칭 상태: ${toKoreanMatchStatus(locationMatch.match_status) ?? locationMatch.match_status}` : null,
          ...sourceEvidence,
          ...evidenceSummary,
        ]),
      };
    }

    return {
      label,
      headline: '검토 · 주소 후보는 회복됐지만 같은 가게로 확정할 상호 근거가 부족합니다.',
      reason: reviewQueueInfo?.reason || pendingReason || '주소 지오코딩은 회복됐지만 지도 상호 후보가 부족해 관리자 확인이 필요합니다.',
      evidence: compact([
        reviewQueueInfo ? `운영 큐: ${reviewQueueInfo.label} · ${reviewQueueInfo.reason}` : null,
        falseMessage ? `규칙 판정: ${falseMessage}` : null,
        originAddress ? `원본 주소: ${originAddress}` : null,
        candidateName ? `검토 후보: ${candidateName}` : null,
        candidateAddress ? `검토 주소: ${candidateAddress}` : null,
        locationMatch?.match_status ? `매칭 상태: ${toKoreanMatchStatus(locationMatch.match_status) ?? locationMatch.match_status}` : null,
        ...sourceEvidence,
        ...evidenceSummary,
      ]),
    };
  }

  if (status === 'false') {
    return {
      label,
      headline: `불일치 · ${stage ?? '주소 후보를 최종 확정하지 못했습니다.'}`,
      reason: falseMessage || pendingReason || stage || '지오코딩은 시도됐지만 주소 매칭 실패 사유가 구조화되어 있지 않습니다.',
      evidence: compact([
        reviewQueueInfo ? `운영 큐: ${reviewQueueInfo.label} · ${reviewQueueInfo.reason}` : null,
        originAddress ? `원본 주소: ${originAddress}` : null,
        candidateName ? `검토 후보: ${candidateName}` : null,
        candidateAddress ? `검토 주소: ${candidateAddress}` : null,
        locationMatch?.match_status ? `매칭 상태: ${toKoreanMatchStatus(locationMatch.match_status) ?? locationMatch.match_status}` : null,
        ...sourceEvidence,
        ...evidenceSummary,
      ]),
    };
  }

  return {
    label,
    headline: '주소 정합성 평가 대상이 아닙니다.',
    reason: record.is_missing ? 'Missing 레코드라 주소 정합성을 평가할 수 없습니다.' : '평가 미대상 또는 주소 정합성 값이 아직 없습니다.',
    evidence: compact([originAddress ? `원본 주소: ${originAddress}` : null]),
  };
}

export function getAddressConsistencyBadgeClass(record: Pick<EvaluationRecord, 'geocoding_success' | 'geocoding_false_stage' | 'status' | 'is_not_selected'>): string {
  switch (getAddressConsistencyStatus(record)) {
    case 'true':
      return 'bg-green-600';
    case 'failed':
      return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
    case 'review':
      return 'bg-blue-100 text-blue-800 border border-blue-200';
    case 'candidate':
      return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
    case 'false':
      return 'bg-red-500';
    default:
      return 'bg-slate-500';
  }
}
