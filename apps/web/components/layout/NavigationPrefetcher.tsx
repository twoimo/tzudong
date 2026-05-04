'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getNavigationPrefetchRoutes } from '@/components/layout/navigation-routes';

type IdleCallbackHandle = number;

const HOME_ROUTE_PREFETCH_DELAY_MS = 8000;

function runWhenIdle(callback: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => undefined;
    }

    const idleWindow = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => IdleCallbackHandle;
        cancelIdleCallback?: (id: IdleCallbackHandle) => void;
    };

    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
        const handle = idleWindow.requestIdleCallback(callback, { timeout: 2000 });
        return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(callback, 200);
    return () => window.clearTimeout(timer);
}

function canPrefetchRoutes() {
    // In development, router.prefetch eagerly asks Next to compile every
    // navigation target after the first page becomes idle. That creates the
    // exact compile burst seen in dev logs (`/feed`, `/stamp`, `/mypage/*`)
    // without improving production behavior. Keep prefetch enabled for
    // production where it improves navigation latency.
    if (process.env.NODE_ENV === 'development') {
        return false;
    }

    if (typeof window === 'undefined' || !navigator.onLine) {
        return false;
    }

    const connection = (navigator as Navigator & {
        connection?: {
            saveData?: boolean;
            effectiveType?: string;
        };
    }).connection;

    if (!connection) {
        return true;
    }

    if (connection.saveData) {
        return false;
    }

    if (connection.effectiveType?.includes('2g')) {
        return false;
    }

    return true;
}

export default function NavigationPrefetcher() {
    const router = useRouter();
    const pathname = usePathname();
    const { user, isAdmin } = useAuth();

    const routesToPrefetch = useMemo(() => {
        return getNavigationPrefetchRoutes({
            isLoggedIn: !!user?.id,
            isAdmin: !!isAdmin,
        }).filter((route) => route !== pathname);
    }, [isAdmin, pathname, user?.id]);

    useEffect(() => {
        if (!canPrefetchRoutes()) {
            return;
        }

        let cancelled = false;
        const runPrefetch = () => {
            if (cancelled) {
                return;
            }

            routesToPrefetch.forEach((route) => {
                try {
                    router.prefetch(route);
                } catch {
                    // Prefetch failure should not block navigation.
                }
            });
        };

        let cancel: () => void = () => undefined;
        let homeDelayTimer: number | null = null;

        if (pathname === '/') {
            homeDelayTimer = window.setTimeout(() => {
                cancel = runWhenIdle(runPrefetch);
            }, HOME_ROUTE_PREFETCH_DELAY_MS);
        } else {
            cancel = runWhenIdle(runPrefetch);
        }

        return () => {
            cancelled = true;
            if (homeDelayTimer !== null) {
                window.clearTimeout(homeDelayTimer);
            }
            cancel();
        };
    }, [pathname, router, routesToPrefetch]);

    return null;
}
