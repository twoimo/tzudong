import { X, MapPin, Phone, Users, MessageSquare, Youtube, Calendar, Navigation, CheckCircle, Settings, Store, Quote, Star, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Restaurant } from "@/types/restaurant";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "@/components/auth/AuthModal";
import { useState } from "react";

interface RestaurantDetailPanelProps {
    restaurant: Restaurant | null;
    onClose: () => void;
    onWriteReview?: () => void;
    onEditRestaurant?: () => void;
    onRequestEditRestaurant?: () => void;
}

interface Review {
    id: string;
    userName: string;
    content: string;
    isVerified: boolean;
    createdAt: string;
    rating: number;
}

export function RestaurantDetailPanel({
    restaurant,
    onClose,
    onWriteReview,
    onEditRestaurant,
    onRequestEditRestaurant,
}: RestaurantDetailPanelProps) {
    const { user, isAdmin } = useAuth();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    if (!restaurant) return null;

    // 카테고리 타입 처리: TEXT[] 배열 또는 단일 값
    const categories: string[] = Array.isArray(restaurant.category)
        ? restaurant.category
        : [String(restaurant.category)].filter(Boolean);


    // Mock recent reviews - 실제로는 Supabase에서 가져와야 함
    const recentReviews: Review[] = [
        {
            id: "1",
            userName: "쯔양팬123",
            content: "정말 맛있었어요! 쯔양이 추천한 메뉴 먹었는데 양도 많고 너무 좋았습니다.",
            isVerified: true,
            createdAt: "2025-01-20T18:30:00",
            rating: 5,
        },
        {
            id: "2",
            userName: "맛집러버",
            content: "분위기도 좋고 음식도 맛있어요. 재방문 의사 있습니다!",
            isVerified: true,
            createdAt: "2025-01-19T12:00:00",
            rating: 4,
        },
    ];

    const getStarEmoji = (rating: number) => {
        return "⭐".repeat(Math.min(rating, 5));
    };

    const formatTimeAgo = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}일 전`;
        if (hours > 0) return `${hours}시간 전`;
        return '방금 전';
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

    const getCategoryEmoji = (category: string) => {
        const emojiMap: { [key: string]: string } = {
            '고기': '🥩',
            '한식': '🍚',
            '분식': '🍜',
            '족발·보쌈': '🦵',
            '돈까스·회': '🍣',
            '치킨': '🍗',
            '피자': '🍕',
            '중식': '🥢',
            '일식': '🍱',
            '양식': '🍝',
            '카페': '☕',
            '디저트': '🍰',
            '패스트푸드': '🍔',
            '기타': '🍽️'
        };

        return emojiMap[category] || '🔥'; // 기본값으로 불꽃 이모티콘
    };

    return (
        <>
            <div className="h-full flex flex-col bg-background border-l border-border">
            {/* Header */}
            <div className="p-4 border-b border-border">
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                        <div className="flex flex-wrap gap-1 mb-1">
                            {categories.map((cat, index) => (
                                <Badge
                                    key={index}
                                    variant={index === 0 ? "default" : "secondary"}
                                    className="text-xs"
                                >
                                    {cat}
                                </Badge>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">{getCategoryEmoji(categories[0] || '')}</span>
                            <h2 className="text-xl font-bold line-clamp-2">{restaurant.name}</h2>
                        </div>
                    </div>
                    <div className="flex gap-1">
                        {isAdmin && onEditRestaurant && (
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

                    {/* Contact Info */}
                    <div className="space-y-3">
                        <h3 className="font-semibold text-sm flex items-center gap-2">
                            <Store className="h-4 w-4 text-muted-foreground" />
                            매장 정보
                        </h3>

                        {restaurant.address && (
                            <div className="flex gap-3">
                                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                    <p className="text-sm">{restaurant.address}</p>
                                </div>
                            </div>
                        )}

                        {restaurant.phone && (
                            <div className="flex gap-3">
                                <Phone className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                <a
                                    href={`tel:${restaurant.phone}`}
                                    className="text-sm text-primary hover:underline"
                                >
                                    {restaurant.phone}
                                </a>
                            </div>
                        )}

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

                    {/* YouTube Link */}
                    {restaurant.youtube_link && (
                        <>
                            <Separator />
                            <div className="space-y-3">
                                <h3 className="font-semibold text-sm flex items-center gap-2">
                                    <Youtube className="h-4 w-4 text-red-500" />
                                    쯔양 유튜브 영상
                                </h3>
                                <div
                                    className="relative cursor-pointer rounded-lg overflow-hidden group"
                                    onClick={() => window.open(restaurant.youtube_link, '_blank')}
                                >
                                    {getYouTubeThumbnailUrl(restaurant.youtube_link) && (
                                        <img
                                            src={getYouTubeThumbnailUrl(restaurant.youtube_link)!}
                                            alt="YouTube Thumbnail"
                                            className="w-full h-48 object-cover"
                                        />
                                    )}
                                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                        <Youtube className="h-12 w-12 text-white" />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* 쯔양 리뷰 */}
                    {restaurant.tzuyang_review && (
                        <>
                            <Separator />
                            <div className="space-y-2">
                                <h3 className="font-semibold text-sm flex items-center gap-2">
                                    <Quote className="h-4 w-4 text-muted-foreground" />
                                    쯔양의 리뷰
                                </h3>
                                <div className="p-4 bg-muted/50 rounded-lg">
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                        {restaurant.tzuyang_review}
                                    </p>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Recent Reviews Preview */}
                    <Separator />
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-sm flex items-center gap-2">
                                <Star className="h-4 w-4 text-muted-foreground" />
                                최근 리뷰
                            </h3>
                            <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                                전체보기 →
                            </Button>
                        </div>

                        {recentReviews.length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center py-4">
                                리뷰가 없습니다
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {recentReviews.slice(0, 2).map((review) => (
                                    <Card key={review.id} className="p-3">
                                        <div className="flex items-start gap-2 mb-2">
                                            <Avatar className="h-7 w-7">
                                                <AvatarFallback className="text-xs">
                                                    {review.userName[0]}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
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
                                                <div className="flex items-center gap-1 mb-1">
                                                    <span className="text-xs">
                                                        {getStarEmoji(review.rating)}
                                                    </span>
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                {formatTimeAgo(review.createdAt)}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground line-clamp-2">
                                            {review.content}
                                        </p>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </ScrollArea>

            {/* Footer Actions */}
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
            </div>

            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />
        </>
    );
}

