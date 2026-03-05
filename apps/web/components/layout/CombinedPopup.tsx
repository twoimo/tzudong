'use client';

import { useState, useEffect, useCallback, memo, useRef } from 'react';
import Image from 'next/image';
import { Scroll, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { usePopupAdBanners } from '@/hooks/use-ad-banners';
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
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    // isActive 변경 시 영상 재생/정지 제어
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !banner.video_url) return;

        if (isActive) {
            // 영상을 처음부터 재생
            video.currentTime = 0;
            video.play().catch(() => {
                // 자동 재생 실패 시 무시 (브라우저 정책)
            });
        } else {
            // 비활성화 시 정지
            video.pause();
        }
    }, [isActive, banner.video_url]);

    return (
        <div
            className="w-full h-full flex-shrink-0"
            onClick={onClick}
        >
            {/* 영상 배너 (우선순위 1) */}
            {banner.video_url ? (
                <video
                    ref={videoRef}
                    src={banner.video_url}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    onEnded={onVideoEnded}
                />
            ) : banner.image_url ? (
                /* 이미지 배너 (우선순위 2) */
                <div className="relative h-full w-full">
                    <Image
                        src={banner.image_url}
                        alt={banner.title}
                        fill
                        unoptimized
                        sizes="(max-width: 640px) 100vw, 400px"
                        className="object-cover"
                        loading={isActive ? "eager" : "lazy"}
                        decoding="async"
                    />
                </div>
            ) : (
                /* 텍스트 전용 배너 (Fallback) */
                <>
                    <div
                        className="absolute inset-0 opacity-40 dark:opacity-0 pointer-events-none transition-opacity"
                        style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")`,
                        }}
                    />
                    <div className="absolute inset-2 border-2 border-double border-border rounded-md pointer-events-none dark:border-transparent" />
                    <div className="relative h-full flex flex-col items-center justify-center text-center p-6">
                        <Scroll className="w-8 h-8 text-muted-foreground mb-3 opacity-60" />
                        <h3 className="text-xl font-serif font-bold text-foreground mb-2 tracking-wide">
                            {banner.title}
                        </h3>
                        {banner.description && (
                            <p className="text-sm font-serif text-foreground/80 whitespace-pre-line leading-relaxed">
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
    );
});
BannerSlide.displayName = 'BannerSlide';

