'use client';

import { memo } from 'react';
import { Eye, EyeOff, LocateFixed, Navigation, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDeviceType } from "@/hooks/useDeviceType";
import { useHydration } from "@/hooks/useHydration";
import { resolveDeviceLocationButtonLabel, type DeviceMapLocation } from '@/lib/device-location-map';
import type { HomeMapPanelSide } from "@/lib/home-map-user-preferences";

interface SubmissionFloatingButtonProps {
    onClick: () => void;
    isSidebarOpen: boolean;
    className?: string;
    onDeviceLocationClick?: () => void;
    deviceLocation?: DeviceMapLocation | null;
    isDeviceLocationPending?: boolean;
    isDeviceHeadingMode?: boolean;
    desktopPanelSide?: HomeMapPanelSide;
    isPanelCollapsed?: boolean;
    showUserSubmittedMarkers?: boolean;
    onUserSubmittedMarkersToggle?: () => void;
}

const DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS = "min(392px, calc(100vw - 32px))";

// [OPTIMIZATION] React.memo로 불필요한 리렌더링 방지
const SubmissionFloatingButton = memo(function SubmissionFloatingButton({
    onClick,
    isSidebarOpen,
    className,
    onDeviceLocationClick,
    deviceLocation = null,
    isDeviceLocationPending = false,
    isDeviceHeadingMode = false,
    desktopPanelSide = "left",
    isPanelCollapsed = false,
    showUserSubmittedMarkers = true,
    onUserSubmittedMarkersToggle,
}: SubmissionFloatingButtonProps) {
    const { isMobileOrTablet } = useDeviceType();
    const isHydrated = useHydration();
    void isSidebarOpen;
    const shouldOffsetForRightPanel =
        !isMobileOrTablet && desktopPanelSide === "right" && !isPanelCollapsed;
    const deviceLocationButtonLabel = resolveDeviceLocationButtonLabel({
        hasLocation: Boolean(deviceLocation),
        isHeadingMode: isDeviceHeadingMode,
        isPending: isDeviceLocationPending,
    });

    return (
        <div
            className={cn(
                "fixed z-50",
                // 모바일/태블릿: 우측 하단 (검색 버튼 위)
                // 검색 버튼: bottom-20(80px) + h-12(48px) = top at 128px
                // 제보 버튼: bottom-36(144px) -> 16px 간격
                // 데스크탑: 우측 하단 고정
                isMobileOrTablet ? "right-4 bottom-36" : "bottom-6",
                "flex flex-col gap-2",
                // Hydration 깜빡임 방지
                isHydrated ? "opacity-100" : "opacity-0",
                className
            )}
            style={
                isMobileOrTablet
                    ? undefined
                    : {
                        right: shouldOffsetForRightPanel
                            ? `calc(${DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS} + 1.5rem)`
                            : "1.5rem",
                    }
            }
            aria-label="지도 빠른 작업"
            data-layout-primitives="cluster wrap-row overlay-stack"
            data-scroll-owner="mobile-control-overlay"
        >
            <Button
                type="button"
                onClick={onUserSubmittedMarkersToggle}
                aria-pressed={showUserSubmittedMarkers}
                aria-label={showUserSubmittedMarkers ? "사용자 제보 맛집 마커 숨기기" : "사용자 제보 맛집 마커 보이기"}
                className={cn(
                    isMobileOrTablet ? "h-12 w-12" : "h-14 w-14",
                    "rounded-full shadow-xl",
                    "transition-colors duration-150 ease-out motion-reduce:transition-none",
                    "flex items-center justify-center",
                    "border-2",
                    showUserSubmittedMarkers
                        ? "bg-blue-600 hover:bg-blue-700 text-white border-white/70 ring-2 ring-blue-200/70"
                        : "bg-background hover:bg-secondary text-foreground border-border/70"
                )}
                title={showUserSubmittedMarkers ? "사용자 제보 맛집 마커 숨기기" : "사용자 제보 맛집 마커 보이기"}
                data-user-submitted-marker-toggle="true"
            >
                {showUserSubmittedMarkers ? (
                    <Eye className={isMobileOrTablet ? "h-5 w-5" : "h-6 w-6"} aria-hidden="true" />
                ) : (
                    <EyeOff className={isMobileOrTablet ? "h-5 w-5" : "h-6 w-6"} aria-hidden="true" />
                )}
            </Button>
            <Button
                type="button"
                onClick={onClick}
                aria-label="맛집 제보하기"
                className={cn(
                    // [Mobile] 돋보기 아이콘과 동일한 크기 (h-12 w-12)
                    isMobileOrTablet ? "h-12 w-12" : "h-14 w-14",
                    "rounded-full shadow-xl",
                    "bg-red-800 hover:bg-red-900 text-white",
                    "transition-[background-color,color,border-color,box-shadow,transform] duration-300 ease-in-out motion-reduce:transition-none",
                    "hover:scale-110 active:scale-95",
                    "flex items-center justify-center",
                    "border-2 border-border/20"
                )}
                title="맛집 제보하기"
            >
                <Send className={isMobileOrTablet ? "h-5 w-5" : "h-6 w-6"} aria-hidden="true" />
            </Button>

            {onDeviceLocationClick ? (
                <Button
                    type="button"
                    onClick={onDeviceLocationClick}
                    disabled={isDeviceLocationPending}
                    aria-label={deviceLocationButtonLabel}
                    className={cn(
                        isMobileOrTablet ? "h-12 w-12" : "h-14 w-14",
                        "rounded-full shadow-xl",
                        "transition-colors duration-150 ease-out motion-reduce:transition-none",
                        "flex items-center justify-center",
                        "border-2",
                        isDeviceHeadingMode
                            ? "bg-blue-600 hover:bg-blue-700 text-white border-white/70 ring-2 ring-blue-200/70"
                            : deviceLocation
                                ? "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                                : "bg-background hover:bg-secondary text-foreground border-border/70",
                        isDeviceLocationPending && "opacity-80"
                    )}
                    title={deviceLocationButtonLabel}
                >
                    {isDeviceHeadingMode ? (
                        <Navigation className={isMobileOrTablet ? "h-5 w-5" : "h-6 w-6"} aria-hidden="true" />
                    ) : (
                        <LocateFixed className={isMobileOrTablet ? "h-5 w-5" : "h-6 w-6"} aria-hidden="true" />
                    )}
                </Button>
            ) : null}
        </div>
    );
});

export default SubmissionFloatingButton;
