'use client';

import { Suspense, type ReactNode } from 'react';
import { AppProviders } from './app-providers';
import { QueryProvider } from './providers';
import { MainLayout } from '@/components/layout/MainLayout';

export function AppRuntimeShell({ children }: { children: ReactNode }) {
    return (
        <QueryProvider>
            <AppProviders>
                <Suspense fallback={null}>
                    <MainLayout>{children}</MainLayout>
                </Suspense>
            </AppProviders>
        </QueryProvider>
    );
}
