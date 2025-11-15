import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createUserNotification } from "@/contexts/NotificationContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
    Shield,
    CheckCircle2,
    XCircle,
    Clock,
    Eye,
    Edit,
    Trash2,
    MessageSquare,
    Calendar,
    MapPin,
    Star,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
    edited_by_admin: boolean;
    created_at: string;
    updated_at: string;
    // Join 데이터
    profiles: {
        nickname: string;
    } | null;
    restaurants: {
        name: string;
        address: string;
    } | null;
}

export default function AdminReviewsPage() {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'edit' | null>(null);
    const [adminNote, setAdminNote] = useState("");

    // 모든 리뷰 조회 (관리자만) - 무한 스크롤 방식
    const {
        data: reviewsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
        error: queryError
    } = useInfiniteQuery({
        queryKey: ['admin-reviews', isAdmin],
        queryFn: async ({ pageParam = 0 }) => {
            if (!user || !isAdmin) return { reviews: [], nextCursor: null };

            // 1. 리뷰 데이터 가져오기 (페이지별)
            const { data: reviewsData, error: reviewsError } = await supabase
                .from('reviews')
                .select('*')
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19); // 한 페이지당 20개씩

            if (reviewsError) {
                console.error('❌ 리뷰 조회 실패:', reviewsError);
                throw reviewsError;
            }

            if (!reviewsData || reviewsData.length === 0) {
                return { reviews: [], nextCursor: null };
            }

            // 2. 필요한 user_id와 restaurant_id 수집
            const userIds = [...new Set(reviewsData.map(r => r.user_id))];
            const restaurantIds = [...new Set(reviewsData.map(r => r.restaurant_id))];

            // 3. Profiles 가져오기
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname')
                .in('user_id', userIds);

            // 4. Restaurants 가져오기
            const { data: restaurantsData } = await supabase
                .from('restaurants')
                .select('id, name, address')
                .in('id', restaurantIds);

            // 5. Map으로 변환 (빠른 조회)
            const profilesMap = new Map(
                (profilesData || []).map(p => [p.user_id, p.nickname])
            );
            const restaurantsMap = new Map(
                (restaurantsData || []).map(r => [r.id, { name: r.name, address: r.address }])
            );

            // 6. 리뷰 데이터 매핑
            const reviews = reviewsData.map(review => ({
                ...review,
                profiles: {
                    nickname: profilesMap.get(review.user_id) || '탈퇴한 사용자'
                },
                restaurants: restaurantsMap.get(review.restaurant_id) || { name: '알 수 없음', address: '' }
            })) as Review[];

            // 다음 페이지 커서 계산
            const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;

            return {
                reviews,
                nextCursor,
            };
        },
        getNextPageParam: (lastPage) => {
            if (!lastPage) return undefined;
            return lastPage.nextCursor ?? undefined;
        },
        initialPageParam: 0,
        enabled: !!user,
    });

    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const reviews = reviewsPages?.pages.flatMap(page => page.reviews) || [];

    // 리뷰 무한 스크롤을 위한 Intersection Observer
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

    // 리뷰 승인
    const approveMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            // 승인할 리뷰 정보 조회
            const { data: review, error: reviewError } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('id', reviewId)
                .single();

            if (reviewError) throw reviewError;

            // 이미 승인된 리뷰인 경우 중복 방지
            const wasAlreadyVerified = review.is_verified;

            // 리뷰 승인
            const { error: approveError } = await supabase
                .from('reviews')
                .update({
                    is_verified: true,
                    admin_note: adminNote.trim() || null,
                    edited_by_admin: !!adminNote.trim(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', reviewId);

            if (approveError) throw approveError;

            // 이미 승인된 리뷰가 아닐 때만 review_count 증가
            if (!wasAlreadyVerified) {
                // 해당 맛집의 현재 방문 횟수 및 리뷰 수 조회
                const { data: restaurant, error: fetchError } = await supabase
                    .from('restaurants')
                    .select('review_count')
                    .eq('id', review.restaurant_id)
                    .single();

                if (fetchError) throw fetchError;

                // 해당 맛집의 사용자 방문 횟수 및 리뷰 수 증가
                const { error: visitError } = await supabase
                    .from('restaurants')
                    .update({
                        review_count: (restaurant.review_count ?? 0) + 1,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', review.restaurant_id);

                if (visitError) throw visitError;
            }
        },
        onSuccess: () => {
            toast.success('리뷰가 승인되었습니다');

            // 승인 알림 생성 (리뷰 작성자에게)
            if (selectedReview && selectedReview.user_id) {
                createUserNotification(
                    selectedReview.user_id,
                    'review_approved',
                    '리뷰 승인됨',
                    `귀하의 리뷰 "${selectedReview.title}"이(가) 관리자 승인을 받았습니다.`,
                    {
                        reviewId: selectedReview.id,
                        restaurantName: selectedReview.restaurants?.name
                    }
                );
            }

            queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
            queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] }); // 맛집 데이터도 갱신
            setIsReviewModalOpen(false);
            setAdminNote("");
        },
        onError: (error: Error) => {
            toast.error(error.message || '승인에 실패했습니다');
        },
    });

    // 리뷰 거부
    const rejectMutation = useMutation({
        mutationFn: async (reviewId: string) => {
            // 거부할 리뷰의 현재 상태 확인
            const { data: review, error: reviewError } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('id', reviewId)
                .single();

            if (reviewError) throw reviewError;

            // 리뷰 거부
            const { error: rejectError } = await supabase
                .from('reviews')
                .update({
                    is_verified: false,
                    admin_note: adminNote.trim() ? `거부: ${adminNote.trim()}` : '거부: 관리자에 의해 거부됨',
                    edited_by_admin: true,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', reviewId);

            if (rejectError) throw rejectError;

            // 승인된 리뷰를 거부하는 경우에만 방문 횟수 및 리뷰 수 감소
            if (review.is_verified) {
                // 해당 맛집의 현재 방문 횟수 및 리뷰 수 조회
                const { data: restaurant, error: fetchError } = await supabase
                    .from('restaurants')
                    .select('review_count')
                    .eq('id', review.restaurant_id)
                    .single();

                if (fetchError) throw fetchError;

                // 해당 맛집의 사용자 방문 횟수 및 리뷰 수 감소 (0 이하로 내려가지 않도록)
                const { error: visitError } = await supabase
                    .from('restaurants')
                    .update({
                        review_count: Math.max((restaurant.review_count ?? 0) - 1, 0),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', review.restaurant_id);

                if (visitError) throw visitError;
            }
        },
        onSuccess: () => {
            toast.success('리뷰가 거부되었습니다');

            // 거부 알림 생성 (리뷰 작성자에게)
            if (selectedReview && selectedReview.user_id) {
                createUserNotification(
                    selectedReview.user_id,
                    'review_rejected',
                    '리뷰 거부됨',
                    `귀하의 리뷰 "${selectedReview.title}"이(가) 관리자 검토 후 거부되었습니다.`,
                    {
                        reviewId: selectedReview.id,
                        restaurantName: selectedReview.restaurants?.name,
                        adminNote: adminNote
                    }
                );
            }

            queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
            queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] }); // 맛집 데이터도 갱신
            setIsReviewModalOpen(false);
            setAdminNote("");
        },
        onError: (error: Error) => {
            toast.error(error.message || '거부에 실패했습니다');
        },
    });

    // 리뷰 삭제
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
            queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || '삭제에 실패했습니다');
        },
    });

    const handleReviewAction = (action: 'approve' | 'reject' | 'edit', review: Review) => {
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
            <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                승인됨
            </Badge>
        ) : (
            <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" />
                검토 대기
            </Badge>
        );
    };

    if (!user || !isAdmin) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="p-8 max-w-md text-center">
                    <div className="text-6xl mb-4">🔒</div>
                    <h2 className="text-2xl font-bold mb-2">접근 권한 없음</h2>
                    <p className="text-muted-foreground">
                        이 페이지는 관리자만 접근할 수 있습니다.
                    </p>
                </Card>
            </div>
        );
    }

    const pendingReviews = reviews.filter(r => !r.is_verified && (!r.admin_note || r.admin_note.trim() === ''));
    const approvedReviews = reviews.filter(r => r.is_verified);
    const rejectedReviews = reviews.filter(r => !r.is_verified && r.admin_note && r.admin_note.trim() !== '' && r.admin_note.includes('거부'));

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                            <Shield className="h-6 w-6 text-primary" />
                            관리자 리뷰 관리
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            쯔양 팬들이 작성한 리뷰를 검토하고 승인/거부할 수 있습니다
                        </p>
                        {queryError && (
                            <p className="text-sm text-red-500 mt-2">
                                ⚠️ 데이터 로드 실패: {(queryError as Error).message}
                            </p>
                        )}
                    </div>
                </div>

                {/* 통계 카드 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">검토 대기</p>
                                <p className="text-2xl font-bold">{pendingReviews.length}</p>
                            </div>
                            <Clock className="h-8 w-8 text-yellow-500" />
                        </div>
                    </Card>
                    <Card className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">승인됨</p>
                                <p className="text-2xl font-bold">{approvedReviews.length}</p>
                            </div>
                            <CheckCircle2 className="h-8 w-8 text-green-500" />
                        </div>
                    </Card>
                    <Card className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">전체 리뷰</p>
                                <p className="text-2xl font-bold">{reviews.length}</p>
                            </div>
                            <MessageSquare className="h-8 w-8 text-blue-500" />
                        </div>
                    </Card>
                </div>
            </div>

            {/* 리뷰 목록 */}
            <div className="flex-1 overflow-auto p-6">
                <Tabs defaultValue="pending" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="pending">
                            검토 대기 ({pendingReviews.length})
                        </TabsTrigger>
                        <TabsTrigger value="approved">
                            승인됨 ({approvedReviews.length})
                        </TabsTrigger>
                        <TabsTrigger value="rejected">
                            거부됨 ({rejectedReviews.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="mt-6">
                        {isLoading ? (
                            // Loading skeleton
                            <div className="grid gap-4">
                                {Array.from({ length: 3 }).map((_, index) => (
                                    <Card key={index} className="p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="h-5 bg-muted rounded animate-pulse w-40"></div>
                                                    <div className="h-5 bg-muted rounded animate-pulse w-16"></div>
                                                </div>
                                                <div className="flex items-center gap-4 text-sm mb-3">
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-5 h-5 bg-muted rounded-full animate-pulse"></div>
                                                        <div className="h-3 bg-muted rounded animate-pulse w-12"></div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-4 h-4 bg-muted rounded animate-pulse"></div>
                                                        <div className="h-3 bg-muted rounded animate-pulse w-16"></div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <div className="w-4 h-4 bg-muted rounded animate-pulse"></div>
                                                        <div className="h-3 bg-muted rounded animate-pulse w-20"></div>
                                                    </div>
                                                </div>
                                                <div className="h-12 bg-muted rounded animate-pulse w-full"></div>
                                            </div>
                                            <div className="flex gap-1 ml-4">
                                                <div className="h-8 bg-muted rounded animate-pulse w-16"></div>
                                                <div className="h-8 bg-muted rounded animate-pulse w-20"></div>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        ) : pendingReviews.length === 0 ? (
                            <Card className="p-12 text-center">
                                <div className="text-6xl mb-4">📋</div>
                                <h3 className="text-xl font-semibold mb-2">검토 대기 중인 리뷰가 없습니다</h3>
                                <p className="text-muted-foreground">
                                    모든 리뷰가 검토되었거나 아직 작성된 리뷰가 없습니다.
                                </p>
                            </Card>
                        ) : (
                            <>
                                <div className="grid gap-4">
                                    {pendingReviews.map((review, index) => (
                                        <Card
                                            key={`${review.id}-${index}`}
                                            ref={index === pendingReviews.length - 1 ? loadMoreRef : null}
                                            className="p-4"
                                        >
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <h3 className="text-lg font-semibold">{review.title}</h3>
                                                        {getStatusBadge(review.is_verified)}
                                                    </div>
                                                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                        <span className="flex items-center gap-1">
                                                            <Avatar className="h-6 w-6">
                                                                <AvatarFallback className="text-xs">
                                                                    {review.profiles?.nickname?.[0] || '익'}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            {review.profiles?.nickname || '익명'}
                                                        </span>
                                                        <span className="flex items-center gap-1">
                                                            <MapPin className="h-4 w-4" />
                                                            {review.restaurants?.name}
                                                        </span>
                                                        <span className="flex items-center gap-1">
                                                            <Calendar className="h-4 w-4" />
                                                            {new Date(review.visited_at).toLocaleDateString('ko-KR')}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleReviewAction('approve', review)}
                                                        className="text-green-600 hover:text-green-700"
                                                    >
                                                        <CheckCircle2 className="h-4 w-4 mr-1" />
                                                        승인
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleReviewAction('reject', review)}
                                                        className="text-red-600 hover:text-red-700"
                                                    >
                                                        <XCircle className="h-4 w-4 mr-1" />
                                                        거부
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDelete(review.id)}
                                                        className="text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <p className="text-sm text-muted-foreground line-clamp-3">
                                                    {review.content}
                                                </p>

                                                {review.verification_photo && (
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <Badge variant="outline">📸 인증 사진</Badge>
                                                        <span className="text-muted-foreground">업로드됨</span>
                                                    </div>
                                                )}

                                                {review.food_photos && review.food_photos.length > 0 && (
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <Badge variant="outline">🍽️ 음식 사진</Badge>
                                                        <span className="text-muted-foreground">{review.food_photos.length}장</span>
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                    <span>작성일: {new Date(review.created_at).toLocaleString('ko-KR')}</span>
                                                    <div className="flex flex-wrap gap-1">
                                                        {Array.isArray(review.category)
                                                            ? review.category.map((cat: string) => (
                                                                <Badge key={cat} variant="outline" className="text-xs">
                                                                    {cat}
                                                                </Badge>
                                                            ))
                                                            : (
                                                                <Badge variant="outline" className="text-xs">
                                                                    {review.category}
                                                                </Badge>
                                                            )
                                                        }
                                                    </div>
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>

                                {/* 추가 로딩 표시 */}
                                {isFetchingNextPage && (
                                    <div className="text-center py-8">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                                            <span className="text-sm text-muted-foreground">더 많은 리뷰를 불러오는 중...</span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="approved" className="mt-6">
                        {approvedReviews.length === 0 ? (
                            <Card className="p-12 text-center">
                                <div className="text-6xl mb-4">✅</div>
                                <h3 className="text-xl font-semibold mb-2">승인된 리뷰가 없습니다</h3>
                                <p className="text-muted-foreground">
                                    아직 승인된 리뷰가 없습니다.
                                </p>
                            </Card>
                        ) : (
                            <div className="grid gap-4">
                                {approvedReviews.map((review) => (
                                    <Card key={review.id} className="p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h3 className="text-lg font-semibold">{review.title}</h3>
                                                    {getStatusBadge(review.is_verified)}
                                                    {review.is_pinned && (
                                                        <Badge variant="default">📌 고정됨</Badge>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Avatar className="h-6 w-6">
                                                            <AvatarFallback className="text-xs">
                                                                {review.profiles?.nickname?.[0] || '익'}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        {review.profiles?.nickname || '익명'}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="h-4 w-4" />
                                                        {review.restaurants?.name}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-4 w-4" />
                                                        {new Date(review.visited_at).toLocaleDateString('ko-KR')}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleReviewAction('reject', review)}
                                                    className="text-red-600 hover:text-red-700"
                                                >
                                                    <XCircle className="h-4 w-4 mr-1" />
                                                    승인 취소
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDelete(review.id)}
                                                    className="text-destructive hover:text-destructive"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <p className="text-sm text-muted-foreground line-clamp-3">
                                                {review.content}
                                            </p>

                                            {review.verification_photo && (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Badge variant="outline">📸 인증 사진</Badge>
                                                    <span className="text-muted-foreground">업로드됨</span>
                                                </div>
                                            )}

                                            {review.food_photos && review.food_photos.length > 0 && (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Badge variant="outline">🍽️ 음식 사진</Badge>
                                                    <span className="text-muted-foreground">{review.food_photos.length}장</span>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>작성일: {new Date(review.created_at).toLocaleString('ko-KR')}</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {Array.isArray(review.category)
                                                        ? review.category.map((cat: string) => (
                                                            <Badge key={cat} variant="outline" className="text-xs">
                                                                {cat}
                                                            </Badge>
                                                        ))
                                                        : (
                                                            <Badge variant="outline" className="text-xs">
                                                                {review.category}
                                                            </Badge>
                                                        )
                                                    }
                                                </div>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="rejected" className="mt-6">
                        {rejectedReviews.length === 0 ? (
                            <Card className="p-12 text-center">
                                <div className="text-6xl mb-4">❌</div>
                                <h3 className="text-xl font-semibold mb-2">거부된 리뷰가 없습니다</h3>
                                <p className="text-muted-foreground">
                                    아직 거부된 리뷰가 없습니다.
                                </p>
                            </Card>
                        ) : (
                            <div className="grid gap-4">
                                {rejectedReviews.map((review) => (
                                    <Card key={review.id} className="p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h3 className="text-lg font-semibold">{review.title}</h3>
                                                    <Badge variant="destructive" className="gap-1">
                                                        <XCircle className="h-3 w-3" />
                                                        거부됨
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Avatar className="h-6 w-6">
                                                            <AvatarFallback className="text-xs">
                                                                {review.profiles?.nickname?.[0] || '익'}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        {review.profiles?.nickname || '익명'}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="h-4 w-4" />
                                                        {review.restaurants?.name}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-4 w-4" />
                                                        {new Date(review.visited_at).toLocaleDateString('ko-KR')}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleReviewAction('approve', review)}
                                                    className="text-green-600 hover:text-green-700"
                                                >
                                                    <CheckCircle2 className="h-4 w-4 mr-1" />
                                                    재승인
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDelete(review.id)}
                                                    className="text-destructive hover:text-destructive"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <p className="text-sm text-muted-foreground line-clamp-3">
                                                {review.content}
                                            </p>

                                            {review.admin_note && (
                                                <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                                    <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">
                                                        거부 사유:
                                                    </p>
                                                    <p className="text-sm text-red-600 dark:text-red-400">
                                                        {review.admin_note.startsWith('거부: ') ? review.admin_note.substring(4) : review.admin_note}
                                                    </p>
                                                </div>
                                            )}

                                            {review.verification_photo && (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Badge variant="outline">📸 인증 사진</Badge>
                                                    <span className="text-muted-foreground">업로드됨</span>
                                                </div>
                                            )}

                                            {review.food_photos && review.food_photos.length > 0 && (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Badge variant="outline">🍽️ 음식 사진</Badge>
                                                    <span className="text-muted-foreground">{review.food_photos.length}장</span>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>작성일: {new Date(review.created_at).toLocaleString('ko-KR')}</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {Array.isArray(review.category)
                                                        ? review.category.map((cat: string) => (
                                                            <Badge key={cat} variant="outline" className="text-xs">
                                                                {cat}
                                                            </Badge>
                                                        ))
                                                        : (
                                                            <Badge variant="outline" className="text-xs">
                                                                {review.category}
                                                            </Badge>
                                                        )
                                                    }
                                                </div>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            {/* 리뷰 검토 모달 */}
            <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl bg-gradient-primary bg-clip-text text-transparent">
                            리뷰 검토
                        </DialogTitle>
                        <DialogDescription>
                            리뷰를 승인하거나 거부할 수 있습니다
                        </DialogDescription>
                    </DialogHeader>

                    {selectedReview && (
                        <div className="space-y-4">
                            <Card className="p-4">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold">{selectedReview.title}</h3>
                                        {getStatusBadge(selectedReview.is_verified)}
                                    </div>

                                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <Avatar className="h-6 w-6">
                                                <AvatarFallback className="text-xs">
                                                    {selectedReview.profiles?.nickname?.[0] || '익'}
                                                </AvatarFallback>
                                            </Avatar>
                                            {selectedReview.profiles?.nickname || '익명'}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <MapPin className="h-4 w-4" />
                                            {selectedReview.restaurants?.name}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Calendar className="h-4 w-4" />
                                            {new Date(selectedReview.visited_at).toLocaleDateString('ko-KR')}
                                        </span>
                                    </div>

                                    <p className="text-sm">{selectedReview.content}</p>

                                    <div className="flex gap-2 text-sm">
                                        <Badge variant="outline">📸 인증 사진</Badge>
                                        <Badge variant="outline">🍽️ 음식 사진 ({selectedReview.food_photos?.length || 0}장)</Badge>
                                        <Badge variant="outline">{selectedReview.category}</Badge>
                                    </div>
                                </div>
                            </Card>

                            <div className="space-y-2">
                                <Label htmlFor="adminNote">관리자 메모</Label>
                                <Textarea
                                    id="adminNote"
                                    value={adminNote}
                                    onChange={(e) => setAdminNote(e.target.value)}
                                    placeholder="승인/거부 사유를 입력해주세요 (선택사항)"
                                    rows={3}
                                />
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setIsReviewModalOpen(false)}>
                                    취소
                                </Button>
                                {reviewAction === 'approve' && (
                                    <Button
                                        onClick={handleConfirmAction}
                                        className="bg-green-500 hover:bg-green-600"
                                        disabled={approveMutation.isPending}
                                    >
                                        {approveMutation.isPending ? '승인 중...' : '승인'}
                                    </Button>
                                )}
                                {reviewAction === 'reject' && (
                                    <Button
                                        onClick={handleConfirmAction}
                                        variant="destructive"
                                        disabled={rejectMutation.isPending}
                                    >
                                        {rejectMutation.isPending ? '거부 중...' : '거부'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
