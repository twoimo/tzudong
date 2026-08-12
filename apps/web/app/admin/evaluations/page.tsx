"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord, EvaluationRecordStatus, CategoryStats } from '@/types/evaluation';
import { extractVideoIdFromYoutubeLink } from '../../../lib/dashboard/helpers';
import { getLocationMatchFalseMessage, hasLaajMetrics, hasRuleMetrics, toNotSelectionReason } from '../../../lib/dashboard/classifiers';
import { CategorySidebar } from '@/components/admin/CategorySidebar';
import { EvaluationTable } from '@/components/admin/EvaluationTableNew';
import { MissingRestaurantForm } from '@/components/admin/MissingRestaurantForm';
import { DbConflictResolutionPanel } from '@/components/admin/DbConflictResolutionPanel';
import { EditRestaurantModal } from '@/components/admin/EditRestaurantModal';
import { EvaluationSlideView } from '@/components/admin/EvaluationSlideView';
import { SubmissionListView, Review } from '@/components/admin/SubmissionListView';
import { SubmissionRecord, ApprovalData, SubmissionItem, ItemDecision } from '@/components/admin/SubmissionDetailView';
import { sanitizePrimaryStatusFilterValue } from '@/components/admin/evaluation-status-filter-options';
import {
  createNewRestaurantNotification,
  createSubmissionApprovedNotification,
  createSubmissionRejectedNotification,
  createReviewApprovedNotification,
  createReviewRejectedNotification
} from '@/contexts/NotificationContext';
import { ClipboardCheck, Loader2, LayoutList, MonitorPlay, RotateCcw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
import { getAdminEvaluationApprovalName, getAdminEvaluationDisplayName } from '@/lib/admin-evaluation-name';
import { getAddressConsistencyStatus } from '@/lib/admin-address-consistency';
import { needsEvaluationRerun } from '@/lib/admin-evaluation-completeness';
import { buildCanonicalAdminEvaluationsHref, type AdminConsoleRouteModuleId } from '@/lib/admin/admin-module-routing';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import {
  isAdminEvaluationRecordMissing,
  isAdminEvaluationRecordNotSelected,
  isAdminEvaluationRecordReadyForApproval,
} from '@/lib/admin/evaluation-records';
import {
  ADMIN_PENDING_COUNTS_QUERY_KEY as ADMIN_SHARED_PENDING_COUNTS_QUERY_KEY,
  buildAdminPendingCountsResponse,
  getAdminPendingCountsTotal,
  normalizeAdminPendingCountsResponse,
  type AdminPendingCountsResponse,
} from '@/lib/admin/pending-counts';
import {
  MISSING_EVALUATION_AUTO_DELETE_MESSAGE,
  getMissingEvaluationAutoDeleteReason,
  shouldAutoDeleteMissingEvaluationRecord,
} from '@/lib/admin-auto-delete-missing-evaluation';
import {
  findSameVideoDuplicateWarningCandidates,
  formatSameVideoDuplicateWarning,
} from '@/lib/admin-same-video-duplicate-warning';
import {
  findRestaurantIdentityWarnings,
  formatRestaurantIdentityWarning,
  hasBlockingRestaurantIdentityWarning,
} from '@/lib/admin-restaurant-identity-warning';
import { invalidateRestaurantDiscoveryQueries } from '@/lib/restaurant-discovery-cache';
import {
  assertLegacyBrowserAdminMutationEnabled,
  isLegacyBrowserAdminMutationEnabled,
} from '@/lib/admin/guarded-mutation-contract';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ADMIN_MODAL_ACTION,
  ADMIN_MODAL_CONTENT_SM,
  ADMIN_MODAL_FOOTER,
  ADMIN_MODAL_SCROLL_BODY,
} from '@/components/admin/admin-modal-styles';

const PAGE_SIZE = 10; // 한 번에 로드할 레코드 수
const STORAGE_KEY = 'adminEvaluationPageState'; // localStorage 키
const EMPTY_SEARCH_PARAMS = new URLSearchParams();
const ADMIN_PENDING_COUNTS_QUERY_KEY = ['admin-pending-counts', 'evaluations'] as const;
const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = 'tzudong:e2e-admin-shell-bypass';

function isLocalE2EAdminShellBypassHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function hasLocalE2EAdminShellBypass() {
  if (typeof window === 'undefined') return false;
  if (!isLocalE2EAdminShellBypassHost(window.location.hostname)) return false;

  try {
    return window.localStorage.getItem(E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}


async function fetchAdminEvaluationPendingCounts(): Promise<AdminPendingCountsResponse> {
  const response = await fetch('/api/admin/pending-counts', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('admin-pending-counts-failed');
  }

  return normalizeAdminPendingCountsResponse(await response.json());
}

async function fetchAdminEvaluationRecords(): Promise<Record<string, unknown>[]> {
  const response = await fetch('/api/admin/evaluations', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('admin-evaluations-failed');
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.records)) {
    return [];
  }

  return payload.records.filter(isRecord);
}
const EVALUATION_FILTER_KEYS = [
  'visit_authenticity',
  'rb_inference_score',
  'rb_grounding_TF',
  'review_faithfulness_score',
  'geocoding_success',
  'category_validity_TF',
  'category_TF',
  'status',
] as const;
const EVALUATION_RESTORE_CONFIRMATION = '검수복원';
type PendingRecordAction = {
  kind: 'restore';
  record: EvaluationRecord;
};
type RestaurantSubmissionUpdateOverride =
  Database['public']['Tables']['restaurant_submissions']['Update'] & {
    resolved_by_admin_id?: string;
    admin_notes?: string | null;
    restaurant_address?: string | null;
    restaurant_phone?: string | null;
    restaurant_categories?: string[] | null;
  };

type RestaurantSubmissionMutationTable = Omit<
  Database['public']['Tables']['restaurant_submissions'],
  'Update'
> & {
  Update: RestaurantSubmissionUpdateOverride;
};

function restaurantSubmissionMutation() {
  return supabase.from<'restaurant_submissions', RestaurantSubmissionMutationTable>(
    'restaurant_submissions',
  );
}

const ADMIN_SUBMISSION_SELECT = [
  'id',
  'user_id',
  'submission_type',
  'status',
  'restaurant_name',
  'restaurant_address',
  'restaurant_phone',
  'restaurant_categories',
  'admin_notes',
  'rejection_reason',
  'resolved_by_admin_id',
  'reviewed_at',
  'created_at',
  'updated_at',
].join(', ');
const ADMIN_SUBMISSION_ITEM_SELECT = [
  'id',
  'submission_id',
  'youtube_link',
  'tzuyang_review',
  'target_restaurant_id',
  'item_status',
  'rejection_reason',
  'created_at',
].join(', ');
const ADMIN_RESTAURANT_REQUEST_SELECT = [
  'id',
  'user_id',
  'restaurant_name',
  'origin_address',
  'road_address',
  'jibun_address',
  'english_address',
  'phone',
  'categories',
  'recommendation_reason',
  'youtube_link',
  'status',
  'reviewed_by_admin_id',
  'reviewed_at',
  'admin_note',
  'rejection_reason',
  'review_audit_id',
  'created_at',
  'updated_at',
].join(', ');
const ADMIN_RESTAURANT_REQUEST_LEGACY_SELECT = [
  'id',
  'user_id',
  'restaurant_name',
  'origin_address',
  'road_address',
  'jibun_address',
  'english_address',
  'phone',
  'categories',
  'recommendation_reason',
  'youtube_link',
  'created_at',
].join(', ');
const ADMIN_REVIEW_SELECT = [
  'id',
  'user_id',
  'restaurant_id',
  'title',
  'content',
  'visited_at',
  'verification_photo',
  'food_photos',
  'categories',
  'is_verified',
  'admin_note',
  'is_pinned',
  'is_edited_by_admin',
  'created_at',
  'updated_at',
  'is_duplicate',
  'receipt_data',
  'ocr_processed_at',
].join(', ');

type EvalFilterKey = (typeof EVALUATION_FILTER_KEYS)[number];
type EvalFiltersState = Partial<Record<EvalFilterKey, string>>;

interface StoredEvaluationPageState {
  selectedStatuses?: EvaluationRecordStatus[];
  searchQuery?: string;
  evalFilters?: EvalFiltersState;
  isAlternateView?: boolean;
}

function isEvaluationRecordStatus(value: unknown): value is EvaluationRecordStatus {
  switch (value) {
    case 'pending':
    case 'approved':
    case 'rejected':
    case 'hold':
    case 'deleted':
    case 'missing':
    case 'db_conflict':
    case 'geocoding_failed':
    case 'address_review_geocode_recovered':
    case 'not_selected':
      return true;
    default:
      return false;
  }
}

function sanitizeEvalFilters(value: unknown): EvalFiltersState {
  if (!isRecord(value)) {
    return {};
  }

  const rawFilters = value;
  const sanitizedFilters: EvalFiltersState = {};

  EVALUATION_FILTER_KEYS.forEach((key) => {
    const candidateValue = rawFilters[key];
    if (typeof candidateValue === 'string') {
      if (key === 'status') {
        const sanitizedStatus = sanitizePrimaryStatusFilterValue(candidateValue);
        if (sanitizedStatus) {
          sanitizedFilters[key] = sanitizedStatus;
        }

        return;
      }

      sanitizedFilters[key] = candidateValue;
    }
  });

  return sanitizedFilters;
}

function areEvalFiltersEqual(left: EvalFiltersState, right: EvalFiltersState): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );

  return leftEntries.length === rightEntries.length
    && leftEntries.every(
      ([key, value], index) =>
        key === rightEntries[index]?.[0] && value === rightEntries[index]?.[1],
    );
}

function parseStoredEvaluationPageState(serializedState: string | null): StoredEvaluationPageState | null {
  if (!serializedState) {
    return null;
  }

  const parsedState: unknown = JSON.parse(serializedState);
  if (!isRecord(parsedState)) {
    return null;
  }

  const rawState = parsedState;
  const selectedStatuses = Array.isArray(rawState.selectedStatuses)
    ? rawState.selectedStatuses.filter(isEvaluationRecordStatus)
    : undefined;
  const searchQuery = typeof rawState.searchQuery === 'string' ? rawState.searchQuery : undefined;
  const evalFilters = sanitizeEvalFilters(rawState.evalFilters);
  const isAlternateView = typeof rawState.isAlternateView === 'boolean' ? rawState.isAlternateView : undefined;

  return {
    ...(selectedStatuses ? { selectedStatuses } : {}),
    ...(searchQuery !== undefined ? { searchQuery } : {}),
    ...(Object.keys(evalFilters).length > 0 ? { evalFilters } : {}),
    ...(isAlternateView !== undefined ? { isAlternateView } : {}),
  };
}

interface SubmissionRow {
  id: string;
  user_id: string;
  submission_type: 'new' | 'edit' | null;
  status: 'pending' | 'approved' | 'partially_approved' | 'rejected';
  restaurant_name: string;
  restaurant_address: string | null;
  restaurant_phone: string | null;
  restaurant_categories: string[] | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  resolved_by_admin_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RestaurantRequestRow {
  id: string;
  user_id: string;
  restaurant_name: string;
  origin_address: string | null;
  road_address: string | null;
  jibun_address: string | null;
  english_address: string | null;
  phone: string | null;
  categories: string[] | null;
  recommendation_reason: string | null;
  youtube_link: string | null;
  status: 'pending' | 'approved' | 'rejected' | null;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
  rejection_reason: string | null;
  review_audit_id: string | null;
  created_at: string;
  updated_at: string | null;
}

type RestaurantRequestListRow =
  Omit<RestaurantRequestRow,
    | 'status'
    | 'reviewed_by_admin_id'
    | 'reviewed_at'
    | 'admin_note'
    | 'rejection_reason'
    | 'review_audit_id'
    | 'updated_at'
  >
  & Partial<Pick<RestaurantRequestRow,
    | 'status'
    | 'reviewed_by_admin_id'
    | 'reviewed_at'
    | 'admin_note'
    | 'rejection_reason'
    | 'review_audit_id'
    | 'updated_at'
  >>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseValidatedRows<Row>(
  values: readonly unknown[],
  isRow: (value: unknown) => value is Row,
): Row[] {
  const rows: Row[] = [];

  for (const value of values) {
    if (isRow(value)) {
      rows.push(value);
    }
  }

  return rows;
}


function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNullableStringArray(value: unknown): value is string[] | null {
  return value === null || isStringArray(value);
}

function isSubmissionRow(value: unknown): value is SubmissionRow {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string'
    && typeof value.user_id === 'string'
    && (value.submission_type === 'new' || value.submission_type === 'edit' || value.submission_type === null)
    && (value.status === 'pending' || value.status === 'approved' || value.status === 'partially_approved' || value.status === 'rejected')
    && typeof value.restaurant_name === 'string'
    && isNullableString(value.restaurant_address)
    && isNullableString(value.restaurant_phone)
    && isNullableStringArray(value.restaurant_categories)
    && isNullableString(value.admin_notes)
    && isNullableString(value.rejection_reason)
    && isNullableString(value.resolved_by_admin_id)
    && isNullableString(value.reviewed_at)
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
  );
}

function isSubmissionItem(value: unknown): value is SubmissionItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string'
    && typeof value.submission_id === 'string'
    && typeof value.youtube_link === 'string'
    && isNullableString(value.tzuyang_review)
    && isNullableString(value.target_restaurant_id)
    && (value.item_status === 'pending' || value.item_status === 'approved' || value.item_status === 'rejected')
    && isNullableString(value.rejection_reason)
    && typeof value.created_at === 'string'
  );
}

function isRestaurantRequestListRow(value: unknown): value is RestaurantRequestListRow {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string'
    && typeof value.user_id === 'string'
    && typeof value.restaurant_name === 'string'
    && isNullableString(value.origin_address)
    && isNullableString(value.road_address)
    && isNullableString(value.jibun_address)
    && isNullableString(value.english_address)
    && isNullableString(value.phone)
    && isNullableStringArray(value.categories)
    && isNullableString(value.recommendation_reason)
    && isNullableString(value.youtube_link)
    && typeof value.created_at === 'string'
    && (value.status === undefined || value.status === null || value.status === 'pending' || value.status === 'approved' || value.status === 'rejected')
    && (value.reviewed_by_admin_id === undefined || isNullableString(value.reviewed_by_admin_id))
    && (value.reviewed_at === undefined || isNullableString(value.reviewed_at))
    && (value.admin_note === undefined || isNullableString(value.admin_note))
    && (value.rejection_reason === undefined || isNullableString(value.rejection_reason))
    && (value.review_audit_id === undefined || isNullableString(value.review_audit_id))
    && (value.updated_at === undefined || isNullableString(value.updated_at))
  );
}

function isReviewReceiptData(value: unknown): value is NonNullable<Review['receipt_data']> {
  if (!isRecord(value)) return false;

  const items = value.items;
  const hasValidItems = items === undefined || (
    Array.isArray(items)
    && (
      items.every((item) => typeof item === 'string')
      || items.every((item) => (
        isRecord(item)
        && typeof item.name === 'string'
        && (typeof item.price === 'number' || item.price === null)
      ))
    )
  );

  return (
    (value.store_name === undefined || typeof value.store_name === 'string')
    && (value.date === undefined || typeof value.date === 'string')
    && (value.time === undefined || typeof value.time === 'string')
    && (value.total_amount === undefined || typeof value.total_amount === 'number')
    && hasValidItems
    && (value.confidence === undefined || typeof value.confidence === 'number')
    && (value.error === undefined || typeof value.error === 'string')
    && (value.duplicate_of === undefined || typeof value.duplicate_of === 'string')
  );
}

function isNullableReviewReceiptData(value: unknown): value is Review['receipt_data'] {
  return value === undefined || value === null || isReviewReceiptData(value);
}

