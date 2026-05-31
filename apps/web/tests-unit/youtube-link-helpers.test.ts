import { describe, expect, test } from 'bun:test';

import { canonicalizeYoutubeLink, extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import {
  getYoutubeThumbnailCandidates,
  getYoutubeThumbnailUrl,
  shouldTryNextYoutubeThumbnailCandidate,
} from '@/lib/youtube-thumbnail';

describe('YouTube link helpers', () => {
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
});
