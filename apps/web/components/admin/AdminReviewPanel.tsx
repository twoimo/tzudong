'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createUserNotification } from "@/contexts/NotificationContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
    CheckCircle2,
    XCircle,
    Clock,
    Trash2,
    MapPin,
    Calendar,
    X,
    Loader2,
    ChevronRight,
    ChevronLeft,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Review {
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
    } = useInfiniteQuery({
        queryKey: ['admin-reviews', isAdmin],
        queryFn: async ({ pageParam = 0 }) => {
            if (!user || !isAdmin) return { reviews: [], nextCursor: null };

            const { data: reviewsData, error: reviewsError } = await supabase
                .from('reviews')
                .select('*')
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19);

            if (reviewsError) throw reviewsError;

            if (!reviewsData || reviewsData.length === 0) {
                return { reviews: [], nextCursor: null };
            }

            const typedReviewsData = reviewsData as any[];
            const userIds = [...new Set(typedReviewsData.map(r => r.user_id))];
            const restaurantIds = [...new Set(typedReviewsData.map(r => r.restaurant_id))];

            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname')
                .in('user_id', userIds);

            const { data: restaurantsData } = await supabase
                .from('restaurants')
                .select('id, name, address')
                .in('id', restaurantIds);

            const typedProfilesData = (profilesData || []) as any[];
            const typedRestaurantsData = (restaurantsData || []) as any[];

            const profilesMap = new Map(typedProfilesData.map(p => [p.user_id, p.nickname]));
            const restaurantsMap = new Map(typedRestaurantsData.map(r => [r.id, { name: r.name, address: r.address }]));

            const reviews = typedReviewsData.map(review => ({
                ...review,
                profiles: { nickname: profilesMap.get(review.user_id) || '탈퇴한 사용자' },
                restaurants: restaurantsMap.get(review.restaurant_id) || { name: '알 수 없음', address: '' }
            })) as Review[];

            const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;

            return { reviews, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
        initialPageParam: 0,
        enabled: !!user && isOpen,
    });

    const reviews = reviewsPages?.pages.flatMap(page => page.reviews) || [];

    const loadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreReviews = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
    }, [loadMoreReviews]);

    const approveMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            const { data: review, error: reviewError } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('id', reviewId)
                .single();

            if (reviewError) throw reviewError;

            const typedReview = review as any;
            const wasAlreadyVerified = typedReview.is_verified;

            const { error: approveError } = await (supabase
                .from('reviews') as any)
                .update({
                    is_verified: true,
                    admin_note: adminNote.trim() || null,
                    is_edited_by_admin: !!adminNote.trim(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', reviewId);

            if (approveError) throw approveError;

            if (!wasAlreadyVerified) {
                const { data: restaurant, error: fetchError } = await supabase
                    .from('restaurants')
                    .select('review_count')
                    .eq('id', typedReview.restaurant_id)
                    .single();

                if (fetchError) throw fetchError;

                const typedRestaurant = restaurant as any;

                const { error: visitError } = await (supabase
                    .from('restaurants') as any)
                    .update({
                        review_count: (typedRestaurant.review_count ?? 0) + 1,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', typedReview.restaurant_id);

                if (visitError) throw visitError;
            }
        },
        onSuccess: () => {
            toast.success('리뷰가 승인되었습니다');

            if (selectedReview && selectedReview.user_id) {
                createUserNotification(
                    selectedReview.user_id,
                    'review_approved',
                    '리뷰 승인됨',
                    `귀하의 리뷰 "${selectedReview.title}"이(가) 승인되었습니다.`,
                    { reviewId: selectedReview.id, restaurantName: selectedReview.restaurants?.name }
                );
            }

            queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });
            setIsReviewModalOpen(false);
            setAdminNote("");
        },
        onError: (error: Error) => {
            toast.error(error.message || '승인에 실패했습니다');
        },
    });

    const rejectMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            const { data: review, error: reviewError } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('id', reviewId)
                .single();

            if (reviewError) throw reviewError;

            const typedReview = review as any;

            const { error: rejectError } = await (supabase
                .from('reviews') as any)
                .update({
                    is_verified: false,
                    admin_note: adminNote.trim() ? `거부: ${adminNote.trim()}` : '거부: 관리자에 의해 거부됨',
                    is_edited_by_admin: true,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', reviewId);

            if (rejectError) throw rejectError;

            if (typedReview.is_verified) {
                const { data: restaurant, error: fetchError } = await supabase
                    .from('restaurants')
                    .select('review_count')
                    .eq('id', typedReview.restaurant_id)
                    .single();

                if (fetchError) throw fetchError;

                const typedRestaurant = restaurant as any;

                const { error: visitError } = await (supabase
                    .from('restaurants') as any)
                    .update({
                        review_count: Math.max((typedRestaurant.review_count ?? 0) - 1, 0),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', typedReview.restaurant_id);

                if (visitError) throw visitError;
            }
        },
        onSuccess: () => {
            toast.success('리뷰가 거부되었습니다');

            if (selectedReview && selectedReview.user_id) {
                createUserNotification(
                    selectedReview.user_id,
                    'review_rejected',
                    '리뷰 거부됨',
                    `귀하의 리뷰 "${selectedReview.title}"이(가) 거부되었습니다.`,
                    { reviewId: selectedReview.id, restaurantName: selectedReview.restaurants?.name, adminNote }
                );
            }

            queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });
            setIsReviewModalOpen(false);
            setAdminNote("");
        },
        onError: (error: Error) => {
            toast.error(error.message || '거부에 실패했습니다');
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            const { error } = await supabase
                .from('reviews')
                .delete()
                .eq('id', reviewId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('리뷰가 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || '삭제에 실패했습니다');
        },
    });

    const handleReviewAction = (action: 'approve' | 'reject', review: Review) => {
        setSelectedReview(review);
        setReviewAction(action);
        setAdminNote(review.admin_note || "");
        setIsReviewModalOpen(true);
    };

    const handleConfirmAction = () => {
        if (!selectedReview) return;

        if (reviewAction === 'approve') {
            approveMutation.mutate(selectedReview.id);
        } else if (reviewAction === 'reject') {
            rejectMutation.mutate(selectedReview.id);
        }
    };

    const handleDelete = (reviewId: string) => {
        if (confirm('정말로 이 리뷰를 삭제하시겠습니까?')) {
            deleteMutation.mutate(reviewId);
        }
    };

    const getStatusBadge = (isVerified: boolean) => {
        return isVerified ? (
            <Badge className="bg-green-500 gap-1 text-xs"><CheckCircle2 className="h-3 w-3" />승인</Badge>
        ) : (
            <Badge variant="secondary" className="gap-1 text-xs"><Clock className="h-3 w-3" />대기</Badge>
        );
    };

    const pendingReviews = reviews.filter(r => !r.is_verified && (!r.admin_note || r.admin_note.trim() === ''));
    const approvedReviews = reviews.filter(r => r.is_verified);
    const rejectedReviews = reviews.filter(r => !r.is_verified && r.admin_note && r.admin_note.trim() !== '' && r.admin_note.includes('거부'));

    if (!user || !isAdmin) {
        return (
            <div className="h-full flex flex-col bg-background">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-bold">리뷰관리</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>
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
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div>
                    <h2 className="text-lg font-bold">리뷰관리</h2>
                    <p className="text-sm text-muted-foreground">사용자 리뷰 승인/거부</p>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {/* 통계 */}
            <div className="grid grid-cols-3 gap-2 p-3 border-b border-border">
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

            {/* 탭 및 목록 */}
            <div className="flex-1 overflow-auto p-3">
                <Tabs defaultValue="pending" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-3">
                        <TabsTrigger value="pending" className="text-xs">
                            대기 ({pendingReviews.length})
                        </TabsTrigger>
                        <TabsTrigger value="approved" className="text-xs">
                            승인 ({approvedReviews.length})
                        </TabsTrigger>
                        <TabsTrigger value="rejected" className="text-xs">
                            거부 ({rejectedReviews.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="space-y-2">
                        {isLoading ? (
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
                                <div className="text-3xl mb-2">✅</div>
                                <p className="text-sm text-muted-foreground">대기 중인 리뷰가 없습니다</p>
                            </Card>
                        ) : (
                            <>
                                {pendingReviews.map((review, index) => (
                                    <ReviewCard
                                        key={review.id}
                                        ref={index === pendingReviews.length - 1 ? loadMoreRef : null}
                                        review={review}
                                        onApprove={() => handleReviewAction('approve', review)}
                                        onReject={() => handleReviewAction('reject', review)}
                                        onDelete={() => handleDelete(review.id)}
                                    />
                                ))}
                                {isFetchingNextPage && (
                                    <div className="text-center py-4">
                                        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                                    </div>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="approved" className="space-y-2">
                        {approvedReviews.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">📋</div>
                                <p className="text-sm text-muted-foreground">승인된 리뷰가 없습니다</p>
                            </Card>
                        ) : (
                            approvedReviews.map((review) => (
                                <ReviewCard
                                    key={review.id}
                                    review={review}
                                    onReject={() => handleReviewAction('reject', review)}
                                    onDelete={() => handleDelete(review.id)}
                                    showRejectButton
                                />
                            ))
                        )}
                    </TabsContent>

                    <TabsContent value="rejected" className="space-y-2">
                        {rejectedReviews.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">📋</div>
                                <p className="text-sm text-muted-foreground">거부된 리뷰가 없습니다</p>
                            </Card>
                        ) : (
                            rejectedReviews.map((review) => (
                                <ReviewCard
                                    key={review.id}
                                    review={review}
                                    onApprove={() => handleReviewAction('approve', review)}
                                    onDelete={() => handleDelete(review.id)}
                                    showApproveButton
                                />
                            ))
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            {/* 리뷰 검토 모달 */}
            <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {reviewAction === 'approve' ? '✅ 리뷰 승인' : '❌ 리뷰 거부'}
                        </DialogTitle>
                        <DialogDescription>
                            리뷰를 {reviewAction === 'approve' ? '승인' : '거부'}합니다
                        </DialogDescription>
                    </DialogHeader>

                    {selectedReview && (
                        <div className="space-y-4 mt-4">
                            <Card className="p-3 bg-muted/50">
                                <div className="space-y-2 text-sm">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold">{selectedReview.title}</h3>
                                        {getStatusBadge(selectedReview.is_verified)}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <Avatar className="h-4 w-4">
                                                <AvatarFallback className="text-[10px]">
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
                                    value={adminNote}
                                    onChange={(e) => setAdminNote(e.target.value)}
                                    placeholder={reviewAction === 'approve' ? '승인 사유 (선택)' : '거부 사유를 입력해주세요'}
                                    rows={3}
                                />
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setIsReviewModalOpen(false)}>
                                    취소
                                </Button>
                                <Button
                                    onClick={handleConfirmAction}
                                    disabled={approveMutation.isPending || rejectMutation.isPending}
                                    className={reviewAction === 'approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}
                                >
                                    {(approveMutation.isPending || rejectMutation.isPending) ? (
                                        <><Loader2 className="mr-1 h-4 w-4 animate-spin" />처리 중</>
                                    ) : reviewAction === 'approve' ? '승인' : '거부'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

// 리뷰 카드 컴포넌트
import { forwardRef } from 'react';

interface ReviewCardProps {
    review: Review;
    onApprove?: () => void;
    onReject?: () => void;
    onDelete: () => void;
    showApproveButton?: boolean;
    showRejectButton?: boolean;
}

const ReviewCard = forwardRef<HTMLDivElement, ReviewCardProps>(
    ({ review, onApprove, onReject, onDelete, showApproveButton, showRejectButton }, ref) => {
        const isPending = !review.is_verified && (!review.admin_note || !review.admin_note.includes('거부'));
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
                                ) : review.admin_note?.includes('거부') ? (
                                    <Badge variant="destructive" className="gap-1 text-xs"><XCircle className="h-3 w-3" />거부</Badge>
                                ) : (
                                    <Badge variant="secondary" className="gap-1 text-xs"><Clock className="h-3 w-3" />대기</Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                    <Avatar className="h-4 w-4">
                                        <AvatarFallback className="text-[10px]">
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

                    {review.admin_note?.includes('거부') && (
                        <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 rounded text-xs">
                            <strong>거부 사유:</strong> {review.admin_note.replace('거부: ', '')}
                        </div>
                    )}

                    {isPending && (
                        <div className="flex gap-1">
                            <Button onClick={onApprove} size="sm" className="flex-1 bg-green-500 hover:bg-green-600 text-xs h-7">
                                승인
                            </Button>
                            <Button onClick={onReject} size="sm" variant="destructive" className="flex-1 text-xs h-7">
                                거부
                            </Button>
                            <Button onClick={onDelete} size="sm" variant="outline" className="h-7 w-7 p-0">
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    )}

                    {showRejectButton && (
                        <div className="flex gap-1">
                            <Button onClick={onReject} size="sm" variant="destructive" className="flex-1 text-xs h-7">
                                승인 취소
                            </Button>
                            <Button onClick={onDelete} size="sm" variant="outline" className="h-7 w-7 p-0">
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    )}

                    {showApproveButton && (
                        <div className="flex gap-1">
                            <Button onClick={onApprove} size="sm" className="flex-1 bg-green-500 hover:bg-green-600 text-xs h-7">
                                재승인
                            </Button>
                            <Button onClick={onDelete} size="sm" variant="outline" className="h-7 w-7 p-0">
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
