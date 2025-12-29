import { useState, useEffect, useRef, memo, useCallback, useMemo } from "react";
import { Scroll } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useHydration } from "@/hooks/useHydration";
import { useSidebarAdBanners } from "@/hooks/use-ad-banners";
import { AdBanner as AdBannerType, FALLBACK_AD_BANNERS } from "@/types/ad-banner";

// 슬라이드 인디케이터 컴포넌트 (메모이제이션)
const SlideIndicator = memo(({
    count,
    current,
    hasImage,
    onSelect
}: {
    count: number;
    current: number;
    hasImage: boolean;
    onSelect: (index: number) => void;
}) => {
    if (count <= 1) return null;

    return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
            {Array.from({ length: count }, (_, index) => (
                <button
                    key={index}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(index);
                    }}
                    className={cn(
                        "w-2 h-2 rounded-full transition-all duration-300 ease-out",
                        current === index
                            ? hasImage
                                ? "bg-white scale-110 shadow-sm"
                                : "bg-stone-700 scale-110 shadow-sm"
                            : hasImage
                                ? "bg-white/60 hover:bg-white/80 scale-100"
                                : "bg-stone-400/60 hover:bg-stone-500 scale-100"
                    )}
                    aria-label={`슬라이드 ${index + 1}로 이동`}
                />
            ))}
        </div>
    );
});
SlideIndicator.displayName = 'SlideIndicator';

// 배너 컨텐츠 컴포넌트 (메모이제이션)
const BannerContent = memo(({ banner, isActive }: { banner: AdBannerType; isActive: boolean }) => {
    if (banner.image_url) {
        return (
            <img
                src={banner.image_url}
                alt={banner.title}
                className={cn(
                    "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
                    isActive ? "opacity-100" : "opacity-0"
                )}
                loading="eager"
                decoding="async"
            />
        );
    }

    return (
        <div className={cn(
            "absolute inset-0 transition-opacity duration-500",
            isActive ? "opacity-100" : "opacity-0"
        )}>
            <div
                className="absolute inset-0 opacity-40 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")`
                }}
            />
            <div className="absolute inset-2 border-2 border-double border-stone-800/20 rounded-md pointer-events-none" />
            <div className="absolute inset-0 border-4 border-stone-800/10 rounded-lg pointer-events-none" />
            <div className="relative h-full flex flex-col items-center justify-center text-center p-6 z-10">
                <div className="mb-3 text-stone-500 opacity-60">
                    <Scroll className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-stone-900 mb-3 tracking-widest drop-shadow-sm">
                    {banner.title}
                </h3>
                {banner.description && (
                    <p className="text-base font-serif text-stone-700 whitespace-pre-line leading-loose mb-3 opacity-90">
                        {banner.description}
                    </p>
                )}
                {banner.link_url && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="font-serif bg-stone-100/50 hover:bg-stone-200 text-stone-800 border-stone-400 hover:border-stone-600 transition-all duration-300"
                        onClick={(e) => {
                            e.stopPropagation();
                            window.open(banner.link_url!, '_blank', 'noopener,noreferrer');
                        }}
                    >
                        자세히 보기
                    </Button>
                )}
            </div>
        </div>
    );
});
BannerContent.displayName = 'BannerContent';

const AdBannerComponent = () => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const isHydrated = useHydration();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Supabase에서 배너 데이터 가져오기
    const { data: banners = FALLBACK_AD_BANNERS } = useSidebarAdBanners();

    // 현재 배너 (메모이제이션)
    const currentBanner = useMemo(() =>
        banners[currentSlide] || banners[0],
        [banners, currentSlide]
    );

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
        if (index === currentSlide) return;
        setCurrentSlide(index);
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, [currentSlide]);

    const handleMouseEnter = useCallback(() => setIsAutoPlaying(false), []);
    const handleMouseLeave = useCallback(() => setIsAutoPlaying(true), []);

    // 배너 클릭 핸들러
    const handleBannerClick = useCallback(() => {
        if (currentBanner?.link_url) {
            window.open(currentBanner.link_url, '_blank', 'noopener,noreferrer');
        }
    }, [currentBanner?.link_url]);

    // 배너가 없으면 렌더링하지 않음
    if (banners.length === 0 || !currentBanner) return null;

    return (
        <div
            className={cn(
                "relative w-full aspect-[4/5] rounded-lg overflow-hidden group select-none shadow-md transition-opacity duration-300",
                isHydrated ? "opacity-100" : "opacity-0",
                currentBanner.link_url && "cursor-pointer"
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleBannerClick}
            style={{ backgroundColor: '#fdfbf7' }}
        >
            {/* 모든 배너를 렌더링하여 크로스페이드 효과 적용 */}
            {banners.map((banner, index) => (
                <BannerContent
                    key={banner.id}
                    banner={banner}
                    isActive={index === currentSlide}
                />
            ))}
            <SlideIndicator
                count={banners.length}
                current={currentSlide}
                hasImage={!!currentBanner.image_url}
                onSelect={goToSlide}
            />
        </div>
    );
};

// React.memo로 래핑
const AdBanner = memo(AdBannerComponent);
AdBanner.displayName = "AdBanner";

export default AdBanner;
