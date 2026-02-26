'use client';

import { useEffect, memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';

interface OverlayDetailPanelProps {
    isOpen: boolean;
    restaurant: Restaurant | null;
    onClose: () => void;
    onWriteReview?: () => void;
    onEditRestaurant?: () => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
}

/**
 * 오버레이 방식 맛집 상세 패널
 * - 우측에서 슬라이드 인
 * - 지도 위에 오버레이 (밀어내지 않음)
 * - 배경 클릭으로 닫기
 * - ESC 키로 닫기
 */
function OverlayDetailPanelComponent({
    isOpen,
    restaurant,
    onClose,
    onWriteReview,
    onEditRestaurant,
    onRequestEditRestaurant,
}: OverlayDetailPanelProps) {
    // ESC 키로 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!restaurant) return null;

    return (
        <>
            {/* 배경 오버레이 - 클릭 시 닫기 */}
            <div
                className={cn(
                    "fixed inset-0 z-[90] transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* 상세 패널 */}
            <div
                className={cn(
                    "fixed top-16 right-0 h-[calc(100vh-64px)] w-[min(400px,calc(100vw-1rem))] z-[95]",
                    "bg-background border-l border-border shadow-2xl",
                    "transform transition-transform duration-300 ease-out",
                    isOpen ? "translate-x-0" : "translate-x-full"
                )}
            >
                {/* 접기 버튼 - 패널 좌측 가장자리 */}
                <button
                    onClick={onClose}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title="패널 닫기"
                    aria-label="패널 닫기"
                >
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                </button>

                {/* 패널 콘텐츠 */}
                <RestaurantDetailPanel
                    restaurant={restaurant}
                    onClose={onClose}
                    onWriteReview={onWriteReview}
                    onEditRestaurant={onEditRestaurant}
                    onRequestEditRestaurant={onRequestEditRestaurant}
                    isPanelOpen={isOpen}
                />
            </div>
        </>
    );
}

const OverlayDetailPanel = memo(OverlayDetailPanelComponent);
OverlayDetailPanel.displayName = 'OverlayDetailPanel';

export default OverlayDetailPanel;
