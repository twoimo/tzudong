import { describe, expect, test } from 'bun:test';

import {
    extractCanonicalYouTubeVideoId,
    normalizeCanonicalYouTubeWatchUrl,
} from '@/lib/youtube-url';

const VIDEO_ID = '8kE5Uq_YV08';

describe('canonical YouTube URL helpers', () => {
    test.each([
        VIDEO_ID,
        `https://www.youtube.com/watch?v=${VIDEO_ID}&feature=share`,
        `https://youtu.be/${VIDEO_ID}?si=example`,
        `youtube.com/shorts/${VIDEO_ID}`,
        `https://m.youtube.com/live/${VIDEO_ID}`,
        `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
    ])('extracts supported YouTube video ids from %s', (value) => {
        expect(extractCanonicalYouTubeVideoId(value)).toBe(VIDEO_ID);
        expect(normalizeCanonicalYouTubeWatchUrl(value)).toBe(
            `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        );
    });

    test.each([
        null,
        undefined,
        '',
        'not-video',
        'https://example.com/watch?v=8kE5Uq_YV08',
        'https://youtube.com/watch?v=too-short',
        'https://user:password@youtube.com/watch?v=8kE5Uq_YV08',
    ])('rejects invalid or foreign values', (value) => {
        expect(extractCanonicalYouTubeVideoId(value)).toBeNull();
        expect(normalizeCanonicalYouTubeWatchUrl(value)).toBeNull();
    });
});
