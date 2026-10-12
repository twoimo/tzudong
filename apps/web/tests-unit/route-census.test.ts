import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
});
