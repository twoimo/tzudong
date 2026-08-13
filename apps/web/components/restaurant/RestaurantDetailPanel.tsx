import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Restaurant } from "@/types/restaurant";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "@/lib/no-toast";
import {
    X,
    MapPin,
    MessageSquare,
    Share2,
    Navigation,
    Edit,
    Copy,
    ChevronDown,
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
import { YouTubeIcon } from "@/components/icons/YouTubeIcon";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "@/components/auth/AuthModal";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Image from "next/image";
import { ScrollableTagContainer } from "@/components/ui/scrollable-tag-container";
import { BookmarkButton } from "@/components/ui/bookmark-button";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { ReviewEditModal } from "@/components/reviews/ReviewEditModal";
import { useReviewLikesRealtime } from "@/hooks/use-review-likes-realtime";
import { openExternalUrl } from "@/lib/open-external-url";
import {
    collectDirectRestaurantReviewIds,
    getRestaurantReviewLookupName,
    selectRelatedRestaurantReviewIds,
} from "@/lib/restaurant-review-lookup";
import { collectRestaurantMergedMedia } from "@/lib/restaurant-merged-media";
import { buildRestaurantDetailMediaCopy } from "@/lib/restaurant-detail-media-copy";
import { buildRestaurantAddressDisplayEntries, type RestaurantAddressEntryType } from "@/lib/restaurant-address-presenter";
import {
    buildCanonicalYouTubeWatchUrl,
    extractCanonicalYouTubeVideoId,
} from "@/lib/youtube-url";
import { buildRestaurantMapDestinationUrls } from "@/lib/restaurant-outbound-url";
import { readPublicProfileSummaries } from "@/lib/public-profile-read";

type ReviewRow = Tables<'reviews'>;
type ReviewLikeRow = Pick<Tables<'review_likes'>, 'review_id'>;
type RestaurantWithVerifiedCount = Restaurant & { verified_review_count?: number };


interface RestaurantDetailPanelProps {
    restaurant: Restaurant | null;
    onClose: () => void;
    onWriteReview?: () => void;
    onEditRestaurant?: () => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    onOpenDirectionSheet?: () => void;
    onToggleCollapse?: () => void;
    isPanelOpen?: boolean;
    isMobile?: boolean;
    className?: string;
    showDesktopBackButton?: boolean;
    onUserClick?: (userId: string) => void;
    onRestaurantClick?: (restaurant: Restaurant) => void;
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
}

const RESTAURANT_DETAIL_SWIPE_HINT_KEY = 'restaurant-detail-swipe-hint-seen-v1';
const RESTAURANT_DETAIL_REVIEW_SELECT = 'id,user_id,restaurant_id,visited_at,created_at,content,food_photos,categories,is_verified,is_pinned,is_edited_by_admin,admin_note,like_count';
const RESTAURANT_DETAIL_REVIEW_STALE_MS = 60 * 1000;
const RESTAURANT_DETAIL_REVIEW_GC_MS = 5 * 60 * 1000;
type MapProviderLogoType = 'naver' | 'kakao' | 'google';

function MapProviderLogo({ provider }: { provider: MapProviderLogoType }) {
    if (provider === 'naver') {
        return (
            <span
                aria-hidden="true"
                data-map-provider-logo="naver"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-white/70"
            >
                <svg viewBox="0 0 40 40" className="h-8 w-8" focusable="false">
                    <rect width="40" height="40" rx="10" fill="#03C75A" />
                    <path
                        d="M24.35 9.5v12.08L15.65 9.5H9.5v21h6.15V18.42l8.7 12.08h6.15v-21h-6.15Z"
                        fill="#fff"
                    />
                </svg>
            </span>
        );
    }

    if (provider === 'kakao') {
        return (
            <span
                aria-hidden="true"
                data-map-provider-logo="kakao"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FEE500] shadow-sm ring-1 ring-black/10"
            >
                <svg viewBox="0 0 40 40" className="h-8 w-8" focusable="false">
                    <rect width="40" height="40" rx="10" fill="#FEE500" />
                    <path
                        d="M20 8.25c-6.35 0-11.5 4.05-11.5 9.05 0 3.2 2.12 6.02 5.33 7.63l-1.08 4.01c-.17.64.55 1.14 1.08.75l4.65-3.35c.5.06 1.01.09 1.52.09 6.35 0 11.5-4.05 11.5-9.13 0-5-5.15-9.05-11.5-9.05Z"
                        fill="#191919"
                    />
                    <path
                        d="M15.35 16h2.05v2.35L19.5 16h2.42l-2.48 2.58L22.05 23h-2.38l-1.62-2.77-.65.67V23h-2.05v-7Zm7.35 0h2.05v5.2h3V23H22.7v-7Z"
                        fill="#FEE500"
                    />
                </svg>
            </span>
        );
    }

    return (
        <span
            aria-hidden="true"
            data-map-provider-logo="google"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-border"
        >
            <svg viewBox="0 0 40 40" className="h-8 w-8" focusable="false">
                <path
                    d="M20 3.75c-5.78 0-10.47 4.58-10.47 10.22 0 7.74 10.47 22.28 10.47 22.28s10.47-14.54 10.47-22.28C30.47 8.33 25.78 3.75 20 3.75Z"
                    fill="#34A853"
                />
                <path
                    d="M20 3.75c-3.03 0-5.76 1.26-7.67 3.28l4.97 4.97A3.79 3.79 0 0 1 20 10.88h9.37C28.05 6.75 24.3 3.75 20 3.75Z"
                    fill="#4285F4"
                />
                <path
                    d="M12.33 7.03a10.03 10.03 0 0 0-2.8 6.94c0 1.94.66 4.31 1.67 6.83l6.1-6.1a3.79 3.79 0 0 1 0-2.7l-4.97-4.97Z"
                    fill="#FBBC04"
                />
                <path
                    d="M20 17.12a3.2 3.2 0 0 1-2.7-1.48l-6.1 6.1c2.7 6.48 8.8 14.51 8.8 14.51s3.24-4.5 6.12-9.72L20 17.12Z"
                    fill="#EA4335"
                />
                <path
                    d="M29.37 10.88H20a3.22 3.22 0 0 1 0 6.44l6.12 9.21c2.35-4.27 4.35-9.02 4.35-12.56 0-1.08-.17-2.12-.5-3.09h-.6Z"
                    fill="#4285F4"
                />
                <circle cx="20" cy="14" r="3.35" fill="#fff" />
            </svg>
        </span>
    );
}

