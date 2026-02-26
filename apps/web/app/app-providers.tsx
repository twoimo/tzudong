'use client';

import dynamic from 'next/dynamic';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';

// [PERF] WebVitals를 지연 로딩하여 초기 번들 크기 감소 + TBT 개선
const WebVitals = dynamic(
    () => import('@/lib/web-vitals').then(mod => ({ default: mod.WebVitals })),
    { ssr: false }
);

export function AppProviders({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <NotificationProvider>
                <TooltipProvider>
                    {/* [PERF] 성능 지표 모니터링 - 지연 로딩 */}
                    <WebVitals />
                    <Toaster />
                    <Sonner />
                    {children}
                </TooltipProvider>
            </NotificationProvider>
        </AuthProvider>
    );
}
