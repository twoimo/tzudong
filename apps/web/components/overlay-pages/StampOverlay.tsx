'use client';

import { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from "react";
import { AlertCircle, Search, Trophy, Eye, EyeOff, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StampGridSkeleton } from "@/components/ui/skeleton-loaders";
import { useRestaurants } from "@/hooks/use-restaurants";
import { REGIONS, extractRegion, StampFilterState, UserReview } from "@/components/stamp/stamp-utils";
import { StampCard } from "@/components/stamp/StampCard";
import { hasRelatedVerifiedUserReview } from "@/lib/restaurant-visit-matching";
import { getRestaurantDisplayName, withRestaurantDisplayName } from "@/lib/restaurant-display-name";
import { compareStampRestaurants } from "@/lib/stamp-restaurant-order";
import { cn } from "@/lib/utils";

const STAMP_PAGE_SIZE = 5;
const STAMP_GUIDE_DEMO_RESTAURANT = {
    id: "guide-stamp-overlay-demo",
    name: "명동 얼큰수제비",
    category: ["분식"],
    road_address: "서울특별시 중구",
    youtube_link: "https://www.youtube.com/watch?v=8kE5Uq_YV08",
    review_count: 17,
} as unknown as Restaurant;
const STAMP_GUIDE_DESCRIPTION = "맛집 카드에 리뷰를 남기면 이렇게 도장이 찍혀요.";

function getStampRestaurantCategories(restaurant: Restaurant): string[] {
    const categoryData = restaurant.category ?? restaurant.categories;
    if (Array.isArray(categoryData)) return categoryData;
    if (typeof categoryData !== 'string') return [];

    try {
        const parsed = JSON.parse(categoryData);
        return Array.isArray(parsed) ? parsed : [categoryData];
    } catch {
        return [categoryData];
    }
}

type UserReviewWithRestaurant = UserReview & {
    restaurant?: Restaurant | null;
};

interface StampOverlayProps {
    onClose?: () => void;
    onOpenRestaurantDetail?: (restaurant: Restaurant) => void;
    singleColumnCards?: boolean;
}

/**
 * 도장 오버레이 (데스크탑)
 * - StampCard 공유 컴포넌트 사용
 */
export default function StampOverlay({ onClose, onOpenRestaurantDetail, singleColumnCards = false }: StampOverlayProps) {
    const { user } = useAuth();
    const [displayLimit, setDisplayLimit] = useState(STAMP_PAGE_SIZE);
    const [cardThumbnailIndexes, setCardThumbnailIndexes] = useState<Record<string, number>>({});
    const [showStampGuide, setShowStampGuide] = useState(false);
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);
    const [filters, setFilters] = useState<StampFilterState>({
        searchQuery: "",
        categories: [],
        regions: [],
        fanVisitsMin: 0,
        showUnvisitedOnly: false,
    });

    // 사용자 도장 데이터
    const { data: userReviewData = [], isLoading: isUserStampsLoading, isFetched: isUserStampsFetched } = useQuery({
        queryKey: ['user-stamp-reviews-overlay', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const { data, error } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('user_id', user.id)
                .eq('is_verified', true);
            if (error) throw error;

            const reviews = (data ?? []) as UserReview[];
            const restaurantIds = [...new Set(reviews.map((review) => review.restaurant_id).filter(Boolean))];
            if (restaurantIds.length === 0) return reviews;

            const { data: restaurantRows, error: restaurantsError } = await supabase
                .from('restaurants')
                .select('id, name:approved_name, approved_name, road_address, jibun_address, status')
                .in('id', restaurantIds);
            if (restaurantsError) throw restaurantsError;

            const restaurantMap = new Map(
                ((restaurantRows ?? []) as Restaurant[])
                    .map((restaurant) => withRestaurantDisplayName(restaurant))
                    .map((restaurant) => [restaurant.id, restaurant])
            );

            return reviews.map((review) => ({
                ...review,
                restaurant: restaurantMap.get(review.restaurant_id) ?? null,
            })) as UserReviewWithRestaurant[];
        },
        enabled: !!user?.id,
    });

    // 맛집 데이터
    const { data: allMergedRestaurants = [], isLoading: isRestaurantsLoading, isError: isRestaurantsError } = useRestaurants({ enabled: true });
    const userVisitedIds = useMemo(() => new Set(userReviewData.map(r => r.restaurant_id)), [userReviewData]);
    const reviewedRestaurantCandidates = useMemo(() => {
        return userReviewData
            .map((review) => (review as UserReviewWithRestaurant).restaurant)
            .filter((restaurant): restaurant is Restaurant => Boolean(restaurant));
    }, [userReviewData]);
    const isVisited = useCallback((restaurant: Restaurant) => hasRelatedVerifiedUserReview({
        restaurant,
        reviewedRestaurantIds: userVisitedIds,
        reviewedRestaurants: reviewedRestaurantCandidates,
    }), [reviewedRestaurantCandidates, userVisitedIds]);
    const isUserStampsReady = !user?.id || isUserStampsFetched;
    const shouldWaitForStampState = !!user?.id && !isUserStampsFetched;
    const shouldShowStampOverlaySkeleton =
        isRestaurantsLoading || shouldWaitForStampState;
    const skeletonCardCount = STAMP_PAGE_SIZE;
    const skeletonGridColumns = singleColumnCards
        ? "grid-cols-1 md:gap-3"
        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 md:gap-4";

    const dismissStampGuide = useCallback(() => {
        setShowStampGuide(false);
    }, []);

    useEffect(() => {
        if (!user?.id) {
            setShowStampGuide(true);
            return;
        }

        if (isUserStampsLoading) {
            setShowStampGuide(false);
            return;
        }

        setShowStampGuide(userReviewData.length === 0);
    }, [isUserStampsLoading, user?.id, userReviewData.length]);

    const deferredSearchQuery = useDeferredValue(filters.searchQuery);

    const normalizedCategoriesByRestaurantId = useMemo(() => new Map(
        allMergedRestaurants.map((restaurant) => [restaurant.id, getStampRestaurantCategories(restaurant)]),
    ), [allMergedRestaurants]);

    // 필터링 (도장 찍힌 맛집 먼저)
    const filteredRestaurants = useMemo(() => {
        let result = allMergedRestaurants;

        if (deferredSearchQuery.trim()) {
            const query = deferredSearchQuery.trim().toLowerCase();
            result = result.filter(r =>
                getRestaurantDisplayName(r).toLowerCase().includes(query) ||
                (r.road_address && r.road_address.toLowerCase().includes(query))
            );
        }

        if (filters.regions.length > 0) {
            result = result.filter(r => {
                const region = extractRegion(r.road_address, r.jibun_address);
                return filters.regions.includes(region);
            });
        }

        if (filters.categories.length > 0) {
            result = result.filter(r => {
                const restaurantCategories = normalizedCategoriesByRestaurantId.get(r.id) ?? [];
                return filters.categories.some(filterCat => restaurantCategories.includes(filterCat));
            });
        }

        if (filters.showUnvisitedOnly && user) {
            result = result.filter(r => !isVisited(r));
        }

        if ((filters.fanVisitsMin ?? 0) > 0) {
            result = result.filter(r => (r.review_count || 0) >= (filters.fanVisitsMin ?? 0));
        }

        result = [...result].sort((a, b) => compareStampRestaurants(a, b, {
            isVisited,
            sortColumn: "fanVisits",
            sortDirection: "desc",
        }));

        return result;
    }, [allMergedRestaurants, deferredSearchQuery, filters, isVisited, normalizedCategoriesByRestaurantId, user]);

    const overlayGuideCount = showStampGuide ? 1 : 0;
    const overlayRestaurantLimit = Math.max(displayLimit - overlayGuideCount, 0);
    const displayedRestaurants = useMemo(
        () => filteredRestaurants.slice(0, overlayRestaurantLimit),
        [filteredRestaurants, overlayRestaurantLimit]
    );
    const displayedCards = useMemo(() => {
        if (!showStampGuide) return displayedRestaurants;
        return [STAMP_GUIDE_DEMO_RESTAURANT, ...displayedRestaurants];
    }, [showStampGuide, displayedRestaurants]);
    const hasMoreToDisplay = displayedRestaurants.length < filteredRestaurants.length;

    const activeFilterCount =
        (filters.searchQuery ? 1 : 0) +
        filters.categories.length +
        filters.regions.length +
        (filters.showUnvisitedOnly ? 1 : 0) +
        ((filters.fanVisitsMin ?? 0) > 0 ? 1 : 0);

    // 무한 스크롤
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const loadMoreRestaurants = useCallback(() => {
        if (hasMoreToDisplay) setDisplayLimit(prev => prev + STAMP_PAGE_SIZE);
    }, [hasMoreToDisplay]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) loadMoreRestaurants(); },
            { threshold: 0.1 }
        );
        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [loadMoreRestaurants]);

    useEffect(() => {
        setDisplayLimit(STAMP_PAGE_SIZE);
    }, [filters]);

    const handleRestaurantClick = useCallback((restaurant: Restaurant) => {
        if (onOpenRestaurantDetail) {
            onOpenRestaurantDetail(restaurant);
        } else {
            window.dispatchEvent(new CustomEvent('closeOverlayAndGoToRestaurant', { detail: restaurant.id }));
        }
    }, [onOpenRestaurantDetail]);

    const handleThumbnailChange = useCallback((id: string, index: number) => {
        setCardThumbnailIndexes(prev => ({ ...prev, [id]: index }));
    }, []);

    const handleRegionToggle = useCallback((region: string) => {
        setFilters(prev => ({
            ...prev,
            regions: prev.regions.includes(region)
                ? prev.regions.filter(r => r !== region)
                : [...prev.regions, region]
        }));
    }, []);

    const handleCategoryToggle = useCallback((category: string) => {
        setFilters(prev => ({
            ...prev,
            categories: prev.categories.includes(category)
                ? prev.categories.filter(c => c !== category)
                : [...prev.categories, category]
        }));
    }, []);

    return (
        <div
            className="h-full overflow-y-auto flex flex-col [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
            data-desktop-left-panel-stamp-mobile-parity="true"
        >
            {/* 헤더 */}
            <div className="shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-[min(11rem,100%)]">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <h1 className="flex min-w-0 items-center gap-1.5 text-[1.0625rem] font-bold leading-tight text-primary text-balance xs:text-xl sm:gap-2 sm:text-2xl">
                                <Trophy className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" aria-hidden="true" />
                                <span className="min-w-0 truncate">쯔동여지도 도장</span>
                            </h1>
                            <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground xs:text-sm">
                                ({allMergedRestaurants.length.toLocaleString()}개)
                            </span>
                        </div>
                        <p className="mt-1 max-w-full text-pretty text-xs leading-5 text-muted-foreground xs:text-sm">
                            맛집을 찾아 도장을 찍어보세요!
                        </p>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"
                            onClick={() => setFilters(prev => ({ ...prev, showUnvisitedOnly: !prev.showUnvisitedOnly }))}
                            title={filters.showUnvisitedOnly ? "모든 맛집 보기" : "안 가본 곳만 보기"}
                            aria-label={filters.showUnvisitedOnly ? "모든 맛집 보기" : "안 가본 곳만 보기"}
                        >
                            {filters.showUnvisitedOnly ? <EyeOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> : <Eye className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                            className="relative h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"
                            title={isFilterExpanded ? "필터 접기" : "필터 펼치기"}
                            aria-label={isFilterExpanded ? "도장 필터 접기" : "도장 필터 펼치기"}
                        >
                            <Filter className="h-4 w-4" aria-hidden="true" />
                            {activeFilterCount > 0 && (
                                <span className="absolute -top-1 -right-1 h-4 w-4 bg-primary text-primary-foreground text-[10px] font-medium rounded-full flex items-center justify-center">
                                    {activeFilterCount}
                                </span>
                            )}
                        </Button>
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted" aria-label="도장 패널 닫기">
                                <X className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* 필터 영역 */}
                <div className={cn(
                    "mt-4 grid grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2",
                    !isFilterExpanded && "hidden"
                )}>
                        <div className="sm:col-span-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    aria-label="도장 맛집 검색"
                                    name="stamp-overlay-search"
                                    autoComplete="off"
                                    placeholder="맛집명 검색…"
                                    value={filters.searchQuery}
                                    onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                                    className="border-0 bg-muted/45 shadow-none focus-visible:ring-1 focus-visible:ring-primary/40"
                                    style={{ paddingLeft: '2.5rem' }}
                                />
                            </div>
                        </div>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" className="justify-between bg-muted/45 shadow-none hover:bg-muted">
                                    <span className="truncate">지역 {filters.regions.length > 0 && `(${filters.regions.length})`}</span>
                                    <Filter className="ml-2 h-4 w-4" aria-hidden="true" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 z-[100]" align="start">
                                <div className="space-y-2">
                                    <h4 className="font-semibold text-sm mb-3">지역 선택</h4>
                                    <ScrollArea className="h-64">
                                        <div className="grid grid-cols-2 gap-2 pr-3">
                                            {REGIONS.map((region) => (
                                                <div key={region} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`overlay-region-${region}`}
                                                        checked={filters.regions.includes(region)}
                                                        onCheckedChange={() => handleRegionToggle(region)}
                                                    />
                                                    <label htmlFor={`overlay-region-${region}`} className="text-sm cursor-pointer flex-1 whitespace-nowrap">
                                                        {region}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" className="justify-between bg-muted/45 shadow-none hover:bg-muted">
                                    <span className="truncate">카테고리 {filters.categories.length > 0 && `(${filters.categories.length})`}</span>
                                    <Filter className="ml-2 h-4 w-4" aria-hidden="true" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 z-[100]" align="start">
                                <div className="space-y-2">
                                    <h4 className="font-semibold text-sm mb-3">카테고리 선택</h4>
                                    <ScrollArea className="h-64">
                                        <div className="space-y-2 pr-3">
                                            {RESTAURANT_CATEGORIES.map((category) => (
                                                <div key={category} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`overlay-category-${category}`}
                                                        checked={filters.categories.includes(category)}
                                                        onCheckedChange={() => handleCategoryToggle(category)}
                                                    />
                                                    <label htmlFor={`overlay-category-${category}`} className="text-sm cursor-pointer flex-1">
                                                        {category}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" className="justify-between bg-muted/45 shadow-none hover:bg-muted">
                                    <span className="truncate">
                                        리뷰 {(filters.fanVisitsMin ?? 0) > 0 ? `${filters.fanVisitsMin}개 이상` : "전체"}
                                    </span>
                                    <Filter className="ml-2 h-4 w-4" aria-hidden="true" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 z-[100]" align="start">
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h4 className="font-semibold text-sm">최소 리뷰 수</h4>
                                        <span className="text-sm text-muted-foreground">{filters.fanVisitsMin ?? 0}개 이상</span>
                                    </div>
                                    <Slider
                                        value={[filters.fanVisitsMin ?? 0]}
                                        max={100}
                                        step={1}
                                        onValueChange={(value) => setFilters(prev => ({ ...prev, fanVisitsMin: value[0] }))}
                                    />
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>0개</span>
                                        <span>100개+</span>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Button
                            variant="ghost"
                            onClick={() => setFilters({
                                searchQuery: "",
                                categories: [],
                                regions: [],
                                fanVisitsMin: 0,
                                showUnvisitedOnly: false,
                            })}
                            title="필터 초기화"
                            disabled={activeFilterCount === 0}
                            className={cn("bg-muted/45 shadow-none hover:bg-muted", activeFilterCount === 0 && "cursor-not-allowed opacity-50")}
                        >
                            필터 초기화
                        </Button>
                    </div>
            </div>

            {/* 그리드 */}
            <div className="flex-1 min-h-0 px-4 sm:px-6 pt-6 pb-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1.5rem)] md:pb-6 bg-background">
                {shouldShowStampOverlaySkeleton ? (
                    <div className="space-y-3">
                        {showStampGuide && (
                            <div
                                className={cn(
                                    singleColumnCards
                                        ? "grid grid-cols-1 gap-3 md:gap-3"
                                        : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4"
                                )}
                                data-stamp-guide-loading-card="desktop-left-panel"
                            >
                                <StampCard
                                    restaurant={STAMP_GUIDE_DEMO_RESTAURANT}
                                    isVisited={true}
                                    isUserStampsReady={true}
                                    currentThumbnailIndex={0}
                                    onThumbnailChange={handleThumbnailChange}
                                    onClick={() => {}}
                                    size="default"
                                    stampSize="mobile"
                                    guideLabel="가이드"
                                    isGuideCard={true}
                                    guideTitle={STAMP_GUIDE_DEMO_RESTAURANT.name}
                                    guideDescription={STAMP_GUIDE_DESCRIPTION}
                                    onGuideClose={dismissStampGuide}
                                />
                            </div>
                        )}
                        <StampGridSkeleton
                            count={skeletonCardCount}
                            showHeader={false}
                            columns={skeletonGridColumns}
                        />
                    </div>
                ) : isRestaurantsError ? (
                    <div
                        role="status"
                        className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground"
                    >
                        <div>
                            <AlertCircle
                                className="mx-auto mb-2 h-10 w-10 rounded-full bg-destructive/10 p-2 text-destructive/80"
                                aria-hidden="true"
                            />
                            <p className="font-medium text-foreground">도장 맛집을 불러오지 못했습니다</p>
                            <p className="mt-1 text-xs leading-5">잠시 후 다시 열거나 필터를 초기화해 주세요.</p>
                        </div>
                    </div>
                ) : displayedCards.length === 0 ? (
                    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground">
                        <div>
                            <Trophy
                                className="mx-auto mb-2 h-10 w-10 rounded-full bg-primary/10 p-2 text-primary/70"
                                aria-hidden="true"
                            />
                            <p className="font-medium text-foreground">조건에 맞는 도장 맛집이 없습니다</p>
                            <p className="mt-1 text-xs leading-5">검색어를 줄이거나 필터를 초기화해 다시 확인해 보세요.</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div
                            className={cn(
                                singleColumnCards
                                    ? "grid grid-cols-1 gap-3 md:gap-3"
                                    : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4"
                            )}
                            data-stamp-card-grid-single-column={singleColumnCards ? "true" : "false"}
                        >
                            {displayedCards.map((restaurant) => {
                                const isGuideCard = restaurant.id === STAMP_GUIDE_DEMO_RESTAURANT.id;
                                const isVisitedCard = isGuideCard ? true : isVisited(restaurant);
                                const currentIndex = cardThumbnailIndexes[restaurant.id] || 0;
                                return (
                                    <StampCard
                                        key={restaurant.id}
                                        restaurant={restaurant}
                                        isVisited={isVisitedCard}
                                        isUserStampsReady={isUserStampsReady}
                                        currentThumbnailIndex={currentIndex}
                                        onThumbnailChange={handleThumbnailChange}
                                        onClick={isGuideCard ? () => {} : handleRestaurantClick}
                                        size="default"
                                        stampSize="mobile"
                                        guideLabel={isGuideCard ? "가이드" : undefined}
                                        isGuideCard={isGuideCard}
                                        guideTitle={isGuideCard ? restaurant.name : undefined}
                                        guideDescription={isGuideCard ? STAMP_GUIDE_DESCRIPTION : undefined}
                                        onGuideClose={isGuideCard ? dismissStampGuide : undefined}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}

                <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-4">
                    {hasMoreToDisplay && <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />}
                </div>
            </div>
        </div>
    );
}
