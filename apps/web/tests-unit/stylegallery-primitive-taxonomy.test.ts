import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const appRoot = join(import.meta.dir, '..');

const canonicalStyleGalleryPrimitives = [
  'viewport-shell',
  'scroll-body-shell',
  'fixed-sidenav-shell',
  'panel-layout',
  'list-detail',
  'sidebar',
  'split-sidebar',
  'cluster',
  'wrap-row',
  'card-grid',
  'overlay-stack',
  'frame',
  'form-flow',
  'sticky-footer',
  'stack',
  'step-nav',
  'reel',
] as const;

const primitiveAllowlist = new Set<string>(canonicalStyleGalleryPrimitives);

const packageABindingCoverageMatrix = {
  publicHomeShell: ['viewport-shell', 'overlay-stack', 'cluster'],
  naverMap: ['overlay-stack', 'frame'],
  mobileControls: ['cluster', 'wrap-row', 'overlay-stack'],
  homeMobileThemeFilterReel: ['reel', 'cluster'],
  visibleMarkerListDetail: ['list-detail', 'frame', 'stack'],
  adminShellSidebar: ['fixed-sidenav-shell', 'scroll-body-shell', 'sidebar'],
  adminOverviewMapInfo: ['panel-layout', 'list-detail', 'frame', 'cluster'],
  trendProposalQueue: ['list-detail', 'card-grid', 'cluster', 'stack'],
  overlayPreviewApplyPanel: ['form-flow', 'sticky-footer', 'stack', 'cluster'],
  routePlanner: ['panel-layout', 'list-detail', 'step-nav', 'cluster', 'frame'],
  storyboardAdmin: ['split-sidebar', 'panel-layout', 'list-detail', 'frame', 'step-nav', 'stack'],
} as const satisfies Record<string, readonly string[]>;

type SourceCoverageContract = {
  files: readonly {
    path: string;
    contains: readonly string[];
  }[];
  futurePackage?: true;
};

