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
    test('starts the real home map runtime directly on root and layers controls progressively', () => {
        const pageSource = source('app/page.tsx');
        const homeFrameSource = source('app/home-frame/page.tsx');
        const proxySource = source('proxy.ts');
        const publicEligibilitySource = source('lib/auth/public-eligibility-session.ts');
        const homeClientSource = source('app/home-client.tsx');
        const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');
        const homeViewportModeSource = source('hooks/useHomeViewportMode.ts');
        const homeCssSource = source('app/home-app-globals.css');
        const homeTailwindConfigSource = source('tailwind.home.config.ts');

        expect(pageSource).toContain("import { HomeRuntimeShell } from './home-runtime-shell'");
        expect(pageSource).toContain("import HomeClient from './home-client'");
        expect(pageSource).toContain('<HomeRuntimeShell>');
        expect(pageSource).toContain('<HomeClient />');
        expect(pageSource).not.toContain('HomeInitialShell');
        expect(pageSource).not.toContain('homeFrameBootstrap');
        expect(pageSource).not.toContain('homeDeepLinkPreviewBootstrap');
        expect(pageSource).not.toContain('home-runtime-frame');
        expect(pageSource).not.toContain('HomeLandingShell');
        expect(pageSource).not.toContain('HomeMapIsland');
        expect(pageSource).not.toContain('지도 준비하기');

        expect(homeFrameSource).toContain("import { HomeRuntimeShell } from '../home-runtime-shell'");
        expect(homeFrameSource).toContain("import HomeClient from '../home-client'");
        expect(homeFrameSource).toContain('<HomeRuntimeShell>');
        expect(homeFrameSource).toContain('<HomeClient />');
        expect(proxySource).not.toContain("NextResponse.rewrite(new URL('/home-static.html', request.url))");
        expect(proxySource).not.toContain('isRootPageRequest');
        expect(publicEligibilitySource).toContain("'/'");
        expect(publicEligibilitySource).toContain("'/home-frame'");

        expect(homeClientSource.indexOf('<HomeMapContainer')).toBeLessThan(homeClientSource.indexOf('{isViewportResolved && !(isMobileOrTablet && isMapFullscreen)'));
        expect(homeClientSource).toContain('loading: () => null');
        expect(homeClientSource).toContain('tzudong:home-initial-intent');
        expect(homeClientSource).toContain('initialIntent={initialMobileOverlayIntent}');
        expect(homeClientSource).not.toContain('home-map-activate-button');

        expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
        expect(homeRuntimeShellSource).toContain('function MobileHomeLayout');
        expect(homeRuntimeShellSource).toContain('function HomeRuntimePendingShell');
        expect(homeRuntimeShellSource).not.toContain('function HomeRuntimeProgressiveShell');
        expect(homeRuntimeShellSource).not.toContain('function HomeRuntimeLoadingSpinner');
        expect(homeRuntimeShellSource).not.toContain('<HomeRuntimeProgressiveShell />');
        expect(homeRuntimeShellSource).not.toContain('role="status"');
        expect(homeRuntimeShellSource).not.toContain('aria-label="쯔동여지도 로딩 중"');
        expect(homeRuntimeShellSource).not.toContain('animate-spin rounded-full');
        expect(homeRuntimeShellSource).not.toContain('aria-label="쯔동여지도 홈 미리보기"');
        expect(homeRuntimeShellSource).not.toContain('role="status" aria-live="polite"');
        expect(homeRuntimeShellSource).not.toContain('aria-busy="true"');
        expect(homeRuntimeShellSource).not.toContain('data-home-intent="search"');
        expect(homeRuntimeShellSource).not.toContain('지도를 준비하고 있어요');
        expect(homeRuntimeShellSource).not.toContain('지도 화면을 먼저 준비하고 맛집 정보를 순서대로 불러옵니다');
        expect(homeRuntimeShellSource).not.toContain('bg-gradient-to-r');
        expect(homeRuntimeShellSource).not.toContain('motion-reduce:animate-none');
        expect(homeRuntimeShellSource).not.toContain('motion-reduce:hidden');
        expect(homeRuntimeShellSource).not.toContain('홈 지도 준비 단계');
        expect(homeRuntimeShellSource).not.toContain('rounded-3xl border border-border bg-background/90 px-8 py-7');
        expect(homeRuntimeShellSource).not.toContain('animate-bounce');
        expect(homeRuntimeShellSource).not.toContain('@keyframes');
        expect(homeRuntimeShellSource).not.toContain('지도를 준비하고 있어요');
        expect(homeRuntimeShellSource).not.toContain('쯔동여지도 검색하기');
        expect(homeRuntimeShellSource).not.toContain('bg-[radial-gradient');
        expect(homeRuntimeShellSource).not.toContain('bg-[linear-gradient');
        expect(homeRuntimeShellSource).toContain('const OverlayLayout = lazy(');
        expect(homeRuntimeShellSource).toContain('fallback={<HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>}');
        expect(homeRuntimeShellSource).not.toContain('fallback={<div className="h-full w-full">{children}</div>}');
        expect(homeRuntimeShellSource).not.toContain('if (!hasMounted)');
        expect(homeRuntimeShellSource).not.toContain('setHasMounted');
        expect(homeRuntimeShellSource).toContain("if (viewportMode === 'pending')");
        expect(homeRuntimeShellSource).toContain("if (viewportMode === 'desktop')");
        expect(homeRuntimeShellSource).not.toContain("from '@/hooks/useDeviceType'");
        expect(homeViewportModeSource).toContain("export type HomeViewportMode = 'pending' | 'mobileOrTablet' | 'desktop'");
        expect(homeViewportModeSource).toContain("const [mode, setMode] = useState<HomeViewportMode>('pending')");
        expect(homeViewportModeSource).toContain('window.innerWidth <= BREAKPOINTS.tabletMax');
        expect(homeViewportModeSource).toContain("previousMode === nextMode ? previousMode : nextMode");
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

        expect(exists('app/home-initial-shell.tsx')).toBe(false);
        expect(exists('public/home-static.html')).toBe(false);
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
        expect(rootSpeedInsightsSource).toContain("environment.VERCEL === '1'");
        expect(rootSpeedInsightsSource).toContain("= process.env as");
        expect(rootSpeedInsightsSource).toContain("await import('./app-speed-insights')");
        expect(layoutSource).not.toContain('QueryProvider');
        expect(layoutSource).not.toContain('AppProviders');
        expect(layoutSource).not.toContain('MainLayout');
        expect(speedInsightsSource).toContain("import('@vercel/speed-insights/next')");
        expect(speedInsightsSource).toContain("nodeEnv === 'production'");
        expect(speedInsightsSource).toContain('shouldRenderSpeedInsights');
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
    test('bypasses the desktop overlay in public demo mode', () => {
        const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');
        const desktopBranch = homeRuntimeShellSource.slice(
            homeRuntimeShellSource.indexOf("if (viewportMode === 'desktop')"),
            homeRuntimeShellSource.indexOf("function HomeRuntimePendingShell"),
        );

        expect(desktopBranch).toContain('if (isPublicRestrictedMode)');
        expect(desktopBranch).toContain(
            'return <HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>;',
        );
        expect(desktopBranch).toContain('<OverlayLayout>{children}</OverlayLayout>');
    });
});