const CombinedPopupComponent = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const [isDragging, setIsDragging] = useState(false);

    // [OPTIMIZATION] useRef for drag coordinates to avoid re-renders on every move
    const dragStartRef = useRef<number | null>(null);
    const dragEndRef = useRef<number | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hasShownRef = useRef(false);
    const slideContainerRef = useRef<HTMLDivElement>(null);

    // 배너 데이터
    const { data: banners = [] } = usePopupAdBanners();

    // 오늘 이미 닫았는지 확인
    const shouldShowPopup = useCallback(() => {
        if (typeof window === 'undefined') return false;
        const dismissedDate = localStorage.getItem(DISMISSED_DATE_KEY);
        if (dismissedDate === getTodayString()) return false;
        return true;
    }, []);

    // 팝업 표시
    useEffect(() => {
        if (banners.length === 0 || hasShownRef.current) return;

        if (shouldShowPopup()) {
            const timer = setTimeout(() => {
                setIsVisible(true);
                hasShownRef.current = true;
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [banners.length, shouldShowPopup]);

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
    const handleClose = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setIsVisible(false);
    }, []);

    // 오늘 하루 안 보기
    const handleDismissToday = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        localStorage.setItem(DISMISSED_DATE_KEY, getTodayString());
        setIsVisible(false);
    }, []);

    // 슬라이드 이동
    const goToSlide = useCallback((index: number) => {
        setCurrentSlide(index);
        setIsAutoPlaying(false);
        // 사용자 인터렉션 후 잠시 뒤 자동 재생 재개
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        const timer = setTimeout(() => setIsAutoPlaying(true), 8000);
        return () => clearTimeout(timer);
    }, []);

    // 다음/이전 슬라이드
    const nextSlide = useCallback(() => {
        setCurrentSlide((prev) => (prev + 1) % banners.length);
    }, [banners.length]);

    const prevSlide = useCallback(() => {
        setCurrentSlide((prev) => (prev - 1 + banners.length) % banners.length);
    }, [banners.length]);

    // [OPTIMIZATION] Memoized swipe config
    const minSwipeDistance = 50;

    // [OPTIMIZATION] Touch handlers using refs to avoid re-renders
    const onTouchStart = useCallback((e: React.TouchEvent) => {
        dragEndRef.current = null;
        dragStartRef.current = e.targetTouches[0].clientX;
    }, []);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        dragEndRef.current = e.targetTouches[0].clientX;
    }, []);

    const handleSwipeEnd = useCallback(() => {
        const start = dragStartRef.current;
        const end = dragEndRef.current;
        if (start === null || end === null) return;

        const distance = start - end;
        if (distance > minSwipeDistance) {
            nextSlide();
        } else if (distance < -minSwipeDistance) {
            prevSlide();
        }
        setIsAutoPlaying(false);
        setTimeout(() => setIsAutoPlaying(true), 8000);
    }, [nextSlide, prevSlide]);

    const onTouchEnd = useCallback(() => {
        handleSwipeEnd();
    }, [handleSwipeEnd]);

    // [OPTIMIZATION] Mouse handlers using refs
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        setIsDragging(true);
        dragStartRef.current = e.clientX;
    }, []);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;
        dragEndRef.current = e.clientX;
    }, [isDragging]);

    const onMouseUp = useCallback(() => {
        if (isDragging) {
            handleSwipeEnd();
            setIsDragging(false);
        }
    }, [isDragging, handleSwipeEnd]);

    const onMouseLeave = useCallback(() => {
        if (isDragging) {
            setIsDragging(false);
        }
    }, [isDragging]);

    // 배너 클릭
    const handleBannerClick = useCallback((banner: AdBanner) => {
        if (banner.link_url) {
            window.open(banner.link_url, '_blank', 'noopener,noreferrer');
        }
    }, []);

    // 표시 조건 체크
    if (!isVisible || banners.length === 0) {
        return null;
    }

    return (
        <div
            data-popup-overlay
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 animate-in fade-in duration-300"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div
                className={cn(
                    "relative w-[min(320px,calc(100vw-2rem))] mx-auto rounded-lg overflow-hidden shadow-2xl",
                    "animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                )}
                style={{ backgroundColor: 'hsl(var(--background))' }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* 배너 슬라이드 컨텐츠 - 가로 슬라이딩 방식 */}
                <div
                    className="relative aspect-[4/5] overflow-hidden group"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseLeave}
                >
                    <div
                        className={cn(
                            "flex w-full h-full transition-transform duration-500 ease-out",
                            isDragging ? "cursor-grabbing" : "cursor-grab"
                        )}
                        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
                        ref={slideContainerRef}
                    >
                        {banners.map((banner, index) => (
                            <BannerSlide
                                key={banner.id}
                                banner={banner}
                                isActive={index === currentSlide}
                                onClick={() => !isDragging && handleBannerClick(banner)}
                                onVideoEnded={() => {
                                    if (banners.length > 1 && index === currentSlide) {
                                        nextSlide();
                                    }
                                }}
                            />
                        ))}
                    </div>

                    {/* 데스크탑 네비게이션 버튼 (마우스 오버 시 표시) */}
                    {banners.length > 1 && (
                        <>
                            <button
                                onClick={(e) => { e.stopPropagation(); prevSlide(); }}
                                className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/50"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); nextSlide(); }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/50"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </>
                    )}
                </div>

                {/* 슬라이드 인디케이터 */}
                <SlideIndicator
                    count={banners.length}
                    current={currentSlide}
                    onSelect={goToSlide}
                />

                {/* 하단 버튼 - 항상 클릭 가능하도록 */}
                <div className="relative z-10 flex border-t border-border pointer-events-auto">
                    <button
                        onClick={(e) => handleDismissToday(e)}
                        className="flex-1 py-3 text-sm text-muted-foreground hover:bg-accent transition-colors"
                    >
                        오늘 하루 안 보기
                    </button>
                    <div className="w-px bg-border" />
                    <button
                        onClick={(e) => handleClose(e)}
                        className="flex-1 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
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
