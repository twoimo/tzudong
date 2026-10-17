import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const webRoot = resolve(import.meta.dir, '..');
const script = join(webRoot, 'scripts/audit-route-census.mjs');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function runCensus() {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-route-census-'));
  temporaryDirectories.push(directory);
  const output = join(directory, 'route-census.json');
  const result = spawnSync(process.execPath, [script, '--output', output], {
    cwd: webRoot,
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return { bytes: readFileSync(output, 'utf8'), output };
}

describe('source-bound route census', () => {
  test('collects the complete current inventory and retains historical evidence limits', () => {
    const first = runCensus();
    const second = runCensus();
    expect(second.bytes).toBe(first.bytes);

    const census = JSON.parse(first.bytes);
    expect(census.kind).toBe('source-and-historical-evidence-inventory-only');
    expect(census.counts).toMatchObject({
      publicOrAccountPages: 21,
      publicShareHandlers: 1,
      adminPhysicalPages: 5,
      totalSurfaces: 27,
    });
    expect(census.assertions).toMatchObject({
      expectedCurrentCounts: true,
      historicalPublicMatrixCoversCurrentPublicPatterns: true,
      historicalPublicOperatingVerificationCount: 0,
    });

    const byRoute = new Map(census.routes.map((route: { routePattern: string }) => [route.routePattern, route]));
    expect(byRoute.get('/s/[code]')?.evidence.representativeInputs).toEqual(['/s/audit-invalid-code']);
    expect(byRoute.get('/user/[userId]')?.evidence.representativeInputs).toEqual([
      '/user/00000000-0000-4000-8000-000000000009',
    ]);
    expect(byRoute.get('/admin/privacy-incidents')?.evidence.scope).toBe('no current source-bound render evidence');
    expect(census.limitations).toContain('No route was requested, rendered, authenticated, or mutated by this source census.');
  });

  test('keeps the capture-compatible inventory aligned with the share HTTP handler', () => {
    const inventoryPath = join(webRoot, 'performance/cms-followthrough-20261009/route-inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    const publicSurfaces = inventory.public_or_account_pages;
    const adminPages = inventory.admin_legacy_or_canonical_pages;
    const shareSurface = publicSurfaces.find((surface: { route: string }) => surface.route === '/s/[code]');

    expect(inventory.inventory_scope).toEqual({
      logical_surfaces: 27,
      physical_page_sources: 26,
      public_or_account_page_sources: 21,
      public_share_handlers: 1,
      admin_page_sources: 5,
      limitation: 'Source inventory only; no current browser, authentication, database, mutation, or production evidence.',
    });
    expect(publicSurfaces).toHaveLength(22);
    expect(adminPages).toHaveLength(5);
    expect(shareSurface).toMatchObject({
      source: 'app/s/[code]/route.ts',
      surface_kind: 'http-route-handler',
      current_browser_evidence: false,
    });
    expect(existsSync(join(webRoot, shareSurface.source))).toBe(true);
    expect(existsSync(join(webRoot, 'app/s/[code]/page.tsx'))).toBe(false);
  });
});
