import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Trophy, PenSquare, ArrowLeft, Heart, ChevronLeft, ChevronRight, Plus, MapPin, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
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
    selectedReview,
    currentPhotoIndex,
    cardPhotoIndexes,
    onReviewClick,
    onBackFromDetail,
    onWriteReview,
    onToggleLike,
    onPrevPhoto,
    onNextPhoto,
    onPhotoIndexChange,
    onCardPhotoChange,
    onClose,
    showHeader = true,
    loadMoreRef,
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
            <div className="flex-1 p-4 pb-24 overflow-y-auto">
                {/* 리뷰 섹션 헤더 */}
                {!selectedReview && (
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
                )}

                {selectedReview ? (
                    /* 리뷰 상세 뷰 */
                    <div className="space-y-4">
                        {/* 헤더 - 뒤로가기 + 사용자 정보 */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onBackFromDetail}
                                    className="h-7 w-7 shrink-0"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                </Button>
                                <span className="font-medium">{selectedReview.userName}</span>
                                {selectedReview.isVerified && (
                                    <Badge variant="default" className="h-4 px-1 text-[10px] bg-green-600">
                                        인증
                                    </Badge>
                                )}
                                <span className="text-muted-foreground">·</span>
                                <span className="text-muted-foreground text-xs">
                                    {new Date(selectedReview.visitedAt).toLocaleDateString('ko-KR')}
                                </span>
                            </div>
                            <button
                                className="flex items-center gap-1 text-sm"
                                onClick={() => onToggleLike(selectedReview.id, selectedReview.isLikedByUser)}
                            >
                                <Heart
                                    className={`h-4 w-4 ${selectedReview.isLikedByUser
                                        ? 'fill-red-500 text-red-500'
                                        : 'text-muted-foreground'
                                        }`}
                                />
                                <span className="text-muted-foreground text-xs">
                                    {selectedReview.likeCount >= 100 ? '99+' : selectedReview.likeCount}
                                </span>
                            </button>
                        </div>

                        {/* 이미지 캐러셀 */}
                        {selectedReview.photos && selectedReview.photos.length > 0 && (
                            <div className="relative">
                                <div className="relative w-full aspect-square bg-muted rounded-lg overflow-hidden">
                                    <img
                                        src={supabase.storage.from('review-photos').getPublicUrl(selectedReview.photos[currentPhotoIndex].url).data.publicUrl}
                                        alt={`음식 사진 ${currentPhotoIndex + 1}`}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                    />

                                    {/* 화살표 */}
                                    {selectedReview.photos.length > 1 && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 md:h-10 md:w-10 bg-black/40 hover:bg-black/60 text-white rounded-full"
                                                onClick={onPrevPhoto}
                                            >
                                                <ChevronLeft className="h-5 w-5 md:h-6 md:w-6" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 md:h-10 md:w-10 bg-black/40 hover:bg-black/60 text-white rounded-full"
                                                onClick={onNextPhoto}
                                            >
                                                <ChevronRight className="h-5 w-5 md:h-6 md:w-6" />
                                            </Button>
                                        </>
                                    )}

                                    {/* 사진 카운터 */}
                                    {selectedReview.photos.length > 1 && (
                                        <div className="absolute top-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                                            {currentPhotoIndex + 1} / {selectedReview.photos.length}
                                        </div>
                                    )}

                                    {/* 점 인디케이터 */}
                                    {selectedReview.photos.length > 1 && (
                                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                                            {selectedReview.photos.map((_, index) => (
                                                <button
                                                    key={index}
                                                    className={`w-2 h-2 rounded-full transition-colors ${index === currentPhotoIndex
                                                        ? 'bg-white'
                                                        : 'bg-white/40'
                                                        }`}
                                                    onClick={() => onPhotoIndexChange(index)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 리뷰 내용 */}
                        <div>
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                {selectedReview.content}
                            </p>
                        </div>
                    </div>
                ) : reviews.length > 0 ? (
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
                                    // This is already in a "Restaurant Reviews" panel, so clicking restaurant name 
                                    // might not need to do anything, or maybe close and focus map? 
                                    // For now, let's leave it as a no-op or specific action if requested.
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
