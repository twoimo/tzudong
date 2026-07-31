import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../hooks/use-search-history.ts', import.meta.url),
  'utf8',
);

test('search history is account-partitioned, tab-scoped, bounded, and short-lived', () => {
  expect(source).toContain("localStorage.removeItem(LEGACY_STORAGE_KEY)");
  expect(source).not.toContain("localStorage.getItem(");
  expect(source).not.toContain("localStorage.setItem(");
  expect(source).toContain("SESSION_STORAGE_PREFIX}:${user?.id ?? 'anonymous'}");
  expect(source).toContain('HISTORY_TTL_MS = 24 * 60 * 60 * 1000');
  expect(source).toContain('raw.length > 16 * 1024');
  expect(source).toContain('.slice(0, MAX_HISTORY)');
  expect(source).toContain('sessionStorage.removeItem(storageKey)');
  expect(source).toContain('SAFE_ID_PATTERN');
});
