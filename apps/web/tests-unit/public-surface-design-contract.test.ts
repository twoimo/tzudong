import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');
const appDir = join(appRoot, 'app');

const readApp = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'tests',
  'tests-unit',
  'test',
  'fixtures',
]);

const PAGE_MATRIX = [
  'app/page.tsx',
  'app/home-frame/page.tsx',
  'app/feed/page.tsx',
  'app/global-map/page.tsx',
  'app/leaderboard/page.tsx',
  'app/stamp/page.tsx',
  'app/insights/page.tsx',
  'app/mypage/page.tsx',
  'app/mypage/profile/page.tsx',
  'app/mypage/reviews/page.tsx',
  'app/mypage/bookmarks/page.tsx',
  'app/mypage/submissions/new/page.tsx',
  'app/mypage/submissions/edit/page.tsx',
  'app/mypage/submissions/recommend/page.tsx',
  'app/user/[userId]/page.tsx',
  'app/submissions/page.tsx',
  'app/privacy/page.tsx',
  'app/privacy/onboarding/page.tsx',
  'app/data-deletion/page.tsx',
  'app/auth/required/page.tsx',
  'app/auth/reset-password/page.tsx',
  'app/admin/page.tsx',
  'app/admin/evaluations/page.tsx',
  'app/admin/banners/page.tsx',
  'app/admin/submissions/page.tsx',
  'app/admin/privacy-incidents/page.tsx',
  'app/s/[code]/page.tsx',
] as const;

const APP_RUNTIME_LAYOUT_FAMILIES = [
  'admin',
  'auth',
  'feed',
  'global-map',
  'insights',
  'leaderboard',
  'mypage',
  's',
  'stamp',
  'submissions',
  'user',
] as const;

const PRESENT_AND_NULL_LOADING = [
  'app/loading.tsx',
  'app/insights/loading.tsx',
  'app/leaderboard/loading.tsx',
  'app/admin/loading.tsx',
  'app/global-map/loading.tsx',
  'app/mypage/loading.tsx',
  'app/user/[userId]/loading.tsx',
  'app/auth/reset-password/loading.tsx',
] as const;

const PRESENT_AND_SKELETON_LOADING = ['app/stamp/loading.tsx'] as const;

const FAMILY_ERROR_FILES = [
  'app/error.tsx',
  'app/feed/error.tsx',
  'app/global-map/error.tsx',
  'app/mypage/error.tsx',
] as const;

const CSS_OWNERS = [
  'app/globals.css',
  'app/home-app-globals.css',
  'app/app-globals.css',
  'app/home-deferred-globals.css',
  'app/home-detail-globals.css',
] as const;

const CSS_IMPORTERS = {
  'app/globals.css': { importer: 'app/layout.tsx', needle: 'import "./globals.css"' },
  'app/home-app-globals.css': {
    importer: 'app/home-runtime-shell.tsx',
    needle: "import './home-app-globals.css'",
  },
  'app/app-globals.css': {
    importer: 'app/app-runtime-shell.tsx',
    needle: "import './app-globals.css'",
  },
  'app/home-deferred-globals.css': {
    importer: 'app/home-client-sidepanels.tsx',
    needle: "import './home-deferred-globals.css'",
  },
  'app/home-detail-globals.css': {
    importer: 'components/map/map-view-deferred-panels.tsx',
    needle: "import '@/app/home-detail-globals.css'",
  },
} as const;

const FROZEN_SOURCE_SCOPES: Record<string, readonly string[]> = {
  'app/home-app-globals.css': [
    '@source "./page.tsx";',
    '@source "./home-runtime-shell.tsx";',
    '@source "./home-client.tsx";',
    '@source "./home-client-effects.tsx";',
    '@source "./app-providers.tsx";',
    '@source "./providers.tsx";',
    '@source "../hooks";',
    '@source "../contexts";',
    '@source "../components/home";',
    '@source "../components/layout";',
    '@source "../components/map";',
    '@source "../components/search";',
    '@source "../components/filters";',
    '@source "../components/region";',
    '@source "../components/skeletons";',
    '@source "../components/ui";',
    '@source "../lib/naver-map-overlay-position-helpers.ts";',
    '@source "../lib/naver-map-overlay-timings.ts";',
  ],
  'app/app-globals.css': [
    '@source "../app";',
    '@source "../components";',
    '@source "../pages";',
    '@source "../lib";',
    '@source not "../**/*.{test,spec}.{js,jsx,ts,tsx}";',
    '@source not "../**/*.{stories,story}.{js,jsx,ts,tsx}";',
    '@source not "../{tests-unit,test,tests,fixtures}/**";',
  ],
  'app/home-deferred-globals.css': [
    '@source "./home-client-sidepanels.tsx";',
    '@source "../components/admin";',
    '@source "../components/announcement";',
    '@source "../components/modals";',
    '@source "../components/ui";',
    '@source not "../**/*.test.*";',
    '@source not "../tests-unit";',
  ],
  'app/home-detail-globals.css': [
    '@source "../components/restaurant";',
    '@source "../components/reviews";',
    '@source "../components/auth";',
    '@source "../components/ui";',
    '@source not "../**/*.test.*";',
    '@source not "../tests-unit";',
  ],
};

