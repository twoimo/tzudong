'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Megaphone, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Announcement } from '@/types/announcement';
import { useBannerAnnouncements } from '@/hooks/use-announcements';

interface AnnouncementBannerProps {
    onAnnouncementClick: (announcement: Announcement) => void;
    rightPanelWidth?: number;
}

const ROTATION_INTERVAL = 5000; // 5초마다 전환

export default function AnnouncementBanner({
    onAnnouncementClick,
    rightPanelWidth = 0,
}: AnnouncementBannerProps) {
    const { data: announcements = [] } = useBannerAnnouncements();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isVisible, setIsVisible] = useState(true);
    const [isDismissed, setIsDismissed] = useState(false);
    const [isPaused, setIsPaused] = useState(false);

    useEffect(() => {
        // 세션 스토리지에서 닫힘 상태 확인
        const dismissed = sessionStorage.getItem('announcementBannerDismissed');
        if (dismissed) {
            setIsDismissed(true);
        }
    }, []);

    useEffect(() => {
        if (announcements.length === 0) {
            setCurrentIndex(0);
            return;
        }
        if (currentIndex >= announcements.length) {
            setCurrentIndex(0);
        }
    }, [announcements.length, currentIndex]);

    // 자동 순환
    useEffect(() => {
        if (announcements.length <= 1 || isPaused || isDismissed) return;

        const timer = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % announcements.length);
        }, ROTATION_INTERVAL);

        return () => clearInterval(timer);
    }, [announcements.length, isPaused, isDismissed]);

    const handlePrev = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentIndex(prev => (prev - 1 + announcements.length) % announcements.length);
    }, [announcements.length]);

    const handleNext = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentIndex(prev => (prev + 1) % announcements.length);
    }, [announcements.length]);

    const handleDismiss = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsVisible(false);
        setIsDismissed(true);
        sessionStorage.setItem('announcementBannerDismissed', 'true');
    };

    const handleClick = () => {
        const currentAnnouncement = announcements[currentIndex];
        if (currentAnnouncement) {
            onAnnouncementClick(currentAnnouncement);
        }
    };

    // 공지사항이 없거나 닫힌 경우 렌더링하지 않음
    if (announcements.length === 0 || isDismissed || !isVisible) {
        return null;
    }

    const currentAnnouncement = announcements[currentIndex];

    return (
        <div
            className="absolute top-0 left-0 z-40 cursor-pointer transition-all duration-300"
            onClick={handleClick}
            role="button"
            tabIndex={0}
            aria-label={`공지사항 배너: ${currentAnnouncement.title}`}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick();
                }
            }}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            style={{
                right: rightPanelWidth,
            }}
        >
            <div className="mx-4 mt-4">
                <div
                    className="flex items-center justify-between px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm transition-all duration-300 hover:shadow-xl group bg-card/95 border border-border"
                >
                    {/* 한지 질감 오버레이 - 다크모드에서 숨김 */}
                    <div
                        className="absolute inset-0 opacity-20 pointer-events-none rounded-lg dark:opacity-0"
                        style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.15'/%3E%3C/svg%3E")`,
                        }}
                    />

                    {/* 좌측: 이전 버튼 (여러 개일 때만) */}
                    {announcements.length > 1 && (
                        <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            onClick={handlePrev}
                            className="h-6 w-6 flex-shrink-0 hover:bg-accent text-muted-foreground hover:text-foreground relative z-10 mr-1"
                            aria-label="이전 공지"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                    )}

                    {/* 중앙: 아이콘 + 제목 */}
                    <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-800/10 flex items-center justify-center">
                            <Megaphone className="h-4 w-4 text-red-800" />
                        </div>
                        <span className="font-medium text-foreground truncate group-hover:text-red-800 dark:group-hover:text-red-400 transition-colors">
                            {currentAnnouncement.title}
                        </span>
                    </div>

                    {/* 우측: 다음 버튼 + 닫기 버튼 */}
                    <div className="flex items-center gap-1 relative z-10">
                        {announcements.length > 1 && (
                            <Button
                                variant="ghost"
                                size="icon"
                                type="button"
                                onClick={handleNext}
                                className="h-6 w-6 flex-shrink-0 hover:bg-accent text-muted-foreground hover:text-foreground"
                                aria-label="다음 공지"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            onClick={handleDismiss}
                            className="h-8 w-8 flex-shrink-0 hover:bg-accent text-muted-foreground hover:text-foreground"
                            aria-label="공지사항 닫기"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