function parseReview(value: unknown): Omit<Review, 'profiles' | 'restaurants'> | null {
  if (!isRecord(value)) return null;

  const {
    id,
    user_id: userId,
    restaurant_id: restaurantId,
    title,
    content,
    visited_at: visitedAt,
    verification_photo: verificationPhoto,
    food_photos: foodPhotos,
    categories,
    is_verified: isVerified,
    admin_note: adminNote,
    is_pinned: isPinned,
    is_edited_by_admin: isEditedByAdmin,
    created_at: createdAt,
    updated_at: updatedAt,
    is_duplicate: isDuplicate,
    receipt_data: receiptData,
    ocr_processed_at: ocrProcessedAt,
  } = value;

  if (
    typeof id !== 'string'
    || typeof userId !== 'string'
    || typeof restaurantId !== 'string'
    || typeof title !== 'string'
    || typeof content !== 'string'
    || typeof visitedAt !== 'string'
    || typeof verificationPhoto !== 'string'
    || !isStringArray(foodPhotos)
    || !isStringArray(categories)
    || typeof isVerified !== 'boolean'
    || !isNullableString(adminNote)
    || typeof isPinned !== 'boolean'
    || typeof isEditedByAdmin !== 'boolean'
    || typeof createdAt !== 'string'
    || typeof updatedAt !== 'string'
    || (isDuplicate !== undefined && typeof isDuplicate !== 'boolean')
    || !isNullableReviewReceiptData(receiptData)
    || (ocrProcessedAt !== undefined && !isNullableString(ocrProcessedAt))
  ) {
    return null;
  }

  return {
    id,
    user_id: userId,
    restaurant_id: restaurantId,
    title,
    content,
    visited_at: visitedAt,
    verification_photo: verificationPhoto,
    food_photos: foodPhotos,
    category: categories.join(', '),
    is_verified: isVerified,
    admin_note: adminNote,
    is_pinned: isPinned,
    is_edited_by_admin: isEditedByAdmin,
    created_at: createdAt,
    updated_at: updatedAt,
    ...(isDuplicate === undefined ? {} : { is_duplicate: isDuplicate }),
    ...(receiptData === undefined ? {} : { receipt_data: receiptData }),
    ...(ocrProcessedAt === undefined ? {} : { ocr_processed_at: ocrProcessedAt }),
  };
}

type SupabaseQueryError = {
  code?: string;
};

function isMissingRestaurantRequestLifecycleError(error: SupabaseQueryError | null | undefined) {
  return error?.code === '42703';
}

interface RestaurantRequestReviewResponse {
  success?: boolean;
  request?: RestaurantRequestRow | null;
  auditId?: string | null;
}

const applyRestaurantRequestReadbackToSubmission = (
  submission: SubmissionRecord,
  request: RestaurantRequestRow | null | undefined,
  auditId: string | null | undefined,
  fallbackStatus: 'approved' | 'rejected',
): SubmissionRecord => {
  if (!request) {
    return {
      ...submission,
      recommendation_audit_id: auditId || submission.recommendation_audit_id || null,
    };
  }

  const status = request.status || fallbackStatus;

  return {
    ...submission,
    status,
    restaurant_name: request.restaurant_name,
    restaurant_address: request.road_address || request.jibun_address || request.origin_address,
    restaurant_phone: request.phone,
    restaurant_categories: request.categories,
    admin_notes: request.admin_note,
    rejection_reason: request.rejection_reason,
    resolved_by_admin_id: request.reviewed_by_admin_id,
    reviewed_at: request.reviewed_at,
    updated_at: request.updated_at || submission.updated_at,
    recommendation_reason: request.recommendation_reason,
    recommendation_status: status,
    recommendation_admin_note: request.admin_note,
    recommendation_audit_id: auditId || request.review_audit_id,
    items: submission.items.map((item, index) =>
      index === 0
        ? {
            ...item,
            youtube_link: request.youtube_link || item.youtube_link,
            tzuyang_review: request.recommendation_reason || item.tzuyang_review,
            item_status: status,
            rejection_reason: request.rejection_reason,
          }
        : item,
    ),
  };
};

type SubmissionOriginalRestaurantData = NonNullable<SubmissionRecord['original_restaurant_data']>;

interface ProfileNicknameRow {
  user_id: string;
  nickname: string | null;
}

interface RestaurantLookupRow {
  id: string;
  unique_id: string | null;
  name: string | null;
  road_address: string | null;
  jibun_address: string | null;
  phone: string | null;
  categories: string[] | null;
  youtube_link: string | null;
  tzuyang_review: string | null;
  youtube_meta: Record<string, unknown> | null;
}

interface ReviewRestaurantRow {
  id: string;
  approved_name: string | null;
  road_address: string | null;
  jibun_address: string | null;
}

interface ReviewApprovalTargetRow {
  user_id: string;
  restaurant_id: string;
  is_verified: boolean;
}

interface RestaurantReviewCountRow {
  name: string | null;
  review_count: number | null;
}

function isNullableRecord(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

function isProfileNicknameRow(value: unknown): value is ProfileNicknameRow {
  return isRecord(value)
    && typeof value.user_id === 'string'
    && isNullableString(value.nickname);
}

function isRestaurantLookupRow(value: unknown): value is RestaurantLookupRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && isNullableString(value.unique_id)
    && isNullableString(value.name)
    && isNullableString(value.road_address)
    && isNullableString(value.jibun_address)
    && isNullableString(value.phone)
    && isNullableStringArray(value.categories)
    && isNullableString(value.youtube_link)
    && isNullableString(value.tzuyang_review)
    && isNullableRecord(value.youtube_meta);
}

function isReviewRestaurantRow(value: unknown): value is ReviewRestaurantRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && isNullableString(value.approved_name)
    && isNullableString(value.road_address)
    && isNullableString(value.jibun_address);
}

function isReviewApprovalTargetRow(value: unknown): value is ReviewApprovalTargetRow {
  return isRecord(value)
    && typeof value.user_id === 'string'
    && typeof value.restaurant_id === 'string'
    && typeof value.is_verified === 'boolean';
}

function isRestaurantReviewCountRow(value: unknown): value is RestaurantReviewCountRow {
  return isRecord(value)
    && isNullableString(value.name)
    && (typeof value.review_count === 'number' || value.review_count === null);
}

function isReviewPhotoRow(
  value: unknown,
): value is { verification_photo: string | null; food_photos: string[] | null } {
  return isRecord(value)
    && isNullableString(value.verification_photo)
    && isNullableStringArray(value.food_photos);
}

function isRestaurantRequestRow(value: unknown): value is RestaurantRequestRow {
  return isRestaurantRequestListRow(value)
    && isNullableString(value.status)
    && isNullableString(value.reviewed_by_admin_id)
    && isNullableString(value.reviewed_at)
    && isNullableString(value.admin_note)
    && isNullableString(value.rejection_reason)
    && isNullableString(value.review_audit_id)
    && isNullableString(value.updated_at);
}

function parseRestaurantRequestReviewResponse(
  value: unknown,
): RestaurantRequestReviewResponse | null {
  if (!isRecord(value)) return null;

  const success = value.success;
  if (success !== undefined && typeof success !== 'boolean') return null;

  const requestValue = value.request;
  let request: RestaurantRequestRow | null | undefined = undefined;
  if (requestValue !== undefined) {
    if (requestValue === null) {
      request = null;
    } else if (isRestaurantRequestRow(requestValue)) {
      request = requestValue;
    } else {
      return null;
    }
  }

  const auditIdValue = value.auditId;
  if (auditIdValue !== undefined && !isNullableString(auditIdValue)) {
    return null;
  }

  const response: RestaurantRequestReviewResponse = {};
  if (typeof success === 'boolean') response.success = success;
  if (request !== undefined) response.request = request;
  if (auditIdValue !== undefined) response.auditId = auditIdValue;
  return response;
}

type ParsedEvaluationResults = NonNullable<EvaluationRecord['evaluation_results']>;
type ParsedLocationMatch = NonNullable<ParsedEvaluationResults['location_match_TF']>;
type ParsedYoutubeMeta = NonNullable<EvaluationRecord['youtube_meta']>;

function parseNumericEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['visit_authenticity'] {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || typeof value.eval_value !== 'number'
    || typeof value.eval_basis !== 'string'
  ) {
    return null;
  }

  return {
    name: value.name,
    eval_value: value.eval_value,
    eval_basis: value.eval_basis,
  };
}

function parseBooleanEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['rb_grounding_TF'] {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || typeof value.eval_value !== 'boolean'
    || typeof value.eval_basis !== 'string'
  ) {
    return null;
  }

  return {
    name: value.name,
    eval_value: value.eval_value,
    eval_basis: value.eval_basis,
  };
}

function parseCategoryEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['category_TF'] {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || typeof value.eval_value !== 'boolean'
    || !isNullableString(value.category_revision)
    || (value.eval_basis !== undefined && typeof value.eval_basis !== 'string')
  ) {
    return null;
  }

  return {
    name: value.name,
    eval_value: value.eval_value,
    category_revision: value.category_revision,
    ...(typeof value.eval_basis === 'string' ? { eval_basis: value.eval_basis } : {}),
  };
}

function parseCategoryValidityEvaluationMetric(
  value: unknown,
): ParsedEvaluationResults['category_validity_TF'] {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || typeof value.eval_value !== 'boolean'
  ) {
    return null;
  }

  return {
    name: value.name,
    eval_value: value.eval_value,
  };
}

function isLocationMatchEvidenceFamily(
  value: unknown,
): value is NonNullable<ParsedLocationMatch['evidence_families']>[number] {
  return value === 'provider_candidate'
    || value === 'source_geo'
    || value === 'cross_provider'
    || value === 'browser_verification'
    || value === 'llm_verification'
    || value === 'geocode_provider';
}

function isLocationMatchPendingReason(
  value: unknown,
): value is NonNullable<ParsedLocationMatch['pending_reason']> {
  return value === 'insufficient_evidence'
    || value === 'cross_country_mismatch'
    || value === 'ambiguous_chain'
    || value === 'multi_candidate'
    || value === 'timeout'
    || value === 'rate_limited';
}

function parseLocationMatchSecondPass(
  value: unknown,
): NonNullable<ParsedLocationMatch['second_pass']> | null {
  if (!isRecord(value)) return null;

  const parsedSecondPass: NonNullable<ParsedLocationMatch['second_pass']> = {};
  if (typeof value.attempted === 'boolean') parsedSecondPass.attempted = value.attempted;
  if (isNullableString(value.provider)) parsedSecondPass.provider = value.provider;
  if (typeof value.timed_out === 'boolean') parsedSecondPass.timed_out = value.timed_out;
  if (typeof value.rate_limited === 'boolean') parsedSecondPass.rate_limited = value.rate_limited;
  if (typeof value.duration_ms === 'number' || value.duration_ms === null) {
    parsedSecondPass.duration_ms = value.duration_ms;
  }
  return parsedSecondPass;
}
function parseLocationMatchAddress(
  value: unknown,
): NonNullable<ParsedLocationMatch['matched_address']> | null {
  if (!isRecord(value)) return null;

  const parsedAddress: NonNullable<ParsedLocationMatch['matched_address']> = {};
  if (isNullableString(value.roadAddress)) parsedAddress.roadAddress = value.roadAddress;
  if (isNullableString(value.jibunAddress)) parsedAddress.jibunAddress = value.jibunAddress;
  if (isNullableString(value.englishAddress)) parsedAddress.englishAddress = value.englishAddress;
  if (isNullableString(value.x)) parsedAddress.x = value.x;
  if (isNullableString(value.y)) parsedAddress.y = value.y;
  return parsedAddress;
}

function parseLocationMatchResult(value: unknown): ParsedEvaluationResults['location_match_TF'] {
  if (!isRecord(value)) return null;

  const parsedResult: ParsedLocationMatch = {};
  if (typeof value.name === 'string') parsedResult.name = value.name;
  if (typeof value.eval_value === 'boolean') parsedResult.eval_value = value.eval_value;
  if (isNullableString(value.origin_name)) parsedResult.origin_name = value.origin_name;
  if (
    value.match_status === 'matched'
    || value.match_status === 'pending'
    || value.match_status === 'failed'
  ) {
    parsedResult.match_status = value.match_status;
  }
  if (
    value.matched_provider === 'naver'
    || value.matched_provider === 'google'
    || value.matched_provider === 'playwright'
    || value.matched_provider === 'gemini'
    || value.matched_provider === 'ncp_geocode'
    || value.matched_provider === null
  ) {
    parsedResult.matched_provider = value.matched_provider;
  }
  if (isNullableString(value.matched_name)) parsedResult.matched_name = value.matched_name;
  if (isNullableString(value.naver_name)) parsedResult.naver_name = value.naver_name;
  if (isNullableString(value.google_name)) parsedResult.google_name = value.google_name;
  if (typeof value.origin_address === 'string') parsedResult.origin_address = value.origin_address;
  if (value.matched_address === null) {
    parsedResult.matched_address = null;
  } else {
    const matchedAddress = parseLocationMatchAddress(value.matched_address);
    if (matchedAddress) parsedResult.matched_address = matchedAddress;
  }
  if (value.naver_address === null) {
    parsedResult.naver_address = null;
  } else if (Array.isArray(value.naver_address) && value.naver_address.every(isRecord)) {
    parsedResult.naver_address = value.naver_address;
  }
  if (isStringArray(value.evidence_summary)) {
    parsedResult.evidence_summary = value.evidence_summary;
  }
  const evidenceFamilies = value.evidence_families;
  if (
    Array.isArray(evidenceFamilies)
    && evidenceFamilies.every(isLocationMatchEvidenceFamily)
  ) {
    parsedResult.evidence_families = evidenceFamilies;
  }
  if (value.pending_reason === null) {
    parsedResult.pending_reason = null;
  } else if (isLocationMatchPendingReason(value.pending_reason)) {
    parsedResult.pending_reason = value.pending_reason;
  }
  if (value.second_pass === null) {
    parsedResult.second_pass = null;
  } else {
    const secondPass = parseLocationMatchSecondPass(value.second_pass);
    if (secondPass) parsedResult.second_pass = secondPass;
  }
  if (isNullableString(value.falseMessage)) parsedResult.falseMessage = value.falseMessage;

  return parsedResult;
}

function parseEvaluationResults(value: unknown): EvaluationRecord['evaluation_results'] {
  if (!isRecord(value)) return null;

  return {
    visit_authenticity: parseNumericEvaluationMetric(value.visit_authenticity),
    rb_inference_score: parseNumericEvaluationMetric(value.rb_inference_score),
    rb_grounding_TF: parseBooleanEvaluationMetric(value.rb_grounding_TF),
    review_faithfulness_score: parseNumericEvaluationMetric(value.review_faithfulness_score),
    category_TF: parseCategoryEvaluationMetric(value.category_TF),
    category_validity_TF: parseCategoryValidityEvaluationMetric(value.category_validity_TF),
    location_match_TF: parseLocationMatchResult(value.location_match_TF),
  };
}

function parseYoutubeMeta(value: unknown): EvaluationRecord['youtube_meta'] {
  if (!isRecord(value) || !isRecord(value.ads_info)) return null;
  if (
    typeof value.title !== 'string'
    || typeof value.publishedAt !== 'string'
    || typeof value.is_shorts !== 'boolean'
    || typeof value.duration !== 'number'
    || typeof value.ads_info.is_ads !== 'boolean'
    || !isNullableString(value.ads_info.what_ads)
  ) {
    return null;
  }

  const parsedMeta: ParsedYoutubeMeta = {
    title: value.title,
    publishedAt: value.publishedAt,
    is_shorts: value.is_shorts,
    duration: value.duration,
    ads_info: {
      is_ads: value.ads_info.is_ads,
      what_ads: value.ads_info.what_ads,
    },
  };
  return parsedMeta;
}

type ParsedDbErrorDetails = NonNullable<EvaluationRecord['db_error_details']>;
type ParsedAddressConsistencyReview =
  NonNullable<ParsedDbErrorDetails['address_consistency_review']>;

