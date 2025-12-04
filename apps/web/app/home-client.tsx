'use client';

import { useState, useEffect, Suspense } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";
import { useLayout } from "@/contexts/LayoutContext";
import { toast } from "sonner";
import { Restaurant } from "@/types/restaurant";

import HomeModeToggle from "../components/home/home-mode-toggle";
import SubmissionFloatingButton from "../components/home/SubmissionFloatingButton";

// 동적 임포트 - 큰 컴포넌트는 필요할 때만 로드
const HomeControlPanel = dynamic(
    () => import('../components/home/home-control-panel'),
    { ssr: false }
);

const HomeMapContainer = dynamic(
    () => import('../components/home/home-map-container'),
    { ssr: false }
);
import { useHomeState } from "./hooks/useHomeState";
import { useHomeHandlers } from "./hooks/useHomeHandlers";
import { useRestaurantPopupListener } from "./hooks/useRestaurantPopupListener";

// 동적 임포트 - 모달은 필요할 때만 로드
const AdminRestaurantModal = dynamic(
    () => import('@/components/admin/AdminRestaurantModal').then(mod => ({ default: mod.AdminRestaurantModal })),
    { ssr: false }
);

const EditRestaurantModal = dynamic(
    () => import('@/components/modals/EditRestaurantModal').then(mod => ({ default: mod.EditRestaurantModal })),
    { ssr: false }
);

const RestaurantSubmissionModal = dynamic(
    () => import('@/components/modals/RestaurantSubmissionModal'),
    { ssr: false }
);

const MyPagePanel = dynamic(
    () => import('@/components/profile/MyPagePanel'),
    { ssr: false }
);

const AdminSubmissionPanel = dynamic(
    () => import('@/components/admin/AdminSubmissionPanel'),
    { ssr: false }
);

const AdminReviewPanel = dynamic(
    () => import('@/components/admin/AdminReviewPanel'),
    { ssr: false }
);

import RightPanelWrapper from '@/components/layout/RightPanelWrapper';

