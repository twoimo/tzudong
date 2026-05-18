'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import FloatingNavButtons, { OverlayPanelType } from '@/components/layout/FloatingNavButtons';
import OverlayPagePanel from '@/components/layout/OverlayPagePanel';
import { useAuth } from '@/contexts/AuthContextBase';
import { Restaurant } from '@/types/restaurant';
import { Announcement } from '@/types/announcement';
import { AUTH_UI_REQUEST_EVENT } from '@/lib/auth-ui-events';

// 지연 로딩
const Header = dynamic(() => import('@/components/layout/Header'), {
    ssr: false,
    loading: () => <div className="h-12 border-b border-border bg-background md:h-14" aria-hidden="true" />,
});

const AuthModal = dynamic(() => import('@/components/auth/AuthModal'), {
    ssr: false,
});

const ProfileModal = dynamic(
    () => import('@/components/profile/ProfileModal').then((mod) => ({ default: mod.ProfileModal })),
    { ssr: false }
);

const NicknameSetupModal = dynamic(
    () => import('@/components/profile/NicknameSetupModal').then((mod) => ({ default: mod.NicknameSetupModal })),
    { ssr: false }
);

const AdminRestaurantModal = dynamic(
    () => import('@/components/admin/AdminRestaurantModal').then((mod) => ({ default: mod.AdminRestaurantModal })),
    { ssr: false }
);

const CombinedPopup = dynamic(() => import('@/components/layout/CombinedPopup'), {
    ssr: false,
});

const UserDataPrefetcher = dynamic(() => import('@/components/layout/UserDataPrefetcher'), {
    ssr: false,
});

const OVERLAY_NONCRITICAL_CHROME_DELAY_MS = 30000;
const OVERLAY_NONCRITICAL_CHROME_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
const DIRECT_OVERLAY_PANELS: Array<Exclude<OverlayPanelType, null>> = ['feed', 'stamp', 'leaderboard'];
const HOME_OVERLAY_PANEL_OPENED_EVENT = 'homeOverlayPanelOpened';

function getDirectOverlayPanel(panel: string | null): Exclude<OverlayPanelType, null> | null {
    if (panel && DIRECT_OVERLAY_PANELS.includes(panel as Exclude<OverlayPanelType, null>)) {
        return panel as Exclude<OverlayPanelType, null>;
    }

    return null;
}

function buildDirectOverlayHref(panel: Exclude<OverlayPanelType, null>, reviewId?: string | null) {
    const params = new URLSearchParams({ panel });
    if (panel === 'feed' && reviewId) {
        params.set('review', reviewId);
    }

    return `/?${params.toString()}`;
}

/**
 * 오버레이 기반 데스크탑 레이아웃
 * - 사이드바 완전 제거
 * - 지도: 항상 100% 너비
 * - 페이지 콘텐츠: 지도 위에 오버레이로 표시
 * - 네비게이션: 플로팅 버튼으로만 접근
 */
