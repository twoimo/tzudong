'use client';

import './app-globals.css';
import { Suspense, type ReactNode } from 'react';
import { AppProviders } from './app-providers';
import { QueryProvider } from './providers';
import { MainLayout } from '@/components/layout/MainLayout';

export function AppRuntimeShell({ children }: { children: ReactNode }) {
    return (
        <QueryProvider>
            <AppProviders>
                <Suspense fallback={
                    <div className="flex min-h-0 min-w-0 flex-col bg-background" style={{ height: 'var(--full-height, 100vh)' }}>
                        <a href="#main-content" className="skip-link">본문 바로가기</a>
                        <main id="main-content" className="min-h-0 min-w-0 flex-1" tabIndex={-1}>{children}</main>
                    </div>
                }>
                    <MainLayout>{children}</MainLayout>
                </Suspense>
            </AppProviders>
        </QueryProvider>
    );
}
