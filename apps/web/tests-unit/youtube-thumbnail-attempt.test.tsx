import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  isYoutubeThumbnailPlaceholderOriginal,
  shouldTryNextYoutubeThumbnailCandidate,
} from '../lib/youtube-thumbnail';
import { YouTubeThumbnail } from '../components/ui/youtube-thumbnail';

const componentPath = resolve(import.meta.dir, '../components/ui/youtube-thumbnail.tsx');
const componentSource = readFileSync(componentPath, 'utf8');

describe('isYoutubeThumbnailPlaceholderOriginal', () => {
  test('flags the 120x90 raw placeholder', () => {
    expect(isYoutubeThumbnailPlaceholderOriginal({ naturalWidth: 120, naturalHeight: 90 })).toBe(true);
  });

  test('accepts real ladder originals (mqdefault 320x180 and up)', () => {
    expect(isYoutubeThumbnailPlaceholderOriginal({ naturalWidth: 320, naturalHeight: 180 })).toBe(false);
    expect(isYoutubeThumbnailPlaceholderOriginal({ naturalWidth: 480, naturalHeight: 360 })).toBe(false);
    expect(isYoutubeThumbnailPlaceholderOriginal({ naturalWidth: 1280, naturalHeight: 720 })).toBe(false);
  });

  test('undecoded images (0x0) are not placeholders', () => {
    expect(isYoutubeThumbnailPlaceholderOriginal({ naturalWidth: 0, naturalHeight: 0 })).toBe(false);
  });
});

describe('shouldTryNextYoutubeThumbnailCandidate', () => {
  test('only the raw-original placeholder check drives ladder descent', () => {
    expect(
      shouldTryNextYoutubeThumbnailCandidate({
        naturalWidth: 120,
        naturalHeight: 90,
        candidateIndex: 0,
        totalCandidates: 5,
      }),
    ).toBe(true);
    // A Next/Image density-corrected naturalWidth (e.g. 640x360 for a 96px card
    // at 2x DPR) must NOT downgrade a perfectly good maxres candidate.
    expect(
      shouldTryNextYoutubeThumbnailCandidate({
        naturalWidth: 640,
        naturalHeight: 360,
        candidateIndex: 0,
        totalCandidates: 5,
      }),
    ).toBe(false);
  });

  test('never advances past the final candidate', () => {
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

describe('YouTubeThumbnail rendering', () => {
  test('renders the highest-quality candidate first', () => {
    const html = renderToStaticMarkup(
      <YouTubeThumbnail videoId="abc123DEF45" alt="썸네일" sizes="112px" />,
    );
    // Next/Image wraps the src into /_next/image?url=<encoded raw url>
    expect(html).toContain(encodeURIComponent('https://img.youtube.com/vi/abc123DEF45/maxresdefault.jpg'));
    expect(html).not.toContain('hqdefault');
  });

  test('renders the MapPin fallback without a videoId', () => {
    const html = renderToStaticMarkup(<YouTubeThumbnail videoId={null} alt="썸네일" />);
    expect(html).not.toContain('img.youtube.com');
    expect(html).toContain('<svg');
  });

  test('a null videoId fallback honors fallbackIconClassName', () => {
    const html = renderToStaticMarkup(
      <YouTubeThumbnail videoId={null} alt="썸네일" fallbackIconClassName="h-8 w-8 custom-icon" />,
    );
    expect(html).toContain('custom-icon');
  });
});

describe('YouTubeThumbnail component contract (6 Pro P1/P2, 2026-09-17)', () => {
  test('optimized <Image> never judges placeholder from its own onLoad naturalWidth', () => {
    expect(componentSource).not.toMatch(/onLoad/);
    expect(componentSource).not.toMatch(/shouldTryNextYoutubeThumbnailCandidate/);
  });

  test('attempt state is keyed by videoId so video B does not inherit video A ladder index', () => {
    expect(componentSource).toMatch(/<ThumbnailAttempt[\s\S]*?key=\{videoId\}/);
  });

  test('terminal fallback renders when every candidate errored (index reaches length)', () => {
    expect(componentSource).toMatch(/if \(index >= candidates\.length\)/);
  });
});

