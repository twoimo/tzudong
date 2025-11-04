import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle, Trophy, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface Restaurant {
    id: string;
    name: string;
    youtube_link: string;
    review_count: number;
}

interface UserReview {
    restaurant_id: string;
    is_verified: boolean;
}

const StampPage = () => {
    const { user } = useAuth();
    const [userReviews, setUserReviews] = useState<Set<string>>(new Set());

    // 전체 맛집 개수 조회
    const { data: totalRestaurantsCount = 0 } = useQuery({
        queryKey: ['stamp-restaurants-total-count'],
        queryFn: async () => {
            const { count, error } = await supabase
                .from('restaurants')
                .select('*', { count: 'exact', head: true })
                .not('youtube_link', 'is', null);

            if (error) throw error;
            return count || 0;
        },
    });

    // 쯔양이 방문한 모든 맛집 조회 (무한 스크롤)
    const {
        data: restaurantsData,
        fetchNextPage: fetchNextRestaurants,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['stamp-restaurants'],
        queryFn: async ({ pageParam = 0 }) => {
            const { data, error } = await supabase
                .from('restaurants')
                .select('id, name, youtube_link, review_count')
                .not('youtube_link', 'is', null)
                .order('created_at', { ascending: true })
                .range(pageParam, pageParam + 49); // 한 페이지당 50개씩

            if (error) throw error;

            if (!data || data.length === 0) {
                return { restaurants: [], nextCursor: null };
            }

            // 다음 페이지 커서 계산
            const nextCursor = data.length === 50 ? pageParam + 50 : null;

            return {
                restaurants: data as Restaurant[],
                nextCursor,
            };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor,
        initialPageParam: 0,
    });

    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const restaurants = restaurantsData?.pages.flatMap(page => page.restaurants) || [];

    // 그리드 무한 스크롤을 위한 Intersection Observer
    const loadMoreGridRef = useRef<HTMLDivElement>(null);

    const loadMoreGrid = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextRestaurants();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextRestaurants]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreGrid();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreGridRef.current) {
            observer.observe(loadMoreGridRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreGrid]);

    // 사용자 프로필 정보 조회 (로그인한 경우)
    const { data: userProfile } = useQuery({
        queryKey: ['user-profile', user?.id],
        queryFn: async () => {
            if (!user?.id) return null;

            const { data, error } = await supabase
                .from('profiles')
                .select('nickname')
                .eq('user_id', user.id)
                .single();

            if (error) throw error;
            return data;
        },
        enabled: !!user?.id,
    });

    // 사용자가 작성한 리뷰 조회 (로그인한 경우)
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

    // 사용자 리뷰 데이터 처리
    useEffect(() => {
        if (userReviewData.length > 0) {
            const reviewedRestaurantIds = new Set(
                userReviewData.map(review => review.restaurant_id)
            );
            setUserReviews(reviewedRestaurantIds);
        }
    }, [userReviewData]);

    // YouTube 썸네일 URL 추출 함수
    const extractYouTubeVideoId = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    const getYouTubeThumbnailUrl = (url: string) => {
        const videoId = extractYouTubeVideoId(url);
        return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
    };

    // 방문한 맛집인지 확인
    const isVisited = (restaurantId: string) => {
        return userReviews.has(restaurantId);
    };

    // 방문한 맛집 수 계산 (고유한 맛집 개수로 계산 - 중복 방문은 1개로 계산)
    const visitedCount = userReviewData.length > 0 ? new Set(userReviewData.map(review => review.restaurant_id)).size : 0;
    const totalCount = totalRestaurantsCount;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-4">
                    <div className="animate-spin h-12 w-12 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
                    <p className="text-muted-foreground">도장 데이터를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                                <Trophy className="h-6 w-6 text-primary" />
                                쯔동여지도 도장
                            </h1>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                            쯔양이 방문한 맛집을 모두 도장 찍어보세요!
                        </p>
                    </div>
                    {user && (
                        <div className="text-right">
                            <div className="text-sm font-medium">
                                {userProfile?.nickname || user.email?.split('@')[0] || '사용자'}님의 도장 현황
                            </div>
                            <div className="text-2xl font-bold text-primary">
                                {visitedCount} / {totalCount}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Stamp Grid */}
            <div className="flex-1 overflow-auto p-6">
                <div className="grid grid-cols-5 gap-4">
                    {restaurants.map((restaurant, index) => {
                        const thumbnailUrl = getYouTubeThumbnailUrl(restaurant.youtube_link);
                        const visited = isVisited(restaurant.id);

                        return (
                            <Card
                                key={`${restaurant.id}-${index}`}
                                ref={index === restaurants.length - 1 ? loadMoreGridRef : null}
                                className={cn(
                                    "relative overflow-hidden transition-all duration-300 hover:scale-105 cursor-pointer group",
                                    visited ? "ring-2 ring-green-500 ring-opacity-50" : "hover:shadow-lg"
                                )}
                                onClick={() => {
                                    // 클릭 시 상세 페이지로 이동하거나 모달 열기
                                    console.log('Restaurant clicked:', restaurant.name);
                                }}
                            >
                                {/* YouTube Thumbnail */}
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
                                            {/* Visit Overlay */}
                                            {visited && (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="text-red-500 font-bold text-6xl transform">
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

                                {/* Restaurant Info */}
                                <div className="p-3">
                                    <h3 className="text-xs font-medium line-clamp-2" title={restaurant.name}>
                                        {restaurant.name}
                                    </h3>
                                </div>
                            </Card>
                        );
                    })}

                    {/* 추가 로딩 표시 */}
                    {isFetchingNextPage && (
                        <div className="col-span-5 flex items-center justify-center py-8">
                            <div className="flex items-center gap-2">
                                <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                                <span className="text-sm text-muted-foreground">더 많은 맛집을 불러오는 중...</span>
                            </div>
                        </div>
                    )}
                </div>

                {restaurants.length === 0 && (
                    <div className="text-center py-12">
                        <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">등록된 맛집이 없습니다.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StampPage;
