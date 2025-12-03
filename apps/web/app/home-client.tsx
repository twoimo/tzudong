'use client';

import { useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/contexts/AuthContext";

import HomeModeToggle from "../components/home/home-mode-toggle";

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

export default function HomeClient() {
    const { isAdmin } = useAuth();
    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');
    const [activePanel, setActivePanel] = useState<'map' | 'detail' | 'control'>('map');

    // 상태 관리 커스텀 훅
    const state = useHomeState(mapMode);

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
        setGridSelectedRestaurants: state.setGridSelectedRestaurants,
        setIsGridMode: state.setIsGridMode,
        setMoveToRestaurant: state.setMoveToRestaurant,
    });

    // 팝업 이벤트 리스너
    useRestaurantPopupListener({
        mapMode,
        moveToRestaurant: state.moveToRestaurant,
        setSelectedRegion: state.setSelectedRegion,
        setSelectedRestaurant: state.setSelectedRestaurant,
        setSearchedRestaurant: state.setSearchedRestaurant,
    });

    const onAdminEditRestaurant = isAdmin ? handlers.handleAdminEditRestaurant : undefined;

    return (
        <>
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
                isGridMode={state.isGridMode}
                onRegionChange={handlers.handleRegionChange}
                onCountryChange={handlers.handleCountryChange}
                onCategoryChange={handlers.handleCategoryChange}
                onRestaurantSelect={handlers.handleRestaurantSelect}
                onRestaurantSearch={handlers.handleRestaurantSearch}
                onSearchExecute={handlers.switchToSingleMap}
                onGridModeToggle={() => state.setIsGridMode(!state.isGridMode)}
                activePanel={activePanel}
                onPanelClick={setActivePanel}
            />

            <HomeMapContainer
                mapMode={mapMode}
                isGridMode={state.isGridMode}
                gridRegions={state.gridRegions}
                gridSelectedRestaurants={state.gridSelectedRestaurants}
                filters={state.filters}
                selectedRegion={state.selectedRegion}
                selectedCountry={state.selectedCountry}
                searchedRestaurant={state.searchedRestaurant}
                selectedRestaurant={state.selectedRestaurant}
                refreshTrigger={state.refreshTrigger}
                panelRestaurant={state.panelRestaurant}
                isPanelOpen={state.isPanelOpen}
                onAdminEditRestaurant={onAdminEditRestaurant}
                onRequestEditRestaurant={handlers.handleRequestEditRestaurant}
                onRestaurantSelect={state.setSelectedRestaurant}
                onGridRestaurantSelect={handlers.handleGridRestaurantSelect}
                onGridRestaurantClose={handlers.handleGridRestaurantClose}
                onSwitchToSingleMap={handlers.switchToSingleMap}
                onMapReady={handlers.handleMapReady}
                onMarkerClick={handlers.handleMarkerClick}
                onPanelClose={handlers.handlePanelClose}
                onReviewModalOpen={() => state.setIsReviewModalOpen(true)}
                onTogglePanelCollapse={handlers.handlePanelClose}
                activePanel={activePanel}
                onPanelClick={setActivePanel}
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
        </>
    );
}
