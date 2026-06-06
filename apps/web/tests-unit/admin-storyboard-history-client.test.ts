import { describe, expect, test } from 'bun:test';

import {
  getSafeStoryboardHistoryRunUrl,
  normalizeStoryboardHistoryRunPath,
} from '../lib/admin/storyboard/history-client';

describe('admin storyboard public history client helpers', () => {
  test('supports both new jsonPath and legacy rawPath entries', () => {
    expect(
      getSafeStoryboardHistoryRunUrl({
        jsonPath: './2026-06-06T07-24-25-950Z.json',
      }),
    ).toBe('/qa-history/storyboard/2026-06-06T07-24-25-950Z.json');

    expect(
      getSafeStoryboardHistoryRunUrl({
        rawPath: './2026-06-04T15-52-24-703Z.json',
      }),
    ).toBe('/qa-history/storyboard/2026-06-04T15-52-24-703Z.json');

    expect(
      getSafeStoryboardHistoryRunUrl({
        jsonPath: './2026-06-06T07-24-25-950Z.json',
        rawPath: './2026-06-04T15-52-24-703Z.json',
      }),
    ).toBe('/qa-history/storyboard/2026-06-06T07-24-25-950Z.json');
  });

  test('rejects unsafe or non-json history paths', () => {
    for (const unsafe of [
      '../secret.json',
      './nested/run.json',
      './..%2Fsecret.json',
      './latest-real-data.json',
      '/qa-history/storyboard/run.json',
      'https://example.com/run.json',
      './run.json?token=1',
      './run.json#fragment',
      './run.txt',
      '',
      null,
    ]) {
      expect(normalizeStoryboardHistoryRunPath(unsafe)).toBeNull();
    }
  });
});
