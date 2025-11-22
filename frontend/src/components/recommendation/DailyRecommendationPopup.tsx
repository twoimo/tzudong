import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPin, ExternalLink, X } from "lucide-react";
import { useUnvisitedRestaurants } from "@/hooks/useUnvisitedRestaurants";

const POPUP_STORAGE_KEY = "dailyRecommendationHideUntil";

/**
 * 매일 추천 음식점 팝업 컴포넌트 (광고 팝업 스타일)
 * 사용자가 방문하지 않은 음식점을 매번 추천합니다.
 * 홈(/)과 글로벌(/global) 페이지에서만 표시됩니다.
 */
export function DailyRecommendationPopup() {
    const navigate = useNavigate();
    const location = useLocation();
    const { unvisitedRestaurants, isLoading, isLoggedIn } = useUnvisitedRestaurants();
    const [isVisible, setIsVisible] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<typeof unvisitedRestaurants[0] | null>(null);
    const [hideToday, setHideToday] = useState(false);

    // 글로벌 국가 목록 (GlobalMapPage와 동일)
    const GLOBAL_COUNTRIES = [
        "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
    ];

    // 홈과 글로벌 페이지에서만 팝업 표시
    const isHomePage = location.pathname === '/';
    const isGlobalPage = location.pathname === '/global';
    const shouldShowPopup = isHomePage || isGlobalPage;

    // YouTube 썸네일 URL 추출 함수
    const extractYouTubeVideoId = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&?]*).*/;
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

    // 초기 로딩 후 팝업 표시 (홈/글로벌 페이지에서만)
    useEffect(() => {
        // localStorage에서 숨김 설정 확인
        const hideUntilStr = localStorage.getItem(POPUP_STORAGE_KEY);
        if (hideUntilStr) {
            const hideUntil = new Date(hideUntilStr);
            const now = new Date();
            if (now < hideUntil) {
                // 아직 숨김 기간이 유효함
                return;
            } else {
                // 기간 만료, localStorage 제거
                localStorage.removeItem(POPUP_STORAGE_KEY);
            }
        }

        // 로그인하고 미방문 맛집이 있고 홈/글로벌 페이지일 때만 표시
        if (isLoggedIn && unvisitedRestaurants.length > 0 && shouldShowPopup) {
            const restaurant = selectRandomRestaurant();
            if (restaurant) {
                setSelectedRestaurant(restaurant);
                setTimeout(() => setIsVisible(true), 500); // 부드러운 등장을 위한 딜레이
            }
        } else {
            // 다른 페이지로 이동하면 팝업 닫기
            setIsVisible(false);
        }
    }, [isLoggedIn, unvisitedRestaurants.length, shouldShowPopup]);

    // 닫기
    const handleClose = () => {
        // "오늘 하루 안 보이기" 체크된 경우 localStorage에 저장
        if (hideToday) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0); // 다음 날 자정
            localStorage.setItem(POPUP_STORAGE_KEY, tomorrow.toISOString());
        }
        setIsVisible(false);
    };

    // 카드 클릭 시 지도 페이지로 이동하며 해당 맛집 선택
    const handleCardClick = () => {
        setIsVisible(false);

        if (!selectedRestaurant) return;

        const address = selectedRestaurant.road_address || selectedRestaurant.jibun_address || '';
        const isGlobal = GLOBAL_COUNTRIES.some(country => address.includes(country));

        // 국내/해외 구분하여 이동
        const targetPath = isGlobal ? '/global' : '/';

        navigate(targetPath, {
            state: {
                selectedRestaurant: selectedRestaurant
            }
        });
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

            {/* 대동여지도 스타일 팝업 */}
            <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 duration-500">
                <Card
                    className="w-[320px] overflow-hidden shadow-2xl border-2 border-[#8B5A2B] cursor-pointer hover:shadow-[#8B5A2B]/30 transition-all hover:scale-[1.02] bg-[#F5E6D3]"
                    onClick={handleCardClick}
                >
                    {/* X 닫기 버튼 */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleClose();
                        }}
                        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-[#8B5A2B]/80 hover:bg-[#8B5A2B] text-[#F5E6D3] flex items-center justify-center transition-colors"
                        aria-label="닫기"
                    >
                        <X className="w-3 h-3" />
                    </button>

                    {/* 오늘의 추천 배지 */}
                    <div className="absolute top-2 left-2 z-10">
                        <Badge className="bg-gradient-to-r from-[#B4654A] to-[#8B5A2B] text-[#F5E6D3] font-bold shadow-lg border border-[#8B5A2B]/30 font-serif">
                            오늘의 추천!
                        </Badge>
                    </div>

                    {/* YouTube 썸네일 */}
                    {thumbnailUrl && (
                        <div className="aspect-video relative group border-b-2 border-[#8B5A2B]/20">
                            <img
                                src={thumbnailUrl}
                                alt={`${selectedRestaurant.name} 썸네일`}
                                className="w-full h-full object-cover group-hover:brightness-110 transition-all"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#8B5A2B]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                    )}

                    {/* 음식점 정보 */}
                    <div className="p-4 space-y-2 bg-[#F5E6D3]">
                        <div>
                            <h3 className="text-lg font-bold text-[#3E2723] line-clamp-1 mb-1 font-serif">
                                {selectedRestaurant.name}
                            </h3>
                            <div className="flex items-start gap-1.5 text-xs text-[#5D4037]">
                                <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-[#8B5A2B]" />
                                <span className="line-clamp-1">{address}</span>
                            </div>
                        </div>

                        {/* 카테고리 */}
                        {selectedRestaurant.categories && selectedRestaurant.categories.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {selectedRestaurant.categories.slice(0, 2).map((category, index) => (
                                    <Badge key={index} className="text-xs px-2 py-0 bg-[#D7CCC8] text-[#3E2723] border border-[#8B5A2B]/20 font-serif">
                                        {category}
                                    </Badge>
                                ))}
                            </div>
                        )}

                        {/* 클릭 유도 텍스트 */}
                        <div className="pt-1 flex items-center justify-between text-[#8B5A2B] font-medium text-sm">
                            <span className="font-serif">지도에서 확인하기</span>
                            <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </div>

                        {/* 오늘 하루 안 보이기 체크박스 */}
                        <div 
                            className="flex items-center space-x-2 pt-2 border-t border-[#8B5A2B]/20"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Checkbox 
                                id="hide-today"
                                checked={hideToday}
                                onCheckedChange={(checked) => setHideToday(checked as boolean)}
                                className="border-[#8B5A2B]"
                            />
                            <label
                                htmlFor="hide-today"
                                className="text-xs text-[#5D4037] cursor-pointer select-none font-serif"
                            >
                                오늘 하루 안 보이기
                            </label>
                        </div>
                    </div>
                </Card>
            </div>
        </>
    );
}
