'use client';

import './app-globals.css';
import '../styles/product-ui.css';
import { Suspense, type ReactNode } from 'react';
import { AppProviders } from './app-providers';
import { QueryProvider } from './providers';
import { MainLayout } from '@/components/layout/MainLayout';
import { ScrollEffects } from '@/components/layout/ScrollEffects';

export function AppRuntimeShell({ children }: { children: ReactNode }) {
    return (
        <QueryProvider>
            <ScrollEffects />
            <AppProviders>
                <Suspense fallback={null}>
                    <MainLayout>{children}</MainLayout>
                </Suspense>
            </AppProviders>
        </QueryProvider>
    );
}
