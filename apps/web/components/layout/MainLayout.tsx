'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import MobileBottomNav from '@/components/layout/MobileBottomNav';
import AuthModal from '@/components/auth/AuthModal';
import { ProfileModal } from '@/components/profile/ProfileModal';
import { NicknameSetupModal } from '@/components/profile/NicknameSetupModal';
import { AdminRestaurantModal } from '@/components/admin/AdminRestaurantModal';
import CombinedPopup from '@/components/layout/CombinedPopup';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from '@/contexts/LayoutContext';
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { Announcement } from '@/types/announcement';

// [OPTIMIZATION] Lazy load Supabase prefetcher to reduce initial bundle size
const UserDataPrefetcher = dynamic(() => import('@/components/layout/UserDataPrefetcher'), {
    ssr: false,
});

export function MainLayoutContent({ children }: { children: React.ReactNode }) {
    const { user, signOut, isAdmin, needsNicknameSetup, completeNicknameSetup, isLoading } = useAuth();
    const queryClient = useQueryClient();
    const pathname = usePathname();
    const router = useRouter();
    const { isSidebarOpen, setIsSidebarOpen } = useLayout();
    const { isMobileOrTablet, isDesktop } = useDeviceType();
    const [isCenteredLayout, setIsCenteredLayout] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const prevPathnameRef = useRef(pathname);

    // 마이페이지 여부 확인
    const isMyPage = pathname?.startsWith('/mypage');

    // 페이지 이동 감지
    useEffect(() => {
        if (prevPathnameRef.current !== pathname) {
            setSelectedRestaurant(null);
            prevPathnameRef.current = pathname;
        }
    }, [pathname]);

    const shouldShowCenteredLayoutButton = pathname !== '/' && !isMyPage;

    const handleLogout = useCallback(async () => {
        try {
            await signOut();
            queryClient.clear();
            router.push('/');
        } catch (error) {
            console.error('Logout error:', error);
        }
    }, [signOut, queryClient, router]);

    // 성능 최적화: 핸들러 메모이제이션
    const handleToggleSidebar = useCallback(() => setIsSidebarOpen(!isSidebarOpen), [isSidebarOpen]);
    const handleOpenAuth = useCallback(() => setIsAuthModalOpen(true), []);
    const handleProfileClick = useCallback(() => setIsProfileModalOpen(true), []);
    const handleToggleCenteredLayout = useCallback(() => setIsCenteredLayout(!isCenteredLayout), [isCenteredLayout]);
    const handleAnnouncementClick = useCallback((announcement: Announcement) => {
        if (pathname === '/') {
            window.dispatchEvent(new CustomEvent('openAnnouncementDetail', { detail: announcement }));
        } else {
            router.push(`/?panel=announcement&announcementId=${announcement.id}`);
        }
    }, [pathname, router]);

    const handleAdminSuccess = (updatedRestaurant?: Restaurant) => {
        queryClient.invalidateQueries({ queryKey: ['restaurants'] });
        setRefreshTrigger(prev => prev + 1);

        if (updatedRestaurant) {
            setSelectedRestaurant(updatedRestaurant);
        }
    };

    const handleAdminEditRestaurant = (restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
        setIsAdminModalOpen(true);
    };

    return (
        // h-screen 대신 CSS 변수(--full-height)로 모바일 브라우저 UI 고려
        // dvh/svh 지원 브라우저에서는 동적 뷰포트, 미지원은 JS fallback
        <div className="flex overflow-hidden" style={{ height: 'var(--full-height, 100vh)' }}>
            {/* [OPTIMIZATION] Load Supabase logic only when user is logged in */}
            {user && <UserDataPrefetcher />}

            {/* 사이드바 (데스크탑 1600px 이상에서만 표시) */}
            <div className={cn(
                // CSS 미디어 쿼리: 1599px 이하에서 숨김
                "max-[1599px]:hidden",
                // JS 기반 조건: isDesktop이 false면 숨김 (hydration 후)
                !isDesktop && "hidden"
            )}>
                <Sidebar isOpen={isSidebarOpen} isMyPageMode={isMyPage} />
            </div>

            <div
                className={cn(
                    "flex-1 flex flex-col overflow-hidden transition-[margin] duration-300",
                    // 데스크탑(1600px 이상)에서만 사이드바 마진 적용
                    "min-[1600px]:ml-16",
                    isSidebarOpen && "min-[1600px]:ml-64",
                    // 모바일/태블릿(1599px 이하)에서 하단 네비게이션 공간 확보
                    // CSS 변수로 동적 높이 반영 (60px + safe-area-inset-bottom)
                    "max-[1599px]:pb-[var(--mobile-bottom-nav-height)]"
                )}
                style={{ transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)' }}
            >
                <Header
                    onToggleSidebar={handleToggleSidebar}
                    isLoggedIn={!!user}
                    isAuthLoading={isLoading}
                    onOpenAuth={handleOpenAuth}
                    onLogout={handleLogout}
                    onProfileClick={handleProfileClick}
                    isCenteredLayout={isCenteredLayout}
                    onToggleCenteredLayout={shouldShowCenteredLayoutButton ? handleToggleCenteredLayout : undefined}
                    isAdmin={isAdmin}
                    onAnnouncementClick={handleAnnouncementClick}
                    hideToggleSidebar={isMobileOrTablet}
                />

                <main className={cn(
                    "flex-1 relative overflow-hidden",
                    isCenteredLayout && shouldShowCenteredLayoutButton && "flex items-center justify-center"
                )}>
                    <div className={cn(
                        "h-full w-full",
                        isCenteredLayout && shouldShowCenteredLayoutButton && "max-w-7xl mx-auto"
                    )}>
                        {children}
                    </div>
                </main>
            </div>

            {/* 모바일/태블릿용 하단 네비게이션바 (1599px 이하) */}
            <div className={cn(
                // CSS 미디어 쿼리: 1600px 이상에서 숨김 (데스크탑)
                "min-[1600px]:hidden",
                // JS 기반 조건: isDesktop이 true면 숨김 (hydration 후)
                isDesktop && "hidden"
            )}>
                <MobileBottomNav />
            </div>

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

import { LayoutProvider } from '@/contexts/LayoutContext';

export function MainLayout({ children }: { children: React.ReactNode }) {
    return (
        <LayoutProvider>
            <MainLayoutContent>{children}</MainLayoutContent>
        </LayoutProvider>
    );
}
