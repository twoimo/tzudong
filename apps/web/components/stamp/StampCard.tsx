'use client';

import { memo } from 'react';
import { MapPin, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { parseCategory, getYouTubeThumbnailUrl } from './stamp-utils';

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
}: StampCardProps) {
    const showStamp = isUserStampsReady && isVisited;
    const youtubeLinks = (restaurant as any).mergedYoutubeLinks || (restaurant.youtube_link ? [restaurant.youtube_link] : []);
    const currentIndex = currentThumbnailIndex % (youtubeLinks.length || 1);
    const thumbnailUrl = youtubeLinks[currentIndex] ? getYouTubeThumbnailUrl(youtubeLinks[currentIndex]) : null;
    const category = parseCategory(restaurant.category || (restaurant as any).categories);
    const reviewCount = (restaurant as any).verified_review_count ?? restaurant.review_count ?? 0;

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
    const stampSizeClass = isCompact
        ? "w-32 h-32 md:w-36 md:h-36"
        : "w-44 h-44 sm:w-52 sm:h-52";

    return (
        <Card
            className={cn(
                "relative overflow-hidden transition-all duration-300 cursor-pointer group",
                showStamp ? "ring-2 ring-green-500 ring-opacity-50" : "hover:shadow-lg",
                isSelected && "ring-2 ring-primary"
            )}
            onClick={() => onClick(restaurant)}
        >
            <div className="aspect-video relative">
                {thumbnailUrl ? (
                    <>
                        <img
                            src={thumbnailUrl}
                            alt={`${restaurant.name} 썸네일`}
                            className={cn(
                                "w-full h-full object-cover transition-all duration-300",
                                showStamp ? "grayscale opacity-60" : "group-hover:brightness-110"
                            )}
                            loading="lazy"
                        />

                        {/* 화살표 버튼 - 2개 이상의 썸네일이 있을 때만 */}
                        {youtubeLinks.length > 1 && (
                            <>
                                <button
                                    onClick={handlePrevThumbnail}
                                    className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                                    aria-label="이전 썸네일"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={handleNextThumbnail}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                                    aria-label="다음 썸네일"
                                >
                                    <ChevronRight className="h-4 w-4" />
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
                            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                                <img
                                    src="/images/stamp-clear.png"
                                    alt="방문 완료"
                                    className={cn(stampSizeClass, "object-contain opacity-90 drop-shadow-lg dark:hidden")}
                                    style={{ transform: 'rotate(-45deg)' }}
                                />
                                <img
                                    src="/images/stamp-clear-dark.png"
                                    alt="방문 완료"
                                    className={cn(stampSizeClass, "object-contain opacity-90 drop-shadow-lg hidden dark:block")}
                                    style={{ transform: 'rotate(-45deg)' }}
                                />
                            </div>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                        <MapPin className="h-8 w-8 text-muted-foreground" />
                    </div>
                )}
            </div>
            <div className={cn("p-3", isCompact && "p-2")}>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <h3 className={cn("font-medium truncate", isCompact ? "text-xs" : "text-sm")} title={restaurant.name}>
                            {restaurant.name}
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
                    {!isCompact && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                            리뷰 {reviewCount}
                        </span>
                    )}
                </div>
            </div>
        </Card>
    );
});
