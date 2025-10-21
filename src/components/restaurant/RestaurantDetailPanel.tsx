import { X, MapPin, Phone, Star, Users, MessageSquare, Youtube, Calendar, Navigation, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Restaurant } from "@/types/restaurant";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface RestaurantDetailPanelProps {
    restaurant: Restaurant | null;
    onClose: () => void;
    onWriteReview?: () => void;
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
}: RestaurantDetailPanelProps) {
    if (!restaurant) return null;

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
        const count = Math.round(rating);
        return "⭐".repeat(count);
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

    const isHotPlace = (restaurant.ai_rating || 0) >= 4;

    const handleGetDirections = () => {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${restaurant.lat},${restaurant.lng}`;
        window.open(url, '_blank');
    };

    return (
        <div className="h-full flex flex-col bg-background border-l border-border">
            {/* Header */}
            <div className="p-4 border-b border-border">
                <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-2xl">{isHotPlace ? "🔥" : "⭐"}</span>
                            <h2 className="text-xl font-bold line-clamp-2">{restaurant.name}</h2>
                        </div>
                        <Badge variant={isHotPlace ? "default" : "secondary"} className="mt-1">
                            {restaurant.category}
                        </Badge>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* AI Rating */}
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1">AI 별점</p>
                        <div className="flex items-center gap-2">
                            <span className="text-lg">{getStarEmoji(restaurant.ai_rating || 0)}</span>
                            <span className="text-sm font-semibold">
                                {restaurant.ai_rating?.toFixed(1) || "0.0"} / 10.0
                            </span>
                        </div>
                    </div>
                    {isHotPlace && (
                        <div className="text-right">
                            <Badge variant="default" className="bg-gradient-primary">
                                인기 맛집
                            </Badge>
                        </div>
                    )}
                </div>
            </div>

            {/* Content */}
            <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2">
                        <Card className="p-3 text-center">
                            <Star className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
                            <p className="text-xs text-muted-foreground">쯔양 방문</p>
                            <p className="text-lg font-bold text-primary">
                                {restaurant.jjyang_visit_count || 0}회
                            </p>
                        </Card>
                        <Card className="p-3 text-center">
                            <Users className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                            <p className="text-xs text-muted-foreground">사용자 방문</p>
                            <p className="text-lg font-bold">
                                {restaurant.visit_count || 0}회
                            </p>
                        </Card>
                        <Card className="p-3 text-center">
                            <MessageSquare className="h-4 w-4 mx-auto mb-1 text-green-500" />
                            <p className="text-xs text-muted-foreground">리뷰</p>
                            <p className="text-lg font-bold">
                                {restaurant.review_count || 0}개
                            </p>
                        </Card>
                    </div>

                    <Separator />

                    {/* Contact Info */}
                    <div className="space-y-3">
                        <h3 className="font-semibold text-sm">매장 정보</h3>

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
                            <div className="space-y-2">
                                <h3 className="font-semibold text-sm flex items-center gap-2">
                                    <Youtube className="h-4 w-4 text-red-500" />
                                    쯔양 유튜브 영상
                                </h3>
                                <a
                                    href={restaurant.youtube_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block"
                                >
                                    <Button variant="outline" className="w-full justify-start gap-2">
                                        <Youtube className="h-4 w-4 text-red-500" />
                                        영상 보러가기
                                    </Button>
                                </a>
                            </div>
                        </>
                    )}

                    {/* Description (쯔양 리뷰) */}
                    {restaurant.description && (
                        <>
                            <Separator />
                            <div className="space-y-2">
                                <h3 className="font-semibold text-sm">쯔양의 리뷰</h3>
                                <div className="p-3 bg-muted/50 rounded-lg">
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                        {restaurant.description}
                                    </p>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Recent Reviews Preview */}
                    <Separator />
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-sm">최근 리뷰</h3>
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
                    onClick={onWriteReview}
                    className="w-full bg-gradient-primary hover:opacity-90 gap-2"
                >
                    <MessageSquare className="h-4 w-4" />
                    리뷰 작성하기
                </Button>
            </div>
        </div>
    );
}

