import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');
const appSource = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

describe('restaurant detail header preserves readable names and separate category tools', () => {
  test('compact panel headers default to truncation and allow explicit readable titles', () => {
    const chrome = appSource('components/home/map-panel-chrome.tsx');
    expect(chrome).toContain('isPage ? "flex-wrap gap-y-1" : "flex-nowrap"');
    expect(chrome).toContain('wrapTitle = false');
    expect(chrome).toContain('wrapTitle ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "truncate"');
  });

  test('detail opts into wrapping and keeps categories in their own wrapping toolbar', () => {
    const detail = appSource('components/restaurant/RestaurantDetailPanel.tsx');
    expect(detail).toContain('wrapTitle');
    expect(detail).toContain('<span className="flex min-w-0 flex-wrap items-center gap-1" data-restaurant-detail-categories="true">');
    expect(detail).toContain('className="shrink-0 whitespace-nowrap px-2 py-0.5 text-2xs"');
  });
});
