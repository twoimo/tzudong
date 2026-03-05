import { memo, useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquare, Stamp, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

export type OverlayPanelType = 'feed' | 'stamp' | 'leaderboard' | null;

interface FloatingNavButtonsProps {
    activePanel: OverlayPanelType;
    onPanelChange: (panel: OverlayPanelType) => void;
    onReviewSelect?: (reviewId: string) => void;
    className?: string;
}

interface NavItem {
    id: OverlayPanelType;
    icon: React.ElementType;
    label: string;
    adminOnly?: boolean;
}

// 일반 사용자 메뉴
const USER_ITEMS: NavItem[] = [
    { id: 'feed', icon: MessageSquare, label: '리뷰' },
    { id: 'stamp', icon: Stamp, label: '도장' },
    { id: 'leaderboard', icon: Trophy, label: '랭킹' },
];

// 관리자 전용 메뉴 (헤더로 이동됨)
const ADMIN_ITEMS: NavItem[] = [];

/**
 * 플로팅 네비게이션 버튼
 * - 모바일 스타일과 동일한 디자인
 * - 국내/해외 토글 포함
 */
function FloatingNavButtonsComponent({ activePanel, onPanelChange, onReviewSelect, className }: FloatingNavButtonsProps) {
    const pathname = usePathname();
    const { isAdmin } = useAuth();
    const allItems = isAdmin ? [...USER_ITEMS, ...ADMIN_ITEMS] : USER_ITEMS;

    // 국내/해외 모드 상태 (이벤트 기반 동기화)
    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');

    const handlePanelClick = useCallback((panelId: OverlayPanelType) => {
        onPanelChange(activePanel === panelId ? null : panelId);
    }, [activePanel, onPanelChange]);

    // 국내/해외 모드 변경 핸들러
    const handleModeChange = useCallback((mode: 'domestic' | 'overseas') => {
        setMapMode(mode);
        window.dispatchEvent(new CustomEvent('changeMapMode', { detail: mode }));
    }, []);

    // mapMode 동기화 이벤트 수신
    useEffect(() => {
        const handleSyncMapMode = (e: Event) => {
            const customEvent = e as CustomEvent<'domestic' | 'overseas'>;
            setMapMode(customEvent.detail);
        };

        window.addEventListener('syncMapMode', handleSyncMapMode);
        return () => window.removeEventListener('syncMapMode', handleSyncMapMode);
    }, []);


    // [리뷰 공유] openFeedOverlay 이벤트 리스너
    useEffect(() => {
        const handleOpenFeedOverlay = (e: Event) => {
            const customEvent = e as CustomEvent<{ reviewId: string }>;
            const { reviewId } = customEvent.detail;
            // 피드 오버레이 열기
            onPanelChange('feed');
            // 리뷰 선택 콜백
            if (onReviewSelect && reviewId) {
                onReviewSelect(reviewId);
            }
        };

        window.addEventListener('openFeedOverlay', handleOpenFeedOverlay);
        return () => window.removeEventListener('openFeedOverlay', handleOpenFeedOverlay);
    }, [onPanelChange, onReviewSelect]);

    // [NEW] 홈 화면(/)에서만 표시하도록 제한
    if (pathname !== '/') return null;

    return (
        <div className={cn("fixed z-[92] flex flex-col items-start gap-2", className)}>
            {/* 국내/해외 토글 - 모바일/태블릿과 동일한 디자인 */}
            <div className="flex items-center gap-0.5 p-0.5 bg-background/95 backdrop-blur-sm rounded-full shadow-lg border border-border w-[clamp(84px,22vw,120px)]">
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label="국내 지도 모드로 전환"
                    onClick={() => handleModeChange('domestic')}
                    className={`rounded-full h-8 px-2 text-xs font-medium transition-all flex-1 ${mapMode === 'domestic'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                        }`}
                >
                    국내
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label="해외 지도 모드로 전환"
                    onClick={() => handleModeChange('overseas')}
                    className={`rounded-full h-8 px-2 text-xs font-medium transition-all flex-1 ${mapMode === 'overseas'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
                        }`}
                >
                    해외
                </Button>
            </div>

            {allItems.map((item) => {
                const isActive = activePanel === item.id;
                return (
                    <Button
                        key={item.id}
                        variant="secondary"
                        size="sm"
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={`${item.label} 패널 ${isActive ? '선택됨' : '열기'}`}
                        onClick={() => handlePanelClick(item.id)}
                        className={cn(
                            'rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border',
                            'hover:bg-secondary/80 w-[clamp(84px,22vw,120px)] px-2',
                            isActive && 'ring-2 ring-primary bg-primary/10',
                            item.adminOnly && 'border-orange-500/50'
                        )}
                    >
                        <div className="flex items-center w-full gap-1">
                            <div className="flex items-center justify-center w-4 shrink-0">
                                <item.icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 flex items-center justify-center min-w-0">
                                <span className="text-sm truncate">{item.label}</span>
                            </div>
                        </div>
                    </Button>
                );
            })}
        </div>
    );
}

const FloatingNavButtons = memo(FloatingNavButtonsComponent);
FloatingNavButtons.displayName = 'FloatingNavButtons';

export default FloatingNavButtons;