export default function HomeClient() {
    const { isAdmin, user } = useAuth();
    const { isSidebarOpen } = useLayout();
    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');
    const [activePanel, setActivePanel] = useState<'map' | 'detail' | 'control'>('map');
    const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);

    // 통합 패널 상태 관리
    // 'detail'은 맛집 상세 패널(state.isPanelOpen으로 관리), 나머지는 activeRightPanel로 관리
    type PanelType = 'mypage' | 'adminSubmissions' | 'adminReviews' | null;
    const [activeRightPanel, setActiveRightPanel] = useState<PanelType>(null);
    const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

    // 상태 관리 커스텀 훅
    const state = useHomeState(mapMode);

    // 패널 열기 (상호 배타적) - 마이페이지, 제보관리, 리뷰관리용
    const openPanel = (panel: PanelType) => {
        // 맛집 상세 패널 닫기
        state.setIsPanelOpen(false);
        state.setPanelRestaurant(null);
        setActiveRightPanel(panel);
        setIsPanelCollapsed(false); // 새 패널 열릴 때 펼쳐진 상태로
    };

    // 모든 패널 닫기
    const closeAllPanels = () => {
        state.setIsPanelOpen(false);
        state.setPanelRestaurant(null);
        setActiveRightPanel(null);
        setIsPanelCollapsed(false);
    };

    // 패널 접기/펼치기
    const togglePanelCollapse = () => {
        setIsPanelCollapsed(prev => !prev);
    };

    // 맛집 상세 패널이 열릴 때 다른 패널 닫기
    useEffect(() => {
        if (state.isPanelOpen) {
            // 맛집 상세 패널이 열리면 다른 패널들 모두 닫기
            setActiveRightPanel(null);
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
        setSearchedRestaurant: state.setSearchedRestaurant,
        setSelectedCountry: state.setSelectedCountry,
        setIsPanelOpen: state.setIsPanelOpen,
        setPanelRestaurant: state.setPanelRestaurant,
        setSelectedRestaurant: state.setSelectedRestaurant,
        setMoveToRestaurant: state.setMoveToRestaurant,
    });

    // 맛집 상세 패널 열기 (다른 패널 닫기 포함)
    const openDetailPanel = (restaurant: Restaurant) => {
        // 먼저 다른 패널들 닫기
        setActiveRightPanel(null);
        setIsPanelCollapsed(false);
        // 그 다음 상세 패널 열기
        state.setPanelRestaurant(restaurant);
        state.setSelectedRestaurant(restaurant);
        // 주의: 마커 클릭 시에는 searchedRestaurant를 설정하지 않음
        // searchedRestaurant가 설정되면 setCenter/setZoom이 즉시 호출되어 화면 깜빡임 발생
        // 대신 selectedRestaurant 변경으로 애니메이션 있는 panTo가 호출됨
        state.setIsPanelOpen(true);
    };

    // 팝업 이벤트 리스너
    useRestaurantPopupListener({
        mapMode,
        moveToRestaurant: state.moveToRestaurant,
        setSelectedRegion: state.setSelectedRegion,
        setSelectedRestaurant: state.setSelectedRestaurant,
        setSearchedRestaurant: state.setSearchedRestaurant,
        openDetailPanel, // 팝업 클릭 시 상세 패널 열기
    });

    const onAdminEditRestaurant = isAdmin ? handlers.handleAdminEditRestaurant : undefined;

    const handleSubmissionButtonClick = () => {
        if (!user) {
            toast.error('맛집 제보는 로그인 후 이용 가능합니다');
            return;
        }
        setIsSubmissionModalOpen(true);
    };

    // 헤더에서 패널 열기 이벤트 리스너
    useEffect(() => {
        const handleMyPageOpen = () => {
            openPanel('mypage');
        };

        const handleAdminSubmissionsOpen = () => {
            if (isAdmin) {
                openPanel('adminSubmissions');
            }
        };

        const handleAdminReviewsOpen = () => {
            if (isAdmin) {
                openPanel('adminReviews');
            }
        };

        window.addEventListener('openMyPage', handleMyPageOpen);
        window.addEventListener('openAdminSubmissions', handleAdminSubmissionsOpen);
        window.addEventListener('openAdminReviews', handleAdminReviewsOpen);

        return () => {
            window.removeEventListener('openMyPage', handleMyPageOpen);
            window.removeEventListener('openAdminSubmissions', handleAdminSubmissionsOpen);
            window.removeEventListener('openAdminReviews', handleAdminReviewsOpen);
        };
    }, [isAdmin]);

    return (
        <>
            {/* 맛집 제보 플로팅 버튼 */}
            <SubmissionFloatingButton
                onClick={handleSubmissionButtonClick}
                isSidebarOpen={isSidebarOpen}
            />
            <HomeModeToggle
                mode={mapMode}
                onModeChange={(mode) => {
                    state.setIsPanelOpen(false);
                    state.setPanelRestaurant(null);
                    state.setSelectedRestaurant(null);
                    state.setSearchedRestaurant(null);
                    setMapMode(mode);
                }}
            />

            <HomeControlPanel
                mapMode={mapMode}
                selectedRegion={state.selectedRegion}
                selectedCountry={state.selectedCountry}
                selectedCategories={state.filters.categories}
                filters={state.filters}
                countryCounts={state.countryCounts}
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
            />

            <HomeMapContainer
                mapMode={mapMode}
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
                onRestaurantSelect={state.setSelectedRestaurant}
                onSwitchToSingleMap={handlers.switchToSingleMap}
                onMapReady={handlers.handleMapReady}
                onMarkerClick={openDetailPanel}
                onPanelClose={closeAllPanels}
                onReviewModalOpen={() => state.setIsReviewModalOpen(true)}
                onTogglePanelCollapse={togglePanelCollapse}
                activePanel={activePanel}
                onPanelClick={setActivePanel}
                externalPanelOpen={activeRightPanel === null}
                isPanelCollapsed={isPanelCollapsed}
            />

            <EditRestaurantModal
                isOpen={state.isEditModalOpen}
                onClose={() => {
                    state.setIsEditModalOpen(false);
                    state.setRestaurantToEdit(null);
                }}
                restaurant={state.restaurantToEdit}
                initialFormData={state.editFormData}
            />

            {isAdmin && (
                <AdminRestaurantModal
                    isOpen={state.isAdminEditModalOpen}
                    onClose={() => {
                        state.setIsAdminEditModalOpen(false);
                        state.setAdminRestaurantToEdit(null);
                    }}
                    restaurant={state.adminRestaurantToEdit}
                    onSuccess={(updatedRestaurant) => {
                        state.setRefreshTrigger(prev => prev + 1);
                        if (updatedRestaurant && state.selectedRestaurant?.id === updatedRestaurant.id) {
                            state.setSelectedRestaurant(updatedRestaurant);
                            state.setPanelRestaurant(updatedRestaurant);
                        }
                        state.setIsAdminEditModalOpen(false);
                        state.setAdminRestaurantToEdit(null);
                    }}
                />
            )}

            {/* 맛집 제보 모달 */}
            <RestaurantSubmissionModal
                isOpen={isSubmissionModalOpen}
                onClose={() => setIsSubmissionModalOpen(false)}
            />

            {/* 마이페이지 패널 */}
            <RightPanelWrapper
                isOpen={activeRightPanel === 'mypage'}
                isCollapsed={isPanelCollapsed}
            >
                <MyPagePanel
                    isOpen={!isPanelCollapsed}
                    onClose={closeAllPanels}
                    onToggleCollapse={togglePanelCollapse}
                    isCollapsed={isPanelCollapsed}
                />
            </RightPanelWrapper>

            {/* 관리자 제보관리 패널 */}
            {isAdmin && (
                <RightPanelWrapper
                    isOpen={activeRightPanel === 'adminSubmissions'}
                    isCollapsed={isPanelCollapsed}
                >
                    <AdminSubmissionPanel
                        isOpen={!isPanelCollapsed}
                        onClose={closeAllPanels}
                        onToggleCollapse={togglePanelCollapse}
                        isCollapsed={isPanelCollapsed}
                    />
                </RightPanelWrapper>
            )}

            {/* 관리자 리뷰관리 패널 */}
            {isAdmin && (
                <RightPanelWrapper
                    isOpen={activeRightPanel === 'adminReviews'}
                    isCollapsed={isPanelCollapsed}
                >
                    <AdminReviewPanel
                        isOpen={!isPanelCollapsed}
                        onClose={closeAllPanels}
                        onToggleCollapse={togglePanelCollapse}
                        isCollapsed={isPanelCollapsed}
                    />
                </RightPanelWrapper>
            )}
        </>
    );
}
