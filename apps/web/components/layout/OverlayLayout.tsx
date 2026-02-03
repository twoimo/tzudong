'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Header from '@/components/layout/Header';
import FloatingNavButtons, { OverlayPanelType } from '@/components/layout/FloatingNavButtons';
import OverlayPagePanel from '@/components/layout/OverlayPagePanel';
import AuthModal from '@/components/auth/AuthModal';
import { ProfileModal } from '@/components/profile/ProfileModal';
import { NicknameSetupModal } from '@/components/profile/NicknameSetupModal';
import { AdminRestaurantModal } from '@/components/admin/AdminRestaurantModal';
import CombinedPopup from '@/components/layout/CombinedPopup';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { Announcement } from '@/types/announcement';

// 지연 로딩
const UserDataPrefetcher = dynamic(() => import('@/components/layout/UserDataPrefetcher'), {
    ssr: false,
});

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

    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [targetReviewId, setTargetReviewId] = useState<string | null>(null);


    // 오버레이 패널 상태
    const [activeOverlayPanel, setActiveOverlayPanel] = useState<OverlayPanelType>(null);

    const prevPathnameRef = useRef(pathname);

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
        } catch (error) {
            // Logout error ignored
        }
    }, [signOut, queryClient, router]);

    // 인증 모달 핸들러
    const handleOpenAuth = useCallback(() => setIsAuthModalOpen(true), []);
    const handleProfileClick = useCallback(() => setIsProfileModalOpen(true), []);

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
    }, []);

    // 오버레이 패널 닫기 핸들러
    const handleCloseOverlayPanel = useCallback(() => {
        setActiveOverlayPanel(null);
        setTargetReviewId(null);
    }, []);

    // 리뷰 선택 핸들러 (Deep Link)
    const handleReviewSelect = useCallback((reviewId: string) => {
        setTargetReviewId(reviewId);
    }, []);


    // 관리자 모달 핸들러
    const handleAdminSuccess = (updatedRestaurant?: Restaurant) => {
        queryClient.invalidateQueries({ queryKey: ['restaurants'] });
        setRefreshTrigger(prev => prev + 1);
        if (updatedRestaurant) {
            setSelectedRestaurant(updatedRestaurant);
        }
    };

    return (
        <div className="flex flex-col overflow-hidden" style={{ height: 'var(--full-height, 100vh)' }}>
            {/* Supabase 사용자 데이터 프리페처 */}
            {user && <UserDataPrefetcher />}

            {/* 헤더 - 사이드바 토글 버튼 숨김 */}
            <Header
                onToggleSidebar={() => { }}
                isLoggedIn={!!user}
                isAuthLoading={isLoading}
                onOpenAuth={handleOpenAuth}
                onLogout={handleLogout}
                onProfileClick={handleProfileClick}
                isAdmin={isAdmin}
                onAnnouncementClick={handleAnnouncementClick}
                hideToggleSidebar={true}
            />

            {/* 메인 콘텐츠 - 지도 100% 너비 */}
            <main className="flex-1 relative overflow-hidden">
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
                />

            </main>

            {/* 모달들 */}
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />

            <ProfileModal
                isOpen={isProfileModalOpen}
                onClose={() => setIsProfileModalOpen(false)}
            />

            <AdminRestaurantModal
                isOpen={isAdminModalOpen}
                onClose={() => setIsAdminModalOpen(false)}
                restaurant={selectedRestaurant}
                onSuccess={handleAdminSuccess}
            />

            <NicknameSetupModal
                isOpen={needsNicknameSetup}
                onComplete={completeNicknameSetup}
            />

            <CombinedPopup />
        </div>
    );
}
