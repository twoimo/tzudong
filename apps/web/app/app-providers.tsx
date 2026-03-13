'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';

// [PERF] WebVitals를 지연 로딩하여 초기 번들 크기 감소 + TBT 개선
const WebVitals = dynamic(
    () => import('@/lib/web-vitals').then(mod => ({ default: mod.WebVitals })),
    { ssr: false }
);

export function AppProviders({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        const RELOAD_KEY = '__tzudong_chunk_reload_once__';
        const clearReloadFlagTimer = window.setTimeout(() => {
            sessionStorage.removeItem(RELOAD_KEY);
        }, 30000);

        const hasChunkScriptPath = (value: unknown) => {
            const text = String(value ?? '');
            return text.includes('/_next/static/chunks/');
        };

        const hasChunkLoadError = (value: unknown) => {
            const text = String(value ?? '');
            return (
                text.includes('ChunkLoadError')
                || text.includes('Loading chunk')
                || hasChunkScriptPath(text)
            );
        };

        const hasChunkSyntaxError = (value: unknown) => {
            const text = String(value ?? '');
            return (
                text.includes('Invalid or unexpected token')
                || text.includes('Unexpected token')
            );
        };

        const tryRecoveryReload = () => {
            if (sessionStorage.getItem(RELOAD_KEY) === '1') return;
            sessionStorage.setItem(RELOAD_KEY, '1');
            window.location.reload();
        };

        const getProperty = (value: unknown, key: 'name' | 'message' | 'stack') => {
            if (!value || typeof value !== 'object') return undefined;
            const record = value as Record<string, unknown>;
            return record[key];
        };

        const onError = (event: ErrorEvent) => {
            const errorName = getProperty(event.error, 'name');
            const errorMessage = getProperty(event.error, 'message');
            const errorStack = getProperty(event.error, 'stack');

            const shouldRecoverChunkLoad =
                hasChunkLoadError(event.message)
                || hasChunkLoadError(errorName)
                || hasChunkLoadError(errorMessage)
                || hasChunkLoadError(errorStack);

            const shouldRecoverChunkSyntax =
                (hasChunkSyntaxError(event.message) || hasChunkSyntaxError(errorMessage))
                && (hasChunkScriptPath(event.filename) || hasChunkScriptPath(errorStack));

            if (shouldRecoverChunkLoad || shouldRecoverChunkSyntax) {
                tryRecoveryReload();
            }
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const reasonStack = getProperty(reason, 'stack');
            if (
                hasChunkLoadError(getProperty(reason, 'name'))
                || hasChunkLoadError(getProperty(reason, 'message'))
                || hasChunkLoadError(reasonStack)
                || (
                    hasChunkSyntaxError(getProperty(reason, 'message'))
                    && hasChunkScriptPath(reasonStack)
                )
            ) {
                tryRecoveryReload();
            }
        };

        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onUnhandledRejection);

        return () => {
            window.clearTimeout(clearReloadFlagTimer);
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onUnhandledRejection);
        };
    }, []);

    return (
        <AuthProvider>
            <NotificationProvider>
                <TooltipProvider>
                    {/* [PERF] 성능 지표 모니터링 - 지연 로딩 */}
                    <WebVitals />
                    {children}
                </TooltipProvider>
            </NotificationProvider>
        </AuthProvider>
    );
}
