import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    hasSupabaseAuthCookieSessionHint,
    hasSupabaseAuthLocalStorageSessionHint,
    isSupabaseAuthSessionStorageKey,
} from '../lib/supabase-auth-session-hints';

const root = join(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
const exists = (relativePath: string) => existsSync(join(root, relativePath));

class MemoryStorage {
    private readonly entries: [string, string][];

    constructor(entries: [string, string][]) {
        this.entries = entries;
    }

    get length() {
        return this.entries.length;
    }

    key(index: number) {
        return this.entries[index]?.[0] ?? null;
    }

    getItem(key: string) {
        return this.entries.find(([entryKey]) => entryKey === key)?.[1] ?? null;
    }
}

describe('home root runtime boundary', () => {
    test('renders the real home map runtime directly without the temporary landing gate', () => {
        const pageSource = source('app/page.tsx');
        const homeClientSource = source('app/home-client.tsx');
        const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');
        const homeCssSource = source('app/home-app-globals.css');
        const homeTailwindConfigSource = source('tailwind.home.config.ts');

        expect(pageSource).toContain("import { HomeRuntimeShell } from './home-runtime-shell'");
        expect(pageSource).toContain("import HomeClient from './home-client'");
        expect(pageSource).toContain('<HomeRuntimeShell>');
        expect(pageSource).toContain('<HomeClient />');
        expect(pageSource).not.toContain('HomeLandingShell');
        expect(pageSource).not.toContain('HomeMapIsland');
        expect(pageSource).not.toContain('지도 준비하기');

        expect(homeClientSource).toContain('<HomeMapContainer');
        expect(homeClientSource).not.toContain('home-map-activate-button');
        expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
        expect(homeRuntimeShellSource).toContain('function MobileHomeLayout');
        expect(homeRuntimeShellSource).toContain('const OverlayLayout = lazy(');
        expect(homeRuntimeShellSource).toContain('HomeAuthSessionUpdatedDetail');
        expect(homeRuntimeShellSource).toContain('hasSupabaseAuthSessionHint');
        expect(homeRuntimeShellSource).toContain("typeof detail?.hasSession === 'boolean'");
        expect(homeRuntimeShellSource).not.toContain('<MainLayout>{children}</MainLayout>');
        expect(homeCssSource).toContain('@config "../tailwind.home.config.ts"');
        expect(homeTailwindConfigSource).toContain('./components/home/**/*');
        expect(homeTailwindConfigSource).not.toContain('./components/admin/');
        expect(homeTailwindConfigSource).not.toContain('./components/restaurant/**/*');
        expect(source('tailwind.home.detail.config.ts')).toContain('./components/restaurant/**/*');
        expect(source('components/map/map-view-deferred-panels.tsx')).toContain("import '@/app/home-detail-globals.css'");
        expect(source('tailwind.home.deferred.config.ts')).toContain('./components/admin/AdminRestaurantModal.tsx');
        expect(source('app/home-client-sidepanels.tsx')).toContain("import './home-deferred-globals.css'");

        expect(exists('app/home-landing-shell.tsx')).toBe(false);
        expect(exists('app/home-landing-shell.module.css')).toBe(false);
        expect(exists('app/home-map-island.tsx')).toBe(false);
        expect(exists('app/home-map-runtime-activation.ts')).toBe(false);
    });

    test('detects Supabase SSR auth session hints from cookies and localStorage', () => {
        expect(isSupabaseAuthSessionStorageKey('sb-project-ref-auth-token')).toBe(true);
        expect(isSupabaseAuthSessionStorageKey('sb-project-ref-auth-token.0')).toBe(true);
        expect(isSupabaseAuthSessionStorageKey('sb-project-ref-auth-token-user')).toBe(false);
        expect(isSupabaseAuthSessionStorageKey('sb-project-ref-code-verifier')).toBe(false);

        expect(hasSupabaseAuthCookieSessionHint('sb-project-ref-auth-token=base64-session')).toBe(true);
        expect(hasSupabaseAuthCookieSessionHint('sb-project-ref-auth-token.0=base64-session; other=value')).toBe(true);
        expect(hasSupabaseAuthCookieSessionHint('sb-project-ref-code-verifier=value')).toBe(false);
        expect(hasSupabaseAuthCookieSessionHint('sb-project-ref-auth-token=')).toBe(false);

        expect(hasSupabaseAuthLocalStorageSessionHint(new MemoryStorage([
            ['other-key', 'value'],
            ['sb-project-ref-auth-token', '{"access_token":"token"}'],
        ]))).toBe(true);
        expect(hasSupabaseAuthLocalStorageSessionHint(new MemoryStorage([
            ['sb-project-ref-auth-token', 'undefined'],
        ]))).toBe(false);
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
        expect(source('app/app-runtime-shell.tsx')).toContain("import './app-globals.css'");
        expect(source('app/app-runtime-shell.tsx')).toContain('MainLayout');
    });
});
