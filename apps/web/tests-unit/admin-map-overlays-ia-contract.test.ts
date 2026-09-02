import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(import.meta.dir, '..');

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('admin map overlays IA contract', () => {
  test('admin routing exposes the map-overlays module id', () => {
    const routing = source('lib/admin/admin-module-routing.ts');
    const registry = source('lib/admin/console-menu-registry.ts');

    expect(routing).toContain('ADMIN_CONSOLE_MODULE_IDS');
    expect(routing).toContain('ADMIN_CONSOLE_MENU_IDS');
    expect(registry).toContain('"map-overlays"');
  });

  test('admin console adds 지도 오버레이 with required tabs and integrations', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('id: "map-overlays"');
    expect(consoleSource).toContain('title: "지도 오버레이"');
    expect(consoleSource).toContain('label: "수동 오버레이"');
    expect(consoleSource).toContain('label: "트렌드 제안"');
    expect(consoleSource).toContain('label: "트렌드 실행"');
    expect(consoleSource).toContain('data-admin-map-overlays-module="true"');
    expect(consoleSource).toContain('data-admin-map-overlays-tabs="manual trend-proposals trend-runs"');
    expect(consoleSource).toContain('data-admin-map-overlays-tab={tab.id}');
    expect(consoleSource).toContain('<TrendProposalQueue />');
    expect(consoleSource).toContain('/api/admin/map-overlays/preview');
    expect(consoleSource).toContain('/api/admin/map-overlays/apply');
    expect(consoleSource).toContain('/api/admin/trend-job-requests');
    expect(consoleSource).toContain('컬렉터/스코어러를 inline 실행하지 않습니다');
  });

  test('map overlay IA remains admin-only and preserves public/admin split', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const publicHome = source('app/home-client.tsx');
    const mapSurface = source('components/map/naver-map-surface.tsx');

    expect(consoleSource).toContain('admin_restaurant_map_overlays');
    expect(publicHome).not.toContain('/api/admin/map-overlays');
    expect(mapSurface).not.toContain('/api/admin/map-overlays');
  });
});
