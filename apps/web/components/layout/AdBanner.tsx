import { useState, useEffect, useRef, memo, useCallback } from "react";
import { Scroll } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useHydration } from "@/hooks/useHydration";
import { useSidebarAdBanners } from "@/hooks/use-ad-banners";
import { AdBanner as AdBannerType, FALLBACK_AD_BANNERS } from "@/types/ad-banner";

const AdBannerComponent = () => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const isHydrated = useHydration();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Supabase에서 배너 데이터 가져오기
    const { data: banners = FALLBACK_AD_BANNERS } = useSidebarAdBanners();

    // 슬라이드 인덱스 조정 (배너 개수가 변경될 때)
    useEffect(() => {
        if (currentSlide >= banners.length && banners.length > 0) {
            setCurrentSlide(0);
        }
    }, [banners.length, currentSlide]);

    // 자동 슬라이드 전환
    useEffect(() => {
        if (!isAutoPlaying || banners.length <= 1) return;

        timeoutRef.current = setTimeout(() => {
            setCurrentSlide((prev) => (prev + 1) % banners.length);
        }, 5000);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isAutoPlaying, currentSlide, banners.length]);

    // 핸들러 메모이제이션
    const goToSlide = useCallback((index: number) => {
        setCurrentSlide((prev) => {
            if (index === prev) return prev;
            return index;
        });
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, []);

    const handleMouseEnter = useCallback(() => setIsAutoPlaying(false), []);
    const handleMouseLeave = useCallback(() => setIsAutoPlaying(true), []);

    // 배너 클릭 핸들러
    const handleBannerClick = useCallback((banner: AdBannerType) => {
        if (banner.link_url) {
            window.open(banner.link_url, '_blank', 'noopener,noreferrer');
        }
    }, []);

    if (banners.length === 0) return null;

    const currentBanner = banners[currentSlide];

    return (
        <div
            className={cn(
                "relative w-full aspect-[4/5] rounded-lg overflow-hidden group select-none shadow-md transition-opacity duration-300",
                isHydrated ? "opacity-100" : "opacity-0",
                currentBanner.link_url && "cursor-pointer"
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={() => handleBannerClick(currentBanner)}
            style={{ backgroundColor: '#fdfbf7' }}
        >
            {/* 이미지 배경 (이미지가 있는 경우) */}
            {currentBanner.image_url ? (
                <img
                    src={currentBanner.image_url}
                    alt={currentBanner.title}
                    className="absolute inset-0 w-full h-full object-cover"
                />
            ) : (
                <>
                    {/* 한지 질감 오버레이 */}
                    <div className="absolute inset-0 opacity-40 pointer-events-none"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")` }}
                    />

                    {/* 전통 문양 테두리 */}
                    <div className="absolute inset-2 border-2 border-double border-stone-800/20 rounded-md pointer-events-none" />
                    <div className="absolute inset-0 border-4 border-stone-800/10 rounded-lg pointer-events-none" />

                    {/* 슬라이드 컨텐츠 */}
                    <div className="relative h-full flex flex-col items-center justify-center text-center p-6 z-10">
                        {/* 상단 장식 */}
                        <div className="mb-3 text-stone-500 opacity-60">
                            <Scroll className="w-6 h-6" />
                        </div>

                        {/* 제목 */}
                        <h3 className="text-2xl font-serif font-bold text-stone-900 mb-3 tracking-widest drop-shadow-sm">
                            {currentBanner.title}
                        </h3>

                        {/* 설명 */}
                        {currentBanner.description && (
                            <p className="text-base font-serif text-stone-700 whitespace-pre-line leading-loose mb-3 opacity-90">
                                {currentBanner.description}
                            </p>
                        )}

                        {/* 버튼 (링크가 있을 때만 표시) */}
                        {currentBanner.link_url && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="font-serif bg-stone-100/50 hover:bg-stone-200 text-stone-800 border-stone-400 hover:border-stone-600 transition-all duration-300"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(currentBanner.link_url!, '_blank', 'noopener,noreferrer');
                                }}
                            >
                                자세히 보기
                            </Button>
                        )}
                    </div>
                </>
            )}

            {/* 하단 인디케이터 */}
            {banners.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
                    {banners.map((_, index) => (
                        <button
                            key={index}
                            onClick={(e) => {
                                e.stopPropagation();
                                goToSlide(index);
                            }}
                            className={cn(
                                "w-2 h-2 rounded-full transition-all duration-300 ease-out",
                                currentSlide === index
                                    ? currentBanner.image_url
                                        ? "bg-white scale-110 shadow-sm"
                                        : "bg-stone-700 scale-110 shadow-sm"
                                    : currentBanner.image_url
                                        ? "bg-white/60 hover:bg-white/80 scale-100"
                                        : "bg-stone-400/60 hover:bg-stone-500 scale-100"
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
