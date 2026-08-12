'use client';
// Keep the home Tailwind entry separate from the full app stylesheet loaded by AppRuntimeShell.

import './home-app-globals.css';
import { Suspense, lazy, type ComponentType, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryProvider } from './providers';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { AnonymousHomeAuthProvider, useAuth } from '@/contexts/AuthContextBase';
import { StaticNotificationProvider } from '@/contexts/NotificationContextBase';
import { useHomeViewportMode } from '@/hooks/useHomeViewportMode';
import { cn } from '@/lib/utils';
import { AUTH_UI_REQUEST_EVENT } from '@/lib/auth-ui-events';
import {
    AUTH_PRIVACY_ONBOARDING_REASON,
    readHomeAuthLoginRequestFromLocation,
} from '@/lib/auth/auth-redirect';
import { HOME_AUTH_SESSION_UPDATED_EVENT, type HomeAuthSessionUpdatedDetail } from '@/lib/home-auth-events';
import { useDeferredComponent } from '@/hooks/use-deferred-component';
import { hasSupabaseAuthSessionHint } from '@/lib/supabase-auth-session-hints';
import { isPublicRestrictedMode } from '@/lib/site-config';
import {
    APP_HEADER_HEIGHT_VAR,
    MOBILE_SHEET_HEADER_OFFSET_VAR,
    MOBILE_SHEET_HEADER_PROGRESS_VAR,
} from '@/lib/mobile-sheet-layout';

import MobileBottomNav from '@/components/layout/MobileBottomNav';
import { AppToaster } from '@/components/ui/app-toaster';

const OverlayLayout = lazy(() => import('@/components/layout/OverlayLayout'));

type AuthModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onAuthSuccess?: () => void;
    redirectTo?: string | null;
    reason?: string | null;
    initialAuthTab?: 'login' | 'signup';
};
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
    const [hasStoredSession, setHasStoredSession] = useState(
        () => !isPublicRestrictedMode && hasSupabaseAuthSessionHint(),
    );

    useEffect(() => {
        if (isPublicRestrictedMode) return undefined;

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
        <AnonymousHomeAuthProvider isLoading={isPublicRestrictedMode ? false : hasStoredSession}>
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
    const [authLoginRequest, setAuthLoginRequest] = useState({
        requested: false,
        reason: null as string | null,
        nextPath: '/',
    });

    const openAuth = useCallback(() => {
        if (isPublicRestrictedMode) return;
        setIsAuthModalOpen(true);
    }, []);
    const closeAuth = useCallback(() => {
        setIsAuthModalOpen(false);
        setAuthLoginRequest((current) => {
            if (!current.requested) return current;
            window.history.replaceState(window.history.state, '', '/');
            return { requested: false, reason: null, nextPath: '/' };
        });
    }, []);
    const closeAuthAfterSuccess = useCallback(() => {
        closeAuth();
    }, [closeAuth]);

    const openProfile = useCallback(() => {
        if (isPublicRestrictedMode) return;
        setIsProfileModalOpen(true);
    }, []);

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

        if (!isPublicRestrictedMode) {
            window.addEventListener(AUTH_UI_REQUEST_EVENT, openAuth);
            window.addEventListener('home:mobile-auth-request', openAuthListener);
            window.addEventListener('home:mobile-profile-request', openProfileListener);
        }

        return () => {
            if (!isPublicRestrictedMode) {
                window.removeEventListener(AUTH_UI_REQUEST_EVENT, openAuth);
                window.removeEventListener('home:mobile-auth-request', openAuthListener);
                window.removeEventListener('home:mobile-profile-request', openProfileListener);
            }
            root.style.setProperty(MOBILE_SHEET_HEADER_PROGRESS_VAR, '0');
            root.style.setProperty(MOBILE_SHEET_HEADER_OFFSET_VAR, '0px');
            root.style.setProperty(APP_HEADER_HEIGHT_VAR, '56px');
        };
    }, [openAuth, openProfile]);

    useEffect(() => {
        const request = readHomeAuthLoginRequestFromLocation(window.location);
        if (request.requested && isPublicRestrictedMode) {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.delete('auth');
            currentUrl.searchParams.delete('reason');
            currentUrl.searchParams.delete('next');
            const nextSearch = currentUrl.searchParams.toString();
            const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ''}${currentUrl.hash}`;
            window.history.replaceState(window.history.state, '', nextUrl);
            setAuthLoginRequest({ requested: false, reason: null, nextPath: '/' });
            return;
        }

        setAuthLoginRequest(request);
        if (request.requested && !isPublicRestrictedMode) {
            setIsAuthModalOpen(true);
        }
    }, []);

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
                <main id="main-content" className="flex-1 relative overflow-hidden" aria-label="쯔동여지도 지도 본문">
                    <div className="h-full w-full">
                        {children}
                    </div>
                </main>
            </div>

            {!isPublicRestrictedMode && (
                <div className={cn('min-[1600px]:hidden transition-transform duration-300')}>
                    <MobileBottomNav
                        className="transition-transform duration-300"
                        style={{
                            transform: 'translate3d(0, calc(var(--mobile-sheet-hide-bottom-nav, 0) * 120%), 0)',
                            willChange: 'transform',
                        }}
                    />
                </div>
            )}

            {!isPublicRestrictedMode && isAuthModalOpen && (
                <Suspense fallback={null}>
                    <DeferredAuthModal
                        isOpen={isAuthModalOpen}
                        onClose={closeAuth}
                        onAuthSuccess={closeAuthAfterSuccess}
                        redirectTo={authLoginRequest.requested ? authLoginRequest.nextPath : null}
                        reason={authLoginRequest.requested ? authLoginRequest.reason : null}
                        initialAuthTab={
                            authLoginRequest.reason === AUTH_PRIVACY_ONBOARDING_REASON ? 'signup' : 'login'
                        }
                    />
                </Suspense>
            )}

            {!isPublicRestrictedMode && isProfileModalOpen && (
                <Suspense fallback={null}>
                    <DeferredProfileModal
                        isOpen={isProfileModalOpen}
                        onClose={() => setIsProfileModalOpen(false)}
                    />
                </Suspense>
            )}

            {!isPublicRestrictedMode && needsNicknameSetup && (
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
    const viewportMode = useHomeViewportMode();

    if (viewportMode === 'pending') {
        return <HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>;
    }

    if (viewportMode === 'desktop') {
        if (isPublicRestrictedMode) {
            return <HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>;
        }
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
        <div className="bg-background text-foreground" style={{ height: 'var(--full-height, 100vh)' }}>
            <a href="#main-content" className="skip-link">
                본문 바로가기
            </a>
            <main id="main-content" className="h-full w-full bg-background" aria-label="쯔동여지도 지도 본문">
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
                    <AppToaster />
                </LayoutProvider>
            </HomeSessionProviders>
        </QueryProvider>
    );
}
