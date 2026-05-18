'use client';

import './home-app-globals.css';
import { Suspense, lazy, type ComponentType, type ReactNode, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { QueryProvider } from './providers';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { AnonymousHomeAuthProvider, useAuth } from '@/contexts/AuthContextBase';
import { StaticNotificationProvider } from '@/contexts/NotificationContextBase';
import { useDeviceType } from '@/hooks/useDeviceType';
import { cn } from '@/lib/utils';
import { AUTH_UI_REQUEST_EVENT, requestAuthUi } from '@/lib/auth-ui-events';
import { HOME_AUTH_SESSION_UPDATED_EVENT, type HomeAuthSessionUpdatedDetail } from '@/lib/home-auth-events';
import { useDeferredComponent } from '@/hooks/use-deferred-component';
import { hasSupabaseAuthSessionHint } from '@/lib/supabase-auth-session-hints';
import {
    APP_HEADER_HEIGHT_VAR,
    MOBILE_SHEET_HEADER_OFFSET_VAR,
    MOBILE_SHEET_HEADER_PROGRESS_VAR,
} from '@/lib/mobile-sheet-layout';

const OverlayLayout = lazy(() => import('@/components/layout/OverlayLayout'));
const MobileBottomNav = lazy(() => import('@/components/layout/MobileBottomNav'));
const MOBILE_BOTTOM_NAV_IDLE_DELAY_MS = 8000;
const MOBILE_BOTTOM_NAV_LOADING_ITEMS = [
    { label: '홈', path: '/' },
    { label: '리뷰', path: '/feed' },
    { label: '도장', path: '/stamp' },
    { label: '랭킹', path: '/leaderboard' },
    { label: 'MY', path: '/mypage/profile' },
] as const;

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

function MobileBottomNavLoadingShell({ onActivate }: { onActivate: (path: string) => void }) {
    return (
        <nav
            aria-label="주요 탐색 준비 중"
            className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-lg shadow-black/5 backdrop-blur-md min-[1280px]:hidden"
        >
            {MOBILE_BOTTOM_NAV_LOADING_ITEMS.map(({ label, path }) => (
                <button
                    key={path}
                    type="button"
                    onClick={() => onActivate(path)}
                    className="min-h-[60px] px-1 py-2.5 text-[11px] font-medium text-muted-foreground"
                    aria-label={`${label} 페이지로 이동`}
                >
                    {label}
                </button>
            ))}
        </nav>
    );
}

function MobileHomeLayout({ children }: { children: ReactNode }) {
    const { user, needsNicknameSetup, completeNicknameSetup } = useAuth();
    const queryClient = useQueryClient();
    const pathname = usePathname();
    const router = useRouter();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [shouldLoadMobileBottomNav, setShouldLoadMobileBottomNav] = useState(false);

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

    useEffect(() => {
        if (shouldLoadMobileBottomNav) return;

        const requestMobileBottomNav = () => setShouldLoadMobileBottomNav(true);
        const idleTimer = window.setTimeout(requestMobileBottomNav, MOBILE_BOTTOM_NAV_IDLE_DELAY_MS);
        const eventOptions = { passive: true, once: true } as AddEventListenerOptions;

        window.addEventListener('pointerdown', requestMobileBottomNav, eventOptions);
        window.addEventListener('keydown', requestMobileBottomNav, { once: true });
        window.addEventListener('touchstart', requestMobileBottomNav, eventOptions);

        return () => {
            window.clearTimeout(idleTimer);
            window.removeEventListener('pointerdown', requestMobileBottomNav);
            window.removeEventListener('keydown', requestMobileBottomNav);
            window.removeEventListener('touchstart', requestMobileBottomNav);
        };
    }, [shouldLoadMobileBottomNav]);

    const handleBottomNavLoadingIntent = useCallback((path: string) => {
        setShouldLoadMobileBottomNav(true);

        if (path === '/' || path === pathname) {
            return;
        }

        if (path === '/mypage/profile' && !user?.id) {
            requestAuthUi({ source: 'mobile-bottom-nav-loading-shell-my', route: pathname ?? undefined, reason: 'mypage' });
            return;
        }

        router.push(path);
    }, [pathname, router, user?.id]);

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
                {shouldLoadMobileBottomNav ? (
                    <Suspense fallback={<MobileBottomNavLoadingShell onActivate={handleBottomNavLoadingIntent} />}>
                        <MobileBottomNav
                            className="transition-transform duration-300"
                            style={{
                                transform: 'translate3d(0, calc(var(--mobile-sheet-hide-bottom-nav, 0) * 120%), 0)',
                                willChange: 'transform',
                            }}
                        />
                    </Suspense>
                ) : (
                    <MobileBottomNavLoadingShell onActivate={handleBottomNavLoadingIntent} />
                )}
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
    const [hasMounted, setHasMounted] = useState(false);
    const { isDesktop } = useDeviceType();

    useEffect(() => {
        setHasMounted(true);
    }, []);

    if (!hasMounted) {
        return <HomeRuntimePendingShell />;
    }

    if (isDesktop) {
        return (
            <Suspense fallback={<HomeRuntimePendingShell />}>
                <OverlayLayout>{children}</OverlayLayout>
            </Suspense>
        );
    }

    return <MobileHomeLayout>{children}</MobileHomeLayout>;
}

function HomeRuntimeProgressiveShell() {
    return (
        <section
            aria-label="쯔동여지도 홈 미리보기"
            className="fixed inset-0 z-50 h-[var(--full-height,100vh)] w-screen overflow-hidden bg-background text-foreground"
        >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(239,68,68,0.08),transparent_34%),linear-gradient(0deg,rgba(248,250,252,0.95),rgba(255,255,255,0.95))]" aria-hidden="true" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[size:44px_44px]" aria-hidden="true" />

            <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] flex h-12 items-center gap-2 rounded-full bg-background/95 px-2 shadow-lg shadow-black/5 backdrop-blur-sm min-[1280px]:left-8 min-[1280px]:right-auto min-[1280px]:w-[360px]" aria-hidden="true">
                <div className="flex min-h-11 flex-1 items-center rounded-full bg-muted/45 px-3 text-left text-[15px] text-muted-foreground">
                    쯔동여지도 검색하기
                </div>
                <div className="min-h-11 min-w-11 rounded-full bg-muted/45 min-[1280px]:hidden" />
                <div className="min-h-11 min-w-11 rounded-full bg-muted/45 min-[1280px]:hidden" />
                <div className="min-h-11 min-w-11 rounded-full bg-muted/45 min-[1280px]:hidden" />
            </div>

            <p className="sr-only" role="status" aria-live="polite">쯔동여지도 홈 준비 중</p>
        </section>
    );
}

function HomeRuntimePendingShell() {
    return (
        <div className="min-h-[var(--full-height,100vh)] bg-background text-foreground">
            <a href="#main-content" className="skip-link">
                본문 바로가기
            </a>
            <main id="main-content" className="h-full w-full" aria-busy="true">
                <HomeRuntimeProgressiveShell />
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
