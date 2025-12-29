'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { Search, MapPin, ChevronLeft, ChevronRight, X, Stamp as StampIcon, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Restaurant } from "@/types/restaurant";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useRestaurants, mergeRestaurants } from "@/hooks/use-restaurants";
import { Label } from "@/components/ui/label";

// 유틸리티 함수들
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

// 주소에서 지역 추출
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

const REGIONS = [
    "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산",
    "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
    "미국", "일본", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

interface RestaurantCardProps {
    restaurant: Restaurant;
    visited: boolean;
    isSelected: boolean;
    currentThumbnailIndex: number;
    onThumbnailChange: (index: number) => void;
    onClick: (restaurant: Restaurant) => void;
}

const RestaurantCard = memo(({ restaurant, visited, isSelected, currentThumbnailIndex, onThumbnailChange, onClick }: RestaurantCardProps) => {
    const youtubeLinks = (restaurant as any).mergedYoutubeLinks ||
        (restaurant.youtube_link ? [restaurant.youtube_link] : []);

    const currentIndex = currentThumbnailIndex % youtubeLinks.length;
    const thumbnailUrl = youtubeLinks[currentIndex] ? getYouTubeThumbnailUrl(youtubeLinks[currentIndex]) : null;
    const category = parseCategory(restaurant.category || (restaurant as any).categories);

    const handlePrevThumbnail = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newIndex = currentIndex === 0 ? youtubeLinks.length - 1 : currentIndex - 1;
        onThumbnailChange(newIndex);
    };

    const handleNextThumbnail = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newIndex = currentIndex === youtubeLinks.length - 1 ? 0 : currentIndex + 1;
        onThumbnailChange(newIndex);
    };

    return (
        <Card
            className={cn(
                "relative overflow-hidden transition-all duration-300 cursor-pointer group mb-3 last:mb-0",
                visited ? "ring-2 ring-green-500 ring-opacity-50" : "hover:shadow-md",
                isSelected ? "ring-2 ring-primary" : ""
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
                                visited ? "grayscale opacity-60" : "group-hover:brightness-110"
                            )}
                            loading="lazy"
                        />
                        {youtubeLinks.length > 1 && (
                            <>
                                <button
                                    onClick={handlePrevThumbnail}
                                    className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                                >
                                    <ChevronLeft className="h-3 w-3" />
                                </button>
                                <button
                                    onClick={handleNextThumbnail}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                                >
                                    <ChevronRight className="h-3 w-3" />
                                </button>
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                                    {youtubeLinks.map((_: string, index: number) => (
                                        <div
                                            key={index}
                                            className={cn(
                                                "w-1 h-1 rounded-full transition-colors",
                                                index === currentIndex ? "bg-white" : "bg-white/40"
                                            )}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                        {visited && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="text-red-500 font-bold text-4xl transform -rotate-12 border-4 border-red-500 rounded-lg px-2 py-1 opacity-90">
                                    CLEAR
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                        <MapPin className="h-8 w-8 text-muted-foreground" />
                    </div>
                )}
            </div>
            <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-sm font-medium truncate" title={restaurant.name}>
                            {restaurant.name}
                        </h3>
                        {category && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 h-5 font-normal shrink-0 bg-secondary/50 text-secondary-foreground/90">
                                {category}
                            </Badge>
                        )}
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                        리뷰 {(restaurant as any).verified_review_count ?? restaurant.review_count ?? 0}
                    </span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-1">
                    {restaurant.road_address || restaurant.jibun_address}
                </p>
            </div>
        </Card>
    );
});
RestaurantCard.displayName = 'RestaurantCard';

interface StampPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
    onSelectRestaurant: (restaurant: Restaurant) => void;
}

interface FilterState {
    searchQuery: string;
    regions: string[];
    showUnvisitedOnly: boolean;
}

export default function StampPanel({ isOpen, onClose, onToggleCollapse, isCollapsed, onSelectRestaurant }: StampPanelProps) {
    const { user } = useAuth();

    // State
    const [filters, setFilters] = useState<FilterState>({
        searchQuery: "",
        regions: [],
        showUnvisitedOnly: false,
    });

    const [cardThumbnailIndexes, setCardThumbnailIndexes] = useState<Record<string, number>>({});
    const [userReviews, setUserReviews] = useState<Set<string>>(new Set());

    // User Stamp Data
    const { data: userReviewData = [] } = useQuery({
        queryKey: ['user-stamp-reviews', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const { data, error } = await supabase
                .from('reviews')
                .select('restaurant_id, is_verified')
                .eq('user_id', user.id)
                .eq('is_verified', true);
            if (error) throw error;
            return data as { restaurant_id: string; is_verified: boolean }[];
        },
        enabled: !!user?.id && isOpen,
    });

    useEffect(() => {
        if (userReviewData.length > 0) {
            const reviewedRestaurantIds = new Set(
                userReviewData.map(review => review.restaurant_id)
            );
            setUserReviews(reviewedRestaurantIds);
        }
    }, [userReviewData]);

    const isVisited = useCallback((restaurantId: string) => {
        return userReviews.has(restaurantId);
    }, [userReviews]);

    // Data Fetching: Restaurants
    const { data: allMergedRestaurants = [] } = useRestaurants({ enabled: isOpen });

    // 검색 (단순 필터링으로 구현 - Panel에서는 전체 데이터에서 필터링하는 것이 반응성이 좋음)
    // 물론 데이터가 많으면 성능 이슈가 있을 수 있으나, useRestaurants가 캐싱된 데이터를 사용하므로 빠름.

    const filteredRestaurants = useMemo(() => {
        let result = allMergedRestaurants;

        // 검색
        if (filters.searchQuery.trim()) {
            const query = filters.searchQuery.toLowerCase();
            result = result.filter(r =>
                r.name.toLowerCase().includes(query) ||
                (r.road_address && r.road_address.includes(query)) ||
                (r.jibun_address && r.jibun_address.includes(query))
            );
        }

        // 지역
        if (filters.regions.length > 0) {
            result = result.filter(r => {
                const region = extractRegion(r.road_address, r.jibun_address);
                return filters.regions.includes(region);
            });
        }

        // 미방문만 보기
        if (filters.showUnvisitedOnly) {
            result = result.filter(r => !isVisited(r.id));
        }

        return result;
    }, [allMergedRestaurants, filters, isVisited]);

    // Pagination
    const [displayLimit, setDisplayLimit] = useState(20);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setDisplayLimit(20);
    }, [filters]);

    const displayedRestaurants = useMemo(() => {
        return filteredRestaurants.slice(0, displayLimit);
    }, [filteredRestaurants, displayLimit]);

    const loadMore = useCallback(() => {
        if (displayLimit < filteredRestaurants.length) {
            setDisplayLimit(prev => prev + 20);
        }
    }, [displayLimit, filteredRestaurants.length]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMore();
            },
            { threshold: 0.1 }
        );
        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [loadMore]);


    return (
        <div className="flex flex-col h-full bg-background border-l border-border relative">
            {/* Collapse Button */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                </button>
            )}

            {/* Header */}
            <div className="p-4 border-b border-border bg-card">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <StampIcon className="h-5 w-5 text-primary" />
                        쯔동여지도 도장
                    </h2>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="hover:bg-muted"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* Search & Filter */}
                <div className="space-y-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="맛집 이름, 지역 검색..."
                            className="pl-9"
                            value={filters.searchQuery}
                            onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                        />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 border-dashed text-xs">
                                    <Filter className="mr-1 h-3 w-3" />
                                    지역 필터
                                    {filters.regions.length > 0 && (
                                        <Badge variant="secondary" className="ml-2 h-4 px-1 rounded-[2px] lg:hidden">
                                            {filters.regions.length}
                                        </Badge>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[200px] p-0" align="start">
                                <ScrollArea className="h-[300px] p-4">
                                    <div className="space-y-2">
                                        <div className="flex items-center space-x-2 pb-2 mb-2 border-b">
                                            <Checkbox
                                                id="all-regions"
                                                checked={filters.regions.length === 0}
                                                onCheckedChange={() => setFilters(prev => ({ ...prev, regions: [] }))}
                                            />
                                            <Label htmlFor="all-regions" className="text-sm">전체 지역</Label>
                                        </div>
                                        {REGIONS.map((region) => (
                                            <div key={region} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`region-${region}`}
                                                    checked={filters.regions.includes(region)}
                                                    onCheckedChange={(checked) => {
                                                        setFilters(prev => {
                                                            const newRegions = checked
                                                                ? [...prev.regions, region]
                                                                : prev.regions.filter(r => r !== region);
                                                            return { ...prev, regions: newRegions };
                                                        });
                                                    }}
                                                />
                                                <Label htmlFor={`region-${region}`} className="text-sm">{region}</Label>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </PopoverContent>
                        </Popover>

                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="unvisited"
                                checked={filters.showUnvisitedOnly}
                                onCheckedChange={(checked) => setFilters(prev => ({ ...prev, showUnvisitedOnly: !!checked }))}
                            />
                            <label
                                htmlFor="unvisited"
                                className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                            >
                                안 가본 곳만
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-hidden bg-muted/10">
                <ScrollArea className="h-full p-4">
                    {displayedRestaurants.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <MapPin className="h-10 w-10 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">검색 결과가 없습니다</p>
                        </div>
                    ) : (
                        <div className="space-y-3 pb-8">
                            {displayedRestaurants.map(restaurant => (
                                <RestaurantCard
                                    key={restaurant.id}
                                    restaurant={restaurant}
                                    visited={isVisited(restaurant.id)}
                                    isSelected={false}
                                    currentThumbnailIndex={cardThumbnailIndexes[restaurant.id] || 0}
                                    onThumbnailChange={(index) => setCardThumbnailIndexes(prev => ({ ...prev, [restaurant.id]: index }))}
                                    onClick={onSelectRestaurant}
                                />
                            ))}
                            <div ref={loadMoreRef} className="h-8" />
                        </div>
                    )}
                </ScrollArea>
            </div>
        </div>
    );
}
