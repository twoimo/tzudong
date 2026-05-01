import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('home root lazy boundary', () => {
    test('keeps the heavy HomeClient graph behind a small client loader', () => {
        const pageSource = source('app/page.tsx');
        const loaderSource = source('app/home-client-loader.tsx');

        expect(pageSource).toContain("import HomeClientLoader from './home-client-loader'");
        expect(pageSource).not.toContain("import HomeClient from './home-client'");
        expect(loaderSource).toContain("'use client'");
        expect(loaderSource).toContain("dynamic(() => import('./home-client')");
        expect(loaderSource).toContain('ssr: false');
        expect(loaderSource).not.toContain('@/components/skeletons/MapSkeleton');
    });

    test('does not statically pull Vercel SpeedInsights into dev root layout', () => {
        const layoutSource = source('app/layout.tsx');
        const speedInsightsSource = source('app/app-speed-insights.tsx');

        expect(layoutSource).not.toContain('@vercel/speed-insights/next');
        expect(layoutSource).toContain('AppSpeedInsights');
        expect(speedInsightsSource).toContain("import('@vercel/speed-insights/next')");
        expect(speedInsightsSource).toContain("process.env.NODE_ENV !== 'production'");
        expect(speedInsightsSource).toContain('return null');
    });

    test('keeps optional tooltip primitives out of the global app provider graph', () => {
        const appProvidersSource = source('app/app-providers.tsx');

        expect(appProvidersSource).not.toContain('@/components/ui/tooltip');
        expect(appProvidersSource).not.toContain('TooltipProvider');
        expect(appProvidersSource).toContain('AuthProvider');
        expect(appProvidersSource).toContain('NotificationProvider');
    });
});
