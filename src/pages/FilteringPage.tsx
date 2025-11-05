import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, MessageSquare, User, Calendar, CheckCircle, XCircle, Clock, Pin, Heart, Menu } from "lucide-react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { RESTAURANT_CATEGORIES, Restaurant } from "@/types/restaurant";
import { useRestaurants } from "@/hooks/use-restaurants";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

// 지역 목록
const REGIONS = [
    "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산",
    "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
    "미국", "일본", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
];

type SortColumn = "name" | "category" | "fanVisits";
type SortDirection = "asc" | "desc" | null;

interface FilterState {
    searchQuery: string;
    categories: string[];
    regions: string[];
    fanVisitsMin: number;
}

interface FilteringPageProps {
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

interface Review {
    id: string;
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

const FilteringPage = ({ onAdminEditRestaurant }: FilteringPageProps) => {
    const { isAdmin, user } = useAuth();
    const queryClient = useQueryClient();

    // 검색어 상태를 별도로 관리 (의존성 순환 방지)
    const [searchQuery, setSearchQuery] = useState("");

    // 검색 시 사용할 전체 맛집 데이터 조회
    const { data: allRestaurants = [], isLoading: isLoadingAllRestaurants } = useQuery({
        queryKey: ['all-restaurants', searchQuery],
        queryFn: async () => {
            if (!searchQuery.trim()) return [];

            try {
                const { data: restaurants, error } = await supabase
                    .from('restaurants')
                    .select('*')
                    .ilike('name', `%${searchQuery}%`) // 데이터베이스 레벨에서 검색
                    .order('created_at', { ascending: false });

                if (error) {
                    console.error('전체 맛집 조회 실패:', error);
                    return [];
                }

                return restaurants || [];
            } catch (error) {
                console.error('전체 맛집 데이터 조회 중 오류:', error);
                return [];
            }
        },
        enabled: !!searchQuery.trim(), // 검색어가 있을 때만 실행
    });

    // 기본 맛집 데이터 무한 스크롤 조회 (검색어가 없을 때만)
    const {
        data: restaurantsData,
        fetchNextPage: fetchNextRestaurants,
        hasNextPage: hasNextRestaurantPage,
        isLoading,
        isFetchingNextPage: isFetchingNextRestaurantPage,
    } = useInfiniteQuery({
        queryKey: ['restaurants'],
        queryFn: async ({ pageParam = 0 }) => {
            try {
                const { data: restaurants, error } = await supabase
                    .from('restaurants')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .range(pageParam, pageParam + 49); // 한 페이지당 50개씩

                if (error) {
                    console.error('맛집 조회 실패:', error);
                    return { restaurants: [], nextCursor: null };
                }

                if (!restaurants || restaurants.length === 0) {
                    return { restaurants: [], nextCursor: null };
                }

                // 다음 페이지 커서 계산
                const nextCursor = restaurants.length === 50 ? pageParam + 50 : null;

                return {
                    restaurants,
                    nextCursor,
                };
            } catch (error) {
                console.error('맛집 데이터 조회 중 오류:', error);
                return { restaurants: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !searchQuery.trim(), // 검색어가 없을 때만 실행
    });


    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const restaurants = restaurantsData?.pages.flatMap(page => page.restaurants) || [];

    // 테이블 무한 스크롤을 위한 Intersection Observer
    const loadMoreTableRef = useRef<HTMLTableRowElement>(null);

    const loadMoreRestaurants = useCallback(() => {
        if (hasNextRestaurantPage && !isFetchingNextRestaurantPage) {
            fetchNextRestaurants();
        }
    }, [hasNextRestaurantPage, isFetchingNextRestaurantPage, fetchNextRestaurants]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreRestaurants();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreTableRef.current) {
            observer.observe(loadMoreTableRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreRestaurants]);

    const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isRightPanelVisible, setIsRightPanelVisible] = useState(true);

    // 좋아요 토글 함수
    const toggleLike = async (reviewId: string, currentIsLiked: boolean, currentLikeCount: number) => {
        if (!user) {
            // 로그인하지 않은 경우 처리 (토스트 메시지 등)
            console.warn('로그인이 필요합니다.');
            return;
        }

        try {
            if (currentIsLiked) {
                // 좋아요 취소
                const { error } = await supabase
                    .from('review_likes')
                    .delete()
                    .eq('review_id', reviewId)
                    .eq('user_id', user.id);

                if (error) throw error;
            } else {
                // 좋아요 추가
                const { error } = await supabase
                    .from('review_likes')
                    .insert({
                        review_id: reviewId,
                        user_id: user.id,
                    });

                if (error) throw error;
            }

            // 쿼리 무효화하여 데이터 새로고침
            queryClient.invalidateQueries({ queryKey: ['top-liked-reviews'] });
            queryClient.invalidateQueries({ queryKey: ['restaurant-reviews', selectedRestaurant?.id] });
        } catch (error) {
            console.error('좋아요 토글 실패:', error);
        }
    };

    // 전체 리뷰 중 좋아요가 가장 많은 리뷰들 조회 (무한 스크롤)
    const {
        data: topLikedReviewsData,
        fetchNextPage,
        hasNextPage: hasNextTopReviewPage,
        isLoading: topReviewsLoading,
        isFetchingNextPage: isFetchingNextTopReviewPage,
    } = useInfiniteQuery({
        queryKey: ['top-liked-reviews'],
        queryFn: async ({ pageParam = 0 }) => {
            try {
                // 1. 승인된 모든 리뷰 조회 (페이지네이션 적용)
                const { data: allReviews, error: reviewsError } = await supabase
                    .from('reviews')
                    .select('*')
                    .eq('is_verified', true)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(pageParam, pageParam + 19); // 한 페이지당 20개씩

                if (reviewsError) {
                    console.error('전체 리뷰 조회 실패:', reviewsError);
                    return { reviews: [], nextCursor: null };
                }

                if (!allReviews || allReviews.length === 0) {
                    return { reviews: [], nextCursor: null };
                }

                // 2. 필요한 user_id 수집
                const userIds = [...new Set(allReviews.map(r => r.user_id))];

                // 3. Profiles 가져오기
                const { data: profilesData } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .in('user_id', userIds);

                // 4. Map으로 변환
                const profilesMap = new Map(
                    (profilesData || []).map(p => [p.user_id, p.nickname])
                );

                // 5. 리뷰 좋아요 데이터 조회
                const reviewIds = allReviews.map(r => r.id);
                let likesData: any[] = [];
                try {
                    const { data, error } = await supabase
                        .from('review_likes')
                        .select('review_id, user_id')
                        .in('review_id', reviewIds);

                    if (!error && data) {
                        likesData = data;
                    }
                } catch (error) {
                    console.warn('review_likes 테이블이 존재하지 않음, 좋아요 수를 0으로 설정합니다:', error);
                }

                // 6. 좋아요 수와 사용자 좋아요 상태 계산
                const reviewsWithLikes = allReviews.map(review => {
                    const likesForReview = likesData?.filter(like => like.review_id === review.id) || [];
                    const isLikedByUser = user ? likesForReview.some(like => like.user_id === user.id) : false;
                    return {
                        ...review,
                        likeCount: likesForReview.length,
                        userName: profilesMap.get(review.user_id) || '탈퇴한 사용자',
                        restaurantName: '알 수 없음', // 전체 리뷰에서는 맛집 이름 표시 안 함
                        restaurantCategories: [],
                        visitedAt: review.visited_at,
                        submittedAt: review.created_at || '',
                        content: review.content,
                        isVerified: review.is_verified || false,
                        isPinned: review.is_pinned || false,
                        isEditedByAdmin: review.is_edited_by_admin || false,
                        admin_note: review.admin_note || null,
                        photos: review.food_photos ? review.food_photos.map((url: string) => ({ url, type: 'food' })) : [],
                        category: review.categories?.[0] || review.category,
                        isLikedByUser,
                    } as Review;
                });

                // 7. 다음 페이지 커서 계산 (20개씩 가져왔으므로 다음은 pageParam + 20)
                const nextCursor = allReviews.length === 20 ? pageParam + 20 : null;

                return {
                    reviews: reviewsWithLikes,
                    nextCursor,
                };

            } catch (error) {
                console.error('인기 리뷰 조회 중 오류:', error);
                return { reviews: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
    });


    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const topLikedReviews = topLikedReviewsData?.pages.flatMap(page => page.reviews) || [];

    // 좋아요 수로 정렬 (실시간 정렬)
    const sortedTopLikedReviews = [...topLikedReviews].sort((a, b) => b.likeCount - a.likeCount);

    // 인기 리뷰 무한 스크롤을 위한 Intersection Observer
    const loadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreTopReviews = useCallback(() => {
        if (hasNextTopReviewPage && !isFetchingNextTopReviewPage) {
            fetchNextPage();
        }
    }, [hasNextTopReviewPage, isFetchingNextTopReviewPage, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreTopReviews();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreTopReviews]);

    // 선택된 맛집의 리뷰 조회 (무한 스크롤)
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
                    .range(pageParam, pageParam + 19); // 한 페이지당 20개씩

                if (error) {
                    console.error('리뷰 조회 실패:', error);
                    return { reviews: [], nextCursor: null };
                }

                if (!reviewsData || reviewsData.length === 0) {
                    return { reviews: [], nextCursor: null };
                }

                // 필요한 user_id 수집
                const userIds = [...new Set(reviewsData.map(r => r.user_id))];

                // Profiles 가져오기
                const { data: profilesData } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .in('user_id', userIds);

                // Map으로 변환
                const profilesMap = new Map(
                    (profilesData || []).map(p => [p.user_id, p.nickname])
                );

                // 리뷰 좋아요 데이터 조회
                const reviewIds = reviewsData.map(r => r.id);
                let likesData: any[] = [];
                try {
                    const { data, error } = await supabase
                        .from('review_likes')
                        .select('review_id, user_id')
                        .in('review_id', reviewIds);

                    if (!error && data) {
                        likesData = data;
                    }
                } catch (error) {
                    console.warn('review_likes 테이블이 존재하지 않음, 좋아요 수를 0으로 설정합니다:', error);
                }

                // 좋아요 수와 사용자 좋아요 상태 계산
                const likesMap = new Map<string, { count: number; isLiked: boolean }>();
                reviewIds.forEach(reviewId => {
                    const likesForReview = likesData?.filter(like => like.review_id === reviewId) || [];
                    const isLiked = user ? likesForReview.some(like => like.user_id === user.id) : false;
                    likesMap.set(reviewId, {
                        count: likesForReview.length,
                        isLiked,
                    });
                });

                // 리뷰 데이터 매핑
                const reviews = reviewsData.map(review => {
                    const likesInfo = likesMap.get(review.id) || { count: 0, isLiked: false };
                    return {
                        id: review.id,
                        restaurantName: selectedRestaurant.name || '알 수 없음',
                        restaurantCategories: Array.isArray(selectedRestaurant.category)
                            ? selectedRestaurant.category
                            : [selectedRestaurant.category || '기타'],
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

                // 다음 페이지 커서 계산
                const nextCursor = reviewsData.length === 20 ? pageParam + 20 : null;

                return {
                    reviews,
                    nextCursor,
                };
            } catch (error) {
                console.error('리뷰 데이터 조회 중 오류:', error);
                return { reviews: [], nextCursor: null };
            }
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
        enabled: !!selectedRestaurant?.id,
    });


    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const restaurantReviews = restaurantReviewsData?.pages.flatMap(page => page.reviews) || [];

    // 선택된 맛집 리뷰 무한 스크롤을 위한 Intersection Observer
    const loadMoreRestaurantRef = useRef<HTMLDivElement>(null);

    const loadMoreRestaurantReviews = useCallback(() => {
        if (hasNextRestaurantReviewPage && !isFetchingNextRestaurantReviewPage) {
            fetchNextRestaurantReviews();
        }
    }, [hasNextRestaurantReviewPage, isFetchingNextRestaurantReviewPage, fetchNextRestaurantReviews]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreRestaurantReviews();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRestaurantRef.current) {
            observer.observe(loadMoreRestaurantRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreRestaurantReviews]);

    const [filters, setFilters] = useState<FilterState>({
        searchQuery: "",
        categories: [],
        regions: [],
        fanVisitsMin: 0,
    });

    // filters의 searchQuery가 변경될 때 searchQuery state도 동기화
    useEffect(() => {
        setSearchQuery(filters.searchQuery);
    }, [filters.searchQuery]);

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            if (sortDirection === "asc") {
                setSortDirection("desc");
            } else if (sortDirection === "desc") {
                setSortColumn(null);
                setSortDirection(null);
            } else {
                setSortDirection("asc");
            }
        } else {
            setSortColumn(column);
            setSortDirection("asc");
        }
    };

    const getSortIcon = (column: SortColumn) => {
        if (sortColumn !== column) return <ArrowUpDown className="h-4 w-4" />;
        if (sortDirection === "asc") return <ArrowUp className="h-4 w-4" />;
        if (sortDirection === "desc") return <ArrowDown className="h-4 w-4" />;
        return <ArrowUpDown className="h-4 w-4" />;
    };

    const handleCategoryToggle = (category: string) => {
        setFilters(prev => ({
            ...prev,
            categories: prev.categories.includes(category)
                ? prev.categories.filter(c => c !== category)
                : [...prev.categories, category]
        }));
    };

    const handleRegionToggle = (region: string) => {
        setFilters(prev => ({
            ...prev,
            regions: prev.regions.includes(region)
                ? prev.regions.filter(r => r !== region)
                : [...prev.regions, region]
        }));
    };

    const handleResetFilters = () => {
        setFilters({
            searchQuery: "",
            categories: [],
            regions: [],
            fanVisitsMin: 0,
        });
        setSortColumn(null);
        setSortDirection(null);
    };

    // 주소에서 지역 추출 함수
    const extractRegion = (address: string): string => {
        if (!address) return "";

        // 시/도 패턴 매칭
        const regionPatterns = [
            { pattern: /^서울/, region: "서울" },
            { pattern: /^경기도|^경기/, region: "경기" },
            { pattern: /^인천/, region: "인천" },
            { pattern: /^부산/, region: "부산" },
            { pattern: /^대구/, region: "대구" },
            { pattern: /^광주/, region: "광주" },
            { pattern: /^대전/, region: "대전" },
            { pattern: /^울산/, region: "울산" },
            { pattern: /^세종/, region: "세종" },
            { pattern: /^강원/, region: "강원" },
            { pattern: /^충청북도|^충북/, region: "충북" },
            { pattern: /^충청남도|^충남/, region: "충남" },
            { pattern: /^전라북도|^전북/, region: "전북" },
            { pattern: /^전라남도|^전남/, region: "전남" },
            { pattern: /^경상북도|^경북/, region: "경북" },
            { pattern: /^경상남도|^경남/, region: "경남" },
            { pattern: /^제주/, region: "제주" },
            // 해외 지역 패턴
            { pattern: /미국|USA|United States/i, region: "미국" },
            { pattern: /일본|Japan/i, region: "일본" },
            { pattern: /태국|Thailand/i, region: "태국" },
            { pattern: /인도네시아|Indonesia/i, region: "인도네시아" },
            { pattern: /튀르키예|Turkey|Türkiye/i, region: "튀르키예" },
            { pattern: /헝가리|Hungary/i, region: "헝가리" },
            { pattern: /오스트레일리아|Australia/i, region: "오스트레일리아" },
        ];

        for (const { pattern, region } of regionPatterns) {
            if (pattern.test(address)) {
                return region;
            }
        }

        return "";
    };

    const filteredAndSortedRestaurants = useMemo(() => {
        // 검색어가 있을 때는 전체 데이터를 사용, 없으면 페이징된 데이터를 사용
        const sourceData = searchQuery.trim() ? allRestaurants : restaurants;
        if (!sourceData || sourceData.length === 0) return [];

        let result = [...sourceData];

        // 검색 필터는 전체 데이터 조회 시 이미 적용됨

        // 카테고리 필터
        if (filters.categories.length > 0) {
            result = result.filter(r => {
                // 카테고리 타입 처리: TEXT[] 배열 또는 단일 값
                let restaurantCategories: string[] = [];
                if (Array.isArray(r.category)) {
                    restaurantCategories = r.category;
                } else {
                    restaurantCategories = [String(r.category)].filter(Boolean);
                }

                return filters.categories.some(filterCat => restaurantCategories.includes(filterCat));
            });
        }

        // 지역 필터
        if (filters.regions.length > 0) {
            result = result.filter(r => {
                const region = extractRegion(r.address || "");
                return filters.regions.includes(region);
            });
        }


        // 리뷰 횟수 필터
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
                        aValue = a.category || "";
                        bValue = b.category || "";
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
    }, [restaurants, allRestaurants, searchQuery, filters, sortColumn, sortDirection]);

    const getStarEmoji = (rating: number) => {
        const count = Math.round(rating);
        return "⭐".repeat(count);
    };

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const activeFilterCount =
        (filters.searchQuery ? 1 : 0) +
        filters.categories.length +
        filters.regions.length +
        (filters.fanVisitsMin > 0 ? 1 : 0);

    return (
        <PanelGroup direction="horizontal" className="h-full bg-background">
            {/* Left Panel - Filtering */}
            <Panel defaultSize={60} minSize={30} maxSize={80} className="flex flex-col min-w-0">
                {/* Header */}
                <div className="border-b border-border bg-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                                    <Filter className="h-6 w-6 text-primary" />
                                    쯔동여지도 필터링
                                </h1>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                                총 {filteredAndSortedRestaurants.length}개의 맛집
                                {activeFilterCount > 0 && (
                                    <span className="ml-2 text-primary font-medium">
                                        ({activeFilterCount}개 필터 적용 중)
                                    </span>
                                )}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {!isRightPanelVisible && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsRightPanelVisible(true)}
                                    className="hover:text-accent-foreground hover:bg-accent"
                                >
                                    <MessageSquare className="h-5 w-5" />
                                </Button>
                            )}
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
                                                        id={`cat-${category}`}
                                                        checked={filters.categories.includes(category)}
                                                        onCheckedChange={() => handleCategoryToggle(category)}
                                                    />
                                                    <label
                                                        htmlFor={`cat-${category}`}
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


                        {/* 리뷰 횟수 */}
                        <Select
                            value={filters.fanVisitsMin.toString()}
                            onValueChange={(v) => setFilters({ ...filters, fanVisitsMin: parseInt(v) })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="리뷰" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0">리뷰 (전체)</SelectItem>
                                <SelectItem value="10">10회 이상</SelectItem>
                                <SelectItem value="50">50회 이상</SelectItem>
                                <SelectItem value="100">100회 이상</SelectItem>
                                <SelectItem value="500">500회 이상</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* 필터 초기화 */}
                        <Button variant="outline" onClick={handleResetFilters}>
                            필터 초기화
                        </Button>

                    </div>


                    {/* 선택된 필터 태그 */}
                    {activeFilterCount > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4">
                            {filters.searchQuery && (
                                <Badge variant="secondary" className="gap-1">
                                    검색: {filters.searchQuery}
                                </Badge>
                            )}
                            {filters.regions.map(region => (
                                <Badge key={region} variant="secondary" className="gap-1">
                                    📍 {region}
                                </Badge>
                            ))}
                            {filters.categories.map(cat => (
                                <Badge key={cat} variant="secondary">
                                    {cat}
                                </Badge>
                            ))}
                            {filters.fanVisitsMin > 0 && (
                                <Badge variant="secondary">
                                    리뷰 {filters.fanVisitsMin}회+
                                </Badge>
                            )}
                        </div>
                    )}
                </div>

                {/* Table */}
                <div className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                        <Table>
                            <TableHeader className="sticky top-0 bg-muted z-10">
                                <TableRow>
                                    <TableHead className="w-[250px]">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSort("name")}
                                            className="hover:bg-accent w-full justify-start"
                                        >
                                            맛집명
                                            {getSortIcon("name")}
                                        </Button>
                                    </TableHead>
                                    <TableHead className="w-[150px]">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSort("category")}
                                            className="hover:bg-accent w-full justify-start"
                                        >
                                            카테고리
                                            {getSortIcon("category")}
                                        </Button>
                                    </TableHead>
                                    <TableHead className="w-[120px] text-center">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleSort("fanVisits")}
                                            className="hover:bg-accent w-full justify-center"
                                        >
                                            리뷰
                                            {getSortIcon("fanVisits")}
                                        </Button>
                                    </TableHead>
                                    <TableHead className="w-[250px]">주소</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading || (searchQuery.trim() && isLoadingAllRestaurants) ? (
                                    // Loading skeleton
                                    Array.from({ length: 5 }).map((_, index) => (
                                        <TableRow key={index}>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-5 h-5 bg-muted rounded animate-pulse"></div>
                                                    <div className="h-4 bg-muted rounded animate-pulse w-32"></div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-1">
                                                    <div className="h-5 bg-muted rounded animate-pulse w-16"></div>
                                                    <div className="h-5 bg-muted rounded animate-pulse w-12"></div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="h-4 bg-muted rounded animate-pulse w-12 mx-auto"></div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="h-4 bg-muted rounded animate-pulse w-8 mx-auto"></div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (!isLoading && !isLoadingAllRestaurants && filteredAndSortedRestaurants.length === 0) ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-12">
                                            <p className="text-muted-foreground">필터 조건에 맞는 맛집이 없습니다.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredAndSortedRestaurants.map((restaurant, index) => (
                                        <TableRow
                                            key={`${restaurant.id}-${index}`}
                                            ref={index === filteredAndSortedRestaurants.length - 1 ? loadMoreTableRef : null}
                                            className={`hover:bg-muted/50 cursor-pointer transition-colors ${selectedRestaurant?.id === restaurant.id ? "bg-primary/10 border-l-4 border-primary" : ""
                                                }`}
                                            onClick={() => {
                                                setSelectedRestaurant(restaurant);
                                            }}
                                        >
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    {(restaurant.ai_rating || 0) >= 4 ? "🔥" : "⭐"}
                                                    <span className="truncate">{restaurant.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {Array.isArray(restaurant.category)
                                                        ? restaurant.category.map((cat, idx) => (
                                                            <Badge key={idx} variant="outline">{cat}</Badge>
                                                        ))
                                                        : <Badge variant="outline">{restaurant.category}</Badge>
                                                    }
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="font-semibold">
                                                    {restaurant.review_count || 0}회
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-sm text-muted-foreground truncate block">
                                                    {restaurant.address}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}

                                {/* 추가 로딩 표시 (검색 시에는 표시하지 않음) */}
                                {isFetchingNextRestaurantPage && !searchQuery.trim() && (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <div className="animate-spin h-4 w-4 border-4 border-primary border-t-transparent rounded-full"></div>
                                                <span className="text-sm text-muted-foreground">더 많은 맛집을 불러오는 중...</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </div>

            </Panel>

            {/* Resize Handle */}
            {isRightPanelVisible && (
                <PanelResizeHandle className="w-2 bg-border hover:bg-primary/20 transition-colors relative">
                    <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-1 bg-muted-foreground/30 rounded-full"></div>
                </PanelResizeHandle>
            )}

            {/* Right Panel - Reviews */}
            {isRightPanelVisible && (
                <Panel defaultSize={20} minSize={20} maxSize={70} className="flex flex-col bg-card">
                <div className="border-b border-border p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <MessageSquare className="h-6 w-6 text-primary" />
                            <h2 className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                                {selectedRestaurant ? `${selectedRestaurant.name}` : "인기 리뷰"}
                            </h2>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsRightPanelVisible(false)}
                            className="hover:text-accent-foreground hover:bg-accent"
                        >
                            <Menu className="h-5 w-5" />
                        </Button>
                    </div>
                    {selectedRestaurant ? (
                        <p className="text-sm text-muted-foreground mt-1">
                            {restaurantReviews.length}개의 리뷰
                        </p>
                    ) : (
                        <p className="text-sm text-muted-foreground mt-1">
                            좋아요가 가장 많은 리뷰들
                        </p>
                    )}
                </div>

                <div className="flex-1 overflow-hidden">
                    {!selectedRestaurant ? (
                        // 인기 리뷰 표시
                        topReviewsLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center">
                                    <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                                    <p className="text-muted-foreground">인기 리뷰를 불러오는 중...</p>
                                </div>
                            </div>
                        ) : sortedTopLikedReviews.length === 0 ? (
                            <div className="flex items-center justify-center h-full p-8">
                                <div className="text-center">
                                    <p className="text-muted-foreground mb-4">아직 리뷰가 없습니다</p>
                                    <p className="text-sm text-muted-foreground">첫 번째 리뷰를 작성해보세요!</p>
                                </div>
                            </div>
                        ) : (
                            <ScrollArea className="h-full">
                                <div className="p-6 space-y-4">
                                    {sortedTopLikedReviews.map((review, index) => (
                                        <Card
                                            key={`${review.id}-${index}`}
                                            ref={index === sortedTopLikedReviews.length - 1 ? loadMoreRef : null}
                                            className={`p-4 ${review.isPinned ? "border-primary border-2" : ""}`}
                                        >
                                            {/* Header */}
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        {review.isPinned && (
                                                            <Pin className="h-4 w-4 text-primary fill-primary" />
                                                        )}
                                                        {review.userName === "관리자" && (
                                                            <Badge variant="default" className="bg-gradient-primary text-xs">
                                                                관리자
                                                            </Badge>
                                                        )}
                                                        <span className="font-semibold text-sm">{review.userName}</span>
                                                        {review.isVerified && (
                                                            <Badge variant="default" className="gap-1 bg-green-600 text-xs">
                                                                <CheckCircle className="h-3 w-3" />
                                                                인증
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    {review.isEditedByAdmin && (
                                                        <Badge variant="outline" className="mb-2 border-orange-500 text-orange-500 text-xs">
                                                            ⚠️ 관리자가 수정함
                                                        </Badge>
                                                    )}

                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <div className="flex items-center gap-1">
                                                            <Calendar className="h-3 w-3" />
                                                            방문: {formatDateTime(review.visitedAt)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => toggleLike(review.id, review.isLikedByUser, review.likeCount)}
                                                    className="flex items-center gap-1 h-6 px-2 hover:bg-red-50 dark:hover:bg-red-950/20"
                                                    disabled={!user}
                                                >
                                                    <Heart className={`h-3 w-3 ${review.isLikedByUser ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
                                                    <span className={`text-xs ${review.isLikedByUser ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                        {review.likeCount}
                                                    </span>
                                                </Button>
                                            </div>

                                            {/* Content */}
                                            <div className="mb-3">
                                                <p className="text-sm whitespace-pre-wrap">{review.content}</p>
                                            </div>

                                            {/* Photos */}
                                            {review.photos.length > 0 && (
                                                <div className="mb-3">
                                                    <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                                                        <img
                                                            src={supabase.storage.from('review-photos').getPublicUrl(review.photos[0].url).data.publicUrl}
                                                            alt={`음식 사진`}
                                                            className="w-full h-full object-cover"
                                                            onError={(e) => {
                                                                console.error('이미지 로딩 실패:', review.photos[0].url);
                                                                e.currentTarget.style.display = 'none';
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            {/* Footer */}
                                            <div className="pt-2 border-t border-border">
                                                <div className="text-xs text-muted-foreground">
                                                    작성: {formatDateTime(review.submittedAt)}
                                                </div>
                                            </div>
                                        </Card>
                                    ))}

                                    {/* 추가 로딩 표시 */}
                                    {isFetchingNextTopReviewPage && (
                                        <div className="flex items-center justify-center py-4">
                                            <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                                            <span className="ml-2 text-sm text-muted-foreground">더 많은 리뷰를 불러오는 중...</span>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        )
                    ) : reviewsLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                                <p className="text-muted-foreground">리뷰를 불러오는 중...</p>
                            </div>
                        </div>
                    ) : restaurantReviews.length === 0 ? (
                        <div className="flex items-center justify-center h-full p-8">
                            <div className="text-center">
                                <p className="text-muted-foreground mb-4">아직 리뷰가 없습니다</p>
                                <p className="text-sm text-muted-foreground mb-6">첫 번째 리뷰를 작성해보세요!</p>
                                <Button
                                    onClick={() => setIsReviewModalOpen(true)}
                                    className="bg-gradient-primary hover:opacity-90"
                                >
                                    리뷰 작성하기
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <ScrollArea className="h-full">
                            <div className="p-6 space-y-4">
                                {restaurantReviews.map((review, index) => (
                                    <Card
                                        key={review.id}
                                        ref={index === restaurantReviews.length - 1 ? loadMoreRestaurantRef : null}
                                        className={`p-4 ${review.isPinned ? "border-primary border-2" : ""}`}
                                    >
                                        {/* Header */}
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    {review.isPinned && (
                                                        <Pin className="h-4 w-4 text-primary fill-primary" />
                                                    )}
                                                    {review.userName === "관리자" && (
                                                        <Badge variant="default" className="bg-gradient-primary text-xs">
                                                            관리자
                                                        </Badge>
                                                    )}
                                                    <span className="font-semibold text-sm">{review.userName}</span>
                                                    {review.isVerified ? (
                                                        <Badge variant="default" className="gap-1 bg-green-600 text-xs">
                                                            <CheckCircle className="h-3 w-3" />
                                                            인증
                                                        </Badge>
                                                    ) : review.admin_note ? (
                                                        <Badge variant="destructive" className="gap-1 text-xs">
                                                            <XCircle className="h-3 w-3" />
                                                            거부
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="gap-1 text-xs">
                                                            <Clock className="h-3 w-3" />
                                                            검토
                                                        </Badge>
                                                    )}
                                                </div>

                                                {review.isEditedByAdmin && (
                                                    <Badge variant="outline" className="mb-2 border-orange-500 text-orange-500 text-xs">
                                                        ⚠️ 관리자가 수정함
                                                    </Badge>
                                                )}

                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <div className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        방문: {formatDateTime(review.visitedAt)}
                                                    </div>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => toggleLike(review.id, review.isLikedByUser, review.likeCount)}
                                                className="flex items-center gap-1 h-6 px-2 hover:bg-red-50 dark:hover:bg-red-950/20"
                                                disabled={!user}
                                            >
                                                <Heart className={`h-3 w-3 ${review.isLikedByUser ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
                                                <span className={`text-xs ${review.isLikedByUser ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                    {review.likeCount}
                                                </span>
                                            </Button>
                                        </div>

                                        {/* Content */}
                                        <div className="mb-3">
                                            <p className="text-sm whitespace-pre-wrap">{review.content}</p>
                                        </div>

                                        {/* 거부 사유 */}
                                        {review.admin_note && review.admin_note.includes('거부') && (
                                            <div className="mb-3 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                                <div className="flex items-center gap-1 mb-1">
                                                    <XCircle className="h-3 w-3 text-red-600" />
                                                    <span className="text-xs font-medium text-red-700 dark:text-red-300">
                                                        거부 사유
                                                    </span>
                                                </div>
                                                <p className="text-xs text-red-600 dark:text-red-400">
                                                    {review.admin_note.startsWith('거부: ') ? review.admin_note.substring(4) : review.admin_note}
                                                </p>
                                            </div>
                                        )}

                                        {/* Photos */}
                                        {review.photos.length > 0 && (
                                            <div className="mb-3">
                                                <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                                                    <img
                                                        src={supabase.storage.from('review-photos').getPublicUrl(review.photos[0].url).data.publicUrl}
                                                        alt={`음식 사진`}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            console.error('이미지 로딩 실패:', review.photos[0].url);
                                                            e.currentTarget.style.display = 'none';
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Footer */}
                                        <div className="pt-2 border-t border-border">
                                            <div className="text-xs text-muted-foreground">
                                                작성: {formatDateTime(review.submittedAt)}
                                            </div>
                                        </div>
                                    </Card>
                                ))}

                                {/* 추가 로딩 표시 */}
                                {isFetchingNextRestaurantReviewPage && (
                                    <div className="flex items-center justify-center py-4">
                                        <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                                        <span className="ml-2 text-sm text-muted-foreground">더 많은 리뷰를 불러오는 중...</span>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </div>
                </Panel>
            )}

            {/* Review Modal */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={selectedRestaurant ? { id: selectedRestaurant.id, name: selectedRestaurant.name } : null}
                onSuccess={() => {
                    // 리뷰 작성 성공 시 리뷰 데이터를 다시 가져옴
                    queryClient.invalidateQueries({ queryKey: ['restaurant-reviews', selectedRestaurant?.id] });
                }}
            />
        </PanelGroup>
    );
};

export default FilteringPage;