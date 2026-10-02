'use client';
// Keep the home Tailwind entry separate from the full app stylesheet loaded by AppRuntimeShell.

import './home-app-globals.css';
import { Suspense, lazy, type ComponentType, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryProvider } from './providers';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { AnonymousHomeAuthProvider, useAuth } from '@/contexts/AuthContextBase';
import { StaticNotificationProvider } from '@/contexts/NotificationContextBase';
import { HomeSessionProviderBridge } from '@/components/home/home-session-provider-bridge';
import { useHomeViewportMode } from '@/hooks/useHomeViewportMode';
import { AUTH_UI_REQUEST_EVENT } from '@/lib/auth-ui-events';
import {
    AUTH_PRIVACY_ONBOARDING_REASON,
    readHomeAuthLoginRequestFromLocation,
} from '@/lib/auth/auth-redirect';
import { HOME_AUTH_SESSION_UPDATED_EVENT, type HomeAuthSessionUpdatedDetail } from '@/lib/home-auth-events';
import { useDeferredComponent } from '@/hooks/use-deferred-component';
import { hasSupabaseAuthSessionHint } from '@/lib/supabase-auth-session-hints';
import { isPublicRestrictedMode } from '@/lib/site-config';
import { WebVitals } from '@/lib/web-vitals';
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

    return (
        <AnonymousHomeAuthProvider
            key={hasStoredSession ? 'session' : 'anonymous'}
            isLoading={isPublicRestrictedMode ? false : hasStoredSession}
        >
            <StaticNotificationProvider>
                <HomeSessionProviderBridge
                    AuthProvider={hasStoredSession ? AuthProvider : null}
                    NotificationProvider={hasStoredSession ? NotificationProvider : null}
                >
                    {children}
                </HomeSessionProviderBridge>
            </StaticNotificationProvider>
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

function MobileHomeLayout() {
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
        <>
            <DeferredUserDataPrefetcher enabled={Boolean(user)} />

            {!isPublicRestrictedMode && (
                <div className="min-[1600px]:hidden">
                    <MobileBottomNav
                        style={{
                            transform: 'translate3d(0, calc(var(--mobile-sheet-hide-bottom-nav, 0) * 120%), 0)',
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
        </>
    );
}

function HomeLayoutContent({ children }: { children: ReactNode }) {
    const viewportMode = useHomeViewportMode();

    // 모든 뷰포트에서 지도 본문의 부모와 위치를 유지한다.
    // 모바일 레이아웃을 조상으로 교체하면 지도와 검색/선택 상태가 다시 마운트된다.
    return (
        <HomeRuntimePendingShell
            isMobile={viewportMode === 'mobileOrTablet'}
            mobileChrome={viewportMode === 'mobileOrTablet' ? <MobileHomeLayout /> : null}
        >
            {children}
            {viewportMode === 'desktop' && !isPublicRestrictedMode ? (
                <Suspense fallback={null}>
                    <OverlayLayout />
                </Suspense>
            ) : null}
        </HomeRuntimePendingShell>
    );
}

function HomeStaticSkeleton() {
    return (
        <div
            className="pointer-events-none absolute inset-0 z-[20]"
            data-home-static-skeleton="true"
            aria-hidden="true"
        >
            <div className="h-full max-xl:hidden">
                <div className="h-full w-[min(392px,calc(100vw-32px))] border-r border-border bg-card p-4">
                    <div className="h-11 animate-pulse rounded-full bg-muted" />
                    <div className="mt-4 space-y-3">
                        {Array.from({ length: 6 }, (_, index) => (
                            <div key={index} className="h-16 animate-pulse rounded-xl bg-muted" />
                        ))}
                    </div>
                </div>
            </div>
            <div className="xl:hidden">
                <div className="mx-3 mt-[calc(env(safe-area-inset-top)+10px)] h-12 animate-pulse rounded-full border border-border bg-muted" />
            </div>
        </div>
    );
}

function HomeRuntimePendingShell({ children, isMobile, mobileChrome }: {
    children: ReactNode;
    isMobile: boolean;
    mobileChrome: ReactNode;
}) {
    return (
        <div
            className={`flex flex-col bg-background text-foreground${isMobile ? ' overflow-hidden' : ''}`}
            style={{ height: 'var(--full-height, 100vh)' }}
        >
            <a href="#main-content" className="skip-link">
                본문 바로가기
            </a>
            <main
                id="main-content"
                className={`relative h-full min-h-0 w-full flex-1 bg-background${isMobile ? ' overflow-hidden' : ''}`}
                aria-label="쯔동여지도 지도 본문"
            >
                <HomeStaticSkeleton />
                {children}
            </main>
            {mobileChrome}
        </div>
    );
}
export function HomeRuntimeShell({ children }: { children: ReactNode }) {
    // Fullscreen temporarily unmounts the controls. Once ready, their initial
    // placeholder stays retired until the home runtime itself leaves.
    useEffect(() => () => {
        delete document.documentElement.dataset.homeMobileChromeReady;
    }, []);

    return (
        <QueryProvider>
            <WebVitals />
            <HomeSessionProviders>
                <LayoutProvider>
                    <HomeLayoutContent>{children}</HomeLayoutContent>
                    <AppToaster />
                </LayoutProvider>
            </HomeSessionProviders>
        </QueryProvider>
    );
}
