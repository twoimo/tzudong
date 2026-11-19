import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { User, Heart, CheckCircle, Edit, Share2, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BookmarkButton } from '@/components/ui/bookmark-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { resolveReviewPhotoUrl } from '@/lib/review-photo-url';
import { resolveProfileAvatarUrl } from '@/lib/profile-avatar-url';
import { cn } from '@/lib/utils';

export interface ReviewCardProps {
    review: {
        id: string;
        userId: string;
        userName: string;
        userAvatarUrl?: string | null; // 공개 프로필 summary에서 제공한 참조만 사용
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
    onLike: (reviewId: string, currentIsLiked: boolean, currentCount: number) => void | Promise<void>;
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

const LIKED_HEART_COLOR = '#ef4444';

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
    const photoItemKeyPrefix = idPrefix ?? review.id;
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isShareCopied, setIsShareCopied] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [shareFailed, setShareFailed] = useState(false);
    const [api, setApi] = useState<CarouselApi>();
    const [optimisticLike, setOptimisticLike] = useState({
        isLiked: review.isLikedByUser,
        count: review.likeCount,
    });

    // [PERFORMANCE] 이미지 URL 미리 생성 - 매 렌더링마다 재계산 방지
    const photoUrls = useMemo(() => {
        const ownership = {
            ownerId: review.userId,
            reviewId: review.id,
            purpose: 'food' as const,
        };

        const urls: string[] = [];
        const seen = new Set<string>();
        for (const photo of review.photos) {
            const url = resolveReviewPhotoUrl(photo.url, ownership);
            if (!url || seen.has(url)) continue;
            seen.add(url);
            urls.push(url);
        }
        return urls;
    }, [review.id, review.photos, review.userId]);
    const profileAvatarUrl = useMemo(
        () => resolveProfileAvatarUrl(review.userAvatarUrl, review.userId),
        [review.userAvatarUrl, review.userId],
    );
    const avatarName = review.userName.trim() || '사용자';
    const avatarInitial = Array.from(review.userName.trim())[0];

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

    const pendingLikeRef = useRef<{ reviewId: string; isLiked: boolean; count: number } | null>(null);
    const previousReviewIdRef = useRef(review.id);

    useEffect(() => {
        if (previousReviewIdRef.current !== review.id) {
            previousReviewIdRef.current = review.id;
            pendingLikeRef.current = null;
            setOptimisticLike({
                isLiked: review.isLikedByUser,
                count: review.likeCount,
            });
            return;
        }

        const pendingLike = pendingLikeRef.current;

        if (pendingLike?.reviewId === review.id) {
            if (review.isLikedByUser === pendingLike.isLiked) {
                pendingLikeRef.current = null;
                setOptimisticLike({
                    isLiked: review.isLikedByUser,
                    count: review.likeCount,
                });
            }
            return;
        }

        setOptimisticLike({
            isLiked: review.isLikedByUser,
            count: review.likeCount,
        });
    }, [review.id, review.isLikedByUser, review.likeCount]);

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

        const previousLike = optimisticLike;
        const nextIsLiked = !optimisticLike.isLiked;
        const nextCount = Math.max(0, optimisticLike.count + (nextIsLiked ? 1 : -1));

        const nextLike = {
            isLiked: nextIsLiked,
            count: nextCount,
        };

        pendingLikeRef.current = {
            reviewId: review.id,
            ...nextLike,
        };

        setOptimisticLike(nextLike);

