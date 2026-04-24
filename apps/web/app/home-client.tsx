'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { useLayout } from "@/contexts/LayoutContext";
import { useDeviceType } from "@/hooks/useDeviceType";
import { toast } from "@/lib/no-toast";
import { requestAuthUi } from "@/lib/auth-ui-events";
import { Restaurant } from "@/types/restaurant";

// [OPTIMIZATION] 동적 임포트
const HomeControlPanel = dynamic(
    () => import('../components/home/home-control-panel'),
    {
        ssr: false,
        // 사용자 피드백 반영: 스켈레톤 UI 제거 (로딩 중에는 표시하지 않음)
        loading: () => null
    }
);

const HomeMapContainer = dynamic(
    () => import('../components/home/home-map-container'),
    {
        ssr: false,
        loading: () => <div className="flex-1 bg-muted/50 animate-pulse" aria-hidden="true" />
    }
);
const HomeClientSidePanels = dynamic(
    () => import('./home-client-sidepanels'),
    { ssr: false }
);
const HomeClientEffects = dynamic(
    () => import('./home-client-effects'),
    { ssr: false }
);
import { useHomeState } from "./hooks/useHomeState";
import { useHomeHandlers } from "./hooks/useHomeHandlers";
import { useRestaurantPopupListener } from "./hooks/useRestaurantPopupListener";

import { Announcement } from '@/types/announcement';

