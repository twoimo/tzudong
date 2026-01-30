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

import { Restaurant } from '@/types/restaurant';
import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';
import { UserProfilePanel } from '@/components/profile/UserProfilePanel';
import { EditRestaurantModal } from '@/components/modals/EditRestaurantModal';

// 패널별 최대 너비 설정
const PANEL_WIDTHS: Record<Exclude<OverlayPanelType, null>, string> = {
    feed: 'max-w-[560px]',     // 560px - 리뷰 피드 (리뷰 작성 패널과 동일한 크기)
    stamp: 'max-w-6xl',        // 1152px - 도장 그리드
    leaderboard: 'max-w-3xl',  // 768px - 랭킹

};

interface OverlayPagePanelProps {
    activePanel: OverlayPanelType;
    onClose: () => void;
    initialReviewId?: string | null;
}

/**
 * 오버레이 페이지 패널
 * - 헤더 없음 (각 콘텐츠에서 자체 헤더 관리)
 * - 피드 패널에서 리뷰 작성 시 나란히 표시
 * - 모바일에서는 Dialog로, 데스크탑에서는 inline으로 표시
 */
function OverlayPagePanelComponent({ activePanel, onClose, initialReviewId }: OverlayPagePanelProps) {
    const queryClient = useQueryClient();
    const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
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
                } else if (selectedRestaurant) {
                    setSelectedRestaurant(null);
                } else if (selectedUserId) {
                    setSelectedUserId(null);
                } else {
                    onClose();
                }
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [activePanel, onClose, isReviewPanelOpen, selectedRestaurant, selectedUserId]);

    // 패널 닫힐 때 리뷰 패널도 닫기
    useEffect(() => {
        if (!activePanel) {
            setIsReviewPanelOpen(false);
            setSelectedRestaurant(null);
            setSelectedUserId(null);
        }
    }, [activePanel]);

    // activePanel 변경 시 모든 선택 상태 초기화
    useEffect(() => {
        setSelectedRestaurant(null);
        setSelectedUserId(null);
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

    const handleOpenRestaurantDetail = useCallback((restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
    }, []);

    const handleCloseRestaurantDetail = useCallback(() => {
        setSelectedRestaurant(null);
    }, []);

    const handleOpenUserProfile = useCallback((userId: string) => {
        setSelectedUserId(userId);
    }, []);

    const handleCloseUserProfile = useCallback(() => {
        setSelectedUserId(null);
    }, []);

    const handleRequestEdit = useCallback((restaurant: Restaurant) => {
        setRestaurantToEdit(restaurant);
    }, []);

    if (!activePanel) return null;

    let maxWidth = PANEL_WIDTHS[activePanel];
    const showInlineReviewPanel = activePanel === 'feed' && isReviewPanelOpen && isDesktop;
    // [수정] leaderboard 탭 및 feed 탭에서도 맛집 상세 패널 표시 허용
    const showRestaurantDetail = (activePanel === 'stamp' || activePanel === 'leaderboard' || activePanel === 'feed') && selectedRestaurant && isDesktop;
    const showUserProfile = activePanel === 'leaderboard' && selectedUserId && isDesktop;

    // 사이드 패널이 열려있을 때 메인 패널 너비 조정 로직 제거 (사용자 요청: 크기 유지)
    // if (showRestaurantDetail) {
    //    maxWidth = 'max-w-4xl';
    // }
    // 랭킹 패널(max-w-3xl)은 사이드 패널이 열려도 너비 유지 (충분히 작음)

    return (
        <>
            {/* 배경 오버레이 - 하나만 */}
            <div
                className="fixed inset-0 z-[97] bg-black/40 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* 패널 컨테이너 - 나란히 배치 */}
            <div
                className={cn(
                    "fixed z-[98] flex gap-4",
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
                            initialReviewId={initialReviewId}
                            onOpenRestaurantDetail={handleOpenRestaurantDetail}
                        />
                    )}
                    {activePanel === 'stamp' && (
                        <StampContent
                            onClose={onClose}
                            onOpenRestaurantDetail={handleOpenRestaurantDetail}
                        />
                    )}
                    {activePanel === 'leaderboard' && (
                        <LeaderboardContent
                            onClose={onClose}
                            onOpenUserProfile={handleOpenUserProfile}
                        />
                    )}


                </div>

                {/* 리뷰 작성 패널 - 데스크탑에서만 inline 표시 */}
                {showInlineReviewPanel && (
                    <div
                        className={cn(
                            "bg-background shadow-2xl",
                            "flex flex-col overflow-hidden",
                            "w-[560px] max-w-[calc(100vw-700px)]",
                            "rounded-2xl border border-border"
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

                {/* 우측 사이드 패널 영역 - 사용자 프로필 */}
                {showUserProfile && (
                    <div className={cn(
                        "flex-shrink-0 bg-background transition-[width] duration-300 ease-in-out hidden xl:block",
                        "w-[400px]",
                        "rounded-2xl border border-border shadow-2xl overflow-hidden"
                    )}>
                        <UserProfilePanel
                            userId={selectedUserId!}
                            onClose={handleCloseUserProfile}
                            showBackButton={true}
                            onUserClick={handleOpenUserProfile}
                            onRestaurantClick={handleOpenRestaurantDetail}
                        />
                    </div>
                )}

                {/* 우측 사이드 패널 영역 - 맛집 상세 */}
                {showRestaurantDetail && (
                    <div className={cn(
                        "flex-shrink-0 bg-background transition-[width] duration-300 ease-in-out hidden xl:block",
                        "w-[400px]",
                        "rounded-2xl border border-border shadow-2xl overflow-hidden"
                    )}>
                        <RestaurantDetailPanel
                            restaurant={selectedRestaurant!}
                            onClose={handleCloseRestaurantDetail}
                            isPanelOpen={true}
                            className="border-none"
                            onWriteReview={handleOpenReviewPanel}
                            onRequestEditRestaurant={handleRequestEdit}
                        />
                    </div>
                )}
            </div>

            {/* 모바일/태블릿 또는 데스크탑 비-피드 모드에서는 Dialog로 표시 */}
            {(!isDesktop || (isDesktop && activePanel !== 'feed')) && isReviewPanelOpen && (
                <ReviewModal
                    isOpen={true}
                    onClose={handleCloseReviewPanel}
                    restaurant={selectedRestaurant || null}
                    onSuccess={handleReviewSuccess}
                />
            )}

            {restaurantToEdit && (
                <EditRestaurantModal
                    isOpen={true}
                    onClose={() => setRestaurantToEdit(null)}
                    restaurant={restaurantToEdit}
                    initialFormData={{
                        name: restaurantToEdit.name,
                        address: restaurantToEdit.road_address || restaurantToEdit.jibun_address || '',
                        phone: restaurantToEdit.phone || '',
                        category: Array.isArray(restaurantToEdit.categories) ? restaurantToEdit.categories as string[] : [],
                        youtube_reviews: [
                            {
                                youtube_link: restaurantToEdit.youtube_link || '',
                                tzuyang_review: restaurantToEdit.tzuyang_review || '',
                                restaurant_id: restaurantToEdit.id
                            }
                        ]
                    }}
                />
            )}
        </>
    );
}

const OverlayPagePanel = memo(OverlayPagePanelComponent);
OverlayPagePanel.displayName = 'OverlayPagePanel';

export default OverlayPagePanel;
