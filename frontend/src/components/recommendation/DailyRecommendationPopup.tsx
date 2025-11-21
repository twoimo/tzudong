import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, ExternalLink, X } from "lucide-react";
import { useUnvisitedRestaurants } from "@/hooks/useUnvisitedRestaurants";

/**
 * 매일 추천 음식점 팝업 컴포넌트 (광고 팝업 스타일)
 * 사용자가 방문하지 않은 음식점을 매번 추천합니다.
 */
export function DailyRecommendationPopup() {
    const navigate = useNavigate();
    const { unvisitedRestaurants, isLoading, isLoggedIn } = useUnvisitedRestaurants();
    const [isVisible, setIsVisible] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<typeof unvisitedRestaurants[0] | null>(null);

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

    // 랜덤 음식점 선택
    const selectRandomRestaurant = () => {
        if (unvisitedRestaurants.length === 0) return null;
        const randomIndex = Math.floor(Math.random() * unvisitedRestaurants.length);
        return unvisitedRestaurants[randomIndex];
    };

    // 초기 로딩 후 팝업 표시
    useEffect(() => {
        // 로그인하고 미방문 맛집이 있으면 무조건 표시
        if (isLoggedIn && unvisitedRestaurants.length > 0) {
            const restaurant = selectRandomRestaurant();
            if (restaurant) {
                setSelectedRestaurant(restaurant);
                setTimeout(() => setIsVisible(true), 500); // 부드러운 등장을 위한 딜레이
            }
        }
    }, [isLoggedIn, unvisitedRestaurants.length]);

    // 닫기
    const handleClose = () => {
        setIsVisible(false);
    };

    // 카드 클릭 시 지도 페이지로 이동하며 해당 맛집 선택
    const handleCardClick = () => {
        console.log('[DailyRecommendationPopup] Card clicked, restaurant:', selectedRestaurant);
        setIsVisible(false);
        navigate('/global', {
            state: {
                selectedRestaurant: selectedRestaurant
            }
        });
        console.log('[DailyRecommendationPopup] Navigated to /global with state');
    };

    if (!selectedRestaurant || !isVisible) return null;

    const thumbnailUrl = selectedRestaurant.youtube_link
        ? getYouTubeThumbnailUrl(selectedRestaurant.youtube_link)
        : null;

    const address = selectedRestaurant.road_address || selectedRestaurant.jibun_address || '주소 정보 없음';

    return (
        <>
            {/* 오버레이 (선택사항 - 클릭 시 닫기) */}
            <div
                className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-300"
                onClick={handleClose}
            />

            {/* 광고 팝업 스타일 */}
            <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 duration-500">
                <Card
                    className="w-[320px] overflow-hidden shadow-2xl border-2 border-primary/30 cursor-pointer hover:shadow-primary/20 transition-all hover:scale-[1.02] bg-white"
                    onClick={handleCardClick}
                >
                    {/* X 닫기 버튼 */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleClose();
                        }}
                        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                        aria-label="닫기"
                    >
                        <X className="w-3 h-3" />
                    </button>

                    {/* 오늘의 추천 배지 */}
                    <div className="absolute top-2 left-2 z-10">
                        <Badge className="bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold shadow-lg animate-pulse">
                            오늘의 추천!
                        </Badge>
                    </div>

                    {/* YouTube 썸네일 */}
                    {thumbnailUrl && (
                        <div className="aspect-video relative group">
                            <img
                                src={thumbnailUrl}
                                alt={`${selectedRestaurant.name} 썸네일`}
                                className="w-full h-full object-cover group-hover:brightness-110 transition-all"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                    )}

                    {/* 음식점 정보 */}
                    <div className="p-4 space-y-2">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 line-clamp-1 mb-1">
                                {selectedRestaurant.name}
                            </h3>
                            <div className="flex items-start gap-1.5 text-xs text-gray-600">
                                <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                <span className="line-clamp-1">{address}</span>
                            </div>
                        </div>

                        {/* 카테고리 */}
                        {selectedRestaurant.categories && selectedRestaurant.categories.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {selectedRestaurant.categories.slice(0, 2).map((category, index) => (
                                    <Badge key={index} variant="secondary" className="text-xs px-2 py-0">
                                        {category}
                                    </Badge>
                                ))}
                            </div>
                        )}

                        {/* 클릭 유도 텍스트 */}
                        <div className="pt-1 flex items-center justify-between text-primary font-medium text-sm">
                            <span>지도에서 확인하기</span>
                            <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </div>
                    </div>
                </Card>
            </div>
        </>
    );
}
