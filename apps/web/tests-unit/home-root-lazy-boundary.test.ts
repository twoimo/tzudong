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
    test('keeps the root first paint static while preserving the real home runtime frame', () => {
        const pageSource = source('app/page.tsx');
        const homeFrameSource = source('app/home-frame/page.tsx');
        const publicStaticSource = source('public/home-static.html');
        const proxySource = source('proxy.ts');
        const homeClientSource = source('app/home-client.tsx');
        const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');
        const homeCssSource = source('app/home-app-globals.css');
        const homeTailwindConfigSource = source('tailwind.home.config.ts');

        expect(pageSource).toContain("import { HomeInitialShell } from './home-initial-shell'");
        expect(pageSource).toContain('homeFrameBootstrap');
        expect(pageSource).toContain("frame.src = '/home-frame' + window.location.search + window.location.hash");
        expect(pageSource).not.toContain("import HomeClient from './home-client'");
        expect(pageSource).not.toContain('<HomeClient />');
        expect(pageSource).not.toContain('HomeLandingShell');
        expect(pageSource).not.toContain('HomeMapIsland');
        expect(pageSource).not.toContain('지도 준비하기');

        expect(homeFrameSource).toContain("import { HomeRuntimeShell } from '../home-runtime-shell'");
        expect(homeFrameSource).toContain("import HomeClient from '../home-client'");
        expect(homeFrameSource).toContain('<HomeRuntimeShell>');
        expect(homeFrameSource).toContain('<HomeClient />');
        expect(publicStaticSource).toContain('id="home-initial-shell"');
        expect(publicStaticSource).toContain('aria-label="쯔동여지도 로딩 중"');
        expect(publicStaticSource).toContain('class="loader"');
        expect(publicStaticSource).toContain('홈 지도를 불러오는 중...');
        expect(publicStaticSource).toContain('맛집 지도 런타임을 준비하고 있습니다');
        expect(publicStaticSource).toContain('property="og:image"');
        expect(publicStaticSource).toContain('name="twitter:card"');
        expect(publicStaticSource).toContain('rel="icon"');
        expect(publicStaticSource).toContain("frame.id='home-runtime-frame'");
        expect(publicStaticSource).toContain("frame.src='/home-frame'+location.search+location.hash");
        expect(proxySource).toContain("return NextResponse.rewrite(new URL('/home-static.html', request.url))");
        expect(proxySource).toContain("'/home-frame'");
        expect(proxySource).toContain("request.nextUrl.searchParams.has('_rsc')");
        expect(proxySource).toContain("accept.includes('text/html')");
        expect(proxySource).toContain("fetchDest === 'document'");

        expect(source('app/home-initial-shell.tsx')).toContain('aria-label="쯔동여지도 로딩 중"');
        expect(source('app/home-initial-shell.tsx')).toContain('홈 지도를 불러오는 중...');
        expect(source('app/home-initial-shell.tsx')).toContain('맛집 지도 런타임을 준비하고 있습니다');
        expect(homeClientSource).toContain('<HomeMapContainer');
        expect(homeClientSource).not.toContain('home-map-activate-button');
        expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
        expect(homeRuntimeShellSource).toContain('function MobileHomeLayout');
        expect(homeRuntimeShellSource).toContain('function HomeRuntimePendingShell');
        expect(homeRuntimeShellSource).toContain('const OverlayLayout = lazy(');
        expect(homeRuntimeShellSource).toContain('fallback={<HomeRuntimePendingShell />}');
        expect(homeRuntimeShellSource).not.toContain('fallback={<div className="h-full w-full">{children}</div>}');
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
