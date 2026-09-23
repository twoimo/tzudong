import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canonicalizeYoutubeLink, classifyDashboardVideoId, extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import {
  getYoutubeThumbnailCandidates,
  getYoutubeThumbnailUrl,
  shouldTryNextYoutubeThumbnailCandidate,
} from '@/lib/youtube-thumbnail';

const source = (relativePath: string) =>
  readFileSync(resolve(import.meta.dir, '..', relativePath), 'utf8');

describe('YouTube link helpers', () => {
  test('returns null for empty, non-string, and non-YouTube input', () => {
    expect(extractVideoIdFromYoutubeLink(null)).toBeNull();
    expect(extractVideoIdFromYoutubeLink(undefined)).toBeNull();
    expect(extractVideoIdFromYoutubeLink('')).toBeNull();
    expect(extractVideoIdFromYoutubeLink('   ')).toBeNull();
    expect(extractVideoIdFromYoutubeLink('https://example.com/watch?v=abc123DEF45')).toBe('abc123DEF45');
    expect(extractVideoIdFromYoutubeLink('not a url')).toBeNull();
    expect(extractVideoIdFromYoutubeLink("' OR 1=1 --")).toBeNull();
    expect(extractVideoIdFromYoutubeLink('<script>alert(1)</script>')).toBeNull();
    expect(extractVideoIdFromYoutubeLink('https://youtu.be/short')).toBeNull();
  });

  test('reuses the same id for a repeated link', () => {
    const link = 'https://www.youtube.com/embed/abc123DEF45?start=12';
    expect(extractVideoIdFromYoutubeLink(link)).toBe('abc123DEF45');
    expect(extractVideoIdFromYoutubeLink(link)).toBe('abc123DEF45');
  });

  test('classifies dashboard video ids before a row scan', () => {
    expect(classifyDashboardVideoId(null)).toEqual({ status: 'required' });
    expect(classifyDashboardVideoId(undefined)).toEqual({ status: 'required' });
    expect(classifyDashboardVideoId('')).toEqual({ status: 'required' });
    expect(classifyDashboardVideoId('   ')).toEqual({ status: 'required' });
    expect(classifyDashboardVideoId('abc')).toEqual({ status: 'invalid', length: 3 });
    expect(classifyDashboardVideoId('abc def')).toEqual({ status: 'invalid', length: 7 });
    expect(classifyDashboardVideoId("' OR 1=1 --")).toMatchObject({ status: 'invalid' });
    expect(classifyDashboardVideoId('<script>alert(1)</script>')).toMatchObject({ status: 'invalid' });
    expect(classifyDashboardVideoId(`/${'a'.repeat(200)}`)).toMatchObject({ status: 'invalid' });
    expect(classifyDashboardVideoId('a'.repeat(129))).toEqual({ status: 'invalid', length: 129 });
    expect(classifyDashboardVideoId('  abc123DEF45  ')).toEqual({ status: 'ok', videoId: 'abc123DEF45' });
  });

  test('extracts a video id from supported YouTube URLs', () => {
    expect(extractVideoIdFromYoutubeLink('https://www.youtube.com/watch?v=abc123DEF45&t=10')).toBe('abc123DEF45');
    expect(extractVideoIdFromYoutubeLink('https://youtu.be/abc123DEF45?feature=share')).toBe('abc123DEF45');
    expect(extractVideoIdFromYoutubeLink('https://www.youtube.com/shorts/abc123DEF45')).toBe('abc123DEF45');
    expect(extractVideoIdFromYoutubeLink('https://www.youtube.com/live/abc123DEF45?si=test')).toBe('abc123DEF45');
  });

  test('canonicalizes YouTube URLs to the watch format', () => {
    expect(canonicalizeYoutubeLink('https://youtu.be/abc123DEF45?feature=share')).toBe(
      'https://www.youtube.com/watch?v=abc123DEF45',
    );
    expect(canonicalizeYoutubeLink('https://www.youtube.com/watch?v=abc123DEF45&t=10')).toBe(
      'https://www.youtube.com/watch?v=abc123DEF45',
    );
  });

  test('preserves non-YouTube URLs as trimmed values', () => {
    expect(canonicalizeYoutubeLink(' https://example.com/video ')).toBe('https://example.com/video');
    expect(canonicalizeYoutubeLink('   ')).toBeNull();
  });

  test('builds high-quality thumbnail candidates before low-quality fallbacks', () => {
    expect(getYoutubeThumbnailUrl('abc123DEF45')).toBe(
      'https://img.youtube.com/vi/abc123DEF45/maxresdefault.jpg',
    );
    expect(getYoutubeThumbnailUrl('abc123DEF45', 'hqdefault')).toBe(
      'https://img.youtube.com/vi/abc123DEF45/hqdefault.jpg',
    );
    expect(getYoutubeThumbnailCandidates('abc123DEF45')).toEqual([
      'https://img.youtube.com/vi/abc123DEF45/maxresdefault.jpg',
      'https://img.youtube.com/vi/abc123DEF45/sddefault.jpg',
      'https://img.youtube.com/vi/abc123DEF45/hqdefault.jpg',
      'https://img.youtube.com/vi/abc123DEF45/mqdefault.jpg',
      'https://img.youtube.com/vi/abc123DEF45/default.jpg',
    ]);
    expect(getYoutubeThumbnailCandidates(null)).toEqual([]);
  });

  test('skips tiny YouTube placeholder images before the final fallback', () => {
    expect(
      shouldTryNextYoutubeThumbnailCandidate({
        naturalWidth: 120,
        naturalHeight: 90,
        candidateIndex: 0,
        totalCandidates: 5,
      }),
    ).toBe(true);
    expect(
      shouldTryNextYoutubeThumbnailCandidate({
        naturalWidth: 480,
        naturalHeight: 360,
        candidateIndex: 0,
        totalCandidates: 5,
      }),
    ).toBe(false);
    expect(
      shouldTryNextYoutubeThumbnailCandidate({
        naturalWidth: 120,
        naturalHeight: 90,
        candidateIndex: 4,
        totalCandidates: 5,
      }),
    ).toBe(false);
  });

  test('checks original dimensions before rendering candidates through Next Image', () => {
    const thumbnailSource = source('components/ui/youtube-thumbnail.tsx');
    const detailSource = source('components/restaurant/RestaurantDetailPanel.tsx');

    expect(thumbnailSource).toContain('const probe = new window.Image()');
    expect(thumbnailSource).toContain('naturalWidth: probe.naturalWidth');
    expect(thumbnailSource).toContain('width={candidateDimensions.width}');
    expect(thumbnailSource).toContain('height={candidateDimensions.height}');
    expect(detailSource.match(/<YoutubeThumbnail/g)).toHaveLength(2);
    expect(detailSource).not.toContain("getYoutubeThumbnailUrl(videoId, 'sddefault')");
  });
});
