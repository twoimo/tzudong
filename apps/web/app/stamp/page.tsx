'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, Trophy, Eye, EyeOff, MapPin, List, Grid } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { RESTAURANT_CATEGORIES, Restaurant } from "@/types/restaurant";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/utils";
import { GlobalLoader } from "@/components/ui/global-loader";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { useRestaurants, mergeRestaurants } from "@/hooks/use-restaurants";
import { useDeviceType } from "@/hooks/useDeviceType";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { RestaurantReviewsPanel } from "@/components/stamp/RestaurantReviewsPanel";

// 지역 목록
const REGIONS = [
    "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산",
    "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
    "미국", "일본", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

type SortColumn = "name" | "category" | "fanVisits";
type SortDirection = "asc" | "desc" | null;
type ViewMode = "grid" | "list";

interface FilterState {
    searchQuery: string;
    categories: string[];
    regions: string[];
    fanVisitsMin: number;
    showUnvisitedOnly: boolean;
}

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

interface UserReview {
    restaurant_id: string;
    is_verified: boolean;
}

// 유틸리티 함수들을 컴포넌트 외부로 이동
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

// 주소에서 지역 추출 (불변 데이터이므로 외부로)
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

// 리스트 아이템 컴포넌트 메모이제이션
interface RestaurantCardProps {
    restaurant: Restaurant;
    visited: boolean;
    isSelected: boolean;
    onClick: (restaurant: Restaurant) => void;
}

const RestaurantCard = memo(({ restaurant, visited, isSelected, onClick }: RestaurantCardProps) => {
    const thumbnailUrl = restaurant.youtube_link ? getYouTubeThumbnailUrl(restaurant.youtube_link) : null;
    const category = parseCategory(restaurant.category || (restaurant as any).categories);

    return (
        <Card
            className={cn(
                "relative overflow-hidden transition-all duration-300 cursor-pointer group",
                visited ? "ring-2 ring-green-500 ring-opacity-50" : "hover:shadow-lg",
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
                        />
                        {visited && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-red-500 font-bold text-4xl sm:text-5xl transform -rotate-12 border-4 border-red-500 rounded-lg p-2 opacity-90">
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
                            <Badge variant="secondary" className="text-[10px] px-1.5 h-5 font-normal shrink-0 bg-secondary/50 text-secondary-foreground/90 hover:bg-secondary/60">
                                {category}
                            </Badge>
                        )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        리뷰 {(restaurant as any).verified_review_count ?? restaurant.review_count ?? 0}
                    </span>
                </div>
            </div>
        </Card>
    );
});
RestaurantCard.displayName = 'RestaurantCard';

interface RestaurantRowProps {
    restaurant: Restaurant;
    visited: boolean;
    isSelected: boolean;
    onClick: (restaurant: Restaurant) => void;
}

const RestaurantRow = memo(({ restaurant, visited, isSelected, onClick }: RestaurantRowProps) => {
    const category = parseCategory(restaurant.category || (restaurant as any).categories);
    const thumbnailUrl = restaurant.youtube_link ? getYouTubeThumbnailUrl(restaurant.youtube_link) : null;

    return (
        <TableRow
            className={cn(
                "cursor-pointer hover:bg-muted/50",
                isSelected ? "bg-muted" : ""
            )}
            onClick={() => onClick(restaurant)}
        >
            <TableCell>
                <div className="flex items-center gap-3">
                    {thumbnailUrl && (
                        <div className="w-24 h-16 bg-muted rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                            <img
                                src={thumbnailUrl}
                                alt={`${restaurant.name} 썸네일`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                            />
                        </div>
                    )}
                    <span className="font-medium">{restaurant.name}</span>
                </div>
            </TableCell>
            <TableCell>
                {category && (
                    <Badge variant="outline">
                        {category}
                    </Badge>
                )}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm truncate max-w-[400px]">
                {restaurant.road_address || restaurant.jibun_address}
            </TableCell>
            <TableCell className="text-center">{restaurant.review_count || 0}</TableCell>
        </TableRow>
    );
});
RestaurantRow.displayName = 'RestaurantRow';

export default function StampPage() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { isMobileOrTablet, isDesktop } = useDeviceType();

    // --- State ---
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [searchQuery, setSearchQuery] = useState("");
    const [filters, setFilters] = useState<FilterState>({
        searchQuery: "",
        categories: [],
        regions: [],
        fanVisitsMin: 0,
        showUnvisitedOnly: false,
    });
    const [sortColumn, setSortColumn] = useState<SortColumn>("fanVisits");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    // Right Panel State
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [isRightPanelVisible, setIsRightPanelVisible] = useState(false);

    // Review Modal State
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

    // Review Detail State
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [cardPhotoIndexes, setCardPhotoIndexes] = useState<Record<string, number>>({});

    // User Stamp Data
    const [userReviews, setUserReviews] = useState<Set<string>>(new Set());

    // --- Data Fetching: User Stamps ---
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
            return data as UserReview[];
        },
        enabled: !!user?.id,
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

    // --- Data Fetching: Restaurants ---
    // 병합된 전체 맛집 수 조회 (useRestaurants 훅 사용 - 병합 로직 적용됨)
    const { data: allMergedRestaurants = [] } = useRestaurants({ enabled: true });
    const totalRestaurantCount = allMergedRestaurants.length;

    // 검색 시 사용할 전체 맛집 데이터 조회 (RPC 함수 사용)
    const { data: allRestaurants = [], isLoading: isLoadingAllRestaurants } = useQuery({
        queryKey: ['all-restaurants', searchQuery],
        queryFn: async () => {
            if (!searchQuery.trim()) return [];
            try {
                const { data: restaurants, error } = await (supabase as any).rpc('search_restaurants_by_name', {
                    search_query: searchQuery.trim(),
                    search_categories: null,
                    max_results: 100
                });
                if (error) throw error;
                if (!restaurants || restaurants.length === 0) return [];

                // 승인된 리뷰 수 조회
                const restaurantIds = restaurants.map((r: any) => r.id);
                const { data: reviewCounts } = await supabase
                    .from('reviews')
                    .select('restaurant_id')
                    .in('restaurant_id', restaurantIds)
                    .eq('is_verified', true);

                // 승인된 리뷰 수 카운트
                const verifiedCountMap = new Map<string, number>();
                (reviewCounts as any[])?.forEach((r: { restaurant_id: string }) => {
                    verifiedCountMap.set(r.restaurant_id, (verifiedCountMap.get(r.restaurant_id) || 0) + 1);
                });

                // 맛집에 승인된 리뷰 수 추가
                return restaurants.map((r: any) => ({
                    ...r,
                    verified_review_count: verifiedCountMap.get(r.id) || 0
                }));
            } catch (error) {
                console.error('맛집 검색 중 오류:', error);
                return [];
            }
        },
        enabled: !!searchQuery.trim(),
    });

    // 기본 맛집 데이터 무한 스크롤 조회 (검색어가 없을 때만)
    const {
        data: restaurantsData,
        fetchNextPage: fetchNextRestaurants,
        hasNextPage: hasNextRestaurantPage,
        isLoading: isRestaurantsLoading,
        isFetchingNextPage: isFetchingNextRestaurantPage,
    } = useInfiniteQuery({
        queryKey: ['restaurants-stamp'],
        queryFn: async ({ pageParam = 0 }) => {
            try {
                const { data: restaurants, error } = await supabase
                    .from('restaurants')
                    .select('*')
                    .eq('status', 'approved')
                    .order('review_count', { ascending: false })
                    .range(pageParam, pageParam + 49);

                if (error) throw error;
                if (!restaurants || restaurants.length === 0) return { restaurants: [], nextCursor: null };

                // 승인된 리뷰 수 조회
                const restaurantIds = (restaurants as any[]).map(r => r.id);
                const { data: reviewCounts } = await supabase
                    .from('reviews')
                    .select('restaurant_id')
                    .in('restaurant_id', restaurantIds)
                    .eq('is_verified', true);

                // 승인된 리뷰 수 카운트
                const verifiedCountMap = new Map<string, number>();
                (reviewCounts as any[])?.forEach((r: { restaurant_id: string }) => {
                    verifiedCountMap.set(r.restaurant_id, (verifiedCountMap.get(r.restaurant_id) || 0) + 1);
                });

                // 맛집에 승인된 리뷰 수 추가
                const restaurantsWithCount = (restaurants as any[]).map(r => ({
                    ...r,
                    verified_review_count: verifiedCountMap.get(r.id) || 0
                }));

                const nextCursor = restaurants.length === 50 ? pageParam + 50 : null;
                return { restaurants: restaurantsWithCount, nextCursor };
            } catch (error) {
                console.error('맛집 데이터 조회 중 오류:', error);
                return { restaurants: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !searchQuery.trim(),
    });

    // 데이터 병합 및 필터링 로직 (hooks의 mergeRestaurants 사용)
    const rawRestaurants = useMemo(() => {
        return restaurantsData?.pages.flatMap(page => page.restaurants) || [];
    }, [restaurantsData]);

    const restaurants = useMemo(() => mergeRestaurants(rawRestaurants as any), [rawRestaurants]);
    const mergedAllRestaurants = useMemo(() => mergeRestaurants(allRestaurants as any), [allRestaurants]);

    const filteredAndSortedRestaurants = useMemo(() => {
        // 검색어가 있으면 검색 결과, 없으면 useRestaurants 훅의 전체 데이터 사용
        const sourceData = searchQuery.trim() ? mergedAllRestaurants : allMergedRestaurants;
        if (!sourceData || sourceData.length === 0) return [];

        let result = [...sourceData];

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
                        if (Array.isArray(parsed)) {
                            restaurantCategories = parsed;
                        } else {
                            restaurantCategories = [categoryData];
                        }
                    } catch {
                        restaurantCategories = [categoryData];
                    }
                }

                return filters.categories.some(filterCat => restaurantCategories.includes(filterCat));
            });
        }

        // 지역 필터
        if (filters.regions.length > 0) {
            result = result.filter(r => {
                const region = extractRegion(r.road_address, r.jibun_address);
                return filters.regions.includes(region);
            });
        }

        // 방문 여부 필터
        if (filters.showUnvisitedOnly) {
            result = result.filter(r => !isVisited(r.id));
        }

        // 리뷰 수 필터
        if (filters.fanVisitsMin > 0) {
            result = result.filter(r => (r.review_count || 0) >= filters.fanVisitsMin);
        }

        // 정렬
        if (sortColumn && sortDirection) {
            result.sort((a, b) => {
                let aValue: any;
                let bValue: any;

                switch (sortColumn) {
                    case "name":
                        aValue = a.name || "";
                        bValue = b.name || "";
                        break;
                    case "category":
                        aValue = parseCategory(a.category || (a as any).categories) || "";
                        bValue = parseCategory(b.category || (b as any).categories) || "";
                        break;
                    case "fanVisits":
                        aValue = a.review_count || 0;
                        bValue = b.review_count || 0;
                        break;
                }

                if (typeof aValue === "string") {
                    return sortDirection === "asc"
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                } else {
                    return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
                }
            });
        }

        return result;
    }, [restaurants, mergedAllRestaurants, searchQuery, filters, sortColumn, sortDirection, isVisited]);

    // --- 클라이언트 측 페이지네이션: 50개씩 표시 ---
    const [displayLimit, setDisplayLimit] = useState(50);

    // 필터 변경 시 표시 개수 리셋
    useEffect(() => {
        setDisplayLimit(50);
    }, [filters, sortColumn, sortDirection, searchQuery]);

    // 현재 표시할 맛집 목록 (displayLimit까지만)
    const displayedRestaurants = useMemo(() => {
        return filteredAndSortedRestaurants.slice(0, displayLimit);
    }, [filteredAndSortedRestaurants, displayLimit]);

    // 더 불러올 데이터가 있는지 확인
    const hasMoreToDisplay = displayLimit < filteredAndSortedRestaurants.length;

    // --- Infinite Scroll Observer ---
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const loadMoreTableRef = useRef<HTMLTableRowElement>(null);

    const loadMoreRestaurants = useCallback(() => {
        if (hasMoreToDisplay) {
            setDisplayLimit(prev => prev + 50);
        }
    }, [hasMoreToDisplay]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMoreRestaurants();
            },
            { threshold: 0.1 }
        );

        if (viewMode === 'grid' && loadMoreRef.current) observer.observe(loadMoreRef.current);
        if (viewMode === 'list' && loadMoreTableRef.current) observer.observe(loadMoreTableRef.current);

        return () => observer.disconnect();
    }, [loadMoreRestaurants, viewMode]);

    // --- Data Fetching: Reviews for Selected Restaurant ---
    const {
        data: restaurantReviewsData,
        fetchNextPage: fetchNextRestaurantReviews,
        hasNextPage: hasNextRestaurantReviewPage,
        isLoading: reviewsLoading,
        isFetchingNextPage: isFetchingNextRestaurantReviewPage,
    } = useInfiniteQuery({
        queryKey: ['restaurant-reviews', selectedRestaurant?.id],
        queryFn: async ({ pageParam = 0 }) => {
            if (!selectedRestaurant?.id) return { reviews: [], nextCursor: null };

            try {
                const { data: reviewsData, error } = await supabase
                    .from('reviews')
                    .select('*')
                    .eq('restaurant_id', selectedRestaurant.id)
                    .eq('is_verified', true)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(pageParam, pageParam + 19) as any;

                if (error) throw error;
                if (!reviewsData || reviewsData.length === 0) return { reviews: [], nextCursor: null };

                // User Profiles
                const userIds = [...new Set(reviewsData.map((r: any) => r.user_id))];
                const { data: profilesData } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .in('user_id', userIds);
                const profilesMap = new Map((profilesData as any[] || []).map(p => [p.user_id, p.nickname]));

                // Likes
                const reviewIds = reviewsData.map((r: any) => r.id);
                const { data: likesData } = await supabase
                    .from('review_likes')
                    .select('review_id, user_id')
                    .in('review_id', reviewIds) as any;

                const likesMap = new Map<string, { count: number; isLiked: boolean }>();
                reviewIds.forEach((reviewId: string) => {
                    const likesForReview = likesData?.filter((like: any) => like.review_id === reviewId) || [];
                    const isLiked = user ? likesForReview.some((like: any) => like.user_id === user.id) : false;
                    likesMap.set(reviewId, { count: likesForReview.length, isLiked });
                });

                const reviews = reviewsData.map((review: any) => {
                    const likesInfo = likesMap.get(review.id) || { count: 0, isLiked: false };
                    return {
                        id: review.id,
                        userId: review.user_id,
                        restaurantName: selectedRestaurant.name || '알 수 없음',
                        restaurantCategories: Array.isArray(selectedRestaurant.category) ? selectedRestaurant.category : [selectedRestaurant.category || '기타'],
                        userName: profilesMap.get(review.user_id) || '탈퇴한 사용자',
                        visitedAt: review.visited_at,
                        submittedAt: review.created_at || '',
                        content: review.content,
                        isVerified: review.is_verified || false,
                        isPinned: review.is_pinned || false,
                        isEditedByAdmin: review.is_edited_by_admin || false,
                        admin_note: review.admin_note || null,
                        photos: review.food_photos ? review.food_photos.map((url: string) => ({ url, type: 'food' })) : [],
                        category: review.categories?.[0] || review.category,
                        likeCount: likesInfo.count,
                        isLikedByUser: likesInfo.isLiked,
                    };
                }) as Review[];

                const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;
                return { reviews, nextCursor };
            } catch (error) {
                console.error('리뷰 데이터 조회 중 오류:', error);
                return { reviews: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? null,
        initialPageParam: 0,
        enabled: !!selectedRestaurant?.id,
    });

    const restaurantReviews = useMemo(() => {
        return restaurantReviewsData?.pages.flatMap(page => page.reviews) || [];
    }, [restaurantReviewsData]);

    const loadMoreReviewsRef = useRef<HTMLDivElement>(null);
    const loadMoreRestaurantReviews = useCallback(() => {
        if (hasNextRestaurantReviewPage && !isFetchingNextRestaurantReviewPage) {
            fetchNextRestaurantReviews();
        }
    }, [hasNextRestaurantReviewPage, isFetchingNextRestaurantReviewPage, fetchNextRestaurantReviews]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMoreRestaurantReviews();
            },
            { threshold: 0.1 }
        );
        if (loadMoreReviewsRef.current) observer.observe(loadMoreReviewsRef.current);
        return () => observer.disconnect();
    }, [loadMoreRestaurantReviews]);


    // --- Handlers ---
    const handleRestaurantClick = useCallback((restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
        setIsRightPanelVisible(true);
    }, []);

    const handleCloseRightPanel = useCallback(() => {
        setIsRightPanelVisible(false);
        setSelectedRestaurant(null);
    }, []);

    const handleSort = useCallback((column: SortColumn) => {
        setSortColumn(prev => {
            if (prev === column) {
                setSortDirection(d => d === "asc" ? "desc" : "asc");
                return column;
            } else {
                setSortDirection("asc");
                return column;
            }
        });
    }, []);

    const handleRegionToggle = useCallback((region: string) => {
        setFilters(prev => ({
            ...prev,
            regions: prev.regions.includes(region)
                ? prev.regions.filter(r => r !== region)
                : [...prev.regions, region]
        }));
    }, []);

    const toggleLike = useCallback(async (reviewId: string, currentIsLiked: boolean) => {
        if (!user) {
            console.warn('로그인이 필요합니다.');
            return;
        }
        try {
            if (currentIsLiked) {
                await supabase.from('review_likes').delete().eq('review_id', reviewId).eq('user_id', user.id);
            } else {
                await supabase.from('review_likes').insert({ review_id: reviewId, user_id: user.id } as any);

                // 리뷰 작성자에게 알림 전송 (자기 자신 제외)
                const targetReview = restaurantReviews.find(r => r.id === reviewId);
                if (targetReview && targetReview.userId && targetReview.userId !== user.id) {
                    try {
                        // 현재 사용자의 닉네임 가져오기
                        const { data: profileData } = await (supabase
                            .from('profiles') as any)
                            .select('nickname')
                            .eq('user_id', user.id)
                            .single();

                        const likerName = (profileData as any)?.nickname || '누군가';

                        await (supabase as any).rpc('create_user_notification', {
                            p_user_id: targetReview.userId,
                            p_type: 'review_like',
                            p_title: '리뷰에 좋아요가 눌렸어요!',
                            p_message: `${likerName}님이 ${selectedRestaurant?.name}에 대한 리뷰에 좋아요를 눌렀습니다.`,
                            p_data: { reviewId, restaurantId: selectedRestaurant?.id, restaurantName: selectedRestaurant?.name }
                        });
                    } catch (notifError) {
                        console.error('알림 생성 실패:', notifError);
                    }
                }
            }
            queryClient.invalidateQueries({ queryKey: ['restaurant-reviews', selectedRestaurant?.id] });
        } catch (error) {
            console.error('좋아요 토글 실패:', error);
        }
    }, [user, queryClient, selectedRestaurant, restaurantReviews]);

    const handleWriteReview = useCallback(() => {
        if (!user) {
            console.warn('로그인이 필요합니다.');
            return;
        }
        setIsReviewModalOpen(true);
    }, [user]);

    const handleReviewClick = useCallback((review: Review) => {
        setSelectedReview(review);
        setCurrentPhotoIndex(0);
    }, []);

    const handleBackFromReviewDetail = useCallback(() => {
        setSelectedReview(null);
        setCurrentPhotoIndex(0);
    }, []);

    const handlePrevPhoto = useCallback(() => {
        if (selectedReview && selectedReview.photos.length > 0) {
            setCurrentPhotoIndex(prev =>
                prev === 0 ? selectedReview.photos.length - 1 : prev - 1
            );
        }
    }, [selectedReview]);

    const handleNextPhoto = useCallback(() => {
        if (selectedReview && selectedReview.photos.length > 0) {
            setCurrentPhotoIndex(prev =>
                prev === selectedReview.photos.length - 1 ? 0 : prev + 1
            );
        }
    }, [selectedReview]);

    // --- Helpers ---
    const getSortIcon = useCallback((column: SortColumn) => {
        if (sortColumn !== column) return <ArrowUpDown className="h-4 w-4" />;
        if (sortDirection === "asc") return <ArrowUp className="h-4 w-4" />;
        return <ArrowDown className="h-4 w-4" />;
    }, [sortColumn, sortDirection]);


    const activeFilterCount =
        (filters.searchQuery ? 1 : 0) +
        filters.categories.length +
        filters.regions.length +
        (filters.showUnvisitedOnly ? 1 : 0) +
        (filters.fanVisitsMin > 0 ? 1 : 0);

    // Sync search query
    useEffect(() => {
        setSearchQuery(filters.searchQuery);
    }, [filters.searchQuery]);


    if (isRestaurantsLoading && !searchQuery) {
        return (
            <GlobalLoader
                message="도장 데이터를 불러오는 중..."
                subMessage="쯔양의 맛집 기록을 확인하고 있습니다"
            />
        );
    }

    return (
        <>
            <PanelGroup direction="horizontal" className="h-full bg-background">
                {/* Left Panel - Main Content */}
                <Panel defaultSize={isRightPanelVisible ? 70 : 100} minSize={30} className="flex flex-col min-w-0">
                    {/* Header */}
                    <div className="border-b border-border bg-card p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <div className="flex items-center gap-3">
                                    <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
                                        <Trophy className="h-6 w-6 text-primary" />
                                        쯔동여지도 도장
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 ml-1 rounded-full hover:bg-muted"
                                            onClick={() => setFilters(prev => ({ ...prev, showUnvisitedOnly: !prev.showUnvisitedOnly }))}
                                            title={filters.showUnvisitedOnly ? "모든 맛집 보기" : "안 가본 곳만 보기"}
                                        >
                                            {filters.showUnvisitedOnly ? (
                                                <EyeOff className="h-5 w-5 text-muted-foreground" />
                                            ) : (
                                                <Eye className="h-5 w-5 text-muted-foreground" />
                                            )}
                                        </Button>
                                    </h1>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">
                                    전체 {totalRestaurantCount.toLocaleString()}개
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* View Toggle */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                                    title={viewMode === 'grid' ? "리스트 뷰로 보기" : "그리드 뷰로 보기"}
                                >
                                    {viewMode === 'grid' ? <List className="h-5 w-5" /> : <Grid className="h-5 w-5" />}
                                </Button>
                            </div>
                        </div>

                        {/* Filter Controls */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                            {/* 검색 */}
                            <div className="lg:col-span-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="맛집명 검색..."
                                        value={filters.searchQuery}
                                        onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
                                        className="pl-9"
                                    />
                                </div>
                            </div>

                            {/* 지역 */}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="justify-between">
                                        <span className="truncate">
                                            지역 {filters.regions.length > 0 && `(${filters.regions.length})`}
                                        </span>
                                        <Filter className="h-4 w-4 ml-2" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80" align="start">
                                    <div className="space-y-2">
                                        <h4 className="font-semibold text-sm mb-3">지역 선택</h4>
                                        <ScrollArea className="h-64">
                                            <div className="grid grid-cols-2 gap-2 pr-3">
                                                {REGIONS.map((region) => (
                                                    <div key={region} className="flex items-center space-x-2">
                                                        <Checkbox
                                                            id={`region-${region}`}
                                                            checked={filters.regions.includes(region)}
                                                            onCheckedChange={() => handleRegionToggle(region)}
                                                        />
                                                        <label
                                                            htmlFor={`region-${region}`}
                                                            className="text-sm cursor-pointer flex-1 whitespace-nowrap"
                                                        >
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
                                    <Button variant="outline" className="justify-between">
                                        <span className="truncate">
                                            카테고리 {filters.categories.length > 0 && `(${filters.categories.length})`}
                                        </span>
                                        <Filter className="h-4 w-4 ml-2" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64" align="start">
                                    <div className="space-y-2">
                                        <h4 className="font-semibold text-sm mb-3">카테고리 선택</h4>
                                        <ScrollArea className="h-64">
                                            <div className="space-y-2 pr-3">
                                                {RESTAURANT_CATEGORIES.map((category) => (
                                                    <div key={category} className="flex items-center space-x-2">
                                                        <Checkbox
                                                            id={`category-${category}`}
                                                            checked={filters.categories.includes(category)}
                                                            onCheckedChange={() => {
                                                                setFilters(prev => ({
                                                                    ...prev,
                                                                    categories: prev.categories.includes(category)
                                                                        ? prev.categories.filter(c => c !== category)
                                                                        : [...prev.categories, category]
                                                                }));
                                                            }}
                                                        />
                                                        <label
                                                            htmlFor={`category-${category}`}
                                                            className="text-sm cursor-pointer flex-1"
                                                        >
                                                            {category}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {/* 리뷰 수 필터 */}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="justify-between">
                                        <span className="truncate">
                                            리뷰 {filters.fanVisitsMin > 0 ? `${filters.fanVisitsMin}개 이상` : "전체"}
                                        </span>
                                        <Filter className="h-4 w-4 ml-2" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80" align="start">
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center">
                                            <h4 className="font-semibold text-sm">최소 리뷰 수</h4>
                                            <span className="text-sm text-muted-foreground">{filters.fanVisitsMin}개 이상</span>
                                        </div>
                                        <Slider
                                            defaultValue={[filters.fanVisitsMin]}
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

                            {/* 필터 초기화 */}
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setFilters({
                                        searchQuery: "",
                                        categories: [],
                                        regions: [],
                                        fanVisitsMin: 0,
                                        showUnvisitedOnly: false,
                                    });
                                    setSortColumn("fanVisits");
                                    setSortDirection("desc");
                                }}
                                title="필터 초기화"
                                disabled={activeFilterCount === 0}
                                className={cn(activeFilterCount === 0 && "opacity-50 cursor-not-allowed")}
                            >
                                필터 초기화
                            </Button>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 overflow-auto p-6 bg-background">
                        {viewMode === 'grid' ? (
                            /* Grid View */
                            <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                                {displayedRestaurants.map((restaurant, index) => (
                                    <RestaurantCard
                                        key={`${restaurant.id}-${index}`}
                                        restaurant={restaurant}
                                        visited={isVisited(restaurant.id)}
                                        isSelected={selectedRestaurant?.id === restaurant.id}
                                        onClick={handleRestaurantClick}
                                    />
                                ))}
                                {/* 무한 스크롤 트리거 및 로딩 표시 */}
                                <div ref={loadMoreRef} className="col-span-full h-10 flex items-center justify-center">
                                    {hasMoreToDisplay && (
                                        <span className="text-sm text-muted-foreground">
                                            더 불러오는 중... ({displayedRestaurants.length} / {filteredAndSortedRestaurants.length}개)
                                        </span>
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* List View */
                            <div className="border rounded-lg">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background z-20">
                                        <TableRow>
                                            <TableHead className="w-[25%] min-w-[200px] cursor-pointer" onClick={() => handleSort("name")}>
                                                <div className="flex items-center gap-1">
                                                    맛집명 {getSortIcon("name")}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[15%] min-w-[100px] cursor-pointer" onClick={() => handleSort("category")}>
                                                <div className="flex items-center gap-1">
                                                    카테고리 {getSortIcon("category")}
                                                </div>
                                            </TableHead>
                                            <TableHead className="w-[50%] min-w-[250px]">주소</TableHead>
                                            <TableHead className="w-[10%] min-w-[80px] text-center cursor-pointer" onClick={() => handleSort("fanVisits")}>
                                                <div className="flex items-center justify-center gap-1">
                                                    리뷰수 {getSortIcon("fanVisits")}
                                                </div>
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {displayedRestaurants.map((restaurant) => (
                                            <RestaurantRow
                                                key={restaurant.id}
                                                restaurant={restaurant}
                                                visited={isVisited(restaurant.id)}
                                                isSelected={selectedRestaurant?.id === restaurant.id}
                                                onClick={handleRestaurantClick}
                                            />
                                        ))}
                                        {/* 무한 스크롤 트리거 및 로딩 표시 */}
                                        <TableRow ref={loadMoreTableRef}>
                                            <TableCell colSpan={4} className="h-10 text-center text-sm text-muted-foreground">
                                                {hasMoreToDisplay && `더 불러오는 중... (${displayedRestaurants.length} / ${filteredAndSortedRestaurants.length}개)`}
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        {filteredAndSortedRestaurants.length === 0 && (
                            <div className="text-center py-12">
                                <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground">검색 결과가 없습니다.</p>
                            </div>
                        )}
                    </div>
                </Panel>

                {/* Right Panel - Reviews (Desktop only) */}
                {isRightPanelVisible && isDesktop && (
                    <>
                        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
                        <Panel defaultSize={30} minSize={20} maxSize={50} className="flex flex-col border-l border-border bg-card">
                            <RestaurantReviewsPanel
                                restaurant={selectedRestaurant}
                                reviews={restaurantReviews}
                                selectedReview={selectedReview}
                                currentPhotoIndex={currentPhotoIndex}
                                cardPhotoIndexes={cardPhotoIndexes}
                                onReviewClick={handleReviewClick}
                                onBackFromDetail={handleBackFromReviewDetail}
                                onWriteReview={handleWriteReview}
                                onToggleLike={toggleLike}
                                onPrevPhoto={handlePrevPhoto}
                                onNextPhoto={handleNextPhoto}
                                onPhotoIndexChange={setCurrentPhotoIndex}
                                onCardPhotoChange={(reviewId, index) => setCardPhotoIndexes(prev => ({ ...prev, [reviewId]: index }))}
                                onClose={handleCloseRightPanel}
                                showHeader={true}
                            />
                        </Panel>
                    </>
                )}
            </PanelGroup>

            {/* Bottom Sheet - Reviews (Mobile/Tablet only) */}
            {isMobileOrTablet && (
                <BottomSheet
                    isOpen={isRightPanelVisible}
                    onClose={handleCloseRightPanel}
                    snapPoints={[30, 50, 75, 85]}
                    defaultSnap={75}
                    showHandle={true}
                    showCloseButton={false}
                >
                    <RestaurantReviewsPanel
                        restaurant={selectedRestaurant}
                        reviews={restaurantReviews}
                        selectedReview={selectedReview}
                        currentPhotoIndex={currentPhotoIndex}
                        cardPhotoIndexes={cardPhotoIndexes}
                        onReviewClick={handleReviewClick}
                        onBackFromDetail={handleBackFromReviewDetail}
                        onWriteReview={handleWriteReview}
                        onToggleLike={toggleLike}
                        onPrevPhoto={handlePrevPhoto}
                        onNextPhoto={handleNextPhoto}
                        onPhotoIndexChange={setCurrentPhotoIndex}
                        onCardPhotoChange={(reviewId, index) => setCardPhotoIndexes(prev => ({ ...prev, [reviewId]: index }))}
                        showHeader={true}
                    />
                </BottomSheet>
            )}

            {/* Review Modal */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={selectedRestaurant ? { id: selectedRestaurant.id, name: selectedRestaurant.name } : null}
                onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['restaurant-reviews', selectedRestaurant?.id] });
                    queryClient.invalidateQueries({ queryKey: ['user-stamp-reviews', user?.id] });
                }}
            />
        </>
    );
}
