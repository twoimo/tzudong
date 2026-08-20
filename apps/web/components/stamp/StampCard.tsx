'use client';

import { memo, useMemo, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { MapPin, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { RESTAURANT_CATEGORIES } from '@/constants/categories';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { parseCategory, getYouTubeFallbackThumbnailUrl, getYouTubeThumbnailUrl } from './stamp-utils';
import { getRestaurantDisplayName } from '@/lib/restaurant-display-name';

type StampCardRestaurant = Restaurant & {
    verified_review_count?: number | null;
};

const readYoutubeMetaTitle = (meta: unknown): string => {
    if (!meta || typeof meta !== 'object') return '';
    const title = (meta as { title?: unknown }).title;
    return typeof title === 'string' ? title : '';
};

const inferRestaurantCategory = (restaurant: StampCardRestaurant): string | null => {
    const directCategory = parseCategory(restaurant.category ?? restaurant.categories);
    if (directCategory) return directCategory;

    const searchableText = [
        restaurant.reasoning_basis,
        restaurant.tzuyang_review,
        readYoutubeMetaTitle(restaurant.youtube_meta),
        ...(restaurant.mergedYoutubeMetas ?? []).map(readYoutubeMetaTitle),
    ]
        .filter((value): value is string => Boolean(value))
        .join(' ');

    if (!searchableText) return null;

    return (
        RESTAURANT_CATEGORIES.find((category) =>
            searchableText.includes(category),
        ) ?? null
    );
};

export interface StampCardProps {
    restaurant: Restaurant;
    isVisited: boolean;
    isUserStampsReady: boolean;
    isSelected?: boolean;
    currentThumbnailIndex: number;
    onThumbnailChange: (id: string, index: number) => void;
    onClick: (restaurant: Restaurant) => void;
    /** 카드 크기 variant */
    size?: 'default' | 'compact';
    /** 방문 완료 도장 이미지 크기 variant */
    stampSize?: 'default' | 'compact' | 'mobile';
    /** 카드 내부 여백/썸네일 밀도 */
    density?: 'normal' | 'dense';
    /** 카드 레이아웃 variant */
    layout?: 'card' | 'list';
    guideLabel?: string;
    guideTitle?: string;
    guideDescription?: string;
    onGuideClose?: () => void;
    isGuideCard?: boolean;
    showAddress?: boolean;
    categoryFallback?: string;
}

/**
 * 도장 카드 컴포넌트
 * - stamp/page.tsx와 StampOverlay.tsx에서 공유
 */
export const StampCard = memo(function StampCard({
    restaurant,
    isVisited,
    isUserStampsReady,
    isSelected,
    currentThumbnailIndex,
    onThumbnailChange,
    onClick,
    size = 'default',
    stampSize,
    density = 'normal',
    layout = 'card',
    guideLabel,
    guideTitle,
    guideDescription,
    onGuideClose,
    isGuideCard = false,
    showAddress = false,
    categoryFallback,
}: StampCardProps) {
    const typedRestaurant = restaurant as StampCardRestaurant;
    const restaurantDisplayName = getRestaurantDisplayName(typedRestaurant);
    const showStamp = isUserStampsReady && isVisited;
    const youtubeLinks = typedRestaurant.mergedYoutubeLinks ?? (typedRestaurant.youtube_link ? [typedRestaurant.youtube_link] : []);
    const currentIndex = currentThumbnailIndex % (youtubeLinks.length || 1);
    const currentYoutubeLink = youtubeLinks[currentIndex];
    const thumbnailUrl = currentYoutubeLink ? getYouTubeThumbnailUrl(currentYoutubeLink) : null;
    const fallbackThumbnailUrl = currentYoutubeLink ? getYouTubeFallbackThumbnailUrl(currentYoutubeLink) : null;
    const category = useMemo(
        () => inferRestaurantCategory(typedRestaurant) ?? categoryFallback ?? null,
        [categoryFallback, typedRestaurant],
    );
    const reviewCount = typedRestaurant.verified_review_count ?? typedRestaurant.review_count ?? 0;
    const displayAddress = typedRestaurant.road_address || typedRestaurant.jibun_address || typedRestaurant.english_address || typedRestaurant.address || '';

    const handlePrevThumbnail = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newIndex = currentIndex === 0 ? youtubeLinks.length - 1 : currentIndex - 1;
        onThumbnailChange(restaurant.id, newIndex);
    };

    const handleNextThumbnail = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newIndex = currentIndex === youtubeLinks.length - 1 ? 0 : currentIndex + 1;
        onThumbnailChange(restaurant.id, newIndex);
    };

    const isCompact = size === 'compact';
    const isDense = density === 'dense';
    const isList = layout === 'list';
    const resolvedStampSize = stampSize ?? size;
    const isStampCompact = resolvedStampSize === 'compact';
    const isStampMobile = resolvedStampSize === 'mobile';
    const stampSizeClass = isStampMobile
        ? "w-auto"
        : isStampCompact
            ? "w-36 h-36 md:w-40 md:h-40"
            : "w-48 h-48 sm:w-56 sm:h-56";
    const stampImageStyle = isStampMobile
        ? {
            transform: 'translateY(0.375rem) rotate(-45deg)',
            height: '74%',
            maxHeight: '9rem',
            maxWidth: '44%',
        }
        : { transform: 'rotate(-45deg)' };

    const handleGuideClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        onGuideClose?.();
    };

    const handleCardOpen = () => {
        if (isGuideCard) return;
        onClick(restaurant);
    };

    const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (isGuideCard) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClick(restaurant);
    };

    if (isList) {
        return (
            <Card
                className={cn(
                    "group relative flex min-h-[76px] items-stretch gap-2 overflow-hidden rounded-xl border border-border bg-card p-2 transition-[background-color,box-shadow,border-color] duration-200",
                    isGuideCard ? "cursor-default" : "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    showStamp ? "ring-2 ring-green-500 ring-opacity-50" : "hover:bg-accent/35 hover:shadow-md",
                    isSelected && "ring-2 ring-primary"
                )}
                onClick={handleCardOpen}
                onKeyDown={handleCardKeyDown}
                role={isGuideCard ? undefined : "button"}
                tabIndex={isGuideCard ? undefined : 0}
                aria-label={isGuideCard ? undefined : `${restaurantDisplayName} 맛집 상세 열기`}
            >
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h3 className="truncate text-[14px] font-semibold leading-5 text-foreground" title={restaurantDisplayName}>
                                {restaurantDisplayName}
                            </h3>
                            <div className="mt-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-3.5 text-muted-foreground">
                                {category && (
                                    <Badge
                                        variant="secondary"
                                        className="h-4 shrink-0 border-transparent bg-secondary/50 px-1 text-[9px] font-normal text-secondary-foreground/90 hover:bg-secondary/60"
                                    >
                                        {category}
                                    </Badge>
                                )}
                                <span className="shrink-0">리뷰 {reviewCount}</span>
                            </div>
                        </div>
                    </div>
                    {showAddress && displayAddress && (
                        <p className="flex min-w-0 items-center gap-1 text-[11px] leading-3.5 text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{displayAddress}</span>
                        </p>
                    )}
                    {typedRestaurant.tzuyang_review && (
                        <p className="truncate text-[11px] leading-3.5 text-muted-foreground">
                            “{typedRestaurant.tzuyang_review}”
                        </p>
                    )}
                </div>

                <div className="relative h-16 shrink-0 self-center overflow-hidden rounded-lg bg-muted" style={{ width: '5rem', minWidth: '5rem' }}>
                    {thumbnailUrl ? (
                        <Image
                            src={thumbnailUrl}
                            alt={`${restaurantDisplayName} 썸네일`}
                            fill
                            sizes="112px"
                            className={cn(
                                "h-full w-full object-cover transition-[filter,opacity,transform] duration-300",
                                showStamp ? "grayscale opacity-60" : "group-hover:brightness-110"
                            )}
                            style={{ objectFit: 'cover' }}
                            onError={(event) => {
                                if (!fallbackThumbnailUrl || event.currentTarget.src.includes('/hqdefault.jpg')) return;
                                event.currentTarget.src = fallbackThumbnailUrl;
                            }}
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center">
                            <MapPin className="h-8 w-8 text-muted-foreground/70" aria-hidden="true" />
                        </div>
                    )}
                </div>
            </Card>
        );
    }
    return (
        <Card
            className={cn(
                "relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition-[box-shadow,border-color,transform] duration-300 group",
                isGuideCard ? "cursor-default" : "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                showStamp ? "ring-2 ring-green-500 ring-opacity-50" : "hover:shadow-lg",
                isSelected && "ring-2 ring-primary"
            )}
            onClick={handleCardOpen}
            onKeyDown={handleCardKeyDown}
            role={isGuideCard ? undefined : "button"}
            tabIndex={isGuideCard ? undefined : 0}
            aria-label={isGuideCard ? undefined : `${restaurantDisplayName} 도장 카드 열기`}
        >
            <div className="relative aspect-video">
                {thumbnailUrl ? (
                    <>
                        <Image
                            src={thumbnailUrl}
                            alt={`${restaurantDisplayName} 썸네일`}
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1536px) 25vw, 20vw"
                            className={cn(
                                "w-full h-full object-cover transition-[filter,opacity,transform] duration-300",
                                showStamp ? "grayscale opacity-60" : "group-hover:brightness-110"
                            )}
                            style={{ objectFit: 'cover' }}
                            onError={(event) => {
                                if (!fallbackThumbnailUrl || event.currentTarget.src.includes('/hqdefault.jpg')) return;
                                event.currentTarget.src = fallbackThumbnailUrl;
                            }}
                        />

                        {/* 화살표 버튼 - 2개 이상의 썸네일이 있을 때만 */}
                        {youtubeLinks.length > 1 && (
                            <>
                                <button
                                    onClick={handlePrevThumbnail}
                                    className="absolute left-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                                    aria-label="이전 썸네일"
                                >
                                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button
                                    onClick={handleNextThumbnail}
                                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                                    aria-label="다음 썸네일"
                                >
                                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                </button>

                                {/* 점 인디케이터 */}
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                                    {youtubeLinks.map((_: string, index: number) => (
                                        <div
                                            key={index}
                                            className={cn(
                                                "w-1.5 h-1.5 rounded-full transition-colors",
                                                index === currentIndex ? "bg-white" : "bg-white/40"
                                            )}
                                        />
                                    ))}
                                </div>
                            </>
                        )}

                        {/* 방문 완료 스탬프 */}
                        {showStamp && (
                            <div
                                className={cn(
                                    "absolute inset-0 z-10 flex items-center justify-center",
                                    isStampMobile ? "overflow-visible" : "overflow-hidden"
                                )}
                            >
                                {guideLabel && (
                                    <span
                                        className={cn(
                                            "absolute top-2 left-2 z-10 leading-none rounded-full bg-black/65 text-white font-medium",
                                            isCompact ? "text-[10px] px-2 py-1" : "text-xs px-2.5 py-1.5"
                                        )}
                                        data-stamp-guide-badge="true"
                                    >
                                        {guideLabel}
                                    </span>
                                )}
                                {isGuideCard && guideDescription && (
                                    <p className={cn(
                                        "absolute left-0 right-0 bottom-0 z-10 px-2 pb-2 pt-3 text-center bg-gradient-to-t from-black/80 via-black/55 to-transparent text-white/95 leading-snug pointer-events-none",
                                        isCompact ? "text-[10px]" : "text-xs sm:text-sm"
                                    )}>
                                        {guideDescription}
                                    </p>
                                )}
                                {onGuideClose && (
                                    <button
                                        type="button"
                                        onClick={handleGuideClose}
                                        className={cn(
                                            "absolute top-2 right-2 z-10 inline-flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
                                            isCompact ? "w-5 h-5" : "w-6 h-6"
                                        )}
                                        aria-label="가이드 닫기"
                                        data-stamp-guide-close="true"
                                    >
                                        <X className={cn("shrink-0", isCompact ? "h-3 w-3" : "h-4 w-4")} aria-hidden="true" />
                                    </button>
                                )}
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="/images/stamp-clear.png"
                                        alt="방문 완료"
                                        className={cn(stampSizeClass, "object-contain opacity-90 drop-shadow-lg dark:hidden")}
                                        style={stampImageStyle}
                                    />
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="/images/stamp-clear-dark.png"
                                        alt="방문 완료"
                                        className={cn(stampSizeClass, "object-contain opacity-90 drop-shadow-lg hidden dark:block")}
                                        style={stampImageStyle}
                                    />
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                        <MapPin className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    </div>
                )}
            </div>
            <div className={cn("p-2", isCompact ? (isDense ? "px-2 py-1" : "px-2 py-1.5") : "p-3")}>
                {isGuideCard ? (
                    <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                            <p
                                className={cn("font-medium leading-snug text-foreground truncate", isCompact ? "text-xs" : "text-sm")}
                                title={guideTitle || restaurantDisplayName}
                            >
                                {guideTitle || restaurantDisplayName}
                            </p>
                            {category && (
                                <Badge
                                    variant="secondary"
                                    className={cn(
                                        "font-normal shrink-0 bg-secondary/50 text-secondary-foreground/90 hover:bg-secondary/60",
                                        isCompact ? "text-[9px] px-1 h-4" : "text-[10px] px-1.5 h-5"
                                    )}
                                >
                                    {category}
                                </Badge>
                            )}
                        </div>
                        <span className={cn(
                            "text-muted-foreground whitespace-nowrap shrink-0",
                            isCompact ? "text-[11px]" : "text-xs"
                        )}>
                            리뷰 {reviewCount}
                        </span>
                    </div>
                ) : (
                    <div className={cn("min-w-0", showAddress && displayAddress ? (isDense ? "space-y-0.5" : "space-y-1.5") : "")}>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <h3 className={cn("font-medium truncate", isCompact ? (isDense ? "text-[13px]" : "text-xs") : "text-sm")} title={restaurantDisplayName}>
                                    {restaurantDisplayName}
                                </h3>
                                {category && (
                                    <Badge
                                        variant="secondary"
                                        className={cn(
                                            "font-normal shrink-0 bg-secondary/50 text-secondary-foreground/90 hover:bg-secondary/60",
                                            isCompact ? "text-[9px] px-1 h-4" : "text-[10px] px-1.5 h-5"
                                        )}
                                    >
                                        {category}
                                    </Badge>
                                )}
                            </div>
                            {(!isCompact || showAddress) && (
                                <span className={cn("text-muted-foreground whitespace-nowrap shrink-0", isDense ? "text-[11px]" : "text-xs")}>
                                    리뷰 {reviewCount}
                                </span>
                            )}
                        </div>
                        {showAddress && displayAddress && (
                            <p className={cn("flex min-w-0 items-center gap-1 text-muted-foreground", isDense ? "text-[11px] leading-3.5" : "text-xs leading-4")}>
                                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">{displayAddress}</span>
                            </p>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
});
