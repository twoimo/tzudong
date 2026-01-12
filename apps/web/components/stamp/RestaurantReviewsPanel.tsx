import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Trophy, PenSquare, X, Plus, MapPin } from 'lucide-react';
import { Restaurant } from '@/types/restaurant';
import { ReviewCard } from '@/components/reviews/ReviewCard';

interface Review {
    id: string;
    userId: string;
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
    likeCount: number;
    isLikedByUser: boolean;
}

interface RestaurantReviewsPanelProps {
    restaurant: Restaurant | null;
    reviews: Review[];
    selectedReview: Review | null;
    currentPhotoIndex: number;
    cardPhotoIndexes: Record<string, number>;
    onReviewClick: (review: Review) => void;
    onBackFromDetail: () => void;
    onWriteReview: () => void;
    onToggleLike: (reviewId: string, isLiked: boolean) => void;
    onPrevPhoto: () => void;
    onNextPhoto: () => void;
    onPhotoIndexChange: (index: number) => void;
    onCardPhotoChange: (reviewId: string, index: number) => void;
    onClose?: () => void;
    showHeader?: boolean;
    loadMoreRef?: React.RefObject<HTMLDivElement>;
    isLoading?: boolean;
}

const parseCategory = (categoryData: any): string | null => {
    if (Array.isArray(categoryData) && categoryData.length > 0) return categoryData[0];
    if (typeof categoryData === 'string') {
        try {
            const parsed = JSON.parse(categoryData);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
            return categoryData;
        } catch {
            return categoryData;
        }
    }
    return null;
};

export const RestaurantReviewsPanel = React.memo(function RestaurantReviewsPanel({
    restaurant,
    reviews,
    onReviewClick,
    onWriteReview,
    onToggleLike,
    onClose,
    showHeader = true,
    isLoading = false,
}: RestaurantReviewsPanelProps) {
    if (!restaurant) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-4">
                <MapPin className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-center">맛집을 선택하여<br />상세 정보를 확인하세요</p>
            </div>
        );
    }

    const category = parseCategory(restaurant.category || (restaurant as any).categories);

    return (
        <div className="flex flex-col h-full">
            {/* 헤더 */}
            {showHeader && (
                <div className="p-4 md:p-6 border-b border-border bg-card flex-shrink-0">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1.5 overflow-hidden flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="font-bold text-xl md:text-2xl truncate">
                                    {restaurant.name}
                                </h2>
                                {category && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 h-5 font-normal bg-secondary/50 text-secondary-foreground/90">
                                        {category}
                                    </Badge>
                                )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                                {restaurant.road_address || restaurant.jibun_address || "주소 정보 없음"}
                            </p>
                        </div>
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0 -mt-1 -mr-2">
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* 콘텐츠 영역 */}
            <div className="flex-1 p-4 pb-24 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                {/* 리뷰 섹션 헤더 */}
                <div className="flex items-center justify-between gap-2 mb-4">
                    <h3 className="font-semibold flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-primary" />
                        방문자 리뷰 ({reviews.length})
                    </h3>
                    <Button
                        onClick={onWriteReview}
                        size="sm"
                        className="h-8 gap-1.5"
                        variant={reviews.length > 0 ? "outline" : "default"}
                    >
                        <PenSquare className="h-3.5 w-3.5" />
                        리뷰 작성
                    </Button>
                </div>

                {reviews.length > 0 ? (
                    /* 리뷰 목록 */
                    <div className="space-y-4">
                        {reviews.map((review) => (
                            <ReviewCard
                                key={review.id}
                                review={{
                                    ...review,
                                    userAvatarUrl: undefined, // Add if available
                                    visitedAt: review.visitedAt,
                                    submittedAt: review.submittedAt,
                                }}
                                onLike={(reviewId) => onToggleLike(reviewId, review.isLikedByUser)}
                                onClick={() => onReviewClick(review)}
                                onRestaurantClick={() => {
                                    // 이미 "맛집 리뷰" 패널에 있으므로 상점 이름을 클릭했을 때
                                    // 특정 동작(지도 포커스 등)이 필요하지 않을 수 있습니다.
                                    // 현재는 별도 동작 없이 유지하거나 요청 시 추가합니다.
                                }}
                            />
                        ))}
                    </div>
                ) : isLoading ? (
                    /* 로딩 중 스켈레톤 */
                    <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                            <Card key={i} className="p-0 overflow-hidden">
                                <div className="animate-pulse">
                                    <div className="w-full aspect-square bg-muted" />
                                    <div className="p-3 space-y-2">
                                        <div className="h-3 bg-muted rounded w-1/4" />
                                        <div className="h-3 bg-muted rounded w-3/4" />
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                ) : (
                    /* 빈 상태 */
                    <div className="flex flex-col items-center justify-center px-4 text-center" style={{ minHeight: 'calc(100vh - 400px)' }}>
                        <div className="bg-muted/50 rounded-full p-4 mb-4">
                            <PenSquare className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h4 className="font-semibold text-base mb-2">아직 작성된 리뷰가 없습니다</h4>
                        <p className="text-sm text-muted-foreground mb-4">
                            첫 번째 리뷰를 작성하고<br />
                            다른 팬들과 경험을 공유해보세요!
                        </p>
                        <Button onClick={onWriteReview} className="gap-2">
                            <Plus className="h-4 w-4" />
                            첫 리뷰 작성하기
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
});
