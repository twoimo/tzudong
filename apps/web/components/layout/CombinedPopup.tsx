'use client';

import { useState, useEffect, useCallback, memo, useRef, useMemo, lazy, Suspense } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Scroll, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useDeviceType } from '@/hooks/useDeviceType';
import { useMobilePopupAdBanners } from '@/hooks/use-ad-banners';
import { useUnvisitedRestaurants } from '@/hooks/useUnvisitedRestaurants';
import { AdBanner } from '@/types/ad-banner';

// 로컬 스토리지 키
const DISMISSED_DATE_KEY = 'combinedPopup_dismissedDate';
const DAILY_POPUP_STORAGE_KEY = 'dailyRecommendationHideUntil';

// 슬라이드 타입
type SlideType = 'restaurant' | 'banner';
interface PopupSlide {
    type: SlideType;
    data: any;
}

// 한국 지역 상수 (컴포넌트 외부로 이동하여 매 렌더링마다 재생성 방지)
const KOREAN_REGIONS = Object.freeze([
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
    "대전광역시", "울산광역시", "세종특별자치시",
    "경기도", "강원특별자치도", "충청북도", "충청남도",
    "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"
]);

// 오늘 날짜 문자열 (캐시)
let todayStringCache: string | null = null;
let todayStringDate: number | null = null;
const getTodayString = () => {
    const now = Date.now();
    // 1분간 캐시 (60000ms)
    if (todayStringCache && todayStringDate && now - todayStringDate < 60000) {
        return todayStringCache;
    }
    const today = new Date(now);
    todayStringCache = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    todayStringDate = now;
    return todayStringCache;
};

// YouTube 썸네일 추출 (컴포넌트 외부로 이동)
const YOUTUBE_REGEX = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
const getYouTubeThumbnailUrl = (url: string): string | null => {
    const match = url.match(YOUTUBE_REGEX);
    const videoId = (match && match[2].length === 11) ? match[2] : null;
    return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
};

// 슬라이드 인디케이터 컴포넌트 (메모이제이션)
const SlideIndicator = memo(({
    count,
    current,
    onSelect
}: {
    count: number;
    current: number;
    onSelect: (index: number) => void;
}) => {
    if (count <= 1) return null;

    return (
        <div className="absolute bottom-14 left-0 right-0 flex justify-center gap-2 z-20">
            {Array.from({ length: count }, (_, index) => (
                <button
                    key={index}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(index);
                    }}
                    className={cn(
                        "w-2 h-2 rounded-full transition-all",
                        current === index
                            ? "bg-white scale-110 shadow-md"
                            : "bg-white/50"
                    )}
                />
            ))}
        </div>
    );
});
SlideIndicator.displayName = 'SlideIndicator';

// 맛집 슬라이드 컴포넌트 (메모이제이션)
const RestaurantSlide = memo(({
    restaurant,
    onClick
}: {
    restaurant: any;
    onClick: () => void;
}) => {
    const thumbnailUrl = useMemo(() =>
        restaurant.youtube_link ? getYouTubeThumbnailUrl(restaurant.youtube_link) : null,
        [restaurant.youtube_link]
    );

    return (
        <div className="absolute inset-0" onClick={onClick}>
            {thumbnailUrl && (
                <img
                    src={thumbnailUrl}
                    alt={restaurant.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                />
            )}
            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-3 text-white z-10">
                <h3 className="text-base font-bold line-clamp-1 mb-0.5 drop-shadow-lg">
                    {restaurant.name}
                </h3>
                <div className="flex items-start gap-1 text-xs opacity-90 drop-shadow-md">
                    <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-1">
                        {restaurant.road_address || restaurant.jibun_address || '주소 정보 없음'}
                    </span>
                </div>
            </div>
        </div>
    );
});
RestaurantSlide.displayName = 'RestaurantSlide';

// 배너 슬라이드 컴포넌트 (메모이제이션)
const BannerSlide = memo(({
    banner,
    onClick
}: {
    banner: AdBanner;
    onClick: () => void;
}) => (
    <div className="absolute inset-0" onClick={onClick}>
        {banner.image_url ? (
            <img
                src={banner.image_url}
                alt={banner.title}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
            />
        ) : (
            <>
                <div
                    className="absolute inset-0 opacity-40 pointer-events-none"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")`,
                    }}
                />
                <div className="absolute inset-2 border-2 border-double border-stone-800/20 rounded-md pointer-events-none" />
                <div className="relative h-full flex flex-col items-center justify-center text-center p-6">
                    <Scroll className="w-8 h-8 text-stone-500 mb-3 opacity-60" />
                    <h3 className="text-xl font-serif font-bold text-stone-900 mb-2 tracking-wide">
                        {banner.title}
                    </h3>
                    {banner.description && (
                        <p className="text-sm font-serif text-stone-700 whitespace-pre-line leading-relaxed">
                            {banner.description}
                        </p>
                    )}
                    {banner.link_url && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-4 font-serif"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClick();
                            }}
                        >
                            자세히 보기
                        </Button>
                    )}
                </div>
            </>
        )}
    </div>
));
BannerSlide.displayName = 'BannerSlide';

