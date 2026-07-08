import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const appRoot = join(import.meta.dir, '..');
const adminApiRoot = join(appRoot, 'app/api/admin');

const storyboardRagRoutePaths = new Set([
  'app/api/admin/storyboard/rag/documents/route.ts',
  'app/api/admin/storyboard/rag/search/route.ts',
]);

const acceptedAuthHelperPath = 'lib/admin/storyboard/rag-actions-auth.ts';

const publicHomeMapSources = [
  'app/home-client.tsx',
  'components/home/home-map-container.tsx',
  'components/map/NaverMapView.tsx',
  'components/map/naver-map-surface.tsx',
  'components/home/MobileControlOverlay.tsx',
  'components/home/SubmissionFloatingButton.tsx',
];

const adminOnlyOverlayContracts = [
  '/api/admin/map-overlays',
  '/api/admin/trend-proposals',
  'admin_restaurant_map_overlays',
  'admin_restaurant_map_overlay_proposals',
];
const adminOnlyOverlayContractFragments = [
  '/api/admin',
  'map-overlays',
  'trend-proposals',
  'admin_restaurant_map_overlay',
];

function appSource(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function routeSource(relativePath: string) {
  return appSource(relativePath);
}

function listAdminRouteFiles(root = adminApiRoot): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listAdminRouteFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && entry.name === 'route.ts') {
      files.push(relative(appRoot, absolutePath).replace(/\\/g, '/'));
    }
  }

  return files.sort();
}

function listSourceFiles(relativeRoot: string): string[] {
  const absoluteRoot = join(appRoot, relativeRoot);
  const files: string[] = [];

  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    const absolutePath = join(absoluteRoot, entry.name);
    const relativePath = relative(appRoot, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relativePath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function listPublicHomeMapSourceFiles() {
  const files = new Set(publicHomeMapSources);

  for (const root of ['components/home', 'components/map']) {
    for (const file of listSourceFiles(root)) files.add(file);
  }

  for (const file of listSourceFiles('hooks')) {
    const basename = file.split('/').pop() ?? '';
    if (basename.startsWith('useHome') || basename.startsWith('useRestaurant')) {
      files.add(file);
    }
  }

  for (const file of listSourceFiles('app')) {
    if (
      file === 'app/page.tsx' ||
      file.startsWith('app/home') ||
      file.startsWith('app/hooks/') ||
      file.startsWith('app/(home)')
    ) {
      files.add(file);
    }
  }

  for (const file of listSourceFiles('lib')) {
    const basename = file.split('/').pop() ?? '';
    if (
      basename.startsWith('home-') ||
      basename.startsWith('map-') ||
      basename.startsWith('restaurant-marker') ||
      basename.startsWith('visible-marker')
    ) {
      files.add(file);
    }
  }

  return [...files].sort();
}

function blankPreserveLineBreaks(value: string) {
  return value.replace(/[^\n]/g, ' ');
}

function stripCommentsAndStringLiterals(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankPreserveLineBreaks)
    .replace(/\/\/[^\n]*/g, blankPreserveLineBreaks)
    .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, blankPreserveLineBreaks);
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankPreserveLineBreaks)
    .replace(/\/\/[^\n]*/g, blankPreserveLineBreaks);
}

function firstCallIndex(source: string, callName: string) {
  const searchableSource = stripCommentsAndStringLiterals(source);
  const match = searchableSource.match(new RegExp(`(?:await\\s+)?${callName}\\s*\\(`));
  return match?.index ?? -1;
}

