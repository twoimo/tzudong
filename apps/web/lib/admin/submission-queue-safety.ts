import {
  validateRestaurantSubmission,
  validateRestaurantSubmissionStep,
  type RestaurantSubmissionFormData,
  type RestaurantSubmissionMode,
} from '@/lib/restaurant-submission-flow';

export type AdminSubmissionQueueReasonCode =
  | 'missing-required'
  | 'invalid-youtube'
  | 'junk-text'
  | 'no-pending-items'
  | 'duplicate-candidate'
  | 'shared-validation';

export type AdminSubmissionQueueReasonFilter =
  | 'all'
  | 'needs-review'
  | AdminSubmissionQueueReasonCode;

export type AdminSubmissionQueueReasonSeverity = 'danger' | 'warning' | 'info';

export interface AdminSubmissionQueueReason {
  code: AdminSubmissionQueueReasonCode;
  label: string;
  message: string;
  severity: AdminSubmissionQueueReasonSeverity;
}

export interface AdminSubmissionQueueFilterOption {
  value: AdminSubmissionQueueReasonFilter;
  label: string;
}

export interface AdminSubmissionQueueItemInput {
  youtube_link?: string | null;
  tzuyang_review?: string | null;
  item_status?: string | null;
  duplicate_check_result?: {
    isDuplicate?: boolean | null;
    existingRestaurantName?: string | null;
    matchedYoutubeUrl?: string | null;
  } | null;
}

export interface AdminSubmissionQueueSubmissionInput {
  submission_type: 'new' | 'edit' | 'recommend';
  status?: string | null;
  restaurant_name?: string | null;
  restaurant_address?: string | null;
  restaurant_phone?: string | null;
  restaurant_categories?: string[] | null;
  recommendation_reason?: string | null;
  admin_notes?: string | null;
  rejection_reason?: string | null;
  items?: AdminSubmissionQueueItemInput[] | null;
}

export interface AdminSubmissionQueueSafetySummary {
  mode: RestaurantSubmissionMode | 'edit';
  formData: RestaurantSubmissionFormData;
  validationMessage: string | null;
  reasons: AdminSubmissionQueueReason[];
  filterCodes: AdminSubmissionQueueReasonFilter[];
}

export const ADMIN_SUBMISSION_QUEUE_REASON_FILTERS: AdminSubmissionQueueFilterOption[] = [
  { value: 'all', label: '전체' },
  { value: 'needs-review', label: '검수 필요' },
  { value: 'missing-required', label: '필수 누락' },
  { value: 'invalid-youtube', label: '영상 링크' },
  { value: 'junk-text', label: '무의미 입력' },
  { value: 'duplicate-candidate', label: '중복 후보' },
  { value: 'shared-validation', label: '공통 검증' },
  { value: 'no-pending-items', label: '대기 항목 없음' },
];

function trim(value: string | null | undefined) {
  return value?.trim() ?? '';
}

function uniqueReasons(reasons: AdminSubmissionQueueReason[]) {
  const seen = new Set<AdminSubmissionQueueReasonCode>();
  return reasons.filter((reason) => {
    if (seen.has(reason.code)) return false;
    seen.add(reason.code);
    return true;
  });
}

function getPrimaryQueueItem(items: AdminSubmissionQueueItemInput[]) {
  return items.find((item) => item.item_status === 'pending') ?? items[0] ?? null;
}

function buildQueueFormData(submission: AdminSubmissionQueueSubmissionInput): RestaurantSubmissionFormData {
  const items = Array.isArray(submission.items) ? submission.items : [];
  const primaryItem = getPrimaryQueueItem(items);

  return {
    restaurant_name: trim(submission.restaurant_name),
    address: trim(submission.restaurant_address),
    phone: trim(submission.restaurant_phone),
    categories: Array.isArray(submission.restaurant_categories)
      ? submission.restaurant_categories.filter((category): category is string => typeof category === 'string')
      : [],
    youtube_link: trim(primaryItem?.youtube_link),
    description: trim(submission.recommendation_reason) || trim(primaryItem?.tzuyang_review) || trim(submission.admin_notes),
  };
}

function getSharedValidationMode(submissionType: AdminSubmissionQueueSubmissionInput['submission_type']): RestaurantSubmissionMode | 'edit' {
  if (submissionType === 'recommend') return 'request';
  if (submissionType === 'edit') return 'edit';
  return 'new';
}

function getValidationMessage(mode: RestaurantSubmissionMode | 'edit', formData: RestaurantSubmissionFormData) {
  if (mode === 'edit') {
    return validateRestaurantSubmissionStep(1, 'request', formData);
  }

  return validateRestaurantSubmission(mode, formData);
}

