'use client';

import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { Search, MapPin, ChevronLeft, ChevronRight, Trophy, Eye, EyeOff, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Restaurant, RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { GlobalLoader } from "@/components/ui/global-loader";
import { useRestaurants } from "@/hooks/use-restaurants";

interface StampOverlayProps {
    onClose?: () => void;
    onOpenRestaurantDetail?: (restaurant: Restaurant) => void;
}

// 지역 목록
const REGIONS = [
    "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산",
    "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
    "미국", "일본", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

// 지역 패턴
const regionPatterns = [
    { pattern: /^서울|서울특별시/, region: "서울" },
    { pattern: /^경기도|^경기/, region: "경기" },
    { pattern: /^인천|인천광역시/, region: "인천" },
    { pattern: /^부산|부산광역시/, region: "부산" },
    { pattern: /^대구|대구광역시/, region: "대구" },
    { pattern: /^광주|광주광역시/, region: "광주" },
    { pattern: /^대전|대전광역시/, region: "대전" },
    { pattern: /^울산|울산광역시/, region: "울산" },
    { pattern: /^세종|세종특별자치시/, region: "세종" },
    { pattern: /^강원|강원특별자치도|강원도/, region: "강원" },
    { pattern: /^충청북도|^충북/, region: "충북" },
    { pattern: /^충청남도|^충남/, region: "충남" },
    { pattern: /^전라북도|^전북|^전북특별자치도/, region: "전북" },
    { pattern: /^전라남도|^전남/, region: "전남" },
    { pattern: /^경상북도|^경북/, region: "경북" },
    { pattern: /^경상남도|^경남/, region: "경남" },
    { pattern: /^제주|제주특별자치도/, region: "제주" },
    { pattern: /미국|USA|United States/i, region: "미국" },
    { pattern: /일본|Japan/i, region: "일본" },
    { pattern: /태국|Thailand/i, region: "태국" },
    { pattern: /인도네시아|Indonesia/i, region: "인도네시아" },
    { pattern: /튀르키예|Turkey|Türkiye/i, region: "튀르키예" },
    { pattern: /헝가리|Hungary/i, region: "헝가리" },
    { pattern: /오스트레일리아|Australia/i, region: "오스트레일리아" },
];

const extractRegion = (roadAddress: string | null, jibunAddress: string | null): string => {
    const address = roadAddress || jibunAddress || "";
    if (!address) return "";
    for (const { pattern, region } of regionPatterns) {
        if (pattern.test(address)) return region;
    }
    return "";
};

// 유틸리티 함수
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

const extractYouTubeVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

const getYouTubeThumbnailUrl = (url: string) => {
    const videoId = extractYouTubeVideoId(url);
    return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
};

interface UserReview {
    restaurant_id: string;
    is_verified: boolean;
}

interface FilterState {
    searchQuery: string;
    categories: string[];
    regions: string[];
    showUnvisitedOnly: boolean;
}

/**
 * 도장 오버레이
 * - 모바일/태블릿 도장 페이지와 동일한 필터링 및 표시
 */
export default function StampOverlay({ onClose, onOpenRestaurantDetail }: StampOverlayProps) {
    const { user } = useAuth();
    const [displayLimit, setDisplayLimit] = useState(20);
    const [cardThumbnailIndexes, setCardThumbnailIndexes] = useState<Record<string, number>>({});
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);
    const [filters, setFilters] = useState<FilterState>({
        searchQuery: "",
        categories: [],
        regions: [],
        showUnvisitedOnly: false,
    });

    // 사용자 도장 데이터
    const { data: userReviewData = [], isLoading: isUserStampsLoading } = useQuery({
        queryKey: ['user-stamp-reviews-overlay', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const { data, error } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('user_id', user.id)
                .eq('is_verified', true);
            if (error) throw error;
            return data as UserReview[];
        },
        enabled: !!user?.id,
    });

    const userVisitedIds = useMemo(() => new Set(userReviewData.map(r => r.restaurant_id)), [userReviewData]);
    const isUserStampsReady = !user?.id || !isUserStampsLoading;

    // 맛집 데이터
    const { data: allMergedRestaurants = [], isLoading: isRestaurantsLoading } = useRestaurants({ enabled: true });

    // 필터링 및 정렬 (도장 찍힌 맛집 먼저)
    const filteredRestaurants = useMemo(() => {
        let result = allMergedRestaurants;

        // 검색어 필터
        if (filters.searchQuery.trim()) {
            const query = filters.searchQuery.trim().toLowerCase();
            result = result.filter(r =>
                r.name.toLowerCase().includes(query) ||
                (r.road_address && r.road_address.toLowerCase().includes(query))
            );
        }

        // 지역 필터
        if (filters.regions.length > 0) {
            result = result.filter(r => {
                const region = extractRegion(r.road_address, r.jibun_address);
                return filters.regions.includes(region);
            });
        }

        // 카테고리 필터
        if (filters.categories.length > 0) {
            result = result.filter(r => {
                const categoryData = r.category || (r as any).categories;
                let restaurantCategories: string[] = [];
                if (Array.isArray(categoryData)) {
                    restaurantCategories = categoryData;
                } else if (typeof categoryData === 'string') {
                    try {
                        const parsed = JSON.parse(categoryData);
                        if (Array.isArray(parsed)) restaurantCategories = parsed;
                        else restaurantCategories = [categoryData];
                    } catch {
                        restaurantCategories = [categoryData];
                    }
                }
                return filters.categories.some(filterCat => restaurantCategories.includes(filterCat));
            });
        }

        // 안 가본 곳만 보기 필터
        if (filters.showUnvisitedOnly && user) {
            result = result.filter(r => !userVisitedIds.has(r.id));
        }

        // 도장 찍힌 맛집 먼저 정렬
        result = [...result].sort((a, b) => {
            const aVisited = userVisitedIds.has(a.id) ? 1 : 0;
            const bVisited = userVisitedIds.has(b.id) ? 1 : 0;
            return bVisited - aVisited;
        });

        return result;
    }, [allMergedRestaurants, filters, user, userVisitedIds]);

    const displayedRestaurants = useMemo(() => filteredRestaurants.slice(0, displayLimit), [filteredRestaurants, displayLimit]);
    const hasMoreToDisplay = displayLimit < filteredRestaurants.length;

    // 활성 필터 수
    const activeFilterCount =
        (filters.searchQuery ? 1 : 0) +
        filters.categories.length +
        filters.regions.length +
        (filters.showUnvisitedOnly ? 1 : 0);

    // 무한 스크롤
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const loadMoreRestaurants = useCallback(() => {
        if (hasMoreToDisplay) setDisplayLimit(prev => prev + 20);
    }, [hasMoreToDisplay]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) loadMoreRestaurants(); },
            { threshold: 0.1 }
        );
        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [loadMoreRestaurants]);

    // 필터 변경 시 displayLimit 리셋
    useEffect(() => {
        setDisplayLimit(20);
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

    if (isRestaurantsLoading) return <GlobalLoader message="맛집 데이터를 불러오는 중..." />;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* 헤더 */}
            <div className="p-6 border-b border-border shrink-0 bg-background rounded-t-2xl">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                            <Trophy className="h-6 w-6 text-primary" />
                            쯔동여지도 도장
                            <span className="text-sm font-normal text-muted-foreground">
                                ({filteredRestaurants.length.toLocaleString()}개)
                            </span>
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            맛집을 찾아 도장을 찍어보세요!
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {user && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full hover:bg-muted"
                                onClick={() => setFilters(prev => ({ ...prev, showUnvisitedOnly: !prev.showUnvisitedOnly }))}
                                title={filters.showUnvisitedOnly ? "모든 맛집 보기" : "안 가본 곳만 보기"}
                            >
                                {filters.showUnvisitedOnly ? <EyeOff className="h-5 w-5 text-primary" /> : <Eye className="h-5 w-5 text-muted-foreground" />}
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                            className="relative"
                            title={isFilterExpanded ? "필터 접기" : "필터 펼치기"}
                        >
                            <Filter className="h-4 w-4" />
                            {activeFilterCount > 0 && (
                                <span className="absolute -top-1 -right-1 h-4 w-4 bg-primary text-primary-foreground text-[10px] font-medium rounded-full flex items-center justify-center">
                                    {activeFilterCount}
                                </span>
                            )}
                        </Button>
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 hover:bg-muted rounded-full">
                                <X className="h-5 w-5" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* 필터 영역 - 확장시에만 표시 */}
                {isFilterExpanded && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                        {/* 검색 */}
                        <div className="md:col-span-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="맛집명 검색..."
                                    value={filters.searchQuery}
                                    onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                                    className="pl-9"
                                />
                            </div>
                        </div>

                        {/* 지역 */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="justify-between w-full">
                                    <span className="truncate">
                                        지역 {filters.regions.length > 0 && `(${filters.regions.length})`}
                                    </span>
                                    <Filter className="h-4 w-4 ml-2" />
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

                        {/* 카테고리 */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="justify-between w-full">
                                    <span className="truncate">
                                        카테고리 {filters.categories.length > 0 && `(${filters.categories.length})`}
                                    </span>
                                    <Filter className="h-4 w-4 ml-2" />
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
                    </div>
                )}
            </div>

            {/* 그리드 */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {displayedRestaurants.map((restaurant) => {
                        const isVisited = userVisitedIds.has(restaurant.id);
                        const currentIndex = cardThumbnailIndexes[restaurant.id] || 0;
                        return (
                            <StampCard
                                key={restaurant.id}
                                restaurant={restaurant}
                                isVisited={isVisited}
                                isUserStampsReady={isUserStampsReady}
                                currentThumbnailIndex={currentIndex}
                                onThumbnailChange={handleThumbnailChange}
                                onClick={handleRestaurantClick}
                            />
                        );
                    })}
                </div>

                <div ref={loadMoreRef} className="h-10 flex items-center justify-center mt-4">
                    {hasMoreToDisplay && <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />}
                </div>
            </div>
        </div>
    );
}

// 도장 카드 컴포넌트 - 모바일과 동일한 스타일
interface StampCardProps {
    restaurant: Restaurant;
    isVisited: boolean;
    isUserStampsReady: boolean;
    currentThumbnailIndex: number;
    onThumbnailChange: (id: string, index: number) => void;
    onClick: (restaurant: Restaurant) => void;
}

const StampCard = memo(({ restaurant, isVisited, isUserStampsReady, currentThumbnailIndex, onThumbnailChange, onClick }: StampCardProps) => {
    const showStamp = isUserStampsReady && isVisited;
    const youtubeLinks = (restaurant as any).mergedYoutubeLinks || (restaurant.youtube_link ? [restaurant.youtube_link] : []);
    const currentIndex = currentThumbnailIndex % (youtubeLinks.length || 1);
    const thumbnailUrl = youtubeLinks[currentIndex] ? getYouTubeThumbnailUrl(youtubeLinks[currentIndex]) : null;
    const category = parseCategory(restaurant.category || (restaurant as any).categories);

    return (
        <Card
            className={cn(
                "relative overflow-hidden transition-all duration-300 cursor-pointer group",
                showStamp ? "ring-2 ring-green-500 ring-opacity-50" : "hover:shadow-lg"
            )}
            onClick={() => onClick(restaurant)}
        >
            <div className="aspect-video relative">
                {thumbnailUrl ? (
                    <>
                        <img
                            src={thumbnailUrl}
                            alt={restaurant.name}
                            className={cn(
                                "w-full h-full object-cover transition-all duration-300",
                                showStamp ? "grayscale opacity-60" : "group-hover:brightness-110"
                            )}
                            loading="lazy"
                        />
                        {/* 화살표 버튼 */}
                        {youtubeLinks.length > 1 && (
                            <>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onThumbnailChange(restaurant.id, currentIndex === 0 ? youtubeLinks.length - 1 : currentIndex - 1); }}
                                    className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onThumbnailChange(restaurant.id, currentIndex === youtubeLinks.length - 1 ? 0 : currentIndex + 1); }}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
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
                                    className="w-32 h-32 md:w-36 md:h-36 object-contain opacity-90 drop-shadow-lg dark:hidden"
                                    style={{ transform: 'rotate(-45deg)' }}
                                />
                                <img
                                    src="/images/stamp-clear-dark.png"
                                    alt="방문 완료"
                                    className="w-32 h-32 md:w-36 md:h-36 object-contain opacity-90 drop-shadow-lg hidden dark:block"
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
            <div className="p-2">
                <div className="flex items-center gap-1">
                    <h3 className="text-xs font-medium truncate flex-1">{restaurant.name}</h3>
                    {category && <Badge variant="secondary" className="text-[9px] px-1 h-4">{category}</Badge>}
                </div>
            </div>
        </Card>
    );
});
StampCard.displayName = 'StampCard';
