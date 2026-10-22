import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');
const appSource = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

describe('restaurant detail header keeps name and categories on one line', () => {
  test('panel headers do not wrap the title row while page headers still may', () => {
    const chrome = appSource('components/home/map-panel-chrome.tsx');
    expect(chrome).toContain('isPage ? "flex-wrap gap-y-1" : "flex-nowrap"');
    expect(chrome).toContain('<span className="min-w-0 truncate" title={title}>{title}</span>');
  });

  test('detail categories render as one non-shrinking chip group beside the name', () => {
    const detail = appSource('components/restaurant/RestaurantDetailPanel.tsx');
    expect(detail).toContain('<span className="flex shrink-0 items-center gap-1" data-restaurant-detail-categories="true">');
    expect(detail).toContain('className="shrink-0 whitespace-nowrap px-2 py-0.5 text-2xs"');
  });
});
