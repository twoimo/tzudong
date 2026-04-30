import fs from 'node:fs';
import path from 'node:path';

export const STORYBOARD_ROOT = path.resolve(process.cwd(), 'design', 'pencil');
export const STORYBOARD_INDEX_PATH = path.join(STORYBOARD_ROOT, 'index.md');
export const STORYBOARD_INVENTORY_PATH = path.join(STORYBOARD_ROOT, 'route-inventory.json');
export const STORYBOARD_MANIFEST_PATH = path.join(STORYBOARD_ROOT, 'storyboard-manifest.json');
export const STORYBOARD_REVIEW_QUEUE_DIR = path.join(STORYBOARD_ROOT, 'review-queue');
export const STORYBOARD_CAPTURE_DIR = path.join(STORYBOARD_ROOT, 'captures');
export const STORYBOARD_EXPORT_DIR = path.join(STORYBOARD_ROOT, 'exports');

export const STORYBOARD_TARGETS = [
  {
    id: 'home-map-home',
    flow: 'home-map',
    route: '/',
    label: 'Home map',
    sourcePaths: ['app/page.tsx', 'components/home/HomeMapContainer.tsx', 'components/layout/Header.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'home-map-global-map',
    flow: 'home-map',
    route: '/global-map',
    label: 'Global map',
    sourcePaths: ['app/global-map/page.tsx', 'components/map/MapView.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'discovery-feed',
    flow: 'discovery-content',
    route: '/feed',
    label: 'Feed',
    sourcePaths: ['app/feed/page.tsx', 'components/feed/FeedContent.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'discovery-leaderboard',
    flow: 'discovery-content',
    route: '/leaderboard',
    label: 'Leaderboard',
    sourcePaths: ['app/leaderboard/page.tsx', 'components/leaderboard/LeaderboardList.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'discovery-stamp',
    flow: 'discovery-content',
    route: '/stamp',
    label: 'Stamp',
    sourcePaths: ['app/stamp/page.tsx', 'components/stamp/StampPage.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'user-mypage',
    flow: 'user',
    route: '/mypage',
    label: 'MyPage redirect',
    sourcePaths: ['app/mypage/page.tsx', 'app/mypage/layout.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'user-bookmarks',
    flow: 'user',
    route: '/mypage/bookmarks',
    label: 'MyPage bookmarks',
    sourcePaths: ['app/mypage/bookmarks/page.tsx', 'app/mypage/layout.tsx'],
    fixtureAuthState: 'signed-in',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'user-reviews',
    flow: 'user',
    route: '/mypage/reviews',
    label: 'MyPage reviews',
    sourcePaths: ['app/mypage/reviews/page.tsx', 'app/mypage/layout.tsx'],
    fixtureAuthState: 'signed-in',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'user-submissions-new',
    flow: 'user',
    route: '/mypage/submissions/new',
    label: 'MyPage submissions new',
    sourcePaths: ['app/mypage/submissions/new/page.tsx', 'app/mypage/layout.tsx'],
    fixtureAuthState: 'signed-in',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'submission-list',
    flow: 'review-submission',
    route: '/submissions',
    label: 'Submissions',
    sourcePaths: ['app/submissions/page.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop', 'mobile'],
  },
  {
    id: 'insights-root',
    flow: 'insights-admin',
    route: '/insights',
    label: 'Insights',
    sourcePaths: ['app/insights/page.tsx', 'app/insights/insights-client.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['desktop'],
  },
  {
    id: 'admin-insight',
    flow: 'insights-admin',
    route: '/admin/insight',
    label: 'Admin insight',
    sourcePaths: ['app/admin/insight/page.tsx', 'app/admin/insight/insight-client.tsx'],
    fixtureAuthState: 'admin',
    viewports: ['desktop'],
  },
  {
    id: 'admin-evaluations',
    flow: 'insights-admin',
    route: '/admin/evaluations',
    label: 'Admin evaluations',
    sourcePaths: ['app/admin/evaluations/page.tsx'],
    fixtureAuthState: 'admin',
    viewports: ['desktop'],
  },
  {
    id: 'admin-submissions',
    flow: 'insights-admin',
    route: '/admin/submissions',
    label: 'Admin submissions',
    sourcePaths: ['app/admin/submissions/page.tsx'],
    fixtureAuthState: 'admin',
    viewports: ['desktop'],
  },
  {
    id: 'auth-reset-password',
    flow: 'auth-error-loading',
    route: '/auth/reset-password',
    label: 'Reset password',
    sourcePaths: ['app/auth/reset-password/page.tsx'],
    fixtureAuthState: 'anonymous',
    viewports: ['mobile', 'desktop'],
  },
];

export const STUB_RENDER_STATUS = 'stubbed';

export function ensureStoryboardRoot() {
  fs.mkdirSync(STORYBOARD_ROOT, { recursive: true });
  fs.mkdirSync(STORYBOARD_REVIEW_QUEUE_DIR, { recursive: true });
  fs.mkdirSync(STORYBOARD_CAPTURE_DIR, { recursive: true });
  fs.mkdirSync(STORYBOARD_EXPORT_DIR, { recursive: true });
}

export function slugifyRouteId(route) {
  return route
    .replace(/^\//, '')
    .replace(/\/+/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'home';
}

export function routeToSourcePaths(route) {
  const target = STORYBOARD_TARGETS.find((entry) => entry.route === route);
  return target?.sourcePaths ?? [];
}

export function pathExistsFromRoot(relativePath) {
  return fs.existsSync(path.resolve(process.cwd(), relativePath));
}

export function validateSourcePaths(relativePaths) {
  const missing = relativePaths.filter((relativePath) => !pathExistsFromRoot(relativePath));
  return {
    ok: missing.length === 0,
    missing,
  };
}

export function buildStoryboardInventory() {
  return STORYBOARD_TARGETS.map((target) => {
    const validation = validateSourcePaths(target.sourcePaths);
    return {
      ...target,
      routeId: slugifyRouteId(target.route),
      sourcePathsExist: validation.ok,
      missingSourcePaths: validation.missing,
    };
  });
}

export function buildStoryboardManifest({ inventory = buildStoryboardInventory(), timestamp = new Date().toISOString() } = {}) {
  return inventory.flatMap((target) =>
    target.viewports.map((viewport) => {
      const baseName = `${target.flow}-${target.routeId}-${viewport}`;
      return {
        schemaVersion: 1,
        routeId: target.routeId,
        flow: target.flow,
        route: target.route,
        label: target.label,
        sourcePaths: target.sourcePaths,
        fixtureAuthState: target.fixtureAuthState,
        viewport,
        screenshotPath: path.posix.join('captures', target.flow, `${target.routeId}-${viewport}.png`),
        penPath: path.posix.join('exports', `${baseName}.pen`),
        exportedPreviewPath: path.posix.join('exports', `${baseName}.png`),
        exportedPdfPath: path.posix.join('exports', `${baseName}.pdf`),
        generatedAt: timestamp,
        generatedHash: `${target.routeId}:${viewport}:${target.sourcePaths.join('|')}`,
        owner: 'worker-4',
        status: 'planned',
        reviewNotes: '',
      };
    })
  );
}

export function validateStoryboardManifest(manifest) {
  const errors = [];
  if (!Array.isArray(manifest)) {
    errors.push('manifest must be an array');
    return { ok: false, errors };
  }

  for (const [index, entry] of manifest.entries()) {
    const prefix = `entry[${index}]`;
    if (entry.schemaVersion !== 1) errors.push(`${prefix}: schemaVersion must be 1`);
    if (typeof entry.routeId !== 'string' || !entry.routeId) errors.push(`${prefix}: routeId is required`);
    if (typeof entry.route !== 'string' || !entry.route.startsWith('/')) errors.push(`${prefix}: route is required`);
    if (typeof entry.viewport !== 'string' || !entry.viewport) errors.push(`${prefix}: viewport is required`);
    if (!Array.isArray(entry.sourcePaths) || entry.sourcePaths.length === 0) errors.push(`${prefix}: sourcePaths are required`);
    if (typeof entry.generatedAt !== 'string' || !entry.generatedAt) errors.push(`${prefix}: generatedAt is required`);
    if (typeof entry.generatedHash !== 'string' || !entry.generatedHash) errors.push(`${prefix}: generatedHash is required`);
    if (typeof entry.penPath !== 'string' || !entry.penPath.endsWith('.pen')) errors.push(`${prefix}: penPath must end with .pen`);
    if (typeof entry.exportedPreviewPath !== 'string' || !entry.exportedPreviewPath.endsWith('.png')) errors.push(`${prefix}: exportedPreviewPath must end with .png`);
    if (typeof entry.exportedPdfPath !== 'string' || !entry.exportedPdfPath.endsWith('.pdf')) errors.push(`${prefix}: exportedPdfPath must end with .pdf`);
    if (!['planned', 'captured', 'exported', 'reviewed'].includes(entry.status)) errors.push(`${prefix}: invalid status`);
  }

  return { ok: errors.length === 0, errors };
}

export function buildReviewQueueItem(entry, { deltaSummary = 'visual mismatch needs review', riskLevel = 'medium', acceptanceCriteria = [] } = {}) {
  return {
    id: `${entry.routeId}-${entry.viewport}`,
    routeId: entry.routeId,
    route: entry.route,
    flow: entry.flow,
    viewport: entry.viewport,
    frameId: `${entry.routeId}:${entry.viewport}`,
    exportPath: entry.penPath,
    previewPath: entry.exportedPreviewPath,
    screenshotPath: entry.screenshotPath,
    intendedSourceFiles: entry.sourcePaths,
    visualDeltaSummary: deltaSummary,
    riskLevel,
    acceptanceCriteria,
    directSourceMutationAllowed: false,
  };
}

export function validateReviewQueueItem(item) {
  const errors = [];
  if (typeof item.id !== 'string' || !item.id) errors.push('id is required');
  if (typeof item.routeId !== 'string' || !item.routeId) errors.push('routeId is required');
  if (typeof item.route !== 'string' || !item.route.startsWith('/')) errors.push('route is required');
  if (typeof item.frameId !== 'string' || !item.frameId) errors.push('frameId is required');
  if (typeof item.exportPath !== 'string' || !item.exportPath.endsWith('.pen')) errors.push('exportPath must be a .pen');
  if (typeof item.previewPath !== 'string' || !item.previewPath.endsWith('.png')) errors.push('previewPath must be a .png');
  if (typeof item.screenshotPath !== 'string' || !item.screenshotPath.endsWith('.png')) errors.push('screenshotPath must be a .png');
  if (!Array.isArray(item.intendedSourceFiles) || item.intendedSourceFiles.length === 0) errors.push('intendedSourceFiles required');
  if (item.directSourceMutationAllowed !== false) errors.push('directSourceMutationAllowed must be false');
  return { ok: errors.length === 0, errors };
}

export function buildInventoryMarkdown(inventory) {
  const lines = [
    '# Pencil storyboard route inventory',
    '',
    `- Targets: ${inventory.length}`,
    '',
    '| Flow | Route | Route ID | Auth | Viewports | Source paths |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const target of inventory) {
    lines.push(
      `| ${target.flow} | \`${target.route}\` | \`${target.routeId}\` | ${target.fixtureAuthState} | ${target.viewports.join(', ')} | ${target.sourcePaths.join('<br>')} |`
    );
  }

  return `${lines.join('\n')}\n`;
}

export function buildStoryboardIndexMarkdown({ inventory, manifest }) {
  const lines = [
    '# Pencil storyboard index',
    '',
    '- Source of truth: app routes and component sources',
    `- Inventory: \`${path.relative(process.cwd(), STORYBOARD_INVENTORY_PATH)}\``,
    `- Manifest: \`${path.relative(process.cwd(), STORYBOARD_MANIFEST_PATH)}\``,
    '',
    '## Routes',
    '',
  ];

  for (const target of inventory) {
    lines.push(
      `- ${target.flow} — \`${target.route}\` → ${target.routeId} (${target.fixtureAuthState}, ${target.viewports.join(', ')})`
    );
  }

  lines.push('', '## Artifacts', '');
  const byRoute = new Map();
  for (const entry of manifest) {
    if (!byRoute.has(entry.routeId)) byRoute.set(entry.routeId, []);
    byRoute.get(entry.routeId).push(entry);
  }

  for (const [routeId, entries] of byRoute) {
    lines.push(`- \`${routeId}\` (${entries.length} variants)`);
    for (const entry of entries) {
      lines.push(`  - ${entry.viewport}: ${entry.screenshotPath} / ${entry.penPath}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function buildDriftReport({ inventory, manifest }) {
  const inventoryByRouteId = new Map(inventory.map((target) => [target.routeId, target]));
  const staleEntries = [];
  for (const entry of manifest) {
    const target = inventoryByRouteId.get(entry.routeId);
    if (!target) {
      staleEntries.push(`${entry.routeId}:${entry.viewport} missing target`);
      continue;
    }
    if (!target.sourcePaths.every((relativePath) => pathExistsFromRoot(relativePath))) {
      staleEntries.push(`${entry.routeId}:${entry.viewport} source drift`);
    }
  }

  return {
    ok: staleEntries.length === 0,
    staleEntries,
    checkedAt: new Date().toISOString(),
  };
}