const APPROVED_HORIZONTAL_SCROLL_OWNERS = [
  'mobile-theme-filter-reel',
  'admin-dashboard-action-bar',
  'admin-dashboard-series-toggle',
  'admin-dashboard-card-title-actions',
  'admin-dashboard-kpi-title-actions',
  'stamp-restaurant-list-table',
  'admin-evaluation-table',
  'storyboard-canvas-toolbar',
  'storyboard-chat-examples',
  'storyboard-chat-attachments',
] as const;

const LIGHT_TOKEN_LITERALS = [
  '--background: 38 30% 98%',
  '--primary: 0 74% 42%',
  '--radius: 0.5rem',
  '--app-header-height: 56px',
  '--mobile-bottom-nav-height: 60px',
] as const;

function walkFiles(
  root: string,
  predicate: (name: string) => boolean,
  options: { skipDirs?: Set<string>; prefix?: string } = {},
): string[] {
  const found: string[] = [];
  const skipDirs = options.skipDirs ?? new Set<string>();
  const prefix = options.prefix ?? `${relative(appDir, root) ? '' : 'app'}`;
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (predicate(entry.name)) {
        const rel = relative(root, fullPath).split('\\').join('/');
        found.push(prefix ? `${prefix}/${rel}` : rel);
      }
    }
  };
  visit(root);
  return found.sort();
}

function classifyLoading(source: string): 'present-and-null' | 'present-and-skeleton' | 'other' {
  if (/return\s+null\s*;/.test(source)) {
    return 'present-and-null';
  }
  if (source.includes('StampPageSkeleton')) {
    return 'present-and-skeleton';
  }
  return 'other';
}

function pathSourceScopes(css: string): string[] {
  return css
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('@source ') && !line.startsWith('@source inline('));
}

function collectOwnerAttributeValues(root: string): string[] {
  const owners = new Set<string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        continue;
      }
      const source = readFileSync(fullPath, 'utf8');
      for (const match of source.matchAll(/data-horizontal-scroll-owner="([^"]+)"/g)) {
        owners.add(match[1]);
      }
      for (const match of source.matchAll(/horizontalScrollOwner="([^"]+)"/g)) {
        owners.add(match[1]);
      }
    }
  };
  visit(root);
  return [...owners].sort();
}

function walkCssUnder(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (entry.name.endsWith('.css')) {
        found.push(relative(appRoot, fullPath).split('\\').join('/'));
      }
    }
  };
  visit(root);
  return found.sort();
}