const g003SourceCoverageMatrix = {
  publicHomeShell: {
    files: [
      {
        path: 'components/home/home-map-container.tsx',
        contains: [
          'data-layout-primitives="viewport-shell overlay-stack cluster"',
          'data-scroll-owner="map-canvas-none"',
          'role="region"',
          'aria-label="쯔동여지도 홈 지도 화면"',
        ],
      },
      {
        path: 'app/home-client.tsx',
        contains: [
          'const HomeMapContainer = dynamic(',
          '() => import("../components/home/home-map-container")',
          '<HomeMapContainer',
        ],
      },
    ],
  },
  naverMap: {
    files: [
      {
        path: 'components/map/naver-map-surface.tsx',
        contains: [
          'data-layout-primitives="overlay-stack frame"',
          'data-scroll-owner="map-canvas-none"',
          'data-map-layer-signature="naver-map-surface"',
        ],
      },
      {
        path: 'components/map/NaverMapView.tsx',
        contains: [
          'import { NaverMapSurface } from "@/components/map/naver-map-surface";',
          'markerLayerVersion',
          '<NaverMapSurface',
        ],
      },
    ],
  },
  homeMobileThemeFilterReel: {
    files: [
      {
        path: 'components/home/MobileControlOverlay.tsx',
        contains: [
          'id="tzudong-mobile-category-slider"',
          'data-layout-primitives="reel cluster"',
          'data-allow-horizontal-scroll="true"',
          'data-horizontal-scroll-owner="mobile-theme-filter-reel"',
        ],
      },
    ],
  },
  mobileControls: {
    files: [
      {
        path: 'components/home/MobileControlOverlay.tsx',
        contains: [
          'data-layout-primitives="cluster wrap-row overlay-stack"',
          'data-fixed-control-region="mobile-map-top-controls"',
          'data-user-submitted-marker-toggle="admin-only"',
        ],
      },
      {
        path: 'components/home/SubmissionFloatingButton.tsx',
        contains: [
          'data-layout-primitives="cluster wrap-row overlay-stack"',
          'data-fixed-control-region="map-submission-actions"',
          'data-user-submitted-marker-toggle="admin-only"',
        ],
      },
    ],
  },
  visibleMarkerListDetail: {
    files: [
      {
        path: 'components/home/MobileControlOverlay.tsx',
        contains: [
          'data-layout-primitives="list-detail frame stack"',
          'data-scroll-owner="home-mobile-list-sheet"',
          'data-mobile-visible-marker-restaurants-sheet="true"',
        ],
      },
    ],
  },
  adminShellSidebar: {
    files: [
      {
        path: 'components/admin/AdminConsoleOverview.tsx',
        contains: [
          'data-layout-primitives="fixed-sidenav-shell scroll-body-shell sidebar"',
          'data-scroll-owner="admin-canvas"',
        ],
      },
    ],
  },
  adminOverviewMapInfo: {
    files: [
      {
        path: 'components/admin/AdminOverviewDashboard.tsx',
        contains: [
          'data-layout-primitives="panel-layout list-detail frame cluster"',
          'data-scroll-owner="admin-overview-canvas"',
          'data-admin-overview-layout="two-pane"',
          'data-admin-map-pane',
          'data-admin-info-pane',
          'data-scroll-owner="map-canvas-none"',
          'data-scroll-owner="admin-overview-info-pane"',
        ],
      },
    ],
  },
  routePlanner: {
    files: [
      {
        path: 'components/admin/AdminOverviewDashboard.tsx',
        contains: [
          'data-layout-primitives="panel-layout list-detail step-nav cluster frame"',
          'data-scroll-owner="route-control-pane"',
          'data-admin-route-planner',
          'data-admin-route-candidate-readback',
          'data-admin-route-export',
        ],
      },
    ],
  },
  storyboardAdmin: {
    files: [
      {
        path: 'components/admin/storyboard/AdminStoryboardGenerator.tsx',
        contains: [
          'data-layout-primitives="split-sidebar panel-layout list-detail frame step-nav stack"',
          'data-storyboard-job-status',
          'data-scroll-owner="storyboard-chat"',
        ],
      },
      {
        path: 'components/admin/storyboard/StoryboardCanvasShell.tsx',
        contains: [
          'data-layout-primitives="panel-layout frame stack"',
          'data-scroll-owner="storyboard-canvas"',
          'data-scroll-owner="storyboard-readback"',
        ],
      },
    ],
  },
  trendProposalQueue: {
    futurePackage: true,
    files: [
      {
        path: 'components/admin/TrendProposalQueue.tsx',
        contains: [
          'data-layout-primitives="list-detail card-grid cluster stack"',
          'data-scroll-owner="trend-proposal-queue"',
        ],
      },
    ],
  },
  overlayPreviewApplyPanel: {
    futurePackage: true,
    files: [
      {
        path: 'components/admin/OverlayPreviewApplyPanel.tsx',
        contains: [
          'data-layout-primitives="form-flow sticky-footer stack cluster"',
          'data-scroll-owner="overlay-preview-apply-panel"',
        ],
      },
    ],
  },
} as const satisfies Record<keyof typeof packageABindingCoverageMatrix, SourceCoverageContract>;

const sourceRoots = ['app', 'components', 'lib'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

function walkSourceFiles(relativeRoot: string): string[] {
  const absoluteRoot = join(appRoot, relativeRoot);
  const entries = readdirSync(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(absoluteRoot, entry.name);
    const relativePath = relative(appRoot, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      files.push(...walkSourceFiles(relativePath));
      continue;
    }

    if (!entry.isFile()) continue;
    const extension = entry.name.match(/\.[^.]+$/)?.[0] ?? '';
    if (sourceExtensions.has(extension)) files.push(relativePath);
  }

  return files;
}

function readSource(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), 'utf8');
}
const publicMapLayoutSources = [
  'components/home/home-map-container.tsx',
  'components/home/MobileControlOverlay.tsx',
  'components/home/SubmissionFloatingButton.tsx',
  'components/map/naver-map-surface.tsx',
] as const;

function collectScrollOwners(source: string) {
  return Array.from(source.matchAll(/data-scroll-owner="([^"]+)"/g), (match) => match[1]);
}

