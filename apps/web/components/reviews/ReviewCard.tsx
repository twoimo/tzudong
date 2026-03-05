import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { User, MapPin, Heart, Calendar, CheckCircle, Edit, Share2, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';

export interface ReviewCardProps {
    review: {
        id: string;
        userId: string;
        userName: string;
        userAvatarUrl?: string; // 선택적 속성
        restaurantId?: string; // optional for share URL
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
        categories?: string[];
    };
    onLike: (reviewId: string) => void;
    onClick?: () => void;
    onRestaurantClick?: () => void;
    currentUserId?: string;
    onEditReview?: (review: {
        id: string;
        restaurantId: string;
        restaurantName: string;
        content: string;
        categories: string[];
        foodPhotos: string[];
        isVerified: boolean;
        adminNote: string | null;
    }) => void;
    idPrefix?: string;
    isHighlighted?: boolean;
    onUserClick?: (userId: string) => void;
}

import { Carousel, CarouselContent, CarouselItem, CarouselOverlayPrevious, CarouselOverlayNext, type CarouselApi } from "@/components/ui/carousel";

export const ReviewCard = React.memo(function ReviewCard({
    review,
    onLike,
    onClick,
    onRestaurantClick,
    currentUserId,
    onEditReview,
    idPrefix,
    isHighlighted,
    onUserClick
}: ReviewCardProps) {
    const router = useRouter();
    const isOwnReview = currentUserId && review.userId === currentUserId;
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isShareCopied, setIsShareCopied] = useState(false);
    const [api, setApi] = useState<CarouselApi>();

    // [PERFORMANCE] 이미지 URL 미리 생성 - 매 렌더링마다 재계산 방지
    const photoUrls = useMemo(() => {
        return review.photos.map(photo =>
            supabase.storage.from('review-photos').getPublicUrl(photo.url).data.publicUrl
        );
    }, [review.photos]);

    // [PERFORMANCE] 인접 이미지 프리로드 (±1 인덱스)
    useEffect(() => {
        if (photoUrls.length <= 1) return;

        const preloadIndexes = [
            (currentPhotoIndex + 1) % photoUrls.length,
            (currentPhotoIndex - 1 + photoUrls.length) % photoUrls.length,
        ];

        preloadIndexes.forEach(idx => {
            if (idx !== currentPhotoIndex) {
                const img = new window.Image();
                img.src = photoUrls[idx];
            }
        });
    }, [currentPhotoIndex, photoUrls]);

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

    // 맛집 클릭 핸들러 (지도에서 맛집 선택)
    const handleRestaurantClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();

        if (onRestaurantClick) {
            onRestaurantClick();
            return;
        }

        // 홈 페이지로 이동하여 지도에서 맛집 선택
        if (review.restaurantId) {
            router.push(`/?restaurant=${review.restaurantId}`);
        }
    }, [router, review.restaurantId, onRestaurantClick]);

    // 공유 클릭 핸들러 (리뷰 개별 링크 - 단축 URL 사용)
    const handleShareClick = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsShareCopied(true); // 로딩 표시

        // 리뷰 개별 링크 생성 (홈 페이지 기반 - 디바이스 감지 후 처리)
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
        const targetUrl = `${siteUrl}/?review=${review.id}`;

        try {
            const response = await fetch('/api/shorten', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl,
                    restaurantId: review.restaurantId,
                    restaurantName: review.restaurantName,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                await navigator.clipboard.writeText(data.shortUrl);
            } else {
                await navigator.clipboard.writeText(targetUrl);
            }

            setTimeout(() => setIsShareCopied(false), 2000);
        } catch {
            console.error('URL 복사 실패');
            setIsShareCopied(false);
        }
    }, [review.id, review.restaurantId, review.restaurantName]);

    // [PERFORMANCE] 날짜 포맷 메모이제이션
    const { visitedDate, submittedDate } = useMemo(() => {
        const formatDate = (dateString: string) => {
            const date = new Date(dateString);
            return date.toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
        };
        return {
            visitedDate: formatDate(review.visitedAt),
            submittedDate: formatDate(review.submittedAt),
        };
    }, [review.visitedAt, review.submittedAt]);

    const MAX_LENGTH = 100;
    const shouldTruncate = review.content.length > MAX_LENGTH;

    return (
        <div
            id={idPrefix ? `${idPrefix}-${review.id}` : undefined}
            className={`w-full rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden mb-4 max-w-full transition-all duration-500 
                ${review.isPinned ? "border-primary border-2" : ""}
                ${isHighlighted ? "ring-2 ring-primary ring-offset-2" : ""}
            `}
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
                            <Link
                                href={`/user/${review.userId}`}
                                className="text-sm font-semibold hover:text-primary hover:underline transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onUserClick) {
                                        e.preventDefault();
                                        onUserClick(review.userId);
                                    }
                                }}
                            >
                                {review.userName}
                            </Link>
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
                    {/* 공유 버튼 - 모든 사용자에게 표시 */}
                    <button
                        className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent h-8 w-8 ${isShareCopied ? 'text-green-600' : 'text-muted-foreground hover:text-primary'}`}
                        title={isShareCopied ? "복사됨!" : "리뷰 공유"}
                        onClick={handleShareClick}
                    >
                        {isShareCopied ? (
                            <Check className="h-4 w-4" />
                        ) : (
                            <Share2 className="h-4 w-4" />
                        )}
                    </button>
                    {/* 본인 리뷰: 수정 버튼 */}
                    {isOwnReview && onEditReview && (
                        <button
                            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent h-8 w-8 text-muted-foreground hover:text-primary"
                            title="리뷰 수정"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditReview({
                                    id: review.id,
                                    restaurantId: '',
                                    restaurantName: review.restaurantName,
                                    content: review.content,
                                    categories: review.categories || [],
                                    foodPhotos: review.photos.map(p => p.url),
                                    isVerified: review.isVerified || false,
                                    adminNote: null,
                                });
                            }}
                        >
                            <Edit className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        className="relative flex items-center justify-center group"
                        onClick={handleLike}
                        title={`좋아요 ${review.likeCount}개`}
                    >
                        <Heart
                            className={`w-6 h-6 transition-all ${review.isLikedByUser ? 'fill-red-500 text-red-500 scale-110' : 'text-muted-foreground group-hover:text-red-500'}`}
                        />
                        {review.likeCount > 0 && (
                            <span className={`absolute inset-0 flex items-center justify-center text-[9px] font-bold pointer-events-none ${review.isLikedByUser ? 'text-white' : 'text-muted-foreground'}`}>
                                {review.likeCount > 999 ? '999+' : review.likeCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* 사진 영역 */}
            {
                review.photos && review.photos.length > 0 && (
                    <div className="relative w-full aspect-square bg-muted select-none overflow-hidden group">
                        <Carousel setApi={setApi} className="w-full h-full" opts={{ loop: true }}>
                            <CarouselContent>
                                {photoUrls.map((url, index) => (
                                    <CarouselItem key={index}>
                                        <div className="relative w-full aspect-square">
                                            <Image
                                                src={url}
                                                alt={`리뷰 사진 ${index + 1}`}
                                                fill
                                                sizes="(max-width: 768px) 100vw, 768px"
                                                className="object-cover pointer-events-none"
                                                draggable={false}
                                                priority={index === 0}
                                            />
                                        </div>
                                    </CarouselItem>
                                ))}
                            </CarouselContent>
                            {/* Instagram-style overlay navigation buttons */}
                            {review.photos.length > 1 && (
                                <>
                                    <CarouselOverlayPrevious />
                                    <CarouselOverlayNext />
                                </>
                            )}
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
                )
            }

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
                        방문: {visitedDate}
                    </span>
                    <span>작성: {submittedDate}</span>
                </div>
            </div>
        </div >
    );
});
