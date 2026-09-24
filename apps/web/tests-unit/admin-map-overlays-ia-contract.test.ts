import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(import.meta.dir, '..');

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('admin map overlays IA contract', () => {
  test('admin routing no longer exposes the map-overlays module', () => {
    const routing = source('lib/admin/admin-module-routing.ts');
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(routing).toContain('ADMIN_CONSOLE_MODULE_IDS');
    expect(routing).not.toContain('"map-overlays"');
    expect(consoleSource).not.toContain('title: "지도 오버레이"');
    expect(consoleSource).not.toContain('data-admin-map-overlays-module="true"');
    expect(consoleSource).not.toContain('<TrendProposalQueue />');
  });

  test('public home still does not call the admin map overlay API', () => {
    const publicHome = source('app/home-client.tsx');
    const mapSurface = source('components/map/naver-map-surface.tsx');

    expect(publicHome).not.toContain('/api/admin/map-overlays');
    expect(mapSurface).not.toContain('/api/admin/map-overlays');
  });
});