const CombinedPopupComponent = () => {
    const router = useRouter();
    const pathname = usePathname();
    const { isMobileOrTablet } = useDeviceType();
    const [isVisible, setIsVisible] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hasShownRef = useRef(false);

    // 배너 데이터
    const { data: banners = [] } = useMobilePopupAdBanners();

    // 맛집 추천 데이터
    const { unvisitedRestaurants, isLoggedIn } = useUnvisitedRestaurants();

    // 홈 페이지 여부
    const isHomePage = pathname === '/';

    // 랜덤 맛집 - 한 번만 선택 (ref로 저장)
    const selectedRestaurantRef = useRef<any>(null);
    const hasSelectedRef = useRef(false);

    // 슬라이드 데이터 구성 (useMemo로 안정적으로 계산)
    const slides = useMemo(() => {
        const newSlides: PopupSlide[] = [];

        // 맛집 추천 추가 (로그인 + 홈페이지 + 미방문 맛집 있을 때)
        if (isLoggedIn && isHomePage && unvisitedRestaurants.length > 0) {
            if (!hasSelectedRef.current) {
                const koreanRestaurants = unvisitedRestaurants.filter(restaurant => {
                    const address = restaurant.road_address || restaurant.jibun_address || '';
                    return KOREAN_REGIONS.some(region => address.includes(region));
                });
                if (koreanRestaurants.length > 0) {
                    const randomIndex = Math.floor(Math.random() * koreanRestaurants.length);
                    selectedRestaurantRef.current = koreanRestaurants[randomIndex];
                    hasSelectedRef.current = true;
                }
            }

            if (selectedRestaurantRef.current) {
                newSlides.push({ type: 'restaurant', data: selectedRestaurantRef.current });
            }
        }

        // 광고 배너 추가
        for (let i = 0; i < banners.length; i++) {
            newSlides.push({ type: 'banner', data: banners[i] });
        }

        return newSlides;
    }, [banners, unvisitedRestaurants.length, isLoggedIn, isHomePage]);

    // 오늘 이미 닫았는지 확인
    const shouldShowPopup = useCallback(() => {
        if (typeof window === 'undefined') return false;

        const dismissedDate = localStorage.getItem(DISMISSED_DATE_KEY);
        if (dismissedDate === getTodayString()) return false;

        const hideUntilStr = localStorage.getItem(DAILY_POPUP_STORAGE_KEY);
        if (hideUntilStr) {
            const hideUntil = new Date(hideUntilStr);
            if (new Date() < hideUntil) return false;
        }

        return true;
    }, []);

    // 팝업 표시
    useEffect(() => {
        if (!isMobileOrTablet || slides.length === 0 || hasShownRef.current) return;

        if (shouldShowPopup()) {
            const timer = setTimeout(() => {
                setIsVisible(true);
                hasShownRef.current = true;
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isMobileOrTablet, slides.length, shouldShowPopup]);

    // 자동 슬라이드
    useEffect(() => {
        if (!isAutoPlaying || !isVisible || slides.length <= 1) return;

        timeoutRef.current = setTimeout(() => {
            setCurrentSlide((prev) => (prev + 1) % slides.length);
        }, 4000);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isAutoPlaying, isVisible, currentSlide, slides.length]);

    // 팝업 닫기
    const handleClose = useCallback(() => {
        setIsVisible(false);
    }, []);

    // 오늘 하루 안 보기
    const handleDismissToday = useCallback(() => {
        localStorage.setItem(DISMISSED_DATE_KEY, getTodayString());
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        localStorage.setItem(DAILY_POPUP_STORAGE_KEY, tomorrow.toISOString());
        setIsVisible(false);
    }, []);

    // 슬라이드 이동
    const goToSlide = useCallback((index: number) => {
        setCurrentSlide(index);
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, []);

    // 배너 클릭
    const handleBannerClick = useCallback((banner: AdBanner) => {
        if (banner.link_url) {
            window.open(banner.link_url, '_blank', 'noopener,noreferrer');
        }
    }, []);

    // 맛집 클릭
    const handleRestaurantClick = useCallback((restaurant: any) => {
        setIsVisible(false);
        sessionStorage.setItem('selectedRestaurant', JSON.stringify(restaurant));

        const address = restaurant.road_address || restaurant.jibun_address || '';
        let selectedRegion: string | null = null;
        for (const region of KOREAN_REGIONS) {
            if (address.includes(region)) {
                selectedRegion = region;
                sessionStorage.setItem('selectedRegion', region);
                break;
            }
        }

        window.dispatchEvent(new CustomEvent('restaurant-selected', {
            detail: { restaurant, region: selectedRegion }
        }));

        if (pathname !== '/') {
            router.push('/');
        }
    }, [pathname, router]);

    // 표시 조건 체크
    if (!isMobileOrTablet || !isVisible || slides.length === 0) {
        return null;
    }

    const currentSlideData = slides[currentSlide];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 animate-in fade-in duration-300">
            <div
                className={cn(
                    "relative w-[320px] mx-auto rounded-lg overflow-hidden shadow-2xl",
                    "animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                )}
                style={{ backgroundColor: '#fdfbf7' }}
            >
                {/* 슬라이드 컨텐츠 - 타입에 따라 비율 조정 */}
                <div className={cn(
                    "relative cursor-pointer",
                    currentSlideData.type === 'restaurant' ? "aspect-[16/9]" : "aspect-[4/5]"
                )}>
                    {currentSlideData.type === 'restaurant' ? (
                        <RestaurantSlide
                            restaurant={currentSlideData.data}
                            onClick={() => handleRestaurantClick(currentSlideData.data)}
                        />
                    ) : (
                        <BannerSlide
                            banner={currentSlideData.data}
                            onClick={() => handleBannerClick(currentSlideData.data)}
                        />
                    )}
                </div>

                {/* 슬라이드 인디케이터 */}
                <SlideIndicator
                    count={slides.length}
                    current={currentSlide}
                    onSelect={goToSlide}
                />

                {/* 하단 버튼 */}
                <div className="flex border-t border-stone-200">
                    <button
                        onClick={handleDismissToday}
                        className="flex-1 py-3 text-sm text-stone-500 hover:bg-stone-100 transition-colors"
                    >
                        오늘 하루 안 보기
                    </button>
                    <div className="w-px bg-stone-200" />
                    <button
                        onClick={handleClose}
                        className="flex-1 py-3 text-sm font-medium text-stone-700 hover:bg-stone-100 transition-colors"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
};

const CombinedPopup = memo(CombinedPopupComponent);
CombinedPopup.displayName = 'CombinedPopup';

export default CombinedPopup;