interface Review {
    id: string;
    restaurantId: string;
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
    onOpenDirectionSheet,
    onToggleCollapse,
    isPanelOpen = true,
    isMobile = false,
    className,
    showDesktopBackButton = false,
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
    const [copiedAddress, setCopiedAddress] = useState<RestaurantAddressEntryType | null>(null);
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
    const restaurantId = restaurant?.id ?? null;
    const shouldLoadReviewData = Boolean(restaurantId);

    const handleBookmarkRequireAuth = useCallback(() => {
        setIsAuthModalOpen(true);
    }, []);

    // [실시간] 좋아요 실시간 반영
    useReviewLikesRealtime(shouldLoadReviewData);

    // [카테고리 처리] categories 배열로 저장됨
    const categories: string[] = restaurant && Array.isArray(restaurant.categories)
        ? (restaurant.categories as string[])
        : restaurant?.categories
            ? [restaurant.categories as unknown as string]
            : [];
    const mergedMedia = useMemo(() => collectRestaurantMergedMedia(restaurant), [restaurant]);
    const youtubeLinks = mergedMedia.youtubeLinks;
    const youtubeVideos = useMemo(
        () => youtubeLinks.flatMap((youtubeLink) => {
            const videoId = extractCanonicalYouTubeVideoId(youtubeLink);
            const watchUrl = buildCanonicalYouTubeWatchUrl(videoId);
            if (!videoId || !watchUrl) return [];

            return [{
                thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                watchUrl,
            }];
        }),
        [youtubeLinks],
    );
    const tzuyangReviews = mergedMedia.tzuyangReviews;
    const youtubeMetas = mergedMedia.youtubeMetas;
    const youtubeCopy = useMemo(
        () => buildRestaurantDetailMediaCopy('youtube', youtubeVideos.length, isYoutubeExpanded),
        [isYoutubeExpanded, youtubeVideos.length],
    );
    const reviewCopy = useMemo(
        () => buildRestaurantDetailMediaCopy('review', tzuyangReviews.length, isReviewExpanded),
        [isReviewExpanded, tzuyangReviews.length],
    );

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
            addressEntries: buildRestaurantAddressDisplayEntries({
                road_address: roadAddress,
                jibun_address: jibunAddress,
                english_address: englishAddress,
            }),
        };
    }, [restaurant]);
    const mapDestinationUrls = useMemo(
        () => restaurant
            ? buildRestaurantMapDestinationUrls({
                name: restaurant.name,
                lat: restaurant.lat,
                lng: restaurant.lng,
            })
            : null,
        [restaurant],
    );

    // [데이터 조회] 리뷰 무한 스크롤 (성능 최적화: 15개씩 페이징)
    const {
        data: reviewsInfiniteData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: reviewsLoading
    } = useInfiniteQuery({
        queryKey: ['restaurant-reviews', restaurant?.id, user?.id],
        queryFn: async ({ pageParam = 0 }) => {
            try {
                if (!restaurant) return { reviews: [], nextCursor: null };
                const REVIEW_PAGE_SIZE = 15;

                // 0. 모든 관련 레코드 ID 수집
                // 지도에는 approved 레코드만 올라오지만, 과거 리뷰가 같은 이름/주소의
                // deleted 중복 레코드에 남아 있을 수 있다. 리뷰 조회에서는 그 레코드까지
                // 포함해야 사용자가 작성한 기존 리뷰가 바텀시트에서 사라지지 않는다.
                let allIds = collectDirectRestaurantReviewIds(restaurant);
                const reviewLookupName = getRestaurantReviewLookupName(restaurant);

                if (reviewLookupName) {
                    const candidateSelect = 'id, name:approved_name, approved_name, origin_name, naver_name, google_name, road_address, jibun_address';
                    const lookupNames = Array.from(new Set([
                        reviewLookupName,
                        restaurant.origin_name,
                        restaurant.naver_name,
                        restaurant.google_name,
                        ...(restaurant.mergedRestaurants || []).flatMap((mergedRestaurant) => [
                            mergedRestaurant.approved_name,
                            mergedRestaurant.name,
                            mergedRestaurant.origin_name,
                            mergedRestaurant.naver_name,
                            mergedRestaurant.google_name,
                        ]),
                    ].map((name) => name?.trim()).filter((name): name is string => Boolean(name))));
                    const lookupAddresses = Array.from(new Set([
                        restaurant.road_address,
                        restaurant.jibun_address,
                        ...(restaurant.mergedRestaurants || []).flatMap((mergedRestaurant) => [
                            mergedRestaurant.road_address,
                            mergedRestaurant.jibun_address,
                        ]),
                    ].filter((address): address is string => Boolean(address))));

                    const relatedRestaurantResults = await Promise.all([
                        ...lookupNames.flatMap((name) => [
                            supabase
                                .from('restaurants')
                                .select(candidateSelect)
                                .eq('approved_name', name),
                            supabase
                                .from('restaurants')
                                .select(candidateSelect)
                                .eq('origin_name', name),
                            supabase
                                .from('restaurants')
                                .select(candidateSelect)
                                .eq('naver_name', name),
                            supabase
                                .from('restaurants')
                                .select(candidateSelect)
                                .eq('google_name', name),
                        ]),
                        ...lookupAddresses.map((address) =>
                            supabase
                                .from('restaurants')
                                .select(candidateSelect)
                                .eq('road_address', address)
                        ),
                        ...lookupAddresses.map((address) =>
                            supabase
                                .from('restaurants')
                                .select(candidateSelect)
                                .eq('jibun_address', address)
                        ),
                    ]);

                    const relatedRestaurants = relatedRestaurantResults.flatMap((result) => result.data || []);

                    allIds = selectRelatedRestaurantReviewIds(restaurant, relatedRestaurants as Restaurant[]);
                }

                // 1. 해당 맛집의 승인된 리뷰 조회 (Paging)
                const { data: reviewsPageData, error: reviewsError } = await supabase
                    .from('reviews')
                    .select(RESTAURANT_DETAIL_REVIEW_SELECT)
                    .in('restaurant_id', allIds)
                    .eq('is_verified', true)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false })
                    .range(pageParam, pageParam + (REVIEW_PAGE_SIZE - 1)); // 15개씩 조회

                if (reviewsError) throw reviewsError;
                if (!reviewsPageData || reviewsPageData.length === 0) {
                    return { restaurantId: restaurant.id, reviews: [], nextCursor: null };
                }
                const allowedReviewRestaurantIds = new Set(allIds);
                const typedReviewsPageData = (reviewsPageData as ReviewRow[]).filter((review) =>
                    typeof review.restaurant_id === 'string' &&
                    allowedReviewRestaurantIds.has(review.restaurant_id)
                );
                if (typedReviewsPageData.length === 0) {
                    return { restaurantId: restaurant.id, reviews: [], nextCursor: null };
                }

                // 2. 필요한 user_id 수집
                const userIds = [...new Set(typedReviewsPageData.map((review) => review.user_id))];
                const reviewIds = typedReviewsPageData.map((review) => review.id);

                // 3. Profiles / 사용자 좋아요 여부를 병렬 조회
                const [typedProfilesData, userLikesResult] = await Promise.all([
                    readPublicProfileSummaries(supabase, userIds).catch(() => []),
                    user
                        ? supabase
                            .from('review_likes')
                            .select('review_id')
                            .in('review_id', reviewIds)
                            .eq('user_id', user.id)
                        : Promise.resolve({ data: [] }),
                ]);
                // 4. Map으로 변환
                const profilesMap = new Map<string, { nickname: string; avatarUrl: string | null }>(
                    typedProfilesData.map((profile) => [profile.user_id, { nickname: profile.nickname, avatarUrl: profile.avatar_url }])
                );

                const userLikesMap = new Map(
                    ((userLikesResult.data || []) as ReviewLikeRow[]).map((like) => [like.review_id, true])
                );

                // 7. 리뷰 데이터 매핑
                const reviews = typedReviewsPageData.map((review) => {
                    const userProfile = profilesMap.get(review.user_id);

                    return {
                        restaurantId: review.restaurant_id ?? restaurant.id,
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
                        category: (Array.isArray(review.categories) && review.categories.length > 0) ? review.categories[0] : '',
                        categories: Array.isArray(review.categories) ? review.categories : [],
                        likeCount: review.like_count || 0,
                        isLikedByUser: userLikesMap.get(review.id) || false,
                    };
                }) as Review[];

                const nextCursor = reviewsPageData.length === REVIEW_PAGE_SIZE ? pageParam + REVIEW_PAGE_SIZE : null;
                return { restaurantId: restaurant.id, reviews, nextCursor };
            } catch (error) {
                console.error('❌ 리뷰 데이터 조회 중 오류:');
                return { restaurantId: restaurant?.id ?? null, reviews: [], nextCursor: null };
            }
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
        enabled: !!restaurant?.id && shouldLoadReviewData,
        staleTime: RESTAURANT_DETAIL_REVIEW_STALE_MS,
        gcTime: RESTAURANT_DETAIL_REVIEW_GC_MS,
    });

    const currentRestaurantId = restaurant?.id ?? null;
    const safeReviewsData = useMemo(() =>
        reviewsInfiniteData?.pages
            .filter(page => page.restaurantId === currentRestaurantId)
            .flatMap(page => page.reviews) || [],
        [currentRestaurantId, reviewsInfiniteData]);

    // [리뷰 정렬] 최근 리뷰는 작성일순(Query에서 정렬됨)으로 표시 - 3개만 미리보기
    const recentReviews = safeReviewsData.slice(0, 3);

    // [총 리뷰 수]
    const persistedVerifiedReviewCount = (restaurant as RestaurantWithVerifiedCount | null)?.verified_review_count;
    const totalReviewCount = Math.max(persistedVerifiedReviewCount ?? 0, safeReviewsData.length);

    // [무한 스크롤 감시] 리뷰 목록 추가 로드
    const loadMoreReviewsRef = useRef<HTMLDivElement>(null);

    const handleLoadMoreReviews = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    // [초기화] 초기 로드 시 likedReviews 상태 초기화
    useEffect(() => {
        if (safeReviewsData.length > 0) {
            const likedReviewIds = safeReviewsData
                .filter(review => review.isLikedByUser)
                .map(review => review.id);
            setLikedReviews(new Set(likedReviewIds));
        }
    }, [safeReviewsData]);

    useEffect(() => {
        if (viewMode !== 'reviews') return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    handleLoadMoreReviews();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreReviewsRef.current) {
            observer.observe(loadMoreReviewsRef.current);
        }

        return () => observer.disconnect();
    }, [handleLoadMoreReviews, viewMode]);

    // [핸들러] 전체 리뷰 보기
    const handleViewAllReviews = useCallback(() => {
        setViewMode('reviews');
    }, []);

    // [핸들러] 상세 정보로 돌아가기
    const handleBackToDetail = useCallback(() => {
        setViewMode('detail');
    }, []);



    // [핸들러] 주소 복사
    const handleCopyAddress = useCallback(async (address: string, type: RestaurantAddressEntryType) => {
        try {
            await navigator.clipboard.writeText(address);
            setCopiedAddress(type);
            setTimeout(() => setCopiedAddress(null), 2000);
        } catch (err) {
            console.error('주소 복사 실패:');
        }
    }, []);

    const RESTAURANT_DETAIL_SWIPE_THRESHOLD = 10;
    const RESTAURANT_DETAIL_SWIPE_INTENT_RATIO = 0.85;

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

        // [Fix] 캐러셀 내부 터치는 맛집 전환 스와이프로 처리하지 않음
        // 캐러셀 이미지 스와이프가 맛집 전환으로 오인식되어 바텀시트가 최상단으로 이동하는 버그 수정
        const target = e.target as HTMLElement;
        if (target.closest('[aria-roledescription="carousel"]')) {
            isContentSwipingRef.current = false;
            return;
        }

        contentSwipeStartXRef.current = touch.clientX;
        contentSwipeStartYRef.current = touch.clientY;
        contentSwipeDirectionRef.current = null;
        isContentSwipingRef.current = true;
        hideSwipeHint();
    }, [hideSwipeHint]);

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
            const isHorizontalSwipe =
                absDeltaX >= RESTAURANT_DETAIL_SWIPE_THRESHOLD &&
                absDeltaX >= absDeltaY * RESTAURANT_DETAIL_SWIPE_INTENT_RATIO;
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

        const isValidSwipe =
            absDeltaX >= RESTAURANT_DETAIL_SWIPE_THRESHOLD &&
            absDeltaX >= absDeltaY * RESTAURANT_DETAIL_SWIPE_INTENT_RATIO;
        const isPossibleSwipe =
            absDeltaX >= RESTAURANT_DETAIL_SWIPE_THRESHOLD &&
            absDeltaX >= absDeltaY * 0.8;

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
            console.warn('URL 복사 실패:');

            // 포커스 문제 등으로 실패 시 처리
            if (!document.hasFocus()) {
                console.warn('문서 포커스 없음, 클립보드 쓰기 건너뜀');
            } else {
                toast.error('링크 복사에 실패했습니다');
            }
        }
    }, [restaurant]);

    // [예외 처리] restaurant가 없으면 null 반환 (모든 Hook 호출 후)
    if (!restaurant) return null;

    // [핸들러] 길찾기 시트 열기
    const handleGetDirections = () => {
        if (!mapDestinationUrls) return;

        onOpenDirectionSheet?.();
        setIsDirectionSheetOpen(true);
    };

    // [핸들러] 네이버 지도 열기
    const handleNaverMap = () => {
        if (!mapDestinationUrls) return;

        openExternalUrl(mapDestinationUrls.naver);
        setIsDirectionSheetOpen(false);
    };

    // [핸들러] 구글 지도 열기
    const handleGoogleMap = () => {
        if (!mapDestinationUrls) return;

        openExternalUrl(mapDestinationUrls.google);
        setIsDirectionSheetOpen(false);
    };

    // [핸들러] 카카오맵 열기
    const handleKakaoMap = () => {
        if (!mapDestinationUrls) return;

        openExternalUrl(mapDestinationUrls.kakao);
        setIsDirectionSheetOpen(false);
    };

    // [핸들러] 수정 요청
    const handleRequestEditRestaurant = () => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }
        onRequestEditRestaurant?.(restaurant);
    };

    // [핸들러] 리뷰 작성
    const handleWriteReview = () => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }
        onWriteReview?.();
    };

    const handleLikeReview = async (reviewId: string, currentIsLiked?: boolean) => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }

        const isCurrentlyLiked = currentIsLiked ?? likedReviews.has(reviewId);
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
                        user_id: user.id
                    } as never);

                if (error) throw error;

                try {
                    const notificationResponse = await fetch('/api/notifications/review-like', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reviewId }),
                    });

                    if (!notificationResponse.ok) {
                        // 알림 실패는 이미 적용된 좋아요를 되돌리지 않는다.
                    }
                } catch {
                    // 네트워크 오류는 이미 적용된 좋아요를 되돌리지 않는다.
                }
            }

            // 성공 시 쿼리 캐시 무효화하여 좋아요 수 업데이트
            await queryClient.invalidateQueries({
                queryKey: ['restaurant-reviews', restaurant?.id]
            });

        } catch (error) {
            console.error('좋아요 처리 중 오류:');

            // 실패 시 원래 상태로 롤백
            setLikedReviews(previousState);
            throw error;
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
                                        aria-label="상세 정보로 돌아가기"
                                    >
                                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
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
                                <>
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
                                                const metas: unknown[] = youtubeMetas;

                                                metas.forEach((meta) => {
                                                    if (!meta || typeof meta !== 'object') return;
                                                    if (!('ads_info' in meta)) return;

                                                    const adsInfo = (meta as { ads_info?: unknown }).ads_info;
                                                    if (!adsInfo || typeof adsInfo !== 'object') return;

                                                    const { is_ads, what_ads } = adsInfo as { is_ads?: unknown; what_ads?: unknown };
                                                    if (is_ads === true && Array.isArray(what_ads)) {
                                                        const normalizedAds = what_ads.filter((ad): ad is string => typeof ad === 'string');
                                                        allAds.push(...normalizedAds);
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
                                </>
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
                                    aria-label={isShareCopied ? "공유 링크 복사됨" : "맛집 공유 링크 복사"}
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
                                <BookmarkButton
                                    restaurantId={restaurant.id}
                                    onRequireAuth={handleBookmarkRequireAuth}
                                />
                            )}
                            {isAdmin && onEditRestaurant && viewMode === 'detail' && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={onEditRestaurant}
                                    className="text-primary hover:text-primary"
                                    aria-label="맛집 정보 관리자 편집"
                                >
                                    <Settings className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            )}
                            {showDesktopBackButton && !isMobile && viewMode === 'detail' && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={onClose}
                                    title="이전 목록으로 돌아가기"
                                    aria-label="이전 목록으로 돌아가기"
                                >
                                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            )}
                            {isMobile && viewMode === 'detail' && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={onClose}
                                    title="이전 화면으로 돌아가기"
                                    aria-label="이전 화면으로 돌아가기"
                                >
                                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            )}
                        </div>
                    </div>

                </div>

                {/* 내용 */}
	                <div
	                        data-restaurant-detail-swipe-area="content"
	                        className="relative flex-1 min-h-0 w-full max-w-full overflow-y-auto overflow-x-hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] [&::-webkit-scrollbar]:hidden lg:[-ms-overflow-style:auto] lg:[scrollbar-width:thin] lg:[&::-webkit-scrollbar]:block lg:[&::-webkit-scrollbar]:w-1.5 lg:[&::-webkit-scrollbar-thumb]:rounded-full lg:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30"
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

                                    {uniqueData?.addressEntries.map((entry) => (
                                        <button
                                            type="button"
                                            key={`${entry.type}-${entry.address}`}
                                            className="flex w-full gap-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors group text-left"
                                            onClick={() => handleCopyAddress(entry.address, entry.type)}
                                            aria-label={`${entry.label} 복사`}
                                        >
                                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-xs text-muted-foreground">{entry.label}</p>
                                                <p className="text-sm">{entry.address}</p>
                                            </div>
                                            {copiedAddress === entry.type ? (
                                                <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                            ) : (
                                                <Copy className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            )}
                                        </button>
                                    ))}


                                </div>

                                {/* 유튜브 링크 */}
                                {youtubeVideos.length > 0 ? (
                                    <>
                                    <Separator />
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="min-w-0 flex-1 font-semibold text-sm flex flex-wrap items-center gap-2">
                                                <YouTubeIcon className="h-4 w-4 text-red-500" />
                                                {youtubeCopy.title}
                                                {youtubeVideos.length > 1 && (
                                                    <Badge variant="outline" className="ml-1 text-xs">
                                                        {youtubeCopy.countLabel}
                                                    </Badge>
                                                )}
                                            </h3>
                                            {youtubeVideos.length > 1 && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setIsYoutubeExpanded(!isYoutubeExpanded)}
                                                    aria-expanded={isYoutubeExpanded}
                                                    aria-label={youtubeCopy.toggleAriaLabel}
                                                    className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    {isYoutubeExpanded ? (
                                                        <>
                                                            {youtubeCopy.expandedToggleLabel} <ChevronUp className="ml-1 h-3.5 w-3.5" />
                                                        </>
                                                    ) : (
                                                        <>
                                                            {youtubeCopy.collapsedToggleLabel} <ChevronDown className="ml-1 h-3.5 w-3.5" />
                                                        </>
                                                    )}
                                                </Button>
                                            )}
                                        </div>

                                        <div className="space-y-2">
                                            <button
                                                type="button"
                                                className="relative w-full cursor-pointer rounded-lg overflow-hidden group aspect-video"
                                                onClick={() => openExternalUrl(youtubeVideos[0].watchUrl)}
                                                aria-label={youtubeCopy.openAriaLabel(1)}
                                            >
                                                <Image
                                                    src={youtubeVideos[0].thumbnailUrl}
                                                    alt=""
                                                    fill
                                                    className="object-cover"
                                                    sizes="(max-width: 400px) 100vw, 400px"
                                                    priority
                                                />
                                                {youtubeVideos.length > 1 && (
                                                    <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                                                        {youtubeCopy.itemBadge(1)}
                                                    </span>
                                                )}
                                                <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                                    <YouTubeIcon className="h-12 w-12 text-white" />
                                                </div>
                                            </button>

                                            {youtubeVideos.length > 1 && !isYoutubeExpanded && (
                                                <p className="text-xs text-muted-foreground">
                                                    {youtubeCopy.collapsedHint}
                                                </p>
                                            )}

                                            {youtubeVideos.length > 1 && isYoutubeExpanded && (
                                                <div className="space-y-2">
                                                    {youtubeVideos.slice(1).map((video, index) => (
                                                        <button
                                                            type="button"
                                                            key={video.watchUrl}
                                                            className="relative w-full cursor-pointer rounded-lg overflow-hidden group aspect-video"
                                                            onClick={() => openExternalUrl(video.watchUrl)}
                                                            aria-label={youtubeCopy.openAriaLabel(index + 2)}
                                                        >
                                                            <Image
                                                                src={video.thumbnailUrl}
                                                                alt=""
                                                                fill
                                                                className="object-cover"
                                                                sizes="(max-width: 400px) 100vw, 400px"
                                                            />
                                                            <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                                                                {youtubeCopy.itemBadge(index + 2)}
                                                            </span>
                                                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                                                <YouTubeIcon className="h-12 w-12 text-white" />
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    </>
                                ) : null}

                                {/* 쯔양 리뷰 섹션 */}
                                {tzuyangReviews.length > 0 ? (
                                    <>
                                    <Separator />
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="min-w-0 flex-1 font-semibold text-sm flex flex-wrap items-center gap-2">
                                                <Quote className="h-4 w-4 text-muted-foreground" />
                                                {reviewCopy.title}
                                                {tzuyangReviews.length > 1 && (
                                                    <Badge variant="outline" className="ml-1 text-xs">
                                                        {reviewCopy.countLabel}
                                                    </Badge>
                                                )}
                                            </h3>
                                            {tzuyangReviews.length > 1 && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setIsReviewExpanded(!isReviewExpanded)}
                                                    aria-expanded={isReviewExpanded}
                                                    aria-label={reviewCopy.toggleAriaLabel}
                                                    className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    {isReviewExpanded ? (
                                                        <>
                                                            {reviewCopy.expandedToggleLabel} <ChevronUp className="ml-1 h-3.5 w-3.5" />
                                                        </>
                                                    ) : (
                                                        <>
                                                            {reviewCopy.collapsedToggleLabel} <ChevronDown className="ml-1 h-3.5 w-3.5" />
                                                        </>
                                                    )}
                                                </Button>
                                            )}
                                        </div>

                                        <div className="space-y-2">
                                            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                                                {tzuyangReviews.length > 1 && (
                                                    <Badge variant="outline" className="text-xs">
                                                        {reviewCopy.itemBadge(1)}
                                                    </Badge>
                                                )}
                                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                    {tzuyangReviews[0]}
                                                </p>
                                            </div>

                                            {tzuyangReviews.length > 1 && !isReviewExpanded && (
                                                <p className="text-xs text-muted-foreground">
                                                    {reviewCopy.collapsedHint}
                                                </p>
                                            )}

                                            {tzuyangReviews.length > 1 && isReviewExpanded && (
                                                <div className="space-y-2">
                                                    {tzuyangReviews.slice(1).map((review, index) => (
                                                        <div key={`${index}-${review}`} className="p-4 bg-muted/50 rounded-lg space-y-2">
                                                            <Badge variant="outline" className="text-xs">
                                                                {reviewCopy.itemBadge(index + 2)}
                                                            </Badge>
                                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                                {review}
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    </>
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

                                        <div ref={loadMoreReviewsRef} className="h-10 flex items-center justify-center">
                                            {hasNextPage && (
                                                <span className="text-sm text-muted-foreground">
                                                    {isFetchingNextPage ? '리뷰를 더 불러오는 중...' : '스크롤하면 더 불러옵니다'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* 하단 액션 (네이버/카카오/구글 지도 선택) */}
                {viewMode === 'detail' && (
                    <div
                        className={cn(
                            "border-t border-border shrink-0",
                            isDirectionSheetOpen && isMobile && "max-h-[calc(100%-80px)] overflow-y-auto overscroll-contain"
                        )}
                    >
                        {/* Direction Options - 확장 시 표시 */}
                        {isDirectionSheetOpen && mapDestinationUrls && (
                            <div
                                className={cn(
                                    "border-b border-border bg-muted/30 space-y-2 animate-in slide-in-from-bottom-2 duration-200",
                                    isMobile ? "p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]" : "p-4"
                                )}
                            >
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
                                        aria-label="길찾기 앱 선택 닫기"
                                    >
                                        <X className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                </div>

                                {/* 네이버 지도 - 추천 */}
                                <Button
                                    onClick={handleNaverMap}
                                    variant="ghost"
                                    className={cn(
                                        "w-full h-auto !bg-gradient-to-r !from-[#03C75A] !to-[#00B050] hover:!from-[#02B351] hover:!to-[#029E49] !text-white shadow-sm",
                                        isMobile ? "min-h-[56px]" : "min-h-[64px]"
                                    )}
                                    aria-label="네이버 지도로 길찾기 열기"
                                >
                                    <div className="flex items-center gap-3 w-full py-1">
                                        <MapProviderLogo provider="naver" />
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
                                    className={cn(
                                        "w-full h-auto border-2 hover:bg-yellow-50 hover:border-yellow-400",
                                        isMobile ? "min-h-[56px]" : "min-h-[64px]"
                                    )}
                                    aria-label="카카오맵으로 길찾기 열기"
                                >
                                    <div className="flex items-center gap-3 w-full py-1">
                                        <MapProviderLogo provider="kakao" />
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
                                    className={cn(
                                        "w-full h-auto border-2 hover:bg-blue-50 hover:border-blue-400",
                                        isMobile ? "min-h-[56px]" : "min-h-[64px]"
                                    )}
                                    aria-label="구글 지도로 길찾기 열기"
                                >
                                    <div className="flex items-center gap-3 w-full py-1">
                                        <MapProviderLogo provider="google" />
                                        <div className="flex-1 text-left">
                                            <div className="text-sm font-bold text-foreground mb-0.5">구글 지도</div>
                                            <p className="text-[11px] text-muted-foreground">글로벌 지도 · 위성 뷰</p>
                                        </div>
                                    </div>
                                </Button>
                            </div>
                        )}

                        {/* Main Action Buttons */}
                        {(!isDirectionSheetOpen || !isMobile) && (
                            <div className={cn("p-4", isDirectionSheetOpen && isMobile && "pt-2")}>
                                <div
                                    className="grid gap-2"
                                    style={{
                                        gridTemplateColumns: mapDestinationUrls ? '2fr 3fr 2fr' : '1fr 1fr',
                                    }}
                                >
                                    <Button
                                        onClick={handleRequestEditRestaurant}
                                        variant="outline"
                                        size="sm"
                                        className="h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold"
                                    >
                                        <Edit className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        <span className="truncate">수정 요청</span>
                                    </Button>

                                    {mapDestinationUrls ? (
                                        <Button
                                            onClick={handleGetDirections}
                                            className="h-12 min-w-0 items-center justify-center gap-2 rounded-xl bg-gradient-primary px-3 text-sm font-bold shadow-sm hover:opacity-90"
                                        >
                                            <Navigation className="h-4 w-4 shrink-0" aria-hidden="true" />
                                            <span className="truncate">길찾기</span>
                                        </Button>
                                    ) : null}

                                    <Button
                                        onClick={handleWriteReview}
                                        variant="outline"
                                        size="sm"
                                        className="h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold"
                                    >
                                        <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        <span className="truncate">리뷰 작성</span>
                                    </Button>
                                </div>
                            </div>
                        )}
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
