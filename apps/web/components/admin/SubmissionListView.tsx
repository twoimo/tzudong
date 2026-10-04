'use client';

import { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react';
import { useFilledSkeletonCount } from '@/lib/use-filled-skeleton-count';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { adminReviewModerationStatus, selectAdminModerationRows, type AdminModerationFilter, type AdminModerationSort } from '@/lib/admin/submission-list-view-model';
import { toast } from '@/lib/no-toast';
import {
    CheckCircle2,
    XCircle,
    Trash2,
    Loader2,
    Clock,
    AlertCircle,
    Video,
    Edit,
    Search,
    X,
    MapPin,
    Calendar,
    MessageSquare,
    AlertTriangle,
    ScanSearch,
    RefreshCw,
} from 'lucide-react';
import { YouTubeIcon } from '@/components/icons/YouTubeIcon';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
    SubmissionDetailView,
    SubmissionRecord,
    ApprovalData,
    GeocodingResult,
    ItemDecision,
    NaverSearchResult,
} from './SubmissionDetailView';
import {
    TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import { GUARDED_MUTATION_CONFIRMATION } from '@/lib/admin/guarded-mutation-contract';
import { getSubmissionApprovalState } from '@/lib/admin/submission-approval-state';
import {
    ADMIN_SUBMISSION_QUEUE_REASON_FILTERS,
    adminSubmissionQueueSummaryMatchesFilter,
    getAdminSubmissionQueueSafetySummary,
    type AdminSubmissionQueueReason,
    type AdminSubmissionQueueReasonFilter,
    type AdminSubmissionQueueSafetySummary,
} from '@/lib/admin/submission-queue-safety';
import { resolveReviewPhotoUrl, type ReviewPhotoOwnership } from '@/lib/review-photo-url';
import { normalizeCanonicalYouTubeWatchUrl } from '@/lib/youtube-url';
import { decodeBasicHtmlEntities, stripUnsafeMarkup } from '@/lib/html-escape';

type SubmissionAdminTab = 'new' | 'edit' | 'recommend' | 'reviews';

const SUBMISSION_TAB_ORDER: SubmissionAdminTab[] = ['new', 'edit', 'recommend', 'reviews'];
const SUBMISSION_DELETE_CONFIRMATION = '제보삭제';
const RECOMMEND_APPROVE_CONFIRMATION = '추천승인';
const RECOMMEND_REJECT_CONFIRMATION = '추천거부';
const REVIEW_DELETE_CONFIRMATION = '리뷰삭제';
const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화';
const OVERRIDE_APPROVAL_CONFIRMATION = '무시승인';
const GUARDED_OCR_CONFIRMATION_MESSAGE =
    `이 OCR 작업은 ${GUARDED_MUTATION_CONFIRMATION} 보호 절차로 실행됩니다. 계속하시겠습니까?`;

function confirmGuardedOcrMutation(actionLabel: string): boolean {
    return window.confirm(`${actionLabel}\n\n${GUARDED_OCR_CONFIRMATION_MESSAGE}`);
}

function getGuardedMutationCorrelationId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const guardedMutation = (payload as { guardedMutation?: unknown }).guardedMutation;
    if (!guardedMutation || typeof guardedMutation !== 'object') return null;
    const audit = (guardedMutation as { audit?: unknown }).audit;
    if (!audit || typeof audit !== 'object') return null;
    const correlationId = (audit as { correlationId?: unknown }).correlationId;
    return typeof correlationId === 'string' && correlationId.trim()
        ? correlationId.trim()
        : null;
}

function getGuardedMutationReadbackLabel(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const guardedMutation = (payload as { guardedMutation?: unknown }).guardedMutation;
    if (!guardedMutation || typeof guardedMutation !== 'object') return null;
    const readback = (guardedMutation as { readback?: unknown }).readback;
    if (!readback || typeof readback !== 'object') return null;

    const readbackRecord = readback as {
        affectedCount?: unknown;
        resetApplied?: unknown;
        reviewId?: unknown;
        workflowDispatched?: unknown;
    };
    if (typeof readbackRecord.reviewId === 'string' && readbackRecord.reviewId.trim()) {
        return `재확인 리뷰 ${readbackRecord.reviewId.trim()}`;
    }
    if (typeof readbackRecord.affectedCount === 'number') {
        return `재확인 ${readbackRecord.affectedCount}건`;
    }
    if (typeof readbackRecord.workflowDispatched === 'boolean') {
        return readbackRecord.workflowDispatched ? '재확인 워크플로우 접수' : '재확인 필요';
    }
    if (typeof readbackRecord.resetApplied === 'boolean') {
        return readbackRecord.resetApplied ? '재확인 초기화 적용' : '재확인 초기화 미적용';
    }
    return null;
}

function buildGuardedOcrSuccessMessage(payload: unknown, fallback: string): string {
    const readbackLabel = getGuardedMutationReadbackLabel(payload);
    const correlationId = getGuardedMutationCorrelationId(payload);
    return [
        fallback,
        readbackLabel,
        correlationId ? `감사 추적 ${correlationId}` : null,
    ].filter(Boolean).join(' · ');
}



// 리뷰 타입 정의
export interface Review {
    id: string;
    user_id: string;
    restaurant_id: string;
    title: string;
    content: string;
    visited_at: string;
    verification_photo: string;
    food_photos: string[];
    category: string;
    is_verified: boolean;
    admin_note: string | null;
    is_pinned: boolean;
    is_edited_by_admin: boolean;
    created_at: string;
    updated_at: string;
    // OCR 중복 검사 관련 필드
    is_duplicate?: boolean;
    receipt_data?: {
        store_name?: string;
        date?: string;
        time?: string;
        total_amount?: number;
        items?: string[] | { name: string; price: number | null }[];
        confidence?: number;
        error?: string;
        duplicate_of?: string; // 중복 원본 리뷰 ID
    } | null;
    ocr_processed_at?: string | null;
    profiles: {
        nickname: string;
    } | null;
    restaurants: {
        name: string;
        address: string;
    } | null;
}

// 리뷰 사진 아이템 컴포넌트 (로딩 스피너 포함)
interface ReviewPhotoItemProps {
    src: string;
    alt: string;
    label: string;
    labelVariant: 'receipt' | 'food';
    onClick: () => void;
}

const ReviewPhotoItem = memo(function ReviewPhotoItem({
    src,
    alt,
    label,
    labelVariant,
    onClick,
}: ReviewPhotoItemProps) {
    const [isLoading, setIsLoading] = useState(true);

    // 영수증은 세로로 길게, 음식 사진은 정사각형에 가깝게
    const isReceipt = labelVariant === 'receipt';

    return (
        <button
            type="button"
            className={cn(
                "flex-shrink-0 border rounded-lg overflow-hidden relative cursor-pointer hover:ring-2 hover:ring-primary transition-all",
                isReceipt ? "h-48 min-w-28" : "h-32 min-w-24"  // 영수증은 더 크게
            )}
            onClick={onClick}
            aria-label={alt}
        >
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
                </div>
            )}
            <Image
                src={src}
                alt={alt}
                fill
                unoptimized
                sizes={isReceipt ? "256px" : "192px"}
                className={cn(
                    "w-auto object-contain transition-opacity",  // object-cover -> object-contain으로 변경
                    isReceipt ? "h-48 max-w-64" : "h-32 max-w-48",
                    isLoading ? "opacity-0" : "opacity-100"
                )}
                loading="lazy"
                decoding="async"
                onLoad={() => setIsLoading(false)}
                onError={() => setIsLoading(false)}
            />
            <Badge
                variant={labelVariant === 'receipt' ? 'default' : 'secondary'}
                className={cn(
                    "absolute top-1 left-1 text-2xs px-1",
                    labelVariant === 'receipt' && "bg-yellow-600"
                )}
            >
                {label}
            </Badge>
        </button>
    );
}, (prev, next) =>
    prev.src === next.src &&
    prev.alt === next.alt &&
    prev.label === next.label &&
    prev.labelVariant === next.labelVariant
);

interface SubmissionListViewProps {
    submissions: SubmissionRecord[];
    onApprove: (submission: SubmissionRecord, approvalData: ApprovalData, itemDecisions: Record<string, ItemDecision>, forceApprove: boolean, editableData: { name: string; address: string; phone: string; categories: string[] }, adminNote?: string) => void;
    onReject: (submission: SubmissionRecord, reason: string) => void;
    onDelete: (submission: SubmissionRecord) => void;
    hasNextSubmissionPage?: boolean;
    isFetchingNextSubmissionPage?: boolean;
    onLoadMoreSubmissions?: () => void;
    onRefresh?: () => void;
    loading?: boolean;
    // 리뷰 관련 props
    reviews?: Review[];
    onApproveReview?: (review: Review, adminNote: string) => void;
    onRejectReview?: (review: Review, adminNote: string) => void;
    onDeleteReview?: (review: Review) => void;
    reviewsLoading?: boolean;
    // 초기 탭 설정
    initialTab?: SubmissionAdminTab;
}