function parseDbErrorDetails(value: unknown): EvaluationRecord['db_error_details'] {
  if (!isRecord(value)) return null;

  const parsedDetails: ParsedDbErrorDetails = {};
  if (value.error_type === 'duplicate') parsedDetails.error_type = 'duplicate';

  const addressReviewValue = value.address_consistency_review;
  if (isRecord(addressReviewValue)) {
    const addressReview: ParsedAddressConsistencyReview = {};
    if (typeof addressReviewValue.queue === 'string') {
      addressReview.queue = addressReviewValue.queue;
    }
    if (typeof addressReviewValue.reason_ko === 'string') {
      addressReview.reason_ko = addressReviewValue.reason_ko;
    }
    if (typeof addressReviewValue.generated_at === 'string') {
      addressReview.generated_at = addressReviewValue.generated_at;
    }
    if (typeof addressReviewValue.validation_source === 'string') {
      addressReview.validation_source = addressReviewValue.validation_source;
    }
    if (isNullableRecord(addressReviewValue.geocode_top)) {
      addressReview.geocode_top = addressReviewValue.geocode_top;
    }
    if (typeof addressReviewValue.ahp_score === 'number') {
      addressReview.ahp_score = addressReviewValue.ahp_score;
    }
    if (typeof addressReviewValue.ahp_label === 'string') {
      addressReview.ahp_label = addressReviewValue.ahp_label;
    }
    if (typeof addressReviewValue.top_failing_criterion === 'string') {
      addressReview.top_failing_criterion = addressReviewValue.top_failing_criterion;
    }
    if (isStringArray(addressReviewValue.evidence_families)) {
      addressReview.evidence_families = addressReviewValue.evidence_families;
    }
    if (typeof addressReviewValue.suggested_action === 'string') {
      addressReview.suggested_action = addressReviewValue.suggested_action;
    }
    if (Object.keys(addressReview).length > 0) {
      parsedDetails.address_consistency_review = addressReview;
    }
  }

  const conflictingRestaurantValue = value.conflicting_restaurant;
  if (
    isRecord(conflictingRestaurantValue)
    && typeof conflictingRestaurantValue.id === 'string'
    && typeof conflictingRestaurantValue.name === 'string'
    && typeof conflictingRestaurantValue.jibun_address === 'string'
    && (
      conflictingRestaurantValue.road_address === undefined
      || typeof conflictingRestaurantValue.road_address === 'string'
    )
  ) {
    parsedDetails.conflicting_restaurant = {
      id: conflictingRestaurantValue.id,
      name: conflictingRestaurantValue.name,
      jibun_address: conflictingRestaurantValue.jibun_address,
      ...(typeof conflictingRestaurantValue.road_address === 'string'
        ? { road_address: conflictingRestaurantValue.road_address }
        : {}),
    };
  }
  if (typeof value.similarity_score === 'number') {
    parsedDetails.similarity_score = value.similarity_score;
  }
  if (typeof value.detected_at === 'string') {
    parsedDetails.detected_at = value.detected_at;
  }

  return Object.keys(parsedDetails).length > 0 ? parsedDetails : null;
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getNullableString(value: unknown): string | null {
  return isNullableString(value) ? value : null;
}

function getNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function normalizeEvaluationRecord(value: unknown): EvaluationRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;

  const status = isEvaluationRecordStatus(value.status) ? value.status : 'pending';
  const name = getString(value.name);
  const roadAddress = getNullableString(value.road_address);
  const jibunAddress = getNullableString(value.jibun_address);
  const englishAddress = getNullableString(value.english_address);
  const addressElements = isRecord(value.address_elements) ? value.address_elements : {};
  const originAddress = isRecord(value.origin_address) ? value.origin_address : {};
  const youtubeLink = getString(value.youtube_link);
  const categories = isNullableStringArray(value.categories) ? value.categories : null;
  const youtubeLinks = isNullableStringArray(value.youtube_links)
    ? value.youtube_links
    : (youtubeLink ? [youtubeLink] : null);

  return {
    id: value.id,
    name,
    phone: getNullableString(value.phone),
    categories,
    lat: getNullableNumber(value.lat),
    lng: getNullableNumber(value.lng),
    road_address: roadAddress,
    jibun_address: jibunAddress,
    english_address: englishAddress,
    address_elements: addressElements,
    origin_address: originAddress,
    youtube_links: youtubeLinks,
    youtube_meta: parseYoutubeMeta(value.youtube_meta),
    unique_id: getNullableString(value.unique_id ?? value.trace_id),
    tzuyang_reviews: Array.isArray(value.tzuyang_reviews)
      ? value.tzuyang_reviews.filter(isRecord)
      : [],
    reasoning_basis: getNullableString(value.reasoning_basis),
    evaluation_results: parseEvaluationResults(value.evaluation_results),
    source_type: getNullableString(value.source_type),
    geocoding_success: value.geocoding_success === true,
    geocoding_false_stage: getNullableNumber(value.geocoding_false_stage),
    status,
    is_missing: value.is_missing === true,
    is_not_selected: value.is_not_selected === true,
    review_count: typeof value.review_count === 'number' ? value.review_count : 0,
    created_by: getNullableString(value.created_by),
    updated_by_admin_id: getNullableString(value.updated_by_admin_id),
    db_error_details: parseDbErrorDetails(value.db_error_details),
    created_at: getString(value.created_at),
    updated_at: getString(value.updated_at),
    restaurant_name: typeof value.restaurant_name === 'string'
      ? value.restaurant_name
      : undefined,
    youtube_link: youtubeLink,
    restaurant_info: {
      name,
      phone: getNullableString(value.phone),
      category: categories?.[0] ?? '',
      origin_address: getString(originAddress.address) || roadAddress || jibunAddress || '',
      origin_lat: typeof originAddress.lat === 'number'
        ? originAddress.lat
        : (typeof value.lat === 'number' ? value.lat : 0),
      origin_lng: typeof originAddress.lng === 'number'
        ? originAddress.lng
        : (typeof value.lng === 'number' ? value.lng : 0),
      reasoning_basis: getString(value.reasoning_basis),
      tzuyang_review: getString(value.tzuyang_review),
      naver_address_info: roadAddress || jibunAddress
        ? {
            road_address: roadAddress,
            jibun_address: jibunAddress || '',
            english_address: englishAddress,
            address_elements: addressElements,
            x: typeof value.lng === 'number' ? value.lng.toString() : '',
            y: typeof value.lat === 'number' ? value.lat.toString() : '',
          }
        : null,
    },
    ...(isNullableString(value.geocoding_fail_reason)
      ? { geocoding_fail_reason: value.geocoding_fail_reason }
      : {}),
    ...(isNullableString(value.db_error_message)
      ? { db_error_message: value.db_error_message }
      : {}),
    ...(isNullableString(value.missing_message)
      ? { missing_message: value.missing_message }
      : {}),
    ...(isNullableString(value.approved_name)
      ? { approved_name: value.approved_name }
      : {}),
    ...(isNullableString(value.origin_name)
      ? { origin_name: value.origin_name }
      : {}),
    ...(isNullableString(value.naver_name)
      ? { naver_name: value.naver_name }
      : {}),
    ...(isNullableString(value.google_name)
      ? { google_name: value.google_name }
      : {}),
    ...(isNullableString(value.trace_id)
      ? { trace_id: value.trace_id }
      : {}),
    ...(isNullableString(value.trace_id_name_source)
      ? { trace_id_name_source: value.trace_id_name_source }
      : {}),
    ...(isNullableString(value.channel_name)
      ? { channel_name: value.channel_name }
      : {}),
    ...(isNullableString(value.description_map_url)
      ? { description_map_url: value.description_map_url }
      : {}),
    ...(isNullableRecord(value.recollect_version)
      ? { recollect_version: value.recollect_version }
      : {}),
  };
}

function withAdminEvaluationDisplayName(record: EvaluationRecord): EvaluationRecord {
  const displayName = getAdminEvaluationDisplayName({
    approved_name: record.approved_name,
    restaurant_name: record.restaurant_name,
    name: record.name,
    origin_name: record.origin_name,
    naver_name: record.naver_name,
    evaluation_results: record.evaluation_results,
  });

  return {
    ...record,
    name: displayName,
    restaurant_name: displayName,
    restaurant_info: record.restaurant_info
      ? { ...record.restaurant_info, name: displayName }
      : record.restaurant_info,
  };
}
type ApprovalRpcResult = {
  success?: boolean;
  restaurant_id?: string;
  created_restaurant_id?: string;
};

type SubmissionApprovalRpcResponse = {
  data: unknown;
  error: Error | null;
};

async function callSubmissionApprovalRpc(
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<SubmissionApprovalRpcResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('submission-approval-rpc-unavailable');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error('submission-approval-session-unavailable');
  }

  const response = await fetch(
    new URL(`/rest/v1/rpc/${encodeURIComponent(functionName)}`, supabaseUrl),
    {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parameters),
    },
  );

  const data: unknown = response.ok ? await response.json().catch(() => null) : null;
  return {
    data,
    error: response.ok ? null : new Error('submission-approval-rpc-failed'),
  };
}

function parseApprovalRpcResult(value: unknown): ApprovalRpcResult | null {
  const result = Array.isArray(value) ? value[0] : value;

  if (
    !isRecord(result)
    || (result.success !== undefined && typeof result.success !== 'boolean')
    || (result.restaurant_id !== undefined && typeof result.restaurant_id !== 'string')
    || (
      result.created_restaurant_id !== undefined
      && typeof result.created_restaurant_id !== 'string'
    )
  ) {
    return null;
  }

  return {
    ...(result.success === undefined ? {} : { success: result.success }),
    ...(result.restaurant_id === undefined ? {} : { restaurant_id: result.restaurant_id }),
    ...(
      result.created_restaurant_id === undefined
        ? {}
        : { created_restaurant_id: result.created_restaurant_id }
    ),
  };
}

type AdminEvaluationPageWrapperProps = {
  embedded?: boolean;
  initialView?: 'evaluations' | 'submissions';
  initialSubmissionTab?: 'new' | 'edit' | 'recommend' | 'reviews';
};

// Suspense 래퍼 컴포넌트
function AdminEvaluationPageWrapper({
  embedded = false,
  initialView = 'evaluations',
  initialSubmissionTab,
}: AdminEvaluationPageWrapperProps = {}) {
  return (
    <Suspense fallback={embedded ? null : <AdminEvaluationRouteSkeleton />}>
      <AdminEvaluationPage
        embedded={embedded}
        initialView={initialView}
        initialSubmissionTab={initialSubmissionTab}
      />
    </Suspense>
  );
}

function AdminEvaluationRoutePage() {
  return <AdminEvaluationPageWrapper />;
}

AdminEvaluationRoutePage.Embedded = AdminEvaluationPageWrapper;

export default AdminEvaluationRoutePage;

function AdminEvaluationTitleIcon({ embedded = false }: { embedded?: boolean }) {
  return (
    <span
      className={embedded
        ? "inline-flex h-6 w-6 shrink-0 items-center justify-center text-primary"
        : "inline-flex h-7 w-7 shrink-0 items-center justify-center text-primary"
      }
      data-admin-evaluation-title-icon="true"
      aria-hidden="true"
    >
      <ClipboardCheck className={embedded ? "h-5 w-5" : "h-6 w-6"} strokeWidth={2.25} />
    </span>
  );
}

const ADMIN_EVALUATION_STATIC_STATUS_FILTERS = ['전체', '미처리', '승인대기', '승인됨', '누락', '삭제됨'] as const;

