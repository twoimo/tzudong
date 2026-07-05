export type SubmissionApprovalRequestState = 'pending' | 'approved' | 'partially_approved' | 'rejected';
export type SubmissionApprovalType = 'new' | 'edit' | 'recommend';

export interface SubmissionApprovalItemDecisionInput {
  approved: boolean;
  metaFetched?: boolean;
  metaData?: unknown | null;
}

export interface SubmissionApprovalItemInput {
  id: string;
  item_status: 'pending' | 'approved' | 'rejected';
}

export interface SubmissionApprovalGeocodeResultInput {
  road_address?: string | null;
  jibun_address?: string | null;
  x?: string | null;
  y?: string | null;
}

export interface SubmissionApprovalDataInput {
  lat?: string | null;
  lng?: string | null;
  road_address?: string | null;
  jibun_address?: string | null;
}

export interface SubmissionApprovalLocalSearchEvidenceInput {
  title?: string | null;
  address?: string | null;
  roadAddress?: string | null;
  isMatch?: boolean;
}

export interface SubmissionApprovalStateInput {
  requestState?: SubmissionApprovalRequestState | null;
  submissionType?: SubmissionApprovalType | null;
  forceApprove?: boolean;
  editableName?: string | null;
  editableAddress?: string | null;
  selectedGeocodingIndex?: number | null;
  geocodingResults?: SubmissionApprovalGeocodeResultInput[];
  approvalData?: SubmissionApprovalDataInput | null;
  localSearchEvidence?: SubmissionApprovalLocalSearchEvidenceInput[];
  itemDecisions?: Record<string, SubmissionApprovalItemDecisionInput>;
  items?: SubmissionApprovalItemInput[];
  youtubeMetadataReady?: boolean;
  recommendationApprovalConfirmed?: boolean;
}

export interface SubmissionApprovalState {
  canApprove: boolean;
  blockers: string[];
  nextAction: string;
  auditHints: string[];
}

const PENDING_STATES = new Set<SubmissionApprovalRequestState>(['pending', 'partially_approved']);

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasApprovalCoordinates(approvalData: SubmissionApprovalDataInput | null | undefined): boolean {
  return Boolean(
    hasText(approvalData?.lat) &&
    hasText(approvalData?.lng) &&
    hasText(approvalData?.road_address),
  );
}

function hasSelectedGeocodeResult(input: SubmissionApprovalStateInput): boolean {
  const selectedIndex = input.selectedGeocodingIndex;
  if (selectedIndex === null || selectedIndex === undefined || selectedIndex < 0) return false;
  const selectedResult = input.geocodingResults?.[selectedIndex];
  return Boolean(
    selectedResult &&
    hasText(selectedResult.road_address) &&
    hasText(selectedResult.x) &&
    hasText(selectedResult.y),
  );
}

function hasLocalSearchMatch(input: SubmissionApprovalStateInput): boolean {
  return Boolean(input.localSearchEvidence?.some((result) => result.isMatch === true));
}

function getApprovedDecisionEntries(input: SubmissionApprovalStateInput): Array<[string, SubmissionApprovalItemDecisionInput]> {
  return Object.entries(input.itemDecisions ?? {}).filter(([, decision]) => decision.approved);
}

function hasPendingItems(input: SubmissionApprovalStateInput): boolean {
  return Boolean(input.items?.some((item) => item.item_status === 'pending'));
}

function hasSelectedPendingApprovedItem(input: SubmissionApprovalStateInput): boolean {
  const pendingItemIds = new Set((input.items ?? [])
    .filter((item) => item.item_status === 'pending')
    .map((item) => item.id));
  return pendingItemIds.size > 0 && getApprovedDecisionEntries(input).some(([itemId]) => pendingItemIds.has(itemId));
}

