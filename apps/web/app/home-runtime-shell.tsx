'use client';

import './home-app-globals.css';
import { Suspense, lazy, type ComponentType, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryProvider } from './providers';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { AnonymousHomeAuthProvider, useAuth } from '@/contexts/AuthContextBase';
import { StaticNotificationProvider } from '@/contexts/NotificationContextBase';
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { AUTH_UI_REQUEST_EVENT } from '@/lib/auth-ui-events';
import { HOME_AUTH_SESSION_UPDATED_EVENT, type HomeAuthSessionUpdatedDetail } from '@/lib/home-auth-events';
import { useDeferredComponent } from '@/hooks/use-deferred-component';
import { hasSupabaseAuthSessionHint } from '@/lib/supabase-auth-session-hints';
import {
    APP_HEADER_HEIGHT_VAR,
    MOBILE_SHEET_HEADER_OFFSET_VAR,
    MOBILE_SHEET_HEADER_PROGRESS_VAR,
} from '@/lib/mobile-sheet-layout';

import MobileBottomNav from '@/components/layout/MobileBottomNav';

const OverlayLayout = lazy(() => import('@/components/layout/OverlayLayout'));

type AuthModalProps = { isOpen: boolean; onClose: () => void };
type ProfileModalProps = AuthModalProps;
type NicknameSetupModalProps = { isOpen: boolean; onComplete: () => void };
type ProviderProps = { children: ReactNode };

const loadAuthProvider = async () => {
    const mod = await import('@/contexts/AuthContext');
    return mod.AuthProvider as ComponentType<ProviderProps>;
};

const loadNotificationProvider = async () => {
    const mod = await import('@/contexts/NotificationContext');
    return mod.NotificationProvider as ComponentType<ProviderProps>;
};

function HomeSessionProviders({ children }: ProviderProps) {
    const [hasStoredSession, setHasStoredSession] = useState(false);

    useEffect(() => {
        const updateSessionHint = (event?: Event) => {
            const detail = (event as CustomEvent<HomeAuthSessionUpdatedDetail> | undefined)?.detail;
            if (typeof detail?.hasSession === 'boolean') {
                setHasStoredSession(detail.hasSession);
                return;
            }

            setHasStoredSession(hasSupabaseAuthSessionHint());
        };

        updateSessionHint();
        window.addEventListener(HOME_AUTH_SESSION_UPDATED_EVENT, updateSessionHint);
        window.addEventListener('storage', updateSessionHint);

        return () => {
            window.removeEventListener(HOME_AUTH_SESSION_UPDATED_EVENT, updateSessionHint);
            window.removeEventListener('storage', updateSessionHint);
        };
    }, []);

    const AuthProvider = useDeferredComponent<ProviderProps>(hasStoredSession, loadAuthProvider);
    const NotificationProvider = useDeferredComponent<ProviderProps>(hasStoredSession, loadNotificationProvider);

    if (hasStoredSession && AuthProvider && NotificationProvider) {
        return (
            <AuthProvider>
                <NotificationProvider>{children}</NotificationProvider>
            </AuthProvider>
        );
    }

    return (
        <AnonymousHomeAuthProvider>
            <StaticNotificationProvider>{children}</StaticNotificationProvider>
        </AnonymousHomeAuthProvider>
    );
}

function DeferredAuthModal(props: AuthModalProps) {
    const AuthModal = useDeferredComponent<AuthModalProps>(props.isOpen, async () => {
        const mod = await import('@/components/auth/AuthModal');
        return mod.default as ComponentType<AuthModalProps>;
    });

    if (!props.isOpen || !AuthModal) return null;
    return <AuthModal {...props} />;
}

function DeferredProfileModal(props: ProfileModalProps) {
    const ProfileModal = useDeferredComponent<ProfileModalProps>(props.isOpen, async () => {
        const mod = await import('@/components/profile/ProfileModal');
        return mod.ProfileModal as ComponentType<ProfileModalProps>;
    });

    if (!props.isOpen || !ProfileModal) return null;
    return <ProfileModal {...props} />;
}

function DeferredNicknameSetupModal(props: NicknameSetupModalProps) {
    const NicknameSetupModal = useDeferredComponent<NicknameSetupModalProps>(props.isOpen, async () => {
        const mod = await import('@/components/profile/NicknameSetupModal');
        return mod.NicknameSetupModal as ComponentType<NicknameSetupModalProps>;
    });

    if (!props.isOpen || !NicknameSetupModal) return null;
    return <NicknameSetupModal {...props} />;
}

function DeferredUserDataPrefetcher({ enabled }: { enabled: boolean }) {
    const UserDataPrefetcher = useDeferredComponent<Record<string, never>>(enabled, async () => {
        const mod = await import('@/components/layout/UserDataPrefetcher');
        return mod.default as ComponentType<Record<string, never>>;
    });

    if (!enabled || !UserDataPrefetcher) return null;
    return <UserDataPrefetcher />;
}

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
            <DeferredUserDataPrefetcher enabled={Boolean(user)} />

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
                <MobileBottomNav
                    className="transition-transform duration-300"
                    style={{
                        transform: 'translate3d(0, calc(var(--mobile-sheet-hide-bottom-nav, 0) * 120%), 0)',
                        willChange: 'transform',
                    }}
                />
            </div>

            {isAuthModalOpen && (
                <Suspense fallback={null}>
                    <DeferredAuthModal
                        isOpen={isAuthModalOpen}
                        onClose={() => setIsAuthModalOpen(false)}
                    />
                </Suspense>
            )}

            {isProfileModalOpen && (
                <Suspense fallback={null}>
                    <DeferredProfileModal
                        isOpen={isProfileModalOpen}
                        onClose={() => setIsProfileModalOpen(false)}
                    />
                </Suspense>
            )}

            {needsNicknameSetup && (
                <Suspense fallback={null}>
                    <DeferredNicknameSetupModal
                        isOpen={needsNicknameSetup}
                        onComplete={completeNicknameSetup}
                    />
                </Suspense>
            )}
        </div>
    );
}

function HomeLayoutContent({ children }: { children: ReactNode }) {
    const { isDesktop } = useDeviceType();

    if (isDesktop) {
        return (
            <Suspense fallback={<HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>}>
                <OverlayLayout>{children}</OverlayLayout>
            </Suspense>
        );
    }

    return <MobileHomeLayout>{children}</MobileHomeLayout>;
}

function HomeRuntimePendingShell({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-[var(--full-height,100vh)] bg-background text-foreground">
            <a href="#main-content" className="skip-link">
                본문 바로가기
            </a>
            <main id="main-content" className="h-full w-full bg-background">
                {children}
            </main>
        </div>
    );
}
export function HomeRuntimeShell({ children }: { children: ReactNode }) {
    return (
        <QueryProvider>
            <HomeSessionProviders>
                <LayoutProvider>
                    <HomeLayoutContent>{children}</HomeLayoutContent>
                </LayoutProvider>
            </HomeSessionProviders>
        </QueryProvider>
    );
}