export default function OverlayLayout({ children }: { children: React.ReactNode }) {
    const { user, signOut, isAdmin, needsNicknameSetup, completeNicknameSetup, isLoading } = useAuth();
    const queryClient = useQueryClient();
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [targetReviewId, setTargetReviewId] = useState<string | null>(null);
    const [canMountNoncriticalChrome, setCanMountNoncriticalChrome] = useState(false);

    // 오버레이 패널 상태
    const [activeOverlayPanel, setActiveOverlayPanel] = useState<OverlayPanelType>(null);

    const prevPathnameRef = useRef(pathname);
    const panelParam = searchParams.get('panel');
    const reviewParam = searchParams.get('review');
    const directPanelParam = getDirectOverlayPanel(panelParam);
    const shouldSuppressNoncriticalChrome = pathname?.startsWith('/auth/') || directPanelParam !== null;


    useEffect(() => {
        if (!directPanelParam) {
            setActiveOverlayPanel(null);
            setTargetReviewId(null);
            return;
        }

        setActiveOverlayPanel(directPanelParam);
        window.dispatchEvent(new CustomEvent(HOME_OVERLAY_PANEL_OPENED_EVENT, { detail: { panel: directPanelParam } }));
        if (directPanelParam === 'feed') {
            setTargetReviewId(reviewParam);
        } else {
            setTargetReviewId(null);
        }
    }, [directPanelParam, reviewParam]);

    // 페이지 이동 시 식당 선택 초기화
    useEffect(() => {
        if (prevPathnameRef.current !== pathname) {
            setSelectedRestaurant(null);
            prevPathnameRef.current = pathname;
        }
    }, [pathname]);

    // 오버레이 닫고 맛집으로 이동하는 이벤트 리스너
    useEffect(() => {
        const handleCloseAndGoToRestaurant = (e: CustomEvent) => {
            const restaurantId = e.detail;
            setActiveOverlayPanel(null);
            router.push(`/?r=${restaurantId}`);
        };

        const handleCloseAndNavigate = (e: CustomEvent) => {
            const path = e.detail;
            setActiveOverlayPanel(null);
            router.push(path);
        };

        window.addEventListener('closeOverlayAndGoToRestaurant', handleCloseAndGoToRestaurant as EventListener);
        window.addEventListener('closeOverlayAndNavigate', handleCloseAndNavigate as EventListener);
        return () => {
            window.removeEventListener('closeOverlayAndGoToRestaurant', handleCloseAndGoToRestaurant as EventListener);
            window.removeEventListener('closeOverlayAndNavigate', handleCloseAndNavigate as EventListener);
        };
    }, [router]);

    // 로그아웃 핸들러
    const handleLogout = useCallback(async () => {
        try {
            await signOut();
            queryClient.clear();
            router.push('/');
        } catch {
            // Logout error ignored
        }
    }, [signOut, queryClient, router]);

    // 인증 모달 핸들러
    const handleOpenAuth = useCallback(() => setIsAuthModalOpen(true), []);
    const handleProfileClick = useCallback(() => setIsProfileModalOpen(true), []);


    useEffect(() => {
        window.addEventListener(AUTH_UI_REQUEST_EVENT, handleOpenAuth);
        return () => window.removeEventListener(AUTH_UI_REQUEST_EVENT, handleOpenAuth);
    }, [handleOpenAuth]);

    useEffect(() => {
        if (shouldSuppressNoncriticalChrome) {
            setCanMountNoncriticalChrome(false);
            return;
        }

        let timer = 0;
        const mountNoncriticalChrome = () => {
            window.clearTimeout(timer);
            setCanMountNoncriticalChrome(true);
        };

        timer = window.setTimeout(mountNoncriticalChrome, OVERLAY_NONCRITICAL_CHROME_DELAY_MS);
        for (const eventName of OVERLAY_NONCRITICAL_CHROME_EVENTS) {
            window.addEventListener(eventName, mountNoncriticalChrome, { once: true, passive: true });
        }

        return () => {
            window.clearTimeout(timer);
            for (const eventName of OVERLAY_NONCRITICAL_CHROME_EVENTS) {
                window.removeEventListener(eventName, mountNoncriticalChrome);
            }
        };
    }, [shouldSuppressNoncriticalChrome]);

    // 공지사항 클릭 핸들러
    const handleAnnouncementClick = useCallback((announcement: Announcement) => {
        if (pathname === '/') {
            window.dispatchEvent(new CustomEvent('openAnnouncementDetail', { detail: announcement }));
        } else {
            router.push(`/?panel=announcement&announcementId=${announcement.id}`);
        }
    }, [pathname, router]);

    // 오버레이 패널 변경 핸들러
    const handleOverlayPanelChange = useCallback((panel: OverlayPanelType) => {
        setActiveOverlayPanel(panel);
        setTargetReviewId(null);

        if (panel) {
            router.replace(buildDirectOverlayHref(panel), { scroll: false });
            return;
        }

        router.replace('/', { scroll: false });
    }, [router]);

    // 오버레이 패널 닫기 핸들러
    const handleCloseOverlayPanel = useCallback(() => {
        setActiveOverlayPanel(null);
        setTargetReviewId(null);
        if (directPanelParam) {
            router.replace('/', { scroll: false });
        }
    }, [directPanelParam, router]);

    // 리뷰 선택 핸들러 (Deep Link)
    const handleReviewSelect = useCallback((reviewId: string) => {
        setTargetReviewId(reviewId);
        router.replace(buildDirectOverlayHref('feed', reviewId), { scroll: false });
    }, [router]);


    // 관리자 모달 핸들러
    const handleAdminSuccess = (updatedRestaurant?: Restaurant) => {
        queryClient.invalidateQueries({ queryKey: ['restaurants'] });
        if (updatedRestaurant) {
            setSelectedRestaurant(updatedRestaurant);
        }
    };

    return (
        <div className="flex flex-col overflow-hidden" style={{ height: 'var(--full-height, 100vh)' }}>
            <a
                href="#tzudong-map-main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus:ring-2 focus:ring-primary"
            >
                지도 본문으로 건너뛰기
            </a>

            {/* Supabase 사용자 데이터 프리페처 */}
            {user && <UserDataPrefetcher />}

            {/* 헤더 - 사이드바 토글 버튼 숨김 */}
            <Header
                onToggleSidebar={() => { }}
                isLoggedIn={!!user}
                isAuthLoading={isLoading && !user}
                onOpenAuth={handleOpenAuth}
                onLogout={handleLogout}
                onProfileClick={handleProfileClick}
                isAdmin={isAdmin}
                onAnnouncementClick={handleAnnouncementClick}
                hideToggleSidebar={true}
            />

            {/* 메인 콘텐츠 - 지도 100% 너비 */}
            <main id="tzudong-map-main" className="flex-1 relative overflow-hidden" tabIndex={-1} aria-label="쯔동여지도 지도 본문">
                <div className="h-full w-full">
                    {children}
                </div>

                {/* 플로팅 네비게이션 버튼 - 좌측 하단 */}
                <FloatingNavButtons
                    activePanel={activeOverlayPanel}
                    onPanelChange={handleOverlayPanelChange}
                    onReviewSelect={handleReviewSelect}
                    className="bottom-8 left-8"
                />


                {/* 오버레이 페이지 패널 */}
                <OverlayPagePanel
                    activePanel={activeOverlayPanel}
                    onClose={handleCloseOverlayPanel}
                    initialReviewId={targetReviewId}
                    onOpenAuth={handleOpenAuth}
                />

            </main>

            {/* 모달들 */}
            {isAuthModalOpen && (
                <AuthModal
                    isOpen={isAuthModalOpen}
                    onClose={() => setIsAuthModalOpen(false)}
                />
            )}

            {isProfileModalOpen && (
                <ProfileModal
                    isOpen={isProfileModalOpen}
                    onClose={() => setIsProfileModalOpen(false)}
                />
            )}

            {isAdminModalOpen && (
                <AdminRestaurantModal
                    isOpen={isAdminModalOpen}
                    onClose={() => setIsAdminModalOpen(false)}
                    restaurant={selectedRestaurant}
                    onSuccess={handleAdminSuccess}
                />
            )}

            {needsNicknameSetup && (
                <NicknameSetupModal
                    isOpen={needsNicknameSetup}
                    onComplete={completeNicknameSetup}
                />
            )}

            {canMountNoncriticalChrome && !shouldSuppressNoncriticalChrome && <CombinedPopup />}
        </div>
    );
}
