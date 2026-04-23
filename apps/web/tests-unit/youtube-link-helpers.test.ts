import { describe, expect, test } from 'bun:test';

import { canonicalizeYoutubeLink, extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';

describe('YouTube link helpers', () => {
  test('extracts a video id from supported YouTube URLs', () => {
    expect(extractVideoIdFromYoutubeLink('https://www.youtube.com/watch?v=abc123DEF45&t=10')).toBe('abc123DEF45');
    expect(extractVideoIdFromYoutubeLink('https://youtu.be/abc123DEF45?feature=share')).toBe('abc123DEF45');
    expect(extractVideoIdFromYoutubeLink('https://www.youtube.com/shorts/abc123DEF45')).toBe('abc123DEF45');
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
});
