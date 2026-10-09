'use client';

import { MapPanelHeader } from '@/components/home/map-panel-chrome';

import { useState, useRef, useCallback, useEffect, forwardRef } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { createUserNotification } from "@/contexts/NotificationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/no-toast";
import { useRecordAction } from "@/lib/admin/use-record-action";
import { isRecordActionCancelled, recordActionErrorMessage, recordActionMediaNotice, RECORD_VIEWS_INVALIDATED_EVENT } from "@/lib/admin/record-action-client";
import type { RecordActionReceipt } from "@/lib/admin/record-action-contract";
import { ADMIN_PENDING_COUNTS_QUERY_KEY } from "@/lib/admin/pending-counts";
import { invalidateRestaurantDiscoveryQueries } from "@/lib/restaurant-discovery-cache";
import { fetchAdminProfileSummariesLookup, resolveAdminReviewerDisplay } from "@/lib/admin/profile-summaries";
import {
    CheckCircle2,
    XCircle,
    Clock,
    Trash2,
    MapPin,
    Calendar,
    Loader2,
    ChevronRight,
    ChevronLeft,
} from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
    ADMIN_MODAL_ACTION,
    ADMIN_MODAL_CONTENT_SM_FLEX,
    ADMIN_MODAL_FOOTER_DIVIDER,
} from "./admin-modal-styles";

type ReviewRow = Tables<'reviews'>;
type AdminReviewRow = Pick<
    ReviewRow,
    | 'id'
    | 'user_id'
    | 'restaurant_id'
    | 'title'
    | 'content'
    | 'visited_at'
    | 'verification_photo'
    | 'food_photos'
    | 'categories'
    | 'is_verified'
    | 'admin_note'
    | 'is_pinned'
    | 'is_edited_by_admin'
    | 'created_at'
    | 'updated_at'
>;
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
].join(', ');

interface RestaurantSummaryRow {
    id: string;
    name: string | null;
    road_address: string | null;
    jibun_address: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isAdminReviewRow(value: unknown): value is AdminReviewRow {
    if (!isRecord(value)) return false;

    return typeof value.id === 'string'
        && typeof value.user_id === 'string'
        && typeof value.restaurant_id === 'string'
        && typeof value.title === 'string'
        && typeof value.content === 'string'
        && typeof value.visited_at === 'string'
        && typeof value.verification_photo === 'string'
        && isStringArray(value.food_photos)
        && isStringArray(value.categories)
        && typeof value.is_verified === 'boolean'
        && (value.admin_note === null || typeof value.admin_note === 'string')
        && typeof value.is_pinned === 'boolean'
        && typeof value.is_edited_by_admin === 'boolean'
        && typeof value.created_at === 'string'
        && typeof value.updated_at === 'string';
}

function isRestaurantSummaryRow(value: unknown): value is RestaurantSummaryRow {
    return isRecord(value)
        && typeof value.id === 'string'
        && (value.name === null || typeof value.name === 'string')
        && (value.road_address === null || typeof value.road_address === 'string')
        && (value.jibun_address === null || typeof value.jibun_address === 'string');
}

function requireRows<T>(
    value: unknown,
    isRow: (row: unknown) => row is T,
    errorMessage: string,
): T[] {
    if (!Array.isArray(value)) throw new Error(errorMessage);
    const rows = value.filter(isRow);
    if (rows.length !== value.length) throw new Error(errorMessage);
    return rows;
}

interface Review {
    id: string;
    user_id: string;
    restaurant_id: string;
    title: string;
    content: string;
    visited_at: string;
    verification_photo: string;
    food_photos: string[];
    categories: string[];
    is_verified: boolean;
    admin_note: string | null;
    is_pinned: boolean;
    is_edited_by_admin: boolean;
    created_at: string;
    updated_at: string;
    profiles: {
        nickname: string;
    } | null;
    restaurants: {
        name: string;
        address: string;
    } | null;
}

interface AdminReviewPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
}