export function SubmissionListView({
    submissions,
    onApprove,
    onReject,
    onDelete,
    loading = false,
    hasNextSubmissionPage = false,
    isFetchingNextSubmissionPage = false,
    onLoadMoreSubmissions,
    onRefresh,
    // 리뷰 관련 props
    reviews = [],
    onApproveReview,
    onRejectReview,
    onDeleteReview,
    reviewsLoading = false,
    initialTab = 'new',
}: SubmissionListViewProps) {
    // 탭 상태 (초기 탭 지정 가능)
    const [activeTab, setActiveTab] = useState<SubmissionAdminTab>(initialTab);
    const submissionListSkeleton = useFilledSkeletonCount(76, 4, 40);
    const isMobile = useIsMobile();
    const [inlineInspector, setInlineInspector] = useState(false);
    const rowTriggerRef = useRef<HTMLButtonElement | null>(null);
    const listScrollRef = useRef<HTMLDivElement | null>(null);
    const reviewDetailPanelRef = useRef<HTMLElement>(null);
    useEffect(() => {
        const media = window.matchMedia('(min-width: 1280px)');
        const update = () => setInlineInspector(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    const SUBMISSION_LIST_PAGE_SIZE = 10;

    // 검색어
    const [searchQuery, setSearchQuery] = useState('');
    const [reviewSearchQuery, setReviewSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<AdminModerationFilter>('all');
    const [sortOrder, setSortOrder] = useState<AdminModerationSort>('priority');
    const [queueReasonFilter, setQueueReasonFilter] = useState<AdminSubmissionQueueReasonFilter>('all');

    // 선택된 제보
    const [selectedSubmission, setSelectedSubmission] = useState<SubmissionRecord | null>(null);
    const submissionDetailPanelRef = useRef<HTMLElement>(null);

    // 지오코딩 관련 상태
    const [approvalData, setApprovalData] = useState<ApprovalData>({
        lat: '',
        lng: '',
        road_address: '',
        jibun_address: '',
        english_address: '',
        address_elements: null,
    });
    const [geocodingResults, setGeocodingResults] = useState<GeocodingResult[]>([]);
    const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);

    // 항목별 결정 상태
    const [itemDecisions, setItemDecisions] = useState<Record<string, ItemDecision>>({});
    const [forceApprove, setForceApprove] = useState(false);
    const [overrideApprovalConfirmation, setOverrideApprovalConfirmation] = useState('');

    // 수정 가능한 데이터
    const [editableData, setEditableData] = useState({
        name: '',
        address: '',
        phone: '',
        categories: [] as string[],
    });

    // 거부 모달
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [recommendationAdminNote, setRecommendationAdminNote] = useState('');
    const [recommendationApprovalConfirmation, setRecommendationApprovalConfirmation] = useState('');
    const [recommendationRejectionConfirmation, setRecommendationRejectionConfirmation] = useState('');

    // 네이버 검색 검증 상태
    const [naverSearchLoading, setNaverSearchLoading] = useState(false);
    const [naverSearchResults, setNaverSearchResults] = useState<NaverSearchResult[]>([]);
    const [showWarningModal, setShowWarningModal] = useState(false);
    const [verificationDone, setVerificationDone] = useState(false);

    // 리뷰 관련 상태
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
    const [reviewAdminNote, setReviewAdminNote] = useState('');
    const [submissionDeleteTarget, setSubmissionDeleteTarget] = useState<SubmissionRecord | null>(null);
    const [submissionDeleteConfirmation, setSubmissionDeleteConfirmation] = useState('');
    const [reviewDeleteTarget, setReviewDeleteTarget] = useState<Review | null>(null);
    const [reviewDeleteConfirmation, setReviewDeleteConfirmation] = useState('');
    const [ocrResetConfirmation, setOcrResetConfirmation] = useState('');

    // OCR 관련 상태
    const [ocrStatus, setOcrStatus] = useState<{ pending: number; duplicate: number; processed: number } | null>(null);
    const [isOcrRunning, setIsOcrRunning] = useState(false);
    const [ocrRerunningIds, setOcrRerunningIds] = useState<Set<string>>(new Set());
    const [ocrCountdowns, setOcrCountdowns] = useState<Record<string, number>>({});  // 리뷰 ID별 카운트다운 (초)
    const ocrPollingRef = useRef<NodeJS.Timeout | null>(null);
    const ocrRealtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const ocrCountdownRef = useRef<NodeJS.Timeout | null>(null);
    const submissionTabSwipeStartXRef = useRef<number | null>(null);
    const submissionTabSwipeEndXRef = useRef<number | null>(null);
    const submissionTabSwipeStartYRef = useRef<number | null>(null);
    const submissionTabSwipeEndYRef = useRef<number | null>(null);
    const submissionTabSwipeLastHandledAtRef = useRef(0);
    const submissionTabSwipePointerIdRef = useRef<number | null>(null);
    const submissionTabSwipeInputRef = useRef<'pointer' | 'touch' | null>(null);
    const isSubmissionTabSwipeActiveRef = useRef(false);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
    const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);
    const wasFetchingNextSubmissionPageRef = useRef(false);
    const isLoadingMoreRef = useRef(false);

    const [visibleNewCount, setVisibleNewCount] = useState(SUBMISSION_LIST_PAGE_SIZE);
    const [visibleEditCount, setVisibleEditCount] = useState(SUBMISSION_LIST_PAGE_SIZE);
    const [visibleRecommendCount, setVisibleRecommendCount] = useState(SUBMISSION_LIST_PAGE_SIZE);
    const [visibleReviewCount, setVisibleReviewCount] = useState(SUBMISSION_LIST_PAGE_SIZE);


    const SUBMISSION_TAB_SWIPE_DISTANCE = 24;

    const handleSubmissionTabTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (isSubmissionTabSwipeActiveRef.current || submissionTabSwipeInputRef.current === 'pointer') return;
        submissionTabSwipeInputRef.current = 'touch';
        submissionTabSwipePointerIdRef.current = null;
        submissionTabSwipeStartXRef.current = e.touches[0].clientX;
        submissionTabSwipeStartYRef.current = e.touches[0].clientY;
        submissionTabSwipeEndXRef.current = null;
        submissionTabSwipeEndYRef.current = null;
        isSubmissionTabSwipeActiveRef.current = true;
    }, []);

    const handleSubmissionTabTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isSubmissionTabSwipeActiveRef.current || submissionTabSwipeInputRef.current !== 'touch') return;
        submissionTabSwipeEndXRef.current = e.touches[0].clientX;
        submissionTabSwipeEndYRef.current = e.touches[0].clientY;
    }, []);

    const resetVisibleCountByTab = useCallback((tab: SubmissionAdminTab) => {
        if (tab === 'new') {
            setVisibleNewCount(SUBMISSION_LIST_PAGE_SIZE);
            return;
        }

        if (tab === 'edit') {
            setVisibleEditCount(SUBMISSION_LIST_PAGE_SIZE);
            return;
        }

        if (tab === 'recommend') {
            setVisibleRecommendCount(SUBMISSION_LIST_PAGE_SIZE);
            return;
        }

        setVisibleReviewCount(SUBMISSION_LIST_PAGE_SIZE);
    }, []);

    const setActiveTabWithReset = useCallback((tab: SubmissionAdminTab) => {
        setActiveTab(tab);
        resetVisibleCountByTab(tab);
        setQueueReasonFilter('all');
        setStatusFilter('all');
        setSelectedSubmission(null);
        setSelectedReview(null);
        setShowRejectModal(false);
        setShowWarningModal(false);
        setReviewAction(null);
    }, [resetVisibleCountByTab]);
    const handleQueueReasonFilterChange = useCallback((filter: AdminSubmissionQueueReasonFilter) => {
        setQueueReasonFilter(filter);
        resetVisibleCountByTab(activeTab);
    }, [activeTab, resetVisibleCountByTab]);

    const increaseSubmissionVisibleCount = useCallback((tab: Exclude<SubmissionAdminTab, 'reviews'>) => {
        if (tab === 'new') {
            setVisibleNewCount((prev) => prev + SUBMISSION_LIST_PAGE_SIZE);
            return;
        }
        if (tab === 'recommend') {
            setVisibleRecommendCount((prev) => prev + SUBMISSION_LIST_PAGE_SIZE);
            return;
        }

        setVisibleEditCount((prev) => prev + SUBMISSION_LIST_PAGE_SIZE);
    }, []);

    const handleSubmissionTabSwipeEndInternal = useCallback((): boolean => {
        const startX = submissionTabSwipeStartXRef.current;
        const endX = submissionTabSwipeEndXRef.current;
        const startY = submissionTabSwipeStartYRef.current;
        const endY = submissionTabSwipeEndYRef.current;

        if (startX === null || endX === null || startY === null || endY === null) return false;

        const distanceX = startX - endX;
        const distanceY = startY - endY;

        if (Math.abs(distanceX) < SUBMISSION_TAB_SWIPE_DISTANCE || Math.abs(distanceX) <= Math.abs(distanceY)) {
            return false;
        }

        const currentIndex = SUBMISSION_TAB_ORDER.indexOf(activeTab);
        if (currentIndex === -1) return false;

        if (distanceX > 0 && currentIndex < SUBMISSION_TAB_ORDER.length - 1) {
            setActiveTabWithReset(SUBMISSION_TAB_ORDER[currentIndex + 1]);
            return true;
        }

        if (distanceX < 0 && currentIndex > 0) {
            setActiveTabWithReset(SUBMISSION_TAB_ORDER[currentIndex - 1]);
            return true;
        }

        return false;
    }, [activeTab, setActiveTabWithReset]);

    const handleSubmissionTabPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (isSubmissionTabSwipeActiveRef.current || submissionTabSwipeInputRef.current === 'touch') return;
        submissionTabSwipeInputRef.current = 'pointer';
        submissionTabSwipePointerIdRef.current = e.pointerId;
        isSubmissionTabSwipeActiveRef.current = true;
        submissionTabSwipeStartXRef.current = e.clientX;
        submissionTabSwipeStartYRef.current = e.clientY;
        submissionTabSwipeEndXRef.current = null;
        submissionTabSwipeEndYRef.current = null;
    }, []);

    const handleSubmissionTabPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isSubmissionTabSwipeActiveRef.current || submissionTabSwipeInputRef.current !== 'pointer' || submissionTabSwipePointerIdRef.current !== e.pointerId) return;
        submissionTabSwipeEndXRef.current = e.clientX;
        submissionTabSwipeEndYRef.current = e.clientY;
        const dx = e.clientX - (submissionTabSwipeStartXRef.current ?? e.clientX);
        const dy = e.clientY - (submissionTabSwipeStartYRef.current ?? e.clientY);
        if (Math.abs(dx) >= SUBMISSION_TAB_SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Pointer may already have ended. */ }
        }
    }, []);

    const handleSubmissionTabPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isSubmissionTabSwipeActiveRef.current || submissionTabSwipeInputRef.current !== 'pointer' || submissionTabSwipePointerIdRef.current !== e.pointerId) return;
        if (Date.now() - submissionTabSwipeLastHandledAtRef.current < 250) {
            isSubmissionTabSwipeActiveRef.current = false;
            submissionTabSwipeInputRef.current = null;
            submissionTabSwipePointerIdRef.current = null;
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
                // no-op
            }
            return;
        }

        const didSwipe = handleSubmissionTabSwipeEndInternal();
        if (didSwipe) {
            submissionTabSwipeLastHandledAtRef.current = Date.now();
            e.preventDefault();
        }
        isSubmissionTabSwipeActiveRef.current = false;
        submissionTabSwipeInputRef.current = null;
        submissionTabSwipePointerIdRef.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // no-op
        }
    }, [handleSubmissionTabSwipeEndInternal]);

    const handleSubmissionTabSwipeEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isSubmissionTabSwipeActiveRef.current || submissionTabSwipeInputRef.current !== 'touch' || submissionTabSwipePointerIdRef.current !== null) return;
        if (Date.now() - submissionTabSwipeLastHandledAtRef.current < 250) {
            isSubmissionTabSwipeActiveRef.current = false;
            submissionTabSwipeInputRef.current = null;
            return;
        }

        const didSwipe = handleSubmissionTabSwipeEndInternal();
        if (didSwipe) {
            submissionTabSwipeLastHandledAtRef.current = Date.now();
            e.preventDefault();
        }
        isSubmissionTabSwipeActiveRef.current = false;
        submissionTabSwipeInputRef.current = null;
    }, [handleSubmissionTabSwipeEndInternal]);

    const handleSubmissionTabPointerCancel = useCallback(() => {
        isSubmissionTabSwipeActiveRef.current = false;
        submissionTabSwipeInputRef.current = null;
        submissionTabSwipePointerIdRef.current = null;
    }, []);

    const handleSubmissionTabTouchCancel = useCallback(() => {
        if (!isSubmissionTabSwipeActiveRef.current || submissionTabSwipeInputRef.current !== 'touch') return;
        isSubmissionTabSwipeActiveRef.current = false;
        submissionTabSwipeInputRef.current = null;
    }, []);

    // 이미지 확대 모달 상태
    const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);
    const selectedReviewPhotos = useMemo(() => {
        if (!selectedReview) {
            return { verificationPhotoUrl: null, foodPhotos: [] as Array<{ url: string; index: number }> };
        }

        const verificationPhotoOwnership: ReviewPhotoOwnership = {
            ownerId: selectedReview.user_id,
            reviewId: selectedReview.id,
            purpose: 'verification',
        };
        const foodPhotoOwnership: ReviewPhotoOwnership = {
            ownerId: selectedReview.user_id,
            reviewId: selectedReview.id,
            purpose: 'food',
        };
        const verificationPhotoUrl = resolveReviewPhotoUrl(
            selectedReview.verification_photo,
            verificationPhotoOwnership,
            selectedReview.ocr_processed_at,
        );
        const foodPhotos = Array.isArray(selectedReview.food_photos)
            ? selectedReview.food_photos.reduce<Array<{ url: string; index: number }>>((photos, photo, index) => {
                const url = resolveReviewPhotoUrl(photo, foodPhotoOwnership);
                if (url) photos.push({ url, index });
                return photos;
            }, [])
            : [];

        return { verificationPhotoUrl, foodPhotos };
    }, [selectedReview]);

    // OCR 상태 조회
    const fetchOcrStatus = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/ocr-receipts');
            if (response.ok) {
                const data = await response.json();
                setOcrStatus(data);
            }
        } catch (error) {
            console.error('OCR 상태 조회 실패:');
        }
    }, []);

    // OCR 실행 (미처리 리뷰만)
    const handleRunOcr = useCallback(async () => {
        if (!confirmGuardedOcrMutation('미처리 리뷰 OCR 처리를 시작합니다.')) return;

        setIsOcrRunning(true);
        try {
            const response = await fetch('/api/admin/ocr-receipts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guardedMutationConfirmation: GUARDED_MUTATION_CONFIRMATION }),
            });
            const data = await response.json();
            if (response.ok && data.success) {
                toast.success(buildGuardedOcrSuccessMessage(data, data.message || 'OCR 처리가 시작되었습니다.'));
                // GitHub Actions가 완료되면 상태가 갱신되므로 잠시 후 다시 조회
                setTimeout(() => fetchOcrStatus(), 3000);
            } else {
                toast.error(`OCR 처리 실패: ${data.error || '알 수 없는 오류'}`);
            }
        } catch {
            toast.error('OCR 처리 중 오류가 발생했습니다.');
        } finally {
            setIsOcrRunning(false);
        }
    }, [fetchOcrStatus]);

    // OCR 전체 리셋 및 재실행
    const handleResetAllOcr = useCallback(async () => {
        if (ocrResetConfirmation !== OCR_RESET_ALL_CONFIRMATION) {
            toast.error('OCR 전체 재실행 확인 문구가 일치하지 않습니다.');
            return;
        }

        if (!confirmGuardedOcrMutation('모든 리뷰 OCR 데이터를 초기화하고 재실행합니다.')) return;

        setIsOcrRunning(true);
        try {
            const response = await fetch('/api/admin/ocr-receipts/reset-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    confirmation: OCR_RESET_ALL_CONFIRMATION,
                    guardedMutationConfirmation: GUARDED_MUTATION_CONFIRMATION,
                }),
            });
            const data = await response.json();
            if (response.ok && data.success) {
                toast.success(buildGuardedOcrSuccessMessage(data, data.message || 'OCR 전체 재실행이 시작되었습니다.'));
                setOcrResetConfirmation('');
                setTimeout(() => fetchOcrStatus(), 3000);
            } else {
                toast.error(`OCR 전체 재실행 실패: ${data.error || '알 수 없는 오류'}`);
            }
        } catch {
            toast.error('OCR 전체 재실행 중 오류가 발생했습니다.');
        } finally {
            setIsOcrRunning(false);
        }
    }, [fetchOcrStatus, ocrResetConfirmation]);

    // 리뷰 탭 활성화 시 OCR 상태 조회 + 주기적 갱신
    useEffect(() => {
        if (activeTab === 'reviews') {
            fetchOcrStatus();
            // 30초마다 자동 갱신
            const interval = setInterval(fetchOcrStatus, 30000);
            return () => clearInterval(interval);
        }
    }, [activeTab, fetchOcrStatus]);

    // OCR 카운트다운 타이머 관리
    const hasOcrCountdowns = useMemo(() => Object.keys(ocrCountdowns).length > 0, [ocrCountdowns]);

    useEffect(() => {
        // 카운트다운이 있는 리뷰가 있으면 1초마다 감소
        if (!hasOcrCountdowns) {
            if (ocrCountdownRef.current) {
                clearInterval(ocrCountdownRef.current);
                ocrCountdownRef.current = null;
            }
            return;
        }

        ocrCountdownRef.current = setInterval(() => {
            setOcrCountdowns(prev => {
                const next: Record<string, number> = {};
                for (const [id, seconds] of Object.entries(prev)) {
                    if (seconds > 1) {
                        next[id] = seconds - 1;
                    }
                    // 0이 되면 제거
                }
                return next;
            });
        }, 1000);

        return () => {
            if (ocrCountdownRef.current) {
                clearInterval(ocrCountdownRef.current);
                ocrCountdownRef.current = null;
            }
        };
    }, [hasOcrCountdowns]);

    // 단일 리뷰 OCR 재실행 (GitHub Actions 트리거)
    const handleRerunOcr = useCallback(async (reviewId: string) => {
        if (!confirmGuardedOcrMutation('선택한 리뷰 OCR 데이터를 초기화하고 재실행합니다.')) return;

        // 해당 리뷰 ID를 재실행 중 상태로 추가
        setOcrRerunningIds(prev => new Set(prev).add(reviewId));
        // 40초 카운트다운 시작
        setOcrCountdowns(prev => ({ ...prev, [reviewId]: 40 }));

        try {
            // GitHub Actions 워크플로우 트리거
            const response = await fetch('/api/admin/ocr-receipts/rerun', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reviewId,
                    guardedMutationConfirmation: GUARDED_MUTATION_CONFIRMATION,
                }),
            });
            const data = await response.json();
            if (response.ok && data.success) {
                toast.success(buildGuardedOcrSuccessMessage(data, data.message || 'OCR 처리가 시작되었습니다.'));

                // 선택된 리뷰 OCR 상태 초기화 (UI 즉시 반영)
                if (selectedReview && selectedReview.id === reviewId) {
                    setSelectedReview(prev => prev ? {
                        ...prev,
                        ocr_processed_at: null,
                        receipt_data: null,
                        is_duplicate: false,
                    } : null);
                }
            } else {
                toast.error(`OCR 재실행 실패: ${data.error || '알 수 없는 오류'}`);
                // 실패 시 해당 ID 제거 및 카운트다운 중지
                setOcrRerunningIds(prev => {
                    const next = new Set(prev);
                    next.delete(reviewId);
                    return next;
                });
                setOcrCountdowns(prev => {
                    const next = { ...prev };
                    delete next[reviewId];
                    return next;
                });
            }
        } catch {
            toast.error('OCR 재실행 중 오류가 발생했습니다.');
            setOcrRerunningIds(prev => {
                const next = new Set(prev);
                next.delete(reviewId);
                return next;
            });
            setOcrCountdowns(prev => {
                const next = { ...prev };
                delete next[reviewId];
                return next;
            });
        }
    }, [selectedReview]);

    // 리뷰 상세 패널이 열릴 때 Supabase Realtime 구독 + 폴링 시작
    useEffect(() => {
        if (activeTab !== 'reviews' || !selectedReview?.id) {
            // 상세 패널 해제 시 정리
            if (ocrPollingRef.current) {
                clearInterval(ocrPollingRef.current);
                ocrPollingRef.current = null;
            }
            if (ocrRealtimeChannelRef.current) {
                supabase.removeChannel(ocrRealtimeChannelRef.current);
                ocrRealtimeChannelRef.current = null;
            }
            return;
        }

        const reviewId = selectedReview.id;
        const originalOcrProcessedAt = selectedReview.ocr_processed_at;

        // Supabase Realtime 구독 (reviews 테이블 변경 감지)
        const channel = supabase
            .channel(`review-ocr-${reviewId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'reviews',
                    filter: `id=eq.${reviewId}`,
                },
                (payload) => {
                    const updated = payload.new as Review;
                    // OCR 처리가 완료된 경우 (ocr_processed_at가 갱신됨)
                    if (updated.ocr_processed_at && updated.ocr_processed_at !== originalOcrProcessedAt) {
                        setSelectedReview(prev => prev ? {
                            ...prev,
                            ocr_processed_at: updated.ocr_processed_at,
                            receipt_data: updated.receipt_data,
                            is_duplicate: updated.is_duplicate,
                        } : null);
                        // 완료된 리뷰 ID를 재실행 중 상태에서 제거
                        setOcrRerunningIds(prev => {
                            const next = new Set(prev);
                            next.delete(reviewId);
                            return next;
                        });
                        // 카운트다운 제거
                        setOcrCountdowns(prev => {
                            const next = { ...prev };
                            delete next[reviewId];
                            return next;
                        });
                        toast.success('OCR 처리가 완료되었습니다.');

                        // 폴링 중단
                        if (ocrPollingRef.current) {
                            clearInterval(ocrPollingRef.current);
                            ocrPollingRef.current = null;
                        }
                    }
                }
            )
            .subscribe();

        ocrRealtimeChannelRef.current = channel;

        // 폴링 fallback (Realtime이 작동하지 않는 환경용, 5초 간격, 최대 60초)
        let pollCount = 0;
        const maxPolls = 12; // 12 * 5초 = 60초

        const pollReviewOcr = async () => {
            pollCount++;
            if (pollCount > maxPolls) {
                // 60초 초과 시 폴링 중단
                if (ocrPollingRef.current) {
                    clearInterval(ocrPollingRef.current);
                    ocrPollingRef.current = null;
                }
                setOcrRerunningIds(prev => {
                    const next = new Set(prev);
                    next.delete(reviewId);
                    return next;
                });
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('reviews')
                    .select('ocr_processed_at, receipt_data, is_duplicate')
                    .eq('id', reviewId)
                    .single();

                // 타입 추론을 위한 캐스팅
                const ocrData = data as { ocr_processed_at: string | null; receipt_data: Review['receipt_data']; is_duplicate: boolean | null } | null;

                if (!error && ocrData?.ocr_processed_at && ocrData.ocr_processed_at !== originalOcrProcessedAt) {
                    setSelectedReview(prev => prev ? {
                        ...prev,
                        ocr_processed_at: ocrData.ocr_processed_at,
                        receipt_data: ocrData.receipt_data,
                        is_duplicate: ocrData.is_duplicate ?? false,
                    } : null);
                    setOcrRerunningIds(prev => {
                        const next = new Set(prev);
                        next.delete(reviewId);
                        return next;
                    });
                    // 카운트다운 제거
                    setOcrCountdowns(prev => {
                        const next = { ...prev };
                        delete next[reviewId];
                        return next;
                    });
                    toast.success('OCR 처리가 완료되었습니다.');

                    // 폴링 중단
                    if (ocrPollingRef.current) {
                        clearInterval(ocrPollingRef.current);
                        ocrPollingRef.current = null;
                    }
                }
            } catch (err) {
                console.error('OCR 상태 폴링 오류:');
            }
        };

        // OCR 재실행 중일 때만 폴링 시작
        const isRerunning = ocrRerunningIds.has(reviewId);
        if (isRerunning) {
            ocrPollingRef.current = setInterval(pollReviewOcr, 5000);
        }

        return () => {
            if (ocrPollingRef.current) {
                clearInterval(ocrPollingRef.current);
                ocrPollingRef.current = null;
            }
            supabase.removeChannel(channel);
        };
    }, [activeTab, selectedReview?.id, selectedReview?.ocr_processed_at, ocrRerunningIds]);

    const submissionQueueSafetyById = useMemo(() => {
        return new Map<string, AdminSubmissionQueueSafetySummary>(
            submissions.map((submission) => [
                submission.id,
                getAdminSubmissionQueueSafetySummary(submission),
            ])
        );
    }, [submissions]);

    const queueReasonFilterOptions = useMemo(() => {
        const activeSubmissions = activeTab === 'reviews'
            ? []
            : submissions.filter((submission) => submission.submission_type === activeTab);

        return ADMIN_SUBMISSION_QUEUE_REASON_FILTERS.map((option) => {
            const count = option.value === 'all'
                ? activeSubmissions.length
                : activeSubmissions.filter((submission) => {
                    const summary = submissionQueueSafetyById.get(submission.id);
                    return summary ? adminSubmissionQueueSummaryMatchesFilter(summary, option.value) : false;
                }).length;

            return { ...option, count };
        });
    }, [activeTab, submissions, submissionQueueSafetyById]);

    const filteredSubmissions = useMemo(() => {
        if (activeTab === 'reviews') return [];
        const rows = submissions.filter(submission => submission.submission_type === activeTab && (queueReasonFilter === 'all' || adminSubmissionQueueSummaryMatchesFilter(submissionQueueSafetyById.get(submission.id)!, queueReasonFilter)));
        return selectAdminModerationRows(rows, { query: searchQuery, status: statusFilter, sort: sortOrder }, submission => ({
            name: submission.restaurant_name,
            status: submission.status,
            search: [submission.restaurant_name, submission.restaurant_address, submission.restaurant_phone, submission.recommendation_reason, submission.profiles?.nickname, ...submission.items.flatMap(item => [item.youtube_link, item.tzuyang_review])],
        }));
    }, [submissions, activeTab, searchQuery, statusFilter, sortOrder, queueReasonFilter, submissionQueueSafetyById]);
    const filteredReviews = useMemo(() => selectAdminModerationRows(reviews, { query: reviewSearchQuery, status: statusFilter, sort: sortOrder }, review => ({
        name: review.restaurants?.name || review.title,
        status: adminReviewModerationStatus(review),
        duplicate: review.is_duplicate,
        search: [review.title, review.content, review.restaurants?.name, review.profiles?.nickname],
    })), [reviews, reviewSearchQuery, statusFilter, sortOrder]);
    const pendingReviews = useMemo(() => reviews.filter(review => adminReviewModerationStatus(review) === 'pending'), [reviews]);
    const approvedReviews = useMemo(() => reviews.filter(review => adminReviewModerationStatus(review) === 'approved'), [reviews]);
    const rejectedReviews = useMemo(() => reviews.filter(review => adminReviewModerationStatus(review) === 'rejected'), [reviews]);

    // 제보 상태별 분류
    const newSubmissions = useMemo(() =>
        submissions.filter(s => s.submission_type === 'new'), [submissions]);
    const editSubmissions = useMemo(() =>
        submissions.filter(s => s.submission_type === 'edit'), [submissions]);
    const recommendSubmissions = useMemo(() =>
        submissions.filter(s => s.submission_type === 'recommend'), [submissions]);

    const newPendingCount = useMemo(() =>
        newSubmissions.filter(s => s.status === 'pending' || s.status === 'partially_approved').length, [newSubmissions]);
    const newApprovedCount = useMemo(() =>
        newSubmissions.filter(s => s.status === 'approved').length, [newSubmissions]);
    const newRejectedCount = useMemo(() =>
        newSubmissions.filter(s => s.status === 'rejected').length, [newSubmissions]);

    const editPendingCount = useMemo(() =>
        editSubmissions.filter(s => s.status === 'pending' || s.status === 'partially_approved').length, [editSubmissions]);
    const editApprovedCount = useMemo(() =>
        editSubmissions.filter(s => s.status === 'approved').length, [editSubmissions]);
    const editRejectedCount = useMemo(() =>
        editSubmissions.filter(s => s.status === 'rejected').length, [editSubmissions]);

    const recommendPendingCount = useMemo(() =>
        recommendSubmissions.filter(s => s.status === 'pending').length, [recommendSubmissions]);
    const recommendApprovedCount = useMemo(() =>
        recommendSubmissions.filter(s => s.status === 'approved').length, [recommendSubmissions]);
    const recommendRejectedCount = useMemo(() =>
        recommendSubmissions.filter(s => s.status === 'rejected').length, [recommendSubmissions]);

    // 통계 (탭 버튼 배지용)
    const newCount = useMemo(() =>
        submissions.filter(s => s.submission_type === 'new' && (s.status === 'pending' || s.status === 'partially_approved')).length
        , [submissions]);

    const editCount = useMemo(() =>
        submissions.filter(s => s.submission_type === 'edit' && (s.status === 'pending' || s.status === 'partially_approved')).length
        , [submissions]);

    const recommendCount = useMemo(() =>
        submissions.filter(s => s.submission_type === 'recommend' && s.status === 'pending').length
        , [submissions]);

    const reviewPendingCount = useMemo(() => pendingReviews.length, [pendingReviews]);
    const currentTabSummary = useMemo(() => {
        if (activeTab === 'new') {
            return {
                label: '신규',
                pending: newPendingCount,
                approved: newApprovedCount,
                rejected: newRejectedCount,
                total: newSubmissions.length,
            };
        }

        if (activeTab === 'edit') {
            return {
                label: '수정',
                pending: editPendingCount,
                approved: editApprovedCount,
                rejected: editRejectedCount,
                total: editSubmissions.length,
            };
        }

        if (activeTab === 'recommend') {
            return {
                label: '쯔양 제보',
                pending: recommendPendingCount,
                approved: recommendApprovedCount,
                rejected: recommendRejectedCount,
                total: recommendSubmissions.length,
            };
        }

        return {
            label: '리뷰',
            pending: pendingReviews.length,
            approved: approvedReviews.length,
            rejected: rejectedReviews.length,
            total: reviews.length,
        };
    }, [
        activeTab,
        newPendingCount,
        newApprovedCount,
        newRejectedCount,
        newSubmissions.length,
        editPendingCount,
        editApprovedCount,
        editRejectedCount,
        editSubmissions.length,
        recommendPendingCount,
        recommendApprovedCount,
        recommendRejectedCount,
        recommendSubmissions.length,
        pendingReviews.length,
        approvedReviews.length,
        rejectedReviews.length,
        reviews.length,
    ]);
    const rowButtonClassName = 'block w-full min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
    const listBodyClassName = 'admin-cms-table-container min-h-0 flex-1 overflow-y-auto';
    const filterClassName = 'h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs';
    const listCategoryBadgeClassName = 'px-1.5 py-0 text-[11px]';
    const renderListSkeletonCards = (label: string) => (
        <div ref={submissionListSkeleton.ref} className={listBodyClassName} role="status" aria-busy="true" aria-label={`${label} 목록 로딩 중`}>
            <Skeleton className="h-8 rounded-md motion-reduce:animate-none" aria-hidden="true" />
            {Array.from({ length: submissionListSkeleton.count }).map((_, index) => (
                <Card key={index} className="rounded-lg border p-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_80px_72px] sm:items-center">
                        <div className="min-w-0 space-y-1.5">
                            <Skeleton className="h-3.5 w-3/4 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                            <Skeleton className="h-2.5 w-5/6 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                        </div>
                        <Skeleton className="h-6 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                        <Skeleton className="h-7 rounded-md motion-reduce:animate-none" aria-hidden="true" />
                    </div>
                </Card>
            ))}
            <div className="h-4" />
        </div>
    );

    const orderedReviews = filteredReviews;

    const visibleSubmissionCount = useMemo(() => {
        if (activeTab === 'new') return visibleNewCount;
        if (activeTab === 'recommend') return visibleRecommendCount;
        return visibleEditCount;
    }, [activeTab, visibleEditCount, visibleNewCount, visibleRecommendCount]);
    const displayedSubmissions = useMemo(() => filteredSubmissions.slice(0, visibleSubmissionCount), [filteredSubmissions, visibleSubmissionCount]);
    const displayedReviews = useMemo(() => orderedReviews.slice(0, visibleReviewCount), [orderedReviews, visibleReviewCount]);

    const hasMoreSubmissions = filteredSubmissions.length > visibleSubmissionCount || (activeTab !== 'recommend' && hasNextSubmissionPage);
    const hasMoreReviews = orderedReviews.length > visibleReviewCount;
    const hasMoreCards = activeTab === 'reviews' ? hasMoreReviews : hasMoreSubmissions;
    const isCurrentListLoading = activeTab === 'reviews'
        ? reviewsLoading
        : loading || isFetchingNextSubmissionPage;

    const handleLoadMoreCards = useCallback(() => {
        if (!hasMoreCards || isCurrentListLoading || isLoadingMoreRef.current) return;

        isLoadingMoreRef.current = true;

        if (activeTab === 'reviews') {
            setVisibleReviewCount((prev) => Math.min(prev + SUBMISSION_LIST_PAGE_SIZE, orderedReviews.length));
            requestAnimationFrame(() => {
                isLoadingMoreRef.current = false;
            });
            return;
        }

        const hasMoreVisibleSubmissions = filteredSubmissions.length > visibleSubmissionCount;
        const shouldRequestNextSubmissionPage =
            !hasMoreVisibleSubmissions &&
            hasNextSubmissionPage &&
            !!onLoadMoreSubmissions;

        if (shouldRequestNextSubmissionPage) {
            increaseSubmissionVisibleCount(activeTab);
            onLoadMoreSubmissions();
            return;
        }

        if (activeTab === 'new') {
            setVisibleNewCount((prev) => Math.min(prev + SUBMISSION_LIST_PAGE_SIZE, filteredSubmissions.length));
            requestAnimationFrame(() => {
                isLoadingMoreRef.current = false;
            });
            return;
        }

        if (activeTab === 'recommend') {
            setVisibleRecommendCount((prev) => Math.min(prev + SUBMISSION_LIST_PAGE_SIZE, filteredSubmissions.length));
            requestAnimationFrame(() => {
                isLoadingMoreRef.current = false;
            });
            return;
        }

        setVisibleEditCount((prev) => Math.min(prev + SUBMISSION_LIST_PAGE_SIZE, filteredSubmissions.length));
        requestAnimationFrame(() => {
            isLoadingMoreRef.current = false;
        });
    }, [
        activeTab,
        hasMoreCards,
        isCurrentListLoading,
        orderedReviews.length,
        filteredSubmissions.length,
        visibleSubmissionCount,
        hasNextSubmissionPage,
        onLoadMoreSubmissions,
        increaseSubmissionVisibleCount,
    ]);

    useEffect(() => {
        if (wasFetchingNextSubmissionPageRef.current && !isFetchingNextSubmissionPage) {
            isLoadingMoreRef.current = false;
        }

        wasFetchingNextSubmissionPageRef.current = isFetchingNextSubmissionPage;
    }, [isFetchingNextSubmissionPage]);

    // 탭/검색 변경 시 노출 개수 초기화
    useEffect(() => {
        if (activeTab === 'new') {
            setVisibleNewCount(SUBMISSION_LIST_PAGE_SIZE);
            return;
        }

        if (activeTab === 'edit') {
            setVisibleEditCount(SUBMISSION_LIST_PAGE_SIZE);
            return;
        }

        if (activeTab === 'recommend') {
            setVisibleRecommendCount(SUBMISSION_LIST_PAGE_SIZE);
            return;
        }

        setVisibleReviewCount(SUBMISSION_LIST_PAGE_SIZE);
    }, [activeTab, searchQuery, reviewSearchQuery, statusFilter, sortOrder]);
    useEffect(() => { listScrollRef.current?.scrollTo({ top: 0 }); }, [activeTab, searchQuery, reviewSearchQuery, statusFilter, sortOrder, queueReasonFilter]);

    useEffect(() => {
        const sentinel = loadMoreSentinelRef.current;
        if (!sentinel) return;

        if (!hasMoreCards || isCurrentListLoading) {
            if (loadMoreObserverRef.current) {
                loadMoreObserverRef.current.disconnect();
                loadMoreObserverRef.current = null;
            }
            return;
        }

        if (loadMoreObserverRef.current) {
            loadMoreObserverRef.current.disconnect();
            loadMoreObserverRef.current = null;
        }

        const containerRoot = (() => {
            let current: HTMLElement | null = sentinel.parentElement;

            while (current) {
                const style = window.getComputedStyle(current);
                const isOverflowing = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay'
                    || style.overflow === 'auto' || style.overflow === 'scroll' || style.overflow === 'overlay';

                if (isOverflowing && current.scrollHeight > current.clientHeight) {
                    return current;
                }

                current = current.parentElement;
            }

            return null;
        })();

        loadMoreObserverRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && hasMoreCards && !isCurrentListLoading) {
                    handleLoadMoreCards();
                }
            },
            { root: containerRoot, rootMargin: '200px 0px 0px 0px', threshold: 0.01 }
        );

        loadMoreObserverRef.current.observe(sentinel);

        return () => {
            if (loadMoreObserverRef.current) {
                loadMoreObserverRef.current.disconnect();
                loadMoreObserverRef.current = null;
            }
        };
    }, [handleLoadMoreCards, hasMoreCards, isCurrentListLoading]);
    // 상태 뱃지
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved':
                return <Badge className="bg-green-600 text-xs">승인</Badge>;
            case 'partially_approved':
                return <Badge className="bg-amber-500 text-xs">부분승인</Badge>;
            case 'rejected':
                return <Badge variant="destructive" className="text-xs">거부</Badge>;
            case 'pending':
                return <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />대기</Badge>;
            default:
                return <Badge variant="outline" className="text-xs">미확인</Badge>;
        }
    };
    const getSubmissionQueueReasonBadgeClassName = (reason: AdminSubmissionQueueReason) =>
        cn(
            "max-w-full rounded-full px-2 py-0 text-2xs font-semibold leading-5 xl:text-2xs",
            reason.severity === 'danger' && "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-200",
            reason.severity === 'warning' && "border-border bg-secondary text-foreground",
            reason.severity === 'info' && "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/25 dark:text-blue-200"
        );

    const renderSubmissionQueueSafetyBadges = (
        summary: AdminSubmissionQueueSafetySummary | undefined,
        placement: 'card' | 'detail'
    ) => {
        if (!summary?.reasons.length) return null;

        const reasons = placement === 'card' ? summary.reasons.slice(0, 2) : summary.reasons;

        return (
            <div
                className="mt-1 flex flex-wrap gap-1"
                data-admin-submission-safety-badges={placement}
                aria-label="제보 큐 검수 사유"
            >
                {reasons.map((reason) => (
                    <Badge
                        key={reason.code}
                        variant="outline"
                        className={getSubmissionQueueReasonBadgeClassName(reason)}
                        title={reason.message}
                        data-admin-submission-safety-badge={reason.code}
                    >
                        {reason.label}
                    </Badge>
                ))}
                {placement === 'card' && summary.reasons.length > reasons.length && (
                    <Badge
                        variant="outline"
                        className="rounded-full px-2 py-0 text-2xs leading-5 text-muted-foreground xl:text-2xs"
                        data-admin-submission-safety-badge="more"
                    >
                        +{summary.reasons.length - reasons.length}
                    </Badge>
                )}
            </div>
        );
    };

    const getReviewFlags = (review: Review) => {
        const isPending = !review.is_verified && (!review.admin_note || !review.admin_note.includes('거부'));
        const isApproved = review.is_verified;
        const isRejected = !review.is_verified && review.admin_note?.includes('거부');
        return { isPending, isApproved, isRejected };
    };

    const renderReviewStatusBadge = (review: Review) => {
        const { isPending, isApproved, isRejected } = getReviewFlags(review);

        if (isPending) {
            return (
                <Badge variant="secondary" className="gap-1 text-xs">
                    <Clock className="h-3 w-3" /> 대기
                </Badge>
            );
        }

        if (isApproved) {
            return (
                <Badge className="gap-1 bg-green-500 text-xs">
                    <CheckCircle2 className="h-3 w-3" /> 승인
                </Badge>
            );
        }

        if (isRejected) {
            return (
                <Badge variant="destructive" className="gap-1 text-xs">
                    <XCircle className="h-3 w-3" /> 거부
                </Badge>
            );
        }

        return null;
    };

    // 상세 패널 열기
    const openSubmissionDetail = useCallback((submission: SubmissionRecord) => {
        setSelectedSubmission(submission);
        setSubmissionDeleteTarget(null);
        setSubmissionDeleteConfirmation('');
        setApprovalData({
            lat: '',
            lng: '',
            road_address: '',
            jibun_address: '',
            english_address: '',
            address_elements: null,
        });
        setGeocodingResults([]);
        setNaverSearchResults([]);
        setVerificationDone(false);
        setShowWarningModal(false);
        setOverrideApprovalConfirmation('');
        setSelectedGeocodingIndex(null);
        setForceApprove(false);
        setRejectionReason('');
        setRecommendationAdminNote(submission.recommendation_admin_note || '');
        setRecommendationApprovalConfirmation('');
        setRecommendationRejectionConfirmation('');

        setEditableData({
            name: submission.restaurant_name,
            address: submission.restaurant_address || '',
            phone: submission.restaurant_phone || '',
            categories: submission.restaurant_categories || [],
        });

        const initialDecisions: Record<string, ItemDecision> = {};
        submission.items
            .filter(item => item.item_status === 'pending')
            .forEach(item => {
                initialDecisions[item.id] = {
                    approved: false,
                    rejectionReason: '',
                    youtube_link: item.youtube_link,
                    tzuyang_review: item.tzuyang_review || '',
                };
            });
        setItemDecisions(initialDecisions);
        window.requestAnimationFrame(() => {
            submissionDetailPanelRef.current?.scrollIntoView({
                block: isMobile ? 'start' : 'nearest',
                behavior: 'smooth',
            });
            submissionDetailPanelRef.current?.focus({ preventScroll: true });
        });
    }, [isMobile]);

    // 상세 패널 닫기
    const closeSubmissionDetail = useCallback(() => {
        setSelectedSubmission(null);
        setShowWarningModal(false);
        setShowRejectModal(false);
        setOverrideApprovalConfirmation('');
        setSubmissionDeleteTarget(null);
        setSubmissionDeleteConfirmation('');
        setRecommendationAdminNote('');
        setRecommendationApprovalConfirmation('');
        setRecommendationRejectionConfirmation('');
    }, []);

    // 네이버 검색 API 호출 함수
    const searchNaverPlace = async (query: string, display: number = 5) => {
        try {
            const response = await fetch('/api/naver-search', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, display }),
            });
            if (!response.ok) throw new Error('Search failed');
            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('Naver search error:');
            return [];
        }
    };

    // 주소 정규화 및 비교 함수
    const normalizeAddress = (addr: string) => {
        if (!addr) return "";
        let a = addr.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
        a = a.replace(/\d+/g, "");
        a = a.replace(/\s*\S+(원|쇼핑|園)/g, "");
        return a.trim();
    };

    const extractCityDistrictGu = (address: string): string | null => {
        const parts = address.trim().split(/\s+/);
        if (parts.length >= 2) {
            let region = `${parts[0]} ${parts[1]}`;
            if (parts.length >= 3) {
                const p3 = parts[2];
                // 시/군/구 까지만 포함 (읍/면/동/로/길 제외)
                // 예: '성남시 분당구' -> 포함, '금산군 제원면' -> 제외
                if (p3.endsWith('구') || p3.endsWith('시') || p3.endsWith('군')) {
                    region += ` ${p3}`;
                }
            }
            return region;
        }
        return null;
    };

    // 네이버 검색 및 검증 실행
    const handleNaverSearchAndVerify = async () => {
        if (!editableData.name) {
            toast.error('맛집명이 필요합니다.');
            return;
        }

        // 지오코딩 선택 여부 확인
        if (!approvalData.road_address && !approvalData.jibun_address) {
            toast.error('지오코딩 결과를 먼저 선택해주세요.');
            return;
        }

        const targetAddress = approvalData.road_address || approvalData.jibun_address;

        setNaverSearchLoading(true);
        setNaverSearchResults([]);

        try {
            const queries = new Set<string>();
            // 지오코딩된 주소 기반 검색
            queries.add(`${editableData.name} ${targetAddress}`);

            const region = extractCityDistrictGu(targetAddress);
            if (region) {
                queries.add(`${editableData.name} ${region}`);
            }

            const searchPromises = Array.from(queries).map(q => searchNaverPlace(q, 5));
            const resultsArrays = await Promise.all(searchPromises);
            const allResults = resultsArrays.flat();
            const uniqueResults = Array.from(new Map(allResults.map(item => [item.address, item])).values());

            // 검증 대상: 지오코딩된 주소들
            const targetAddresses = [approvalData.road_address, approvalData.jibun_address].filter(Boolean);
            const normalizedTargets = targetAddresses.map(normalizeAddress).filter(Boolean);

            const verifiedResults = uniqueResults.map(item => {
                const normAddr = normalizeAddress(item.address);
                const normRoad = normalizeAddress(item.roadAddress || '');

                const isMatch = normalizedTargets.some(target => {
                    if (!target) return false;
                    return target === normAddr || target === normRoad ||
                        (normAddr && target.includes(normAddr)) ||
                        (normAddr && normAddr.includes(target)) ||
                        (normRoad && target.includes(normRoad)) ||
                        (normRoad && normRoad.includes(target));
                });

                return { ...item, isMatch };
            });

            setNaverSearchResults(verifiedResults);

            const hasMatch = verifiedResults.some(r => r.isMatch);

            if (hasMatch) {
                setVerificationDone(true);
                toast.success('주소 검증이 완료되었습니다. 승인 버튼을 눌러주세요.');
            } else {
                setVerificationDone(false);
                toast.warning('일치하는 주소를 찾지 못했습니다. 결과를 확인해주세요.');
            }

        } catch (error) {
            console.error('Naver search verification failed');
            toast.error('검증 중 오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setNaverSearchLoading(false);
        }
    };

    const approvalState = useMemo(() => {
        if (!selectedSubmission) {
            return getSubmissionApprovalState({});
        }

        return getSubmissionApprovalState({
            requestState: selectedSubmission.status,
            submissionType: selectedSubmission.submission_type,
            forceApprove,
            editableName: editableData.name,
            editableAddress: editableData.address,
            selectedGeocodingIndex,
            geocodingResults,
            approvalData,
            localSearchEvidence: naverSearchResults,
            itemDecisions,
            items: selectedSubmission.items,
            recommendationApprovalConfirmed: recommendationApprovalConfirmation === RECOMMEND_APPROVE_CONFIRMATION,
        });
    }, [
        approvalData,
        editableData.address,
        editableData.name,
        forceApprove,
        geocodingResults,
        itemDecisions,
        naverSearchResults,
        recommendationApprovalConfirmation,
        selectedGeocodingIndex,
        selectedSubmission,
    ]);
    const selectedSubmissionQueueSafetySummary = useMemo(() => {
        if (!selectedSubmission) return undefined;
        return submissionQueueSafetyById.get(selectedSubmission.id)
            ?? getAdminSubmissionQueueSafetySummary(selectedSubmission);
    }, [selectedSubmission, submissionQueueSafetyById]);


    const renderApprovalContractPanel = () => {
        if (!selectedSubmission) return null;

        return (
            <Card className={cn(
                "p-3 shadow-none",
                approvalState.canApprove
                    ? "border-green-200 bg-green-50/80 dark:border-green-900/60 dark:bg-green-950/20"
                    : "border-amber-200 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/20"
            )}>
                <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">
                            {approvalState.canApprove ? '승인 가능' : '승인 전 확인'}
                        </p>
                        <Badge variant={approvalState.canApprove ? 'default' : 'secondary'}>
                            {approvalState.canApprove ? '확인 완료' : `${approvalState.blockers.length}건`}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground">{approvalState.nextAction}</p>
                    {approvalState.blockers.length > 0 && (
                        <ul className="list-disc space-y-1 pl-4 text-amber-900 dark:text-amber-100">
                            {approvalState.blockers.map((blocker) => (
                                <li key={blocker}>{blocker}</li>
                            ))}
                        </ul>
                    )}
                    {approvalState.auditHints.length > 0 && (
                        <ul className="list-disc space-y-1 pl-4 text-blue-900 dark:text-blue-100">
                            {approvalState.auditHints.map((hint) => (
                                <li key={hint}>{hint}</li>
                            ))}
                        </ul>
                    )}
                </div>
            </Card>
        );
    };

    // 데이터 변경 핸들러 (검증 상태 초기화)
    const handleEditableDataChange = (newData: typeof editableData) => {
        const nameChanged = newData.name !== editableData.name;
        const addressChanged = newData.address !== editableData.address;

        if (nameChanged) {
            setVerificationDone(false);
            setNaverSearchResults([]);
        }

        if (addressChanged) {
            setVerificationDone(false);
            setNaverSearchResults([]);
            // 주소가 바뀌면 지오코딩 결과도 초기화
            setGeocodingResults([]);
            setSelectedGeocodingIndex(null);
            setApprovalData({
                lat: '',
                lng: '',
                road_address: '',
                jibun_address: '',
                english_address: '',
                address_elements: null,
            });
        }

        setEditableData(newData);
    };

    // 지오코딩 결과 선택 핸들러 (원자적 업데이트)
    const handleGeocodingSelect = (result: GeocodingResult, index: number) => {
        // 1. 선택 인덱스 업데이트
        setSelectedGeocodingIndex(index);

        // 2. 승인 데이터 업데이트
        setApprovalData({
            lat: result.y,
            lng: result.x,
            road_address: result.road_address,
            jibun_address: result.jibun_address,
            english_address: result.english_address,
            address_elements: result.address_elements,
        });

        // 3. 주소 필드 업데이트 (handleEditableDataChange의 초기화 로직 우회)
        setEditableData(prev => ({ ...prev, address: result.jibun_address }));

        // 4. 검증 상태 초기화
        setVerificationDone(false);
        setNaverSearchResults([]);
    };

    const buildApprovalAuditNote = useCallback(() => {
        const matchedEvidence = naverSearchResults
            .filter((result) => result.isMatch)
            .slice(0, 3)
            .map((result, index) => {
                const title = decodeBasicHtmlEntities(stripUnsafeMarkup(result.title)) || 'unknown';
                const address = result.roadAddress || result.address || 'unknown-address';
                return `browser-local-search-evidence:not-backend-truth:${index + 1}:${title}:${address}`;
            });
        const parts = [
            'submission-approval-state:v1',
            `forceApprove=${forceApprove ? 'true' : 'false'}`,
            ...approvalState.auditHints,
            ...matchedEvidence,
        ].filter((entry) => entry.trim().length > 0);
        return parts.join('\n');
    }, [approvalState.auditHints, forceApprove, naverSearchResults]);

    // 승인 핸들러
    const handleApprove = async () => {
        if (!selectedSubmission) return;

        if (selectedSubmission.submission_type === 'recommend') {
            if (!approvalState.canApprove) {
                toast.error(`${approvalState.nextAction} ${approvalState.blockers.join(' ')}`.trim());
                return;
            }
            if (recommendationApprovalConfirmation !== RECOMMEND_APPROVE_CONFIRMATION) {
                toast.error('추천 승인 확인 문구가 일치하지 않습니다.');
                return;
            }
            onApprove(selectedSubmission, approvalData, {}, false, {
                name: selectedSubmission.restaurant_name,
                address: selectedSubmission.restaurant_address || '',
                phone: selectedSubmission.restaurant_phone || '',
                categories: selectedSubmission.restaurant_categories || [],
            }, recommendationAdminNote.trim());
            closeSubmissionDetail();
            return;
        }

        if (!approvalState.canApprove) {
            toast.error(`${approvalState.nextAction} ${approvalState.blockers.join(' ')}`.trim());
            return;
        }

        if (forceApprove) {
            setOverrideApprovalConfirmation('');
            setShowWarningModal(true);
            return;
        }
        if (verificationDone) {
            onApprove(selectedSubmission, approvalData, itemDecisions, false, editableData, buildApprovalAuditNote());
            closeSubmissionDetail();
            return;
        }

        // 이미 검증한 경우 바로 승인
        if (verificationDone) {
            onApprove(selectedSubmission, approvalData, itemDecisions, false, editableData, buildApprovalAuditNote());
            closeSubmissionDetail();
            return;
        }

        // 검증 실행
        await handleNaverSearchAndVerify();
    };

    // 거부 핸들러
    const handleReject = useCallback(() => {
        if (!selectedSubmission) return;
        if (!rejectionReason.trim()) {
            toast.error('거부 사유를 입력해주세요');
            return;
        }
        if (selectedSubmission.submission_type === 'recommend' && recommendationRejectionConfirmation !== RECOMMEND_REJECT_CONFIRMATION) {
            toast.error('추천 거부 확인 문구가 일치하지 않습니다.');
            return;
        }
        onReject(selectedSubmission, rejectionReason.trim());
        setShowRejectModal(false);
        setRejectionReason('');
        closeSubmissionDetail();
    }, [selectedSubmission, onReject, rejectionReason, recommendationRejectionConfirmation, closeSubmissionDetail]);

    // 삭제 핸들러
    const handleDelete = useCallback((submission: SubmissionRecord, e?: React.MouseEvent) => {
        e?.stopPropagation();
        openSubmissionDetail(submission);
        setSubmissionDeleteTarget(submission);
        setSubmissionDeleteConfirmation('');
    }, [openSubmissionDetail]);

    const handleDeleteSelectedSubmission = () => { if (selectedSubmission) handleDelete(selectedSubmission); };

    const handleConfirmDeleteSubmission = useCallback(() => {
        if (!submissionDeleteTarget) return;
        if (submissionDeleteConfirmation !== SUBMISSION_DELETE_CONFIRMATION) {
            toast.error('제보 삭제 확인 문구가 일치하지 않습니다.');
            return;
        }
        onDelete(submissionDeleteTarget);
        setSubmissionDeleteTarget(null);
        setSubmissionDeleteConfirmation('');
        if (selectedSubmission?.id === submissionDeleteTarget.id) {
            closeSubmissionDetail();
        }
    }, [closeSubmissionDetail, onDelete, selectedSubmission?.id, submissionDeleteConfirmation, submissionDeleteTarget]);

    // 리뷰 액션 핸들러
    const handleReviewAction = useCallback((action: 'approve' | 'reject', review: Review) => {
        setSelectedReview(review);
        setReviewDeleteTarget(null);
        setReviewDeleteConfirmation('');
        setPreviewImage(null);
        setReviewAction(action);
        setReviewAdminNote(review.admin_note || '');
        window.requestAnimationFrame(() => reviewDetailPanelRef.current?.focus({ preventScroll: true }));
    }, []);

    const handleConfirmReviewAction = useCallback((nextAction = reviewAction) => {
        if (!selectedReview || !nextAction) return;

        if (nextAction === 'reject' && !reviewAdminNote.trim()) {
            toast.error('거부 시 관리자 메모를 입력해주세요');
            return;
        }

        if (nextAction === 'approve' && onApproveReview) {
            onApproveReview(selectedReview, reviewAdminNote.trim());
        } else if (nextAction === 'reject' && onRejectReview) {
            onRejectReview(selectedReview, reviewAdminNote.trim());
        }

        setSelectedReview(null);
        setReviewAction(null);
        setReviewAdminNote('');
    }, [selectedReview, reviewAction, reviewAdminNote, onApproveReview, onRejectReview]);

    const handleDeleteReview = useCallback((review: Review) => {
        setSelectedReview(review);
        setReviewAction(null);
        setReviewAdminNote(review.admin_note || '');
        setReviewDeleteTarget(review);
        setReviewDeleteConfirmation('');
        setPreviewImage(null);
    }, []);

    const handleConfirmDeleteReview = useCallback(() => {
        if (!reviewDeleteTarget) return;
        if (reviewDeleteConfirmation !== REVIEW_DELETE_CONFIRMATION) {
            toast.error('리뷰 삭제 확인 문구가 일치하지 않습니다.');
            return;
        }
        onDeleteReview?.(reviewDeleteTarget);
        setReviewDeleteTarget(null);
        setReviewDeleteConfirmation('');
        if (selectedReview?.id === reviewDeleteTarget.id) {
            setSelectedReview(null);
            setReviewAction(null);
            setReviewAdminNote('');
            setPreviewImage(null);
        }
    }, [onDeleteReview, reviewDeleteConfirmation, reviewDeleteTarget, selectedReview?.id]);

    const renderOverrideApprovalPanel = () => {
        if (!showWarningModal || !selectedSubmission) return null;

        return (
            <Card className="border-amber-200 bg-amber-50/90 p-3 shadow-none dark:border-amber-900/60 dark:bg-amber-950/30">
                <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                    <div className="min-w-0 flex-1 space-y-3">
                        <div>
                            <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">주소 검증 경고</p>
                            <p className="mt-1 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">
                                네이버 검색 결과와 입력 주소가 일치하지 않습니다. 결과를 다시 확인하거나 확인 문구 입력 후 승인하세요.
                            </p>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-white/80 p-2 text-xs dark:border-amber-900/50 dark:bg-background/60">
                            <p className="font-semibold">입력 정보</p>
                            <p className="mt-1 break-all">이름: {editableData.name || '-'}</p>
                            <p className="break-all">주소: {editableData.address || '-'}</p>
                        </div>
                        {naverSearchResults.length > 0 && (
                            <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-amber-200 bg-white/70 p-2 dark:border-amber-900/50 dark:bg-background/50">
                                {naverSearchResults.map((result, idx) => (
                                    <div key={idx} className="rounded border bg-background p-2 text-xs">
                                        <p className="font-medium">{decodeBasicHtmlEntities(stripUnsafeMarkup(result.title))}</p>
                                        <p className="text-muted-foreground">{result.address}</p>
                                        {result.roadAddress && <p className="text-muted-foreground">{result.roadAddress}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="override-approval-confirmation" className="text-xs font-semibold text-amber-950 dark:text-amber-100">
                                검증 경고 확인 후 승인
                            </Label>
                            <Input
                                id="override-approval-confirmation"
                                value={overrideApprovalConfirmation}
                                onChange={(event) => setOverrideApprovalConfirmation(event.target.value)}
                                placeholder={OVERRIDE_APPROVAL_CONFIRMATION}
                                className="h-9 bg-background"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setOverrideApprovalConfirmation('');
                                    setShowWarningModal(false);
                                }}
                            >
                                수정하기
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                disabled={overrideApprovalConfirmation !== OVERRIDE_APPROVAL_CONFIRMATION}
                                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                                onClick={() => {
                                    if (overrideApprovalConfirmation !== OVERRIDE_APPROVAL_CONFIRMATION) {
                                        toast.error('무시 승인 확인 문구가 일치하지 않습니다.');
                                        return;
                                    }
                                    setShowWarningModal(false);
                                    setOverrideApprovalConfirmation('');
                                    setVerificationDone(true);
                                    const approvalAuditNote = buildApprovalAuditNote();
                                    onApprove(selectedSubmission, approvalData, itemDecisions, forceApprove, editableData, approvalAuditNote);
                                    closeSubmissionDetail();
                                }}
                            >
                                확인 후 승인
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>
        );
    };

    const renderRecommendationDetailContent = (submission: SubmissionRecord) => {
        const recommendationYoutubeUrl = normalizeCanonicalYouTubeWatchUrl(submission.items[0]?.youtube_link);

        return (
        <div className="space-y-3">
            <Card className="p-3 shadow-none">
                <div className="space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="font-semibold">{submission.restaurant_name}</p>
                            <p className="mt-1 break-all text-xs text-muted-foreground">{submission.restaurant_address || '주소 없음'}</p>
                        </div>
                        {getStatusBadge(submission.status)}
                    </div>
                    <div className="grid gap-2 rounded-md bg-muted/40 p-2 text-xs sm:grid-cols-2">
                        <div>
                            <span className="text-muted-foreground">전화번호</span>
                            <p className="mt-0.5 break-all">{submission.restaurant_phone || '-'}</p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">추천자</span>
                            <p className="mt-0.5">{submission.profiles?.nickname || '익명'}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {submission.restaurant_categories?.length ? (
                            submission.restaurant_categories.map((category, index) => (
                                <Badge key={`${category}-${index}`} variant="outline" className={listCategoryBadgeClassName}>
                                    {category}
                                </Badge>
                            ))
                        ) : (
                            <span className="text-xs text-muted-foreground">카테고리 없음</span>
                        )}
                    </div>
                </div>
            </Card>

            <Card className="p-3 shadow-none">
                <Label className="text-sm font-medium">추천 사유</Label>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {submission.recommendation_reason || submission.items[0]?.tzuyang_review || '추천 사유가 없습니다.'}
                </p>
            </Card>

            {recommendationYoutubeUrl && (
                <Card className="p-3 shadow-none">
                    <Label className="text-sm font-medium">YouTube 링크</Label>
                    <a
                        href={recommendationYoutubeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block break-all text-sm text-primary underline-offset-4 hover:underline"
                    >
                        {recommendationYoutubeUrl}
                    </a>
                </Card>
            )}

            {(submission.recommendation_audit_id || submission.reviewed_at || submission.recommendation_admin_note || submission.rejection_reason) && (
                <Card className="border-blue-200 bg-blue-50/70 p-3 text-xs shadow-none dark:border-blue-900/50 dark:bg-blue-950/20">
                    <p className="font-semibold text-blue-900 dark:text-blue-100">최근 처리 readback</p>
                    {submission.reviewed_at && <p className="mt-1">처리일: {new Date(submission.reviewed_at).toLocaleString('ko-KR')}</p>}
                    {submission.recommendation_audit_id && <p className="break-all">감사 ID: {submission.recommendation_audit_id}</p>}
                    {submission.recommendation_admin_note && <p className="whitespace-pre-wrap">관리자 메모: {submission.recommendation_admin_note}</p>}
                    {submission.rejection_reason && <p className="whitespace-pre-wrap">거부 사유: {submission.rejection_reason}</p>}
                </Card>
            )}

            {submission.status === 'pending' && (
                <Card className="border-amber-200 bg-amber-50/70 p-3 shadow-none dark:border-amber-900/50 dark:bg-amber-950/20">
                    <div className="space-y-3">
                        <div>
                            <Label htmlFor="recommendation-admin-note">관리자 메모 (승인 선택)</Label>
                            <Textarea
                                id="recommendation-admin-note"
                                value={recommendationAdminNote}
                                onChange={(e) => setRecommendationAdminNote(e.target.value)}
                                placeholder="승인 시 남길 메모가 있으면 입력하세요"
                                rows={3}
                                className="mt-2 bg-background"
                            />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                                <Label htmlFor="recommendation-approve-confirmation">승인 확인 문구</Label>
                                <Input
                                    id="recommendation-approve-confirmation"
                                    value={recommendationApprovalConfirmation}
                                    onChange={(e) => setRecommendationApprovalConfirmation(e.target.value)}
                                    placeholder={RECOMMEND_APPROVE_CONFIRMATION}
                                    className="mt-2 h-9 bg-background"
                                />
                            </div>
                            <div>
                                <Label htmlFor="recommendation-reject-confirmation">거부 확인 문구</Label>
                                <Input
                                    id="recommendation-reject-confirmation"
                                    value={recommendationRejectionConfirmation}
                                    onChange={(e) => setRecommendationRejectionConfirmation(e.target.value)}
                                    placeholder={RECOMMEND_REJECT_CONFIRMATION}
                                    className="mt-2 h-9 bg-background"
                                />
                            </div>
                        </div>
                        <p className="text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">
                            승인/거부는 /api/admin/restaurant-requests/{'{id}'}/review readback과 감사 ID가 확인된 경우에만 완료됩니다.
                        </p>
                    </div>
                </Card>
            )}
        </div>
        );
    };
    const renderSubmissionDetailPanel = () => (
        <section
            aria-label="제보 상세 작업 패널"
            key={selectedSubmission?.id}
            ref={submissionDetailPanelRef}
            tabIndex={-1}
            data-admin-moderation-inspector="true"
            className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card", inlineInspector && "admin-cms-inspector")}
        >
            <div className="flex min-h-12 items-center justify-between gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold leading-6">{selectedSubmission?.restaurant_name || '왼쪽 목록에서 제보를 선택하세요'}</h3>
                </div>
                {selectedSubmission && (
                    <div className="flex shrink-0 gap-1">
                        {selectedSubmission.submission_type !== 'recommend' && <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" aria-label="선택한 제보 삭제" disabled={loading} onClick={handleDeleteSelectedSubmission}><Trash2 className="h-3.5 w-3.5" /></Button>}
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={closeSubmissionDetail}>닫기</Button>
                    </div>
                )}
            </div>

            {!selectedSubmission ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                    <Edit className="h-8 w-8" />
                    <p>제보를 선택하세요.</p>
                </div>
            ) : (
                <>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                        <Card className="p-3 shadow-none">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold">{selectedSubmission.restaurant_name}</p>
                                    <p className="mt-1 break-all text-xs text-muted-foreground">{selectedSubmission.restaurant_address || '주소 없음'}</p>
                                </div>
                                {getStatusBadge(selectedSubmission.status)}
                            </div>
                            {renderSubmissionQueueSafetyBadges(selectedSubmissionQueueSafetySummary, 'detail')}
                        </Card>
                        {renderApprovalContractPanel()}
                        {selectedSubmission.submission_type === 'recommend' ? (
                            renderRecommendationDetailContent(selectedSubmission)
                        ) : (
                            <SubmissionDetailView
                                submission={selectedSubmission}
                                approvalData={approvalData}
                                onApprovalDataChange={setApprovalData}
                                geocodingResults={geocodingResults}
                                onGeocodingResultsChange={setGeocodingResults}
                                selectedGeocodingIndex={selectedGeocodingIndex}
                                onSelectedGeocodingIndexChange={setSelectedGeocodingIndex}
                                itemDecisions={itemDecisions}
                                onItemDecisionsChange={setItemDecisions}
                                forceApprove={forceApprove}
                                onForceApproveChange={setForceApprove}
                                editableData={editableData}
                                onEditableDataChange={handleEditableDataChange}
                                naverSearchResults={naverSearchResults}
                                naverSearchLoading={naverSearchLoading}
                                onVerifyNaverSearch={handleNaverSearchAndVerify}
                                onGeocodingSelect={handleGeocodingSelect}
                            />
                        )}
                        {renderOverrideApprovalPanel()}
                        {showRejectModal && (
                            <Card className="border-destructive/30 bg-destructive/5 p-3 shadow-none">
                                <div className="space-y-2">
                                    <Label htmlFor="rejection-reason">{selectedSubmission.submission_type === 'recommend' ? '추천 거부 사유' : '제보 전체 거부 사유'}</Label>
                                    <Textarea
                                        id="rejection-reason"
                                        value={rejectionReason}
                                        onChange={(e) => setRejectionReason(e.target.value)}
                                        placeholder={selectedSubmission.submission_type === 'recommend' ? '추천을 거부하는 사유를 입력해주세요' : '예: 이미 등록된 맛집입니다 / 정보가 정확하지 않습니다'}
                                        rows={4}
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setShowRejectModal(false)}>
                                            취소
                                        </Button>
                                        <Button variant="destructive" size="sm" onClick={handleReject} disabled={!rejectionReason.trim() || loading || (selectedSubmission.submission_type === 'recommend' && recommendationRejectionConfirmation !== RECOMMEND_REJECT_CONFIRMATION)}>
                                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                                            {selectedSubmission.submission_type === 'recommend' ? '추천 거부' : '전체 거부'}
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        )}
                        {submissionDeleteTarget && (
                            <Card className="border-red-200 bg-red-50/80 p-3 shadow-none dark:border-red-900/60 dark:bg-red-950/30">
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                                        {submissionDeleteTarget.submission_type === 'recommend' ? '추천 거부 처리 확인' : '제보 삭제 확인'}
                                    </p>
                                    <p className="text-xs leading-5 text-red-800 dark:text-red-100/80">
                                        “{submissionDeleteTarget.restaurant_name}” {submissionDeleteTarget.submission_type === 'recommend' ? '추천을 거부 상태로 처리하려면' : '제보를 삭제하려면'} {SUBMISSION_DELETE_CONFIRMATION}를 입력하세요.
                                    </p>
                                    <Input
                                        value={submissionDeleteConfirmation}
                                        onChange={(e) => setSubmissionDeleteConfirmation(e.target.value)}
                                        placeholder={SUBMISSION_DELETE_CONFIRMATION}
                                        className="h-9 bg-background"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setSubmissionDeleteTarget(null);
                                                setSubmissionDeleteConfirmation('');
                                            }}
                                        >
                                            취소
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={handleConfirmDeleteSubmission}
                                            disabled={submissionDeleteConfirmation !== SUBMISSION_DELETE_CONFIRMATION}
                                        >
                                            삭제
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        )}
                    </div>
                    {(selectedSubmission.status === 'pending' || selectedSubmission.status === 'partially_approved') && (
                        <div className="grid shrink-0 grid-cols-2 gap-2 border-t bg-background p-3 sm:grid-cols-[1fr_1fr_1.4fr]">
                            <Button type="button" variant="outline" size="sm" onClick={closeSubmissionDetail} disabled={loading}>
                                닫기
                            </Button>
                            <Button type="button" size="sm" variant="destructive" onClick={() => setShowRejectModal(true)} disabled={loading}>
                                <XCircle className="mr-1 h-4 w-4" />
                                {selectedSubmission.submission_type === 'recommend' ? '추천 거부' : '전체 거부'}
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleApprove}
                                disabled={loading || !approvalState.canApprove}
                                title={approvalState.canApprove ? '승인' : `${approvalState.nextAction} ${approvalState.blockers.join(' ')}`.trim()}
                            >
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                                {selectedSubmission.submission_type === 'recommend' ? '추천 승인' : '승인'}
                            </Button>
                        </div>
                    )}
                </>
            )}
        </section>
    );

    const renderReviewOcrResult = (review: Review) => (
        <div className="space-y-2">
            <Label className="flex items-center gap-1 text-sm font-medium">
                <ScanSearch className="h-4 w-4" /> OCR 분석 결과
                {review.ocr_processed_at && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {new Date(review.ocr_processed_at).toLocaleDateString('ko-KR')}
                    </span>
                )}
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRerunOcr(review.id)}
                    disabled={ocrRerunningIds.has(review.id)}
                    className="ml-auto h-7 gap-1 px-2 text-xs"
                >
                    {ocrRerunningIds.has(review.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                    ) : (
                        <RefreshCw className="h-3 w-3" />
                    )}
                    {ocrRerunningIds.has(review.id) ? `${ocrCountdowns[review.id] || 0}초` : 'OCR 다시 실행'}
                </Button>
            </Label>
            {ocrRerunningIds.has(review.id) && !review.ocr_processed_at && (
                <Card className="border-border bg-secondary p-3 text-sm text-foreground shadow-none">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" />
                    OCR 처리 중... {ocrCountdowns[review.id] || 0}초 후 완료 예정
                </Card>
            )}
            {!ocrRerunningIds.has(review.id) && !review.ocr_processed_at && (
                <Card className="bg-muted/50 p-3 text-sm text-muted-foreground shadow-none">OCR 미처리</Card>
            )}
            {review.ocr_processed_at && (
                review.receipt_data ? (
                    review.receipt_data.error ? (
                        <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-600 shadow-none dark:border-red-800 dark:bg-red-950/30">
                            <AlertCircle className="mr-2 inline h-4 w-4" />
                            OCR 오류: {review.receipt_data.error}
                        </Card>
                    ) : (
                        <Card className="border-blue-200 bg-blue-50 p-3 shadow-none dark:border-blue-800 dark:bg-blue-950/30">
                            <div className="space-y-2 text-sm">
                                {review.receipt_data.store_name && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-muted-foreground">가게명</span>
                                        <span className="font-medium">{review.receipt_data.store_name}</span>
                                    </div>
                                )}
                                {review.receipt_data.date && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-muted-foreground">날짜</span>
                                        <span>{review.receipt_data.date}</span>
                                    </div>
                                )}
                                {review.receipt_data.total_amount && (
                                    <div className="flex justify-between gap-3">
                                        <span className="text-muted-foreground">결제 금액</span>
                                        <span className="font-medium text-green-600">{review.receipt_data.total_amount.toLocaleString()}원</span>
                                    </div>
                                )}
                                {review.receipt_data.confidence !== undefined && (
                                    <div className="flex justify-between gap-3 border-t pt-2">
                                        <span className="text-muted-foreground">OCR 신뢰도</span>
                                        <Badge variant={review.receipt_data.confidence >= 0.8 ? 'default' : 'secondary'} className="text-xs">
                                            {(review.receipt_data.confidence * 100).toFixed(0)}%
                                        </Badge>
                                    </div>
                                )}
                                {review.is_duplicate && review.receipt_data.duplicate_of && (
                                    <div className="border-t pt-2 text-red-600 dark:text-red-400">
                                        <AlertTriangle className="mr-1 inline h-4 w-4" />
                                        중복 영수증 · 원본 {review.receipt_data.duplicate_of.slice(0, 8)}...
                                    </div>
                                )}
                            </div>
                        </Card>
                    )
                ) : (
                    <Card className="bg-muted/50 p-3 text-sm text-muted-foreground shadow-none">OCR 데이터 없음</Card>
                )
            )}
        </div>
    );

    const renderReviewDetailPanel = () => (
        <section
            aria-label="리뷰 상세 작업 패널"
            key={selectedReview?.id}
            ref={reviewDetailPanelRef}
            tabIndex={-1}
            data-admin-moderation-inspector="true"
            className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card", inlineInspector && "admin-cms-inspector")}
        >
            <div className="flex min-h-12 items-center justify-between gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold leading-6">{selectedReview?.restaurants?.name || '왼쪽 목록에서 리뷰를 선택하세요'}</h3>
                </div>
                {selectedReview && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => {
                            setSelectedReview(null);
                            setReviewAction(null);
                            setReviewAdminNote('');
                            setPreviewImage(null);
                        }}
                    >
                        선택 해제
                    </Button>
                )}
            </div>

            {!selectedReview ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                    <MessageSquare className="h-8 w-8" />
                    <p>리뷰를 선택하세요.</p>
                </div>
            ) : (
                <>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                        <Card className="bg-muted/40 p-3 shadow-none">
                            <div className="space-y-2 text-sm">
                                <div className="flex items-start justify-between gap-2">
                                    <h3 className="font-semibold">{selectedReview.title}</h3>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {selectedReview.is_duplicate && (
                                            <Badge variant="destructive" className="gap-0.5 text-xs">
                                                <AlertTriangle className="h-3 w-3" /> 중복
                                            </Badge>
                                        )}
                                        {renderReviewStatusBadge(selectedReview)}
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Avatar className="h-4 w-4">
                                            <AvatarFallback className="text-2xs">
                                                {selectedReview.profiles?.nickname?.[0] || '?'}
                                            </AvatarFallback>
                                        </Avatar>
                                        {selectedReview.profiles?.nickname || '익명'}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Calendar className="h-3 w-3" />
                                        {new Date(selectedReview.visited_at).toLocaleDateString('ko-KR')}
                                    </span>
                                </div>
                                <p className="whitespace-pre-wrap text-muted-foreground">{selectedReview.content}</p>
                            </div>
                        </Card>

                        {previewImage && (
                            <Card className="p-2 shadow-none">
                                <div className="relative">
                                    <Image
                                        src={previewImage.url}
                                        alt={previewImage.alt}
                                        width={1400}
                                        height={1000}
                                        unoptimized
                                        className="max-h-[46dvh] w-full rounded-lg object-contain"
                                    />
                                    <Button
                                        variant="secondary"
                                        size="icon"
                                        className="absolute right-2 top-2 h-8 w-8 rounded-full bg-white/90 shadow-md hover:bg-white"
                                        onClick={() => setPreviewImage(null)}
                                    >
                                        <X className="h-4 w-4 text-gray-700" />
                                    </Button>
                                </div>
                            </Card>
                        )}

                        <div className="space-y-2">
                            <Label className="text-sm font-medium">제출된 사진</Label>
                            {!selectedReviewPhotos.verificationPhotoUrl && selectedReviewPhotos.foodPhotos.length === 0 ? (
                                <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">제출된 사진이 없습니다</div>
                            ) : (
                                <div className="flex gap-2 overflow-x-auto pb-2">
                                    {selectedReviewPhotos.verificationPhotoUrl && (
                                        <ReviewPhotoItem
                                            src={selectedReviewPhotos.verificationPhotoUrl}
                                            alt="영수증"
                                            label="영수증"
                                            labelVariant="receipt"
                                            onClick={() => setPreviewImage({ url: selectedReviewPhotos.verificationPhotoUrl!, alt: '영수증' })}
                                        />
                                    )}
                                    {selectedReviewPhotos.foodPhotos.map(({ url, index }) => (
                                        <ReviewPhotoItem
                                            key={index}
                                            src={url}
                                            alt={`음식 ${index + 1}`}
                                            label={`음식 ${index + 1}`}
                                            labelVariant="food"
                                            onClick={() => setPreviewImage({ url, alt: `음식 ${index + 1}` })}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {selectedReview.verification_photo && renderReviewOcrResult(selectedReview)}

                        <Card className="border-orange-200 bg-orange-50/70 p-3 shadow-none dark:border-orange-900/50 dark:bg-orange-950/20">
                            <div className="space-y-2">
                                <p className="text-sm font-semibold text-orange-900 dark:text-orange-100">OCR 전체 다시 실행</p>
                                <p className="text-xs leading-5 text-orange-800 dark:text-orange-100/80">
                                    모든 리뷰의 OCR을 초기화하려면 {OCR_RESET_ALL_CONFIRMATION}를 입력한 뒤 상단/아래 버튼을 누르세요.
                                </p>
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                    <Input
                                        value={ocrResetConfirmation}
                                        onChange={(e) => setOcrResetConfirmation(e.target.value)}
                                        placeholder={OCR_RESET_ALL_CONFIRMATION}
                                        className="h-9 bg-background"
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleResetAllOcr}
                                        disabled={isOcrRunning || ocrResetConfirmation !== OCR_RESET_ALL_CONFIRMATION}
                                        className="h-9 text-orange-700 dark:text-orange-300"
                                    >
                                        전체 다시 실행
                                    </Button>
                                </div>
                            </div>
                        </Card>

                        <div className="space-y-2">
                            <Label>관리자 메모{reviewAction === 'reject' && ' (필수)'}</Label>
                            <Textarea
                                value={reviewAdminNote}
                                onChange={(e) => setReviewAdminNote(e.target.value)}
                                placeholder={reviewAction === 'approve' ? '승인 사유 (선택)' : '거부 사유를 입력해주세요'}
                                rows={3}
                            />
                        </div>

                        {reviewDeleteTarget && (
                            <Card className="border-red-200 bg-red-50/80 p-3 shadow-none dark:border-red-900/60 dark:bg-red-950/30">
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold text-red-900 dark:text-red-100">리뷰 삭제 확인</p>
                                    <p className="text-xs leading-5 text-red-800 dark:text-red-100/80">
                                        리뷰 삭제는 사용자 노출 상태를 바꿉니다. 계속하려면 {REVIEW_DELETE_CONFIRMATION}를 입력하세요.
                                    </p>
                                    <Input
                                        value={reviewDeleteConfirmation}
                                        onChange={(e) => setReviewDeleteConfirmation(e.target.value)}
                                        placeholder={REVIEW_DELETE_CONFIRMATION}
                                        className="h-9 bg-background"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setReviewDeleteTarget(null);
                                                setReviewDeleteConfirmation('');
                                            }}
                                        >
                                            취소
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={handleConfirmDeleteReview}
                                            disabled={reviewDeleteConfirmation !== REVIEW_DELETE_CONFIRMATION}
                                        >
                                            삭제
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        )}
                    </div>
                    <div className="grid shrink-0 grid-cols-3 gap-2 border-t bg-background p-3">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteReview(selectedReview)}
                        >
                            <Trash2 className="mr-1 h-4 w-4" />
                            삭제
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                                setReviewAction('reject');
                                handleConfirmReviewAction('reject');
                            }}
                            disabled={!reviewAdminNote.trim()}
                        >
                            거부
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => {
                                setReviewAction('approve');
                                handleConfirmReviewAction('approve');
                            }}
                            disabled={selectedReview.is_duplicate}
                            className="bg-green-500 hover:bg-green-600 disabled:opacity-50"
                        >
                            {selectedReview.is_duplicate ? '승인불가' : '승인'}
                        </Button>
                    </div>
                </>
            )}
        </section>
    );

    const hasSelection = activeTab === 'reviews' ? !!selectedReview : !!selectedSubmission;
    const resultCount = activeTab === 'reviews' ? orderedReviews.length : filteredSubmissions.length;
    const displayedCount = activeTab === 'reviews' ? displayedReviews.length : displayedSubmissions.length;
    const closeInspector = () => {
        if (activeTab === 'reviews') {
            setSelectedReview(null); setReviewAction(null); setReviewAdminNote('');
            setReviewDeleteTarget(null); setReviewDeleteConfirmation(''); setPreviewImage(null);
        } else closeSubmissionDetail();
        if (inlineInspector) window.requestAnimationFrame(() => rowTriggerRef.current?.focus());
    };
    const searchValue = activeTab === 'reviews' ? reviewSearchQuery : searchQuery;
    const changeSearch = (value: string) => activeTab === 'reviews' ? setReviewSearchQuery(value) : setSearchQuery(value);
    const tabs = [
        { id: 'new' as const, label: '신규 제보', count: newCount, icon: <Video className="h-3.5 w-3.5" /> },
        { id: 'edit' as const, label: '수정 요청', count: editCount, icon: <Edit className="h-3.5 w-3.5" /> },
        { id: 'recommend' as const, label: '쯔양 제보', count: recommendCount, icon: <YouTubeIcon className="h-3.5 w-3.5" /> },
        { id: 'reviews' as const, label: '리뷰', count: reviewPendingCount, icon: <MessageSquare className="h-3.5 w-3.5" /> },
    ];

    return (
        <TooltipProvider>
            <div data-admin-moderation-workspace={activeTab === 'reviews' ? 'reviews' : 'submissions'} className="flex h-full min-h-0 min-w-0 flex-col gap-2">
                <nav className="grid shrink-0 grid-cols-4 gap-1 rounded-lg border bg-muted/20 p-1" aria-label="제보·리뷰 종류">
                    {tabs.map(tab => <button key={tab.id} type="button" aria-pressed={activeTab === tab.id} onClick={() => setActiveTabWithReset(tab.id)} className={cn('flex min-h-9 min-w-0 flex-wrap items-center justify-center gap-1 rounded-md px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', activeTab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted')}>
                        <span className="hidden sm:inline-flex">{tab.icon}</span><span>{tab.label}</span><span className="tabular-nums text-muted-foreground" aria-label={`대기 ${tab.count}건`}>{tab.count}</span>
                    </button>)}
                </nav>
                <div data-admin-moderation-toolbar className="admin-cms-toolbar shrink-0">
                    <div className="relative min-w-[180px] flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input type="search" aria-label={activeTab === 'reviews' ? '리뷰 검색' : '제보 검색'} placeholder={activeTab === 'reviews' ? '맛집·리뷰·작성자 검색' : '맛집·주소·제보자 검색'} value={searchValue} onChange={event => changeSearch(event.target.value)} className="h-9 pl-8 pr-8 text-sm" />
                        {searchValue && <button type="button" aria-label="검색 지우기" onClick={() => changeSearch('')} className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
                    </div>
                    <select aria-label="처리 상태" value={statusFilter} onChange={event => { setStatusFilter(event.target.value as AdminModerationFilter); resetVisibleCountByTab(activeTab); }} className={filterClassName}>
                        <option value="all">전체 상태 ({currentTabSummary.total})</option><option value="pending">대기 ({currentTabSummary.pending})</option><option value="approved">승인 ({currentTabSummary.approved})</option><option value="rejected">거부 ({currentTabSummary.rejected})</option>
                        {activeTab === 'reviews' ? <option value="duplicate">중복 영수증</option> : <option value="partially_approved">부분 승인</option>}
                    </select>
                    <select aria-label="목록 정렬" value={sortOrder} onChange={event => setSortOrder(event.target.value as AdminModerationSort)} className={filterClassName}>
                        <option value="priority">대기 우선</option><option value="newest">최근 접수순</option><option value="oldest">오래된 접수순</option><option value="name">맛집 이름순</option>
                    </select>
                    {onRefresh && activeTab !== 'reviews' && <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="목록 새로고침" onClick={onRefresh} disabled={loading}><RefreshCw className="h-3.5 w-3.5" /></Button>}
                    {activeTab === 'reviews' && <details className="relative text-xs">
                        <summary className="flex h-9 cursor-pointer items-center gap-1 rounded-md border px-2"><ScanSearch className="h-3.5 w-3.5" />OCR 관리</summary>
                        <div className="absolute right-0 top-10 z-20 w-64 space-y-3 rounded-lg border bg-popover p-3 shadow-md">
                            <p className="text-muted-foreground">대기 {ocrStatus?.pending ?? '미확인'} · 중복 {ocrStatus?.duplicate ?? '미확인'}</p>
                            <Button size="sm" variant="outline" onClick={handleRunOcr} disabled={isOcrRunning || (ocrStatus?.pending === 0)} className="h-8 w-full text-xs">{isOcrRunning ? '처리 중' : '대기 OCR 실행'}</Button>
                            <label className="block space-y-1"><span>전체 초기화 확인</span><Input value={ocrResetConfirmation} onChange={event => setOcrResetConfirmation(event.target.value)} placeholder={OCR_RESET_ALL_CONFIRMATION} className="h-8 text-xs" /></label>
                            <Button size="sm" variant="outline" onClick={handleResetAllOcr} disabled={isOcrRunning || ocrResetConfirmation !== OCR_RESET_ALL_CONFIRMATION} className="h-8 w-full text-xs text-destructive">전체 다시 실행</Button>
                        </div>
                    </details>}
                </div>
                {activeTab !== 'reviews' && <div className="flex shrink-0 flex-wrap gap-1" data-admin-submission-queue-reason-filter="true" aria-label="제보 큐 검수 사유 필터">
                    {queueReasonFilterOptions.filter(option => option.value === 'all' || option.count > 0 || option.value === queueReasonFilter).map(option => <button key={option.value} type="button" aria-pressed={queueReasonFilter === option.value} data-admin-submission-queue-reason-filter-option={option.value} onClick={() => handleQueueReasonFilterChange(option.value)} className={cn('min-h-7 rounded-md border px-2 text-[11px]', queueReasonFilter === option.value ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                        {option.label}<span className="ml-1 tabular-nums">{option.count}</span>
                    </button>)}
                </div>}
                <div className={cn('grid min-h-0 flex-1 gap-2 overflow-hidden', inlineInspector && hasSelection && 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
                    <section data-admin-moderation-list className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card" aria-label={activeTab === 'reviews' ? '리뷰 목록' : '제보 목록'}>
                        {(activeTab === 'reviews' ? reviewsLoading : loading && !submissions.length) ? renderListSkeletonCards(currentTabSummary.label) : <div ref={listScrollRef} className={listBodyClassName}
                            style={isMobile && activeTab === 'reviews' ? { touchAction: 'pan-y' } : undefined}
                            onPointerDown={isMobile && activeTab === 'reviews' ? handleSubmissionTabPointerDown : undefined}
                            onPointerMove={isMobile && activeTab === 'reviews' ? handleSubmissionTabPointerMove : undefined}
                            onPointerUp={isMobile && activeTab === 'reviews' ? handleSubmissionTabPointerEnd : undefined}
                            onPointerCancel={isMobile && activeTab === 'reviews' ? handleSubmissionTabPointerCancel : undefined}
                            onTouchStart={isMobile && activeTab === 'reviews' ? handleSubmissionTabTouchStart : undefined}
                            onTouchMove={isMobile && activeTab === 'reviews' ? handleSubmissionTabTouchMove : undefined}
                            onTouchEnd={isMobile && activeTab === 'reviews' ? handleSubmissionTabSwipeEnd : undefined}
                            onTouchCancel={isMobile && activeTab === 'reviews' ? handleSubmissionTabTouchCancel : undefined}>
                            {resultCount === 0 ? <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><p>{searchValue || statusFilter !== 'all' || queueReasonFilter !== 'all' ? '조건에 맞는 항목이 없습니다.' : '조회된 항목이 없습니다.'}</p>{(searchValue || statusFilter !== 'all' || queueReasonFilter !== 'all') && <Button variant="outline" size="sm" onClick={() => { changeSearch(''); setStatusFilter('all'); handleQueueReasonFilterChange('all'); }}>필터 초기화</Button>}</div> : <table className="admin-cms-table table-fixed"><thead className="sticky top-0 z-10 bg-card"><tr><th scope="col">{activeTab === 'reviews' ? '맛집 · 리뷰' : '맛집 · 주소'}</th><th scope="col" className="hidden w-28 sm:table-cell">작성자 · 접수일</th><th scope="col" className="w-24">처리 상태</th></tr></thead><tbody>
                                {activeTab === 'reviews' ? displayedReviews.map(review => <tr key={review.id} data-admin-review-row={review.id} className={cn('cursor-pointer', selectedReview?.id === review.id && 'admin-cms-row-selected')} onClick={event => { rowTriggerRef.current = event.currentTarget.querySelector('button'); handleReviewAction('approve', review); }}>
                                    <td><button type="button" aria-pressed={selectedReview?.id === review.id} aria-haspopup={inlineInspector ? undefined : 'dialog'} className={rowButtonClassName}>
                                        <span className="block truncate text-sm font-medium">{review.restaurants?.name || '맛집 미확인'}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{review.content || review.title || '내용 없음'}</span><span className="mt-1 block text-[11px] text-muted-foreground sm:hidden">{review.profiles?.nickname || '익명'} · {new Date(review.created_at).toLocaleDateString('ko-KR')}</span>
                                    </button></td>
                                    <td className="hidden text-muted-foreground sm:table-cell"><span className="block truncate">{review.profiles?.nickname || '익명'}</span><span className="mt-1 block text-[11px] tabular-nums">{new Date(review.created_at).toLocaleDateString('ko-KR')}</span></td>
                                    <td><span className="flex flex-col items-start gap-1">{renderReviewStatusBadge(review)}{review.is_duplicate && <span className="text-[11px] text-destructive">중복 영수증</span>}</span></td>
                                </tr>) : displayedSubmissions.map(submission => <tr key={submission.id} data-admin-submission-row={submission.id} className={cn('cursor-pointer', selectedSubmission?.id === submission.id && 'admin-cms-row-selected')} onClick={event => { rowTriggerRef.current = event.currentTarget.querySelector('button'); openSubmissionDetail(submission); }}>
                                    <td><button type="button" aria-pressed={selectedSubmission?.id === submission.id} aria-haspopup={inlineInspector ? undefined : 'dialog'} className={rowButtonClassName}>
                                        <span className="block truncate text-sm font-medium">{submission.restaurant_name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{submission.restaurant_address || '주소 없음'}</span><span className="mt-1 block text-[11px] text-muted-foreground sm:hidden">{submission.profiles?.nickname || '익명'} · {new Date(submission.created_at).toLocaleDateString('ko-KR')}</span>{renderSubmissionQueueSafetyBadges(submissionQueueSafetyById.get(submission.id), 'card')}
                                    </button></td>
                                    <td className="hidden text-muted-foreground sm:table-cell"><span className="block truncate">{submission.profiles?.nickname || '익명'}</span><span className="mt-1 block text-[11px] tabular-nums">{new Date(submission.created_at).toLocaleDateString('ko-KR')}</span></td>
                                    <td>{getStatusBadge(submission.status)}</td>
                                </tr>)}
                            </tbody></table>}
                            <div ref={loadMoreSentinelRef} className="h-1" />
                            {hasMoreCards && <div className="p-2 text-center"><Button type="button" variant="outline" size="sm" disabled={isCurrentListLoading} onClick={handleLoadMoreCards}>더 보기</Button></div>}
                        </div>}
                        <div className="admin-cms-footer shrink-0 justify-between"><span role="status">{isCurrentListLoading ? '조회 중' : `${displayedCount} / ${resultCount}건`}</span><span>조회된 목록 기준</span></div>
                    </section>
                    {inlineInspector && hasSelection ? (activeTab === 'reviews' ? renderReviewDetailPanel() : renderSubmissionDetailPanel()) : null}
                </div>
                <Sheet open={!inlineInspector && hasSelection} onOpenChange={open => { if (!open) closeInspector(); }}>
                    <SheetContent data-admin-moderation-drawer className="flex w-full flex-col gap-2 p-2 pt-12 sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); rowTriggerRef.current?.focus(); }}>
                        <SheetHeader className="sr-only"><SheetTitle>{activeTab === 'reviews' ? '리뷰 상세' : '제보 상세'}</SheetTitle><SheetDescription>선택한 항목의 검수와 처리</SheetDescription></SheetHeader>
                        {!inlineInspector && hasSelection ? (activeTab === 'reviews' ? renderReviewDetailPanel() : renderSubmissionDetailPanel()) : null}
                    </SheetContent>
                </Sheet>
            </div>
        </TooltipProvider>
    );
}
