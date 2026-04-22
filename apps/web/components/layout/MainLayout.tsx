'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import MobileBottomNav from '@/components/layout/MobileBottomNav';
import NavigationPrefetcher from '@/components/layout/NavigationPrefetcher';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from '@/contexts/LayoutContext';
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { Announcement } from '@/types/announcement';
import { APP_HEADER_HEIGHT_VAR, MOBILE_SHEET_HEADER_OFFSET_VAR, MOBILE_SHEET_HEADER_PROGRESS_VAR } from '@/lib/mobile-sheet-layout';

// [PERF] 모달과 비핵심 컴포넌트를 동적 임포트로 코드 스플리팅
// 이 컴포넌트들은 사용자 인터랙션 후에만 필요하므로 초기 번들에서 제외
const Header = dynamic(() => import('@/components/layout/Header'), {
    ssr: false,
    loading: () => <div className="h-12 border-b border-border bg-background md:h-14" aria-hidden="true" />,
});

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
    const { isDesktop } = useDeviceType();
    const [isCenteredLayout, setIsCenteredLayout] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);

    const prevPathnameRef = useRef(pathname);

    // 마이페이지 여부 확인
    const isMyPage = pathname?.startsWith('/mypage');
    const isMobileHomeHeaderHidden = pathname === '/' && !isDesktop;

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
    const setMobileHomeHeaderVars = useCallback((isHidden: boolean) => {
        const root = document.documentElement;
        if (isHidden) {
            root.style.setProperty(MOBILE_SHEET_HEADER_PROGRESS_VAR, '0');
            root.style.setProperty(MOBILE_SHEET_HEADER_OFFSET_VAR, '0px');
            root.style.setProperty(APP_HEADER_HEIGHT_VAR, '0px');
            return;
        }

        root.style.setProperty(MOBILE_SHEET_HEADER_PROGRESS_VAR, '0');
        root.style.setProperty(MOBILE_SHEET_HEADER_OFFSET_VAR, '0px');
        root.style.setProperty(APP_HEADER_HEIGHT_VAR, '56px');
    }, []);

    const handleAdminSuccess = (updatedRestaurant?: Restaurant) => {
        queryClient.invalidateQueries({ queryKey: ['restaurants'] });

        if (updatedRestaurant) {
            setSelectedRestaurant(updatedRestaurant);
        }
    };

    // 모바일 홈 전용 헤더-리스너 계약 기반 이벤트 처리
    const handleMobileAuthRequest = useCallback(() => {
        setIsAuthModalOpen(true);
    }, []);

    const handleMobileProfileRequest = useCallback(() => {
        setIsProfileModalOpen(true);
    }, []);

    useEffect(() => {
        setMobileHomeHeaderVars(isMobileHomeHeaderHidden);

        const openAuthListener = (event: Event) => {
            const detail = (event as CustomEvent<{ route?: string }> | undefined)?.detail;
            if (detail?.route && detail.route !== '/') return;
            handleMobileAuthRequest();
        };

        const openProfileListener = (event: Event) => {
            const detail = (event as CustomEvent<{ route?: string }> | undefined)?.detail;
            if (detail?.route && detail.route !== '/') return;
            handleMobileProfileRequest();
        };

        window.addEventListener('home:mobile-auth-request', openAuthListener);
        window.addEventListener('home:mobile-profile-request', openProfileListener);

        return () => {
            window.removeEventListener('home:mobile-auth-request', openAuthListener);
            window.removeEventListener('home:mobile-profile-request', openProfileListener);
            setMobileHomeHeaderVars(false);
        };
    }, [handleMobileAuthRequest, handleMobileProfileRequest, isMobileHomeHeaderHidden, setMobileHomeHeaderVars]);

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
                    'flex-1 flex flex-col overflow-hidden transition-[margin] duration-300',
                )}
                style={{
                    transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)',
                    paddingBottom: 'calc(var(--mobile-bottom-nav-height, 60px) * (1 - var(--mobile-sheet-hide-bottom-nav, 0)))',
                }}
            >
                <a href="#main-content" className="skip-link">
                    본문 바로가기
                </a>

                {!isMobileHomeHeaderHidden && (
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
                )}

                <main
                    id="main-content"
                    className={cn(
                        'flex-1 relative overflow-hidden transition-[margin] duration-300',
                        isCenteredLayout && shouldShowCenteredLayoutButton && 'flex items-center justify-center'
                    )}
                    style={{
                        marginTop: 'calc(-1 * var(--mobile-sheet-header-offset, 0px))',
                    }}
                >
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
                isDesktop && "hidden",
                'transition-[transform,opacity] duration-300'
            )}>
                <MobileBottomNav
                    className="transition-[transform,opacity] duration-300"
                    style={{
                        transform: 'translateY(calc(var(--mobile-sheet-hide-bottom-nav, 0) * 110%))',
                        opacity: 'calc(1 - var(--mobile-sheet-hide-bottom-nav, 0))',
                    }}
                />
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