export default function AdminReviewPanel({ isOpen, onClose, onToggleCollapse, isCollapsed }: AdminReviewPanelProps) {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
    const [adminNote, setAdminNote] = useState("");

    const {
        data: reviewsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
        isError,
        isFetchNextPageError,
        refetch,
    } = useInfiniteQuery({
        queryKey: ['admin-reviews', user?.id, isAdmin],
        queryFn: async ({ pageParam = 0 }) => {
            if (!user || !isAdmin) return { reviews: [], nextCursor: null };

            const { data: reviewsData, error: reviewsError } = await supabase
                .from('reviews')
                .select(ADMIN_REVIEW_SELECT)
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19)
                .overrideTypes<AdminReviewRow[], { merge: false }>();

            if (reviewsError) throw reviewsError;

            if (!reviewsData || reviewsData.length === 0) {
                return { reviews: [], nextCursor: null };
            }

            const typedReviewsData = requireRows(reviewsData, isAdminReviewRow, '리뷰 데이터 형식이 올바르지 않습니다.');
            const userIds = [...new Set(typedReviewsData.map(r => r.user_id))];
            const restaurantIds = [...new Set(typedReviewsData.map(r => r.restaurant_id))];

            const [profilesLookup, restaurantsResult] = await Promise.all([
                fetchAdminProfileSummariesLookup(userIds),
                supabase
                    .from('restaurants')
                    .select('id, name:approved_name, road_address, jibun_address')
                    .in('id', restaurantIds)
                    .overrideTypes<RestaurantSummaryRow[], { merge: false }>(),
            ]);

            if (restaurantsResult.error) throw new Error('맛집 정보를 불러오지 못했습니다.');
            const restaurantsData = restaurantsResult.data;
            const typedRestaurantsData = restaurantsData
                ? requireRows(restaurantsData, isRestaurantSummaryRow, '레스토랑 데이터 형식이 올바르지 않습니다.')
                : [];

            const restaurantsMap = new Map(
                typedRestaurantsData.map(r => [
                    r.id,
                    {
                        name: r.name || '알 수 없음',
                        address: r.road_address || r.jibun_address || '',
                    },
                ])
            );

            const reviews: Review[] = typedReviewsData.map((review) => ({
                id: review.id,
                user_id: review.user_id,
                restaurant_id: review.restaurant_id,
                title: review.title,
                content: review.content,
                visited_at: review.visited_at,
                verification_photo: review.verification_photo,
                food_photos: review.food_photos,
                categories: review.categories,
                is_verified: review.is_verified,
                admin_note: review.admin_note,
                is_pinned: review.is_pinned,
                is_edited_by_admin: review.is_edited_by_admin,
                created_at: review.created_at,
                updated_at: review.updated_at,
                profiles: {
                    nickname: resolveAdminReviewerDisplay(
                        review.user_id,
                        profilesLookup.summaries,
                        profilesLookup.ok,
                    ).nickname,
                },
                restaurants: restaurantsMap.get(review.restaurant_id) || { name: '알 수 없음', address: '' },
            }));

            const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;

            return { reviews, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
        initialPageParam: 0,
        enabled: !!user && isAdmin && isOpen,
    });

    const reviews = reviewsPages?.pages.flatMap(page => page.reviews) || [];

    const loadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreReviews = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage && !isError) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreReviews();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreReviews, isOpen]);

    const refreshReviewViews = useCallback(async () => {
        await Promise.all([
            ...[['admin-reviews'], ['admin-reviews-inline'], ['restaurant-reviews'], ['review-feed'], ['review-feed-overlay'], ['user-reviews'], ['admin-pending-counts'], ADMIN_PENDING_COUNTS_QUERY_KEY].map(queryKey => queryClient.invalidateQueries({ queryKey })),
            invalidateRestaurantDiscoveryQueries(queryClient),
        ]);
    }, [queryClient]);
    useEffect(() => {
        const invalidate = () => { void refreshReviewViews(); };
        window.addEventListener(RECORD_VIEWS_INVALIDATED_EVENT, invalidate);
        return () => window.removeEventListener(RECORD_VIEWS_INVALIDATED_EVENT, invalidate);
    }, [refreshReviewViews]);
    const onRecordApplied = async (receipt: RecordActionReceipt) => {
        toast.success(['변경 확인 완료', recordActionMediaNotice(receipt)].filter(Boolean).join(' · '));
        setIsReviewModalOpen(false);
        setSelectedReview(null);
        setAdminNote("");
        await refreshReviewViews();
    };
    const recordActions = useRecordAction(receipt => { void onRecordApplied(receipt); }, { recover: isOpen && isAdmin });
    const notifyRecordActionError = (error: unknown) => {
        if (!isRecordActionCancelled(error)) toast.error(recordActionErrorMessage(error));
    };
    type ModerationInput = { review: Review; note: string };
    const afterModeration = async (receipt: RecordActionReceipt, { review, note }: ModerationInput) => {
        const row = receipt.readback.find(item => item.kind === 'review' && item.id === review.id);
        const approved = row?.status === 'approved';
        if (review.user_id && (approved || row?.status === 'rejected')) {
            void createUserNotification(
                review.user_id,
                approved ? 'review_approved' : 'review_rejected',
                approved ? '리뷰 승인됨' : '리뷰 거부됨',
                `귀하의 리뷰 "${review.title}"이(가) ${approved ? '승인' : '거부'}되었습니다.`,
                { reviewId: review.id, restaurantName: review.restaurants?.name, ...(approved ? {} : { adminNote: note }) },
            ).catch(() => toast.error('변경은 확인됐지만 작성자 알림은 확인하지 못했습니다.'));
        }
        await onRecordApplied(receipt);
    };
    const approveMutation = useMutation({
        mutationFn: ({ review, note }: ModerationInput) => recordActions.run({
            action: 'review.approve', targetIds: [review.id], payload: { note: note.trim() || undefined },
        }),
        onSuccess: afterModeration,
        onError: notifyRecordActionError,
    });
    const rejectMutation = useMutation({
        mutationFn: ({ review, note }: ModerationInput) => recordActions.run({
            action: 'review.reject', targetIds: [review.id], payload: { reason: note.trim() || '관리자에 의해 거부됨' },
        }),
        onSuccess: afterModeration,
        onError: notifyRecordActionError,
    });
    const deleteMutation = useMutation({
        mutationFn: (reviewId: string) => recordActions.run({
            action: 'review.delete', targetIds: [reviewId], payload: { reason: '관리자에 의해 삭제됨' },
        }),
        onSuccess: onRecordApplied,
        onError: notifyRecordActionError,
    });
    const actionBusy = recordActions.busy || approveMutation.isPending || rejectMutation.isPending || deleteMutation.isPending;
    const handleReviewAction = (action: 'approve' | 'reject', review: Review) => {
        if (actionBusy) return;
        setSelectedReview(review);
        setReviewAction(action);
        setAdminNote(review.admin_note || "");
        setIsReviewModalOpen(true);
    };
    const handleConfirmAction = () => {
        if (!selectedReview || actionBusy || (reviewAction === 'reject' && !adminNote.trim())) return;
        const input = { review: selectedReview, note: adminNote };
        setIsReviewModalOpen(false);
        if (reviewAction === 'approve') approveMutation.mutate(input);
        else if (reviewAction === 'reject') rejectMutation.mutate(input);
    };
    const handleDelete = (review: Review) => {
        if (!actionBusy) deleteMutation.mutate(review.id);
    };

    const getStatusBadge = (isVerified: boolean) => {
        return isVerified ? (
            <Badge className="bg-green-500 gap-1 text-xs"><CheckCircle2 className="h-3 w-3" />승인</Badge>
        ) : (
            <Badge variant="secondary" className="gap-1 text-xs"><Clock className="h-3 w-3" />대기</Badge>
        );
    };

    const pendingReviews = reviews.filter(r => !r.is_verified && !r.admin_note?.startsWith('거부: '));
    const approvedReviews = reviews.filter(r => r.is_verified);
    const rejectedReviews = reviews.filter(r => !r.is_verified && r.admin_note?.startsWith('거부: '));

    if (!user || !isAdmin) {
        return (
            <div className="h-full flex flex-col bg-background">
                <MapPanelHeader title="리뷰관리" onClose={onClose} closeLabel="리뷰관리 패널 닫기" />
                <div className="flex-1 flex items-center justify-center p-8">
                    <Card className="p-8 text-center">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-semibold mb-2">접근 권한 없음</h3>
                        <p className="text-sm text-muted-foreground">관리자만 접근할 수 있습니다.</p>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background border-l border-border relative">
            {/* 플로팅 접기/펼치기 버튼 - 패널 좌측 가장자리 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                </button>
            )}

            {/* 헤더 */}
            <MapPanelHeader
                title="리뷰관리"
                description={`불러온 리뷰 ${reviews.length}건`}
                onClose={onClose}
                closeLabel="리뷰관리 패널 닫기"
            />

            {/* 통계 */}
            <div aria-label="불러온 리뷰 상태" className="grid grid-cols-3 gap-2 p-3 border-b border-border">
                <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded">
                    <p className="text-xs text-muted-foreground">대기</p>
                    <p className="text-lg font-bold">{pendingReviews.length}</p>
                </div>
                <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded">
                    <p className="text-xs text-muted-foreground">승인</p>
                    <p className="text-lg font-bold">{approvedReviews.length}</p>
                </div>
                <div className="text-center p-2 bg-red-50 dark:bg-red-950/20 rounded">
                    <p className="text-xs text-muted-foreground">거부</p>
                    <p className="text-lg font-bold">{rejectedReviews.length}</p>
                </div>
            </div>

            {/* 대기 중인 리뷰 목록 */}
            <div className="flex-1 overflow-auto p-3 space-y-2">
                {isError && !isFetchNextPageError ? (
                    <div role="alert" className="space-y-2 p-3 text-sm">
                        <p>리뷰를 불러오지 못했습니다.</p>
                        <Button variant="outline" size="sm" onClick={() => void refetch()}>다시 불러오기</Button>
                    </div>
                ) : isLoading ? (
                    <div className="space-y-2">
                        {[1, 2, 3].map(i => (
                            <Card key={i} className="p-3">
                                <div className="h-4 bg-muted rounded animate-pulse w-32 mb-2" />
                                <div className="h-3 bg-muted rounded animate-pulse w-48" />
                            </Card>
                        ))}
                    </div>
                ) : pendingReviews.length === 0 ? (
                    <Card className="p-6 text-center">
                        <p className="text-sm text-muted-foreground">대기 중인 리뷰가 없습니다</p>
                    </Card>
                ) : (
                    <>
                        {pendingReviews.map((review) => (
                            <ReviewCard
                                key={review.id}
                                disabled={actionBusy}
                                review={review}
                                onApprove={() => handleReviewAction('approve', review)}
                                onReject={() => handleReviewAction('reject', review)}
                                onDelete={() => handleDelete(review)}
                            />
                        ))}
                        {isFetchingNextPage && (
                            <div className="text-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                            </div>
                        )}
                    </>
                )}
                <div ref={loadMoreRef} aria-hidden="true" className="h-px" />
                {isFetchNextPageError && <p role="alert" className="text-sm text-destructive">다음 리뷰를 불러오지 못했습니다.</p>}
                {hasNextPage && <Button variant="outline" size="sm" className="w-full" onClick={() => { if (!isFetchingNextPage) void fetchNextPage(); }} disabled={isFetchingNextPage}>{isFetchNextPageError ? '다음 리뷰 다시 불러오기' : '리뷰 더 불러오기'}</Button>}
            </div>

            {recordActions.dialog}
            {/* 리뷰 검토 모달 */}
            <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
                <DialogContent className={ADMIN_MODAL_CONTENT_SM_FLEX}>
                    <DialogHeader>
                        <DialogTitle>
                            {reviewAction === 'approve' ? '리뷰 승인' : '리뷰 거부'}
                        </DialogTitle>
                        <DialogDescription>
                            리뷰를 {reviewAction === 'approve' ? '승인' : '거부'}합니다
                        </DialogDescription>
                    </DialogHeader>

                    {selectedReview && (
                        <>
                            <div className="mt-4 space-y-4">
                                <Card className="p-3 bg-muted/50">
                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold">{selectedReview.title}</h3>
                                            {getStatusBadge(selectedReview.is_verified)}
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Avatar className="h-4 w-4">
                                                    <AvatarFallback className="text-2xs">
                                                        {selectedReview.profiles?.nickname?.[0] || '익'}
                                                    </AvatarFallback>
                                                </Avatar>
                                                {selectedReview.profiles?.nickname || '익명'}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                {selectedReview.restaurants?.name}
                                            </span>
                                        </div>
                                        <p className="text-muted-foreground line-clamp-3">{selectedReview.content}</p>
                                    </div>
                                </Card>

                                <div className="space-y-2">
                                    <Label>관리자 메모{reviewAction === 'reject' && ' (필수)'}</Label>
                                    <Textarea
                                        aria-label="관리자 메모"
                                        maxLength={500}
                                        value={adminNote}
                                        onChange={(e) => setAdminNote(e.target.value)}
                                        placeholder={reviewAction === 'approve' ? '승인 사유 (선택)' : '거부 사유를 입력해주세요'}
                                        rows={3}
                                    />
                                </div>
                            </div>

                            <DialogFooter className={ADMIN_MODAL_FOOTER_DIVIDER}>
                                <Button variant="outline" onClick={() => setIsReviewModalOpen(false)} className={ADMIN_MODAL_ACTION}>
                                    취소
                                </Button>
                                <Button
                                    onClick={handleConfirmAction}
                                    disabled={actionBusy || (reviewAction === 'reject' && !adminNote.trim())}
                                    className={`${ADMIN_MODAL_ACTION} ${reviewAction === 'approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
                                >
                                    {(approveMutation.isPending || rejectMutation.isPending) ? (
                                        <><Loader2 className="mr-1 h-4 w-4 animate-spin" />처리 중</>
                                    ) : reviewAction === 'approve' ? '승인' : '거부'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

// 리뷰 카드 컴포넌트

interface ReviewCardProps {
    review: Review;
    onApprove?: () => void;
    onReject?: () => void;
    onDelete: () => void;
    disabled?: boolean;
    showApproveButton?: boolean;
    showRejectButton?: boolean;
}

const ReviewCard = forwardRef<HTMLDivElement, ReviewCardProps>(
    ({ review, onApprove, onReject, onDelete, disabled, showApproveButton, showRejectButton }, ref) => {
        const isPending = !review.is_verified && !review.admin_note?.startsWith('거부: ');
        const isApproved = review.is_verified;

        return (
            <Card ref={ref} className="p-3">
                <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap mb-1">
                                <h3 className="text-sm font-semibold truncate">{review.title}</h3>
                                {isApproved ? (
                                    <Badge className="bg-green-500 gap-1 text-xs"><CheckCircle2 className="h-3 w-3" />승인</Badge>
                                ) : review.admin_note?.startsWith('거부: ') ? (
                                    <Badge variant="destructive" className="gap-1 text-xs"><XCircle className="h-3 w-3" />거부</Badge>
                                ) : (
                                    <Badge variant="secondary" className="gap-1 text-xs"><Clock className="h-3 w-3" />대기</Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                    <Avatar className="h-4 w-4">
                                        <AvatarFallback className="text-2xs">
                                            {review.profiles?.nickname?.[0] || '익'}
                                        </AvatarFallback>
                                    </Avatar>
                                    {review.profiles?.nickname || '익명'}
                                </span>
                                <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {review.restaurants?.name}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{review.content}</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(review.visited_at).toLocaleDateString('ko-KR')}
                        </span>
                        {review.food_photos?.length > 0 && (
                            <Badge variant="outline" className="text-xs">📷 {review.food_photos.length}</Badge>
                        )}
                    </div>

                    {review.admin_note?.startsWith('거부: ') && (
                        <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 rounded text-xs">
                            <strong>거부 사유:</strong> {review.admin_note.replace('거부: ', '')}
                        </div>
                    )}

                    {isPending && (
                        <div className="flex gap-1">
                            <Button disabled={disabled} onClick={onApprove} size="sm" className="flex-1 bg-green-500 hover:bg-green-600 text-xs h-7">
                                승인
                            </Button>
                            <Button disabled={disabled} onClick={onReject} size="sm" variant="destructive" className="flex-1 text-xs h-7">
                                거부
                            </Button>
                            <Button aria-label="리뷰 삭제" disabled={disabled} onClick={onDelete} size="sm" variant="outline" className="h-7 w-7 p-0">
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    )}

                    {showRejectButton && (
                        <div className="flex gap-1">
                            <Button disabled={disabled} onClick={onReject} size="sm" variant="destructive" className="flex-1 text-xs h-7">
                                승인 취소
                            </Button>
                            <Button aria-label="리뷰 삭제" disabled={disabled} onClick={onDelete} size="sm" variant="outline" className="h-7 w-7 p-0">
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    )}

                    {showApproveButton && (
                        <div className="flex gap-1">
                            <Button disabled={disabled} onClick={onApprove} size="sm" className="flex-1 bg-green-500 hover:bg-green-600 text-xs h-7">
                                재승인
                            </Button>
                            <Button aria-label="리뷰 삭제" disabled={disabled} onClick={onDelete} size="sm" variant="outline" className="h-7 w-7 p-0">
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    )}
                </div>
            </Card>
        );
    }
);

ReviewCard.displayName = 'ReviewCard';
