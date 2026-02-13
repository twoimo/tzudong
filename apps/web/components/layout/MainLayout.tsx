'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Header from '@/components/layout/Header';
import MobileBottomNav from '@/components/layout/MobileBottomNav';
import NavigationPrefetcher from '@/components/layout/NavigationPrefetcher';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from '@/contexts/LayoutContext';
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { Announcement } from '@/types/announcement';

// [PERF] 모달과 비핵심 컴포넌트를 동적 임포트로 코드 스플리팅
// 이 컴포넌트들은 사용자 인터랙션 후에만 필요하므로 초기 번들에서 제외
const AuthModal = dynamic(() => import('@/components/auth/AuthModal'), { ssr: false });
const ProfileModal = dynamic(
    () => import('@/components/profile/ProfileModal').then(mod => ({ default: mod.ProfileModal })),
    { ssr: false }
);
const NicknameSetupModal = dynamic(
    () => import('@/components/profile/NicknameSetupModal').then(mod => ({ default: mod.NicknameSetupModal })),
    { ssr: false }
);
const AdminRestaurantModal = dynamic(
    () => import('@/components/admin/AdminRestaurantModal').then(mod => ({ default: mod.AdminRestaurantModal })),
    { ssr: false }
);
const CombinedPopup = dynamic(() => import('@/components/layout/CombinedPopup'), { ssr: false });

// [PERF] Lazy load components
const UserDataPrefetcher = dynamic(() => import('@/components/layout/UserDataPrefetcher'), {
    ssr: false,
});

// [PERF] 오버레이 레이아웃 지연 로딩
const OverlayLayout = dynamic(() => import('@/components/layout/OverlayLayout'), {
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

    // [NEW] 홈페이지 여부 확인 (오버레이 레이아웃 적용 대상)
    const isHomePage = pathname === '/';

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
    const handleToggleSidebar = useCallback(() => setIsSidebarOpen(!isSidebarOpen), [isSidebarOpen, setIsSidebarOpen]);
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

    // [NEW] 데스크탑에서는 항상 오버레이 레이아웃 사용 (사이드바 완전 제거)
    if (isDesktop) {
        return (
            <>
                <NavigationPrefetcher />
                <OverlayLayout>{children}</OverlayLayout>
            </>
        );
    }

    // 모바일/태블릿 레이아웃

    return (
        // h-screen 대신 CSS 변수(--full-height)로 모바일 브라우저 UI 고려
        // dvh/svh 지원 브라우저에서는 동적 뷰포트, 미지원은 JS fallback
        <div className="flex overflow-hidden" style={{ height: 'var(--full-height, 100vh)' }}>
            <NavigationPrefetcher />

            {/* [OPTIMIZATION] Load Supabase logic only when user is logged in */}
            {user && <UserDataPrefetcher />}

            {/* 사이드바 제거됨 */}

            <div
                className={cn(
                    "flex-1 flex flex-col overflow-hidden transition-[margin] duration-300",
                    // 모바일/태블릿(1599px 이하)에서 하단 네비게이션 공간 확보
                    "pb-[var(--mobile-bottom-nav-height)] md:pb-0"
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
                    hideToggleSidebar={true}
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

            {/* [PERF] 조건부 렌더링 - 모달이 닫혀있을 때 DOM 마운트 방지 (TBT 개선) */}
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