        try {
            const result = onLike(review.id, optimisticLike.isLiked, optimisticLike.count);
            if (result && typeof (result as Promise<void>).catch === 'function') {
                (result as Promise<void>).catch(() => {
                    pendingLikeRef.current = null;
                    setOptimisticLike(previousLike);
                });
            }
        } catch {
            pendingLikeRef.current = null;
            setOptimisticLike(previousLike);
        }
    }, [onLike, optimisticLike, review.id]);

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
        if (isSharing) return;
        setIsSharing(true);
        setIsShareCopied(false);
        setShareFailed(false);

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

            setIsShareCopied(true);
            setTimeout(() => setIsShareCopied(false), 2000);
        } catch {
            setShareFailed(true);
            setIsShareCopied(false);
        } finally {
            setIsSharing(false);
        }
    }, [isSharing, review.id, review.restaurantId, review.restaurantName]);

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
    const cardInteractionProps = onClick
        ? {
            role: 'button' as const,
            tabIndex: 0,
            onClick,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick();
                }
            },
        }
        : {};

    return (
        <div
            data-slot="card"
            id={idPrefix ? `${idPrefix}-${review.id}` : undefined}
            className={`w-full rounded-xl border bg-card text-card-foreground overflow-hidden max-w-full
                ${review.isPinned ? "border-primary/50" : "border-border"}
                ${isHighlighted ? "ring-2 ring-primary ring-offset-2" : ""}
            `}
            {...cardInteractionProps}
        >
            <div className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Avatar className="h-8 w-8 shrink-0 bg-muted">
                    {profileAvatarUrl && (
                        <AvatarImage
                            src={profileAvatarUrl}
                            alt={`${avatarName} 프로필 사진`}
                            className="object-cover"
                        />
                    )}
                    <AvatarFallback
                        className="bg-muted text-foreground text-sm font-semibold"
                        role="img"
                        aria-label={`${avatarName} 프로필 사진 대체 표시`}
                    >
                        {avatarInitial ? (
                            <span aria-hidden="true">{avatarInitial}</span>
                        ) : (
                            <User className="w-4 h-4" aria-hidden="true" />
                        )}
                    </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1">
                        <Link
                            href={`/user/${review.userId}`}
                            className="truncate text-sm font-semibold leading-5 text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-foreground" aria-label="인증" />
                        )}
                    </div>
                    <button
                        type="button"
                        className="block w-full truncate text-left text-xs leading-4 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={handleRestaurantClick}
                        aria-label={`${review.restaurantName} 맛집 상세 보기`}
                    >
                        {review.restaurantName}
                    </button>
                </div>
                </div>
                <div className="flex shrink-0 items-center">
                    <button
                        className={cn(
                            "group flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-muted-foreground transition-colors touch-manipulation hover:text-red-500 active:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            optimisticLike.isLiked && "text-red-500"
                        )}
                        type="button"
                        onClick={handleLike}
                        title={`좋아요 ${optimisticLike.count}개`}
                        aria-label={`좋아요 ${optimisticLike.count}개${optimisticLike.isLiked ? ' 취소' : ' 누르기'}`}
                        aria-pressed={optimisticLike.isLiked}
                        data-liked={optimisticLike.isLiked}
                    >
                        <Heart
                            color={optimisticLike.isLiked ? LIKED_HEART_COLOR : undefined}
                            fill={optimisticLike.isLiked ? LIKED_HEART_COLOR : "none"}
                            stroke={optimisticLike.isLiked ? LIKED_HEART_COLOR : "currentColor"}
                            className={cn(
                                "h-5 w-5 group-active:fill-red-500 group-active:text-red-500 group-active:[&_path]:fill-red-500 group-active:[&_path]:stroke-red-500",
                                optimisticLike.isLiked
                                    ? "fill-red-500 text-red-500 [&_path]:fill-red-500 [&_path]:stroke-red-500"
                                    : "text-muted-foreground group-hover:text-red-500 group-hover:[&_path]:stroke-red-500"
                            )}
                        />
                        <span
                            className={cn(
                                "text-xs font-medium tabular-nums transition-colors group-active:text-red-500",
                                optimisticLike.isLiked ? "text-red-500" : "text-muted-foreground group-hover:text-red-500"
                            )}
                        >
                            {optimisticLike.count > 999 ? '999+' : optimisticLike.count}
                        </span>
                    </button>
                    {review.restaurantId && (
                        <BookmarkButton
                            restaurantId={review.restaurantId}
                            showCount={false}
                            className="h-11 w-11 shrink-0 rounded-lg border-0 shadow-none"
                        />
                    )}
                    <button
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${isShareCopied ? 'text-green-600' : 'text-muted-foreground hover:text-primary'}`}
                        type="button"
                        disabled={isSharing}
                        aria-busy={isSharing}
                        title={isShareCopied ? "복사됨" : "리뷰 공유"}
                        aria-label={isSharing ? "리뷰 링크 복사 중" : isShareCopied ? "리뷰 링크 복사됨" : "리뷰 공유"}
                        onClick={handleShareClick}
                    >
                        {isShareCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                    </button>
                    {isOwnReview && onEditReview && (
                        <button
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            type="button"
                            title="리뷰 수정"
                            aria-label="리뷰 수정"
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
                </div>
            </div>
            {shareFailed && <p role="alert" className="px-3 text-sm text-destructive">리뷰 링크를 복사하지 못했습니다. 공유 버튼을 눌러 다시 시도해주세요.</p>}
            <span role="status" aria-live="polite" className="sr-only">{isShareCopied ? '리뷰 링크를 복사했습니다' : ''}</span>

            {/* 사진 영역 */}
            {
                photoUrls.length > 0 && (
                    <div className="relative w-full aspect-square bg-muted select-none overflow-hidden group">
                        <Carousel setApi={setApi} className="w-full h-full" opts={{ loop: photoUrls.length > 1 }}>
                            <CarouselContent>
                                {photoUrls.map((url, index) => (
                                    <CarouselItem key={`${photoItemKeyPrefix}-photo-${index}`}>
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
                            {photoUrls.length > 1 && (
                                <>
                                    <CarouselOverlayPrevious />
                                    <CarouselOverlayNext />
                                </>
                            )}
                        </Carousel>

                        {/* 인디케이터 */}
                        {photoUrls.length > 1 && (
                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                                {photoUrls.map((url, index) => (
                                    <div
                                        key={`${photoItemKeyPrefix}-dot-${index}`}
                                        className={`h-1.5 rounded-full ${index === currentPhotoIndex ? 'bg-white w-3' : 'bg-white/50 w-1.5'}`}
                                    ></div>
                                ))}
                            </div>
                        )}
                    </div>
                )
            }

            <div className="space-y-1 px-3 pb-3 pt-2">
                {review.isEditedByAdmin && (
                    <Badge variant="outline" className="border-border text-xs text-muted-foreground">
                        관리자가 수정함
                    </Badge>
                )}
                <p className={`text-sm leading-5 ${!isExpanded && shouldTruncate ? 'line-clamp-2' : ''}`}>
                    <Link
                        href={`/user/${review.userId}`}
                        className="mr-1 font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    {review.content}
                </p>
                {!isExpanded && shouldTruncate && (
                    <button
                        type="button"
                        className="text-sm leading-5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={isExpanded}
                        aria-label="리뷰 내용 더보기"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(true);
                        }}
                    >
                        더보기
                    </button>
                )}
                <p className="text-xs leading-4 text-muted-foreground">방문 {visitedDate} · 작성 {submittedDate}</p>
            </div>
        </div >
    );
});
