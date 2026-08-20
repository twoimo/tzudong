import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

describe('admin family design contract', () => {
  test('keeps two-pane overview and guarded apply grammar', () => {
    const overview = source('components/admin/AdminOverviewDashboard.tsx');
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(overview).toContain('aria-label="관리자 지도 운영 개요 2분할"');
    expect(overview).toContain('lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]');
    expect(consoleSource).toContain('관리자 콘솔');
    expect(consoleSource).not.toContain('Unified admin console');
    expect(consoleSource).not.toContain('<iframe');
    expect(source('app/admin/page.tsx')).not.toContain('<iframe');
  });

  test('does not invent a family error.tsx under admin', () => {
    expect(source('app/admin/layout.tsx')).toContain('AppRuntimeLayout');
    try {
      source('app/admin/error.tsx');
      throw new Error('admin/error.tsx should stay absent');
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });
});
