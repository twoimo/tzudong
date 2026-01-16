'use client';

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useLayout } from "@/contexts/LayoutContext";
import { useDeviceType } from "@/hooks/useDeviceType";
import { toast } from "sonner";
import { Restaurant } from "@/types/restaurant";

import HomeModeToggle from "../components/home/home-mode-toggle";
import SubmissionFloatingButton from "../components/home/SubmissionFloatingButton";

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



const AdminReviewPanel = dynamic(
    () => import('@/components/admin/AdminReviewPanel'),
    { ssr: false }
);

const AnnouncementPanel = dynamic(
    () => import('@/components/announcement/AnnouncementPanel'),
    { ssr: false }
);

const ReviewModal = dynamic(
    () => import('@/components/reviews/ReviewModal').then(mod => ({ default: mod.ReviewModal })),
    { ssr: false }
);



import { Announcement, DUMMY_ANNOUNCEMENTS } from '@/types/announcement';

import RightPanelWrapper from '@/components/layout/RightPanelWrapper';
export default function HomeClient() {
    const { isAdmin, user } = useAuth();
    const { isSidebarOpen } = useLayout();
    const { isDesktop } = useDeviceType();
    const [mapMode, setMapMode] = useState<'domestic' | 'overseas'>('domestic');
    const [activePanel, setActivePanel] = useState<'map' | 'detail' | 'control'>('map');
    const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);

    // 통합 패널 상태 관리
    // 'detail'은 맛집 상세 패널(state.isPanelOpen으로 관리), 나머지는 activeRightPanel로 관리
    type PanelType = 'mypage' | 'adminReviews' | 'announcement' | null;
    const [activeRightPanel, setActiveRightPanel] = useState<PanelType>(null);
    const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
    const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

    // [리뷰 공유] 공유 링크로 접속 시 리뷰 하이라이트용 ID
    const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

    // [Fix] 마운트 시점 기록 - 라우트 변경 후 돌아왔을 때 지도 강제 리마운트
    const [mapMountKey] = useState(() => Date.now());

    // URL 쿼리 파라미터 처리
    const searchParams = useSearchParams();
    const router = useRouter();

    // 초기 로딩 화면 제거 (지도 로딩 완료 시그널)
    useEffect(() => {
        const timer = setTimeout(() => {
            window.dispatchEvent(new Event('mapLoadingComplete'));
        }, 200); // 최적화: 부드러운 전환

        return () => clearTimeout(timer);
    }, []);




    useEffect(() => {
        const panelParam = searchParams.get('panel');
        const announcementId = searchParams.get('announcementId');
        const restaurantId = searchParams.get('r') || searchParams.get('restaurant'); // 피드에서 restaurant 파라미터 사용
        const restaurantName = searchParams.get('q'); // 공유 URL에서 맛집 이름

        if (panelParam === 'announcement' && announcementId) {
            const announcement = DUMMY_ANNOUNCEMENTS.find(a => a.id === announcementId);
            if (announcement) {
                // 약간의 지연을 주어 초기 렌더링 후 패널이 열리도록 함
                setTimeout(() => {
                    setSelectedAnnouncement(announcement);
                    openPanel('announcement');

                    // URL 정리 (선택사항 - 새로고침 시 다시 열리지 않게 하려면)
                    router.replace('/', { scroll: false });
                }, 500);
            }
        }

        // 북마크에서 맛집 클릭 시 처리
        if (restaurantId) {
            // 맛집 조회하여 상세 패널 열기 (병합된 맛집 지원)
            (async () => {
                try {
                    const { supabase } = await import('@/integrations/supabase/client');
                    const { mergeRestaurants } = await import('@/hooks/use-restaurants');

                    // 먼저 해당 맛집 조회
                    const { data: targetRestaurant, error } = await supabase
                        .from('restaurants')
                        .select('*')
                        .eq('id', restaurantId)
                        .single();

                    if (error || !targetRestaurant) {
                        console.error('맛집 조회 실패:', error);
                        return;
                    }

                    // 동일 이름의 맛집들 조회 (병합을 위해)
                    const { data: sameNameRestaurants } = await supabase
                        .from('restaurants')
                        .select('*')
                        .eq('name', (targetRestaurant as any).name)
                        .eq('status', 'approved');

                    // 병합 로직 적용
                    const merged = mergeRestaurants((sameNameRestaurants || [targetRestaurant]) as any);
                    const mergedRestaurant = merged.find(r => r.id === restaurantId) || merged[0];

                    if (mergedRestaurant) {
                        setTimeout(() => {
                            openDetailPanel(mergedRestaurant);
                            // URL 정리
                            router.replace('/', { scroll: false });
                        }, 300);
                    }
                } catch (err) {
                    console.error('맛집 조회 실패:', err);
                }
            })();
        }

        // [공유 URL] lat/lng로 맛집 자동 선택 (z, lat, lng만 있는 경우)
        const urlLat = searchParams.get('lat');
        const urlLng = searchParams.get('lng');
        const urlZoom = searchParams.get('z');

        // 공유 URL 감지: lat, lng, z가 있고 다른 특수 파라미터(r, restaurant, review)가 없는 경우
        if (urlLat && urlLng && urlZoom && !restaurantId && !searchParams.get('review')) {
            const lat = parseFloat(urlLat);
            const lng = parseFloat(urlLng);

            if (!isNaN(lat) && !isNaN(lng)) {
                (async () => {
                    try {
                        const { supabase } = await import('@/integrations/supabase/client');
                        const { mergeRestaurants } = await import('@/hooks/use-restaurants');

                        // 좌표로 가장 가까운 맛집 검색 (약간의 오차 허용)
                        const tolerance = 0.0001; // 약 10m 오차
                        const { data: restaurants, error } = await supabase
                            .from('restaurants')
                            .select('*')
                            .gte('lat', lat - tolerance)
                            .lte('lat', lat + tolerance)
                            .gte('lng', lng - tolerance)
                            .lte('lng', lng + tolerance)
                            .eq('status', 'approved');

                        if (error || !restaurants || restaurants.length === 0) {
                            // 맛집을 찾지 못한 경우, 지도만 해당 위치로 이동 (이미 NaverMapView에서 처리됨)
                            return;
                        }

                        // 병합 로직 적용
                        const merged = mergeRestaurants(restaurants as any);
                        const restaurant = merged[0];

                        if (restaurant) {
                            setTimeout(() => {
                                openDetailPanel(restaurant);
                                // [URL 안정화] URL 유지
                            }, 500);
                        }
                    } catch (err) {
                        console.error('맛집 조회 실패:', err);
                    }
                })();
            }
        }

        // [리뷰 공유] 리뷰 공유 링크 처리 (/?review={reviewId})
        const reviewId = searchParams.get('review');
        if (reviewId) {
            if (isDesktop) {
                // 데스크탑: 피드 오버레이 열기 (selectedReviewId로 스크롤)
                setSelectedReviewId(reviewId);
                window.dispatchEvent(new CustomEvent('openFeedOverlay', { detail: { reviewId } }));
                // [URL 안정화] URL 유지 - router.replace 제거
            } else {
                // 모바일/태블릿: 피드 페이지로 리다이렉트
                router.replace(`/feed?review=${reviewId}`);
            }
        }
    }, [searchParams, router, isDesktop]);

    // 상태 관리 커스텀 훅
    const state = useHomeState(mapMode);

    // 패널 열기 (상호 배타적) - 마이페이지, 제보관리, 리뷰관리용
    // [OPTIMIZATION] useCallback으로 메모이제이션하여 불필요한 리렌더링 방지
    const openPanel = useCallback((panel: PanelType) => {
        // 맛집 상세 패널 닫기
        state.setIsPanelOpen(false);
        state.setPanelRestaurant(null);
        setActiveRightPanel(panel);
        setIsPanelCollapsed(false); // 새 패널 열릴 때 펼쳐진 상태로
    }, [state.setIsPanelOpen, state.setPanelRestaurant]);

    // 모든 패널 닫기
    // [OPTIMIZATION] useCallback으로 메모이제이션
    const closeAllPanels = useCallback(() => {
        state.setIsPanelOpen(false);
        state.setPanelRestaurant(null);
        setActiveRightPanel(null);
        setIsPanelCollapsed(false);
    }, [state.setIsPanelOpen, state.setPanelRestaurant]);

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
    // [OPTIMIZATION] useCallback으로 메모이제이션
    const openDetailPanel = useCallback((restaurant: Restaurant) => {
        // 먼저 다른 패널들 닫기
        setActiveRightPanel(null);
        setIsPanelCollapsed(false);
        // 그 다음 상세 패널 열기
        state.setPanelRestaurant(restaurant);
        state.setSelectedRestaurant(restaurant);

        // [Fix] 마커 클릭 시 검색 상태 초기화 (스티키 현상 방지)
        // searchedRestaurant가 남아있으면 네이버 지도의 효과 등으로 인해 다시 검색된 맛집으로 되돌아갈 수 있음
        state.setSearchedRestaurant(null);

        state.setIsPanelOpen(true);

        // [Fix] 마커 클릭 시 URL의 restaurant 파라미터 제거하여 스티키 현상 방지
        // 단, q 파라미터(공유 URL)는 유지하여 네이버 지도처럼 URL 안정적으로 유지
        const currentParams = new URLSearchParams(window.location.search);
        if (currentParams.has('r') || currentParams.has('restaurant')) {
            // r 또는 restaurant 파라미터가 있을 때만 replace 실행 (북마크에서 온 경우)
            router.replace('/', { scroll: false });
        }
        // q 파라미터(공유 URL)는 유지
    }, [state.setPanelRestaurant, state.setSelectedRestaurant, state.setSearchedRestaurant, state.setIsPanelOpen, router]);

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
            toast.error('맛집 제보는 로그인 후 이용 가능합니다');
            return;
        }
        setIsSubmissionModalOpen(true);
    }, [user]);

    // 헤더에서 패널 열기 이벤트 리스너
    useEffect(() => {
        const handleMyPageOpen = () => {
            // MyPage는 별도 라우트로 처리
            router.push('/mypage');
        };

        const handleAdminSubmissionsOpen = () => {
            if (isAdmin) {
                // 제보관리 패널 대신 관리자 데이터 검수 페이지로 이동
                router.push('/admin/evaluations?view=submissions');
            }
        };

        const handleAdminReviewsOpen = () => {
            if (isAdmin) {
                openPanel('adminReviews');
            }
        };

        const handleAdminAnnouncementsOpen = () => {
            // 공지사항은 모든 로그인 사용자가 볼 수 있음
            setSelectedAnnouncement(null); // 목록부터 시작
            openPanel('announcement');
        };

        const handleAnnouncementDetailOpen = (e: Event) => {
            const customEvent = e as CustomEvent<Announcement>;
            const announcement = customEvent.detail;

            // 이미 공지사항 패널이 열려있고, 동일한 공지사항을 클릭한 경우 토글 (접기/펼치기)
            if (activeRightPanel === 'announcement' && selectedAnnouncement?.id === announcement.id) {
                togglePanelCollapse();
            } else {
                // 다른 공지사항이거나 패널이 닫혀있는 경우 펼쳐서 열기
                setSelectedAnnouncement(announcement);
                openPanel('announcement');
            }
        };

        // 북마크에서 맛집 선택 시 처리 (홈페이지에서 깜빡임 방지)
        const handleSelectBookmarkRestaurant = async (e: Event) => {
            const customEvent = e as CustomEvent<string>;
            const restaurantId = customEvent.detail;

            try {
                const { supabase } = await import('@/integrations/supabase/client');
                const { mergeRestaurants } = await import('@/hooks/use-restaurants');

                const { data: targetRestaurant, error } = await supabase
                    .from('restaurants')
                    .select('*')
                    .eq('id', restaurantId)
                    .single();

                if (error || !targetRestaurant) return;

                const { data: sameNameRestaurants } = await supabase
                    .from('restaurants')
                    .select('*')
                    .eq('name', (targetRestaurant as any).name)
                    .eq('status', 'approved');

                const merged = mergeRestaurants((sameNameRestaurants || [targetRestaurant]) as any);
                const mergedRestaurant = merged.find(r => r.id === restaurantId) || merged[0];

                if (mergedRestaurant) {
                    openDetailPanel(mergedRestaurant);
                }
            } catch (err) {
                console.error('맛집 조회 실패:', err);
            }
        };

        window.addEventListener('openMyPage', handleMyPageOpen);
        window.addEventListener('openAdminSubmissions', handleAdminSubmissionsOpen);
        window.addEventListener('openAdminReviews', handleAdminReviewsOpen);
        window.addEventListener('openAdminAnnouncements', handleAdminAnnouncementsOpen);
        window.addEventListener('openAnnouncementDetail', handleAnnouncementDetailOpen);
        window.addEventListener('selectBookmarkRestaurant', handleSelectBookmarkRestaurant);

        return () => {
            window.removeEventListener('openMyPage', handleMyPageOpen);
            window.removeEventListener('openAdminSubmissions', handleAdminSubmissionsOpen);
            window.removeEventListener('openAdminReviews', handleAdminReviewsOpen);
            window.removeEventListener('openAdminAnnouncements', handleAdminAnnouncementsOpen);
            window.removeEventListener('openAnnouncementDetail', handleAnnouncementDetailOpen);
            window.removeEventListener('selectBookmarkRestaurant', handleSelectBookmarkRestaurant);
        };
    }, [isAdmin, activeRightPanel, selectedAnnouncement, openPanel, togglePanelCollapse, openDetailPanel, router]);

    return (
        <>
            {/* 맛집 제보 플로팅 버튼 - 데스크탑에서만 표시 */}
            {isDesktop && (
                <SubmissionFloatingButton
                    onClick={handleSubmissionButtonClick}
                    isSidebarOpen={isSidebarOpen}
                />
            )}
            <HomeModeToggle
                mode={mapMode}
                onModeChange={(mode) => {
                    state.setIsPanelOpen(false);
                    state.setPanelRestaurant(null);
                    state.setSelectedRestaurant(null);
                    state.setSearchedRestaurant(null);
                    setMapMode(mode);
                }}
                isAdmin={isAdmin}
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
                isAdmin={isAdmin}
                onModeChange={(mode) => {
                    state.setIsPanelOpen(false);
                    state.setPanelRestaurant(null);
                    state.setSelectedRestaurant(null);
                    state.setSearchedRestaurant(null);
                    setMapMode(mode);
                }}
                user={user}
                onSubmissionClick={handleSubmissionButtonClick}
            />

            <HomeMapContainer
                key={mapMountKey}
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

            {/* [OPTIMIZATION] 조건부 렌더링으로 불필요한 모달 마운트 방지 - TBT 개선 */}
            {state.isEditModalOpen && (
                <EditRestaurantModal
                    isOpen={state.isEditModalOpen}
                    onClose={() => {
                        state.setIsEditModalOpen(false);
                        state.setRestaurantToEdit(null);
                    }}
                    restaurant={state.restaurantToEdit}
                    initialFormData={state.editFormData}
                />
            )}

            {isAdmin && state.isAdminEditModalOpen && (
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

            {/* 리뷰 작성 모달 */}
            {state.isReviewModalOpen && (
                <ReviewModal
                    isOpen={state.isReviewModalOpen}
                    onClose={() => state.setIsReviewModalOpen(false)}
                    restaurant={state.panelRestaurant ? { id: state.panelRestaurant.id, name: state.panelRestaurant.name } : null}
                    onSuccess={() => {
                        state.setRefreshTrigger(prev => prev + 1);
                    }}
                />
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

            {/* 공지사항 패널 (관리자/사용자 통합) */}
            <RightPanelWrapper
                isOpen={activeRightPanel === 'announcement'}
                isCollapsed={isPanelCollapsed}
            >
                <AnnouncementPanel
                    isOpen={!isPanelCollapsed}
                    onClose={closeAllPanels}
                    onToggleCollapse={togglePanelCollapse}
                    isCollapsed={isPanelCollapsed}
                    isAdmin={isAdmin}
                    initialAnnouncement={selectedAnnouncement}
                />
            </RightPanelWrapper>


        </>
    );
}