function approvedItemsHaveMetadata(input: SubmissionApprovalStateInput): boolean {
  if (input.youtubeMetadataReady === true) return true;
  const approvedDecisionEntries = getApprovedDecisionEntries(input);
  return approvedDecisionEntries.length > 0 && approvedDecisionEntries.every(([, decision]) => (
    decision.metaFetched === true || Boolean(decision.metaData)
  ));
}

function firstActionFor(blockers: string[]): string {
  if (blockers.length === 0) return '승인할 수 있습니다.';
  if (blockers.includes('대기 중인 제보만 승인할 수 있습니다.')) return '대기 상태의 제보를 선택하세요.';
  if (blockers.includes('추천 승인 확인 문구가 필요합니다.')) return '추천승인 확인 문구를 입력하세요.';
  if (blockers.includes('맛집명을 입력해야 합니다.')) return '맛집명을 입력하세요.';
  if (blockers.includes('주소를 입력해야 합니다.')) return '주소를 입력하세요.';
  if (blockers.includes('지오코딩 결과를 선택해야 합니다.')) return '지오코딩을 실행하고 주소 후보를 선택하세요.';
  if (blockers.includes('선택한 지오코딩 결과의 승인 좌표가 필요합니다.')) return '선택한 주소 후보를 다시 적용하세요.';
  if (blockers.includes('승인할 대기 항목이 없습니다.')) return '대기 중인 항목이 있는 제보를 선택하세요.';
  if (blockers.includes('승인할 항목을 하나 이상 선택해야 합니다.')) return '승인할 항목을 하나 이상 선택하세요.';
  if (blockers.includes('승인 항목의 YouTube 메타데이터가 필요합니다.')) return '선택한 항목의 YouTube 메타데이터를 가져오세요.';
  if (blockers.includes('네이버 로컬 검색 일치 증거가 필요합니다.')) return '네이버 검색 검증을 실행하고 일치 결과를 확보하세요.';
  return blockers[0];
}

export function getSubmissionApprovalState(input: SubmissionApprovalStateInput): SubmissionApprovalState {
  const blockers: string[] = [];
  const auditHints: string[] = [];
  const forceApprove = input.forceApprove === true;
  const submissionType = input.submissionType;

  if (!input.requestState || !PENDING_STATES.has(input.requestState)) {
    blockers.push('대기 중인 제보만 승인할 수 있습니다.');
  }

  if (submissionType === 'recommend') {
    if (input.recommendationApprovalConfirmed !== true) {
      blockers.push('추천 승인 확인 문구가 필요합니다.');
    }
    return {
      canApprove: blockers.length === 0,
      blockers,
      nextAction: firstActionFor(blockers),
      auditHints,
    };
  }

  if (!hasText(input.editableName)) {
    blockers.push('맛집명을 입력해야 합니다.');
  }

  if (!hasText(input.editableAddress)) {
    blockers.push('주소를 입력해야 합니다.');
  }

  if (!hasSelectedGeocodeResult(input)) {
    blockers.push('지오코딩 결과를 선택해야 합니다.');
  }

  if (!hasApprovalCoordinates(input.approvalData)) {
    blockers.push('선택한 지오코딩 결과의 승인 좌표가 필요합니다.');
  }

  if (!hasPendingItems(input)) {
    blockers.push('승인할 대기 항목이 없습니다.');
  } else if (!hasSelectedPendingApprovedItem(input)) {
    blockers.push('승인할 항목을 하나 이상 선택해야 합니다.');
  }

  if (hasSelectedPendingApprovedItem(input) && !approvedItemsHaveMetadata(input)) {
    blockers.push('승인 항목의 YouTube 메타데이터가 필요합니다.');
  }

  if (!hasLocalSearchMatch(input)) {
    if (forceApprove) {
      auditHints.push('무시승인: 네이버 로컬 검색 일치 증거 없이 관리자 확인으로 승인합니다.');
    } else {
      blockers.push('네이버 로컬 검색 일치 증거가 필요합니다.');
    }
  }

  return {
    canApprove: blockers.length === 0,
    blockers,
    nextAction: firstActionFor(blockers),
    auditHints,
  };
}
