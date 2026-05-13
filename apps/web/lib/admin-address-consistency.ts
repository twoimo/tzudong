import type { EvaluationRecord, LocationMatchResult } from '@/types/evaluation';

export type AddressConsistencyStatus = 'true' | 'false' | 'failed' | 'not_applicable' | 'unknown';

interface AddressConsistencyInput {
  geocoding_success?: boolean | null;
  geocoding_false_stage?: number | null;
  status?: string | null;
  is_not_selected?: boolean | null;
  is_missing?: boolean | null;
  db_error_message?: string | null;
  db_error_details?: unknown;
  origin_address?: unknown;
  road_address?: string | null;
  jibun_address?: string | null;
  naver_name?: string | null;
  google_name?: string | null;
  evaluation_results?: {
    location_match_TF?: LocationMatchResult | null;
  } | null;
}

const PENDING_REASON_LABELS: Record<string, string> = {
  insufficient_evidence: '후보를 확정할 독립 근거가 부족합니다.',
  cross_country_mismatch: '원본 위치와 후보 위치의 국가/지역이 서로 맞지 않습니다.',
  ambiguous_chain: '동일/유사 상호 체인점이 여러 개라 지점을 확정할 수 없습니다.',
  multi_candidate: '복수 후보가 남아 단일 주소로 확정할 수 없습니다.',
  timeout: '2차 검증이 제한 시간 안에 완료되지 않았습니다.',
  rate_limited: '외부 지도/검색 공급자 호출 제한으로 검증이 중단되었습니다.',
};

const EVIDENCE_FAMILY_LABELS: Record<string, string> = {
  provider_candidate: '지도 후보 검색 결과',
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

export interface AddressConsistencyReviewQueueInfo {
  queue: string;
  label: string;
  reason: string;
}


function getObjectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function getAddressConsistencyReviewQueueInfo(record: Pick<AddressConsistencyInput, 'db_error_details'>): AddressConsistencyReviewQueueInfo | null {
  const details = getObjectValue(record.db_error_details);
  const review = getObjectValue(details?.address_consistency_review);
  const queue = typeof review?.queue === 'string' ? review.queue : null;
  if (!queue) return null;

  if (queue === ADDRESS_REVIEW_GEOCODE_RECOVERED_QUEUE) {
    return {
      queue,
      label: '지도후보 부족',
      reason: typeof review?.reason_ko === 'string'
        ? review.reason_ko
        : '주소 지오코딩은 회복됐지만 지도 상호 후보가 부족해 관리자 확인이 필요합니다.',
    };
  }

  return {
    queue,
    label: '주소 검토',
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

export function getAddressConsistencyStatus(record: AddressConsistencyInput): AddressConsistencyStatus {
  if (record.status === 'not_selected' || record.status === 'missing' || record.is_not_selected === true || record.is_missing === true) return 'not_applicable';
  if (record.geocoding_success === true) return 'true';
  if (record.geocoding_success === false && record.geocoding_false_stage === null) return 'failed';
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
    case 'not_applicable':
    case 'unknown':
    default:
      return '-';
  }
}

function getAddressConsistencyKoreanLabel(record: AddressConsistencyInput): string {
  switch (getAddressConsistencyStatus(record)) {
    case 'true':
      return '정상';
    case 'false':
      return '불일치';
    case 'failed':
      return '실패';
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

function toKoreanReadableMessage(value: string | null, fallback: string): string | null {
  if (!value) return null;
  return isMostlyKorean(value) ? value : fallback;
}

function stageReason(stage: number | null | undefined): string | null {
  if (stage === 0) return '원본 주소가 없거나 평가 미대상으로 분류되어 주소 후보 검증을 진행할 수 없었습니다.';
  if (stage === 1) return '1단계 지오코딩 검색에서 원본 상호/주소로 유효한 지도 후보를 찾지 못했습니다.';
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

export function explainAddressConsistency(record: AddressConsistencyInput): AddressConsistencyExplanation {
  const locationMatch = record.evaluation_results?.location_match_TF ?? null;
  const label = getAddressConsistencyKoreanLabel(record);
  const status = getAddressConsistencyStatus(record);
  const originAddress = getOriginAddressText(record.origin_address);
  const candidateName = record.naver_name || record.google_name || locationMatch?.matched_name || locationMatch?.naver_name || locationMatch?.google_name || null;
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

  if (status === 'true') {
    return {
      label,
      headline: '정상 · 주소 후보가 정합 판정되었습니다.',
      reason: '지오코딩 결과가 승인 가능한 주소와 좌표로 확정되었습니다.',
      evidence: compact([
        candidateName ? `확정 후보: ${candidateName}` : null,
        candidateAddress ? `확정 주소: ${candidateAddress}` : null,
        originAddress ? `원본 주소: ${originAddress}` : null,
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
    case 'false':
      return 'bg-red-500';
    default:
      return 'bg-slate-500';
  }
}
