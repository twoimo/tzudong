import { describe, expect, test } from 'bun:test';

import { isRecognizedYouTubeUrl } from '@/lib/restaurant-submission-flow';
import {
  buildCanonicalYouTubeWatchUrl,
  extractCanonicalYouTubeVideoId,
  normalizeCanonicalYouTubeWatchUrl,
} from '@/lib/youtube-url';

const VIDEO_ID = 'abc123DEF45';
const CANONICAL_WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

describe('canonical YouTube URL contract', () => {
  test('normalizes exact video IDs and allowlisted canonical HTTPS URLs', () => {
    expect(extractCanonicalYouTubeVideoId(VIDEO_ID)).toBe(VIDEO_ID);
    expect(extractCanonicalYouTubeVideoId(` https://www.youtube.com/watch?v=${VIDEO_ID}&t=1m30s&feature=share&si=token_123 `)).toBe(VIDEO_ID);
    expect(normalizeCanonicalYouTubeWatchUrl(`https://youtu.be/${VIDEO_ID}?start=10&end=30`)).toBe(CANONICAL_WATCH_URL);
    expect(normalizeCanonicalYouTubeWatchUrl(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(CANONICAL_WATCH_URL);
    expect(buildCanonicalYouTubeWatchUrl(VIDEO_ID)).toBe(CANONICAL_WATCH_URL);
  });

  test('rejects malformed IDs and non-string values', () => {
    for (const value of [
      null,
      undefined,
      {},
      [],
      '',
      'abc123DEF4',
      'abc123DEF456',
      'abc123DEF4!',
    ]) {
      expect(extractCanonicalYouTubeVideoId(value)).toBeNull();
      expect(normalizeCanonicalYouTubeWatchUrl(value)).toBeNull();
      expect(buildCanonicalYouTubeWatchUrl(value)).toBeNull();
    }
  });

  test('rejects unsafe schemes, protocol-relative URLs, and arbitrary hosts', () => {
    for (const value of [
      `http://www.youtube.com/watch?v=${VIDEO_ID}`,
      `javascript:alert(1)//www.youtube.com/watch?v=${VIDEO_ID}`,
      `data:text/html,https://www.youtube.com/watch?v=${VIDEO_ID}`,
      `blob:https://www.youtube.com/watch?v=${VIDEO_ID}`,
      `file:///www.youtube.com/watch?v=${VIDEO_ID}`,
      `//www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://youtube.com/watch?v=${VIDEO_ID}`,
      `https://m.youtube.com/watch?v=${VIDEO_ID}`,
      `https://www.youtube.com.evil.example/watch?v=${VIDEO_ID}`,
      `https://www.youtube.com@evil.example/watch?v=${VIDEO_ID}`,
      `https://www.youtu\u0432e.com/watch?v=${VIDEO_ID}`,
    ]) {
      expect(normalizeCanonicalYouTubeWatchUrl(value)).toBeNull();
    }
  });

  test('rejects credentials, ports, fragments, encoded controls, and path ambiguity', () => {
    for (const value of [
      `https://user@www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://user:password@www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://www.youtube.com:443/watch?v=${VIDEO_ID}`,
      `https://youtu.be:443/${VIDEO_ID}`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}#fragment`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}%0A`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}\n`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}\\`,
      `https://www.youtube.com/watch/?v=${VIDEO_ID}`,
      `https://www.youtube.com/shorts/${VIDEO_ID}`,
      `https://www.youtube.com/embed/${VIDEO_ID}`,
      `https://www.youtube.com/live/${VIDEO_ID}`,
      `https://youtu.be/${VIDEO_ID}/extra`,
      `https://www.youtube.com/a/../watch?v=${VIDEO_ID}`,
      `https://www.youtube.com/./watch?v=${VIDEO_ID}`,
      `https://youtu.be/a/../${VIDEO_ID}`,
      `https://youtu.be/./${VIDEO_ID}`,
    ]) {
      expect(normalizeCanonicalYouTubeWatchUrl(value)).toBeNull();
    }
  });

  test('rejects duplicate, conflicting, and non-allowlisted query parameters', () => {
    for (const value of [
      `https://www.youtube.com/watch?v=${VIDEO_ID}&v=${VIDEO_ID}`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}&v=zyx987WVU65`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}&next=https://evil.example`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PL123`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=10&start=bad`,
      `https://youtu.be/${VIDEO_ID}?v=${VIDEO_ID}`,
      `https://youtu.be/${VIDEO_ID}?feature=share&feature=share`,
      `https://youtu.be/${VIDEO_ID}?si=token%0A`,
    ]) {
      expect(normalizeCanonicalYouTubeWatchUrl(value)).toBeNull();
    }
  });

  test('uses the canonical contract for restaurant submission validation', () => {
    expect(isRecognizedYouTubeUrl(`https://youtu.be/${VIDEO_ID}?feature=share`)).toBe(true);
    expect(isRecognizedYouTubeUrl(`https://www.youtube.com/watch?v=${VIDEO_ID}&next=https://evil.example`)).toBe(false);
    expect(isRecognizedYouTubeUrl(`https://www.youtube.com/shorts/${VIDEO_ID}`)).toBe(false);
  });
});
