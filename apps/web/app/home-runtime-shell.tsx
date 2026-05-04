'use client';

import './home-app-globals.css';
import { Suspense, lazy, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppProviders } from './app-providers';
import { QueryProvider } from './providers';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { useAuth } from '@/contexts/AuthContext';
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { AUTH_UI_REQUEST_EVENT } from '@/lib/auth-ui-events';
import {
    APP_HEADER_HEIGHT_VAR,
    MOBILE_SHEET_HEADER_OFFSET_VAR,
    MOBILE_SHEET_HEADER_PROGRESS_VAR,
} from '@/lib/mobile-sheet-layout';

const OverlayLayout = lazy(() => import('@/components/layout/OverlayLayout'));
const AuthModal = lazy(() => import('@/components/auth/AuthModal'));
const ProfileModal = lazy(() => import('@/components/profile/ProfileModal').then((mod) => ({ default: mod.ProfileModal })));
const NicknameSetupModal = lazy(() => import('@/components/profile/NicknameSetupModal').then((mod) => ({ default: mod.NicknameSetupModal })));
const UserDataPrefetcher = lazy(() => import('@/components/layout/UserDataPrefetcher'));
const MobileBottomNav = lazy(() => import('@/components/layout/MobileBottomNav'));

function MobileHomeLayout({ children }: { children: ReactNode }) {
    const { user, needsNicknameSetup, completeNicknameSetup } = useAuth();
    const queryClient = useQueryClient();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

    const openAuth = useCallback(() => setIsAuthModalOpen(true), []);
    const openProfile = useCallback(() => setIsProfileModalOpen(true), []);

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty(MOBILE_SHEET_HEADER_PROGRESS_VAR, '0');
        root.style.setProperty(MOBILE_SHEET_HEADER_OFFSET_VAR, '0px');
        root.style.setProperty(APP_HEADER_HEIGHT_VAR, '0px');

        const openAuthListener = (event: Event) => {
            const detail = (event as CustomEvent<{ route?: string }> | undefined)?.detail;
            if (detail?.route && detail.route !== '/') return;
            openAuth();
        };

        const openProfileListener = (event: Event) => {
            const detail = (event as CustomEvent<{ route?: string }> | undefined)?.detail;
            if (detail?.route && detail.route !== '/') return;
            openProfile();
        };

        window.addEventListener(AUTH_UI_REQUEST_EVENT, openAuth);
        window.addEventListener('home:mobile-auth-request', openAuthListener);
        window.addEventListener('home:mobile-profile-request', openProfileListener);

        return () => {
            window.removeEventListener(AUTH_UI_REQUEST_EVENT, openAuth);
            window.removeEventListener('home:mobile-auth-request', openAuthListener);
            window.removeEventListener('home:mobile-profile-request', openProfileListener);
            root.style.setProperty(MOBILE_SHEET_HEADER_PROGRESS_VAR, '0');
            root.style.setProperty(MOBILE_SHEET_HEADER_OFFSET_VAR, '0px');
            root.style.setProperty(APP_HEADER_HEIGHT_VAR, '56px');
        };
    }, [openAuth, openProfile]);

    useEffect(() => {
        if (!user) {
            queryClient.removeQueries({ queryKey: ['user-bookmarks'] });
        }
    }, [queryClient, user]);

    return (
        <div className="flex overflow-hidden" style={{ height: 'var(--full-height, 100vh)' }}>
            {user && (
                <Suspense fallback={null}>
                    <UserDataPrefetcher />
                </Suspense>
            )}

            <div className="flex-1 flex flex-col overflow-hidden transition-[margin] duration-300">
                <a href="#main-content" className="skip-link">
                    본문 바로가기
                </a>
                <main id="main-content" className="flex-1 relative overflow-hidden">
                    <div className="h-full w-full">
                        {children}
                    </div>
                </main>
            </div>

            <div className={cn('min-[1600px]:hidden transition-transform duration-300')}>
                <Suspense fallback={null}>
                    <MobileBottomNav
                        className="transition-transform duration-300"
                        style={{
                            transform: 'translate3d(0, calc(var(--mobile-sheet-hide-bottom-nav, 0) * 120%), 0)',
                            willChange: 'transform',
                        }}
                    />
                </Suspense>
            </div>

            {isAuthModalOpen && (
                <Suspense fallback={null}>
                    <AuthModal
                        isOpen={isAuthModalOpen}
                        onClose={() => setIsAuthModalOpen(false)}
                    />
                </Suspense>
            )}

            {isProfileModalOpen && (
                <Suspense fallback={null}>
                    <ProfileModal
                        isOpen={isProfileModalOpen}
                        onClose={() => setIsProfileModalOpen(false)}
                    />
                </Suspense>
            )}

            {needsNicknameSetup && (
                <Suspense fallback={null}>
                    <NicknameSetupModal
                        isOpen={needsNicknameSetup}
                        onComplete={completeNicknameSetup}
                    />
                </Suspense>
            )}
        </div>
    );
}

function HomeLayoutContent({ children }: { children: ReactNode }) {
    const [hasMounted, setHasMounted] = useState(false);
    const { isDesktop } = useDeviceType();

    useEffect(() => {
        setHasMounted(true);
    }, []);

    if (!hasMounted) {
        return (
            <div className="min-h-[var(--full-height,100vh)] bg-background">
                <a href="#main-content" className="skip-link">
                    본문 바로가기
                </a>
                <main id="main-content" className="h-full w-full">
                    {children}
                </main>
            </div>
        );
    }

    if (isDesktop) {
        return (
            <Suspense fallback={<div className="h-full w-full">{children}</div>}>
                <OverlayLayout>{children}</OverlayLayout>
            </Suspense>
        );
    }

    return <MobileHomeLayout>{children}</MobileHomeLayout>;
}

export function HomeRuntimeShell({ children }: { children: ReactNode }) {
    return (
        <QueryProvider>
            <AppProviders>
                <LayoutProvider>
                    <HomeLayoutContent>{children}</HomeLayoutContent>
                </LayoutProvider>
            </AppProviders>
        </QueryProvider>
    );
}
