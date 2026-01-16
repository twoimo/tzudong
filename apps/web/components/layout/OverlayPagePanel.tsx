'use client';

import { memo, useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { OverlayPanelType } from './FloatingNavButtons';
import { ReviewModal } from '@/components/reviews/ReviewModal';
import { useQueryClient } from '@tanstack/react-query';

// 페이지 콘텐츠 직접 로딩 (Suspense 제거하여 로딩 메시지 중복 방지)
import FeedContent from '@/components/overlay-pages/FeedOverlay';
import StampContent from '@/components/overlay-pages/StampOverlay';
import LeaderboardContent from '@/components/overlay-pages/LeaderboardOverlay';
import CostsContent from '@/components/overlay-pages/CostsOverlay';
import AdminReviewsContent from '@/components/overlay-pages/AdminReviewsOverlay';
import InsightContent from '@/components/overlay-pages/InsightOverlay';

// 패널별 최대 너비 설정
const PANEL_WIDTHS: Record<Exclude<OverlayPanelType, null>, string> = {
    feed: 'max-w-[560px]',     // 560px - 리뷰 피드 (리뷰 작성 패널과 동일한 크기)
    stamp: 'max-w-6xl',        // 1152px - 도장 그리드
    leaderboard: 'max-w-3xl',  // 768px - 랭킹
    costs: 'max-w-4xl',        // 896px - 비용 테이블
    'admin-reviews': 'max-w-6xl', // 1152px - 검수 테이블
    insight: 'max-w-6xl',      // 1152px - 인사이트
};

interface OverlayPagePanelProps {
    activePanel: OverlayPanelType;
    onClose: () => void;
}

/**
 * 오버레이 페이지 패널
 * - 헤더 없음 (각 콘텐츠에서 자체 헤더 관리)
 * - 피드 패널에서 리뷰 작성 시 나란히 표시
 * - 모바일에서는 Dialog로, 데스크탑에서는 inline으로 표시
 */
function OverlayPagePanelComponent({ activePanel, onClose }: OverlayPagePanelProps) {
    const queryClient = useQueryClient();
    const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
    const [isDesktop, setIsDesktop] = useState(false);

    // 데스크탑 체크 (lg breakpoint = 1024px)
    useEffect(() => {
        const checkDesktop = () => setIsDesktop(window.innerWidth >= 1024);
        checkDesktop();
        window.addEventListener('resize', checkDesktop);
        return () => window.removeEventListener('resize', checkDesktop);
    }, []);

    // ESC 키로 닫기
    useEffect(() => {
        if (!activePanel) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isReviewPanelOpen) {
                    setIsReviewPanelOpen(false);
                } else {
                    onClose();
                }
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [activePanel, onClose, isReviewPanelOpen]);

    // 패널 닫힐 때 리뷰 패널도 닫기
    useEffect(() => {
        if (!activePanel) {
            setIsReviewPanelOpen(false);
        }
    }, [activePanel]);

    const handleOpenReviewPanel = useCallback(() => {
        setIsReviewPanelOpen(true);
    }, []);

    const handleCloseReviewPanel = useCallback(() => {
        setIsReviewPanelOpen(false);
    }, []);

    const handleReviewSuccess = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['review-feed-overlay'] });
        setIsReviewPanelOpen(false);
    }, [queryClient]);

    if (!activePanel) return null;

    const maxWidth = PANEL_WIDTHS[activePanel];
    const showInlineReviewPanel = activePanel === 'feed' && isReviewPanelOpen && isDesktop;

    return (
        <>
            {/* 배경 오버레이 - 하나만 */}
            <div
                className="fixed inset-0 z-[85] bg-black/40 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* 패널 컨테이너 - 나란히 배치 */}
            <div
                className={cn(
                    "fixed z-[86] flex gap-4",
                    "top-20 bottom-8 left-1/2 -translate-x-1/2",
                    "transition-all duration-300 ease-out"
                )}
            >
                {/* 메인 패널 (피드/도장/랭킹 등) */}
                <div
                    className={cn(
                        "bg-background shadow-2xl",
                        "flex flex-col overflow-hidden",
                        "w-[calc(100vw-48px)]",
                        maxWidth,
                        "rounded-2xl border border-border",
                        "transition-all duration-300"
                    )}
                >
                    {activePanel === 'feed' && (
                        <FeedContent
                            onClose={onClose}
                            onOpenReviewModal={handleOpenReviewPanel}
                            hideReviewModal={true}
                            hideFloatingButton={isReviewPanelOpen}
                        />
                    )}
                    {activePanel === 'stamp' && <StampContent onClose={onClose} />}
                    {activePanel === 'leaderboard' && <LeaderboardContent onClose={onClose} />}
                    {activePanel === 'costs' && <CostsContent onClose={onClose} />}
                    {activePanel === 'admin-reviews' && <AdminReviewsContent />}
                    {activePanel === 'insight' && <InsightContent />}
                </div>

                {/* 리뷰 작성 패널 - 데스크탑에서만 inline 표시 */}
                {showInlineReviewPanel && (
                    <div
                        className={cn(
                            "bg-background shadow-2xl",
                            "flex flex-col overflow-hidden",
                            "w-[560px] max-w-[calc(100vw-700px)]",
                            "rounded-2xl border border-border",
                            "animate-in slide-in-from-right-4 duration-300"
                        )}
                    >
                        <ReviewModal
                            isOpen={true}
                            onClose={handleCloseReviewPanel}
                            restaurant={null}
                            onSuccess={handleReviewSuccess}
                            inline={true}
                        />
                    </div>
                )}
            </div>

            {/* 모바일/태블릿에서만 Dialog 표시 */}
            {!isDesktop && isReviewPanelOpen && (
                <ReviewModal
                    isOpen={true}
                    onClose={handleCloseReviewPanel}
                    restaurant={null}
                    onSuccess={handleReviewSuccess}
                />
            )}
        </>
    );
}

const OverlayPagePanel = memo(OverlayPagePanelComponent);
OverlayPagePanel.displayName = 'OverlayPagePanel';

export default OverlayPagePanel;
