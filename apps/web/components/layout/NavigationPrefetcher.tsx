'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getNavigationPrefetchRoutes } from '@/components/layout/navigation-routes';

type IdleCallbackHandle = number;

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
        const cancel = runWhenIdle(() => {
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
        });

        return () => {
            cancelled = true;
            cancel();
        };
    }, [router, routesToPrefetch]);

    return null;
}
