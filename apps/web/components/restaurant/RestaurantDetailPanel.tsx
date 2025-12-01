/* eslint-disable @typescript-eslint/no-explicit-any */
import { X, MapPin, Phone, Users, MessageSquare, Youtube, Calendar, Navigation, CheckCircle, Settings, Store, Quote, Star, Edit, ArrowLeft, Clock, Heart, Pin, XCircle, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Restaurant } from "@/types/restaurant";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "@/components/auth/AuthModal";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface RestaurantDetailPanelProps {
    restaurant: Restaurant | null;
    onClose: () => void;
    onWriteReview?: () => void;
    onEditRestaurant?: () => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
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

export function RestaurantDetailPanel({
    restaurant,
    onClose,
    onWriteReview,
    onEditRestaurant,
    onRequestEditRestaurant,
}: RestaurantDetailPanelProps) {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'detail' | 'reviews'>('detail');
    const [likedReviews, setLikedReviews] = useState<Set<string>>(new Set());
    const [copiedAddress, setCopiedAddress] = useState<'road' | 'jibun' | 'english' | null>(null);
    const [isYoutubeExpanded, setIsYoutubeExpanded] = useState(false);
    const [isReviewExpanded, setIsReviewExpanded] = useState(false);

    // 카테고리 처리: categories 배열로 저장됨
    const categories: string[] = restaurant && Array.isArray(restaurant.categories)
        ? restaurant.categories
        : restaurant?.categories
            ? [restaurant.categories]
            : [];

    // 최적 레코드 선택: 가장 긴 이름 -> 가장 긴 지번 주소 순으로 우선순위
    const uniqueData = useMemo(() => {
        if (!restaurant) return null;

        // 모든 레코드 수집 (현재 restaurant + mergedRestaurants)
        const allRecords = [restaurant, ...(restaurant.mergedRestaurants || [])];

        // 우선순위: 1) 가장 긴 이름, 2) 가장 긴 지번 주소
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
        const phone = primaryRecord.phone;

        return {
            roadAddresses: roadAddress ? [roadAddress] : [],
            jibunAddresses: jibunAddress ? [jibunAddress] : [],
            englishAddresses: englishAddress ? [englishAddress] : [],
            phones: phone ? [phone] : [],
        };
    }, [restaurant]);

    // 실제 리뷰 데이터 가져오기
    const { data: reviewsData = [], isLoading: reviewsLoading } = useQuery({
        queryKey: ['restaurant-reviews', restaurant?.id],
        enabled: !!restaurant,
        queryFn: async () => {
            try {
                // 1. 해당 맛집의 승인된 리뷰 조회
                const { data: reviewsData, error: reviewsError } = await supabase
                    .from('reviews')
                    .select('*')
                    .eq('restaurant_id', restaurant.id)
                    .eq('is_verified', true)
                    .order('is_pinned', { ascending: false })
                    .order('created_at', { ascending: false });

                if (reviewsError) {
                    console.error('❌ 리뷰 조회 실패:', reviewsError);
                    return [];
                }

                if (!reviewsData || reviewsData.length === 0) {
                    return [];
                }

                // 2. 필요한 user_id 수집
                const userIds = [...new Set(reviewsData.map(r => r.user_id))];

                // 3. Profiles 가져오기
                const { data: profilesData } = await supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .in('user_id', userIds);

                // 4. Map으로 변환 (빠른 조회)
                const profilesMap = new Map(
                    (profilesData || []).map(p => [p.user_id, p.nickname])
                );

                // 6. 리뷰 좋아요 데이터 조회
                const reviewIds = reviewsData.map(r => r.id);
                const { data: likesData } = await supabase
                    .from('review_likes')
                    .select('review_id, user_id')
                    .in('review_id', reviewIds);

                // 좋아요 수와 사용자 좋아요 상태 계산
                const likesMap = new Map<string, { count: number; isLiked: boolean }>();
                reviewIds.forEach(reviewId => {
                    const likesForReview = likesData?.filter(like => like.review_id === reviewId) || [];
                    likesMap.set(reviewId, {
                        count: likesForReview.length,
                        isLiked: user ? likesForReview.some(like => like.user_id === user.id) : false
                    });
                });

                // 7. 리뷰 데이터 매핑
                const reviews = reviewsData.map(review => {
                    const likesInfo = likesMap.get(review.id) || { count: 0, isLiked: false };
                    return {
                        id: review.id,
                        restaurantName: restaurant.name,
                        restaurantCategories: categories,
                        userName: profilesMap.get(review.user_id) || '탈퇴한 사용자',
                        visitedAt: review.visited_at,
                        submittedAt: review.created_at || '',
                        content: review.content,
                        isVerified: review.is_verified || false,
                        isPinned: review.is_pinned || false,
                        isEditedByAdmin: review.is_edited_by_admin || false,
                        admin_note: review.admin_note || null,
                        photos: review.food_photos ? review.food_photos.map((url: string) => ({ url, type: 'food' })) : [],
                        category: review.categories?.[0] || '',
                        likeCount: likesInfo.count,
                        isLikedByUser: likesInfo.isLiked,
                    };
                }) as Review[];

                return reviews;
            } catch (error) {
                console.error('❌ 리뷰 데이터 조회 중 오류:', error);
                return [];
            }
        },
        enabled: !!restaurant.id
    });

    // 쯔양 구독자 리뷰 우선 표시 (닉네임에 '쯔양' 또는 'tzuyang'이 포함된 사용자)
    const safeReviewsData = Array.isArray(reviewsData) ? reviewsData : [];
    const tzuyangReviews = safeReviewsData.filter(review =>
        review.isVerified &&
        (review.userName.toLowerCase().includes('쯔양') ||
            review.userName.toLowerCase().includes('tzuyang'))
    );
    const otherReviews = safeReviewsData.filter(review =>
        review.isVerified &&
        !(review.userName.toLowerCase().includes('쯔양') ||
            review.userName.toLowerCase().includes('tzuyang'))
    );

    // 우선순위: 쯔양 구독자 리뷰 3개, 그 다음 일반 리뷰
    const priorityReviews = [...tzuyangReviews, ...otherReviews];
    const recentReviews = priorityReviews.slice(0, 3);

    // 초기 로드 시 likedReviews 상태 초기화
    useEffect(() => {
        const safeData = Array.isArray(reviewsData) ? reviewsData : [];
        if (safeData.length > 0) {
            const likedReviewIds = safeData
                .filter(review => review.isLikedByUser)
                .map(review => review.id);
            setLikedReviews(new Set(likedReviewIds));
        }
    }, [reviewsData]);

    // 실시간 좋아요 수 계산 (서버 데이터 + 로컬 변경사항)
    const getRealtimeLikeCount = (review: Review) => {
        const serverLikeCount = review.likeCount;
        const isLikedOnServer = review.isLikedByUser;
        const isLikedLocally = likedReviews.has(review.id);

        // 서버 상태와 로컬 상태가 다르면 조정
        if (isLikedOnServer !== isLikedLocally) {
            return isLikedLocally ? serverLikeCount + 1 : Math.max(0, serverLikeCount - 1);
        }

        return serverLikeCount;
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

    const handleViewAllReviews = () => {
        setViewMode('reviews');
    };

    const handleBackToDetail = () => {
        setViewMode('detail');
    };

    const handleCopyAddress = async (address: string, type: 'road' | 'jibun' | 'english') => {
        try {
            await navigator.clipboard.writeText(address);
            setCopiedAddress(type);
            setTimeout(() => setCopiedAddress(null), 2000);
        } catch (err) {
            console.error('주소 복사 실패:', err);
        }
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

    // restaurant가 없으면 null 반환 (모든 Hook 호출 후)
    if (!restaurant) return null;

    const handleGetDirections = () => {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${restaurant.lat},${restaurant.lng}`;
        window.open(url, '_blank');
    };

    const handleRequestEditRestaurant = () => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }
        onRequestEditRestaurant?.(restaurant);
    };

    const handleWriteReview = () => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }
        onWriteReview?.();
    };

    const handleLikeReview = async (reviewId: string) => {
        if (!user) {
            setIsAuthModalOpen(true);
            return;
        }

        const isCurrentlyLiked = likedReviews.has(reviewId);
        const previousState = new Set(likedReviews);

        // Optimistic update: 즉시 UI 업데이트
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
                    });

                if (error) throw error;
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

    const getCategoryEmoji = (category: string) => {
        const emojiMap: { [key: string]: string } = {
            '고기': '🥩',
            '치킨': '🍗',
            '한식': '🍚',
            '중식': '🥢',
            '일식': '🍣',
            '양식': '🍝',
            '분식': '🥟',
            '카페·디저트': '☕',
            '아시안': '🍜',
            '패스트푸드': '🍔',
            '족발·보쌈': '🍖',
            '돈까스·회': '🍱',
            '피자': '🍕',
            '찜·탕': '🥘',
            '야식': '🌙',
            '도시락': '🍱'
        };
        return emojiMap[category] || '⭐'; // 기본값은 별표
    };

    return (
        <>
            <div className="h-full flex flex-col bg-background border-l border-border">
                {/* Header */}
                <div className="p-4 border-b border-border">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1">
                            {viewMode === 'reviews' && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleBackToDetail}
                                        className="mr-2"
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-bold">
                                            전체 리뷰 ({safeReviewsData.length})
                                        </h3>
                                    </div>
                                </>
                            )}
                            {viewMode === 'detail' && (
                                <div className="flex-1">
                                    <div className="flex gap-1 mb-1 overflow-x-auto scrollbar-hide">
                                        {categories.map((cat, index) => (
                                            <Badge
                                                key={index}
                                                variant={index === 0 ? "default" : "secondary"}
                                                className="text-xs whitespace-nowrap"
                                            >
                                                {cat}
                                            </Badge>
                                        ))}

                                        {/* 광고 태그 */}
                                        {restaurant.youtube_meta && (() => {
                                            const meta = restaurant.youtube_meta as any;
                                            const adsInfo = meta?.ads_info;

                                            if (!adsInfo || adsInfo.is_ads !== true) return null;

                                            const ads = adsInfo.what_ads || [];
                                            const uniqueAds = Array.from(new Set(ads));

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
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-2xl">{getCategoryEmoji(categories[0] || '')}</span>
                                        <h2 className="text-xl font-bold line-clamp-2">
                                            {restaurant.name}
                                        </h2>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-1">
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
                            <Button variant="ghost" size="icon" onClick={onClose}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                </div>

                {/* Content */}
                <ScrollArea className="flex-1">
                    <div className="p-4 space-y-4">
                        {viewMode === 'detail' ? (
                            <>
                                {/* Contact Info */}
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

                                    {uniqueData?.phones.map((phone, index) => (
                                        <div key={index} className="flex gap-3">
                                            <Phone className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            <a
                                                href={`tel:${phone}`}
                                                className="text-sm text-primary hover:underline"
                                            >
                                                {phone}
                                            </a>
                                        </div>
                                    ))}

                                    <div className="flex gap-3">
                                        <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-xs text-muted-foreground">등록일</p>
                                            <p className="text-sm">
                                                {restaurant.created_at
                                                    ? new Date(restaurant.created_at).toLocaleDateString('ko-KR')
                                                    : '-'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* YouTube Links */}
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
                                                    onClick={() => window.open(restaurant.mergedYoutubeLinks[0], '_blank')}
                                                >
                                                    {getYouTubeThumbnailUrl(restaurant.mergedYoutubeLinks[0]) && (
                                                        <img
                                                            src={getYouTubeThumbnailUrl(restaurant.mergedYoutubeLinks[0])!}
                                                            alt={`YouTube Thumbnail 1`}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    )}
                                                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                                        <Youtube className="h-12 w-12 text-white" />
                                                    </div>
                                                </div>
                                            ) : restaurant.youtube_link ? (
                                                <div
                                                    className="relative cursor-pointer rounded-lg overflow-hidden group aspect-video"
                                                    onClick={() => window.open(restaurant.youtube_link, '_blank')}
                                                >
                                                    {getYouTubeThumbnailUrl(restaurant.youtube_link) && (
                                                        <img
                                                            src={getYouTubeThumbnailUrl(restaurant.youtube_link)!}
                                                            alt="YouTube Thumbnail"
                                                            className="w-full h-full object-cover"
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
                                                                <img
                                                                    src={getYouTubeThumbnailUrl(link)!}
                                                                    alt={`YouTube Thumbnail ${index + 2}`}
                                                                    className="w-full h-full object-cover"
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

                                {/* Recent Reviews Preview */}
                                <Separator />
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-sm flex items-center gap-2">
                                            <Star className="h-4 w-4 text-muted-foreground" />
                                            최근 리뷰 ({safeReviewsData.length})
                                        </h3>
                                        {safeReviewsData.length > 0 && (
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
                                        <div className="space-y-2">
                                            {recentReviews.map((review) => (
                                                <Card key={review.id} className="p-3 relative">
                                                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                                                        <span className="text-xs text-gray-600 bg-white/80 px-1 py-0.5 rounded backdrop-blur-sm">
                                                            {getRealtimeLikeCount(review)}
                                                        </span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 bg-white/80 hover:bg-white/90 backdrop-blur-sm"
                                                            onClick={() => handleLikeReview(review.id)}
                                                        >
                                                            <Heart
                                                                className={`h-3 w-3 ${likedReviews.has(review.id)
                                                                    ? 'fill-red-500 text-red-500'
                                                                    : 'text-gray-400'
                                                                    }`}
                                                            />
                                                        </Button>
                                                    </div>
                                                    <div className="mb-2">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-xs font-medium truncate">
                                                                {review.userName}
                                                            </span>
                                                            {review.isVerified && (
                                                                <Badge variant="default" className="h-4 px-1 text-[10px] bg-green-600">
                                                                    <CheckCircle className="h-2 w-2 mr-0.5" />
                                                                    인증
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <Clock className="h-3 w-3 text-muted-foreground" />
                                                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                                {formatDateTime(review.submittedAt)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                                        {review.content}
                                                    </p>
                                                    {/* Photos */}
                                                    {review.photos.length > 0 && (
                                                        <div className="mt-2">
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
                                                </Card>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            /* Reviews View - 모든 리뷰 표시 */
                            <div className="space-y-4">
                                {reviewsLoading ? (
                                    <div className="text-sm text-muted-foreground text-center py-8">
                                        리뷰를 불러오는 중...
                                    </div>
                                ) : safeReviewsData.length === 0 ? (
                                    <div className="text-sm text-muted-foreground text-center py-8">
                                        리뷰가 없습니다
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {safeReviewsData.map((review) => (
                                            <Card key={review.id} className={`p-4 ${review.isPinned ? "border-primary border-2" : ""}`}>
                                                {/* Header */}
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            {review.isPinned && (
                                                                <Pin className="h-4 w-4 text-primary fill-primary" />
                                                            )}
                                                            <span className="text-sm font-semibold">{review.userName}</span>
                                                            {review.isVerified && (
                                                                <Badge variant="default" className="h-4 px-1 text-[10px] bg-green-600">
                                                                    <CheckCircle className="h-2 w-2 mr-0.5" />
                                                                    승인됨
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                            <Clock className="h-3 w-3" />
                                                            <span>{formatDateTime(review.submittedAt)}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className="text-sm text-muted-foreground">
                                                            {getRealtimeLikeCount(review)}
                                                        </span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={() => handleLikeReview(review.id)}
                                                        >
                                                            <Heart
                                                                className={`h-4 w-4 ${likedReviews.has(review.id)
                                                                    ? 'fill-red-500 text-red-500'
                                                                    : 'text-gray-400'
                                                                    }`}
                                                            />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {review.isEditedByAdmin && (
                                                    <Badge variant="outline" className="mb-2 border-orange-500 text-orange-500 text-xs">
                                                        ⚠️ 관리자가 수정함
                                                    </Badge>
                                                )}

                                                {/* Content */}
                                                <div className="mb-3">
                                                    <p className="text-sm whitespace-pre-wrap">{review.content}</p>
                                                </div>

                                                {/* 거부 사유 (거부된 리뷰인 경우) */}
                                                {review.admin_note && review.admin_note.includes('거부') && (
                                                    <div className="mb-3 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <XCircle className="h-4 w-4 text-red-600" />
                                                            <span className="text-sm font-medium text-red-700 dark:text-red-300">
                                                                거부 사유
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-red-600 dark:text-red-400">
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
                                            </Card>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </ScrollArea>

                {/* Footer Actions */}
                {viewMode === 'detail' && (
                    <div className="p-4 border-t border-border space-y-2">
                        <Button
                            onClick={handleGetDirections}
                            variant="outline"
                            className="w-full gap-2"
                        >
                            <Navigation className="h-4 w-4" />
                            길찾기
                        </Button>

                        <Button
                            onClick={handleRequestEditRestaurant}
                            variant="outline"
                            className="w-full gap-2"
                        >
                            <Edit className="h-4 w-4" />
                            맛집 수정 요청
                        </Button>

                        <Button
                            onClick={handleWriteReview}
                            className="w-full bg-gradient-primary hover:opacity-90 gap-2"
                        >
                            <MessageSquare className="h-4 w-4" />
                            리뷰 작성하기
                        </Button>
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
        </>
    );
}

