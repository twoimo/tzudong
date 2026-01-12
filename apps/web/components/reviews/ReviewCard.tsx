import React, { useState, useEffect, useCallback } from 'react';
import { User, MapPin, Heart, Calendar, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { supabase } from '@/integrations/supabase/client';

export interface ReviewCardProps {
    review: {
        id: string;
        userId: string;
        userName: string;
        userAvatarUrl?: string; // 선택적 속성
        restaurantName: string;
        content: string;
        photos: { url: string; type: string }[];
        visitedAt: string;
        submittedAt: string;
        likeCount: number;
        isLikedByUser: boolean;
        isPinned?: boolean; // 고정된 리뷰 여부
        isEditedByAdmin?: boolean; // 관리자 수정 여부
        isVerified?: boolean;
    };
    onLike: (reviewId: string) => void;
    onClick?: () => void;
    onRestaurantClick?: () => void; // 맛집 이름/핀 버튼 클릭 시
}

import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";

export const ReviewCard = React.memo(function ReviewCard({
    review,
    onLike,
    onClick,
    onRestaurantClick
}: ReviewCardProps) {
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);
    const [api, setApi] = useState<CarouselApi>();

    useEffect(() => {
        if (!api) {
            return;
        }

        api.on("select", () => {
            setCurrentPhotoIndex(api.selectedScrollSnap());
        });
    }, [api]);

    const handleLike = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onLike(review.id);
    }, [onLike, review.id]);

    const handleRestaurantClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onRestaurantClick?.();
    }, [onRestaurantClick]);

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        return {
            date: date.toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            }),
            full: date.toLocaleString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            })
        };
    };

    const visitedDate = formatDateTime(review.visitedAt);
    const submittedDate = formatDateTime(review.submittedAt);
    const MAX_LENGTH = 100;
    const shouldTruncate = review.content.length > MAX_LENGTH;

    return (
        <div
            className={`w-full rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden mb-4 max-w-full ${review.isPinned ? "border-primary border-2" : ""}`}
            onClick={onClick}
        >
            {/* 헤더 영역 */}
            <div className="flex items-center justify-between p-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                        {review.userAvatarUrl ? (
                            <Image
                                src={review.userAvatarUrl}
                                alt={review.userName}
                                width={32}
                                height={32}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <User className="w-4 h-4 text-primary" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold">{review.userName}</p>
                            {review.isVerified && (
                                <Badge variant="default" className="h-4 px-1 text-[10px] bg-green-600">
                                    <CheckCircle className="h-2 w-2 mr-0.5" />
                                    인증
                                </Badge>
                            )}
                        </div>
                        <button
                            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                            onClick={handleRestaurantClick}
                        >
                            <MapPin className="w-3 h-3" />
                            {review.restaurantName}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* 선택사항: '맛집 보기' 핀 버튼 - 위에서 이름 클릭으로 대체 가능하지만, 디자인 일관성을 위해 유지 */}
                    <button
                        className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent h-8 w-8 text-muted-foreground hover:text-primary"
                        title="맛집 보기"
                        onClick={handleRestaurantClick}
                    >
                        <MapPin className="h-4 w-4" />
                    </button>
                    <button
                        className="flex items-center gap-1 group"
                        onClick={handleLike}
                    >
                        <Heart
                            className={`w-5 h-5 transition-all ${review.isLikedByUser ? 'fill-red-500 text-red-500 scale-110' : 'text-muted-foreground group-hover:text-red-500'}`}
                        />
                        <span className={`text-xs font-medium ${review.isLikedByUser ? 'text-red-500' : 'text-muted-foreground'}`}>
                            {review.likeCount}
                        </span>
                    </button>
                </div>
            </div>

            {/* 사진 영역 */}
            {review.photos && review.photos.length > 0 && (
                <div className="relative w-full aspect-square bg-muted select-none overflow-hidden group">
                    <Carousel setApi={setApi} className="w-full h-full">
                        <CarouselContent>
                            {review.photos.map((photo, index) => (
                                <CarouselItem key={index}>
                                    <div className="relative w-full aspect-square">
                                        <img
                                            src={supabase.storage.from('review-photos').getPublicUrl(photo.url).data.publicUrl}
                                            alt={`리뷰 사진 ${index + 1}`}
                                            className="w-full h-full object-cover pointer-events-none"
                                            draggable="false"
                                        />
                                    </div>
                                </CarouselItem>
                            ))}
                        </CarouselContent>
                    </Carousel>

                    {/* 인디케이터 */}
                    {review.photos.length > 1 && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                            {review.photos.map((_, index) => (
                                <div
                                    key={index}
                                    className={`h-1.5 rounded-full transition-all ${index === currentPhotoIndex ? 'bg-white w-3' : 'bg-white/50 w-1.5'}`}
                                ></div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 내용 영역 */}
            <div className="p-3 space-y-2">
                <div>
                    {review.isEditedByAdmin && (
                        <Badge variant="outline" className="mb-2 border-orange-500 text-orange-500 text-xs">
                            ⚠️ 관리자가 수정함
                        </Badge>
                    )}
                    <div className="flex items-baseline gap-1">
                        <p className={`text-sm leading-relaxed ${!isExpanded && shouldTruncate ? 'truncate' : ''} flex-1`}>
                            {review.content}
                        </p>
                        {!isExpanded && shouldTruncate && (
                            <button
                                className="text-xs text-muted-foreground hover:text-primary shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsExpanded(true);
                                }}
                            >
                                더보기
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        방문: {visitedDate.date}
                    </span>
                    <span>작성: {submittedDate.date}</span>
                </div>
            </div>
        </div>
    );
});
