'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect, useCallback, memo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, Trophy, Eye, EyeOff, MapPin, List, Grid, ChevronLeft, ChevronRight } from "lucide-react";
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
import { StampGridSkeleton } from "@/components/ui/skeleton-loaders";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { ReviewEditModal } from "@/components/reviews/ReviewEditModal";
import { useRestaurants, mergeRestaurants } from "@/hooks/use-restaurants";

import { BREAKPOINTS, useDeviceType } from "@/hooks/useDeviceType";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { RestaurantReviewsPanel } from "@/components/stamp/RestaurantReviewsPanel";
import { REGIONS, extractRegion, parseCategory, getYouTubeThumbnailUrl, StampFilterState, UserReview } from "@/components/stamp/stamp-utils";
import { StampCard } from "@/components/stamp/StampCard";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";

type SortColumn = "name" | "category" | "fanVisits";
type SortDirection = "asc" | "desc" | null;
type ViewMode = "grid" | "list";
const STAMP_GUIDE_DEMO_RESTAURANT = {
    id: "guide-stamp-demo",
    name: "명동 얼큰수제비",
    category: ["분식"],
    road_address: "서울특별시 중구",
    youtube_link: "https://www.youtube.com/watch?v=8kE5Uq_YV08",
    review_count: 17,
} as Restaurant;
const STAMP_GUIDE_DESCRIPTION = "맛집 카드에 리뷰를 남기면 이렇게 도장이 찍혀요.";

// StampFilterState 및 UserReview는 stamp-utils에서 import

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
    userAvatarUrl?: string | null;
    categories: string[];
}

// 유틸리티 함수들: stamp-utils.ts에서 import

// 리스트 아이템 컴포넌트 메모이제이션 (성능 최적화)
interface RestaurantCardProps {
    restaurant: Restaurant;
    visited: boolean;
    isUserStampsReady: boolean;
    isSelected: boolean;
    currentThumbnailIndex: number;
    onThumbnailChange: (id: string, index: number) => void;
    onClick: (restaurant: Restaurant) => void;
}