function findMatchingBrace(source: string, openBraceIndex: number) {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function exportedHandlerBodies(source: string) {
  const bodies: Array<{ method: string; body: string }> = [];
  const handlerPattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;

  for (const match of source.matchAll(handlerPattern)) {
    const method = match[1] ?? 'UNKNOWN';
    const openBraceIndex = source.indexOf('{', (match.index ?? 0) + match[0].length);
    const closeBraceIndex = openBraceIndex >= 0 ? findMatchingBrace(source, openBraceIndex) : -1;
    if (openBraceIndex >= 0 && closeBraceIndex > openBraceIndex) {
      bodies.push({ method, body: source.slice(openBraceIndex, closeBraceIndex + 1) });
    }
  }

  return bodies;
}

function assertFailClosedAuthGate(body: string, callName: 'requireAdmin' | 'authenticateStoryboardRagAction', label: string) {
  const strippedBody = stripCommentsAndStringLiterals(body);
  const authCallIndex = firstCallIndex(body, callName);
  expect(authCallIndex, `${label} must call ${callName}`).toBeGreaterThanOrEqual(0);

  const preAuthSource = strippedBody.slice(0, authCallIndex);
  expect(preAuthSource, `${label} must not await work before admin auth`).not.toMatch(/await\s+(?!requireAdmin|authenticateStoryboardRagAction)/);
  expect(preAuthSource, `${label} must not start privileged/provider work before admin auth`).not.toMatch(
    /createSupabaseServiceRoleClient\s*\(|fetch\s*\(|\.from\s*\(|\.rpc\s*\(|request\.json\s*\(|readStoryboardRouteJson\s*\(|embedStoryboardRagTexts\s*\(|rerankStoryboardRagCandidates\s*\(|buildCollectionLogPayload\s*\(/,
  );

  const postAuthSource = strippedBody.slice(Math.max(0, authCallIndex - 96));
  const gatePattern = callName === 'requireAdmin'
    ? /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+requireAdmin\s*\([^)]*\)\s*;\s*if\s*\(\s*!\1\.ok\s*\)\s*(?:return\s+\1\.response\s*;|\{[\s\S]{0,240}?return\s+\1\.response\s*;[\s\S]{0,120}?\})/
    : /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+authenticateStoryboardRagAction\s*\([^)]*\)\s*;\s*if\s*\(\s*!\1\.ok\s*\)\s*(?:return\s+\1\.response\s*;|\{[\s\S]{0,240}?return\s+\1\.response\s*;[\s\S]{0,120}?\})/;
  expect(postAuthSource, `${label} must return the auth failure response before continuing`).toMatch(gatePattern);
}

describe('admin route auth source contract', () => {
  test('keeps every admin route admin-gated directly or through an accepted route helper', () => {
    const helperSource = appSource(acceptedAuthHelperPath);
    const helperRequireAdminIndex = firstCallIndex(helperSource, 'requireAdmin');
    const helperServiceRoleIndex = firstCallIndex(helperSource, 'createSupabaseServiceRoleClient');

    expect(helperRequireAdminIndex).toBeGreaterThanOrEqual(0);
    expect(helperSource).not.toContain('Bearer');
    expect(helperSource).not.toContain('supabase.auth.getUser');
    if (helperServiceRoleIndex >= 0) {
      expect(helperRequireAdminIndex).toBeLessThan(helperServiceRoleIndex);
    }

    for (const file of listAdminRouteFiles()) {
      const source = routeSource(file);
      const isStoryboardRagRoute = storyboardRagRoutePaths.has(file);
      const handlerBodies = exportedHandlerBodies(source);

      expect(handlerBodies.length, `${file} must export at least one HTTP handler`).toBeGreaterThan(0);

      for (const { method, body } of handlerBodies) {
        if (isStoryboardRagRoute) {
          assertFailClosedAuthGate(body, 'authenticateStoryboardRagAction', `${file} ${method}`);
          expect(source, `${file} must import the accepted RAG auth helper`).toContain("@/lib/admin/storyboard/rag-actions-auth");
        } else {
          assertFailClosedAuthGate(body, 'requireAdmin', `${file} ${method}`);
        }
      }
    }
  });

  test('orders admin auth before service-role work', () => {
    const helperSource = appSource(acceptedAuthHelperPath);
    const helperRequireAdminIndex = firstCallIndex(helperSource, 'requireAdmin');
    const helperServiceRoleIndex = firstCallIndex(helperSource, 'createSupabaseServiceRoleClient');

    if (helperServiceRoleIndex >= 0) {
      expect(helperRequireAdminIndex).toBeLessThan(helperServiceRoleIndex);
    }

    for (const file of listAdminRouteFiles()) {
      const source = routeSource(file);
      const handlerBodies = exportedHandlerBodies(source);

      for (const { method, body } of handlerBodies) {
        const strippedBody = stripCommentsAndStringLiterals(body);
        if (!strippedBody.includes('createSupabaseServiceRoleClient(')) continue;

        if (storyboardRagRoutePaths.has(file)) {
          const ragAuthIndex = firstCallIndex(body, 'authenticateStoryboardRagAction');
          const serviceRoleIndex = strippedBody.indexOf('createSupabaseServiceRoleClient(', ragAuthIndex);
          expect(ragAuthIndex, `${file} ${method} must authenticate through the RAG helper before service-role work`).toBeGreaterThanOrEqual(0);
          expect(serviceRoleIndex, `${file} ${method} must create service-role clients only after RAG auth`).toBeGreaterThanOrEqual(0);
          expect(ragAuthIndex, `${file} ${method} must authenticate before service-role work`).toBeLessThan(serviceRoleIndex);
          expect(helperRequireAdminIndex, `${acceptedAuthHelperPath} must call requireAdmin`).toBeGreaterThanOrEqual(0);
          continue;
        }

        const requireAdminIndex = firstCallIndex(body, 'requireAdmin');
        const serviceRoleIndex = strippedBody.indexOf('createSupabaseServiceRoleClient(', requireAdminIndex);
        expect(requireAdminIndex, `${file} ${method} must call requireAdmin before service-role work`).toBeGreaterThanOrEqual(0);
        expect(serviceRoleIndex, `${file} ${method} must create service-role clients only after requireAdmin`).toBeGreaterThanOrEqual(0);
        expect(requireAdminIndex, `${file} ${method} must call requireAdmin before service-role work`).toBeLessThan(serviceRoleIndex);
      }
    }
  });

  test('keeps new guarded storyboard RAG auth contracts sanitized', () => {
    for (const file of [...storyboardRagRoutePaths, acceptedAuthHelperPath]) {
      const source = appSource(file);
      expect(source, `${file} must not leak raw Error.message`).not.toContain('error.message');
      expect(source, `${file} must not leak raw exception messages`).not.toContain('message: error');
      expect(source, `${file} must not use non-admin bearer auth under /api/admin`).not.toContain('Bearer');
    }
  });

  test('keeps public home/map sources separated from admin overlay/proposal contracts', () => {
    for (const file of listPublicHomeMapSourceFiles()) {
      const source = stripComments(appSource(file));
      for (const adminOnlyContract of adminOnlyOverlayContracts) {
        expect(source, `${file} must not reference ${adminOnlyContract}`).not.toContain(adminOnlyContract);
      }
      for (const adminOnlyFragment of adminOnlyOverlayContractFragments) {
        expect(source, `${file} must not reference admin-only fragment ${adminOnlyFragment}`).not.toContain(adminOnlyFragment);
      }
    }
  });
});