export default function HomeClient() {
    const { isAdmin, user } = useAuth();
    const { isSidebarOpen } = useLayout();
    const { isDesktop, isMobileOrTablet } = useDeviceType();
    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');
    const [activePanel, setActivePanel] = useState<'map' | 'detail' | 'control'>('map');
    const [mapFocusZoom, setMapFocusZoom] = useState<number | null>(null); // [New] 지도 줌 레벨 제어
    const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);

    // 통합 패널 상태 관리
    // 'detail'은 맛집 상세 패널(state.isPanelOpen으로 관리), 나머지는 activeRightPanel로 관리
    type PanelType = 'mypage' | 'adminReviews' | 'announcement' | null;
    const [activeRightPanel, setActiveRightPanel] = useState<PanelType>(null);
    const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
    const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
    const [isAnnouncementSheetOpen, setIsAnnouncementSheetOpen] = useState(false);
    const [isMapFullscreen, setIsMapFullscreen] = useState(false);
    const openPanelRef = useRef<(panel: PanelType) => void>(() => {});
    const openDetailPanelRef = useRef<(restaurant: Restaurant, focusZoom?: number) => void>(() => {});

    // [Fix] 마운트 시점 기록 - 라우트 변경 후 돌아왔을 때 지도 강제 리마운트
    const [mapMountKey] = useState(() => Date.now());

    const state = useHomeState(mapMode);
    // Deep-link restaurant params are consumed after the parent-owned
    // selection contract opens the detail panel; using history avoids
    // triggering a home refresh/reset loop while preserving other params.
    const clearConsumedRestaurantParams = useCallback(() => {
        if (typeof window === 'undefined') return;

        const currentUrl = new URL(window.location.href);
        const hadRestaurantParam = currentUrl.searchParams.has('r') || currentUrl.searchParams.has('restaurant');
        if (!hadRestaurantParam) return;

        currentUrl.searchParams.delete('r');
        currentUrl.searchParams.delete('restaurant');
        currentUrl.searchParams.delete('z');

        const nextSearch = currentUrl.searchParams.toString();
        const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ''}${currentUrl.hash}`;
        window.history.replaceState(window.history.state, '', nextUrl);
    }, []);

    // 패널 열기 (상호 배타적) - 마이페이지, 제보관리, 리뷰관리용
    // [OPTIMIZATION] useCallback으로 메모이제이션하여 불필요한 리렌더링 방지
    const openPanel = useCallback((panel: PanelType) => {
        setIsMapFullscreen(false);
        // 맛집 상세 패널 닫기
        state.clearRestaurantDetailSelection();
        if (panel === 'announcement' && isMobileOrTablet) {
            setActiveRightPanel(null);
            setIsAnnouncementSheetOpen(true);
            setIsPanelCollapsed(false);
            return;
        }

        setIsAnnouncementSheetOpen(false);
        setActiveRightPanel(panel);
        setIsPanelCollapsed(false); // 새 패널 열릴 때 펼쳐진 상태로
    }, [isMobileOrTablet, state]);
    useEffect(() => {
        openPanelRef.current = openPanel;
    }, [openPanel]);

    // 모든 패널 닫기
    // [OPTIMIZATION] useCallback으로 메모이제이션
    const closeAllPanels = useCallback(() => {
        setIsMapFullscreen(false);
        state.clearRestaurantDetailSelection();
        setActiveRightPanel(null);
        setIsAnnouncementSheetOpen(false);
        setIsPanelCollapsed(false);
    }, [state]);

    // 패널 접기/펼치기
    // [OPTIMIZATION] useCallback으로 메모이제이션
    const togglePanelCollapse = useCallback(() => {
        setIsPanelCollapsed(prev => !prev);
    }, []);

    // 맛집 상세 패널이 열릴 때 다른 패널 닫기
    useEffect(() => {
        if (state.isPanelOpen) {
            // 맛집 상세 패널이 열리면 다른 패널들 모두 닫기
            setActiveRightPanel(null);
            setIsAnnouncementSheetOpen(false);
            setIsPanelCollapsed(false);
        }
    }, [state.isPanelOpen]);

    // 우측 패널 너비 계산 (접힌 상태면 0)
    const rightPanelWidth = (state.isPanelOpen || activeRightPanel) && !isPanelCollapsed ? 400 : 0;

    // 레이아웃 치수 계산
    const leftSidebarWidth = isSidebarOpen ? 256 : 64;

    // 이벤트 핸들러 커스텀 훅
    const handlers = useHomeHandlers({
        setFilters: state.setFilters,
        setSelectedCategories: state.setSelectedCategories,
        setAdminRestaurantToEdit: state.setAdminRestaurantToEdit,
        setIsAdminEditModalOpen: state.setIsAdminEditModalOpen,
        setRestaurantToEdit: state.setRestaurantToEdit,
        setEditFormData: state.setEditFormData,
        setIsEditModalOpen: state.setIsEditModalOpen,
        setSelectedRegion: state.setSelectedRegion,
        setSelectedCountry: state.setSelectedCountry,
        setMoveToRestaurant: state.setMoveToRestaurant,
        syncRestaurantDetailSelection: state.syncRestaurantDetailSelection,
        openRestaurantDetailSelection: state.openRestaurantDetailSelection,
        clearRestaurantDetailSelection: state.clearRestaurantDetailSelection,
    });

    // 맛집 상세 패널 열기 (다른 패널 닫기 포함)
    // [OPTIMIZATION] useCallback으로 메모이제이션
    const openDetailPanel = useCallback((restaurant: Restaurant, focusZoom?: number) => {
        setIsMapFullscreen(false);
        // 먼저 다른 패널들 닫기
        setActiveRightPanel(null);
        setIsPanelCollapsed(false);
        // 그 다음 상세 패널 열기
        state.openRestaurantDetailSelection(restaurant);

        // [Fix] 줌 레벨 설정 (북마크 등에서 요청 시)
        if (focusZoom) {
            setMapFocusZoom(focusZoom);
        } else {
            setMapFocusZoom(null); // 일반 선택 시에는 줌 레벨 강제하지 않음
        }

        // [Fix] 마커 클릭 시 URL의 restaurant 파라미터 제거하여 스티키 현상 방지
        clearConsumedRestaurantParams();
    }, [clearConsumedRestaurantParams, state]);
    useEffect(() => {
        openDetailPanelRef.current = openDetailPanel;
    }, [openDetailPanel]);

    const handleRestaurantSelectionSync = useCallback((restaurant: Restaurant | null) => {
        if (!restaurant) {
            setIsMapFullscreen(false);
            state.clearRestaurantDetailSelection();
            return;
        }

        setIsMapFullscreen(false);
        state.openRestaurantDetailSelection(restaurant);
    }, [state]);

    // 팝업 이벤트 리스너
    useRestaurantPopupListener({
        mapMode,
        moveToRestaurant: state.moveToRestaurant,
        setSelectedRegion: state.setSelectedRegion,
        setSelectedRestaurant: state.setSelectedRestaurant,
        setSearchedRestaurant: state.setSearchedRestaurant,
        openDetailPanel, // 팝업 클릭 시 상세 패널 열기
    });

    // [OPTIMIZATION] useMemo로 메모이제이션
    const onAdminEditRestaurant = useMemo(() =>
        isAdmin ? handlers.handleAdminEditRestaurant : undefined
        , [isAdmin, handlers.handleAdminEditRestaurant]);

    // [OPTIMIZATION] useCallback으로 메모이제이션
    const handleSubmissionButtonClick = useCallback(() => {
        if (!user) {
            toast.info('로그인하면 맛집 제보를 바로 이어서 할 수 있어요');
            requestAuthUi({ source: 'home-submission-button', route: '/', reason: 'submit-restaurant' });
            return;
        }
        setIsSubmissionModalOpen(true);
    }, [user]);

    const handleTopShellUserIconClick = useCallback(() => {
        if (typeof window === 'undefined') return;

        if (!user) {
            requestAuthUi({ source: 'mobile-top-shell', route: '/', reason: 'open-profile' });
            return;
        }

        window.dispatchEvent(new CustomEvent('home:mobile-profile-request', {
            detail: {
                source: 'mobile-top-shell',
                route: '/',
                userId: user.id,
                ts: Date.now(),
            },
        }));
    }, [user]);

    return (
        <>
            <HomeClientEffects
                activeRightPanel={activeRightPanel}
                isAdmin={isAdmin}
                isLoggedIn={!!user}
                isMobileOrTablet={isMobileOrTablet}
                mapMode={mapMode}
                openDetailPanelRef={openDetailPanelRef}
                openPanelRef={openPanelRef}
                selectedAnnouncement={selectedAnnouncement}
                setMapMode={setMapMode}
                setSelectedAnnouncement={setSelectedAnnouncement}
                state={state}
                togglePanelCollapse={togglePanelCollapse}
            />

            {!(isMobileOrTablet && isMapFullscreen) && (
                <HomeControlPanel
                    mapMode={mapMode}
                    selectedRegion={state.selectedRegion}
                    selectedCountry={state.selectedCountry}
                    selectedCategories={state.filters.categories}
                    filters={state.filters}
                    onRegionChange={handlers.handleRegionChange}
                    onCountryChange={handlers.handleCountryChange}
                    onCategoryChange={handlers.handleCategoryChange}
                    onRestaurantSelect={handlers.handleRestaurantSelect}
                    onRestaurantSearch={handlers.handleRestaurantSearch}
                    onSearchExecute={handlers.switchToSingleMap}
                    activePanel={activePanel}
                    onPanelClick={setActivePanel}
                    leftSidebarWidth={leftSidebarWidth}
                    rightPanelWidth={rightPanelWidth}
                    isAdmin={isAdmin}
                    onModeChange={(mode) => {
                        setIsMapFullscreen(false);
                        state.clearRestaurantDetailSelection();
                        setMapMode(mode);
                    }}
                    user={user}
                    onSubmissionClick={handleSubmissionButtonClick}
                    onTopShellUserIconClick={handleTopShellUserIconClick}
                />
            )}

            <HomeMapContainer
                key={mapMountKey}
                mapMode={mapMode}
                mapFocusZoom={mapFocusZoom} // [New] 줌 레벨 전달
                filters={state.filters}
                selectedRegion={state.selectedRegion}
                selectedCountry={state.selectedCountry}
                searchedRestaurant={state.searchedRestaurant}
                selectedRestaurant={state.selectedRestaurant}
                refreshTrigger={state.refreshTrigger}
                panelRestaurant={state.panelRestaurant}
                isPanelOpen={state.isPanelOpen && !isPanelCollapsed}
                onAdminEditRestaurant={onAdminEditRestaurant}
                onRequestEditRestaurant={handlers.handleRequestEditRestaurant}
                onRestaurantSelect={handleRestaurantSelectionSync}
                onReleaseSearchSelectionOwnership={state.releaseSearchSelectionOwnership}

                onMapReady={handlers.handleMapReady}
                onMarkerClick={openDetailPanel}
                onPanelClose={closeAllPanels}
                onReviewModalOpen={() => state.setIsReviewModalOpen(true)}
                onTogglePanelCollapse={togglePanelCollapse}
                activePanel={activePanel}
                onPanelClick={setActivePanel}
                externalPanelOpen={activeRightPanel === null}
                isPanelCollapsed={isPanelCollapsed}
                isMapFullscreen={isMapFullscreen}
                onMapFullscreenChange={setIsMapFullscreen}
            />

            <HomeClientSidePanels
                activeRightPanel={activeRightPanel}
                closeAllPanels={closeAllPanels}
                isAdmin={isAdmin}
                isAnnouncementSheetOpen={isAnnouncementSheetOpen}
                isDesktop={isDesktop}
                isMobileOrTablet={isMobileOrTablet}
                isPanelCollapsed={isPanelCollapsed}
                isSidebarOpen={isSidebarOpen}
                isSubmissionModalOpen={isSubmissionModalOpen}
                onSubmissionButtonClick={handleSubmissionButtonClick}
                selectedAnnouncement={selectedAnnouncement}
                setIsAnnouncementSheetOpen={setIsAnnouncementSheetOpen}
                setIsSubmissionModalOpen={setIsSubmissionModalOpen}
                setSelectedAnnouncement={setSelectedAnnouncement}
                state={state}
                togglePanelCollapse={togglePanelCollapse}
            />
        </>
    );
}
