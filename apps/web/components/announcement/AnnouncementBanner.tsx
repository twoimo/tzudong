'use client';

import { useState, useEffect } from 'react';
import { X, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getTopAnnouncement, Announcement } from '@/types/announcement';

interface AnnouncementBannerProps {
    onAnnouncementClick: (announcement: Announcement) => void;
    rightPanelWidth?: number;
}

export default function AnnouncementBanner({
    onAnnouncementClick,
    rightPanelWidth = 0,
}: AnnouncementBannerProps) {
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);
    const [isVisible, setIsVisible] = useState(true);
    const [isDismissed, setIsDismissed] = useState(false);

    useEffect(() => {
        // 세션 스토리지에서 닫힘 상태 확인
        const dismissed = sessionStorage.getItem('announcementBannerDismissed');
        if (dismissed) {
            setIsDismissed(true);
        }

        // 최상위 우선순위 공지사항 가져오기
        const topAnnouncement = getTopAnnouncement();
        setAnnouncement(topAnnouncement);
    }, []);

    const handleDismiss = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsVisible(false);
        setIsDismissed(true);
        sessionStorage.setItem('announcementBannerDismissed', 'true');
    };

    const handleClick = () => {
        if (announcement) {
            onAnnouncementClick(announcement);
        }
    };

    // 공지사항이 없거나 닫힌 경우 렌더링하지 않음
    if (!announcement || isDismissed || !isVisible) {
        return null;
    }

    return (
        <div
            className="absolute top-0 left-0 z-40 cursor-pointer transition-all duration-300"
            onClick={handleClick}
            style={{
                right: rightPanelWidth,
            }}
        >
            <div className="mx-4 mt-4">
                <div
                    className="flex items-center justify-between px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm transition-all duration-300 hover:shadow-xl group"
                    style={{
                        background: 'linear-gradient(135deg, rgba(253, 251, 247, 0.95) 0%, rgba(245, 240, 230, 0.95) 100%)',
                        border: '1px solid rgba(120, 100, 80, 0.2)',
                    }}
                >
                    {/* 한지 질감 오버레이 */}
                    <div
                        className="absolute inset-0 opacity-20 pointer-events-none rounded-lg"
                        style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.15'/%3E%3C/svg%3E")`,
                        }}
                    />

                    {/* 좌측: 아이콘 + 제목 */}
                    <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-800/10 flex items-center justify-center">
                            <Megaphone className="h-4 w-4 text-red-800" />
                        </div>
                        <span className="font-medium text-stone-800 truncate group-hover:text-red-800 transition-colors">
                            {announcement.title}
                        </span>
                    </div>

                    {/* 우측: 닫기 버튼 */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleDismiss}
                        className="h-8 w-8 flex-shrink-0 hover:bg-stone-200/50 text-stone-600 hover:text-stone-900 relative z-10"
                        aria-label="공지사항 닫기"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