function AdminEvaluationStaticMobileLoadingControls() {
  return (
    <div className="space-y-2 lg:hidden" data-admin-evaluation-static-loading-controls="true">
      <div className="grid grid-cols-3 gap-1.5">
        {ADMIN_EVALUATION_STATIC_STATUS_FILTERS.map((label, index) => (
          <Button
            key={label}
            type="button"
            variant={index === 0 ? "default" : "outline"}
            size="sm"
            disabled
            className="h-8 min-w-0 rounded-full px-2 text-xs font-medium disabled:opacity-100"
            aria-pressed={index === 0}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <div className="flex h-9 items-center rounded-md border bg-background pl-8 pr-3 text-sm text-muted-foreground">
          영상 제목 검색...
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2 py-0.5">
        <div className="min-w-0 truncate px-0.5 text-xs text-muted-foreground">
          <span>검수 항목</span>
          <span className="ml-1 font-medium">집계 중</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="outline" size="sm" disabled className="h-8 rounded-full px-2.5 text-xs font-semibold disabled:opacity-100">
            상세 필터
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled aria-label="필터 초기화" className="h-8 w-8 rounded-full p-0 text-muted-foreground disabled:opacity-100">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdminEvaluationStaticCardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Skeleton className="h-12 w-16 shrink-0 rounded-md motion-reduce:animate-none" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-4/5 rounded-full motion-reduce:animate-none" />
              <Skeleton className="h-2.5 w-3/5 rounded-full motion-reduce:animate-none" />
              <div className="grid grid-cols-3 gap-1.5">
                <Skeleton className="h-5 rounded-full motion-reduce:animate-none" />
                <Skeleton className="h-5 rounded-full motion-reduce:animate-none" />
                <Skeleton className="h-5 rounded-full motion-reduce:animate-none" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
function AdminEvaluationRouteSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="관리자 데이터 검수 화면 로딩 중"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <span className="sr-only">관리자 데이터 검수 화면의 필터, 테이블 행, 액션 영역을 불러오는 중입니다.</span>
      <div className="border-b border-border bg-card px-3 py-2.5">
        <div className="flex min-h-10 items-start justify-between gap-2.5 lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <AdminEvaluationTitleIcon embedded />
              <h1 className="truncate bg-gradient-primary bg-clip-text text-lg font-bold text-transparent">관리자 데이터 검수</h1>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              필터링: 집계 중 | 현 레코드 집계 중 | 삭제한 레코드 집계 중
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1.5" data-admin-evaluation-view-actions="top-right">
            <Button type="button" variant="secondary" size="sm" disabled className="h-8 w-8 p-0 disabled:opacity-100" aria-label="리스트 뷰" aria-pressed="true">
              <LayoutList className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">리스트</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled className="h-8 w-8 p-0 disabled:opacity-100" aria-label="슬라이드 뷰" aria-pressed="false">
              <MonitorPlay className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">슬라이드</span>
            </Button>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2">
        <AdminEvaluationStaticMobileLoadingControls />
        <AdminEvaluationStaticCardSkeleton />
        <div className="hidden min-h-0 overflow-hidden rounded-lg border bg-background lg:block">
          <div className="border-b bg-muted/35 lg:grid lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="px-2 py-2">
                <Skeleton className={index === 1 ? "h-3 w-24 rounded-full motion-reduce:animate-none" : "mx-auto h-3 w-12 rounded-full motion-reduce:animate-none"} />
              </div>
            ))}
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid items-center gap-2 p-2 lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]"
              >
                <Skeleton className="h-6 w-6 rounded-md motion-reduce:animate-none" aria-hidden="true" />
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton className="h-10 w-14 shrink-0 rounded-md motion-reduce:animate-none" aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-4/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                    <Skeleton className="h-2.5 w-3/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                  </div>
                </div>
                {Array.from({ length: 6 }).map((__, cellIndex) => (
                  <Skeleton key={cellIndex} className="h-6 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                ))}
                <Skeleton className="h-7 rounded-md motion-reduce:animate-none" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminEvaluationPage({
  embedded,
  initialView,
  initialSubmissionTab,
}: {
  embedded: boolean;
  initialView: 'evaluations' | 'submissions';
  initialSubmissionTab?: 'new' | 'edit' | 'recommend' | 'reviews';
}) {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS;
  const { user, isAdmin, isLoading: authLoading } = useAuth();
  const hasE2EAdminShellBypass = embedded && hasLocalE2EAdminShellBypass();

  const requireAdminUserId = () => {
    if (!user?.id) {
      throw new Error('로그인이 필요합니다');
    }

    return user.id;
  };



  const [allRecords, setAllRecords] = useState<EvaluationRecord[]>([]); // 전체 데이터 (검색용)
  const [displayedRecords, setDisplayedRecords] = useState<EvaluationRecord[]>([]); // 화면에 표시될 데이터
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [stats, setStats] = useState<CategoryStats>({
    total: 0,
    pending: 0,
    approved: 0,
    ready_for_approval: 0,
    hold: 0,
    db_conflict: 0,
    missing: 0,
    not_selected: 0,
    deleted: 0,
  });
  const [selectedStatuses, setSelectedStatuses] = useState<EvaluationRecordStatus[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(''); // 검색어 상태
  const [searchResults, setSearchResults] = useState<EvaluationRecord[] | null>(null); // 검색 결과
  const [isSearching, setIsSearching] = useState(false); // 검색 로딩 상태
  const [evalFilters, setEvalFilters] = useState<EvalFiltersState>({});
  const [missingFormOpen, setMissingFormOpen] = useState(false);
  const [selectedMissingRecord, setSelectedMissingRecord] = useState<EvaluationRecord | null>(null);
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  const [selectedConflictRecord, setSelectedConflictRecord] = useState<EvaluationRecord | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedEditRecord, setSelectedEditRecord] = useState<EvaluationRecord | null>(null);

  // 승인 확인 모달 상태
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [pendingApprovalRecord, setPendingApprovalRecord] = useState<EvaluationRecord | null>(null);
  const [conflictingRestaurantInfo, setConflictingRestaurantInfo] = useState<{
    name: string;
    address: string;
  } | null>(null);
  const [pendingRecordAction, setPendingRecordAction] = useState<PendingRecordAction | null>(null);
  const [recordActionConfirmation, setRecordActionConfirmation] = useState('');

  const clearPendingRecordAction = () => {
    setPendingRecordAction(null);
    setRecordActionConfirmation('');
  };

  const getSameVideoDuplicateWarnings = useCallback((record: EvaluationRecord) => {
    return findSameVideoDuplicateWarningCandidates(record, allRecords);
  }, [allRecords]);

  const notifySameVideoDuplicateWarning = useCallback((record: EvaluationRecord, actionLabel: string) => {
    const message = formatSameVideoDuplicateWarning(getSameVideoDuplicateWarnings(record));
    if (!message) return;

    toast({
      title: `같은 영상 중복 후보 확인 후 ${actionLabel}`,
      description: message,
    });
  }, [getSameVideoDuplicateWarnings, toast]);

  const getRestaurantIdentityWarnings = useCallback((record: EvaluationRecord) => {
    return findRestaurantIdentityWarnings(record, allRecords);
  }, [allRecords]);

  const notifyRestaurantIdentityWarning = useCallback((record: EvaluationRecord, actionLabel: string) => {
    const warnings = getRestaurantIdentityWarnings(record);
    const message = formatRestaurantIdentityWarning(warnings);
    if (!message) return false;

    const hasBlockingWarning = hasBlockingRestaurantIdentityWarning(warnings);
    toast({
      variant: hasBlockingWarning ? 'destructive' : 'default',
      title: hasBlockingWarning ? `${actionLabel} 차단: 장소명 검증 필요` : `${actionLabel} 전 장소명 확인`,
      description: message,
    });

    return hasBlockingWarning;
  }, [getRestaurantIdentityWarnings, toast]);

  // 테이블 뷰 토글 상태
  const [isAlternateView, setIsAlternateView] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  // 사용자 제보 검수 상태 (URL 쿼리 파라미터로 초기화)
  const [showSubmissionView, setShowSubmissionView] = useState(false);
  const [submissionInitialTab, setSubmissionInitialTab] = useState<'new' | 'edit' | 'recommend' | 'reviews'>('new');

  // Deep-link 필터 (운영지표/이슈보드 -> 검수 화면 이동)
  const deepLinkInitializedRef = useRef(false);
  const [deepLinkFilter, setDeepLinkFilter] = useState<{
    videoId?: string;
    issue?: string;
    reason?: string;
  } | null>(null);

  const canonicalAdminHref = useMemo(
    () => (embedded ? null : buildCanonicalAdminEvaluationsHref(searchParams)),
    [embedded, searchParams],
  );
  const clearDeepLinkFilter = useCallback(() => {
    setDeepLinkFilter(null);
    deepLinkInitializedRef.current = true;

    if (embedded) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete('video_id');
    params.delete('issue');
    params.delete('reason');

    router.replace(buildCanonicalAdminEvaluationsHref({
      get: (key) => params.get(key),
    }), { scroll: false });
  }, [embedded, router, searchParams]);

  useEffect(() => {
    if (embedded || !canonicalAdminHref) return;

    const currentQuery = searchParams.toString();
    const currentHref = `/admin/evaluations${currentQuery ? `?${currentQuery}` : ''}`;
    if (currentHref !== canonicalAdminHref) {
      router.replace(canonicalAdminHref, { scroll: false });
    }
  }, [canonicalAdminHref, embedded, router, searchParams]);

  // URL 파라미터에 따라 초기 뷰 설정
  useEffect(() => {
    const routeView = embedded ? null : searchParams.get('view');
    const routeTab = embedded ? null : searchParams.get('tab');

    if (initialView === 'submissions' || routeView === 'submissions') {
      setShowSubmissionView(true);
      // tab 파라미터가 reviews면 리뷰 탭으로 초기화
      const tab = initialSubmissionTab ?? routeTab;
      if (tab === 'reviews') {
        setSubmissionInitialTab('reviews');
      } else if (tab === 'recommend') {
        setSubmissionInitialTab('recommend');
      } else if (tab === 'edit') {
        setSubmissionInitialTab('edit');
      } else {
        setSubmissionInitialTab('new');
      }
      return;
    }

    setShowSubmissionView(false);
    setSubmissionInitialTab('new');
  }, [embedded, initialSubmissionTab, initialView, searchParams]);

  // URL 파라미터에 따라 Deep-link 필터 초기화
  useEffect(() => {
    if (deepLinkInitializedRef.current) return;
    if (embedded) return;

    const videoId = searchParams.get('video_id')?.trim() || '';
    const issue = searchParams.get('issue')?.trim() || '';
    const reason = searchParams.get('reason')?.trim() || '';

    if (!videoId && !issue && !reason) return;

    deepLinkInitializedRef.current = true;
    setDeepLinkFilter({
      ...(videoId ? { videoId } : {}),
      ...(issue ? { issue } : {}),
      ...(reason ? { reason } : {}),
    });
  }, [embedded, searchParams]);
  const [currentSubmissionIndex, setCurrentSubmissionIndex] = useState(0);
  const [editingSubmission, setEditingSubmission] = useState<SubmissionRecord | null>(null);
  const queryClient = useQueryClient();
  const invalidateAdminPendingCounts = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-pending-counts'] });
    queryClient.invalidateQueries({ queryKey: ADMIN_SHARED_PENDING_COUNTS_QUERY_KEY });
  }, [queryClient]);

  // localStorage에서 상태 복원
  useEffect(() => {
    try {
      const savedState = parseStoredEvaluationPageState(localStorage.getItem(STORAGE_KEY));
      if (!savedState) return;

      if (savedState.selectedStatuses) setSelectedStatuses(savedState.selectedStatuses);
      if (savedState.searchQuery !== undefined) setSearchQuery(savedState.searchQuery);
      if (savedState.evalFilters) setEvalFilters(savedState.evalFilters);
      if (savedState.isAlternateView !== undefined) setIsAlternateView(savedState.isAlternateView);
    } catch {
    }
  }, []);

  useEffect(() => {
    const sanitizedFilters = sanitizeEvalFilters(evalFilters);
    if (areEvalFiltersEqual(evalFilters, sanitizedFilters)) {
      return;
    }

    setEvalFilters(sanitizedFilters);
  }, [evalFilters]);

  // 무한 스크롤을 위한 scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 첫 마운트 여부를 추적 (검색 자동 실행 방지)
  const isInitialMount = useRef(true);

  // 데이터 로드 여부 추적 (세션 동안 한 번만 로드)
  const hasLoadedData = useRef(false);

  // 권한 체크 완료 여부 추적 (초기 로드 시 한 번만 체크)
  const hasCheckedAuth = useRef(false);

  // 상태 변경 시 localStorage에 저장
  useEffect(() => {
    const stateToSave = {
      selectedStatuses,
      searchQuery,
      evalFilters,
      isAlternateView,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch {
    }
  }, [selectedStatuses, searchQuery, evalFilters, isAlternateView]);

  // 인증 체크 및 관리자 권한 확인
  useEffect(() => {
    if (hasE2EAdminShellBypass) {
      hasCheckedAuth.current = true;
      return;
    }

    // 인증 로딩 중에는 아무것도 하지 않음 (로딩 완료 후 권한 체크)
    if (authLoading) {
      return;
    }

    // 이미 권한 체크를 완료했으면 다시 체크하지 않음 (재마운트 시 중복 체크 방지)
    if (hasCheckedAuth.current) {
      return;
    }

    // 인증 로딩이 완료된 후 권한 체크
    if (!user) {
      hasCheckedAuth.current = true;
      toast({
        title: "접근 권한이 없습니다",
        description: "관리자만 접근할 수 있는 페이지입니다.",
        variant: "destructive",
      });
      router.push('/');
      return;
    }

    // user는 있지만 isAdmin이 false인 경우 - 비동기 체크가 완료될 때까지 대기
    if (!isAdmin) {
      return;
    }

    // user도 있고 isAdmin도 true인 경우
    hasCheckedAuth.current = true;
  }, [user, isAdmin, authLoading, hasE2EAdminShellBypass, toast, router]);

  // YouTube 제목 퍼지 검색
  useEffect(() => {
    // 첫 마운트 시에는 검색 실행하지 않음 (localStorage 복원으로 인한 자동 실행 방지)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const performFuzzySearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults(null);
        return;
      }

      setIsSearching(true);
      try {
        const { data, error } = await supabase
          .rpc('search_restaurants_by_youtube_title', {
            search_query: searchQuery.trim(),
            max_results: 100,
            include_all_status: true,
          })
          .overrideTypes<Record<string, unknown>[], { merge: false }>();

        if (error) throw error;

        const convertedData = (data ?? [])
          .map(normalizeEvaluationRecord)
          .filter((record): record is EvaluationRecord => record !== null)
          .map(withAdminEvaluationDisplayName);
        setSearchResults(convertedData);
      } catch {
        toast({
          variant: 'destructive',
          title: '검색 실패',
          description: '영상 제목 검색 중 오류가 발생했습니다.',
        });
        setSearchResults(null);
      } finally {
        setIsSearching(false);
      }
    };

    const debounceTimer = setTimeout(performFuzzySearch, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, toast]);

  // 필터링 + 검색된 레코드
  const filteredRecords = useMemo(() => {
    // 검색 결과가 있으면 검색 결과를 기준으로, 없으면 전체 데이터 사용
    const baseRecords = searchResults || allRecords;

    // 기본: 모든 레코드 포함 (Deleted 포함)
    let filtered = baseRecords;

    // 상태 필터링 (evalFilters.status)
    if (evalFilters.status) {
      // 'deleted' 필터 선택 시 특별 처리: baseRecords에서 deleted만 추출
      if (evalFilters.status === 'deleted') {
        filtered = baseRecords.filter(r => r.status === 'deleted');
      } else {
        filtered = filtered.filter(r => {
          let match = false;

          switch (evalFilters.status) {
            case 'missing':
              match = isAdminEvaluationRecordMissing(r);
              break;
            case 'not_selected':
              match = isAdminEvaluationRecordNotSelected(r);
              break;
            case 'ready_for_approval':
              match = isAdminEvaluationRecordReadyForApproval(r);
              break;
            default:
              // 일반 상태: status 필드와 일치하는 레코드
              match = r.status === evalFilters.status;
              break;
          }

          return match;
        });
      }
    }

    // 1. Visit Authenticity 필터 (0-3점)
    if (evalFilters.visit_authenticity) {
      const targetScore = parseInt(evalFilters.visit_authenticity);
      filtered = filtered.filter(r =>
        r.evaluation_results?.visit_authenticity?.eval_value === targetScore
      );
    }

    // 2. RB Inference Score 필터 (0-2점)
    if (evalFilters.rb_inference_score) {
      const targetScore = parseInt(evalFilters.rb_inference_score);
      filtered = filtered.filter(r =>
        r.evaluation_results?.rb_inference_score?.eval_value === targetScore
      );
    }

    // 3. RB Grounding TF 필터 (T/F)
    if (evalFilters.rb_grounding_TF) {
      const targetValue = evalFilters.rb_grounding_TF === 'True';
      filtered = filtered.filter(r =>
        r.evaluation_results?.rb_grounding_TF?.eval_value === targetValue
      );
    }

    // 4. Review Faithfulness Score 필터 (0-1점)
    if (evalFilters.review_faithfulness_score) {
      const targetScore = parseFloat(evalFilters.review_faithfulness_score);
      filtered = filtered.filter(r =>
        r.evaluation_results?.review_faithfulness_score?.eval_value === targetScore
      );
    }

    // 5. 주소 정합 필터 (True/False/Failed) - 상세/테이블 표시와 같은 helper 사용
    if (evalFilters.geocoding_success) {
      const targetStatusByFilter: Record<string, ReturnType<typeof getAddressConsistencyStatus>[]> = {
        true: ['true'],
        false_match: ['false'],
        false_geocode: ['failed'],
        review: ['review', 'candidate'],
      };
      const targetStatuses = targetStatusByFilter[evalFilters.geocoding_success];
      if (targetStatuses) {
        filtered = filtered.filter(r => targetStatuses.includes(getAddressConsistencyStatus(r)));
      }
    }

    // 6. Category Validity TF 필터 (T/F)
    if (evalFilters.category_validity_TF) {
      const targetValue = evalFilters.category_validity_TF === 'True';
      filtered = filtered.filter(r =>
        r.evaluation_results?.category_validity_TF?.eval_value === targetValue
      );
    }

    // 7. Category TF 필터 (T/F)
    if (evalFilters.category_TF) {
      const targetValue = evalFilters.category_TF === 'True';
      filtered = filtered.filter(r =>
        r.evaluation_results?.category_TF?.eval_value === targetValue
      );
    }

    // 8. Status 필터는 위에서 이미 처리됨

    // Deep-link 필터 (video_id/issue/reason)
    if (deepLinkFilter?.videoId) {
      filtered = filtered.filter((record) => (
        extractVideoIdFromYoutubeLink(record.youtube_link) === deepLinkFilter.videoId
      ));
    }

    if (deepLinkFilter?.issue === 'notSelection') {
      filtered = filtered.filter((record) => record.is_not_selected === true);

      if (deepLinkFilter.reason) {
        filtered = filtered.filter((record) => (
          toNotSelectionReason({
            is_not_selected: record.is_not_selected,
            is_missing: record.is_missing,
            geocoding_false_stage: record.geocoding_false_stage,
            geocoding_success: record.geocoding_success,
          }) === deepLinkFilter.reason
        ));
      }
    } else if (deepLinkFilter?.issue === 'ruleFalse') {
      filtered = filtered.filter((record) => {
        const message = getLocationMatchFalseMessage(record.evaluation_results);
        if (!message) return false;
        return deepLinkFilter.reason ? message === deepLinkFilter.reason : true;
      });
    } else if (deepLinkFilter?.issue === 'laajGap') {
      filtered = filtered.filter((record) => (
        hasRuleMetrics(record.evaluation_results) && !hasLaajMetrics(record.evaluation_results)
      ));
    }

    return filtered;
  }, [allRecords, searchResults, evalFilters, deepLinkFilter]);

  // filteredRecords가 정의된 후에 useEffect 위치
  useEffect(() => {
    // 필터링된 레코드 내에서 현재 인덱스가 유효한지 확인
    if (currentSlideIndex >= filteredRecords.length && filteredRecords.length > 0) {
      setCurrentSlideIndex(0);
    }
  }, [filteredRecords.length, currentSlideIndex]);

  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  const filteredRecordsRef = useRef(filteredRecords);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    filteredRecordsRef.current = filteredRecords;
  }, [filteredRecords]);

  // 더 많은 레코드 로드
  const loadMoreRecords = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    setTimeout(() => {
      setDisplayedRecords(prev => {
        const currentLength = prev.length;
        const source = filteredRecordsRef.current;
        const newRecords = source.slice(currentLength, currentLength + PAGE_SIZE);
        const nextHasMore = currentLength + newRecords.length < source.length;

        hasMoreRef.current = nextHasMore;
        loadingMoreRef.current = false;
        setHasMore(nextHasMore);
        setLoadingMore(false);

        return [...prev, ...newRecords];
      });
    }, 100);
  }, []);

  // 필터링 결과가 변경될 때마다 표시할 레코드 초기화
  useEffect(() => {
    const nextHasMore = filteredRecords.length > PAGE_SIZE;

    setDisplayedRecords(filteredRecords.slice(0, PAGE_SIZE));
    setHasMore(nextHasMore);
    hasMoreRef.current = nextHasMore;
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [filteredRecords]);

  const visibleDisplayedRecords = useMemo(() => {
    if (displayedRecords.length > 0 || filteredRecords.length === 0) {
      return displayedRecords;
    }

    return filteredRecords.slice(0, PAGE_SIZE);
  }, [displayedRecords, filteredRecords]);

  const isListView = !showSubmissionView && !isAlternateView;
  const canSwitchEvaluationView = !embedded || initialView === 'evaluations';

  const switchToEvaluationListView = useCallback(() => {
    setIsAlternateView(false);
    setShowSubmissionView(false);

    if (!embedded) {
      router.replace('/admin?module=restaurants', { scroll: false });
    }
  }, [embedded, router]);

  const switchToEvaluationSlideView = useCallback(() => {
    setIsAlternateView(true);
    setShowSubmissionView(false);

    if (!embedded) {
      router.replace('/admin?module=restaurants', { scroll: false });
    }
  }, [embedded, router]);

  // 무한 스크롤 - Scroll Event 방식
  useEffect(() => {
    if (!isListView) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

      // 80% 이상 스크롤 시 다음 데이터 로드
      if (scrollPercentage > 0.8) {
        loadMoreRecords();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [isListView, loadMoreRecords]);

  // 슬라이드 뷰에서 끝에 도달하면 추가 데이터 로드
  useEffect(() => {
    if (isAlternateView && hasMore && !loadingMore) {
      // 현재 인덱스가 표시된 레코드의 끝부분(마지막 5개)에 도달하면 추가 로드
      if (currentSlideIndex >= displayedRecords.length - 5) {
        loadMoreRecords();
      }
    }
  }, [isAlternateView, currentSlideIndex, displayedRecords.length, hasMore, loadingMore, loadMoreRecords]);

  // 전체 데이터 로드 (한 번만)
  const loadAllRecords = useCallback(async () => {
    try {
      setLoading(true);

      // 관리자 검수 데이터는 서버 API에서 service-role로 조회한다.
      // 브라우저 Supabase 클라이언트는 RLS 때문에 승인된 공개 레코드만 보일 수 있다.
      const data = await fetchAdminEvaluationRecords();


      if (!data) {
        setAllRecords([]);
        setDisplayedRecords([]);
        setStats({
          total: 0,
          pending: 0,
          approved: 0,
          ready_for_approval: 0,
                hold: 0,
          db_conflict: 0,
          missing: 0,
          not_selected: 0,
          deleted: 0,
        });
        return;
      }

      let typedRecords = data
        .map(normalizeEvaluationRecord)
        .filter((record): record is EvaluationRecord => record !== null)
        .map(withAdminEvaluationDisplayName);
      const autoDeleteTargets = typedRecords.filter(shouldAutoDeleteMissingEvaluationRecord);

      if (autoDeleteTargets.length > 0 && user?.id && isLegacyBrowserAdminMutationEnabled()) {
        const updatedAt = new Date().toISOString();
        const autoDeleteIds = autoDeleteTargets.map((record) => record.id);

        const { error: autoDeleteError } = await supabase
          .from('restaurants')
          .update({
            status: 'deleted',
            db_error_message: MISSING_EVALUATION_AUTO_DELETE_MESSAGE,
            updated_by_admin_id: user.id,
            updated_at: updatedAt,
          })
          .in('id', autoDeleteIds);

        if (autoDeleteError) throw autoDeleteError;

        const autoDeleteIdSet = new Set(autoDeleteIds);
        typedRecords = typedRecords.map((record) => (
          autoDeleteIdSet.has(record.id)
            ? {
                ...record,
                status: 'deleted',
                db_error_message: MISSING_EVALUATION_AUTO_DELETE_MESSAGE,
                updated_by_admin_id: user.id,
                updated_at: updatedAt,
              }
            : record
        ));

        const reasonSummary = [...new Set(autoDeleteTargets
          .map(getMissingEvaluationAutoDeleteReason)
          .filter(Boolean))].join(' · ');
        toast({
          title: '미발견 맛집 자동 삭제',
          description: `${autoDeleteTargets.length}건을 삭제 상태로 전환했습니다.${reasonSummary ? ` (${reasonSummary})` : ''}`,
        });
      }

      setAllRecords(typedRecords);

      // 통계 계산 (전체 레코드 기준)
      const deletedCount = typedRecords.filter(r => r.status === 'deleted').length;

      const newStats: CategoryStats = {
        total: typedRecords.length, // 삭제 포함 전체
        pending: typedRecords.filter(r => r.status === 'pending').length,
        approved: typedRecords.filter(r => r.status === 'approved').length,
        hold: typedRecords.filter(r => r.status === 'hold').length,
        missing: typedRecords.filter(isAdminEvaluationRecordMissing).length,
        db_conflict: typedRecords.filter(r => r.status === 'db_conflict').length,
        ready_for_approval: typedRecords.filter(isAdminEvaluationRecordReadyForApproval).length,
        not_selected: typedRecords.filter(isAdminEvaluationRecordNotSelected).length,
        deleted: deletedCount,
      };
      setStats(newStats);

    } catch {
      toast({
        variant: 'destructive',
        title: '데이터 로드 실패',
        description: '검수 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
      });
      // 에러 발생 시에도 빈 배열로 설정하여 UI가 렌더링되도록
      setAllRecords([]);
      setDisplayedRecords([]);
      setStats({
        total: 0,
        pending: 0,
        approved: 0,
        hold: 0,
        missing: 0,
        db_conflict: 0,
        ready_for_approval: 0,
        not_selected: 0,
        deleted: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.id]);

  // 초기 데이터 로드
  useEffect(() => {
    // 이미 데이터를 로드했으면 건너뛰기 (컴포넌트 재마운트 시 중복 로드 방지)
    if (hasLoadedData.current) {
      return;
    }

    if (((user && isAdmin) || hasE2EAdminShellBypass) && !authLoading) {
      hasLoadedData.current = true;
      loadAllRecords();
    }
  }, [user, isAdmin, authLoading, hasE2EAdminShellBypass, loadAllRecords]);

  // 개별 레코드 업데이트 (새로고침 없이 상태 반영)
  const updateRecordInState = (recordId: string, updates: Partial<EvaluationRecord>) => {
    setAllRecords(prev =>
      prev.map(r => r.id === recordId ? { ...r, ...updates } : r)
    );
  };

  // 통계 재계산 (현재 allRecords 기준)
  const recalculateStats = useCallback(() => {
    const deletedCount = allRecords.filter(r => r.status === 'deleted').length;

    const newStats: CategoryStats = {
      total: allRecords.length, // 삭제 포함 전체
      pending: allRecords.filter(r => r.status === 'pending').length,
      approved: allRecords.filter(r => r.status === 'approved').length,
      hold: allRecords.filter(r => r.status === 'hold').length,
      db_conflict: allRecords.filter(r => r.status === 'db_conflict').length,
      ready_for_approval: allRecords.filter(isAdminEvaluationRecordReadyForApproval).length,
      missing: allRecords.filter(isAdminEvaluationRecordMissing).length,
      not_selected: allRecords.filter(isAdminEvaluationRecordNotSelected).length,
      deleted: deletedCount,
    };

    setStats(newStats);
  }, [allRecords]);

  // allRecords가 변경될 때마다 통계 재계산
  useEffect(() => {
    if (allRecords.length > 0) {
      recalculateStats();
    }
  }, [allRecords, recalculateStats]);

  // 승인 핸들러 (오류 체크 포함)
  const handleApprove = async (record: EvaluationRecord) => {
    if (needsEvaluationRerun(record)) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '평가값 또는 근거가 비어 있어 승인할 수 없습니다.',
      });
      return;
    }

    // 지오코딩 실패 체크
    if (!record.geocoding_success) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ Naver 지오코딩 실패 - 수정 후 승인하세요',
      });
      return;
    }

    // Missing 체크
    if (record.is_missing) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ Missing 음식점 - 먼저 수동 등록이 필요합니다',
      });
      return;
    }

    if (!record.jibun_address) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ 지번주소 정보가 없습니다',
      });
      return;
    }

    if (notifyRestaurantIdentityWarning(record, '승인')) {
      return;
    }

    try {
      setLoading(true);
      const adminUserId = requireAdminUserId();
      notifySameVideoDuplicateWarning(record, '승인');

      // YouTube 링크 추출 (단일 값)
      const youtubeLink = record.youtube_link || '';


      // 🔥 중복 검사 추가 (YouTube 링크 포함)
      const duplicateCheck = await checkRestaurantDuplicate(
        record.restaurant_name || record.name || '',
        record.jibun_address,
        record.id,
        youtubeLink // YouTube 링크 전달
      );


      if (duplicateCheck.isDuplicate) {

        // 🔥 수정: 유튜브 링크 비교 로직 개선
        const currentYoutubeLink = youtubeLink?.trim() || null;
        const matchedYoutubeLink = duplicateCheck.matchedRestaurant?.youtube_link?.trim() || null;


        // 유튜브 링크가 다른 경우: 확인 모달 표시
        if (currentYoutubeLink !== matchedYoutubeLink) {

          // 모달 상태 설정
          setPendingApprovalRecord(record);
          setConflictingRestaurantInfo({
            name: duplicateCheck.matchedRestaurant!.name,
            address: duplicateCheck.matchedRestaurant!.jibun_address || duplicateCheck.matchedRestaurant!.road_address || '',
          });
          setShowApprovalConfirm(true);
          setLoading(false);
          return;
        }


        // 유튜브 링크가 같은 경우: 중복 오류 처리 (기존 로직)
        // 중복 발견 시 에러 정보 저장
        const errorDetails = {
          error_type: 'duplicate' as const,
          conflicting_restaurant_id: duplicateCheck.matchedRestaurant!.id,
          detected_at: new Date().toISOString(),
        };

        // status는 유지하고 에러 메시지만 저장
        assertLegacyBrowserAdminMutationEnabled('restaurant_record', 'record duplicate error update');
        await supabase
          .from('restaurants')
          .update({
            db_error_message: '중복 후보가 확인되었습니다.',
            db_error_details: errorDetails,
          })
          .eq('id', record.id);

        // 상태 업데이트 (새로고침 없이)
        updateRecordInState(record.id, {
          db_error_message: '중복 후보가 확인되었습니다.',
          db_error_details: errorDetails,
        });

        toast({
          variant: 'destructive',
          title: '중복 오류',
          description: '중복 후보가 확인되었습니다. 검토 후 다시 시도해주세요.',
        });

        setLoading(false);
        return;
      }

      // 실제 승인 처리 실행
      await performApproval(record, adminUserId);

    } catch {
      toast({
        variant: 'destructive',
        title: '승인 처리 실패',
        description: '승인 처리에 실패했습니다. 잠시 후 다시 시도해주세요.',
      });
    } finally {
      setLoading(false);
    }
  };

  // 실제 승인 처리 실행 (중복 확인 후 재사용)
  const performApproval = async (record: EvaluationRecord, adminUserId: string) => {
    // 승인명은 관리자 수정값(approved_name)을 최우선으로 사용한다.
    // 수정 후 승인 시 naver_name/google_name이 이전 후보명으로 남아 있어도 지도 노출명은 관리자 확정명을 따라야 한다.
    const approvedName = getAdminEvaluationApprovalName(record);


    // status를 'approved'로 업데이트 및 approved_name 저장
    assertLegacyBrowserAdminMutationEnabled('restaurant_record', 'restaurant approval update');
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('restaurants')
      .update({
        status: 'approved',
        approved_name: approvedName,
        db_error_message: null, // 에러 메시지 초기화
        db_error_details: null, // 에러 상세 초기화
        updated_by_admin_id: adminUserId,
        updated_at: updatedAt,
      })
      .eq('id', record.id);
      if (error) throw error;

    // 상태 업데이트 (새로고침 없이 UI 반영)
    updateRecordInState(record.id, {
      status: 'approved',
      name: approvedName,
      approved_name: approvedName,
      restaurant_name: approvedName,
      db_error_message: null,
      db_error_details: null,
      updated_by_admin_id: adminUserId,
      updated_at: updatedAt,
      ...(record.restaurant_info
        ? {
            restaurant_info: {
              ...record.restaurant_info,
              name: approvedName,
            },
          }
        : {}),
    });

    toast({
      title: '승인 완료',
      description: `✅ "${approvedName}" 맛집이 승인되었습니다`,
    });
    void invalidateRestaurantDiscoveryQueries(queryClient);
  };

  // 삭제 핸들러 (Soft Delete)
  const handleDelete = async (record: EvaluationRecord) => {
    notifyRestaurantIdentityWarning(record, '삭제');
    notifySameVideoDuplicateWarning(record, '삭제');

    try {
      const adminUserId = requireAdminUserId();
      const updatedAt = new Date().toISOString();
      assertLegacyBrowserAdminMutationEnabled('restaurant_record', 'restaurant delete update');

      // Soft Delete: 휴지통 아이콘 클릭 즉시 status를 'deleted'로 변경
      const { error } = await supabase
        .from('restaurants')
        .update({
          status: 'deleted',
          updated_by_admin_id: adminUserId,
          updated_at: updatedAt,
        })
        .eq('id', record.id);

      if (error) throw error;

      // 상태 업데이트 (새로고침 없이)
      updateRecordInState(record.id, {
        status: 'deleted',
        updated_by_admin_id: adminUserId,
        updated_at: updatedAt,
      });

      toast({
        title: '삭제 완료',
        description: `"${record.restaurant_name || record.name}"이(가) 삭제되었습니다`,
      });
      void invalidateRestaurantDiscoveryQueries(queryClient);
      if (pendingRecordAction?.record.id === record.id) clearPendingRecordAction();
    } catch {
      toast({
        variant: 'destructive',
        title: '삭제 실패',
        description: '삭제 처리에 실패했습니다. 잠시 후 다시 시도해주세요.',
      });
    }
  };

  const handleRegisterMissing = (record: EvaluationRecord) => {
    setSelectedMissingRecord(record);
    setMissingFormOpen(true);
  };

  const handleResolveConflict = (record: EvaluationRecord) => {
    setSelectedConflictRecord(record);
    setConflictPanelOpen(true);
  };

  const handleEdit = (record: EvaluationRecord) => {
    setSelectedEditRecord(record);
    setEditModalOpen(true);
  };

  // 삭제된 레코드 복원 (pending 상태로 되돌리기)
  const handleRestore = async (record: EvaluationRecord) => {
    if (pendingRecordAction?.kind !== 'restore' || pendingRecordAction.record.id !== record.id) {
      setPendingRecordAction({ kind: 'restore', record });
      setRecordActionConfirmation('');
      return;
    }

    if (recordActionConfirmation !== EVALUATION_RESTORE_CONFIRMATION) {
      toast({
        variant: 'destructive',
        title: '확인 문구가 필요합니다',
        description: `"${EVALUATION_RESTORE_CONFIRMATION}"를 입력한 뒤 복원을 적용하세요.`,
      });
      return;
    }

    try {
      setLoading(true);
      const adminUserId = requireAdminUserId();
      const updatedAt = new Date().toISOString();
      assertLegacyBrowserAdminMutationEnabled('restaurant_record', 'restaurant restore update');

      // status를 'pending'으로 업데이트
      const { error } = await supabase
        .from('restaurants')
        .update({
          status: 'pending',
          updated_by_admin_id: adminUserId,
          updated_at: updatedAt,
        })
        .eq('id', record.id);

      if (error) throw error;

      // 상태 업데이트 (새로고침 없이)
      updateRecordInState(record.id, {
        status: 'pending',
        updated_by_admin_id: adminUserId,
        updated_at: updatedAt,
      });

      toast({
        title: '복원 완료',
        description: `"${record.restaurant_name || record.name}"이(가) 미처리 상태로 복원되었습니다`,
      });
      void invalidateRestaurantDiscoveryQueries(queryClient);
      clearPendingRecordAction();
    } catch {
      toast({
        variant: 'destructive',
        title: '복원 실패',
        description: '복원 처리에 실패했습니다. 잠시 후 다시 시도해주세요.',
      });
    } finally {
      setLoading(false);
    }
  };

  // 사용자 제보 데이터 쿼리 (새 테이블 구조)
  const { data: submissionsData = [], isLoading: submissionsLoading } = useQuery({
    queryKey: ['admin-submissions-inline', user?.id, isAdmin],
    queryFn: async () => {
      if (!user || !isAdmin) return [];

      // 1. submissions 조회 (pending 및 partially_approved)
      const { data: submissionsData, error: submissionsError } = await supabase
        .from('restaurant_submissions')
        .select(ADMIN_SUBMISSION_SELECT)
        .in('status', ['pending', 'partially_approved'])
        .order('created_at', { ascending: false })
        .overrideTypes<Record<string, unknown>[], { merge: false }>();


      if (submissionsError) throw submissionsError;
      const typedSubmissions = parseValidatedRows(submissionsData ?? [], isSubmissionRow);
      if (!typedSubmissions.length) return [];
      const submissionIds = typedSubmissions.map(s => s.id);
      const userIds = [...new Set(typedSubmissions.map(s => s.user_id))];

      // 2. items / profiles 병렬 조회
      const [{ data: itemsData }, { data: profilesData }] = await Promise.all([
        supabase
          .from('restaurant_submission_items')
          .select(ADMIN_SUBMISSION_ITEM_SELECT)
          .in('submission_id', submissionIds)
          .order('created_at', { ascending: true })
          .overrideTypes<Record<string, unknown>[], { merge: false }>(),
        supabase
          .from('profiles')
          .select('user_id, nickname')
          .in('user_id', userIds)
          .overrideTypes<Record<string, unknown>[], { merge: false }>(),
      ]);

      const typedProfilesData = parseValidatedRows(profilesData ?? [], isProfileNicknameRow);
      const typedItemsData = parseValidatedRows(itemsData ?? [], isSubmissionItem);

      const profilesMap = new Map(typedProfilesData.map((profile) => [profile.user_id, profile.nickname]));
      const itemsMap = new Map<string, SubmissionItem[]>();
      typedItemsData.forEach((item) => {
        if (!itemsMap.has(item.submission_id)) {
          itemsMap.set(item.submission_id, []);
        }
        itemsMap.get(item.submission_id)!.push(item);
      });

      // 4. 아이템별 target_restaurant_id로 기존 맛집 정보 조회
      const allItems = typedItemsData;
      const itemTargetRestaurantIds = [...new Set(
        allItems
          .map((item) => item.target_restaurant_id)
          .filter((targetRestaurantId): targetRestaurantId is string => Boolean(targetRestaurantId))
      )];


        const originalRestaurantsMap = new Map<string, SubmissionOriginalRestaurantData>();
        if (itemTargetRestaurantIds.length > 0) {
          const { data: originalData, error: originalError } = await supabase
            .from('restaurants')
            // restaurants 테이블은 trace_id / approved_name 이므로 alias로 호환 유지
            .select('id, unique_id:trace_id, name:approved_name, road_address, jibun_address, phone, categories, youtube_link, tzuyang_review, youtube_meta')
            .in('id', itemTargetRestaurantIds)
            .overrideTypes<Record<string, unknown>[], { merge: false }>();

        if (originalError) throw originalError;

        if (originalData) {
          const typedOriginalData = parseValidatedRows(originalData, isRestaurantLookupRow);
          typedOriginalData.forEach((restaurantRow) => {
            originalRestaurantsMap.set(restaurantRow.id, {
              id: restaurantRow.id,
              unique_id: restaurantRow.unique_id || '',
              name: restaurantRow.name || '이름 없음',
              road_address: restaurantRow.road_address,
              jibun_address: restaurantRow.jibun_address,
              phone: restaurantRow.phone,
              categories: restaurantRow.categories || [],
              youtube_link: restaurantRow.youtube_link,
              tzuyang_review: restaurantRow.tzuyang_review,
              youtube_meta: restaurantRow.youtube_meta || null,
            });
          });
        }
      }

      // 새 테이블 구조에 맞게 변환
      return typedSubmissions.map((s): SubmissionRecord => {
        const rawItems = itemsMap.get(s.id) || [];

        // 아이템별로 original_restaurant 추가 (target_restaurant_id로 매칭)
        const items = rawItems.map((item) => {
          const originalRestaurant = item.target_restaurant_id
            ? originalRestaurantsMap.get(item.target_restaurant_id) || null
            : null;


          return {
            ...item,
            original_restaurant: originalRestaurant,
          };
        });

        // submission 수준의 original_restaurant_data는 첫 번째 아이템 기준으로 설정 (상단 비교용)
        // submissions.target_restaurant_id는 더 이상 사용 안함 (items 레벨에서 관리)
        let originalRestaurantData = null;
        if (s.submission_type === 'edit' && items.length > 0 && items[0].original_restaurant) {
          originalRestaurantData = items[0].original_restaurant;
        }

        return {
          id: s.id,
          user_id: s.user_id,
          submission_type: s.submission_type || 'new',
          status: s.status,
          restaurant_name: s.restaurant_name,
          restaurant_address: s.restaurant_address,
          restaurant_phone: s.restaurant_phone,
          restaurant_categories: s.restaurant_categories,
          // target_restaurant_id는 submission 레벨이 아닌 items 레벨에서 관리
          admin_notes: s.admin_notes,
          rejection_reason: s.rejection_reason,
          resolved_by_admin_id: s.resolved_by_admin_id,
          reviewed_at: s.reviewed_at,
          created_at: s.created_at,
          updated_at: s.updated_at,
          items: items,
          profiles: { nickname: profilesMap.get(s.user_id) || '알 수 없음' },
          original_restaurant_data: originalRestaurantData,
        };
      });

    },
    enabled: !!user && isAdmin,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: recommendationRequestsData = [], isLoading: recommendationRequestsLoading } = useQuery({
    queryKey: ['admin-restaurant-requests-inline', user?.id, isAdmin],
    queryFn: async () => {
      if (!user || !isAdmin) return [];

      const { data: requestsData, error: requestsError } = await supabase
        .from('restaurant_requests')
        .select(ADMIN_RESTAURANT_REQUEST_SELECT)
        .in('status', ['pending', 'approved', 'rejected'])
        .order('created_at', { ascending: false })
        .overrideTypes<Record<string, unknown>[], { merge: false }>();

      let rawRequests = parseValidatedRows(requestsData ?? [], isRestaurantRequestListRow);

      if (requestsError) {
        if (!isMissingRestaurantRequestLifecycleError(requestsError)) throw requestsError;

        const { data: legacyRequestsData, error: legacyRequestsError } = await supabase
          .from('restaurant_requests')
          .select(ADMIN_RESTAURANT_REQUEST_LEGACY_SELECT)
          .order('created_at', { ascending: false })
          .overrideTypes<Record<string, unknown>[], { merge: false }>();

        if (legacyRequestsError) throw legacyRequestsError;
        rawRequests = parseValidatedRows(legacyRequestsData ?? [], isRestaurantRequestListRow);
      }

      if (!rawRequests.length) return [];

      const typedRequests = rawRequests;
      const userIds = [...new Set(typedRequests.map((request) => request.user_id).filter(Boolean))];

      const { data: profilesData } = userIds.length
        ? await supabase
          .from('profiles')
          .select('user_id, nickname')
          .in('user_id', userIds)
          .overrideTypes<Record<string, unknown>[], { merge: false }>()
        : { data: [] };

      const typedProfilesData = parseValidatedRows(profilesData ?? [], isProfileNicknameRow);
      const profilesMap = new Map(typedProfilesData.map((profile) => [profile.user_id, profile.nickname]));

      return typedRequests.map((request): SubmissionRecord => ({
        id: request.id,
        user_id: request.user_id,
        submission_type: 'recommend' as const,
        status: request.status || 'pending',
        restaurant_name: request.restaurant_name,
        restaurant_address: request.road_address || request.jibun_address || request.origin_address,
        restaurant_phone: request.phone,
        restaurant_categories: request.categories,
        admin_notes: request.admin_note ?? null,
        rejection_reason: request.rejection_reason ?? null,
        resolved_by_admin_id: request.reviewed_by_admin_id ?? null,
        reviewed_at: request.reviewed_at ?? null,
        created_at: request.created_at,
        updated_at: request.updated_at || request.created_at,
        items: [{
          id: `${request.id}:recommend`,
          submission_id: request.id,
          youtube_link: request.youtube_link || '',
          tzuyang_review: request.recommendation_reason || '',
          target_restaurant_id: null,
          item_status: request.status || 'pending',
          rejection_reason: request.rejection_reason ?? null,
          created_at: request.created_at,
        }],
        profiles: { nickname: profilesMap.get(request.user_id) || '알 수 없음' },
        recommendation_reason: request.recommendation_reason ?? null,
        recommendation_status: request.status || 'pending',
        recommendation_admin_note: request.admin_note ?? null,
        recommendation_audit_id: request.review_audit_id ?? null,
        original_restaurant_data: null,
      }));
    },
    enabled: !!user && isAdmin,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const allSubmissionRecords = useMemo(
    () => [...submissionsData, ...recommendationRequestsData],
    [submissionsData, recommendationRequestsData],
  );

  const updateRecommendationRequestReadbackInCache = useCallback((submission: SubmissionRecord) => {
    queryClient.setQueryData<SubmissionRecord[]>(
      ['admin-restaurant-requests-inline', user?.id, isAdmin],
      (current) =>
        current?.map((currentSubmission) =>
          currentSubmission.id === submission.id ? submission : currentSubmission,
        ) ?? current,
    );
  }, [isAdmin, queryClient, user?.id]);

  // 리뷰 데이터 쿼리
  const { data: reviewsData = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['admin-reviews-inline', user?.id, isAdmin],
    queryFn: async () => {
      if (!user || !isAdmin) return [];

      const { data: reviewsData, error: reviewsError } = await supabase
        .from('reviews')
        .select(ADMIN_REVIEW_SELECT)
        .eq('is_verified', false)
        .order('created_at', { ascending: false })
        .overrideTypes<Record<string, unknown>[], { merge: false }>();

      if (reviewsError) throw reviewsError;
      const typedReviewsData = (reviewsData ?? [])
        .map(parseReview)
        .filter((review): review is Omit<Review, 'profiles' | 'restaurants'> => review !== null);
      if (!typedReviewsData.length) return [];
      const userIds = [...new Set(typedReviewsData.map(r => r.user_id))];
      const restaurantIds = [...new Set(typedReviewsData.map(r => r.restaurant_id))];

      const [{ data: profilesData }, { data: restaurantsData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, nickname')
          .in('user_id', userIds)
          .overrideTypes<Record<string, unknown>[], { merge: false }>(),
        supabase
          .from('restaurants')
          .select('id, approved_name, road_address, jibun_address')
          .in('id', restaurantIds)
          .overrideTypes<Record<string, unknown>[], { merge: false }>(),
      ]);

      const typedProfilesData = parseValidatedRows(profilesData ?? [], isProfileNicknameRow);
      const typedRestaurantsData = parseValidatedRows(restaurantsData ?? [], isReviewRestaurantRow);

      const profilesMap = new Map(typedProfilesData.map(p => [p.user_id, p.nickname]));
      const restaurantsMap = new Map(typedRestaurantsData.map(r => [r.id, { name: r.approved_name || '이름 없음', address: r.road_address || r.jibun_address || '' }]));

      return typedReviewsData.map((review): Review => ({
        ...review,
        profiles: { nickname: profilesMap.get(review.user_id) || '탈퇴한 사용자' },
        restaurants: restaurantsMap.get(review.restaurant_id) || { name: '삭제된 맛집', address: '' }
      }));
    },
    enabled: !!user && isAdmin,
    refetchInterval: 30000,
  });

  const { data: canonicalPendingCounts } = useQuery({
    queryKey: [...ADMIN_PENDING_COUNTS_QUERY_KEY, user?.id, isAdmin],
    queryFn: fetchAdminEvaluationPendingCounts,
    enabled: !!user && isAdmin,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // pending 리뷰(미승인, 거부 아닌) 건수 계산
  const pendingReviewsCount = useMemo(() => {
    return reviewsData.filter((r: Review) =>
      !r.is_verified && (!r.admin_note || !r.admin_note.includes('거부'))
    ).length;
  }, [reviewsData]);

  const localPendingCounts = useMemo(() => {
    const pendingRecommendationRequests = recommendationRequestsData.filter(
      (request) => request.status === 'pending',
    ).length;

    return buildAdminPendingCountsResponse({
      restaurantSubmissions: submissionsData.length,
      restaurantRecommendationRequests: pendingRecommendationRequests,
      reviews: pendingReviewsCount,
      recommendationRequestsLifecycleReady: true,
    });
  }, [pendingReviewsCount, recommendationRequestsData, submissionsData.length]);

  const pendingCounts = canonicalPendingCounts ?? localPendingCounts;

  const pendingRestaurantSubmissionCount =
    pendingCounts.domains.restaurant_submissions.count;
  const pendingRecommendationCount =
    pendingCounts.domains.restaurant_recommendation_requests.count;
  const pendingReviewCount = pendingCounts.domains.reviews.count;

  // 전체 대기 건수 (제보 + 리뷰)
  const totalPendingCount = getAdminPendingCountsTotal(pendingCounts);
  const pendingQueueSummaryText = showSubmissionView
    ? `제보/리뷰 대기: 제보 ${pendingRestaurantSubmissionCount}건 | 추천 ${pendingRecommendationCount}건 | 리뷰 ${pendingReviewCount}건 | 전체 ${totalPendingCount}건`
    : `필터링: ${filteredRecords.length}개 | 현 ${stats.total}개 레코드 | 삭제한 레코드 ${stats.deleted}개`;
  const isInitialEvaluationDataLoading = !showSubmissionView && loading && allRecords.length === 0;
  const pendingQueueSummaryContent = showSubmissionView || !isInitialEvaluationDataLoading
    ? pendingQueueSummaryText
    : '필터링: 집계 중 | 현 레코드 집계 중 | 삭제한 레코드 집계 중';

  // 리뷰 승인 mutation
  const approveReviewMutation = useMutation({
    mutationFn: async ({ reviewId, adminNote }: { reviewId: string; adminNote: string }) => {
      const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('user_id, restaurant_id, is_verified')
        .eq('id', reviewId)
        .single()
        .overrideTypes<Record<string, unknown>, { merge: false }>();

      if (reviewError) throw reviewError;
      if (!isReviewApprovalTargetRow(review)) {
        throw new Error('review-approval-target-invalid');
      }
      const typedReview = review;
      const wasAlreadyVerified = typedReview.is_verified;

      // 레스토랑 이름 조회
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('name:approved_name, review_count')
        .eq('id', typedReview.restaurant_id)
        .single()
        .overrideTypes<Record<string, unknown>, { merge: false }>();
      const typedRestaurant = isRestaurantReviewCountRow(restaurant) ? restaurant : null;
      assertPrivacySafe({ adminNote });

      assertLegacyBrowserAdminMutationEnabled('review_moderation', 'review approval update');
      const { error: approveError } = await supabase.from('reviews')
        .update({
          is_verified: true,
          admin_note: adminNote || null,
          is_edited_by_admin: !!adminNote,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);

      if (approveError) throw approveError;

      if (!wasAlreadyVerified) {
        await supabase.from('restaurants')
          .update({
            review_count: (typedRestaurant?.review_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', typedReview.restaurant_id);
      }

      return {
        reviewId,
        userId: typedReview.user_id,
        restaurantName: typedRestaurant?.name || '맛집'
      };
    },
    onSuccess: ({ userId, restaurantName }) => {
      toast({ title: '리뷰 승인됨', description: '리뷰가 승인되었습니다.' });
      // 리뷰 작성자에게 승인 알림 전송
      if (userId) {
        createReviewApprovedNotification(userId, restaurantName);
      }
      queryClient.invalidateQueries({ queryKey: ['admin-reviews-inline'] });
      invalidateAdminPendingCounts();
    },
    onError: () => {
      toast({ variant: 'destructive', title: '승인 실패', description: '리뷰 승인 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    },
  });

  // 리뷰 거부 mutation
  const rejectReviewMutation = useMutation({
    mutationFn: async ({ reviewId, adminNote }: { reviewId: string; adminNote: string }) => {
      const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('user_id, restaurant_id, is_verified')
        .eq('id', reviewId)
        .single()
        .overrideTypes<Record<string, unknown>, { merge: false }>();

      if (reviewError) throw reviewError;
      if (!isReviewApprovalTargetRow(review)) {
        throw new Error('review-rejection-target-invalid');
      }
      const typedReview = review;

      // 레스토랑 이름 조회
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('name:approved_name, review_count')
        .eq('id', typedReview.restaurant_id)
        .single()
        .overrideTypes<Record<string, unknown>, { merge: false }>();
      const typedRestaurant = isRestaurantReviewCountRow(restaurant) ? restaurant : null;

      const rejectionReason = adminNote || '관리자에 의해 거부됨';
      assertPrivacySafe({ rejectionReason });
      assertLegacyBrowserAdminMutationEnabled('review_moderation', 'review rejection update');
      const { error: rejectError } = await supabase.from('reviews')
        .update({
          is_verified: false,
          admin_note: `거부: ${rejectionReason}`,
          is_edited_by_admin: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);

      if (rejectError) throw rejectError;

      if (typedReview.is_verified) {
        await supabase.from('restaurants')
          .update({
            review_count: Math.max((typedRestaurant?.review_count ?? 0) - 1, 0),
            updated_at: new Date().toISOString(),
          })
          .eq('id', typedReview.restaurant_id);
      }

      return {
        reviewId,
        userId: typedReview.user_id,
        restaurantName: typedRestaurant?.name || '맛집',
        rejectionReason
      };
    },
    onSuccess: ({ userId, restaurantName, rejectionReason }) => {
      toast({ title: '리뷰 거부됨', description: '리뷰가 거부되었습니다.' });
      // 리뷰 작성자에게 거부 알림 전송 (거부 사유 포함)
      if (userId) {
        createReviewRejectedNotification(userId, restaurantName, rejectionReason);
      }
      queryClient.invalidateQueries({ queryKey: ['admin-reviews-inline'] });
      invalidateAdminPendingCounts();
    },
    onError: () => {
      toast({ variant: 'destructive', title: '거부 실패', description: '리뷰 거부 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    },
  });

  // 리뷰 삭제 mutation (이미지도 함께 삭제)
  const deleteReviewMutation = useMutation({
    mutationFn: async (reviewId: string) => {
      // 1. 리뷰 정보 조회 (이미지 경로 확인)
      const { data: reviewData, error: fetchError } = await supabase
        .from('reviews')
        .select('verification_photo, food_photos')
        .eq('id', reviewId)
        .single()
        .overrideTypes<Record<string, unknown>, { merge: false }>();

      if (fetchError) throw fetchError;

      const review = isReviewPhotoRow(reviewData) ? reviewData : null;

      assertLegacyBrowserAdminMutationEnabled('review_moderation', 'review delete mutation');
      // 2. Storage에서 이미지 삭제
      const photosToDelete: string[] = [];

      if (review?.verification_photo) {
        photosToDelete.push(review.verification_photo);
      }

      if (review?.food_photos && Array.isArray(review.food_photos)) {
        photosToDelete.push(...review.food_photos);
      }

      if (photosToDelete.length > 0) {
        await supabase.storage
          .from('review-photos')
          .remove(photosToDelete);
      }

      // 3. DB에서 리뷰 삭제
      const { error } = await supabase.from('reviews').delete().eq('id', reviewId);
      if (error) throw error;

      return { deletedPhotos: photosToDelete.length };
    },
    onSuccess: ({ deletedPhotos }) => {
      toast({
        title: '리뷰 삭제됨',
        description: `리뷰가 삭제되었습니다. (이미지 ${deletedPhotos}개 삭제)`
      });
      queryClient.invalidateQueries({ queryKey: ['admin-reviews-inline'] });
      invalidateAdminPendingCounts();
    },
    onError: () => {
      toast({ variant: 'destructive', title: '삭제 실패', description: '리뷰 삭제 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    },
  });

  // 제보 승인 mutation (새 테이블 구조 - 아이템별 처리)
		  const approveSubmissionMutation = useMutation({
		    mutationFn: async ({
      submission,
      approvalData,
      itemDecisions,
      forceApprove,
      editableData,
      adminNote
	    }: {
      submission: SubmissionRecord;
      approvalData: ApprovalData;
      itemDecisions: Record<string, ItemDecision>;
	      forceApprove: boolean;
	      editableData: { name: string; address: string; phone: string; categories: string[] };
	      adminNote?: string;
		    }) => {
		      if (!user) throw new Error('로그인이 필요합니다');
      const trimmedApprovalAuditNote = adminNote?.trim() || '';
      const approvalAuditNote = [
        trimmedApprovalAuditNote,
        forceApprove && !trimmedApprovalAuditNote.includes('forceApprove=true') ? 'forceApprove=true' : '',
      ].filter(Boolean).join('\n') || null;
      assertPrivacySafe({ adminNote: trimmedApprovalAuditNote });

      if (submission.submission_type === 'recommend') {
        const response = await fetch(`/api/admin/restaurant-requests/${encodeURIComponent(submission.id)}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'approve',
            ...(adminNote?.trim() ? { adminNote: adminNote.trim() } : {}),
          }),
        });
        const payload: unknown = await response.json().catch(() => null);
        const data = parseRestaurantRequestReviewResponse(payload);
        if (!response.ok || !data?.success || !data.request || !data.auditId) {
          throw new Error('추천 승인에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
        return {
          submission: applyRestaurantRequestReadbackToSubmission(
            submission,
            data.request,
            data.auditId,
            'approved',
          ),
          restaurant: null,
          recommendationAuditId: data.auditId,
        };
      }
      assertLegacyBrowserAdminMutationEnabled('restaurant_submission', 'submission approval direct RPC/update');
      // Submission approval RPCs are absent from generated database types.

	      const lat = parseFloat(approvalData.lat);
      const lng = parseFloat(approvalData.lng);
      if (isNaN(lat) || isNaN(lng)) throw new Error('올바른 좌표가 필요합니다');

      // 승인할 아이템들 수집
      const approvedItems = submission.items.filter((item: SubmissionItem) =>
        item.item_status === 'pending' && itemDecisions[item.id]?.approved
      );

      if (approvedItems.length === 0) {
        throw new Error('승인할 항목이 없습니다');
      }

      // 검증: 승인된 모든 아이템에 tzuyang_review와 metaData가 있어야 함
      for (const item of approvedItems) {
        const decision = itemDecisions[item.id];
        if (!decision.tzuyang_review?.trim()) {
          throw new Error('쯔양 리뷰를 입력해주세요');
        }
        if (!decision.metaData) {
          throw new Error('YouTube 메타데이터가 없습니다. 메타데이터를 불러온 뒤 승인해주세요.');
        }
      }

      let restaurant = null;

      // 각 아이템별로 RPC 호출 (unique_id 생성, 중복 검사 등은 RPC에서 처리)
      for (const item of submission.items) {
        if (item.item_status !== 'pending') continue;

        const decision = itemDecisions[item.id];
        if (decision?.approved) {
          // 관리자가 수정한 데이터로 restaurantData 구성
          const restaurantData = {
            name: editableData.name,
            phone: editableData.phone || null,
            categories: editableData.categories || [],
            tzuyang_review: decision.tzuyang_review || null,  // 관리자가 수정한 리뷰
            youtube_link: decision.youtube_link || item.youtube_link || null,  // 관리자가 수정한 링크
            jibun_address: approvalData.jibun_address,
            road_address: approvalData.road_address,
            english_address: approvalData.english_address || null,
            address_elements: approvalData.address_elements || {},
            lat,
            lng,
            // YouTube 메타데이터 (모달에서 가져온 값)
            youtube_meta: decision.metaData ? {
              title: decision.metaData.title,
              published_at: decision.metaData.publishedAt,
              duration: decision.metaData.duration,
              is_shorts: decision.metaData.is_shorts,
              is_ads: decision.metaData.ads_info?.is_ads ?? false,
              what_ads: decision.metaData.ads_info?.what_ads ?? null,
            } : null,
          };

          assertPrivacySafe(restaurantData, { locationClass: 'business' });

	          if (submission.submission_type === 'edit' && item.target_restaurant_id) {
	            // 수정 제보: approve_edit_submission_item RPC 호출
            const { data: result, error } = await callSubmissionApprovalRpc(
	              'approve_edit_submission_item',
	              {
	                p_item_id: item.id,
                p_admin_user_id: user.id,
                p_updated_data: restaurantData,
	              }
	            );
	            if (error) throw error;
            const rpcResult = parseApprovalRpcResult(result);
	            if (rpcResult && !rpcResult.success) {
	              throw new Error('수정 승인에 실패했습니다.');
	            }
	            restaurant = { id: rpcResult?.restaurant_id || item.target_restaurant_id };
	          } else {
	            // 신규 제보: approve_submission_item RPC 호출
            const { data: result, error } = await callSubmissionApprovalRpc(
	              'approve_submission_item',
	              {
	                p_item_id: item.id,
                p_admin_user_id: user.id,
                p_restaurant_data: restaurantData,
	              }
	            );
	            if (error) throw error;
            const rpcResult = parseApprovalRpcResult(result);
	            if (rpcResult && !rpcResult.success) {
	              throw new Error('승인에 실패했습니다.');
	            }
	            restaurant = { id: rpcResult?.created_restaurant_id };
	          }
	        } else {
	          // 거부
          assertPrivacySafe({
            rejectionReason: decision?.rejectionReason || '관리자에 의해 반려됨',
          });
          const { error: itemRejectionError } = await supabase
            .from('restaurant_submission_items')
            .update<{
              item_status: 'rejected';
              rejection_reason: string;
            }>({
              item_status: 'rejected',
              rejection_reason: decision?.rejectionReason || '관리자에 의해 반려됨',
            })
            .eq('id', item.id);
          if (itemRejectionError) throw itemRejectionError;
	        }
	      }

	      // 관리자 메모 업데이트
      const { error: submissionUpdateError } = await restaurantSubmissionMutation()
        .update({
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
          ...(approvalAuditNote ? { admin_notes: approvalAuditNote } : {}),
        })
        .eq('id', submission.id);
      if (submissionUpdateError) throw submissionUpdateError;

      return { submission, restaurant, recommendationAuditId: null };
    },
    onSuccess: ({ submission, recommendationAuditId }) => {
      if (submission.submission_type === 'recommend') {
        updateRecommendationRequestReadbackInCache(submission);
        toast({ title: '추천 승인 완료', description: `추천이 승인되었습니다. 감사 ID: ${recommendationAuditId || '확인됨'}` });
        queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
        invalidateAdminPendingCounts();
        return;
      }
      toast({ title: '제보 승인 완료', description: `"${submission.restaurant_name}" 맛집이 등록되었습니다` });
      createNewRestaurantNotification(submission.restaurant_name, submission.restaurant_address || '', {
        category: submission.restaurant_categories,
        submissionId: submission.id
      });
      // 제보자에게 승인 알림 전송
      if (submission.user_id) {
        createSubmissionApprovedNotification(
          submission.user_id,
          submission.restaurant_name,
          submission.submission_type,
          { submissionId: submission.id }
        );
      }
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
      queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
      invalidateAdminPendingCounts();
      void invalidateRestaurantDiscoveryQueries(queryClient);
      if (currentSubmissionIndex >= submissionsData.length - 1 && currentSubmissionIndex > 0) {
        setCurrentSubmissionIndex(currentSubmissionIndex - 1);
      }
    },
	    onError: () => {
	      toast({ variant: 'destructive', title: '승인 실패', description: '제보 승인 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' });
	    },
	  });

  // 제보 거부 mutation (모든 아이템 거부)
  const rejectSubmissionMutation = useMutation({
    mutationFn: async ({ submission, reason }: { submission: SubmissionRecord; reason: string }) => {
      if (!user) throw new Error('로그인이 필요합니다');
      assertPrivacySafe({ rejectionReason: reason });

      if (submission.submission_type === 'recommend') {
        const response = await fetch(`/api/admin/restaurant-requests/${encodeURIComponent(submission.id)}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reject',
            rejectionReason: reason,
          }),
        });
        const payload: unknown = await response.json().catch(() => null);
        const data = parseRestaurantRequestReviewResponse(payload);
        if (!response.ok || !data?.success || !data.request || !data.auditId) {
          throw new Error('추천 거부에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
        return {
          submission: applyRestaurantRequestReadbackToSubmission(
            submission,
            data.request,
            data.auditId,
            'rejected',
          ),
          reason: data.request.rejection_reason || reason,
          recommendationAuditId: data.auditId,
        };
      }
      assertLegacyBrowserAdminMutationEnabled('restaurant_submission', 'submission rejection direct update');

	      // 모든 pending 아이템 거부
	      for (const item of submission.items) {
	        if (item.item_status === 'pending') {
          await supabase
            .from('restaurant_submission_items')
            .update<{
              item_status: 'rejected';
              rejection_reason: string;
            }>({
              item_status: 'rejected',
              rejection_reason: reason,
            })
	            .eq('id', item.id);
	        }
	      }

	      // 제보 상태 업데이트
      const { error } = await restaurantSubmissionMutation()
        .update({
          rejection_reason: reason,
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
	        .eq('id', submission.id);
      if (error) throw error;
      return { submission, reason, recommendationAuditId: null };
    },
    onSuccess: ({ submission, reason, recommendationAuditId }) => {
      if (submission.submission_type === 'recommend') {
        updateRecommendationRequestReadbackInCache(submission);
        toast({ title: '추천 거부됨', description: `추천이 거부되었습니다. 감사 ID: ${recommendationAuditId || '확인됨'}` });
        queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
        invalidateAdminPendingCounts();
        return;
      }
      toast({ title: '제보 거부됨', description: `"${submission.restaurant_name}" 제보가 거부되었습니다` });
      // 제보자에게 거부 알림 전송 (거부 사유 포함)
      if (submission.user_id) {
        createSubmissionRejectedNotification(
          submission.user_id,
          submission.restaurant_name,
          reason || '관리자에 의해 반려됨',
          submission.submission_type,
          { submissionId: submission.id }
        );
      }
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
      queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
      invalidateAdminPendingCounts();
      if (currentSubmissionIndex >= submissionsData.length - 1 && currentSubmissionIndex > 0) {
        setCurrentSubmissionIndex(currentSubmissionIndex - 1);
      }
    },
	    onError: () => {
	      toast({ variant: 'destructive', title: '거부 실패', description: '제보 거부 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' });
	    },
	  });

  // 제보 삭제 mutation (모든 아이템 거부로 변경)
  const deleteSubmissionMutation = useMutation({
    mutationFn: async (submission: SubmissionRecord) => {
      if (!user) throw new Error('로그인이 필요합니다');

      if (submission.submission_type === 'recommend') {
        const response = await fetch(`/api/admin/restaurant-requests/${encodeURIComponent(submission.id)}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reject',
            rejectionReason: '관리자에 의해 삭제 처리됨',
          }),
        });
        const payload: unknown = await response.json().catch(() => null);
        const data = parseRestaurantRequestReviewResponse(payload);
        if (!response.ok || !data?.success || !data.auditId) {
          throw new Error('추천 삭제 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
        return applyRestaurantRequestReadbackToSubmission(
          submission,
          data.request,
          data.auditId,
          'rejected',
        );
      }
      assertLegacyBrowserAdminMutationEnabled('restaurant_submission', 'submission delete direct update');

	      // 모든 pending 아이템 거부
	      for (const item of submission.items) {
	        if (item.item_status === 'pending') {
          await supabase
            .from('restaurant_submission_items')
            .update<{
              item_status: 'rejected';
              rejection_reason: string;
            }>({
              item_status: 'rejected',
              rejection_reason: '관리자에 의해 삭제됨',
            })
	            .eq('id', item.id);
	        }
	      }

	      // 제보 상태 업데이트
      const { error } = await restaurantSubmissionMutation()
        .update({
          rejection_reason: '관리자에 의해 삭제됨',
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
	        .eq('id', submission.id);
      if (error) throw error;
      return submission;
    },
    onSuccess: (submission) => {
      if (submission.submission_type === 'recommend') {
        updateRecommendationRequestReadbackInCache(submission);
        toast({ title: '추천 삭제 처리됨', description: `"${submission.restaurant_name}" 추천이 거부 상태로 처리되었습니다. 감사 ID: ${submission.recommendation_audit_id || '확인됨'}` });
        queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
        invalidateAdminPendingCounts();
        return;
      }
      toast({ title: '제보 삭제됨', description: `"${submission.restaurant_name}" 제보가 삭제되었습니다` });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
      queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
      invalidateAdminPendingCounts();
      if (currentSubmissionIndex >= submissionsData.length - 1 && currentSubmissionIndex > 0) {
        setCurrentSubmissionIndex(currentSubmissionIndex - 1);
      }
    },
	    onError: () => {
	      toast({ variant: 'destructive', title: '삭제 실패', description: '제보 삭제 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' });
	    },
	  });

  // 핸들러 함수 (새 테이블 구조에 맞게 수정)
  const handleApproveSubmission = (
    submission: SubmissionRecord,
    approvalData: ApprovalData,
    itemDecisions: Record<string, ItemDecision>,
    forceApprove: boolean,
    editableData: { name: string; address: string; phone: string; categories: string[] },
    adminNote?: string
  ) => {
    approveSubmissionMutation.mutate({ submission, approvalData, itemDecisions, forceApprove, editableData, adminNote });
  };

  const handleRejectSubmission = (submission: SubmissionRecord, reason: string) => {
    rejectSubmissionMutation.mutate({ submission, reason });
  };

  const handleDeleteSubmission = (submission: SubmissionRecord) => {
    deleteSubmissionMutation.mutate(submission);
  };

  // 리뷰 핸들러
  const handleApproveReview = (review: Review, adminNote: string) => {
    approveReviewMutation.mutate({ reviewId: review.id, adminNote });
  };

  const handleRejectReview = (review: Review, adminNote: string) => {
    rejectReviewMutation.mutate({ reviewId: review.id, adminNote });
  };

  const handleDeleteReview = (review: Review) => {
    deleteReviewMutation.mutate(review.id);
  };

  // 제보 수정 저장 mutation (새 테이블 구조)
  const updateSubmissionMutation = useMutation({
    mutationFn: async (data: {
      submission: SubmissionRecord;
      updatedData: {
        restaurant_name: string;
        address: string;
        phone: string;
        categories: string[];
        youtube_link: string;
        description: string;
      };
    }) => {
      const { submission, updatedData } = data;
      assertPrivacySafe(updatedData);

      assertLegacyBrowserAdminMutationEnabled('restaurant_submission', 'submission edit direct update');
	      // 제보 기본 정보 업데이트
      const { error } = await restaurantSubmissionMutation()
        .update({
          restaurant_name: updatedData.restaurant_name,
          restaurant_address: updatedData.address,
          restaurant_phone: updatedData.phone || null,
          restaurant_categories: updatedData.categories,
        })
        .eq('id', submission.id);

      if (error) throw error;

	      // 첫 번째 아이템의 youtube_link와 tzuyang_review 업데이트
	      if (submission.items.length > 0) {
	        const firstItem = submission.items[0];
        await supabase
          .from('restaurant_submission_items')
          .update<{
            youtube_link: string;
            tzuyang_review: string | null;
          }>({
            youtube_link: updatedData.youtube_link,
            tzuyang_review: updatedData.description || null,
          })
          .eq('id', firstItem.id);
	      }

      return submission;
    },
    onSuccess: (submission) => {
      toast({ title: '제보 수정 완료', description: '제보 정보가 수정되었습니다' });
      queryClient.invalidateQueries({
        queryKey: ['admin-submissions-inline'],
        refetchType: 'all',
      });
      void invalidateRestaurantDiscoveryQueries(queryClient);
      setEditingSubmission(null);
      setEditModalOpen(false);
    },
	    onError: () => {
	      toast({ variant: 'destructive', title: '수정 실패', description: '제보 수정 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' });
	    },
	  });

  // 인증 게이트는 전체 화면으로 막되, 데이터 로딩은 아래 실제 화면 요소별 스켈레톤으로 처리합니다.
  if (!embedded && authLoading) {
    return <AdminEvaluationRouteSkeleton />;
  }

  // 로그인하지 않았거나 관리자가 아닌 경우 (리다이렉트 전 화면 방지)
  if (!hasE2EAdminShellBypass && !authLoading && (!user || !isAdmin)) {
    return null;
  }

  const pendingRecordActionRequiredPhrase = EVALUATION_RESTORE_CONFIRMATION;
  const pendingRecordActionVerb = '복원';
  const pendingRecordActionName = pendingRecordAction
    ? (pendingRecordAction.record.restaurant_name || pendingRecordAction.record.name || '선택한 검수 항목')
    : '';
  const pendingRecordActionDuplicateWarnings = pendingRecordAction
    ? getSameVideoDuplicateWarnings(pendingRecordAction.record)
    : [];
  const pendingRecordActionIdentityWarnings = pendingRecordAction
    ? getRestaurantIdentityWarnings(pendingRecordAction.record)
    : [];

  const embeddedModuleId: Extract<AdminConsoleRouteModuleId, 'restaurants' | 'submissions' | 'reviews'> = showSubmissionView
    ? (submissionInitialTab === 'reviews' ? 'reviews' : 'submissions')
    : 'restaurants';

  return (
    <div
      ref={scrollContainerRef}
      className="flex h-full min-h-0 flex-col overflow-auto"
      id="scroll-container"
      data-admin-embedded-module-shell={embedded ? "true" : undefined}
      data-admin-embedded-module-id={embedded ? embeddedModuleId : undefined}
    >
      {/* Header */}
      <div
        className={embedded ? "shrink-0 border-b border-border bg-card px-2 py-1.5" : "border-b border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3"}
        data-admin-module-header={embedded ? "compact" : undefined}
        data-admin-module-header-module={embedded ? embeddedModuleId : undefined}
      >
        <div className={embedded ? "flex flex-row items-start justify-between gap-1.5 lg:items-center" : "flex flex-row items-start justify-between gap-2.5 lg:items-center"}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <AdminEvaluationTitleIcon embedded={embedded} />
              <h1 className={embedded ? "whitespace-nowrap bg-gradient-primary bg-clip-text text-base font-bold text-transparent" : "whitespace-nowrap bg-gradient-primary bg-clip-text text-lg font-bold text-transparent sm:text-2xl"}>
                관리자 데이터 검수
              </h1>
            </div>
            {deepLinkFilter && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">딥링크 필터:</span>
                {deepLinkFilter.videoId && (
                  <Badge variant="secondary" className="max-w-full truncate">
                    video_id: {deepLinkFilter.videoId}
                  </Badge>
                )}
                {deepLinkFilter.issue && (
                  <Badge variant="outline" className="max-w-full truncate">
                    issue: {deepLinkFilter.issue}
                  </Badge>
                )}
                {deepLinkFilter.reason && (
                  <Badge variant="outline" className="max-w-full truncate">
                    reason: {deepLinkFilter.reason}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={clearDeepLinkFilter}
                >
                  필터 해제
                </Button>
              </div>
            )}
            <div className={embedded ? "mt-0.5 truncate text-xs text-muted-foreground" : "mt-0.5 truncate text-xs text-muted-foreground sm:text-sm"} data-admin-module-summary={embedded ? "true" : undefined}>
              {pendingQueueSummaryContent}
            </div>
          </div>

          {/* 우측: 카테고리 필터 */}
          <div className="w-auto shrink-0 lg:flex lg:flex-1 lg:justify-end">
            <CategorySidebar
              stats={stats}
              selectedStatuses={selectedStatuses}
              onSelectStatuses={setSelectedStatuses}
            >
              <div className="ml-auto flex items-center justify-end gap-1.5 lg:gap-1" data-admin-evaluation-view-actions="top-right" data-admin-module-actions={embedded ? "top-right" : undefined}>
                {canSwitchEvaluationView && (
                  <>
                    <Button
                      variant={!isAlternateView && !showSubmissionView ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={switchToEvaluationListView}
                      title="리스트 뷰"
                      aria-label="리스트 뷰"
                      aria-pressed={!isAlternateView && !showSubmissionView}
                      data-admin-evaluation-view-toggle="list"
                    >
                      <LayoutList className="h-4 w-4" />
                      <span className="sr-only">리스트</span>
                    </Button>
                    <Button
                      variant={isAlternateView && !showSubmissionView ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={switchToEvaluationSlideView}
                      title="슬라이드 뷰"
                      aria-label="슬라이드 뷰"
                      aria-pressed={isAlternateView && !showSubmissionView}
                      data-admin-evaluation-view-toggle="slide"
                    >
                      <MonitorPlay className="h-4 w-4" />
                      <span className="sr-only">슬라이드</span>
                    </Button>
                  </>
                )}
                {!embedded && (
                  <>
                    {/* 사용자 제보 검수 버튼 */}
                    <Button
                      onClick={() => {
                        const newShowSubmission = !showSubmissionView;
                        setShowSubmissionView(newShowSubmission);
                        if (newShowSubmission) {
                          setCurrentSubmissionIndex(0);
                          setIsAlternateView(false); // 슬라이드 뷰 비활성화
                        }
                      }}
                      variant={showSubmissionView ? 'secondary' : 'ghost'}
                      size="sm"
                      className="relative h-8 gap-1 px-2 text-xs lg:h-8 lg:w-8 lg:gap-1 lg:px-0"
                      title={`사용자 제보/리뷰 검수 (제보 ${pendingRestaurantSubmissionCount}건, 추천 ${pendingRecommendationCount}건, 리뷰 ${pendingReviewCount}건)`}
                      aria-label={`사용자 제보/리뷰 검수, 대기 ${totalPendingCount}건`}
                    >
                      <Send className="h-4 w-4 shrink-0" />
                      <span className="lg:hidden">제보</span>
                      {totalPendingCount > 0 && (
                        <>
                          <span className="inline-flex md:inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white lg:hidden">
                            {totalPendingCount > 99 ? '99+' : totalPendingCount}
                          </span>
                          <span className="absolute -right-1 top-0 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white lg:flex">
                            {totalPendingCount > 9 ? '9+' : totalPendingCount}
                          </span>
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>

              {/* 구분선 */}
              <div className="hidden h-6 w-px bg-border sm:block" />
            </CategorySidebar>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col" data-admin-module-content={embedded ? "bounded" : undefined}>
        {pendingRecordAction && (
          <section
            role="region"
            aria-label="검수 항목 작업 확인"
            className="mx-2 mt-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm shadow-sm sm:mx-3"
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {pendingRecordActionName} {pendingRecordActionVerb} 확인
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  모바일과 데스크톱 모두 같은 흐름으로 처리합니다. 아래 문구를 입력한 뒤 적용하세요.
                </p>
                {pendingRecordActionIdentityWarnings.length > 0 && (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-900">
                    <p className="font-semibold">장소명 검증 경고 {pendingRecordActionIdentityWarnings.length}건</p>
                    <p>{formatRestaurantIdentityWarning(pendingRecordActionIdentityWarnings)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {pendingRecordActionIdentityWarnings.slice(0, 3).map((warning) => (
                        <Badge key={warning.rule} variant="outline" className="border-red-300 bg-white/70 text-red-900">
                          {warning.severity === 'block' ? '차단' : '확인'} · {warning.rule}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {pendingRecordActionDuplicateWarnings.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                    <p className="font-semibold">같은 영상 중복 후보 {pendingRecordActionDuplicateWarnings.length}건이 있습니다.</p>
                    <p>복원 적용 전 같은 맛집 관계인지 확인하세요. 별도 필터 없이 현재 작업 확인 단계에서만 알려드립니다.</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {pendingRecordActionDuplicateWarnings.slice(0, 3).map((candidate) => (
                        <Badge key={candidate.id} variant="outline" className="border-amber-300 bg-white/70 text-amber-900">
                          {candidate.name} · {candidate.rule}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                <Input
                  aria-label="검수 항목 작업 확인 문구"
                  value={recordActionConfirmation}
                  onChange={(event) => setRecordActionConfirmation(event.target.value)}
                  placeholder={`${pendingRecordActionRequiredPhrase} 입력`}
                  className="h-9 min-w-0 sm:w-44"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={clearPendingRecordAction}
                  disabled={loading}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    void handleRestore(pendingRecordAction.record);
                  }}
                  disabled={loading || recordActionConfirmation !== pendingRecordActionRequiredPhrase}
                >
                  {pendingRecordActionVerb} 적용
                </Button>
              </div>
            </div>
          </section>
        )}
        {showSubmissionView ? (
          /* 사용자 제보 목록 검수 뷰 */
          <SubmissionListView
            submissions={allSubmissionRecords}
            onApprove={handleApproveSubmission}
            onReject={handleRejectSubmission}
            onDelete={handleDeleteSubmission}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
              queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
              invalidateAdminPendingCounts();
            }}
            loading={submissionsLoading || recommendationRequestsLoading || approveSubmissionMutation.isPending || rejectSubmissionMutation.isPending || deleteSubmissionMutation.isPending}
            reviews={reviewsData}
            onApproveReview={handleApproveReview}
            onRejectReview={handleRejectReview}
            onDeleteReview={handleDeleteReview}
            reviewsLoading={reviewsLoading}
            initialTab={submissionInitialTab}
          />
        ) : isAlternateView ? (
          <EvaluationSlideView
            records={visibleDisplayedRecords}
            currentIndex={currentSlideIndex}
            onNavigate={setCurrentSlideIndex}
            onApprove={handleApprove}
            onDelete={handleDelete}
            onRestore={handleRestore}
            onRegisterMissing={handleRegisterMissing}
            onResolveConflict={handleResolveConflict}
            onEdit={handleEdit}
            loading={loading}
          />
        ) : (
          /* 테이블 영역 (무한 스크롤) */
          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-2">
            <EvaluationTable
              records={visibleDisplayedRecords}
              onApprove={handleApprove}
              onDelete={handleDelete}
              onRestore={handleRestore}
              onRegisterMissing={handleRegisterMissing}
              onResolveConflict={handleResolveConflict}
              onEdit={handleEdit}
              loading={loading || isSearching}
              evalFilters={evalFilters}
              isDeletedFilterActive={evalFilters.status === 'deleted'}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onFilterChange={(key, value) => {
                setEvalFilters(prev => sanitizeEvalFilters({
                  ...prev,
                  [key]: value === '' ? undefined : value,
                }));
              }}
              onResetFilters={() => setEvalFilters({})}
              onLoadMore={loadMoreRecords}
              hasMore={hasMore}
              isLoadingMore={loadingMore}
            />

            {/* 로딩 인디케이터 */}
            {loadingMore && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
              </div>
            )}

            {/* 모든 데이터 로드 완료 메시지 */}
            {!hasMore && displayedRecords.length > 0 && (
              <div className="text-center py-4 text-muted-foreground text-sm">
                모든 레코드를 불러왔습니다 ({visibleDisplayedRecords.length}개 / 전체 {filteredRecords.length}개)
              </div>
            )}
          </div>
        )}
      </div>

      {/* Missing 레스토랑 등록 폼 */}
      <MissingRestaurantForm
        record={selectedMissingRecord}
        open={missingFormOpen}
        onOpenChange={setMissingFormOpen}
        onSuccess={(recordId, updates) => {
          updateRecordInState(recordId, updates);
          void invalidateRestaurantDiscoveryQueries(queryClient);
        }}
      />

      {/* 오류 해결 패널 */}
      <DbConflictResolutionPanel
        record={selectedConflictRecord}
        open={conflictPanelOpen}
        onOpenChange={setConflictPanelOpen}
        onSuccess={(recordId, updates) => {
          updateRecordInState(recordId, updates);
          void invalidateRestaurantDiscoveryQueries(queryClient);
        }}
      />

      {/* 보류 레스토랑 편집 모달 */}
      <EditRestaurantModal
        record={selectedEditRecord}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        onSuccess={(recordId, updates) => {
          updateRecordInState(recordId, updates);

	          // 사용자 제보 수정 시 restaurant_submissions 테이블도 업데이트
	          if (editingSubmission) {
	            updateSubmissionMutation.mutate({
	              submission: editingSubmission,
              updatedData: {
                restaurant_name: updates.name || editingSubmission.restaurant_name,
                address: updates.road_address || updates.jibun_address || editingSubmission.restaurant_address || '',
                phone: updates.phone || '',
                categories: updates.categories || [],
                youtube_link: updates.youtube_link || editingSubmission.items?.[0]?.youtube_link || '',
                description: (typeof updates.tzuyang_reviews === 'string' ? updates.tzuyang_reviews : null) || updates.restaurant_info?.tzuyang_review || editingSubmission.items?.[0]?.tzuyang_review || '',
              },
            });
          } else {
            // 사용자 제보가 아닌 경우 쿼리만 무효화
            queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
            void invalidateRestaurantDiscoveryQueries(queryClient);
          }
        }}
      />

      {/* 승인 확인 모달 */}
      <AlertDialog open={showApprovalConfirm} onOpenChange={setShowApprovalConfirm}>
        <AlertDialogContent className={ADMIN_MODAL_CONTENT_SM}>
          <AlertDialogHeader>
            <AlertDialogTitle>승인 확인</AlertDialogTitle>
            <AlertDialogDescription className={`text-sm text-muted-foreground space-y-2 ${ADMIN_MODAL_SCROLL_BODY}`}>
              <span className="block">이름이 유사한 레스토랑이 존재하지만 유튜브 링크가 다릅니다.</span>
              {conflictingRestaurantInfo && (
                <span className="block mt-3 p-3 bg-muted rounded-md">
                  <span className="block font-medium">기존 레스토랑:</span>
                  <span className="block text-sm mt-1">이름: {conflictingRestaurantInfo.name}</span>
                  <span className="block text-sm">주소: {conflictingRestaurantInfo.address}</span>
                </span>
              )}
              <span className="block mt-3 font-medium">승인하시겠습니까?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={ADMIN_MODAL_FOOTER}>
            <AlertDialogCancel disabled={loading} className={ADMIN_MODAL_ACTION}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingApprovalRecord) return;

                setShowApprovalConfirm(false);
                setLoading(true);
                try {
                  await performApproval(pendingApprovalRecord, requireAdminUserId());
                } catch {
                  toast({
                    variant: 'destructive',
                    title: '승인 실패',
                    description: '승인 처리에 실패했습니다. 잠시 후 다시 시도해주세요.',
                  });
                } finally {
                  setLoading(false);
                  setPendingApprovalRecord(null);
                  setConflictingRestaurantInfo(null);
                }
              }}
              disabled={loading}
              className={ADMIN_MODAL_ACTION}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
              승인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
