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
import { Search, Plus, Pin, CheckCircle, Clock, MapPin, Calendar, MessageSquare, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Review {
    id: string;
    restaurantName: string;
    restaurantCategory: string;
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

// 더미 리뷰 데이터
const DUMMY_REVIEWS: Review[] = [
    {
        id: "dummy-review-1",
        restaurantName: "홍대 떡볶이 (샘플)",
        restaurantCategory: "분식",
        userName: "쯔양팬123",
        visitedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        content: "정말 맛있었어요! 쯔양이 추천한 그 메뉴 먹었는데 양도 많고 맛도 좋았습니다! 떡볶이 소스가 진짜 특별하고, 튀김도 바삭바삭해요. 다음에 또 방문하고 싶어요!",
        isVerified: true,
        isPinned: true,
        isEditedByAdmin: false,
        admin_note: null,
        photos: [],
        category: "분식",
    },
    {
        id: "dummy-review-2",
        restaurantName: "강남 삼겹살 (샘플)",
        restaurantCategory: "고기",
        userName: "맛집러버",
        visitedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        submittedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        content: "고기 질이 정말 좋았어요! 1인분 양이 다른 곳보다 훨씬 많고, 직원분들도 친절하세요. 쯔양이 방문했다는 사인도 벽에 걸려있더라고요.",
        isVerified: true,
        isPinned: false,
        isEditedByAdmin: false,
        admin_note: null,
        photos: [],
        category: "고기",
    },
    {
        id: "dummy-review-3",
        restaurantName: "종로 찜닭 (샘플)",
        restaurantCategory: "찜·탕",
        userName: "먹방마니아",
        visitedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        submittedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        content: "찜닭이 정말 커요! 2인분 시켰는데 3-4명이 먹어도 될 양이었어요. 당면도 쫄깃하고 양념이 달지 않고 딱 좋았습니다.",
        isVerified: true,
        isPinned: false,
        isEditedByAdmin: false,
        admin_note: null,
        photos: [],
        category: "찜·탕",
    },
    {
        id: "dummy-review-4",
        restaurantName: "명동 칼국수 (샘플)",
        restaurantCategory: "한식",
        userName: "칼국수조아",
        visitedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        submittedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        content: "국물이 진하고 시원해요. 면발도 쫄깃하고 좋았습니다. 칼제비도 같이 주문했는데 정말 맛있었어요!",
        isVerified: false,
        isPinned: false,
        isEditedByAdmin: false,
        admin_note: "거부: 영수증에 닉네임이 제대로 표시되지 않음. 재제출 요청 필요.",
        photos: [],
        category: "한식",
    },
    {
        id: "dummy-review-5",
        restaurantName: "신촌 치킨 (샘플)",
        restaurantCategory: "치킨",
        userName: "야식킹",
        visitedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        submittedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        content: "24시간 영업해서 야식으로 딱이에요! 튀김옷이 바삭하고 양념도 맛있어요. 배달도 빨라요.",
        isVerified: false,
        isPinned: false,
        isEditedByAdmin: false,
        admin_note: null,
        photos: [],
        category: "치킨",
    },
];

const ReviewsPage = () => {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [filterCategory, setFilterCategory] = useState<string>("all");
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);

    // Fetch reviews from Supabase
    const { data: reviewsData = [], isLoading, refetch } = useQuery({
        queryKey: ['reviews', filterCategory, filterStatus],
        queryFn: async () => {
            try {
                console.log('🔍 리뷰 데이터 가져오는 중...');

                // 1. 리뷰 데이터 가져오기 (모든 리뷰 조회 - 사용자가 작성한 것만)
                const { data: reviewsData, error: reviewsError } = await supabase
                    .from('reviews')
                    .select('*')
                    .eq('user_id', user.id)  // 현재 사용자가 작성한 리뷰만 조회
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false });

                if (reviewsError) {
                    console.error('❌ 리뷰 조회 실패:', reviewsError);
                    return DUMMY_REVIEWS;
                }

                if (!reviewsData || reviewsData.length === 0) {
                    console.warn('⚠️ 리뷰 데이터가 없음');
                    return DUMMY_REVIEWS;
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
                        restaurantCategory: restaurant?.category || review.category,
                        userName: profilesMap.get(review.user_id) || '익명',
                        visitedAt: review.visited_at,
                        submittedAt: review.created_at || '',
                        content: review.content,
                        isVerified: review.is_verified || false,
                        isPinned: review.is_pinned || false,
                        isEditedByAdmin: review.is_edited_by_admin || false,
                        admin_note: review.admin_note || null,
                        photos: review.food_photos ? review.food_photos.map((url: string) => ({ url, type: 'food' })) : [],
                        category: review.category,
                    };
                }) as Review[];

                console.log(`✅ 총 ${reviews.length}개 리뷰 매핑 완료`);

                return reviews;
            } catch (error) {
                console.error('❌ 리뷰 데이터 조회 중 오류:', error);
                return DUMMY_REVIEWS;
            }
        },
    });

    const isDummyData = reviewsData.length > 0 && reviewsData[0].id.startsWith('dummy-');

    const filteredReviews = reviewsData.filter((review) => {
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
            alert("로그인이 필요합니다");
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
                            총 {sortedReviews.length}개의 리뷰
                        </p>
                    </div>
                    <Button
                        onClick={handleWriteReview}
                        className="bg-gradient-primary hover:opacity-90 gap-2"
                    >
                        <Plus className="h-4 w-4" />
                        글쓰기
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
                            <SelectItem value="치킨">치킨</SelectItem>
                            <SelectItem value="중식">중식</SelectItem>
                            <SelectItem value="분식">분식</SelectItem>
                            <SelectItem value="한식">한식</SelectItem>
                            <SelectItem value="양식">양식</SelectItem>
                            <SelectItem value="카페·디저트">카페·디저트</SelectItem>
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
                    {sortedReviews.length === 0 ? (
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
                                            <h3 className="text-lg font-bold flex items-center gap-2">
                                                {review.userName === "관리자" && (
                                                    <Badge variant="default" className="bg-gradient-primary">
                                                        관리자
                                                    </Badge>
                                                )}
                                                <span>{review.userName}</span>
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
                                                <MapPin className="h-3 w-3" />
                                                <span className="font-medium">{review.restaurantName}</span>
                                            </div>
                                            <Badge variant="outline">{review.restaurantCategory}</Badge>
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