function buildSharedValidationReason(message: string): AdminSubmissionQueueReason {
  if (message.includes('유튜브')) {
    return {
      code: 'invalid-youtube',
      label: '영상 링크',
      message,
      severity: 'danger',
    };
  }

  if (message.includes('추천 이유')) {
    return {
      code: 'junk-text',
      label: '무의미 입력',
      message,
      severity: 'warning',
    };
  }

  if (message.includes('맛집 이름') || message.includes('주소') || message.includes('카테고리')) {
    return {
      code: 'missing-required',
      label: '필수 누락',
      message,
      severity: 'danger',
    };
  }

  return {
    code: 'shared-validation',
    label: '공통 검증',
    message,
    severity: 'warning',
  };
}

function buildNoPendingItemsReason(): AdminSubmissionQueueReason {
  return {
    code: 'no-pending-items',
    label: '대기 항목 없음',
    message: '대기 중인 제보 항목이 없어 승인 큐에서 확인이 필요합니다.',
    severity: 'warning',
  };
}

function buildDuplicateReason(item: AdminSubmissionQueueItemInput): AdminSubmissionQueueReason {
  const existingName = trim(item.duplicate_check_result?.existingRestaurantName);
  const matchedYoutubeUrl = trim(item.duplicate_check_result?.matchedYoutubeUrl);
  const evidence = existingName || matchedYoutubeUrl;

  return {
    code: 'duplicate-candidate',
    label: '중복 후보',
    message: evidence
      ? `기존 등록 후보와 중복될 수 있습니다: ${evidence}`
      : '기존 등록 후보와 중복될 수 있습니다.',
    severity: 'info',
  };
}

function getItemsForSharedValidation(items: AdminSubmissionQueueItemInput[]) {
  const pendingItems = items.filter((item) => item.item_status === 'pending');
  return pendingItems.length > 0 ? pendingItems : items;
}

function buildItemValidationReasons(
  mode: RestaurantSubmissionMode | 'edit',
  formData: RestaurantSubmissionFormData,
  items: AdminSubmissionQueueItemInput[],
) {
  const relevantItems = getItemsForSharedValidation(items);
  const itemReasons: AdminSubmissionQueueReason[] = [];

  if (mode === 'new' || mode === 'edit') {
    for (const item of relevantItems) {
      const youtubeValidationMessage = validateRestaurantSubmissionStep(2, 'new', {
        ...formData,
        youtube_link: trim(item.youtube_link),
      });
      if (youtubeValidationMessage) {
        itemReasons.push(buildSharedValidationReason(youtubeValidationMessage));
      }
    }
  }

  if (mode === 'request' || mode === 'edit') {
    for (const item of relevantItems) {
      const itemDescription = trim(item.tzuyang_review);
      const descriptionValidationMessage = validateRestaurantSubmissionStep(2, 'request', {
        ...formData,
        description: itemDescription || formData.description,
      });
      if (descriptionValidationMessage) {
        itemReasons.push(buildSharedValidationReason(descriptionValidationMessage));
      }
    }
  }

  return itemReasons;
}
export function getAdminSubmissionQueueSafetySummary(
  submission: AdminSubmissionQueueSubmissionInput,
): AdminSubmissionQueueSafetySummary {
  const items = Array.isArray(submission.items) ? submission.items : [];
  const mode = getSharedValidationMode(submission.submission_type);
  const formData = buildQueueFormData(submission);
  const validationMessage = getValidationMessage(mode, formData);
  const reasons: AdminSubmissionQueueReason[] = [];

  if (validationMessage) {
    reasons.push(buildSharedValidationReason(validationMessage));
  }
  reasons.push(...buildItemValidationReasons(mode, formData, items));



  const isPendingQueueItem = submission.status === 'pending' || submission.status === 'partially_approved';
  const pendingItems = items.filter((item) => item.item_status === 'pending');
  if (isPendingQueueItem && pendingItems.length === 0) {
    reasons.push(buildNoPendingItemsReason());
  }

  const duplicateItem = items.find((item) => item.duplicate_check_result?.isDuplicate === true);
  if (duplicateItem) {
    reasons.push(buildDuplicateReason(duplicateItem));
  }

  const unique = uniqueReasons(reasons);
  const filterCodes: AdminSubmissionQueueReasonFilter[] = unique.length > 0
    ? ['needs-review', ...unique.map((reason) => reason.code)]
    : [];

  return {
    mode,
    formData,
    validationMessage,
    reasons: unique,
    filterCodes,
  };
}

export function adminSubmissionQueueSummaryMatchesFilter(
  summary: AdminSubmissionQueueSafetySummary,
  filter: AdminSubmissionQueueReasonFilter,
) {
  if (filter === 'all') return true;
  return summary.filterCodes.includes(filter);
}
