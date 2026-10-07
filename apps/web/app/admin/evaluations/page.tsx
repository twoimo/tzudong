"use client";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

import { createPortal } from 'react-dom';
import { useRestaurantManagementHeader } from '@/components/admin/RestaurantManagementWorkspace';
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { isEvaluationRecordStatus, isRecord, isNullableString, isStringArray, isNullableStringArray, isNullableRecord, parseNumericEvaluationMetric, parseBooleanEvaluationMetric, parseCategoryEvaluationMetric, parseCategoryValidityEvaluationMetric, isLocationMatchEvidenceFamily, isLocationMatchPendingReason, parseLocationMatchSecondPass, parseLocationMatchAddress, parseLocationMatchResult, parseEvaluationResults, parseYoutubeMeta, parseDbErrorDetails, getString, getNullableString, getNullableNumber, normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '@/lib/admin/normalize-evaluation-record';
import { fetchAdminEvaluationPage, isEvaluationCursorStale, type EvaluationWarnings } from '@/lib/admin/evaluation-page-client';
import { filterEvaluationRecords } from '@/lib/admin/evaluation-query';
import { useInitialLoadPending } from '@/lib/use-initial-load-pending';
import { useFilledSkeletonCount } from '@/lib/use-filled-skeleton-count';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord, EvaluationRecordStatus, CategoryStats } from '@/types/evaluation';
import { extractVideoIdFromYoutubeLink } from '../../../lib/dashboard/helpers';
import { getLocationMatchFalseMessage, hasLaajMetrics, hasRuleMetrics, toNotSelectionReason } from '../../../lib/dashboard/classifiers';
import { CategorySidebar } from '@/components/admin/CategorySidebar';
import { EvaluationTable } from '@/components/admin/EvaluationTableNew';
import { RestaurantReviewAutomation } from '@/components/admin/RestaurantReviewAutomation';
import { MissingRestaurantForm } from '@/components/admin/MissingRestaurantForm';
import { DbConflictResolutionPanel } from '@/components/admin/DbConflictResolutionPanel';
import { EditRestaurantModal } from '@/components/admin/EditRestaurantModal';
import { AdminRestaurantModal } from '@/components/admin/AdminRestaurantModal';
import { EvaluationSlideView } from '@/components/admin/EvaluationSlideView';
import { SubmissionListView, Review } from '@/components/admin/SubmissionListView';
import { SubmissionRecord, ApprovalData, SubmissionItem, ItemDecision } from '@/components/admin/SubmissionDetailView';
import { sanitizePrimaryStatusFilterValue } from '@/components/admin/evaluation-status-filter-options';
import { createSubmissionApprovedNotification, createSubmissionRejectedNotification, createReviewApprovedNotification, createReviewRejectedNotification } from '@/contexts/NotificationContext';
import { ClipboardCheck, Loader2, LayoutList, MonitorPlay, RotateCcw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RECORD_CATEGORIES } from '@/lib/admin/record-action-contract';
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
import { getAdminEvaluationDisplayName, matchesAdminEvaluationSearch } from '@/lib/admin-evaluation-name';
import { getAddressConsistencyStatus, hasUnconfirmedPublicMapLocation } from '@/lib/admin-address-consistency';
import { needsEvaluationRerun } from '@/lib/admin-evaluation-completeness';
import { buildCanonicalAdminEvaluationsHref, type AdminConsoleRouteModuleId } from '@/lib/admin/admin-module-routing';
import { useRecordAction } from '@/lib/admin/use-record-action';
import { isRecordActionCancelled, recordActionErrorMessage, recordActionMediaNotice, RECORD_VIEWS_INVALIDATED_EVENT, RECORD_ACTION_APPLIED_EVENT } from '@/lib/admin/record-action-client';
import { submissionApprovalInput, submissionEditInput } from '@/lib/admin/evaluation-record-actions';
import type { RecordActionReceipt } from '@/lib/admin/record-action-contract';
import { fetchAdminProfileSummariesLookup, resolveAdminReviewerDisplay } from '@/lib/admin/profile-summaries';
import {
  compareAdminEvaluationsByLatestDesc,
  isAdminEvaluationRecordMissing,
  isAdminEvaluationRecordNotSelected,
  isAdminEvaluationRecordReadyForApproval,
  isAdminEvaluationRecordUnconfirmedMapLocation,
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

type SubmissionOriginalRestaurantData = NonNullable<SubmissionRecord['original_restaurant_data']>;

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

type AdminEvaluationPageWrapperProps = {
  embedded?: boolean;
  initialView?: 'evaluations' | 'submissions';
  initialSubmissionTab?: 'new' | 'edit' | 'recommend' | 'reviews';
  onInitialContentReady?: () => void;
};

// Suspense 래퍼 컴포넌트
function AdminEvaluationPageWrapper({
  embedded = false,
  initialView = 'evaluations',
  initialSubmissionTab,
  onInitialContentReady,
}: AdminEvaluationPageWrapperProps = {}) {
  return (
    <Suspense fallback={embedded ? null : <AdminEvaluationRouteSkeleton />}>
      <AdminEvaluationPage
        embedded={embedded}
        initialView={initialView}
        initialSubmissionTab={initialSubmissionTab}
        onInitialContentReady={onInitialContentReady}
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
          상호·영상 ID 검색...
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

function AdminEvaluationStaticCardSkeleton({ count }: { count: number }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2 lg:hidden" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
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
  const frameRef = useRef<HTMLDivElement>(null);
  const { ref: mobileCardsRef, count: mobileCardsCount } = useFilledSkeletonCount(104, 4, 48);
  const [rowCount, setRowCount] = useState(6);
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const update = () => {
      const height = node.clientHeight;
      if (height <= 0) return;
      setRowCount(Math.max(6, Math.ceil((height - 44) / 64)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
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
              <h1 className="truncate text-base font-semibold leading-6">관리자 데이터 검수</h1>
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
      <div ref={mobileCardsRef} className="flex min-h-0 flex-1 flex-col gap-3 p-2">
        <AdminEvaluationStaticMobileLoadingControls />
        <AdminEvaluationStaticCardSkeleton count={mobileCardsCount} />
        <div ref={frameRef} className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background lg:flex">
          <div className="border-b bg-muted/35 lg:grid lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="px-2 py-2">
                <Skeleton className={index === 1 ? "h-3 w-24 rounded-full motion-reduce:animate-none" : "mx-auto h-3 w-12 rounded-full motion-reduce:animate-none"} />
              </div>
            ))}
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: rowCount }).map((_, rowIndex) => (
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
  onInitialContentReady,
}: {
  embedded: boolean;
  initialView: 'evaluations' | 'submissions';
  initialSubmissionTab?: 'new' | 'edit' | 'recommend' | 'reviews';
  onInitialContentReady?: () => void;
}) {
  const { toast } = useToast();
  const managementHeader = useRestaurantManagementHeader();
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
  const legacyEvaluationLoad = isLegacyBrowserAdminMutationEnabled();
  const [serverFilteredTotal, setServerFilteredTotal] = useState(0);
  const [pageReadError, setPageReadError] = useState(false);
  const [recordViewsInvalidated, setRecordViewsInvalidated] = useState(false);
  const [recordViewsRefreshing, setRecordViewsRefreshing] = useState(false);
  const recordViewsEpochRef = useRef(0);
  const recordViewsFenceRef = useRef(false);
  const recordViewsRefreshRef = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  const [pageWarnings, setPageWarnings] = useState<EvaluationWarnings>({});
  const nextCursorRef = useRef<string | null>(null);
  const pageEpochRef = useRef(0);
  const pageAbortRef = useRef<AbortController | null>(null);
  const reloadPagesRef = useRef<() => Promise<void>>(async () => {});
  const pageRevisionRef = useRef<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<EvaluationRecordStatus[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(''); // 검색어 상태
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setServerSearchQuery(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [evalFilters, setEvalFilters] = useState<EvalFiltersState>({});
  const [missingFormOpen, setMissingFormOpen] = useState(false);
  const [selectedMissingRecord, setSelectedMissingRecord] = useState<EvaluationRecord | null>(null);
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  const [selectedConflictRecord, setSelectedConflictRecord] = useState<EvaluationRecord | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [createRestaurantOpen, setCreateRestaurantOpen] = useState(false);
  const [selectedEditRecord, setSelectedEditRecord] = useState<EvaluationRecord | null>(null);

  const detailRequestsRef = useRef(new Map<string, { promise: Promise<EvaluationRecord | null>; token: symbol; epoch: number }>());
  const ensureEvaluationDetails = useCallback(async (record: EvaluationRecord): Promise<EvaluationRecord | null> => {
    if (recordViewsFenceRef.current || (!legacyEvaluationLoad && (pageReadError || pageRevisionRef.current === null))) return null;
    if (!record.read_summary) return record;
    const existing = detailRequestsRef.current.get(record.id);
    if (existing?.epoch === pageEpochRef.current) return existing.promise;
    const epoch = pageEpochRef.current;
    const token = Symbol();
    const pending = (async () => {
      try {
        const revision = pageRevisionRef.current;
        const suffix = revision ? `?revision=${encodeURIComponent(revision)}` : '';
        const response = await fetch(`/api/admin/evaluations/${encodeURIComponent(record.id)}${suffix}`, { cache: 'no-store', signal: pageAbortRef.current?.signal });
        if (response.status === 409) { await reloadPagesRef.current(); return null; }
        if (!response.ok) throw new Error('EVALUATION_DETAIL_UNAVAILABLE');
        const value: unknown = await response.json();
        const parsed = isRecord(value) ? normalizeEvaluationRecord(value.record) : null;
        if (!parsed || parsed.id !== record.id || parsed.read_summary || epoch !== pageEpochRef.current) return null;
        const full = withAdminEvaluationDisplayName(parsed);
        setAllRecords(previous => previous.map(row => row.id === full.id ? full : row));
        return full;
      } catch (error) {
        if (epoch === pageEpochRef.current && !(error instanceof Error && error.name === 'AbortError')) toast({ variant: 'destructive', title: '상세 정보 로드 실패', description: '검수 상세 정보를 다시 불러와 주세요.' });
        return null;
      } finally {
        if (detailRequestsRef.current.get(record.id)?.token === token) detailRequestsRef.current.delete(record.id);
      }
    })();
    detailRequestsRef.current.set(record.id, { promise: pending, token, epoch });
    return pending;
  }, [toast, legacyEvaluationLoad, pageReadError]);

  // 승인 확인 모달 상태
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [pendingApprovalRecord, setPendingApprovalRecord] = useState<EvaluationRecord | null>(null);
  const [conflictingRestaurantInfo, setConflictingRestaurantInfo] = useState<{
    name: string;
    address: string;
  } | null>(null);
  const getSameVideoDuplicateWarnings = useCallback((record: EvaluationRecord) => {
    return legacyEvaluationLoad ? findSameVideoDuplicateWarningCandidates(record, allRecords) : (pageWarnings[record.id]?.sameVideo.candidates ?? []);
  }, [allRecords, legacyEvaluationLoad, pageWarnings]);

  const notifySameVideoDuplicateWarning = useCallback((record: EvaluationRecord, actionLabel: string) => {
    const message = legacyEvaluationLoad ? formatSameVideoDuplicateWarning(getSameVideoDuplicateWarnings(record)) : (pageWarnings[record.id]?.sameVideo.message ?? '');
    if (!message) return;

    toast({
      title: `같은 영상 중복 후보 확인 후 ${actionLabel}`,
      description: message,
    });
  }, [getSameVideoDuplicateWarnings, toast, legacyEvaluationLoad, pageWarnings]);

  const getRestaurantIdentityWarnings = useCallback((record: EvaluationRecord) => {
    return legacyEvaluationLoad ? findRestaurantIdentityWarnings(record, allRecords) : (pageWarnings[record.id]?.identity ?? findRestaurantIdentityWarnings(record));
  }, [allRecords, legacyEvaluationLoad, pageWarnings]);

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
  const evaluationPageQuery = useMemo(() => {
    if (legacyEvaluationLoad) return '';
    const params = new URLSearchParams({ q: serverSearchQuery, filters: JSON.stringify(evalFilters) });
    if (deepLinkFilter?.videoId) params.set('videoId', deepLinkFilter.videoId);
    if (deepLinkFilter?.issue) params.set('issue', deepLinkFilter.issue);
    if (deepLinkFilter?.reason) params.set('reason', deepLinkFilter.reason);
    return params.toString();
  }, [serverSearchQuery, evalFilters, deepLinkFilter, legacyEvaluationLoad]);

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
  const [submissionEditorOpen, setSubmissionEditorOpen] = useState(false);
  const [submissionDraft, setSubmissionDraft] = useState<Parameters<typeof submissionEditInput>[1] | null>(null);
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
      if (savedState.searchQuery !== undefined) {
        setSearchQuery(savedState.searchQuery);
        setServerSearchQuery(savedState.searchQuery);
      }
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

  const filteredRecords = useMemo(() => legacyEvaluationLoad ? filterEvaluationRecords(allRecords, { searchQuery, evalFilters, deepLinkFilter }) : allRecords, [allRecords, searchQuery, evalFilters, deepLinkFilter, legacyEvaluationLoad]);


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
  const loadMoreRecords = useCallback(async () => {
    if (recordViewsFenceRef.current) return;
    if (!legacyEvaluationLoad) {
      if (loadingMoreRef.current || !nextCursorRef.current) return;
      const epoch = pageEpochRef.current;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      try {
        const page = await fetchAdminEvaluationPage(evaluationPageQuery, nextCursorRef.current, pageAbortRef.current?.signal);
        if (epoch !== pageEpochRef.current) return;
        const records = page.records.map(normalizeEvaluationRecord).filter((record): record is EvaluationRecord => record !== null).map(withAdminEvaluationDisplayName);
        setAllRecords(previous => [...new Map([...previous, ...records].map(record => [record.id, record])).values()]);
        setPageWarnings(previous => ({ ...previous, ...page.warnings }));
        nextCursorRef.current = page.nextCursor;
        setStats(page.stats);
        setServerFilteredTotal(page.filteredTotal);
        setHasMore(page.nextCursor !== null);
        hasMoreRef.current = page.nextCursor !== null;
      } catch (error) {
        if (epoch !== pageEpochRef.current || (error instanceof Error && error.name === 'AbortError')) return;
        if (isEvaluationCursorStale(error)) await reloadPagesRef.current();
        else toast({ variant: 'destructive', title: '데이터 로드 실패', description: '다음 검수 데이터를 불러오지 못했습니다.' });
      } finally {
        if (epoch === pageEpochRef.current) { loadingMoreRef.current = false; setLoadingMore(false); }
      }
      return;
    }
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
  }, [legacyEvaluationLoad, evaluationPageQuery, toast]);

  // 필터링 결과가 변경될 때마다 표시할 레코드 초기화
  useEffect(() => {
    const nextHasMore = legacyEvaluationLoad ? filteredRecords.length > PAGE_SIZE : nextCursorRef.current !== null;

    setDisplayedRecords(legacyEvaluationLoad ? filteredRecords.slice(0, PAGE_SIZE) : filteredRecords);
    setHasMore(nextHasMore);
    hasMoreRef.current = nextHasMore;
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [filteredRecords, legacyEvaluationLoad]);

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

  useEffect(() => {
    if (isAlternateView && displayedRecords[currentSlideIndex]?.read_summary) void ensureEvaluationDetails(displayedRecords[currentSlideIndex]);
  }, [isAlternateView, currentSlideIndex, displayedRecords, ensureEvaluationDetails]);

  // 전체 데이터 로드 (한 번만)
  const loadAllRecords = useCallback(async () => {
    if (!legacyEvaluationLoad) {
      const epoch = ++pageEpochRef.current;
      pageAbortRef.current?.abort();
      pageAbortRef.current = new AbortController();
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoading(true);
      nextCursorRef.current = null;
      pageRevisionRef.current = null;
      detailRequestsRef.current.clear();
      setPageReadError(false);
      setAllRecords([]);
      setDisplayedRecords([]);
      setPageWarnings({});
      setServerFilteredTotal(0);
      setStats({ total: 0, pending: 0, approved: 0, hold: 0, db_conflict: 0, ready_for_approval: 0, unconfirmed_map: 0, missing: 0, not_selected: 0, deleted: 0 });
      setHasMore(false);
      hasMoreRef.current = false;
      setCurrentSlideIndex(0);
      try {
        const page = await fetchAdminEvaluationPage(evaluationPageQuery, null, pageAbortRef.current.signal);
        if (epoch !== pageEpochRef.current) return;
        setAllRecords(page.records.map(normalizeEvaluationRecord).filter((record): record is EvaluationRecord => record !== null).map(withAdminEvaluationDisplayName));
        setPageWarnings(page.warnings);
        pageRevisionRef.current = page.revision;
        setStats(page.stats);
        setServerFilteredTotal(page.filteredTotal);
        nextCursorRef.current = page.nextCursor;
        setHasMore(page.nextCursor !== null);
        hasMoreRef.current = page.nextCursor !== null;
      } catch (error) {
        if (epoch !== pageEpochRef.current || (error instanceof Error && error.name === 'AbortError')) return;
        setAllRecords([]); setDisplayedRecords([]); setHasMore(false);
        setPageReadError(true);
        setPageWarnings({});
        setServerFilteredTotal(0);
        pageRevisionRef.current = null;
        nextCursorRef.current = null;
        hasMoreRef.current = false;
        toast({ variant: 'destructive', title: '데이터 로드 실패', description: '검수 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
      } finally { if (epoch === pageEpochRef.current) setLoading(false); }
      return;
    }
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
          unconfirmed_map: 0,
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
        unconfirmed_map: typedRecords.filter(isAdminEvaluationRecordUnconfirmedMapLocation).length,
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
        unconfirmed_map: 0,
        not_selected: 0,
        deleted: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.id, legacyEvaluationLoad, evaluationPageQuery]);
  useEffect(() => { reloadPagesRef.current = async () => { if (!recordViewsFenceRef.current) await loadAllRecords(); }; }, [loadAllRecords]);

  // 초기 데이터 로드
  useEffect(() => {
    // 이미 데이터를 로드했으면 건너뛰기 (컴포넌트 재마운트 시 중복 로드 방지)
    if (legacyEvaluationLoad && hasLoadedData.current) {
      return;
    }

    if (!recordViewsFenceRef.current && ((user && isAdmin) || hasE2EAdminShellBypass) && !authLoading) {
      hasLoadedData.current = true;
      loadAllRecords();
    }
  }, [user, isAdmin, authLoading, hasE2EAdminShellBypass, loadAllRecords, legacyEvaluationLoad]);
  useEffect(() => () => { pageEpochRef.current++; pageAbortRef.current?.abort(); }, []);

  // 개별 레코드 업데이트 (새로고침 없이 상태 반영)
  const updateRecordInState = (recordId: string, updates: Partial<EvaluationRecord>) => {
    if (recordViewsFenceRef.current) return;
    setAllRecords(prev =>
      prev.map(r => r.id === recordId ? { ...r, ...updates } : r)
    );
    if (!legacyEvaluationLoad) void loadAllRecords();
  };

  // 통계 재계산 (현재 allRecords 기준)
  const recalculateStats = useCallback(() => {
    if (!legacyEvaluationLoad) return;
    const deletedCount = allRecords.filter(r => r.status === 'deleted').length;

    const newStats: CategoryStats = {
      total: allRecords.length, // 삭제 포함 전체
      pending: allRecords.filter(r => r.status === 'pending').length,
      approved: allRecords.filter(r => r.status === 'approved').length,
      hold: allRecords.filter(r => r.status === 'hold').length,
      db_conflict: allRecords.filter(r => r.status === 'db_conflict').length,
      ready_for_approval: allRecords.filter(isAdminEvaluationRecordReadyForApproval).length,
      unconfirmed_map: allRecords.filter(isAdminEvaluationRecordUnconfirmedMapLocation).length,
      missing: allRecords.filter(isAdminEvaluationRecordMissing).length,
      not_selected: allRecords.filter(isAdminEvaluationRecordNotSelected).length,
      deleted: deletedCount,
    };

    setStats(newStats);
  }, [allRecords, legacyEvaluationLoad]);

  // allRecords가 변경될 때마다 통계 재계산
  useEffect(() => {
    if (allRecords.length > 0) {
      recalculateStats();
    }
  }, [allRecords, recalculateStats]);

  // 승인 핸들러 (오류 체크 포함)
  const handleApprove = async (record: EvaluationRecord) => {
    const full = await ensureEvaluationDetails(record);
    if (!full) return;
    record = full;
    if (needsEvaluationRerun(record)) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '평가값 또는 근거가 비어 있어 승인할 수 없습니다.',
      });
      return;
    }
    if (hasUnconfirmedPublicMapLocation(record)) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '유튜브에서 지점이 확정되지 않은 좌표입니다. 공개 지도에 찍히지 않게 보류하세요.',
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
      requireAdminUserId();
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


        toast({
          variant: 'destructive',
          title: '중복 오류',
          description: '중복 후보가 확인되었습니다. 검토 후 다시 시도해주세요.',
        });

        setLoading(false);
        return;
      }

      // 실제 승인 처리 실행
      await performApproval(record);

    } catch (error) {
      notifyRecordActionError(error);
    } finally {
      setLoading(false);
    }
  };

  const performApproval = async (record: EvaluationRecord) => {
    const receipt = await recordActions.run({ action: 'restaurant.approve', targetIds: [record.id], payload: {} });
    await onRecordApplied(receipt);
  };

  const handleDelete = async (record: EvaluationRecord) => {
    notifyRestaurantIdentityWarning(record, '삭제');
    notifySameVideoDuplicateWarning(record, '삭제');
    try {
      requireAdminUserId();
      const receipt = await recordActions.run({ action: 'restaurant.delete', targetIds: [record.id], payload: { reason: '관리자에 의해 삭제됨' } });
      await onRecordApplied(receipt);
    } catch (error) { notifyRecordActionError(error); }
  };

  const handleRegisterMissing = async (record: EvaluationRecord) => {
    const full = await ensureEvaluationDetails(record);
    if (!full) return;
    setSelectedMissingRecord(full);
    setMissingFormOpen(true);
  };

  const handleResolveConflict = async (record: EvaluationRecord) => {
    const full = await ensureEvaluationDetails(record);
    if (!full) return;
    setSelectedConflictRecord(full);
    setConflictPanelOpen(true);
  };

  const handleEdit = async (record: EvaluationRecord) => {
    const full = await ensureEvaluationDetails(record);
    if (!full) return;
    setSelectedEditRecord(full);
    setEditModalOpen(true);
  };

  const handleRestore = async (record: EvaluationRecord) => {
    notifyRestaurantIdentityWarning(record, '복원');
    notifySameVideoDuplicateWarning(record, '복원');
    try {
      requireAdminUserId();
      const receipt = await recordActions.run({ action: 'restaurant.restore', targetIds: [record.id], payload: {} });
      await onRecordApplied(receipt);
    } catch (error) { notifyRecordActionError(error); }
  };

  // 사용자 제보 데이터 쿼리 (새 테이블 구조)
  const submissionsQuery = useQuery({
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

      // 2. items / profile summaries 병렬 조회
      const [{ data: itemsData }, profilesLookup] = await Promise.all([
        supabase
          .from('restaurant_submission_items')
          .select(ADMIN_SUBMISSION_ITEM_SELECT)
          .in('submission_id', submissionIds)
          .order('created_at', { ascending: true })
          .overrideTypes<Record<string, unknown>[], { merge: false }>(),
        fetchAdminProfileSummariesLookup(userIds),
      ]);

      const typedItemsData = parseValidatedRows(itemsData ?? [], isSubmissionItem);

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
          profiles: { nickname: resolveAdminReviewerDisplay(s.user_id, profilesLookup.summaries, profilesLookup.ok, { missingNickname: '알 수 없음' }).nickname },
          original_restaurant_data: originalRestaurantData,
        };
      });

    },
    enabled: !!user && isAdmin && !recordViewsInvalidated,
    refetchInterval: recordViewsInvalidated ? false : 30000,
    refetchOnWindowFocus: true,
  });
  const { data: submissionsData = [], isLoading: submissionsLoading } = submissionsQuery;

  const recommendationRequestsQuery = useQuery({
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

      const profilesLookup = await fetchAdminProfileSummariesLookup(userIds);

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
        profiles: { nickname: resolveAdminReviewerDisplay(request.user_id, profilesLookup.summaries, profilesLookup.ok, { missingNickname: '알 수 없음' }).nickname },
        recommendation_reason: request.recommendation_reason ?? null,
        recommendation_status: request.status || 'pending',
        recommendation_admin_note: request.admin_note ?? null,
        recommendation_audit_id: request.review_audit_id ?? null,
        original_restaurant_data: null,
      }));
    },
    enabled: !!user && isAdmin && !recordViewsInvalidated,
    refetchInterval: recordViewsInvalidated ? false : 30000,
    refetchOnWindowFocus: true,
  });
  const { data: recommendationRequestsData = [], isLoading: recommendationRequestsLoading } = recommendationRequestsQuery;

  const allSubmissionRecords = useMemo(
    () => [...submissionsData, ...recommendationRequestsData],
    [submissionsData, recommendationRequestsData],
  );

  // 리뷰 데이터 쿼리
  const reviewsQuery = useQuery({
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

      const [profilesLookup, { data: restaurantsData }] = await Promise.all([
        fetchAdminProfileSummariesLookup(userIds),
        supabase
          .from('restaurants')
          .select('id, approved_name, road_address, jibun_address')
          .in('id', restaurantIds)
          .overrideTypes<Record<string, unknown>[], { merge: false }>(),
      ]);

      const typedRestaurantsData = parseValidatedRows(restaurantsData ?? [], isReviewRestaurantRow);

      const restaurantsMap = new Map(typedRestaurantsData.map(r => [r.id, { name: r.approved_name || '이름 없음', address: r.road_address || r.jibun_address || '' }]));

      return typedReviewsData.map((review): Review => ({
        ...review,
        profiles: { nickname: resolveAdminReviewerDisplay(review.user_id, profilesLookup.summaries, profilesLookup.ok).nickname },
        restaurants: restaurantsMap.get(review.restaurant_id) || { name: '삭제된 맛집', address: '' }
      }));
    },
    enabled: !!user && isAdmin && !recordViewsInvalidated,
    refetchInterval: recordViewsInvalidated ? false : 30000,
  });
  const { data: reviewsData = [], isLoading: reviewsLoading } = reviewsQuery;

  const pendingCountsQuery = useQuery({
    queryKey: [...ADMIN_PENDING_COUNTS_QUERY_KEY, user?.id, isAdmin],
    queryFn: fetchAdminEvaluationPendingCounts,
    enabled: !!user && isAdmin && !recordViewsInvalidated,
    staleTime: 15 * 1000,
    refetchInterval: recordViewsInvalidated ? false : 30 * 1000,
    refetchOnWindowFocus: true,
  });
  const { data: canonicalPendingCounts } = pendingCountsQuery;

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
    : `필터링: ${legacyEvaluationLoad ? filteredRecords.length : serverFilteredTotal}개 | 현 ${stats.total}개 레코드 | 삭제한 레코드 ${stats.deleted}개`;
  const isInitialEvaluationDataLoading = !showSubmissionView && loading && allRecords.length === 0;
  const pendingQueueSummaryContent = recordViewsInvalidated ? '새 조회 필요' : !showSubmissionView && !legacyEvaluationLoad && pageReadError ? '검수 목록 조회 실패' : showSubmissionView || !isInitialEvaluationDataLoading
    ? pendingQueueSummaryText
    : '필터링: 집계 중 | 현 레코드 집계 중 | 삭제한 레코드 집계 중';

  const invalidateRecordViews = useCallback(() => {
    recordViewsFenceRef.current = true;
    ++recordViewsEpochRef.current;
    ++pageEpochRef.current;
    pageAbortRef.current?.abort();
    nextCursorRef.current = null;
    pageRevisionRef.current = null;
    detailRequestsRef.current.clear();
    loadingMoreRef.current = false;
    hasMoreRef.current = false;
    setAllRecords([]); setDisplayedRecords([]); setPageWarnings({});
    setServerFilteredTotal(0); setHasMore(false); setLoadingMore(false); setLoading(false);
    setCurrentSlideIndex(0); setPageReadError(true); setRecordViewsInvalidated(true);
    setStats({ total: 0, pending: 0, approved: 0, hold: 0, db_conflict: 0, ready_for_approval: 0, unconfirmed_map: 0, missing: 0, not_selected: 0, deleted: 0 });
    // reset cancels each query and clears its data without launching an automatic read.
    for (const queryKey of [['admin-submissions-inline'], ['admin-restaurant-requests-inline'], ['admin-reviews-inline'], ['admin-pending-counts'], ADMIN_SHARED_PENDING_COUNTS_QUERY_KEY]) {
      for (const query of queryClient.getQueryCache().findAll({ queryKey })) query.reset();
    }
  }, [queryClient]);
  const refreshRecordViews = useCallback(() => {
    const epoch = recordViewsEpochRef.current;
    if (recordViewsRefreshRef.current?.epoch === epoch) return recordViewsRefreshRef.current.promise;
    const promise = (async () => {
      setRecordViewsRefreshing(true);
      try {
        await Promise.all([
          submissionsQuery.refetch({ throwOnError: true }), recommendationRequestsQuery.refetch({ throwOnError: true }),
          reviewsQuery.refetch({ throwOnError: true }), pendingCountsQuery.refetch({ throwOnError: true }), loadAllRecords(),
        ]);
        if (epoch !== recordViewsEpochRef.current) return;
        if (!legacyEvaluationLoad && pageRevisionRef.current === null) throw new Error('CURRENT_RECORD_READ_FAILED');
        recordViewsFenceRef.current = false;
        setRecordViewsInvalidated(false);
      } catch {
        if (epoch === recordViewsEpochRef.current) invalidateRecordViews();
      } finally {
        if (recordViewsRefreshRef.current?.epoch === epoch) {
          recordViewsRefreshRef.current = null;
          setRecordViewsRefreshing(false);
        }
      }
    })();
    recordViewsRefreshRef.current = { epoch, promise };
    return promise;
  }, [submissionsQuery, recommendationRequestsQuery, reviewsQuery, pendingCountsQuery, loadAllRecords, legacyEvaluationLoad, invalidateRecordViews]);
  useEffect(() => {
    // Creation waits for the modal to verify every returned ID before publishing the list.
    const refresh = () => { if (!createRestaurantOpen) void refreshRecordViews(); };
    window.addEventListener(RECORD_VIEWS_INVALIDATED_EVENT, invalidateRecordViews);
    window.addEventListener(RECORD_ACTION_APPLIED_EVENT, refresh);
    return () => {
      window.removeEventListener(RECORD_VIEWS_INVALIDATED_EVENT, invalidateRecordViews);
      window.removeEventListener(RECORD_ACTION_APPLIED_EVENT, refresh);
    };
  }, [invalidateRecordViews, refreshRecordViews, createRestaurantOpen]);

  const notifyRecordActionError = (error: unknown) => {
    if (!isRecordActionCancelled(error)) toast({ variant: 'destructive', title: '변경 확인 필요', description: recordActionErrorMessage(error) });
  };
  const onRecordApplied = async (receipt: RecordActionReceipt) => {
    toast({ title: '변경 확인 완료', description: [recordActionMediaNotice(receipt), `감사 ID: ${receipt.auditId}`].filter(Boolean).join(' ') });
    await Promise.all([refreshRecordViews(), invalidateRestaurantDiscoveryQueries(queryClient)]);
    invalidateAdminPendingCounts();
  };
  const recordActions = useRecordAction(receipt => { void onRecordApplied(receipt); }, { recover: true });
  const notifyTransactionalResult = (work: Promise<unknown>) => {
    void work.catch(() => toast({ title: '변경은 확인됐습니다', description: '작성자 알림 결과는 확인하지 못했습니다. 자동으로 다시 보내지 않습니다.' }));
  };
  const afterReviewAction = async (receipt: RecordActionReceipt, { reviewId, review }: { reviewId: string; review: Review }) => {
    const row = receipt.readback.find(item => item.kind === 'review' && item.id === reviewId);
    if (review?.user_id && row?.status === 'approved') notifyTransactionalResult(createReviewApprovedNotification(review.user_id, review.restaurants?.name || '맛집'));
    if (review?.user_id && row?.status === 'rejected') notifyTransactionalResult(createReviewRejectedNotification(review.user_id, review.restaurants?.name || '맛집', ''));
    await onRecordApplied(receipt);
  };
  const afterSubmissionAction = async (receipt: RecordActionReceipt, { submission }: { submission: SubmissionRecord }) => {
    const status = receipt.readback.find(row => row.kind === 'submission' && row.id === submission.id)?.status;
    if (submission.submission_type !== 'recommend' && submission.user_id) {
      if (status === 'approved' || status === 'partially_approved') notifyTransactionalResult(createSubmissionApprovedNotification(submission.user_id, submission.restaurant_name, submission.submission_type, { submissionId: submission.id }));
      if (status === 'rejected') notifyTransactionalResult(createSubmissionRejectedNotification(submission.user_id, submission.restaurant_name, '', submission.submission_type, { submissionId: submission.id }));
    }
    await onRecordApplied(receipt);
  };
  const approveReviewMutation = useMutation({
    mutationFn: ({ reviewId, adminNote }: { reviewId: string; adminNote: string; review: Review }) => recordActions.run({ action: 'review.approve', targetIds: [reviewId], payload: { note: adminNote.trim() || undefined } }),
    onSuccess: afterReviewAction, onError: notifyRecordActionError,
  });
  const rejectReviewMutation = useMutation({
    mutationFn: ({ reviewId, adminNote }: { reviewId: string; adminNote: string; review: Review }) => recordActions.run({ action: 'review.reject', targetIds: [reviewId], payload: { reason: adminNote.trim() || '관리자에 의해 거부됨' } }),
    onSuccess: afterReviewAction, onError: notifyRecordActionError,
  });
  const deleteReviewMutation = useMutation({
    mutationFn: (reviewId: string) => recordActions.run({ action: 'review.delete', targetIds: [reviewId], payload: { reason: '관리자에 의해 삭제됨' } }),
    onSuccess: onRecordApplied, onError: notifyRecordActionError,
  });
  const approveSubmissionMutation = useMutation({
    mutationFn: (input: Parameters<typeof submissionApprovalInput>[0]) => recordActions.run(submissionApprovalInput(input)),
    onSuccess: afterSubmissionAction, onError: notifyRecordActionError,
  });
  const rejectSubmissionMutation = useMutation({
    mutationFn: ({ submission, reason }: { submission: SubmissionRecord; reason: string }) => recordActions.run({ action: submission.submission_type === 'recommend' ? 'recommendation.reject' : 'submission.reject', targetIds: [submission.id], payload: { reason } }),
    onSuccess: afterSubmissionAction, onError: notifyRecordActionError,
  });
  const deleteSubmissionMutation = useMutation({
    mutationFn: (submission: SubmissionRecord) => recordActions.run({ action: submission.submission_type === 'recommend' ? 'recommendation.reject' : 'submission.delete', targetIds: [submission.id], payload: { reason: '관리자에 의해 삭제됨' } }),
    onSuccess: onRecordApplied, onError: notifyRecordActionError,
  });
  const handleApproveSubmission = (submission: SubmissionRecord, approvalData: ApprovalData, itemDecisions: Record<string, ItemDecision>, forceApprove: boolean,
    editableData: { name: string; address: string; phone: string; categories: string[] }, adminNote?: string) => {
    approveSubmissionMutation.mutate({ submission, approvalData, itemDecisions, forceApprove, editableData, adminNote });
  };
  const handleRejectSubmission = (submission: SubmissionRecord, reason: string) => rejectSubmissionMutation.mutate({ submission, reason });
  const handleDeleteSubmission = (submission: SubmissionRecord) => deleteSubmissionMutation.mutate(submission);
  const handleApproveReview = (review: Review, adminNote: string) => approveReviewMutation.mutate({ reviewId: review.id, adminNote, review });
  const handleRejectReview = (review: Review, adminNote: string) => rejectReviewMutation.mutate({ reviewId: review.id, adminNote, review });
  const handleDeleteReview = (review: Review) => deleteReviewMutation.mutate(review.id);
  const updateSubmissionMutation = useMutation({
    mutationFn: ({ submission, updatedData }: { submission: SubmissionRecord; updatedData: Parameters<typeof submissionEditInput>[1] }) => recordActions.run(submissionEditInput(submission, updatedData)),
    onSuccess: async receipt => { await onRecordApplied(receipt); setEditingSubmission(null); setSubmissionDraft(null); },
    onError: notifyRecordActionError,
  });

  const initialContentLoading = initialView === 'submissions'
    ? submissionsLoading || recommendationRequestsLoading || reviewsLoading
    : loading;
  const initialLoadPending = useInitialLoadPending(
    !authLoading
    && (hasE2EAdminShellBypass || Boolean(user && isAdmin))
    && !initialContentLoading,
  );

  useLayoutEffect(() => {
    if (!onInitialContentReady || authLoading) return;
    if (!hasE2EAdminShellBypass && (!user || !isAdmin)) {
      onInitialContentReady();
      return;
    }
    if (initialLoadPending) return;
    onInitialContentReady();
  }, [initialContentLoading, initialLoadPending, authLoading, onInitialContentReady, user, isAdmin, hasE2EAdminShellBypass]);

  if (!hasE2EAdminShellBypass && !authLoading && (!user || !isAdmin)) {
    return null;
  }

  if (!embedded && initialLoadPending && (authLoading || initialContentLoading)) {
    return <AdminEvaluationRouteSkeleton />;
  }

  if (embedded && initialLoadPending && (authLoading || initialContentLoading)) {
    return null;
  }

  const embeddedModuleId: Extract<AdminConsoleRouteModuleId, 'restaurants' | 'submissions' | 'reviews'> = showSubmissionView
    ? (submissionInitialTab === 'reviews' ? 'reviews' : 'submissions')
    : 'restaurants';
  const ModuleTitle = embedded ? 'h2' : 'h1';
  const compactReviewHeader = embedded && embeddedModuleId === 'restaurants' && managementHeader !== null;

  const reviewSummary = recordViewsInvalidated ? '새 조회 필요' : !legacyEvaluationLoad && pageReadError ? '조회 실패' : !isInitialEvaluationDataLoading
    ? `전체 ${stats.total}건${stats.deleted > 0 ? ` · 삭제 ${stats.deleted}건` : ''}`
    : '전체 집계 중';
  const reviewViewActions = canSwitchEvaluationView && (
    <>
      {!showSubmissionView && <Button size="sm" variant="outline" data-admin-restaurant-create-trigger disabled={loading || recordActions.busy || recordViewsInvalidated || createRestaurantOpen} onClick={() => setCreateRestaurantOpen(true)}>맛집 등록</Button>}
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
  );

  return (
    <div
      ref={scrollContainerRef}
      className="flex h-full min-h-0 flex-col overflow-auto"
      id="scroll-container"
      data-admin-embedded-module-shell={embedded ? "true" : undefined}
      data-admin-embedded-module-id={embedded ? embeddedModuleId : undefined}
    >
      {compactReviewHeader && managementHeader.count && createPortal(
        <span data-admin-module-summary="true">{reviewSummary}</span>,
        managementHeader.count,
      )}
      {compactReviewHeader && managementHeader.views && createPortal(
        <div className="flex items-center gap-1 [&_button]:min-h-11 [&_button]:min-w-11 sm:[&_button]:min-h-8 sm:[&_button]:min-w-8" data-admin-evaluation-view-actions="top-right" data-admin-module-actions="top-right">
          {reviewViewActions}
        </div>,
        managementHeader.views,
      )}
      {embedded && !compactReviewHeader && <AdminPageHeader
        title={embeddedModuleId === 'submissions' ? '제보 관리' : embeddedModuleId === 'reviews' ? '리뷰 관리' : '관리자 데이터 검수'}
        titleAs="h2" icon={ClipboardCheck}
        summary={embeddedModuleId === 'restaurants' ? reviewSummary : pendingQueueSummaryContent}
        data-admin-module-header="compact" data-admin-module-header-module={embeddedModuleId}
        actions={canSwitchEvaluationView ? <div data-admin-evaluation-view-actions="top-right">{reviewViewActions}</div> : undefined}
      />}
      {/* Standalone modules retain their own header; the restaurant workspace owns its primary row. */}
      {((!embedded && !compactReviewHeader) || deepLinkFilter) && <div
        className={embedded ? "shrink-0 border-b border-border bg-card px-2 py-1.5" : "border-b border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3"}
        data-admin-module-header={embedded ? "compact" : undefined}
        data-admin-module-header-module={embedded ? embeddedModuleId : undefined}
      >
        <div className={embedded ? "flex flex-row items-start justify-between gap-1.5 lg:items-center" : "flex flex-row items-start justify-between gap-2.5 lg:items-center"}>
          <div className="min-w-0 flex-1">
            {!embedded && !compactReviewHeader && <div className="flex items-center gap-2">
              <AdminEvaluationTitleIcon embedded={embedded} />
              <ModuleTitle className="whitespace-nowrap text-base font-semibold leading-6">
                {embeddedModuleId === 'submissions'
                  ? '제보 관리'
                  : embeddedModuleId === 'reviews'
                    ? '리뷰 관리'
                    : '관리자 데이터 검수'}
              </ModuleTitle>
            </div>}
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
            {!embedded && !compactReviewHeader && <div className={embedded ? "mt-0.5 truncate text-xs text-muted-foreground" : "mt-0.5 truncate text-xs text-muted-foreground sm:text-sm"} data-admin-module-summary={embedded ? "true" : undefined}>
              {embeddedModuleId === 'restaurants' ? reviewSummary : pendingQueueSummaryContent}
            </div>}
          </div>

          {/* 우측: 카테고리 필터 */}
          {!embedded && !compactReviewHeader && <div className="w-auto shrink-0 lg:flex lg:flex-1 lg:justify-end">
            {!recordViewsInvalidated && <CategorySidebar
              stats={stats}
              selectedStatuses={selectedStatuses}
              onSelectStatuses={setSelectedStatuses}
              showStatusChips={!showSubmissionView}
            >
              <div className="ml-auto flex items-center justify-end gap-1.5 lg:gap-1" data-admin-evaluation-view-actions="top-right" data-admin-module-actions={embedded ? "top-right" : undefined}>
                {reviewViewActions}
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
                          <span className="inline-flex md:inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-2xs font-semibold leading-none text-white lg:hidden">
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
            </CategorySidebar>}
          </div>}
        </div>
      </div>}

      {!showSubmissionView && <RestaurantReviewAutomation
        controlsTarget={compactReviewHeader ? managementHeader.automation : undefined}
        onApplied={() => { invalidateRecordViews(); void refreshRecordViews(); void invalidateRestaurantDiscoveryQueries(queryClient); }}
      />}
      {recordViewsInvalidated && <div role="alert" data-admin-record-views-invalidated className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs text-destructive"><span>변경 후 최신 정보를 다시 확인해야 합니다.</span><Button size="sm" variant="outline" disabled={recordActions.busy || recordViewsRefreshing} onClick={() => void refreshRecordViews()}>{recordViewsRefreshing ? '조회 중…' : '새로 조회'}</Button></div>}
      <div className="flex-1 min-h-0 flex flex-col" data-admin-module-content={embedded ? "bounded" : undefined}>
        {!recordViewsInvalidated && !legacyEvaluationLoad && pageReadError && !showSubmissionView ? <div role="alert" data-admin-evaluation-page-error="true" className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs text-destructive"><span>검수 목록 조회 실패</span><Button size="sm" variant="outline" disabled={loading} onClick={() => void loadAllRecords()}>다시 조회</Button></div> : null}
        {showSubmissionView && submissionInitialTab !== 'reviews' && <div className="admin-cms-toolbar">
          <Button variant="outline" size="sm" disabled={recordActions.busy || recordViewsInvalidated || submissionsLoading || submissionsData.length === 0} onClick={() => setSubmissionEditorOpen(true)}>제보 수정</Button>
        </div>}
        {showSubmissionView ? (
          /* 사용자 제보 목록 검수 뷰 */
          <SubmissionListView
            submissions={recordViewsInvalidated ? [] : allSubmissionRecords}
            onApprove={handleApproveSubmission}
            onReject={handleRejectSubmission}
            onDelete={handleDeleteSubmission}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
              queryClient.invalidateQueries({ queryKey: ['admin-restaurant-requests-inline'] });
              invalidateAdminPendingCounts();
            }}
            loading={submissionsLoading || recommendationRequestsLoading || recordActions.busy || recordViewsInvalidated}
            reviews={recordViewsInvalidated ? [] : reviewsData}
            onApproveReview={handleApproveReview}
            onRejectReview={handleRejectReview}
            onDeleteReview={handleDeleteReview}
            reviewsLoading={reviewsLoading || recordActions.busy || recordViewsInvalidated}
            initialTab={submissionInitialTab}
          />
        ) : isAlternateView ? (
          <EvaluationSlideView
            records={recordViewsInvalidated ? [] : visibleDisplayedRecords}
            currentIndex={currentSlideIndex}
            onNavigate={setCurrentSlideIndex}
            onApprove={handleApprove}
            onDelete={handleDelete}
            onRestore={handleRestore}
            onRegisterMissing={handleRegisterMissing}
            onResolveConflict={handleResolveConflict}
            onEdit={handleEdit}
            loading={loading || recordViewsInvalidated}
          />
        ) : (
          /* 테이블 영역 (무한 스크롤) */
          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-2">
            <EvaluationTable
              records={recordViewsInvalidated ? [] : visibleDisplayedRecords}
              onApprove={handleApprove}
              onDelete={handleDelete}
              onRestore={handleRestore}
              onRegisterMissing={handleRegisterMissing}
              onResolveConflict={handleResolveConflict}
              onEdit={handleEdit}
              loading={loading || recordViewsInvalidated}
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
              onRequestDetails={async record => Boolean(await ensureEvaluationDetails(record))}
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
                모든 레코드를 불러왔습니다 ({visibleDisplayedRecords.length}개 / 전체 {legacyEvaluationLoad ? filteredRecords.length : serverFilteredTotal}개)
              </div>
            )}
          </div>
        )}
      </div>

      <AdminRestaurantModal
        isOpen={createRestaurantOpen}
        restaurant={null}
        onClose={() => setCreateRestaurantOpen(false)}
        onSuccess={() => {
          void refreshRecordViews();
          void invalidateRestaurantDiscoveryQueries(queryClient);
        }}
      />

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
          queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
          void invalidateRestaurantDiscoveryQueries(queryClient);
        }}
      />

      <Dialog open={submissionEditorOpen} onOpenChange={setSubmissionEditorOpen}>
        <DialogContent className="flex max-h-[90dvh] max-w-xl flex-col overflow-hidden">
          <DialogHeader><DialogTitle className="text-base font-semibold leading-6">제보 수정</DialogTitle><DialogDescription>미처리 제보를 선택하고 변경 내용을 확인하세요.</DialogDescription></DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto text-sm">
            <label className="block space-y-1"><span>제보</span><select aria-label="수정할 제보" className="h-10 w-full rounded-md border bg-background px-2" value={editingSubmission?.id ?? ''} onChange={event => {
              const selected = submissionsData.find(row => row.id === event.target.value) ?? null;
              setEditingSubmission(selected);
              setSubmissionDraft(selected ? { restaurant_name: selected.restaurant_name, address: selected.restaurant_address ?? '', phone: selected.restaurant_phone ?? '', categories: selected.restaurant_categories ?? [], youtube_link: selected.items[0]?.youtube_link ?? '', description: selected.items[0]?.tzuyang_review ?? '' } : null);
            }}><option value="">선택하세요</option>{submissionsData.filter(row => !row.items[0] || row.items[0].item_status === 'pending').map(row => <option key={row.id} value={row.id}>{row.restaurant_name} · {row.id.slice(0, 8)}</option>)}</select></label>
            {submissionDraft && <>
              {([['restaurant_name', '맛집 이름'], ['address', '주소'], ['phone', '전화'], ['youtube_link', '영상 링크']] as const).map(([key, label]) => <label key={key} className="block space-y-1"><span>{label}</span><Input aria-label={`제보 ${label}`} value={submissionDraft[key]} onChange={event => setSubmissionDraft(previous => previous ? { ...previous, [key]: event.target.value } : null)} /></label>)}
              <fieldset><legend className="mb-1">분류 (최대 5개)</legend><div className="flex flex-wrap gap-2">{RECORD_CATEGORIES.map(category => <label key={category} className="flex items-center gap-1"><input type="checkbox" checked={submissionDraft.categories.includes(category)} disabled={!submissionDraft.categories.includes(category) && submissionDraft.categories.length >= 5} onChange={event => setSubmissionDraft(previous => previous ? { ...previous, categories: event.target.checked ? [...previous.categories, category] : previous.categories.filter(item => item !== category) } : null)} />{category}</label>)}</div></fieldset>
              <label className="block space-y-1"><span>첫 번째 영상 리뷰</span><textarea aria-label="제보 영상 리뷰" className="min-h-24 w-full rounded-md border bg-background p-2" value={submissionDraft.description} onChange={event => setSubmissionDraft(previous => previous ? { ...previous, description: event.target.value } : null)} /></label>
            </>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSubmissionEditorOpen(false)}>취소</Button><Button disabled={!editingSubmission || !submissionDraft || recordActions.busy} onClick={() => {
            if (!editingSubmission || !submissionDraft) return;
            setSubmissionEditorOpen(false);
            updateSubmissionMutation.mutate({ submission: editingSubmission, updatedData: submissionDraft });
          }}>변경 내용 확인</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {recordActions.dialog}

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
                  requireAdminUserId();
                  await performApproval(pendingApprovalRecord);
                } catch (error) {
                  notifyRecordActionError(error);
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
