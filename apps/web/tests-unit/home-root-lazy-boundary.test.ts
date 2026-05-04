import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('home root lazy boundary', () => {
    test('keeps the heavy HomeClient graph behind an SSR landing shell and activation island', () => {
        const pageSource = source('app/page.tsx');
        const islandSource = source('app/home-map-island.tsx');
        const shellSource = source('app/home-landing-shell.tsx');

        expect(pageSource).toContain("import { HomeLandingShell } from './home-landing-shell'");
        expect(pageSource).toContain("import HomeMapIsland from './home-map-island'");
        expect(pageSource).toContain('<HomeMapIsland>');
        expect(pageSource).toContain('<HomeLandingShell />');
        expect(pageSource).not.toContain("import HomeClient from './home-client'");

        expect(islandSource).toContain("'use client'");
        expect(islandSource).toContain("import('./home-client')");
        expect(islandSource).toContain("import('./app-runtime-shell')");
        expect(islandSource).toContain('buildHomeMapActivationPlan');
        expect(islandSource).toContain('!activatedRuntime');
        expect(islandSource).toContain('<AppRuntimeShell>');
        expect(islandSource).toContain('<HomeClientComponent />');
        expect(islandSource).not.toContain('@/components/skeletons/MapSkeleton');

        expect(shellSource).not.toContain("'use client'");
        expect(shellSource).toContain('data-testid="home-landing-shell"');
        expect(shellSource).toContain('쯔동여지도');
    });

    test('does not statically pull Vercel SpeedInsights into dev root layout', () => {
        const layoutSource = source('app/layout.tsx');
        const speedInsightsSource = source('app/app-speed-insights.tsx');
        const rootSpeedInsightsSource = source('app/root-speed-insights.tsx');

        expect(layoutSource).not.toContain('@vercel/speed-insights/next');
        expect(layoutSource).toContain('<RootSpeedInsights />');
        expect(rootSpeedInsightsSource).toContain("process.env.VERCEL === '1'");
        expect(rootSpeedInsightsSource).toContain("await import('./app-speed-insights')");
        expect(layoutSource).not.toContain('QueryProvider');
        expect(layoutSource).not.toContain('AppProviders');
        expect(layoutSource).not.toContain('MainLayout');
        expect(speedInsightsSource).toContain("import('@vercel/speed-insights/next')");
        expect(speedInsightsSource).toContain("process.env.NODE_ENV !== 'production'");
        expect(speedInsightsSource).toContain('enabled');
        expect(speedInsightsSource).toContain('return null');
    });

    test('keeps optional tooltip primitives out of the global app provider graph', () => {
        const appProvidersSource = source('app/app-providers.tsx');

        expect(appProvidersSource).not.toContain('@/components/ui/tooltip');
        expect(appProvidersSource).not.toContain('TooltipProvider');
        expect(appProvidersSource).toContain('AuthProvider');
        expect(appProvidersSource).toContain('NotificationProvider');
        expect(source('app/app-runtime-shell.tsx')).toContain('MainLayout');
    });
});
