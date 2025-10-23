import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Pin, CheckCircle, Clock, MapPin, Calendar, MessageSquare, XCircle, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Review {
    id: string;
    restaurantName: string;
    restaurantCategories: string[];
    userName: string;
    visitedAt: string;
    submittedAt: string;
    content: string;
    isVerified: boolean;
    isPinned: boolean;
    isEditedByAdmin: boolean;
    admin_note: string | null;
    photos: { url: string; type: string }[];
    category: string;
}


const ReviewsPage = () => {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [filterCategory, setFilterCategory] = useState<string>("all");
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);

    // 로그인하지 않은 경우 더미 데이터 표시
    const isLoggedIn = !!user;

    // Fetch reviews from Supabase - 모든 승인된 리뷰 조회
    const { data: reviewsData = [], isLoading, refetch } = useQuery({
        queryKey: ['reviews', filterCategory, filterStatus],
        queryFn: async () => {
            try {
                console.log('🔍 리뷰 데이터 가져오는 중...');

                // 1. 모든 승인된 리뷰 조회 (공개 리뷰)
                const { data: reviewsData, error: reviewsError } = await supabase
                    .from('reviews')
                    .select('*')
                    .eq('is_verified', true)  // 승인된 리뷰만 조회
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false });

                if (reviewsError) {
                    console.error('❌ 리뷰 조회 실패:', reviewsError);
                    return [];
                }

                if (!reviewsData || reviewsData.length === 0) {
                    console.warn('⚠️ 승인된 리뷰 데이터가 없음');
                    return [];
                }

                console.log(`📊 ${reviewsData.length}개 리뷰 조회됨`);

                // 2. 필요한 user_id와 restaurant_id 수집
                const userIds = [...new Set(reviewsData.map(r => r.user_id))];
                const restaurantIds = [...new Set(reviewsData.map(r => r.restaurant_id))];

                console.log('👥 User IDs:', userIds);
                console.log('🏪 Restaurant IDs:', restaurantIds);

                // 3. Profiles 가져오기
                const { data: profilesData } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .in('user_id', userIds);

                // 4. Restaurants 가져오기
                const { data: restaurantsData } = await supabase
                    .from('restaurants')
                    .select('id, name, category')
                    .in('id', restaurantIds);

                console.log('👥 Profiles:', profilesData);
                console.log('🏪 Restaurants:', restaurantsData);

                // 5. Map으로 변환 (빠른 조회)
                const profilesMap = new Map(
                    (profilesData || []).map(p => [p.user_id, p.nickname])
                );
                const restaurantsMap = new Map(
                    (restaurantsData || []).map(r => [r.id, { name: r.name, category: r.category }])
                );

                // 6. 리뷰 데이터 매핑
                const reviews = reviewsData.map(review => {
                    const restaurant = restaurantsMap.get(review.restaurant_id);
                    return {
                        id: review.id,
                        restaurantName: restaurant?.name || '알 수 없음',
                        restaurantCategories: Array.isArray(restaurant?.category)
                            ? restaurant.category
                            : [restaurant?.category || review.categories?.[0] || review.category || '기타'],
                        userName: profilesMap.get(review.user_id) || '탈퇴한 사용자',
                        visitedAt: review.visited_at,
                        submittedAt: review.created_at || '',
                        content: review.content,
                        isVerified: review.is_verified || false,
                        isPinned: review.is_pinned || false,
                        isEditedByAdmin: review.is_edited_by_admin || false,
                        admin_note: review.admin_note || null,
                        photos: review.food_photos ? review.food_photos.map((url: string) => ({ url, type: 'food' })) : [],
                        category: review.categories?.[0] || review.category,
                    };
                }) as Review[];

                console.log(`✅ 총 ${reviews.length}개 리뷰 매핑 완료`);

                return reviews;
            } catch (error) {
                console.error('❌ 리뷰 데이터 조회 중 오류:', error);
                return [];
            }
        },
    });

    // 실제 승인된 리뷰 데이터 사용
    const displayData = reviewsData;
    const isDummyData = false; // 더미 데이터 사용하지 않음

    const filteredReviews = displayData.filter((review) => {
        const matchesSearch =
            review.restaurantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            review.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            review.content.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesCategory =
            filterCategory === "all" || review.category === filterCategory;

        const matchesStatus =
            filterStatus === "all" ||
            (filterStatus === "approved" && review.isVerified) ||
            (filterStatus === "rejected" && !review.isVerified && review.admin_note && review.admin_note.trim() !== '' && review.admin_note.includes('거부')) ||
            (filterStatus === "pending" && !review.isVerified && (!review.admin_note || review.admin_note.trim() === ''));

        return matchesSearch && matchesCategory && matchesStatus;
    });

    const sortedReviews = [...filteredReviews].sort((a, b) => {
        // Pinned reviews first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;

        // Then by submitted date
        return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    });

    const handleWriteReview = () => {
        if (!user) {
            toast({
                title: "로그인이 필요합니다",
                description: "리뷰를 작성하려면 로그인이 필요합니다.",
                variant: "destructive",
            });
            return;
        }
        setSelectedReview(null);
        setIsReviewModalOpen(true);
    };

    const handlePinReview = async (reviewId: string) => {
        if (!isAdmin) {
            toast({
                title: "권한 없음",
                description: "관리자만 사용할 수 있는 기능입니다",
                variant: "destructive",
            });
            return;
        }

        const { error } = await supabase
            .from('reviews')
            .update({ is_pinned: true })
            .eq('id', reviewId);

        if (error) {
            toast({
                title: "고정 실패",
                description: error.message,
                variant: "destructive",
            });
        } else {
            toast({
                title: "리뷰 고정 완료",
                description: "리뷰를 상단에 고정했습니다",
            });
            refetch();
            queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
        }
    };

    const handleUnpinReview = async (reviewId: string) => {
        if (!isAdmin) {
            toast({
                title: "권한 없음",
                description: "관리자만 사용할 수 있는 기능입니다",
                variant: "destructive",
            });
            return;
        }

        const { error } = await supabase
            .from('reviews')
            .update({ is_pinned: false })
            .eq('id', reviewId);

        if (error) {
            toast({
                title: "고정 해제 실패",
                description: error.message,
                variant: "destructive",
            });
        } else {
            toast({
                title: "고정 해제 완료",
                description: "리뷰 고정을 해제했습니다",
            });
            refetch();
            queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
        }
    };

    const handleEditReview = (review: Review) => {
        if (!user) {
            toast({
                title: "로그인 필요",
                description: "로그인이 필요합니다",
                variant: "destructive",
            });
            return;
        }
        if (!isAdmin && review.userName !== user.email) {
            toast({
                title: "권한 없음",
                description: "본인의 리뷰만 수정할 수 있습니다",
                variant: "destructive",
            });
            return;
        }

        // TODO: Implement edit review modal
        toast({
            title: "개발 중",
            description: "리뷰 수정 기능은 개발 중입니다",
        });
    };

    const handleDeleteReview = async (review: Review) => {
        if (!user) {
            toast({
                title: "로그인 필요",
                description: "로그인이 필요합니다",
                variant: "destructive",
            });
            return;
        }
        if (!isAdmin && review.userName !== user.email) {
            toast({
                title: "권한 없음",
                description: "본인의 리뷰만 삭제할 수 있습니다",
                variant: "destructive",
            });
            return;
        }

        if (!confirm("정말로 이 리뷰를 삭제하시겠습니까?")) {
            return;
        }

        const { error } = await supabase
            .from('reviews')
            .delete()
            .eq('id', review.id);

        if (error) {
            toast({
                title: "삭제 실패",
                description: error.message,
                variant: "destructive",
            });
        } else {
            toast({
                title: "삭제 완료",
                description: "리뷰를 삭제했습니다",
            });
            refetch();
            queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
        }
    };

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                                <MessageSquare className="h-6 w-6 text-primary" />
                                쯔양 팬 맛집 리뷰
                            </h1>
                            {isDummyData && (
                                <Badge variant="secondary" className="text-xs">
                                    📊 샘플 데이터
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                            {isLoggedIn
                                ? `총 ${sortedReviews.length}개의 승인된 리뷰`
                                : `총 ${sortedReviews.length}개의 승인된 리뷰 (로그인하여 리뷰를 작성해보세요)`
                            }
                        </p>
                    </div>
                    <Button
                        onClick={handleWriteReview}
                        className={`gap-2 ${isLoggedIn
                            ? "bg-gradient-primary hover:opacity-90"
                            : "bg-muted hover:bg-muted/80 text-muted-foreground"
                            }`}
                        disabled={!isLoggedIn}
                    >
                        <Plus className="h-4 w-4" />
                        {isLoggedIn ? "글쓰기" : "로그인 후 글쓰기"}
                    </Button>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="맛집명, 작성자, 내용 검색..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger>
                            <SelectValue placeholder="카테고리" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체 카테고리</SelectItem>
                            {RESTAURANT_CATEGORIES.map((category) => (
                                <SelectItem key={category} value={category}>
                                    {category}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger>
                            <SelectValue placeholder="리뷰 상태" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="approved">✅ 승인됨</SelectItem>
                            <SelectItem value="rejected">❌ 거부됨</SelectItem>
                            <SelectItem value="pending">⏳ 검토중</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Reviews List */}
            <ScrollArea className="flex-1">
                <div className="p-6 space-y-4">
                    {isLoading ? (
                        // Loading Skeleton
                        Array.from({ length: 3 }).map((_, index) => (
                            <Card key={index} className="p-6">
                                <div className="space-y-4">
                                    {/* Header Skeleton */}
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 space-y-2">
                                            <Skeleton className="h-6 w-48" />
                                            <div className="flex gap-2">
                                                <Skeleton className="h-5 w-16" />
                                                <Skeleton className="h-5 w-20" />
                                            </div>
                                        </div>
                                        <Skeleton className="h-8 w-20" />
                                    </div>

                                    {/* Content Skeleton */}
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-3/4" />
                                    </div>

                                    {/* Footer Skeleton */}
                                    <div className="flex items-center justify-between pt-4 border-t">
                                        <div className="flex items-center gap-4">
                                            <Skeleton className="h-4 w-24" />
                                            <Skeleton className="h-4 w-20" />
                                        </div>
                                        <div className="flex gap-2">
                                            <Skeleton className="h-8 w-16" />
                                            <Skeleton className="h-8 w-16" />
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        ))
                    ) : sortedReviews.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-muted-foreground">검색 결과가 없습니다.</p>
                        </div>
                    ) : (
                        sortedReviews.map((review) => (
                            <Card
                                key={review.id}
                                className={`p-6 hover:shadow-md transition-shadow ${review.isPinned ? "border-primary border-2" : ""
                                    }`}
                            >
                                {/* Header */}
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            {review.isPinned && (
                                                <Pin className="h-4 w-4 text-primary fill-primary" />
                                            )}
                                            <h3 className="text-lg font-bold flex items-center gap-2 flex-wrap">
                                                {review.userName === "관리자" && (
                                                    <Badge variant="default" className="bg-gradient-primary">
                                                        관리자
                                                    </Badge>
                                                )}
                                                <span>{review.restaurantName}</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {review.restaurantCategories.map((category, index) => (
                                                        <Badge key={index} variant="secondary" className="text-xs">
                                                            {category}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </h3>
                                            {review.isVerified ? (
                                                <Badge variant="default" className="gap-1 bg-green-600">
                                                    <CheckCircle className="h-3 w-3" />
                                                    승인됨
                                                </Badge>
                                            ) : review.admin_note ? (
                                                <Badge variant="destructive" className="gap-1">
                                                    <XCircle className="h-3 w-3" />
                                                    거부됨
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    검토중
                                                </Badge>
                                            )}
                                        </div>

                                        {review.isEditedByAdmin && (
                                            <Badge variant="outline" className="mb-2 border-orange-500 text-orange-500">
                                                ⚠️ 관리자가 수정함
                                            </Badge>
                                        )}

                                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-1">
                                                <User className="h-3 w-3" />
                                                <span className="font-medium">{review.userName}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                방문: {formatDateTime(review.visitedAt)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="mb-4">
                                    <p className="text-sm whitespace-pre-wrap">{review.content}</p>
                                </div>

                                {/* 거부 사유 (거부된 리뷰인 경우) */}
                                {review.admin_note && review.admin_note.includes('거부') && (
                                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                        <div className="flex items-center gap-2 mb-2">
                                            <XCircle className="h-4 w-4 text-red-600" />
                                            <span className="text-sm font-medium text-red-700 dark:text-red-300">
                                                거부 사유
                                            </span>
                                        </div>
                                        <p className="text-sm text-red-600 dark:text-red-400">
                                            {review.admin_note.startsWith('거부: ') ? review.admin_note.substring(4) : review.admin_note}
                                        </p>
                                    </div>
                                )}

                                {/* Photos placeholder */}
                                {review.photos.length > 0 && (
                                    <div className="flex gap-2 mb-4">
                                        {review.photos.map((photo, idx) => (
                                            <div
                                                key={idx}
                                                className="w-24 h-24 bg-muted rounded-lg flex items-center justify-center"
                                            >
                                                📷
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Footer */}
                                <div className="flex items-center justify-between pt-4 border-t border-border">
                                    <div className="text-xs text-muted-foreground">
                                        작성: {formatDateTime(review.submittedAt)}
                                    </div>

                                    <div className="flex gap-2">
                                        {(isAdmin || review.userName === user?.email) && (
                                            <>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleEditReview(review)}
                                                >
                                                    수정
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleDeleteReview(review)}
                                                >
                                                    삭제
                                                </Button>
                                            </>
                                        )}
                                        {isAdmin && (
                                            <>
                                                {review.isPinned ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1"
                                                        onClick={() => handleUnpinReview(review.id)}
                                                    >
                                                        <Pin className="h-3 w-3" />
                                                        고정 해제
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1"
                                                        onClick={() => handlePinReview(review.id)}
                                                    >
                                                        <Pin className="h-3 w-3" />
                                                        상단 고정
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            </ScrollArea>

            {/* Review Modal */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={null}
                onSuccess={() => {
                    refetch();
                    queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
                }}
            />
        </div>
    );
};

export default ReviewsPage;

