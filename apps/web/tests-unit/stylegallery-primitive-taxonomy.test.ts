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
          'data-scroll-owner="home-viewport"',
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
          'data-scroll-owner="mobile-control-overlay"',
          'data-user-submitted-marker-toggle="admin-only"',
        ],
      },
      {
        path: 'components/home/SubmissionFloatingButton.tsx',
        contains: [
          'data-layout-primitives="cluster wrap-row overlay-stack"',
          'data-scroll-owner="mobile-control-overlay"',
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
          'data-scroll-owner="visible-marker-list"',
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
    expect(responsiveOverflowSource).toContain('unapprovedPolicyExceptions');
  });
});
