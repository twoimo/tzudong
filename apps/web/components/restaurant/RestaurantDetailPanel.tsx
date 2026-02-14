/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Restaurant } from "@/types/restaurant";
import { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import {
    X,
    MapPin,
    Clock,
    ExternalLink,
    ThumbsUp,
    MessageSquare,
    Share2,
    Navigation,
    Globe,
    MoreVertical,
    Flag,
    Edit,
    Pencil,
    Map as MapIcon,
    Copy,
    ChevronDown,
    Info,
    Youtube,
    Settings,
    Store,
    Quote,
    Star,
    ArrowLeft,
    Check,
    ChevronUp,
    ChevronRight,
    ChevronLeft
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "@/components/auth/AuthModal";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Image from "next/image";
import { ScrollableTagContainer } from "@/components/ui/scrollable-tag-container";
import { BookmarkButton } from "@/components/ui/bookmark-button";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { ReviewEditModal } from "@/components/reviews/ReviewEditModal";
import { useReviewLikesRealtime } from "@/hooks/use-review-likes-realtime";

interface RestaurantDetailPanelProps {
    restaurant: Restaurant | null;
    onClose: () => void;
    onWriteReview?: () => void;
    onEditRestaurant?: () => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    onToggleCollapse?: () => void;
    isPanelOpen?: boolean;
    isMobile?: boolean;
    className?: string;
    onUserClick?: (userId: string) => void;
    onRestaurantClick?: (restaurant: Restaurant) => void;
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
}

const RESTAURANT_DETAIL_SWIPE_HINT_KEY = 'restaurant-detail-swipe-hint-seen-v1';

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
    categories: string[];
    likeCount: number;
    isLikedByUser: boolean;
    userAvatarUrl?: string | null;
}

export function RestaurantDetailPanel({
    restaurant,
    onClose,
    onWriteReview,
    onEditRestaurant,
    onRequestEditRestaurant,
    onToggleCollapse,
    isPanelOpen = true,
    isMobile = false,
    className,
    onUserClick,
    onRestaurantClick,
    onSwipeLeft,
    onSwipeRight,
}: RestaurantDetailPanelProps) {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'detail' | 'reviews'>('detail');
    const [likedReviews, setLikedReviews] = useState<Set<string>>(new Set());
    const [copiedAddress, setCopiedAddress] = useState<'road' | 'jibun' | 'english' | null>(null);
    const [isYoutubeExpanded, setIsYoutubeExpanded] = useState(false);
    const [isReviewExpanded, setIsReviewExpanded] = useState(false);
    const [isDirectionSheetOpen, setIsDirectionSheetOpen] = useState(false);
    const [isShareCopied, setIsShareCopied] = useState(false);
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
    const [showSwipeHint, setShowSwipeHint] = useState(false);

    // [실시간] 좋아요 실시간 반영
    useReviewLikesRealtime();

    // [카테고리 처리] categories 배열로 저장됨
    const categories: string[] = restaurant && Array.isArray(restaurant.categories)
        ? (restaurant.categories as string[])
        : restaurant?.categories
            ? [restaurant.categories as unknown as string]
            : [];

    // [최적 레코드 선택] 가장 긴 이름 -> 가장 긴 지번 주소 순으로 우선순위
    const uniqueData = useMemo(() => {
        if (!restaurant) return null;

        // 모든 레코드 수집 (현재 restaurant + mergedRestaurants)
        const allRecords = [restaurant, ...(restaurant.mergedRestaurants || [])];

        // [우선순위 정렬] 1) 가장 긴 이름, 2) 가장 긴 지번 주소
        const sortedRecords = [...allRecords].sort((a, b) => {
            const nameA = a.name || '';
            const nameB = b.name || '';
            const jibunA = a.jibun_address || '';
            const jibunB = b.jibun_address || '';

            // 이름 길이 비교
            if (nameB.length !== nameA.length) {
                return nameB.length - nameA.length;
            }

            // 이름이 같으면 지번 주소 길이 비교
            return jibunB.length - jibunA.length;
        });

        // 가장 우선순위가 높은 레코드
        const primaryRecord = sortedRecords[0];

        // 해당 레코드의 주소와 전화번호만 사용
        const roadAddress = primaryRecord.road_address;
        const jibunAddress = primaryRecord.jibun_address;
        const englishAddress = primaryRecord.english_address;


        return {
            roadAddresses: roadAddress ? [roadAddress] : [],
            jibunAddresses: jibunAddress ? [jibunAddress] : [],
            englishAddresses: englishAddress ? [englishAddress] : [],
        };
    }, [restaurant]);

    // [데이터 조회] 리뷰 무한 스크롤 (성능 최적화: 10개씩 페이징)
    const {
        data: reviewsInfiniteData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: reviewsLoading
    } = useInfiniteQuery({
        queryKey: ['restaurant-reviews', restaurant?.id],
        queryFn: async ({ pageParam = 0 }) => {
            try {
                if (!restaurant) return { reviews: [], nextCursor: null };

                // 0. 모든 관련 레코드 ID 수집
                const allIds = [restaurant.id];
                if (restaurant.mergedRestaurants && restaurant.mergedRestaurants.length > 0) {
                    allIds.push(...restaurant.mergedRestaurants.map((r: any) => r.id));
                }

                // 1. 해당 맛집의 승인된 리뷰 조회 (Paging)
                const { data: reviewsPageData, error: reviewsError } = await (supabase
                    .from('reviews') as any)
                    .select('*')
                    .in('restaurant_id', allIds)
                    .eq('is_verified', true)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(pageParam, pageParam + 9); // 10개씩 조회

                if (reviewsError) throw reviewsError;
                if (!reviewsPageData || reviewsPageData.length === 0) {
                    return { reviews: [], nextCursor: null };
                }

                // 2. 필요한 user_id 수집
                const userIds = [...new Set(reviewsPageData.map((r: any) => r.user_id))];

                // 3. Profiles 가져오기
                const { data: profilesData } = await (supabase
                    .from('profiles') as any)
                    .select('user_id, nickname, avatar_url')
                    .in('user_id', userIds);

                // 4. Map으로 변환
                const profilesMap = new Map<string, { nickname: string; avatarUrl: string | null }>(
                    (profilesData || []).map((p: any) => [p.user_id, { nickname: p.nickname, avatarUrl: p.avatar_url }])
                );

                // 6. 리뷰 좋아요 데이터 조회
                const reviewIds = reviewsPageData.map((r: any) => r.id);
                const { data: likesData } = await (supabase
                    .from('review_likes') as any)
                    .select('review_id, user_id')
                    .in('review_id', reviewIds);

                // 좋아요 수와 사용자 좋아요 상태 계산
                const likesMap = new Map<string, { count: number; isLiked: boolean }>();
                reviewIds.forEach((reviewId: string) => {
                    const likesForReview = likesData?.filter((like: any) => like.review_id === reviewId) || [];
                    likesMap.set(reviewId, {
                        count: likesForReview.length,
                        isLiked: user ? likesForReview.some((like: any) => like.user_id === user.id) : false
                    });
                });

                // 7. 리뷰 데이터 매핑
                const reviews = reviewsPageData.map((review: any) => {
                    const likesInfo = likesMap.get(review.id) || { count: 0, isLiked: false };
                    const userProfile = profilesMap.get(review.user_id);

                    return {
                        id: review.id,
                        userId: review.user_id,
                        restaurantName: restaurant.name,
                        restaurantCategories: categories,
                        userName: userProfile?.nickname || '탈퇴한 사용자',
                        userAvatarUrl: userProfile?.avatarUrl,
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
                        likeCount: likesInfo.count,
                        isLikedByUser: likesInfo.isLiked,
                    };
                }) as Review[];

                const nextCursor = reviewsPageData.length === 10 ? pageParam + 10 : null;
                return { reviews, nextCursor };
            } catch (error) {
                console.error('❌ 리뷰 데이터 조회 중 오류:', error);
                return { reviews: [], nextCursor: null };
            }
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
        enabled: !!restaurant?.id,
        refetchOnMount: 'always',
        staleTime: 0,
        gcTime: 30 * 1000,
    });

    // [리뷰 데이터 평탄화]
    const safeReviewsData = useMemo(() =>
        reviewsInfiniteData?.pages.flatMap(page => page.reviews) || [],
        [reviewsInfiniteData]);

    // [리뷰 정렬] 최근 리뷰는 작성일순(Query에서 정렬됨)으로 표시 - 3개만 미리보기
    const recentReviews = safeReviewsData.slice(0, 3);

    // [총 리뷰 수]
    const totalReviewCount = (restaurant as any).verified_review_count ?? safeReviewsData.length;

    // [초기화] 초기 로드 시 likedReviews 상태 초기화
    useEffect(() => {
        if (safeReviewsData.length > 0) {
            const likedReviewIds = safeReviewsData
                .filter(review => review.isLikedByUser)
                .map(review => review.id);
            setLikedReviews(new Set(likedReviewIds));
        }
    }, [safeReviewsData]);

    // [핸들러] 전체 리뷰 보기
    const handleViewAllReviews = useCallback(() => {
        setViewMode('reviews');
    }, []);

    // [핸들러] 상세 정보로 돌아가기
    const handleBackToDetail = useCallback(() => {
        setViewMode('detail');
    }, []);



    // [핸들러] 주소 복사
    const handleCopyAddress = useCallback(async (address: string, type: 'road' | 'jibun' | 'english') => {
        try {
            await navigator.clipboard.writeText(address);
            setCopiedAddress(type);
            setTimeout(() => setCopiedAddress(null), 2000);
        } catch (err) {
            console.error('주소 복사 실패:', err);
        }
    }, []);

    const RESTAURANT_DETAIL_SWIPE_THRESHOLD = 12;
    const RESTAURANT_DETAIL_SWIPE_INTENT_RATIO = 1.0;

    const contentSwipeStartXRef = useRef(0);
    const contentSwipeStartYRef = useRef(0);
    const contentSwipeDirectionRef = useRef<'horizontal' | 'vertical' | null>(null);
    const isContentSwipingRef = useRef(false);

    const hideSwipeHint = useCallback(() => {
        setShowSwipeHint(false);
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(RESTAURANT_DETAIL_SWIPE_HINT_KEY, '1');
    }, []);

    useEffect(() => {
        if (!showSwipeHint) return;

        const handleFirstTouch = () => {
            hideSwipeHint();
        };

        window.addEventListener('touchstart', handleFirstTouch, { passive: true });
        window.addEventListener('pointerdown', handleFirstTouch, { passive: true });

        return () => {
            window.removeEventListener('touchstart', handleFirstTouch);
            window.removeEventListener('pointerdown', handleFirstTouch);
        };
    }, [showSwipeHint, hideSwipeHint]);

    const handleContentSwipeStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        const touch = e.touches[0];
        if (!touch) return;

        contentSwipeStartXRef.current = touch.clientX;
        contentSwipeStartYRef.current = touch.clientY;
        contentSwipeDirectionRef.current = null;
        isContentSwipingRef.current = true;
        hideSwipeHint();
    }, []);

    useEffect(() => {
        if (!isMobile || !isPanelOpen || !(onSwipeLeft || onSwipeRight)) {
            setShowSwipeHint(false);
            return;
        }

        if (typeof window === 'undefined') return;

        const isSeen = window.localStorage.getItem(RESTAURANT_DETAIL_SWIPE_HINT_KEY) === '1';
        setShowSwipeHint(!isSeen);
    }, [isMobile, isPanelOpen, onSwipeLeft, onSwipeRight]);

    const handleContentSwipeMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isContentSwipingRef.current) return;

        const touch = e.touches[0];
        if (!touch) return;

        const deltaX = touch.clientX - contentSwipeStartXRef.current;
        const deltaY = touch.clientY - contentSwipeStartYRef.current;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        if (!contentSwipeDirectionRef.current) {
            const isHorizontalSwipe = absDeltaX > absDeltaY * RESTAURANT_DETAIL_SWIPE_INTENT_RATIO && absDeltaX >= RESTAURANT_DETAIL_SWIPE_THRESHOLD;
            if (isHorizontalSwipe && (onSwipeLeft || onSwipeRight)) {
                contentSwipeDirectionRef.current = 'horizontal';
                e.stopPropagation();
                return;
            }

            if (absDeltaY > absDeltaX * 1.2 && absDeltaY > 2) {
                contentSwipeDirectionRef.current = 'vertical';
            }
            return;
        }

        if (contentSwipeDirectionRef.current !== 'horizontal') return;
        e.stopPropagation();
    }, [onSwipeLeft, onSwipeRight]);

    const handleContentSwipeEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isContentSwipingRef.current) return;

        const currentTouch = e.changedTouches?.[0] ?? e.touches?.[0];
        if (!currentTouch) {
            isContentSwipingRef.current = false;
            contentSwipeDirectionRef.current = null;
            return;
        }

        const deltaX = currentTouch.clientX - contentSwipeStartXRef.current;
        const deltaY = currentTouch.clientY - contentSwipeStartYRef.current;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        const direction = contentSwipeDirectionRef.current;

        const isValidSwipe = absDeltaX >= RESTAURANT_DETAIL_SWIPE_THRESHOLD && absDeltaX > absDeltaY * RESTAURANT_DETAIL_SWIPE_INTENT_RATIO;
        const isPossibleSwipe = absDeltaX >= RESTAURANT_DETAIL_SWIPE_THRESHOLD && absDeltaX > absDeltaY * 0.9;

        if (direction === 'horizontal' || direction === null) {
            if (isValidSwipe || isPossibleSwipe) {
                if (deltaX < 0) {
                    onSwipeLeft?.();
                } else {
                    onSwipeRight?.();
                }
                e.stopPropagation();
            } else if (direction === 'horizontal') {
                e.stopPropagation();
            }
        }

        isContentSwipingRef.current = false;
        contentSwipeDirectionRef.current = null;
    }, [onSwipeLeft, onSwipeRight]);

    const handleContentSwipeCancel = useCallback(() => {
        isContentSwipingRef.current = false;
        contentSwipeDirectionRef.current = null;
    }, []);

    // [핸들러] 공유하기 URL 복사 - useCallback으로 메모이제이션
    const handleShareUrl = useCallback(async () => {
        if (!restaurant) return;

        // 1. URL 생성 (r=ID, z=15, mode=overseas)
        // [Fast Copy] 단축 URL 제거하고 즉시 복사되도록 변경
        const url = new URL(window.location.origin);
        url.searchParams.set('r', restaurant.id);
        url.searchParams.set('z', '15'); // 줌 레벨 15 설정

        // 해외 맛집 판단 (좌표 기준)
        const isOverseas = restaurant.lat && restaurant.lng && (
            restaurant.lat < 33 || restaurant.lat > 39 ||
            restaurant.lng < 124 || restaurant.lng > 132
        );

        if (isOverseas) {
            url.searchParams.set('mode', 'overseas');
        }

        const shareUrl = url.toString();

        try {
            // 2. 클립보드 복사
            await navigator.clipboard.writeText(shareUrl);
            setIsShareCopied(true);
            setTimeout(() => setIsShareCopied(false), 2000);
            toast.success('공유 링크가 복사되었습니다');
        } catch (err) {
            console.warn('URL 복사 실패:', err);

            // 포커스 문제 등으로 실패 시 처리
            if (!document.hasFocus()) {
                console.warn('문서 포커스 없음, 클립보드 쓰기 건너뜀');
            } else {
                toast.error('링크 복사에 실패했습니다');
            }
        }
    }, [restaurant]);

    // [유틸] 유튜브 비디오 ID 추출
    const extractYouTubeVideoId = useCallback((url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }, []);

    // [유틸] 유튜브 썸네일 URL 생성
    const getYouTubeThumbnailUrl = useCallback((url: string) => {
        const videoId = extractYouTubeVideoId(url);
        return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
    }, [extractYouTubeVideoId]);

    // [예외 처리] restaurant가 없으면 null 반환 (모든 Hook 호출 후)
    if (!restaurant) return null;

    // [핸들러] 길찾기 시트 열기
    const handleGetDirections = useCallback(() => {
        setIsDirectionSheetOpen(true);
    }, []);

    // [핸들러] 네이버 지도 열기
    const handleNaverMap = useCallback(() => {
        const url = `https://map.naver.com/v5/search/${encodeURIComponent(restaurant.name)}`;
        window.open(url, '_blank');
        setIsDirectionSheetOpen(false);
    }, [restaurant.name]);

    // [핸들러] 구글 지도 열기
    const handleGoogleMap = useCallback(() => {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${restaurant.lat},${restaurant.lng}`;
        window.open(url, '_blank');
        setIsDirectionSheetOpen(false);
    }, [restaurant.lat, restaurant.lng]);

    // [핸들러] 카카오맵 열기
    const handleKakaoMap = useCallback(() => {
        const url = `https://map.kakao.com/link/to/${encodeURIComponent(restaurant.name)},${restaurant.lat},${restaurant.lng}`;
        window.open(url, '_blank');
        setIsDirectionSheetOpen(false);
    }, [restaurant.name, restaurant.lat, restaurant.lng]);

    // [핸들러] 수정 요청
    const handleRequestEditRestaurant = useCallback(() => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }
        onRequestEditRestaurant?.(restaurant);
    }, [user, onRequestEditRestaurant, restaurant]);

    // [핸들러] 리뷰 작성
    const handleWriteReview = useCallback(() => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }
        onWriteReview?.();
    }, [user, onWriteReview]);

    const handleLikeReview = async (reviewId: string) => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }

        const isCurrentlyLiked = likedReviews.has(reviewId);
        const previousState = new Set(likedReviews);

        // 낙관적 업데이트: 즉시 UI 업데이트
        setLikedReviews(prev => {
            const newSet = new Set(prev);
            if (isCurrentlyLiked) {
                newSet.delete(reviewId);
            } else {
                newSet.add(reviewId);
            }
            return newSet;
        });

        try {
            if (isCurrentlyLiked) {
                // 좋아요 취소
                const { error } = await (supabase
                    .from('review_likes') as any)
                    .delete()
                    .eq('review_id', reviewId)
                    .eq('user_id', user.id);

                if (error) throw error;
            } else {
                // 좋아요 추가
                const { error } = await (supabase
                    .from('review_likes') as any)
                    .insert({
                        review_id: reviewId,
                        user_id: user.id
                    });

                if (error) throw error;

                // 리뷰 작성자에게 알림 전송 (자기 자신 제외)
                const targetReview = safeReviewsData.find(r => r.id === reviewId);
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
                            p_message: `${likerName}님이 ${restaurant.name}에 대한 리뷰에 좋아요를 눌렀습니다.`,
                            p_data: { reviewId, restaurantId: restaurant.id, restaurantName: restaurant.name }
                        });
                    } catch (notifError) {
                        console.error('알림 생성 실패:', notifError);
                        // 알림 실패는 좋아요 처리에 영향을 주지 않음
                    }
                }
            }

            // 성공 시 쿼리 캐시 무효화하여 좋아요 수 업데이트
            await queryClient.invalidateQueries({
                queryKey: ['restaurant-reviews', restaurant?.id]
            });

        } catch (error) {
            console.error('좋아요 처리 중 오류:', error);

            // 실패 시 원래 상태로 롤백
            setLikedReviews(previousState);
        }
    };

    /**
     * 카테고리별 이미지 경로 매핑
     */
    const CATEGORY_IMAGES: Record<string, string> = {
        '고기': '/images/maker-images/meat_bbq.png',
        '치킨': '/images/maker-images/chicken.png',
        '한식': '/images/maker-images/korean.png',
        '중식': '/images/maker-images/chinese.png',
        '일식': '/images/maker-images/cutlet_sashimi.png',
        '양식': '/images/maker-images/western.png',
        '분식': '/images/maker-images/snack_bar.png',
        '카페·디저트': '/images/maker-images/cafe_dessert.png',
        '아시안': '/images/maker-images/asian.png',
        '패스트푸드': '/images/maker-images/fastfood.png',
        '족발·보쌈': '/images/maker-images/pork_feet.png',
        '돈까스·회': '/images/maker-images/cutlet_sashimi.png',
        '피자': '/images/maker-images/pizza.png',
        '찜·탕': '/images/maker-images/stew.png',
        '야식': '/images/maker-images/late_night.png',
        '도시락': '/images/maker-images/lunch_box.png',
    };

    /**
     * 카테고리에 해당하는 이미지 경로 반환
     * @param category 카테고리명
     * @returns 이미지 경로
     */
    const getCategoryImagePath = (category: string): string => {
        return CATEGORY_IMAGES[category] || '/images/maker-images/korean.png';
    };

    return (
        <>
            {isMobile && (onSwipeLeft || onSwipeRight) && showSwipeHint ? (
                <div className="pointer-events-none fixed inset-0 z-[70]">
                    <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="rounded-full border border-white/40 bg-black/40 px-3 py-2 text-xs text-white/90 backdrop-blur">
                            좌우 스와이프 시 다음 맛집으로 이동
                        </div>
                    </div>
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center">
                        <ChevronLeft className="h-6 w-6 text-white/90" />
                    </div>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center">
                        <ChevronRight className="h-6 w-6 text-white/90" />
                    </div>
                </div>
            ) : null}

            <div
                data-testid="restaurant-detail-panel"
                data-panel-type="restaurant-detail"
                className={cn(
                    "h-full w-full max-w-full flex flex-col bg-background border-l border-border relative",
                    className
                )}
            >
                {/* 플로팅 접기/펼치기 버튼 - 패널 좌측 가장자리, 모바일에서는 숨김 */}
                {onToggleCollapse && !isMobile && (
                    <button
                        onClick={onToggleCollapse}
                        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                        title={isPanelOpen ? "패널 접기" : "패널 펼치기"}
                        aria-label={isPanelOpen ? "패널 접기" : "패널 펼치기"}
                    >
                        {isPanelOpen ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                        ) : (
                            <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                        )}
                    </button>
                )}

                {/* 헤더 */}
                <div className="p-4 border-b border-border h-[80px] flex flex-col justify-center">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">

                            {viewMode === 'reviews' && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleBackToDetail}
                                        className="mr-2 shrink-0"
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-xl font-bold truncate">
                                                {restaurant.name}
                                            </h3>
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">
                                            전체 리뷰 {totalReviewCount}개
                                        </p>
                                    </div>
                                </>
                            )}
                            {viewMode === 'detail' && (
                                <div className="flex-1 min-w-0">
                                    <ScrollableTagContainer className="mb-1" maxWidth="100%">
                                        {categories.map((cat, index) => (
                                            <Badge
                                                key={index}
                                                variant={index === 0 ? "default" : "secondary"}
                                                className="text-xs whitespace-nowrap"
                                            >
                                                {cat}
                                            </Badge>
                                        ))}

                                        {/* 광고 태그 - 모든 병합된 영상에서 수집 */}
                                        {(() => {
                                            const allAds: string[] = [];
                                            const metas = restaurant.mergedYoutubeMetas ||
                                                (restaurant.youtube_meta ? [restaurant.youtube_meta] : []);

                                            metas.forEach((meta: any) => {
                                                const adsInfo = meta?.ads_info;
                                                if (adsInfo?.is_ads === true && Array.isArray(adsInfo.what_ads)) {
                                                    allAds.push(...adsInfo.what_ads);
                                                }
                                            });

                                            const uniqueAds = Array.from(new Set(allAds));

                                            return uniqueAds.length > 0 ? (
                                                <>
                                                    {uniqueAds.map((ad: string, index: number) => (
                                                        <Badge
                                                            key={index}
                                                            variant="outline"
                                                            className="text-xs bg-orange-50 text-orange-700 border-orange-300 whitespace-nowrap"
                                                        >
                                                            📢 {ad}
                                                        </Badge>
                                                    ))}
                                                </>
                                            ) : null;
                                        })()}
                                    </ScrollableTagContainer>
                                    <div className="flex items-center gap-2">
                                        {/* 카테고리 이미지 - 이모지 대신 이미지 표시 */}
                                        <div className="relative w-8 h-8 shrink-0">
                                            <Image
                                                src={getCategoryImagePath(categories[0] || '')}
                                                alt={categories[0] || '카테고리'}
                                                fill
                                                sizes="32px"
                                                className="object-contain"
                                            />
                                        </div>
                                        <h2
                                            className="text-xl font-bold truncate"
                                            title={restaurant.name}
                                        >
                                            {restaurant.name}
                                        </h2>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                            {/* 공유하기 버튼 */}
                            {viewMode === 'detail' && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={handleShareUrl}
                                    title={isShareCopied ? "복사됨!" : "공유하기"}
                                    className={isShareCopied ? "bg-green-50 border-green-300 text-green-600" : ""}
                                >
                                    {isShareCopied ? (
                                        <Check className="h-4 w-4" />
                                    ) : (
                                        <Share2 className="h-4 w-4" />
                                    )}
                                </Button>
                            )}
                            {/* 북마크 버튼 - 모든 사용자에게 표시 */}
                            {viewMode === 'detail' && (
                                <BookmarkButton restaurantId={restaurant.id} />
                            )}
                            {isAdmin && onEditRestaurant && viewMode === 'detail' && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={onEditRestaurant}
                                    className="text-primary hover:text-primary"
                                >
                                    <Settings className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>

                </div>

                {/* 내용 */}
                        <div
	                        data-restaurant-detail-swipe-area="content"
	                        className="relative flex-1 w-full max-w-full overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
	                        style={{ touchAction: 'pan-y' }}
	                        onTouchStart={handleContentSwipeStart}
	                        onTouchMove={handleContentSwipeMove}
                        onTouchEnd={handleContentSwipeEnd}
                        onTouchCancel={handleContentSwipeCancel}
                    >
	                        <div className="p-4 space-y-4">
                        {viewMode === 'detail' ? (
                            <>
                                {/* 연락처 정보 */}
                                <div className="space-y-3">
                                    <h3 className="font-semibold text-sm flex items-center gap-2">
                                        <Store className="h-4 w-4 text-muted-foreground" />
                                        매장 정보
                                    </h3>

                                    {uniqueData?.roadAddresses.map((address, index) => (
                                        <div
                                            key={index}
                                            className="flex gap-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors group"
                                            onClick={() => handleCopyAddress(address, 'road')}
                                        >
                                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-xs text-muted-foreground">도로명 주소</p>
                                                <p className="text-sm">{address}</p>
                                            </div>
                                            {copiedAddress === 'road' ? (
                                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                            ) : (
                                                <Copy className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            )}
                                        </div>
                                    ))}

                                    {uniqueData?.jibunAddresses && uniqueData.jibunAddresses.length > 0 && uniqueData.jibunAddresses.map((address, index) => (
                                        <div
                                            key={index}
                                            className="flex gap-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors group"
                                            onClick={() => handleCopyAddress(address, 'jibun')}
                                        >
                                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-xs text-muted-foreground">지번 주소</p>
                                                <p className="text-sm">{address}</p>
                                            </div>
                                            {copiedAddress === 'jibun' ? (
                                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                            ) : (
                                                <Copy className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            )}
                                        </div>
                                    ))}

                                    {uniqueData?.englishAddresses && uniqueData.englishAddresses.length > 0 && uniqueData.englishAddresses.map((address, index) => (
                                        <div
                                            key={index}
                                            className="flex gap-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors group"
                                            onClick={() => handleCopyAddress(address, 'english')}
                                        >
                                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-xs text-muted-foreground">영어 주소</p>
                                                <p className="text-sm">{address}</p>
                                            </div>
                                            {copiedAddress === 'english' ? (
                                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                            ) : (
                                                <Copy className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            )}
                                        </div>
                                    ))}


                                </div>

                                {/* 유튜브 링크 */}
                                <Separator />
                                {(restaurant.mergedYoutubeLinks && restaurant.mergedYoutubeLinks.length > 0) || restaurant.youtube_link ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold text-sm flex items-center gap-2">
                                                <Youtube className="h-4 w-4 text-red-500" />
                                                쯔양 유튜브 영상 ({restaurant.mergedYoutubeLinks?.length || 1})
                                            </h3>
                                            {restaurant.mergedYoutubeLinks && restaurant.mergedYoutubeLinks.length > 1 && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setIsYoutubeExpanded(!isYoutubeExpanded)}
                                                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                                >
                                                    {isYoutubeExpanded ? (
                                                        <ChevronUp className="h-4 w-4" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            )}
                                        </div>

                                        {/* 첫 번째 항목은 항상 보임 */}
                                        <div className="space-y-2">
                                            {restaurant.mergedYoutubeLinks && restaurant.mergedYoutubeLinks.length > 0 ? (
                                                <div
                                                    className="relative cursor-pointer rounded-lg overflow-hidden group aspect-video"
                                                    onClick={() => {
                                                        if (restaurant.mergedYoutubeLinks && restaurant.mergedYoutubeLinks.length > 0) {
                                                            window.open(restaurant.mergedYoutubeLinks[0], '_blank');
                                                        }
                                                    }}
                                                >
                                                    {getYouTubeThumbnailUrl(restaurant.mergedYoutubeLinks[0]) && (
                                                        <Image
                                                            src={getYouTubeThumbnailUrl(restaurant.mergedYoutubeLinks[0])!}
                                                            alt={`YouTube Thumbnail 1`}
                                                            fill
                                                            className="object-cover"
                                                            sizes="(max-width: 400px) 100vw, 400px"
                                                            priority
                                                        />
                                                    )}
                                                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                                        <Youtube className="h-12 w-12 text-white" />
                                                    </div>
                                                </div>
                                            ) : restaurant.youtube_link ? (
                                                <div
                                                    className="relative cursor-pointer rounded-lg overflow-hidden group aspect-video"
                                                    onClick={() => {
                                                        if (restaurant.youtube_link) {
                                                            window.open(restaurant.youtube_link, '_blank');
                                                        }
                                                    }}
                                                >
                                                    {getYouTubeThumbnailUrl(restaurant.youtube_link) && (
                                                        <Image
                                                            src={getYouTubeThumbnailUrl(restaurant.youtube_link)!}
                                                            fill
                                                            alt="YouTube Thumbnail"
                                                            className="object-cover"
                                                            sizes="(max-width: 400px) 100vw, 400px"
                                                            priority
                                                        />
                                                    )}
                                                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                                        <Youtube className="h-12 w-12 text-white" />
                                                    </div>
                                                </div>
                                            ) : null}

                                            {/* 추가 항목들은 조건부로 표시 */}
                                            {restaurant.mergedYoutubeLinks && restaurant.mergedYoutubeLinks.length > 1 && isYoutubeExpanded && (
                                                <div className="space-y-2">
                                                    {restaurant.mergedYoutubeLinks.slice(1).map((link, index) => (
                                                        <div
                                                            key={index + 1}
                                                            className="relative cursor-pointer rounded-lg overflow-hidden group aspect-video"
                                                            onClick={() => window.open(link, '_blank')}
                                                        >
                                                            {getYouTubeThumbnailUrl(link) && (
                                                                <Image
                                                                    src={getYouTubeThumbnailUrl(link)!}
                                                                    alt={`YouTube Thumbnail ${index + 2}`}
                                                                    fill
                                                                    className="object-cover"
                                                                    sizes="(max-width: 400px) 100vw, 400px"
                                                                />
                                                            )}
                                                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                                                <Youtube className="h-12 w-12 text-white" />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : null}

                                {/* 쯔양 리뷰 섹션 */}
                                <Separator />
                                {(restaurant.mergedTzuyangReviews && restaurant.mergedTzuyangReviews.length > 0) || restaurant.tzuyang_review ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold text-sm flex items-center gap-2">
                                                <Quote className="h-4 w-4 text-muted-foreground" />
                                                쯔양의 리뷰 ({restaurant.mergedTzuyangReviews?.length || 1})
                                            </h3>
                                            {restaurant.mergedTzuyangReviews && restaurant.mergedTzuyangReviews.length > 1 && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setIsReviewExpanded(!isReviewExpanded)}
                                                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                                >
                                                    {isReviewExpanded ? (
                                                        <ChevronUp className="h-4 w-4" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            )}
                                        </div>

                                        {/* 첫 번째 리뷰는 항상 보임 */}
                                        <div className="space-y-2">
                                            {restaurant.mergedTzuyangReviews && restaurant.mergedTzuyangReviews.length > 0 ? (
                                                <div className="p-4 bg-muted/50 rounded-lg">
                                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                        {restaurant.mergedTzuyangReviews[0]}
                                                    </p>
                                                </div>
                                            ) : restaurant.tzuyang_review ? (
                                                <div className="p-4 bg-muted/50 rounded-lg">
                                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                        {restaurant.tzuyang_review}
                                                    </p>
                                                </div>
                                            ) : null}

                                            {/* 추가 리뷰들은 조건부로 표시 */}
                                            {restaurant.mergedTzuyangReviews && restaurant.mergedTzuyangReviews.length > 1 && isReviewExpanded && (
                                                <div className="space-y-2">
                                                    {restaurant.mergedTzuyangReviews.slice(1).map((review, index) => (
                                                        <div key={index + 1} className="p-4 bg-muted/50 rounded-lg">
                                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                                {review}
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : null}

                                {/* 최근 리뷰 미리보기 */}
                                <Separator />
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-sm flex items-center gap-2">
                                            <Star className="h-4 w-4 text-muted-foreground" />
                                            최근 리뷰 ({totalReviewCount})
                                        </h3>
                                        {totalReviewCount > 3 && (
                                            <Button
                                                variant="link"
                                                size="sm"
                                                className="h-auto p-0 text-xs"
                                                onClick={handleViewAllReviews}
                                            >
                                                전체 보기 →
                                            </Button>
                                        )}
                                    </div>

                                    {reviewsLoading ? (
                                        <div className="text-sm text-muted-foreground text-center py-4">
                                            리뷰를 불러오는 중...
                                        </div>
                                    ) : recentReviews.length === 0 ? (
                                        <div className="text-sm text-muted-foreground text-center py-4">
                                            리뷰가 없습니다
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {recentReviews.map((review) => (
                                                <ReviewCard
                                                    key={review.id}
                                                    review={{
                                                        ...review,
                                                        userAvatarUrl: review.userAvatarUrl || undefined,
                                                        visitedAt: review.visitedAt,
                                                        submittedAt: review.submittedAt,
                                                    }}
                                                    onLike={handleLikeReview}
                                                    onClick={() => { }}
                                                    onRestaurantClick={() => onRestaurantClick?.(restaurant)}
                                                    currentUserId={user?.id}
                                                    onUserClick={onUserClick}
                                                    onEditReview={(reviewData) => setEditingReview({
                                                        ...reviewData,
                                                        restaurantId: restaurant.id,
                                                    })}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : viewMode === 'reviews' ? (
                            /* Reviews View - 모든 리뷰 표시 (ReviewCard 사용) */
                            <div className="space-y-4">
                                {reviewsLoading ? (
                                    <div className="text-sm text-muted-foreground text-center py-4">
                                        리뷰를 불러오는 중...
                                    </div>
                                ) : safeReviewsData.length === 0 ? (
                                    <div className="text-sm text-muted-foreground text-center py-4">
                                        리뷰가 없습니다
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {safeReviewsData.map((review) => (
                                            <ReviewCard
                                                key={review.id}
                                                review={{
                                                    ...review,
                                                    userAvatarUrl: review.userAvatarUrl || undefined,
                                                    visitedAt: review.visitedAt,
                                                    submittedAt: review.submittedAt,
                                                }}
                                                onLike={handleLikeReview}
                                                onClick={() => { }}
                                                onRestaurantClick={() => onRestaurantClick?.(restaurant)}
                                                currentUserId={user?.id}
                                                onUserClick={onUserClick}
                                                onEditReview={(reviewData) => setEditingReview({
                                                    ...reviewData,
                                                    restaurantId: restaurant.id,
                                                })}
                                            />
                                        ))}

                                        {/* 더 보기 버튼 */}
                                        {hasNextPage && (
                                            <Button
                                                variant="outline"
                                                className="w-full mt-4"
                                                onClick={() => fetchNextPage()}
                                                disabled={isFetchingNextPage}
                                            >
                                                {isFetchingNextPage ? '불러오는 중...' : '리뷰 더 보기'}
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* 하단 액션 (네이버/카카오/구글 지도 선택) */}
                {viewMode === 'detail' && (
                    <div className="border-t border-border">
                        {/* Direction Options - 확장 시 표시 */}
                        {isDirectionSheetOpen && (
                            <div className="p-4 border-b border-border bg-muted/30 space-y-2 animate-in slide-in-from-bottom-2 duration-200">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <h4 className="text-sm font-semibold">길찾기 앱 선택</h4>
                                        <p className="text-xs text-muted-foreground">원하시는 지도 앱으로 길찾기를 시작하세요</p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsDirectionSheetOpen(false)}
                                        className="h-8 w-8"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                {/* 네이버 지도 - 추천 */}
                                <Button
                                    onClick={handleNaverMap}
                                    className="w-full min-h-[64px] h-auto bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 text-white shadow-sm"
                                >
                                    <div className="flex items-center gap-3 w-full py-1">
                                        <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                                            <span className="text-green-600 font-black text-lg">N</span>
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="text-sm font-bold">네이버 지도</span>
                                                <Badge className="bg-yellow-400 text-green-900 text-[9px] px-1 py-0 h-3.5 border-0">추천</Badge>
                                            </div>
                                            <p className="text-[11px] text-green-50 opacity-90">국내 상세한 길안내 · 실시간 교통정보</p>
                                        </div>
                                    </div>
                                </Button>

                                {/* 카카오맵 */}
                                <Button
                                    onClick={handleKakaoMap}
                                    variant="outline"
                                    className="w-full min-h-[64px] h-auto border-2 hover:bg-yellow-50 hover:border-yellow-400"
                                >
                                    <div className="flex items-center gap-3 w-full py-1">
                                        <div className="w-9 h-9 bg-yellow-400 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <span className="text-foreground font-black text-lg">K</span>
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="text-sm font-bold text-foreground mb-0.5">카카오맵</div>
                                            <p className="text-[11px] text-muted-foreground">대중교통 · 주차 정보</p>
                                        </div>
                                    </div>
                                </Button>

                                {/* 구글 지도 */}
                                <Button
                                    onClick={handleGoogleMap}
                                    variant="outline"
                                    className="w-full min-h-[64px] h-auto border-2 hover:bg-blue-50 hover:border-blue-400"
                                >
                                    <div className="flex items-center gap-3 w-full py-1">
                                        <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <span className="text-white font-black text-lg">G</span>
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="text-sm font-bold text-foreground mb-0.5">구글 지도</div>
                                            <p className="text-[11px] text-muted-foreground">글로벌 지도 · 위성 뷰</p>
                                        </div>
                                    </div>
                                </Button>
                            </div>
                        )}

                        {/* Main Action Buttons */}
                        <div className="p-4">
                            <div className="grid gap-2" style={{ gridTemplateColumns: '2fr 3fr 2fr' }}>
                                <Button
                                    onClick={handleRequestEditRestaurant}
                                    variant="outline"
                                    size="sm"
                                    className="flex flex-col gap-1 h-auto py-3 px-2"
                                >
                                    <Edit className="h-4 w-4" />
                                    <span className="text-xs">수정 요청</span>
                                </Button>

                                <Button
                                    onClick={handleGetDirections}
                                    className="flex flex-col gap-1 h-auto py-3 px-2 bg-gradient-primary hover:opacity-90"
                                >
                                    <Navigation className="h-4 w-4" />
                                    <span className="text-xs font-medium">길찾기</span>
                                </Button>

                                <Button
                                    onClick={handleWriteReview}
                                    variant="outline"
                                    size="sm"
                                    className="flex flex-col gap-1 h-auto py-3 px-2"
                                >
                                    <MessageSquare className="h-4 w-4" />
                                    <span className="text-xs">리뷰 작성</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {viewMode === 'reviews' && (
                    <div className="p-4 border-t border-border">
                        <Button
                            onClick={handleWriteReview}
                            className="w-full bg-gradient-primary hover:opacity-90 gap-2"
                        >
                            <MessageSquare className="h-4 w-4" />
                            리뷰 작성하기
                        </Button>
                    </div>
                )}
            </div>

            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />

            <ReviewEditModal
                isOpen={!!editingReview}
                onClose={() => setEditingReview(null)}
                review={editingReview}
                onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['restaurant-reviews', restaurant?.id] });
                    setEditingReview(null);
                }}
            />
        </>
    );
}

