'use client';

import { useState, useEffect, useCallback, memo, useRef, useMemo } from 'react';
import { Scroll } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useDeviceType } from '@/hooks/useDeviceType';
import { useMobilePopupAdBanners } from '@/hooks/use-ad-banners';
import { AdBanner } from '@/types/ad-banner';

// 로컬 스토리지 키
const DISMISSED_DATE_KEY = 'combinedPopup_dismissedDate';

// 오늘 날짜 문자열 (캐시)
let todayStringCache: string | null = null;
let todayStringDate: number | null = null;
const getTodayString = () => {
    const now = Date.now();
    if (todayStringCache && todayStringDate && now - todayStringDate < 60000) {
        return todayStringCache;
    }
    const today = new Date(now);
    todayStringCache = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    todayStringDate = now;
    return todayStringCache;
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

// 배너 슬라이드 컴포넌트 (메모이제이션)
const BannerSlide = memo(({
    banner,
    isActive,
    onClick,
    onVideoEnded
}: {
    banner: AdBanner;
    isActive: boolean;
    onClick: () => void;
    onVideoEnded?: () => void;
}) => (
    <div
        className={cn(
            "absolute inset-0 transition-opacity duration-500",
            isActive ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClick}
    >
        {/* 영상 배너 (우선순위 1) */}
        {banner.video_url ? (
            <video
                src={banner.video_url}
                className="w-full h-full object-cover"
                autoPlay={isActive}
                muted
                playsInline
                onEnded={onVideoEnded}
            />
        ) : banner.image_url ? (
            /* 이미지 배너 (우선순위 2) */
            <img
                src={banner.image_url}
                alt={banner.title}
                className="w-full h-full object-cover"
                loading={isActive ? "eager" : "lazy"}
                decoding="async"
            />
        ) : (
            /* 텍스트 전용 배너 (Fallback) */
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
    const { isMobileOrTablet } = useDeviceType();
    const [isVisible, setIsVisible] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hasShownRef = useRef(false);

    // 배너 데이터
    const { data: banners = [] } = useMobilePopupAdBanners();

    // 오늘 이미 닫았는지 확인
    const shouldShowPopup = useCallback(() => {
        if (typeof window === 'undefined') return false;
        const dismissedDate = localStorage.getItem(DISMISSED_DATE_KEY);
        if (dismissedDate === getTodayString()) return false;
        return true;
    }, []);

    // 팝업 표시
    useEffect(() => {
        if (!isMobileOrTablet || banners.length === 0 || hasShownRef.current) return;

        if (shouldShowPopup()) {
            const timer = setTimeout(() => {
                setIsVisible(true);
                hasShownRef.current = true;
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isMobileOrTablet, banners.length, shouldShowPopup]);

    // 자동 슬라이드 (영상 배너가 아닐 때만)
    useEffect(() => {
        if (!isAutoPlaying || !isVisible || banners.length <= 1) return;

        // 현재 배너가 영상이면 자동 슬라이드 건너뛰기 (영상 종료 시 onVideoEnded로 처리)
        const currentBanner = banners[currentSlide];
        if (currentBanner?.video_url) return;

        timeoutRef.current = setTimeout(() => {
            setCurrentSlide((prev) => (prev + 1) % banners.length);
        }, 4000);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isAutoPlaying, isVisible, currentSlide, banners]);

    // 팝업 닫기
    const handleClose = useCallback(() => {
        setIsVisible(false);
    }, []);

    // 오늘 하루 안 보기
    const handleDismissToday = useCallback(() => {
        localStorage.setItem(DISMISSED_DATE_KEY, getTodayString());
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

    // 표시 조건 체크
    if (!isMobileOrTablet || !isVisible || banners.length === 0) {
        return null;
    }

    const currentBanner = banners[currentSlide];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 animate-in fade-in duration-300">
            <div
                className={cn(
                    "relative w-[320px] mx-auto rounded-lg overflow-hidden shadow-2xl",
                    "animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                )}
                style={{ backgroundColor: '#fdfbf7' }}
            >
                {/* 배너 슬라이드 컨텐츠 - 모든 배너를 렌더링하여 크로스페이드 */}
                <div className="relative aspect-[4/5]">
                    {banners.map((banner, index) => (
                        <BannerSlide
                            key={banner.id}
                            banner={banner}
                            isActive={index === currentSlide}
                            onClick={() => handleBannerClick(banner)}
                            onVideoEnded={() => {
                                if (banners.length > 1 && index === currentSlide) {
                                    setCurrentSlide((prev) => (prev + 1) % banners.length);
                                }
                            }}
                        />
                    ))}
                </div>

                {/* 슬라이드 인디케이터 */}
                <SlideIndicator
                    count={banners.length}
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
