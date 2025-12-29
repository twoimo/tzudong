'use client';

import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, ExternalLink, Scroll } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useDeviceType } from '@/hooks/useDeviceType';
import { useMobilePopupAdBanners } from '@/hooks/use-ad-banners';
import { AdBanner } from '@/types/ad-banner';

// 로컬 스토리지 키
const DISMISSED_KEY = 'adBannerPopup_dismissed';
const DISMISSED_DATE_KEY = 'adBannerPopup_dismissedDate';

// DailyRecommendationPopup 닫힘 이벤트 이름
const DAILY_POPUP_CLOSED_EVENT = 'dailyRecommendationPopupClosed';

const AdBannerPopupComponent = () => {
    const { isMobileOrTablet } = useDeviceType();
    const [isVisible, setIsVisible] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // 배너 데이터 가져오기
    const { data: banners = [] } = useMobilePopupAdBanners();

    // 오늘 날짜 확인
    const getTodayString = () => {
        const today = new Date();
        return `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    };

    // 오늘 이미 닫았는지 확인
    const shouldShowPopup = useCallback(() => {
        if (typeof window === 'undefined') return false;

        const dismissedDate = localStorage.getItem(DISMISSED_DATE_KEY);
        const isDismissedToday = dismissedDate === getTodayString();

        return !isDismissedToday;
    }, []);

    // DailyRecommendationPopup 닫힘 이벤트 리스너
    useEffect(() => {
        if (!isMobileOrTablet || banners.length === 0) return;

        const handleDailyPopupClosed = () => {
            // DailyRecommendationPopup이 닫힌 후 500ms 뒤에 표시
            if (shouldShowPopup()) {
                showTimeoutRef.current = setTimeout(() => {
                    setIsVisible(true);
                }, 500);
            }
        };

        // DailyRecommendationPopup이 표시되지 않는 경우를 위한 타이머
        const fallbackTimer = setTimeout(() => {
            // window에서 hasShownDailyPopup 체크
            const globalWindow = window as typeof window & { hasShownDailyPopup?: boolean };
            if (!globalWindow.hasShownDailyPopup && shouldShowPopup()) {
                setIsVisible(true);
            }
        }, 2000);

        window.addEventListener(DAILY_POPUP_CLOSED_EVENT, handleDailyPopupClosed);

        return () => {
            window.removeEventListener(DAILY_POPUP_CLOSED_EVENT, handleDailyPopupClosed);
            clearTimeout(fallbackTimer);
            if (showTimeoutRef.current) {
                clearTimeout(showTimeoutRef.current);
            }
        };
    }, [isMobileOrTablet, banners.length, shouldShowPopup]);

    // 자동 슬라이드 전환
    useEffect(() => {
        if (!isAutoPlaying || !isVisible || banners.length <= 1) return;

        timeoutRef.current = setTimeout(() => {
            setCurrentSlide((prev) => (prev + 1) % banners.length);
        }, 4000);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isAutoPlaying, isVisible, currentSlide, banners.length]);

    // 팝업 닫기
    const handleClose = useCallback(() => {
        setIsVisible(false);
    }, []);

    // 오늘 하루 안 보기
    const handleDismissToday = useCallback(() => {
        localStorage.setItem(DISMISSED_KEY, 'true');
        localStorage.setItem(DISMISSED_DATE_KEY, getTodayString());
        setIsVisible(false);
    }, []);

    // 슬라이드 이동
    const goToSlide = useCallback((index: number) => {
        setCurrentSlide(index);
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, []);

    const nextSlide = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentSlide((prev) => (prev + 1) % banners.length);
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, [banners.length]);

    const prevSlide = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentSlide((prev) => (prev - 1 + banners.length) % banners.length);
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 5000);
    }, [banners.length]);

    // 배너 클릭 핸들러
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
            {/* 팝업 카드 */}
            <div
                className={cn(
                    "relative w-[320px] mx-auto rounded-lg overflow-hidden shadow-2xl",
                    "animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                )}
                style={{ backgroundColor: '#fdfbf7' }}
            >
                {/* 배너 컨텐츠 */}
                <div
                    className={cn(
                        "relative aspect-[4/5] cursor-pointer"
                    )}
                    onClick={() => handleBannerClick(currentBanner)}
                >
                    {currentBanner.image_url ? (
                        <img
                            src={currentBanner.image_url}
                            alt={currentBanner.title}
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                    ) : (
                        <>
                            {/* 한지 질감 오버레이 */}
                            <div
                                className="absolute inset-0 opacity-40 pointer-events-none"
                                style={{
                                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")`,
                                }}
                            />

                            {/* 전통 문양 테두리 */}
                            <div className="absolute inset-2 border-2 border-double border-stone-800/20 rounded-md pointer-events-none" />

                            {/* 텍스트 컨텐츠 */}
                            <div className="relative h-full flex flex-col items-center justify-center text-center p-6">
                                <Scroll className="w-8 h-8 text-stone-500 mb-3 opacity-60" />
                                <h3 className="text-xl font-serif font-bold text-stone-900 mb-2 tracking-wide">
                                    {currentBanner.title}
                                </h3>
                                {currentBanner.description && (
                                    <p className="text-sm font-serif text-stone-700 whitespace-pre-line leading-relaxed">
                                        {currentBanner.description}
                                    </p>
                                )}
                                {currentBanner.link_url && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mt-4 font-serif"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleBannerClick(currentBanner);
                                        }}
                                    >
                                        자세히 보기
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* 슬라이드 인디케이터 */}
                {banners.length > 1 && (
                    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                        {banners.map((_, index) => (
                            <button
                                key={index}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    goToSlide(index);
                                }}
                                className={cn(
                                    "w-2 h-2 rounded-full transition-all",
                                    currentSlide === index
                                        ? currentBanner.image_url
                                            ? "bg-white scale-110"
                                            : "bg-stone-700 scale-110"
                                        : currentBanner.image_url
                                            ? "bg-white/50"
                                            : "bg-stone-400/50"
                                )}
                            />
                        ))}
                    </div>
                )}

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

const AdBannerPopup = memo(AdBannerPopupComponent);
AdBannerPopup.displayName = 'AdBannerPopup';

export default AdBannerPopup;