function collectLayoutPrimitiveTokens() {
  const findings: Array<{ file: string; token: string; value: string }> = [];
  const staticAttributePattern = /data-layout-primitives\s*=\s*(?:{\s*)?(["'`])([^"'`]*?)\1(?:\s*})?/g;

  for (const file of sourceRoots.flatMap(walkSourceFiles)) {
    if (!statSync(join(appRoot, file)).isFile()) continue;
    const source = readSource(file);
    for (const match of source.matchAll(staticAttributePattern)) {
      const value = match[2] ?? '';
      for (const token of value.split(/\s+/).map((item) => item.trim()).filter(Boolean)) {
        findings.push({ file, token, value });
      }
    }
  }

  return findings;
}

function collectDynamicLayoutPrimitiveAttributes() {
  const findings: Array<{ file: string; expression: string }> = [];
  const dynamicAttributePattern = /data-layout-primitives\s*=\s*{\s*(?!["'`])/g;

  for (const file of sourceRoots.flatMap(walkSourceFiles)) {
    if (!statSync(join(appRoot, file)).isFile()) continue;
    const source = readSource(file);
    for (const match of source.matchAll(dynamicAttributePattern)) {
      const expressionStart = (match.index ?? 0) + match[0].length;
      findings.push({ file, expression: source.slice(expressionStart, expressionStart + 80).trim() });
    }
  }

  return findings;
}

function sourceFileExists(relativePath: string) {
  return existsSync(join(appRoot, relativePath));
}

function assertSourceCoverage(surface: string, contract: SourceCoverageContract) {
  const existingFiles = contract.files.filter(({ path }) => sourceFileExists(path));

  if (contract.futurePackage && existingFiles.length === 0) {
    expect(existingFiles, `${surface} is a future Package H/L surface until its source file exists`).toEqual([]);
    return;
  }

  expect(existingFiles.map(({ path }) => path), `${surface} should have required source files`).toEqual(
    contract.files.map(({ path }) => path),
  );

  for (const file of contract.files) {
    const source = readSource(file.path);

    for (const expectedSource of file.contains) {
      expect(source, `${surface} source ${file.path} should contain ${expectedSource}`).toContain(expectedSource);
    }
  }
}

describe('StyleGallery primitive taxonomy source contract', () => {
  test('keeps Package A/G003 binding matrix primitives inside the canonical allowlist', () => {
    expect(canonicalStyleGalleryPrimitives).toHaveLength(17);

    for (const [surface, requiredPrimitives] of Object.entries(packageABindingCoverageMatrix)) {
      expect(requiredPrimitives.length, `${surface} should bind at least one primitive`).toBeGreaterThan(0);
      for (const primitive of requiredPrimitives) {
        expect(primitiveAllowlist.has(primitive), `${surface} requires unknown primitive ${primitive}`).toBe(true);
      }
    }
  });

  test('requires current G003 surfaces to expose static layout and scroll-owner source hooks', () => {
    for (const [surface, contract] of Object.entries(g003SourceCoverageMatrix)) {
      assertSourceCoverage(surface, contract);
    }
  });

  test('fails on unknown data-layout-primitives tokens without requiring future hooks to exist', () => {
    const tokens = collectLayoutPrimitiveTokens();
    const unknownTokens = tokens.filter(({ token }) => !primitiveAllowlist.has(token));

    expect(unknownTokens).toEqual([]);
    expect(collectDynamicLayoutPrimitiveAttributes()).toEqual([]);
  });
  test('G012 public map states declare one task-owned vertical scroll region', () => {
    const homeMapSource = readSource('components/home/home-map-container.tsx');
    const mobileControlsSource = readSource('components/home/MobileControlOverlay.tsx');
    const submissionSource = readSource('components/home/SubmissionFloatingButton.tsx');
    const mapSurfaceSource = readSource('components/map/naver-map-surface.tsx');

    expect(collectScrollOwners(homeMapSource)).toEqual([
      'map-canvas-none',
      'home-desktop-detail-panel',
      'home-mobile-detail-sheet',
    ]);
    expect(collectScrollOwners(mobileControlsSource)).toEqual(['home-mobile-list-sheet']);
    expect(collectScrollOwners(submissionSource)).toEqual([]);
    expect(collectScrollOwners(mapSurfaceSource)).toEqual(['map-canvas-none']);

    expect(homeMapSource).toContain('{isDesktop && renderDesktopDetailPanel && (');
    expect(homeMapSource).toContain('{isMobileOrTablet && isPanelOpen && !isMapFullscreen && (');
    expect(mobileControlsSource).toContain("{activeSheet !== 'none' && activeSheet !== 'search' && (");

    for (const obsoleteOwner of [
      'home-viewport',
      'home-bottom-sheet',
      'mobile-control-overlay',
      'visible-marker-list',
    ]) {
      expect(`${homeMapSource}\n${mobileControlsSource}\n${submissionSource}`).not.toContain(
        `data-scroll-owner="${obsoleteOwner}"`,
      );
    }
  });

  test('G012 public map keeps the reel narrow and fixed controls shrink-safe and keyboard-safe', () => {
    const homeMapSource = readSource('components/home/home-map-container.tsx');
    const mobileControlsSource = readSource('components/home/MobileControlOverlay.tsx');
    const submissionSource = readSource('components/home/SubmissionFloatingButton.tsx');
    const mapSurfaceSource = readSource('components/map/naver-map-surface.tsx');
    const publicMapSource = publicMapLayoutSources.map(readSource).join('\n');
    const horizontalOverflowUtilities = Array.from(
      publicMapSource.matchAll(/\boverflow-x-(?:auto|scroll)\b/g),
      (match) => match[0],
    );
    const horizontalOwners = Array.from(
      publicMapSource.matchAll(/data-horizontal-scroll-owner="([^"]+)"/g),
      (match) => match[1],
    );

    expect(horizontalOverflowUtilities).toEqual(['overflow-x-auto']);
    expect(horizontalOwners).toEqual(['mobile-theme-filter-reel']);
    expect(mobileControlsSource).toContain('data-allow-horizontal-scroll="true"');
    expect(mobileControlsSource).toContain('id="tzudong-mobile-category-slider"');

    expect(homeMapSource).toContain(
      'className="relative h-full min-h-0 min-w-0 w-full overflow-hidden',
    );
    expect(homeMapSource).toContain("'min-h-0 min-w-0 overflow-hidden flex flex-col'");
    expect(homeMapSource).toContain('className="min-h-0 flex-1 overflow-hidden"');
    expect(homeMapSource).toContain("'pb-[env(safe-area-inset-bottom)]'");
    expect(mapSurfaceSource).toContain(
      "cn('relative h-full min-h-0 min-w-0 w-full overflow-hidden', className)",
    );

    expect(mobileControlsSource).toContain('doesMobileSheetOwnFixedControlSpace');
    expect(mobileControlsSource).toContain('{shouldRenderMobileBottomControls && (');
    expect(mobileControlsSource).toContain('{shouldRenderMobileFloatingActions && (');
    expect(mobileControlsSource).toContain(
      'bottom-[calc(env(safe-area-inset-bottom)+var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1rem)]',
    );
    expect(submissionSource).toContain('env(safe-area-inset-bottom)');
    expect(submissionSource).toContain('env(safe-area-inset-right)');
    expect(mobileControlsSource).toContain('aria-label="지도 상단 제어"');
    expect(mobileControlsSource).toContain('aria-label="맛집 검색 열기"');
    expect(mobileControlsSource).toContain('focus-visible:ring-2 focus-visible:ring-primary');
    expect(mobileControlsSource).toContain('getFocusTrapContainers(searchLayerRef.current');
    expect(mobileControlsSource).toContain('focus({ preventScroll: true })');
    expect(mobileControlsSource).toContain('mobileSheetTriggerRef');
    expect(mobileControlsSource).toContain('data-mobile-map-sheet-trigger');
    expect(mobileControlsSource).toContain(
      '[data-bottom-sheet-layout-source="mobile-control-overlay-sheet"]',
    );
    expect(submissionSource).toContain('aria-label="맛집 제보하기"');
    expect(submissionSource).toContain('role="group"');
  });

  test('G012 public map retains public boundaries and lazy map entry points', () => {
    const sources = publicMapLayoutSources.map(readSource);
    const mobileControlsSource = readSource('components/home/MobileControlOverlay.tsx');
    const submissionSource = readSource('components/home/SubmissionFloatingButton.tsx');
    const homeMapSource = readSource('components/home/home-map-container.tsx');
    const homeClientSource = readSource('app/home-client.tsx');

    for (const source of sources) {
      expect(source).not.toContain('@/components/admin/');
      expect(source).not.toContain('/api/admin/');
      expect(source).not.toContain('map-overlays');
      expect(source).not.toContain('trend-proposals');
    }

    expect(mobileControlsSource).toContain('{isAdmin && (');
    expect(submissionSource).toContain('{isAdmin && (');
    expect(homeMapSource).toContain('const NaverMapView = lazy(() => import("@/components/map/NaverMapView"));');
    expect(homeMapSource).toContain('const OverseasMap = lazy(() => import("@/components/map/OverseasMap"));');
    expect(homeMapSource).toContain('const RestaurantDetailPanel = lazy(() =>');
    expect(homeMapSource).toContain('<Suspense fallback={null}>');
    expect(homeClientSource).toContain('const HomeMapContainer = dynamic(');
    expect(homeClientSource).toContain('() => import("../components/home/home-map-container")');
    expect(homeClientSource).toContain('const HomeControlPanel = dynamic(');
    expect(homeClientSource).toContain('const SubmissionFloatingButton = dynamic(');
  });
  test('requires approved owners for horizontal-scroll policy exceptions', () => {
    const tableSource = readSource('components/ui/table.tsx');
    const stampPageSource = readSource('app/stamp/page.tsx');
    const evaluationTableSource = readSource('components/admin/EvaluationTableNew.tsx');
    const responsiveOverflowSource = readSource('tests/responsive-overflow.spec.ts');

    for (const owner of [
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
    ]) {
      expect(tableSource).toContain(owner);
      expect(responsiveOverflowSource).toContain(owner);
    }

    expect(tableSource).toContain('export type HorizontalScrollOwner');
    expect(tableSource).toContain('horizontalScrollOwner?: HorizontalScrollOwner');
    expect(tableSource).toContain(
      'data-allow-horizontal-scroll={allowHorizontalScroll && horizontalScrollOwner ? "true" : undefined}',
    );
    expect(tableSource).toContain(
      'data-horizontal-scroll-owner={allowHorizontalScroll && horizontalScrollOwner ? horizontalScrollOwner : undefined}',
    );
    expect(stampPageSource).toContain('horizontalScrollOwner="stamp-restaurant-list-table"');
    expect(evaluationTableSource).toContain('horizontalScrollOwner="admin-evaluation-table"');
    expect(responsiveOverflowSource).toContain("'storyboard-canvas-toolbar'");
    expect(responsiveOverflowSource).toContain("'/admin?module=storyboard'");
    expect(responsiveOverflowSource).toContain("'storyboard-chat-examples'");
    expect(responsiveOverflowSource).toContain("'storyboard-chat-attachments'");
    expect(tableSource).not.toContain('admin-module-header-actions');
    expect(responsiveOverflowSource).not.toContain('admin-module-header-actions');
    expect(responsiveOverflowSource).toContain('unapprovedPolicyExceptions');
  });
  test('records the pinned unlicensed clean-room adoption boundary', () => {
    const matrix = JSON.parse(readSource('stylegallery-adoption.v1.json')) as {
      schemaVersion: number;
      source: {
        repository: string;
        commit: string;
        licenseStatus: string;
        usageBoundary: string;
      };
      entries: Array<{
        sourceUse: string;
        targetPaths: string[];
        ownershipBoundary: string;
        rejectedAlternatives: string[];
        verification: string[];
      }>;
    };

    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.source.repository).toBe('changeroa/StyleGallery');
    expect(matrix.source.commit).toBe('775430bbaf4ee208a642220f440f6926d79c90a3');
    expect(matrix.source.licenseStatus).toBe('unlicensed');
    expect(matrix.source.usageBoundary).toContain('no upstream code, CSS, prose, names, tests, assets');
    expect(matrix.entries).toHaveLength(4);

    for (const entry of matrix.entries) {
      expect(entry.sourceUse).toStartWith('Question only:');
      expect(entry.ownershipBoundary.length).toBeGreaterThan(20);
      expect(entry.rejectedAlternatives.length).toBeGreaterThan(0);
      expect(entry.verification.length).toBeGreaterThan(0);
      for (const targetPath of entry.targetPaths) {
        expect(targetPath).toStartWith('apps/web/');
        expect(existsSync(join(appRoot, targetPath.slice('apps/web/'.length)))).toBe(true);
      }
    }
  });
});
