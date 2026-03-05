'use client';

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Sparkles } from "lucide-react";
import { useUnvisitedRestaurants } from "@/hooks/useUnvisitedRestaurants";

const POPUP_STORAGE_KEY = "dailyRecommendationHideUntil";

declare global {
    interface Window {
        hasShownDailyPopup?: boolean;
    }
}

/**
 * 매일 추천 음식점 팝업 컴포넌트 (광고 팝업 스타일)
 * 사용자가 방문하지 않은 음식점을 매번 추천합니다.
 * 홈(/)과 글로벌(/global) 페이지에서만 표시됩니다.
 */
export function DailyRecommendationPopup() {
    const router = useRouter();
    const pathname = usePathname();
    const { unvisitedRestaurants, isLoggedIn } = useUnvisitedRestaurants();
    const [isVisible, setIsVisible] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<typeof unvisitedRestaurants[0] | null>(null);

    // 글로벌 국가 목록 (GlobalMapPage와 동일)
    const GLOBAL_COUNTRIES = [
        "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
    ];

    // 홈 페이지에서만 팝업 표시
    const isHomePage = pathname === '/';
    const shouldShowPopup = isHomePage;

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

    // 랜덤 음식점 선택 (국내만)
    const selectRandomRestaurant = useCallback(() => {
        // 한국 지역만 필터링 (해외 제외)
        const KOREAN_REGIONS = [
            "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
            "대전광역시", "울산광역시", "세종특별자치시",
            "경기도", "강원특별자치도", "충청북도", "충청남도",
            "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"
        ];

        const koreanRestaurants = unvisitedRestaurants.filter(restaurant => {
            const address = restaurant.road_address || restaurant.jibun_address || '';
            // 한국 지역이 주소에 포함되어 있는지 확인
            return KOREAN_REGIONS.some(region => address.includes(region));
        });

        if (koreanRestaurants.length === 0) return null;
        const randomIndex = Math.floor(Math.random() * koreanRestaurants.length);
        return koreanRestaurants[randomIndex];
    }, [unvisitedRestaurants]);

    // 초기 로딩 후 팝업 표시 (홈/글로벌 페이지에서만)
    useEffect(() => {
        // 홈이 아니면 팝업 닫기
        if (!shouldShowPopup) {
            setIsVisible(false);
            return;
        }

        // 이미 보여줬거나, 클라이언트가 아니면 리턴
        if (typeof window === 'undefined' || window.hasShownDailyPopup) return;

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
        if (isLoggedIn && unvisitedRestaurants.length > 0) {
            const restaurant = selectRandomRestaurant();
            if (restaurant) {
                setSelectedRestaurant(restaurant);
                window.hasShownDailyPopup = true; // 윈도우 객체에 표시 기록 (새로고침 시 초기화됨)
                setTimeout(() => setIsVisible(true), 500); // 부드러운 등장을 위한 딜레이
            }
        }
    }, [isLoggedIn, unvisitedRestaurants.length, shouldShowPopup, selectRandomRestaurant]);

    // 닫기
    const handleClose = () => {
        setIsVisible(false);

        // 광고 배너 팝업에게 닫힘 알림
        window.dispatchEvent(new CustomEvent('dailyRecommendationPopupClosed'));
    };

    // 맛집의 지역 정보를 추출하는 함수
    const getRestaurantRegion = (restaurant: typeof unvisitedRestaurants[0]): string | null => {
        if (restaurant.address_elements && typeof restaurant.address_elements === 'object') {
            const sido = (restaurant.address_elements as Record<string, unknown>).SIDO;
            if (typeof sido === 'string') {
                return sido;
            }
        }

        // address_elements에 지역 정보가 없는 경우 주소에서 추출 시도
        if (restaurant.road_address || restaurant.jibun_address) {
            const address = (restaurant.road_address || restaurant.jibun_address) as string;

            // 일반 광역시도 패턴으로 추출
            const regionPatterns = [
                "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
                "대전광역시", "울산광역시", "세종특별자치시", "경기도", "충청북도",
                "충청남도", "전라남도", "경상북도", "경상남도", "전북특별자치도", "제주특별자치도",
                "강원특별자치도"
            ];

            for (const region of regionPatterns) {
                if (address.includes(region)) {
                    return region;
                }
            }
        }

        return null;
    };

    // 카드 클릭 시 지도 페이지로 이동하며 해당 맛집 선택
    const handleCardClick = () => {
        setIsVisible(false);

        if (!selectedRestaurant) return;

        const address = selectedRestaurant.road_address || selectedRestaurant.jibun_address || '';
        const isGlobal = GLOBAL_COUNTRIES.some(country => address.includes(country));

        // 국내/해외 구분하여 이동
        const targetPath = isGlobal ? '/global-map' : '/';

        // 국내인 경우 지역 정보 추출
        const selectedRegion = !isGlobal ? getRestaurantRegion(selectedRestaurant) : null;

        // Next.js는 state 전달을 지원하지 않으므로 sessionStorage 사용
        sessionStorage.setItem('selectedRestaurant', JSON.stringify(selectedRestaurant));
        if (selectedRegion) {
            sessionStorage.setItem('selectedRegion', selectedRegion);
        }

        // 커스텀 이벤트 발생 (같은 페이지에 있을 경우를 위해)
        const event = new CustomEvent('restaurant-selected', {
            detail: { restaurant: selectedRestaurant, region: selectedRegion }
        });
        window.dispatchEvent(event);

        router.push(targetPath);
    };

    if (!selectedRestaurant || !isVisible) return null;

    const thumbnailUrl = selectedRestaurant.youtube_link
        ? getYouTubeThumbnailUrl(selectedRestaurant.youtube_link)
        : null;

    const address = selectedRestaurant.road_address || selectedRestaurant.jibun_address || '주소 정보 없음';

    // Portal을 사용하여 body에 직접 렌더링 (z-index 문제 해결)
    // SSR 이슈 방지를 위해 document 체크
    if (typeof document === 'undefined') return null;

    // createPortal 사용을 위해 import 필요하지만, 여기서는 직접 구현 대신 createPortal을 사용하지 않고
    // z-index를 매우 높게 설정하여 해결 시도 (Portal은 hydration mismatch 유발 가능성 있음)
    // 하지만 사이드바 위로 올리려면 Portal이 가장 확실함.
    // 여기서는 일단 z-index를 9999로 높여서 시도해보고, 안되면 Portal 도입.
    // 기존 z-40 -> z-[100]으로 변경

    return (
        <div className="fixed inset-0 z-[100] pointer-events-none" data-popup-overlay>
            {/* 오버레이 (선택사항 - 클릭 시 닫기) */}
            <div
                className="absolute inset-0 bg-black/50 pointer-events-auto animate-in fade-in duration-300"
                onClick={handleClose}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
            />

            {/* 광고 팝업 스타일 */}
            <div className="absolute max-md:top-1/2 max-md:left-1/2 max-md:-translate-x-1/2 max-md:-translate-y-1/2 md:bottom-6 md:right-6 pointer-events-auto max-md:opacity-0 max-md:animate-[fadeIn_0.5s_ease-out_forwards] md:animate-in md:slide-in-from-bottom-4 md:duration-500">
                <Card
                    className="w-[min(320px,calc(100vw-2rem))] overflow-hidden shadow-2xl border-2 border-primary/30 bg-background font-serif"
                >
                    {/* 오늘의 추천 배지 */}
                    <div className="absolute top-2 left-2 z-10">
                        <Badge className="bg-[#8B5A2B] text-white hover:bg-[#7A4E25] border-none px-3 py-1.5 shadow-lg flex items-center gap-1.5 transition-colors">
                            <Sparkles className="w-3.5 h-3.5 text-yellow-300 fill-yellow-300" />
                            <span className="font-medium tracking-wide">오늘의 추천</span>
                        </Badge>
                    </div>

                    {/* 클릭 가능 영역 */}
                    <div className="cursor-pointer hover:opacity-95 transition-opacity" onClick={handleCardClick}>
                        {/* YouTube 썸네일 */}
                        {thumbnailUrl && (
                            <div className="aspect-video relative group">
                                <Image
                                    src={thumbnailUrl}
                                    alt={`${selectedRestaurant.name} 썸네일`}
                                    fill
                                    unoptimized
                                    sizes="(max-width: 640px) 100vw, 320px"
                                    className="object-cover transition-all group-hover:brightness-110"
                                />
                            </div>
                        )}

                        {/* 음식점 정보 */}
                        <div className="p-4 space-y-2">
                            <div>
                                <h3 className="text-lg font-bold text-foreground line-clamp-1 mb-1">
                                    {selectedRestaurant.name}
                                </h3>
                                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                    <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    <span className="line-clamp-1">{address}</span>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* 하단 버튼 (광고 배너와 동일) */}
                    <div className="flex border-t border-border">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                // 오늘 하루 안 보기 설정 후 닫기
                                if (typeof window !== 'undefined') {
                                    const tomorrow = new Date();
                                    tomorrow.setDate(tomorrow.getDate() + 1);
                                    tomorrow.setHours(0, 0, 0, 0);
                                    localStorage.setItem(POPUP_STORAGE_KEY, tomorrow.toISOString());
                                }
                                setIsVisible(false);
                                window.dispatchEvent(new CustomEvent('dailyRecommendationPopupClosed'));
                            }}
                            className="flex-1 py-3 text-sm text-muted-foreground hover:bg-accent transition-colors"
                        >
                            오늘 하루 안 보기
                        </button>
                        <div className="w-px bg-border" />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClose();
                            }}
                            className="flex-1 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                        >
                            닫기
                        </button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