const RestaurantCard = memo(({ restaurant, visited, isUserStampsReady, isSelected, currentThumbnailIndex, onThumbnailChange, onClick }: RestaurantCardProps) => {
    // 도장 표시 여부: 방문 데이터가 준비되었고 visited가 true인 경우에만 표시
    const showStamp = isUserStampsReady && visited;
    // 병합된 YouTube 링크 배열 가져오기
    const youtubeLinks = (restaurant as any).mergedYoutubeLinks ||
        (restaurant.youtube_link ? [restaurant.youtube_link] : []);

    // 현재 인덱스의 썸네일 URL 생성
    const currentIndex = currentThumbnailIndex % youtubeLinks.length;
    const thumbnailUrl = youtubeLinks[currentIndex] ? getYouTubeThumbnailUrl(youtubeLinks[currentIndex]) : null;
    const category = parseCategory(restaurant.category || (restaurant as any).categories);

    // 다음/이전 썸네일로 이동
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

    return (
        <Card
            className={cn(
                "relative overflow-hidden transition-all duration-300 cursor-pointer group",
                showStamp ? "ring-2 ring-green-500 ring-opacity-50" : "hover:shadow-lg",
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
                                showStamp ? "grayscale opacity-60" : "group-hover:brightness-110"
                            )}
                            loading="lazy"
                        />

                        {/* 화살표 버튼 - 2개 이상의 썸네일이 있을 때만 표시 */}
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

                        {showStamp && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                {/* [라이트 모드] */}
                                <img
                                    src="/images/stamp-clear.png"
                                    alt="방문 완료"
                                    className="w-44 h-44 sm:w-52 sm:h-52 object-contain opacity-90 drop-shadow-lg dark:hidden"
                                    style={{ transform: 'rotate(-45deg)' }}
                                />
                                {/* [다크 모드] */}
                                <img
                                    src="/images/stamp-clear-dark.png"
                                    alt="방문 완료"
                                    className="w-44 h-44 sm:w-52 sm:h-52 object-contain opacity-90 drop-shadow-lg hidden dark:block"
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
    isSelected: boolean;
    onClick: (restaurant: Restaurant) => void;
}

const RestaurantRow = memo(({ restaurant, isSelected, onClick }: RestaurantRowProps) => {
    const category = parseCategory(restaurant.category || (restaurant as any).categories);
    const thumbnailUrl = restaurant.youtube_link ? getYouTubeThumbnailUrl(restaurant.youtube_link) : null;
    const reviewCount = (restaurant as any).verified_review_count ?? restaurant.review_count ?? 0;

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
            <TableCell className="text-center">{reviewCount}</TableCell>
        </TableRow>
    );
});
RestaurantRow.displayName = 'RestaurantRow';

export default function StampPage() {
    const { user, isLoading: authLoading } = useAuth();
    const queryClient = useQueryClient();
    const router = useRouter();
    // const { isMobileOrTablet, isDesktop } = useDeviceType(); // Hook check replaced
    const { isMobileOrTablet, isDesktop } = useDeviceType(); // Keep for logic usage later, but NOT for redirect
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);

        const redirectIfDesktop = () => {
            if (window.innerWidth > BREAKPOINTS.tabletMax) {
                router.replace('/');
            }
        };

        redirectIfDesktop();
        window.addEventListener('resize', redirectIfDesktop, { passive: true });

        return () => {
            window.removeEventListener('resize', redirectIfDesktop);
        };
    }, [router]);

    // --- 상태 (State) ---
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [searchQuery, setSearchQuery] = useState("");
    const [filters, setFilters] = useState<StampFilterState>({
        searchQuery: "",
        categories: [],
        regions: [],
        fanVisitsMin: 0,
        showUnvisitedOnly: false,
    });
    const [sortColumn, setSortColumn] = useState<SortColumn>("fanVisits");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    // 모바일/태블릿 필터 확장 상태
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);

    // 우측 패널 상태
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [isRightPanelVisible, setIsRightPanelVisible] = useState(false);

    // 리뷰 모달 상태
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [showStampGuide, setShowStampGuide] = useState(false);
    const [editingReview, setEditingReview] = useState<{
        id: string;
        restaurantId: string;
        restaurantName: string;
        content: string;
        categories: string[];
        foodPhotos: string[];
        isVerified: boolean;
        adminNote: string | null;
    } | null>(null);

    // 리뷰 상세 상태
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [cardPhotoIndexes, setCardPhotoIndexes] = useState<Record<string, number>>({});

    // 카드별 썸네일 인덱스 상태 (병합된 맛집의 여러 썸네일 중 현재 표시 중인 인덱스)
    const [cardThumbnailIndexes, setCardThumbnailIndexes] = useState<Record<string, number>>({});

    // --- 데이터 패칭: 사용자 도장 정보 ---
    const {
        data: userReviewData = [],
        isLoading: isUserStampsLoading,
        isFetching: isUserStampsFetching,
        isFetched: isUserStampsFetched,
    } = useQuery({
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

    // 사용자 도장 데이터 상태
    const userReviews = useMemo(() => {
        if (!user?.id || userReviewData.length === 0) {
            return new Set<string>();
        }

        return new Set(userReviewData.map(review => review.restaurant_id));
    }, [user?.id, userReviewData]);

    // 사용자 방문 데이터 준비 완료 상태 (비로그인 또는 로딩 완료)
    const isUserStampsReady = !user?.id || isUserStampsFetched;
    const shouldWaitForStampState = !!user?.id && !isUserStampsFetched;

    const isVisited = useCallback((restaurantId: string) => {
        return userReviews.has(restaurantId);
    }, [userReviews]);

    // --- 데이터 패칭: 맛집 정보 ---
    // 병합된 전체 맛집 수 조회 (useRestaurants 훅 사용 - 병합 로직 적용됨)
    const { data: allMergedRestaurants = [] } = useRestaurants({ enabled: true });
    const totalRestaurantCount = allMergedRestaurants.length;

    // 검색 시 사용할 전체 맛집 데이터 조회 (RPC 함수 사용)
    const { data: allRestaurants = [] } = useQuery({
        queryKey: ['all-restaurants', searchQuery],
        queryFn: async () => {
            if (!searchQuery.trim()) return [];
            try {
                // NOTE: DB RPC(search_restaurants_by_name)가 스키마 드리프트로 실패할 수 있어
                // restaurants 테이블을 직접 조회합니다. (approved_name -> name alias)
                const { data: restaurants, error } = await supabase
                    .from('restaurants')
                    .select('id, name:approved_name, approved_name, road_address, jibun_address, english_address, phone, categories, youtube_link, tzuyang_review, youtube_meta, lat, lng, status, created_at, updated_at, review_count')
                    .eq('status', 'approved')
                    .ilike('approved_name', `%${searchQuery.trim()}%`)
                    .order('review_count', { ascending: false })
                    .limit(100);
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
        isLoading: isRestaurantsLoading,
    } = useInfiniteQuery({
        queryKey: ['restaurants-stamp'],
        queryFn: async ({ pageParam = 0 }) => {
            const STAMP_PAGE_SIZE = 15;

            try {
                const { data: restaurants, error } = await supabase
                    .from('restaurants')
                    .select('*')
                    .eq('status', 'approved')
                    .order('review_count', { ascending: false })
                    .range(pageParam, pageParam + (STAMP_PAGE_SIZE - 1));

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

                const nextCursor = restaurants.length === STAMP_PAGE_SIZE ? pageParam + STAMP_PAGE_SIZE : null;
                return { restaurants: restaurantsWithCount, nextCursor };
            } catch (error) {
                console.error('맛집 데이터 조회 중 오류:', error);
                return { restaurants: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
        initialPageParam: 0,
        enabled: !searchQuery.trim(),
    });

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
        if ((filters.fanVisitsMin ?? 0) > 0) {
            result = result.filter(r => (r.review_count || 0) >= (filters.fanVisitsMin ?? 0));
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
    }, [allMergedRestaurants, mergedAllRestaurants, searchQuery, filters, sortColumn, sortDirection, isVisited]);

    // --- 클라이언트 측 페이지네이션: 15개씩 표시 (성능 최적화: 렌더링 부하 감소) ---
    const [displayLimit, setDisplayLimit] = useState(15);

    // 필터 변경 시 표시 개수 리셋
    useEffect(() => {
        setDisplayLimit(15);
    }, [filters, sortColumn, sortDirection, searchQuery]);

    const guideSlotCount = showStampGuide ? 1 : 0;
    const displayedRestaurants = useMemo(() => {
        return filteredAndSortedRestaurants.slice(0, displayLimit);
    }, [filteredAndSortedRestaurants, displayLimit]);
    const displayedGridRestaurants = useMemo(() => {
        return filteredAndSortedRestaurants.slice(0, Math.max(displayLimit - guideSlotCount, 0));
    }, [filteredAndSortedRestaurants, displayLimit, guideSlotCount]);
    const displayedCards = useMemo(() => {
        if (!showStampGuide) return displayedGridRestaurants;
        return [STAMP_GUIDE_DEMO_RESTAURANT, ...displayedGridRestaurants];
    }, [showStampGuide, displayedGridRestaurants]);

    // 더 불러올 데이터가 있는지 확인
    const hasMoreToDisplay = displayLimit < filteredAndSortedRestaurants.length;

    // --- 무한 스크롤 옵저버 (Infinite Scroll Observer) ---
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const loadMoreTableRef = useRef<HTMLTableRowElement>(null);

    const loadMoreRestaurants = useCallback(() => {
        if (hasMoreToDisplay) {
            setDisplayLimit(prev => prev + 15);
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

    // --- 데이터 패칭: 선택된 맛집의 리뷰 ---
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
            const REVIEW_PAGE_SIZE = 15;

            try {
                const { data: reviewsData, error } = await supabase
                    .from('reviews')
                    .select('*')
                    .eq('restaurant_id', selectedRestaurant.id)
                    .eq('is_verified', true)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(pageParam, pageParam + (REVIEW_PAGE_SIZE - 1)) as any;

                if (error) throw error;
                if (!reviewsData || reviewsData.length === 0) return { reviews: [], nextCursor: null };

                // 사용자 프로필 정보 조회
                const userIds = [...new Set(reviewsData.map((r: any) => r.user_id))];
                const { data: profilesData } = await supabase
                    .from('profiles')
                    .select('user_id, nickname, avatar_url')
                    .in('user_id', userIds);
                const profilesMap = new Map((profilesData as any[] || []).map(p => [p.user_id, { nickname: p.nickname, avatarUrl: p.avatar_url }]));

                // 좋아요 정보 조회 (최적화)
                const reviewIds = reviewsData.map((r: any) => r.id);
                let userLikesMap = new Map<string, boolean>();

                if (user) {
                    const { data: userLikesData } = await supabase
                        .from('review_likes')
                        .select('review_id')
                        .in('review_id', reviewIds)
                        .eq('user_id', user.id) as any;

                    userLikesMap = new Map(
                        (userLikesData || []).map((like: any) => [like.review_id, true])
                    );
                }

                const reviews = reviewsData.map((review: any) => {
                    return {
                        id: review.id,
                        userId: review.user_id,
                        restaurantName: selectedRestaurant.name || '알 수 없음',
                        restaurantCategories: Array.isArray(selectedRestaurant.category) ? selectedRestaurant.category : [selectedRestaurant.category || '기타'],
                        userName: profilesMap.get(review.user_id)?.nickname || '탈퇴한 사용자',
                        userAvatarUrl: profilesMap.get(review.user_id)?.avatarUrl,
                        visitedAt: review.visited_at,
                        submittedAt: review.created_at || '',
                        content: review.content,
                        isVerified: review.is_verified || false,
                        isPinned: review.is_pinned || false,
                        isEditedByAdmin: review.is_edited_by_admin || false,
                        admin_note: review.admin_note || null,
                        photos: review.food_photos ? review.food_photos.map((url: string) => ({ url, type: 'food' })) : [],
                        category: (Array.isArray(review.categories) && review.categories.length > 0) ? review.categories[0] : (review.category || ''),
                        categories: (Array.isArray(review.categories) && review.categories.length > 0)
                            ? review.categories
                            : (review.category ? [review.category] : []),
                        likeCount: review.like_count || 0, // 캐시된 값 사용
                        isLikedByUser: userLikesMap.get(review.id) || false,
                    };
                }) as Review[];

                const nextCursor = reviewsData.length === REVIEW_PAGE_SIZE ? pageParam + REVIEW_PAGE_SIZE : null;
                return { reviews, nextCursor };
            } catch (error) {
                console.error('리뷰 데이터 조회 중 오류:', error);
                return { reviews: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
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


    // --- 핸들러 (Handlers) ---
    const handleRestaurantClick = useCallback(async (restaurant: Restaurant) => {
        if (isMobileOrTablet) {
            // [MOBILE] Open Bottom Sheet instead of navigating
            setSelectedRestaurant(restaurant);
            setIsRightPanelVisible(true);

            // Fetch reviews for the selected restaurant (if using existing state)
            // Note: RestaurantReviewsPanel usually fetches or displays provided reviews.
            // Check if we need to manually trigger fetch here or if existing effect handles 'selectedRestaurant'.
            // Based on code, we probably rely on `selectedRestaurant` state change to trigger queries?
            // Need to verify. But first step is preventing router push.
        } else {
            // [DESKTOP] Open Right Panel
            setSelectedRestaurant(restaurant);

            // 리뷰 데이터 prefetch로 바텀 시트 열리기 전에 미리 로드
            // [FIX] prefetchInfiniteQuery causing crash on mobile/tablet. Disabled for stability.
            // await queryClient.prefetchInfiniteQuery({...});

            // prefetch 완료 후 바텀 시트 열기
            setIsRightPanelVisible(true);
        }
    }, [isMobileOrTablet]);

    const handleBottomSheetRestaurantSwipe = useCallback((direction: 'prev' | 'next') => {
        const candidates = displayedRestaurants.length > 0 ? displayedRestaurants : filteredAndSortedRestaurants;
        if (!selectedRestaurant || !isRightPanelVisible || candidates.length <= 1) return;

        const currentIndex = candidates.findIndex((restaurant) => restaurant.id === selectedRestaurant.id);
        if (currentIndex === -1) return;

        let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
        if (nextIndex < 0) {
            nextIndex = candidates.length - 1;
        } else if (nextIndex >= candidates.length) {
            nextIndex = 0;
        }

        const nextRestaurant = candidates[nextIndex];
        if (!nextRestaurant) return;

        setSelectedRestaurant(nextRestaurant);
        setSelectedReview(null);
        setCurrentPhotoIndex(0);
        setIsRightPanelVisible(true);
    }, [displayedRestaurants, filteredAndSortedRestaurants, isRightPanelVisible, selectedRestaurant]);

    const handleBottomSheetSwipeLeft = useCallback(() => {
        handleBottomSheetRestaurantSwipe('next');
    }, [handleBottomSheetRestaurantSwipe]);

    const handleBottomSheetSwipeRight = useCallback(() => {
        handleBottomSheetRestaurantSwipe('prev');
    }, [handleBottomSheetRestaurantSwipe]);

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

    const handleCardThumbnailChange = useCallback((id: string, index: number) => {
        setCardThumbnailIndexes(prev => ({ ...prev, [id]: index }));
    }, []);

    const handleReviewCardPhotoChange = useCallback((reviewId: string, index: number) => {
        setCardPhotoIndexes(prev => ({ ...prev, [reviewId]: index }));
    }, []);

    const completeStampGuide = useCallback(() => {
        setShowStampGuide(false);
    }, []);

    const dismissStampGuide = useCallback(() => {
        setShowStampGuide(false);
    }, []);

    const handleGuideThumbnailChange = useCallback(() => {}, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        if (!user?.id) {
            setShowStampGuide(true);
            return;
        }

        if (authLoading || isUserStampsLoading || isUserStampsFetching || !isUserStampsFetched) {
            setShowStampGuide(false);
            return;
        }

        setShowStampGuide(userReviews.size === 0);
    }, [authLoading, user?.id, userReviews.size, isUserStampsLoading, isUserStampsFetching, isUserStampsFetched]);

    // --- 헬퍼 함수 (Helpers) ---
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
        ((filters.fanVisitsMin ?? 0) > 0 ? 1 : 0);

    // 검색어 동기화 (Sync search query)
    useEffect(() => {
        setSearchQuery(filters.searchQuery);
    }, [filters.searchQuery]);



    // [Check before render]
    if (!isMounted) return null;
    if (typeof window !== 'undefined' && window.innerWidth > BREAKPOINTS.tabletMax) return null;

    return (
        <>
            <PanelGroup direction="horizontal" className="h-full bg-background" data-testid="stamp-page-container">
                {/* 왼쪽 패널 - 메인 콘텐츠 */}
                <Panel id="main-list-panel" order={1} defaultSize={isRightPanelVisible ? 70 : 100} minSize={30} className="overflow-hidden">
                    {/* 스크롤 컨테이너 */}
                    <div className="h-full overflow-y-auto flex flex-col [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                        {/* Header */}
                        <div className="border-b border-border bg-background p-4 sm:p-6 shrink-0">
                            <div className="flex items-center justify-between">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <h1 className="text-[1.125rem] xs:text-xl sm:text-2xl font-bold text-primary flex items-center gap-1.5 sm:gap-2 whitespace-nowrap min-w-0">
                                            <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
                                            <span className="whitespace-nowrap">쯔동여지도 도장</span>
                                        </h1>
                                        <span className="text-xs xs:text-sm font-normal text-muted-foreground whitespace-nowrap shrink-0">
                                            ({totalRestaurantCount.toLocaleString()}개)
                                        </span>
                                    </div>
                                    <p className="text-xs xs:text-sm text-muted-foreground mt-1 whitespace-nowrap">
                                        맛집을 찾아 도장을 찍어보세요!
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Unvisited Only Toggle */}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-full hover:bg-muted"
                                        onClick={() => setFilters(prev => ({ ...prev, showUnvisitedOnly: !prev.showUnvisitedOnly }))}
                                        title={filters.showUnvisitedOnly ? "모든 맛집 보기" : "안 가본 곳만 보기"}
                                    >
                                        {filters.showUnvisitedOnly ? (
                                            <EyeOff className="h-5 w-5 text-muted-foreground" />
                                        ) : (
                                            <Eye className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </Button>
                                    {/* Filter Toggle - 모바일/태블릿에서만 헤더에 표시 */}
                                    {isMobileOrTablet && (
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
                                    )}
                                    {/* View Toggle - 데스크톱에서만 표시 */}
                                    {!isMobileOrTablet && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                                            title={viewMode === 'grid' ? "리스트 뷰로 보기" : "그리드 뷰로 보기"}
                                        >
                                            {viewMode === 'grid' ? <List className="h-5 w-5" /> : <Grid className="h-5 w-5" />}
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* 필터 컨트롤 (Filter Controls) */}
                            {/* 모바일/태블릿: 필터 토글 버튼 */}


                            {/* 필터 컨트롤 그리드 - 데스크톱에서는 항상 표시, 모바일/태블릿에서는 확장시에만 표시 */}
                            <div className={cn(
                                "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 mt-4 transition-all duration-300 overflow-hidden",
                                isMobileOrTablet && !isFilterExpanded && "hidden"
                            )}>
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
                                                리뷰 {(filters.fanVisitsMin ?? 0) > 0 ? `${filters.fanVisitsMin}개 이상` : "전체"}
                                            </span>
                                            <Filter className="h-4 w-4 ml-2" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-80" align="start">
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-center">
                                                <h4 className="font-semibold text-sm">최소 리뷰 수</h4>
                                                <span className="text-sm text-muted-foreground">{filters.fanVisitsMin ?? 0}개 이상</span>
                                            </div>
                                            <Slider
                                                defaultValue={[filters.fanVisitsMin ?? 0]}
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

                        <div className="flex-1 min-h-0 px-4 sm:px-6 pt-6 pb-[calc(var(--mobile-bottom-nav-height,60px)+1.5rem)] md:pb-6 bg-background">
                            {(isRestaurantsLoading && !searchQuery) ? (
                                <StampGridSkeleton count={16} showHeader={false} />
                            ) : shouldWaitForStampState ? (
                                <StampGridSkeleton count={15} showHeader={false} />
                            ) : viewMode === 'grid' ? (
                                /* 그리드 뷰 (Grid View) */
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4">
                                    {displayedCards.map((restaurant) => {
                                        const isGuideCard = restaurant.id === STAMP_GUIDE_DEMO_RESTAURANT.id;
                                        if (isGuideCard) {
                                            return (
                                                <StampCard
                                                    key={restaurant.id}
                                                    restaurant={restaurant}
                                                    isVisited={true}
                                                    isUserStampsReady={true}
                                                    currentThumbnailIndex={0}
                                                    onThumbnailChange={handleGuideThumbnailChange}
                                                    onClick={() => {}}
                                                    size={isDesktop ? "compact" : "default"}
                                                    guideLabel="가이드"
                                                    isGuideCard={true}
                                                    guideTitle={STAMP_GUIDE_DEMO_RESTAURANT.name}
                                                    guideDescription={STAMP_GUIDE_DESCRIPTION}
                                                    onGuideClose={dismissStampGuide}
                                                />
                                            );
                                        }

                                        const currentIndex = cardThumbnailIndexes[restaurant.id] || 0;
                                        return (
                                            <RestaurantCard
                                                key={restaurant.id}
                                                restaurant={restaurant}
                                                visited={isVisited(restaurant.id)}
                                                isUserStampsReady={isUserStampsReady}
                                                isSelected={selectedRestaurant?.id === restaurant.id}
                                                currentThumbnailIndex={currentIndex}
                                                onThumbnailChange={handleCardThumbnailChange}
                                                onClick={handleRestaurantClick}
                                            />
                                        );
                                    })}
                                    {/* 무한 스크롤 트리거 및 로딩 표시 */}
                                    <div ref={loadMoreRef} className="col-span-full h-10 flex items-center justify-center">
                                        {hasMoreToDisplay && (
                                            <span className="text-sm text-muted-foreground">
                                                더 불러오는 중... ({displayedCards.length} / {filteredAndSortedRestaurants.length}개)
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                /* 리스트 뷰 (List View) */
                                <div className="border rounded-lg">
                                    <Table allowHorizontalScroll>
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
                        </div>
                    </div>{/* End Scroll Container */}
                </Panel>

                {/* 오른쪽 패널 - 리뷰 (데스크톱 전용) */}
                {isRightPanelVisible && isDesktop && (
                    <>
                        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
                        <Panel id="review-detail-panel" order={2} defaultSize={30} minSize={20} maxSize={50} className="flex flex-col border-l border-border bg-card">
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
                                onCardPhotoChange={handleReviewCardPhotoChange}
                                onClose={handleCloseRightPanel}
                                showHeader={true}
                                isLoading={reviewsLoading}
                                currentUserId={user?.id}
                                onEditReview={(reviewData) => setEditingReview({
                                    ...reviewData,
                                    restaurantId: selectedRestaurant?.id || '',
                                })}
                            />
                        </Panel>
                    </>
                )}
            </PanelGroup>

            {/* 바텀 시트 - 리뷰 (모바일/태블릿 전용) */}
            {isMobileOrTablet && isRightPanelVisible && selectedRestaurant && (
                <BottomSheet
                    key={selectedRestaurant.id}
                    isOpen={isRightPanelVisible}
                    onClose={handleCloseRightPanel}
                    defaultHeight={50}
                    minHeight={50}
                    headerOffset={80}   // 헤더(64px) + 여백(16px) 공간 확보
                    bottomNavOffset={64} // 하단 네비게이션(56px) 공간 확보
                    disableContentScroll={true} // 내부 패널 스크롤 사용
                    showCloseButton={true}
                    className="p-0"
                >
                    <RestaurantDetailPanel
                        restaurant={selectedRestaurant}
                        onClose={handleCloseRightPanel}
                        onWriteReview={handleWriteReview}
                        isPanelOpen={isRightPanelVisible}
                        isMobile={true}
                        onSwipeLeft={handleBottomSheetSwipeLeft}
                        onSwipeRight={handleBottomSheetSwipeRight}
                        className="h-full shadow-none border-0 overflow-hidden"
                    />
                </BottomSheet>
            )}

            {/* 리뷰 모달 (Review Modal) */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={selectedRestaurant ? { id: selectedRestaurant.id, name: selectedRestaurant.name } : null}
                onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['restaurant-reviews', selectedRestaurant?.id] });
                    queryClient.invalidateQueries({ queryKey: ['user-stamp-reviews', user?.id] });
                    completeStampGuide();
                }}
            />

            {/* 리뷰 수정 모달 (Review Edit Modal) */}
            <ReviewEditModal
                isOpen={!!editingReview}
                onClose={() => setEditingReview(null)}
                review={editingReview}
                onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['restaurant-reviews', selectedRestaurant?.id] });
                    setEditingReview(null);
                }}
            />
        </>
    );
}