describe('public surface design contract', () => {
  test('page inventory is exactly the 27-row matrix', () => {
    const actual = walkFiles(appDir, (name) => name === 'page.tsx');
    expect(actual).toEqual([...PAGE_MATRIX].sort());
    expect(actual).toHaveLength(27);
  });

  test('loading files use the three-way taxonomy and do not treat null loaders as missing', () => {
    const actualLoading = walkFiles(appDir, (name) => name === 'loading.tsx');
    expect(actualLoading).toEqual(
      [...PRESENT_AND_NULL_LOADING, ...PRESENT_AND_SKELETON_LOADING].sort(),
    );

    for (const relativePath of PRESENT_AND_NULL_LOADING) {
      expect(classifyLoading(readApp(relativePath))).toBe('present-and-null');
    }

    expect(classifyLoading(readApp('app/stamp/loading.tsx'))).toBe('present-and-skeleton');
    expect(existsSync(join(appRoot, 'app/feed/loading.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/home-frame/loading.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/privacy/loading.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/data-deletion/loading.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/auth/required/loading.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/s/[code]/loading.tsx'))).toBe(false);
  });

  test('error files stay at root plus feed, global-map, and mypage', () => {
    const actualErrors = walkFiles(appDir, (name) => name === 'error.tsx');
    expect(actualErrors).toEqual([...FAMILY_ERROR_FILES].sort());
    expect(existsSync(join(appRoot, 'app/stamp/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/leaderboard/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/insights/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/admin/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/auth/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/user/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/s/error.tsx'))).toBe(false);
  });

  test('AppRuntimeLayout families are exactly the eleven segment layouts', () => {
    const layoutFiles = walkFiles(appDir, (name) => name === 'layout.tsx');
    const layoutsUsingRuntime = layoutFiles.filter((relativePath) =>
      readApp(relativePath).includes('AppRuntimeLayout'),
    );
    expect(layoutsUsingRuntime).toEqual(
      APP_RUNTIME_LAYOUT_FAMILIES.map((family) => `app/${family}/layout.tsx`).sort(),
    );

    const families = APP_RUNTIME_LAYOUT_FAMILIES.filter((family) => {
      const layoutSource = readApp(`app/${family}/layout.tsx`);
      return layoutSource.includes('AppRuntimeLayout');
    });
    expect(families).toEqual([...APP_RUNTIME_LAYOUT_FAMILIES]);
    expect(readApp('app/privacy/page.tsx')).not.toContain('AppRuntimeLayout');
    expect(readApp('app/data-deletion/page.tsx')).not.toContain('AppRuntimeLayout');
    expect(existsSync(join(appRoot, 'app/privacy/layout.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/data-deletion/layout.tsx'))).toBe(false);
    expect(readApp('app/s/[code]/page.tsx')).toContain('notFound()');
    expect(readApp('app/s/layout.tsx')).toContain('AppRuntimeLayout');
  });

  test('pins all five CSS owner-to-importer mappings and forbids a sixth Tailwind entry', () => {
    const cssFiles = walkCssUnder(appDir);
    expect(cssFiles).toEqual([...CSS_OWNERS].sort());

    for (const [owner, { importer, needle }] of Object.entries(CSS_IMPORTERS)) {
      expect(readApp(importer)).toContain(needle);
    }

    const shellSources = [
      readApp('app/layout.tsx'),
      readApp('app/home-runtime-shell.tsx'),
      readApp('app/app-runtime-shell.tsx'),
    ].join('\n');
    expect(shellSources).not.toContain('home-deferred-globals.css');
    expect(shellSources).not.toContain('home-detail-globals.css');

    expect(readApp('app/globals.css')).not.toContain('@import "tailwindcss"');
    expect(readApp('app/globals.css')).not.toMatch(/^@source /m);

    const tailwindOwners = CSS_OWNERS.filter((owner) => owner !== 'app/globals.css');
    for (const owner of tailwindOwners) {
      expect(readApp(owner)).toContain('@import "tailwindcss" source(none);');
    }
    expect(tailwindOwners).toHaveLength(4);

    const allCss = walkCssUnder(appRoot);
    const extraTailwind = allCss.filter((relativePath) => {
      if ((CSS_OWNERS as readonly string[]).includes(relativePath)) {
        return false;
      }
      return readFileSync(join(appRoot, relativePath), 'utf8').includes('@import "tailwindcss"');
    });
    expect(extraTailwind).toEqual([]);
  });

  test('freezes each Tailwind owner path and not @source scope', () => {
    for (const [owner, expected] of Object.entries(FROZEN_SOURCE_SCOPES)) {
      expect(pathSourceScopes(readApp(owner))).toEqual([...expected]);
    }
    expect(pathSourceScopes(readApp('app/globals.css'))).toEqual([]);
  });

  test('records dual 404 contexts and keeps not-found a server module', () => {
    const notFoundSource = readApp('app/not-found.tsx');
    expect(notFoundSource).not.toMatch(/['"]use client['"]/);
    expect(notFoundSource).not.toContain('CenteredErrorState');
    expect(notFoundSource).toContain('keep 404 server-rendered');
    expect(notFoundSource).toContain('data-centered-error-state="viewport"');
    expect(notFoundSource).toContain('width="20"');
    expect(notFoundSource).toContain('data-centered-error-icon="true"');
    expect(notFoundSource).toContain('data-centered-error-actions="true"');
    expect(readApp('app/globals.css')).toContain('[data-centered-error-icon="true"]');
    expect(readApp('app/globals.css')).toContain('margin-top: 0');

    expect(readApp('app/globals.css')).toContain('[data-centered-error-state="viewport"]');

    expect(notFoundSource).toContain('페이지를 찾을 수 없습니다');
    expect(notFoundSource).toContain('홈으로 이동');
    expect(notFoundSource).toContain('bg-background');
    expect(notFoundSource).toContain('text-muted-foreground');
    expect(notFoundSource).not.toContain('CenteredErrorState');
    expect(readApp('app/error.tsx')).toContain('CenteredErrorState');
    expect(readApp('app/s/[code]/page.tsx')).toContain('notFound()');
    expect(readApp('app/layout.tsx')).toContain('import "./globals.css"');
    expect(readApp('app/layout.tsx')).not.toContain('app-globals.css');
    expect(readApp('app/s/layout.tsx')).toContain('AppRuntimeLayout');
  });

  test('imports the shared light-mode token partial with per-owner cascade context', () => {
    const partial = readFileSync(join(appRoot, 'styles/light-root-tokens.css'), 'utf8');
    for (const literal of LIGHT_TOKEN_LITERALS) {
      expect(partial).toContain(literal);
    }
    expect(partial).not.toMatch(/^\.dark\s*\{/m);
    expect(partial).not.toContain('--primary: 0 74% 50%');
    expect(partial).not.toContain('@import "tailwindcss"');
    expect(partial).not.toContain('@source');

    const globalsSource = readApp('app/globals.css');
    expect(globalsSource).toContain('@import "../styles/light-root-tokens.css";');
    expect(globalsSource.indexOf('@import "../styles/light-root-tokens.css";')).toBeLessThan(
      globalsSource.indexOf(':root {'),
    );
    expect(globalsSource).not.toMatch(/@layer base[\s\S]*@import "\.\.\/styles\/light-root-tokens\.css"/);
    expect(globalsSource).not.toContain('--primary: 0 74% 50%');

    for (const owner of [
      'app/home-app-globals.css',
      'app/app-globals.css',
      'app/home-deferred-globals.css',
      'app/home-detail-globals.css',
    ]) {
      const source = readApp(owner);
      expect(source).toContain('@layer base {');
      expect(source).toContain('@import "../styles/light-root-tokens.css";');
      expect(source.indexOf('@layer base {')).toBeLessThan(
        source.indexOf('@import "../styles/light-root-tokens.css";'),
      );
    }

    expect(readApp('app/app-globals.css')).toContain('--primary: 0 74% 50%');
    expect(readApp('app/app-globals.css')).toContain('--admin-sidebar-expanded-width: 14rem');
  });

  test('horizontal allowlist enumerates data-horizontal-scroll-owner values only', () => {
    const owners = collectOwnerAttributeValues(appRoot);
    expect(owners).toEqual([...APPROVED_HORIZONTAL_SCROLL_OWNERS].sort());
    expect(owners).not.toContain('naver-cluster');
    expect(owners).not.toContain('naver-map-cluster');
    const designSource = readFileSync(resolve(appRoot, '..', '..', 'docs/product/DESIGN.md'), 'utf8');
    expect(designSource).toContain(
      'Naver map cluster marker overflow remains a provider-specific exception outside this policy',
    );
  });

  test('family chrome stays Korean-first and legal pages stay chrome-less', () => {
    expect(readApp('app/privacy/page.tsx')).not.toContain('AppRuntimeLayout');
    expect(readApp('app/data-deletion/page.tsx')).not.toContain('AppRuntimeLayout');
    expect(readApp('app/privacy/page.tsx')).toContain('border-border');
    expect(readApp('app/data-deletion/page.tsx')).toContain('border-border');
    expect(readApp('app/privacy/page.tsx')).toContain('overflow-x-hidden');
    expect(readApp('app/data-deletion/page.tsx')).toContain('overflow-x-hidden');
    expect(readApp('app/privacy/page.tsx')).toContain('data-legal-page="true"');
    expect(readApp('app/data-deletion/page.tsx')).toContain('data-legal-page="true"');
    expect(readApp('app/globals.css')).toContain('[data-legal-page="true"]');
    expect(readApp('app/data-deletion/page.tsx')).toContain('min-w-0 break-all font-mono');
    expect(readApp('app/auth/required/page.tsx')).toContain('로그인이 필요합니다');
    expect(readApp('app/auth/required/page.tsx')).not.toContain('🔐');
    expect(readApp('app/auth/reset-password/page.tsx')).not.toContain('🔒');
    expect(readApp('app/auth/reset-password/page.tsx')).not.toContain('🔥');
    expect(readApp('components/home/home-map-container.tsx')).toContain(
      'data-layout-primitives="viewport-shell overlay-stack cluster"',
    );
    expect(readApp('components/home/MobileControlOverlay.tsx')).toContain(
      'data-horizontal-scroll-owner="mobile-theme-filter-reel"',
    );
    expect(readApp('app/mypage/layout.tsx')).toContain('MyPageLayoutContent');
    expect(readApp('components/admin/AdminOverviewDashboard.tsx')).toContain(
      'aria-label="관리자 지도 운영 개요 2분할"',
    );
    expect(existsSync(join(appRoot, 'app/stamp/error.tsx'))).toBe(false);
    expect(existsSync(join(appRoot, 'app/admin/error.tsx'))).toBe(false);
  });
});
