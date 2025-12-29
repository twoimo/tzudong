import { useState, useEffect, useRef, memo, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Scroll, ExternalLink, MapPin, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHydration } from "@/hooks/useHydration";
import { useSidebarAdBanners } from "@/hooks/use-ad-banners";
import { useUnvisitedRestaurants } from "@/hooks/useUnvisitedRestaurants";
import { AdBanner as AdBannerType, FALLBACK_AD_BANNERS } from "@/types/ad-banner";

// 슬라이드 타입
type SlideType = 'restaurant' | 'banner';
interface SidebarSlide {
    type: SlideType;
    data: any;
}

const AdBannerComponent = () => {
    const router = useRouter();
    const pathname = usePathname();
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const isHydrated = useHydration();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Supabase에서 배너 데이터 가져오기
    const { data: banners = FALLBACK_AD_BANNERS } = useSidebarAdBanners();

    // 맛집 추천 데이터
    const { unvisitedRestaurants, isLoggedIn } = useUnvisitedRestaurants();

    // 홈 페이지 여부
    const isHomePage = pathname === '/';

    // 한국 지역 필터링
    const KOREAN_REGIONS = [
        "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
        "대전광역시", "울산광역시", "세종특별자치시",
        "경기도", "강원특별자치도", "충청북도", "충청남도",
        "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"
    ];

    // 랜덤 맛집 - 한 번만 선택
    const selectedRestaurantRef = useRef<any>(null);
    const hasSelectedRef = useRef(false);

    // 슬라이드 데이터 구성
    const slides = useMemo(() => {
        const newSlides: SidebarSlide[] = [];

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
        banners.forEach(banner => {
            newSlides.push({ type: 'banner', data: banner });
        });

        return newSlides;
    }, [banners, unvisitedRestaurants.length, isLoggedIn, isHomePage]);

    // 슬라이드 인덱스 조정
    useEffect(() => {
        if (currentSlide >= slides.length && slides.length > 0) {
            setCurrentSlide(0);
        }
    }, [slides.length, currentSlide]);

    // 자동 슬라이드 전환
    useEffect(() => {
        if (!isAutoPlaying || slides.length <= 1) return;

        timeoutRef.current = setTimeout(() => {
            setCurrentSlide((prev) => (prev + 1) % slides.length);
        }, 5000);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isAutoPlaying, currentSlide, slides.length]);

    // 핸들러
    const goToSlide = useCallback((index: number) => {
        setCurrentSlide(index);
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, []);

    const handleMouseEnter = useCallback(() => setIsAutoPlaying(false), []);
    const handleMouseLeave = useCallback(() => setIsAutoPlaying(true), []);

    // 배너 클릭
    const handleBannerClick = useCallback((banner: AdBannerType) => {
        if (banner.link_url) {
            window.open(banner.link_url, '_blank', 'noopener,noreferrer');
        }
    }, []);

    // 맛집 클릭
    const handleRestaurantClick = useCallback((restaurant: any) => {
        sessionStorage.setItem('selectedRestaurant', JSON.stringify(restaurant));

        const address = restaurant.road_address || restaurant.jibun_address || '';
        for (const region of KOREAN_REGIONS) {
            if (address.includes(region)) {
                sessionStorage.setItem('selectedRegion', region);
                break;
            }
        }

        window.dispatchEvent(new CustomEvent('restaurant-selected', {
            detail: { restaurant }
        }));

        if (pathname !== '/') {
            router.push('/');
        }
    }, [pathname, router]);

    // YouTube 썸네일 추출
    const getYouTubeThumbnailUrl = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/, match = url.match(regExp);
        const videoId = (match && match[2].length === 11) ? match[2] : null;
        return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
    };

    if (slides.length === 0) return null;

    const currentSlideData = slides[currentSlide];

    return (
        <div
            className={cn(
                "relative w-full aspect-[4/5] rounded-lg overflow-hidden group select-none shadow-md transition-opacity duration-300",
                isHydrated ? "opacity-100" : "opacity-0",
                "cursor-pointer"
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ backgroundColor: '#fdfbf7' }}
        >
            {currentSlideData.type === 'restaurant' ? (
                // 맛집 슬라이드
                <div
                    className="absolute inset-0 flex flex-col bg-white"
                    onClick={() => handleRestaurantClick(currentSlideData.data)}
                >
                    {/* 썸네일 영역 */}
                    <div className="relative flex-1 overflow-hidden">
                        {/* 썸네일 이미지 */}
                        {currentSlideData.data.youtube_link && (
                            <img
                                src={getYouTubeThumbnailUrl(currentSlideData.data.youtube_link) || ''}
                                alt={currentSlideData.data.name}
                                className="w-full h-full object-cover scale-150"
                            />
                        )}
                    </div>

                    {/* 정보 영역 */}
                    <div className="p-3 bg-white border-t border-stone-200">
                        <h3 className="text-sm font-bold text-gray-900 line-clamp-1 mb-0.5">
                            {currentSlideData.data.name}
                        </h3>
                        <div className="flex items-start gap-1 text-xs text-gray-600">
                            <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-1">
                                {currentSlideData.data.road_address || currentSlideData.data.jibun_address || '주소 정보 없음'}
                            </span>
                        </div>
                    </div>
                </div>
            ) : (
                // 광고 배너 슬라이드
                <div
                    className="absolute inset-0"
                    onClick={() => handleBannerClick(currentSlideData.data)}
                >
                    {currentSlideData.data.image_url ? (
                        <img
                            src={currentSlideData.data.image_url}
                            alt={currentSlideData.data.title}
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                    ) : (
                        <>
                            {/* 한지 질감 오버레이 */}
                            <div className="absolute inset-0 opacity-40 pointer-events-none"
                                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")` }}
                            />
                            <div className="absolute inset-2 border-2 border-double border-stone-800/20 rounded-md pointer-events-none" />
                            <div className="absolute inset-0 border-4 border-stone-800/10 rounded-lg pointer-events-none" />

                            {/* 슬라이드 컨텐츠 */}
                            <div className="relative h-full flex flex-col items-center justify-center text-center p-6 z-10">
                                <div className="mb-3 text-stone-500 opacity-60">
                                    <Scroll className="w-6 h-6" />
                                </div>
                                <h3 className="text-2xl font-serif font-bold text-stone-900 mb-3 tracking-widest drop-shadow-sm">
                                    {currentSlideData.data.title}
                                </h3>
                                {currentSlideData.data.description && (
                                    <p className="text-base font-serif text-stone-700 whitespace-pre-line leading-loose mb-3 opacity-90">
                                        {currentSlideData.data.description}
                                    </p>
                                )}
                                {currentSlideData.data.link_url && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="font-serif bg-stone-100/50 hover:bg-stone-200 text-stone-800 border-stone-400 hover:border-stone-600 transition-all duration-300"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            window.open(currentSlideData.data.link_url!, '_blank', 'noopener,noreferrer');
                                        }}
                                    >
                                        자세히 보기
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* 하단 인디케이터 */}
            {slides.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
                    {slides.map((_: SidebarSlide, index: number) => (
                        <button
                            key={index}
                            onClick={(e) => {
                                e.stopPropagation();
                                goToSlide(index);
                            }}
                            className={cn(
                                "w-2 h-2 rounded-full transition-all duration-300 ease-out",
                                currentSlide === index
                                    ? "bg-white scale-110 shadow-sm"
                                    : "bg-white/60 hover:bg-white/80 scale-100"
                            )}
                            aria-label={`슬라이드 ${index + 1}로 이동`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// React.memo로 래핑
const AdBanner = memo(AdBannerComponent);
AdBanner.displayName = "AdBanner";

export default AdBanner;
