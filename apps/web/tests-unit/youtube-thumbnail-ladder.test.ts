import { describe, expect, test } from 'bun:test';

import {
    extractYouTubeVideoId,
    getYouTubeFallbackThumbnailUrl,
    getYouTubeThumbnailCandidates,
    getYouTubeThumbnailUrl,
    YOUTUBE_THUMBNAIL_QUALITIES,
} from '../components/stamp/stamp-utils';

const VIDEO_ID = '3pPs0K8m5Wg';
const IMG = 'https://img.youtube.com/vi/' + VIDEO_ID;

describe('extractYouTubeVideoId', () => {
    test('parses canonical watch URLs', () => {
        expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=' + VIDEO_ID)).toBe(VIDEO_ID);
        expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=' + VIDEO_ID + '&t=42s')).toBe(VIDEO_ID);
        expect(extractYouTubeVideoId('https://youtu.be/' + VIDEO_ID)).toBe(VIDEO_ID);
        expect(extractYouTubeVideoId('https://www.youtube.com/embed/' + VIDEO_ID)).toBe(VIDEO_ID);
        expect(extractYouTubeVideoId('https://www.youtube.com/v/' + VIDEO_ID)).toBe(VIDEO_ID);
    });

    test('rejects malformed or non-YouTube input', () => {
        expect(extractYouTubeVideoId('')).toBeNull();
        expect(extractYouTubeVideoId('not a url')).toBeNull();
        expect(extractYouTubeVideoId('https://example.com/watch?v=' + VIDEO_ID)).toBeNull();
        expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    });
});

describe('getYouTubeThumbnailCandidates', () => {
    test('returns the full ladder in descending resolution', () => {
        const candidates = getYouTubeThumbnailCandidates('https://www.youtube.com/watch?v=' + VIDEO_ID);
        expect(candidates).toEqual([
            IMG + '/maxresdefault.jpg',
            IMG + '/sddefault.jpg',
            IMG + '/hqdefault.jpg',
            IMG + '/mqdefault.jpg',
        ]);
    });

    test('ladder order matches exported quality list', () => {
        const candidates = getYouTubeThumbnailCandidates('https://youtu.be/' + VIDEO_ID);
        expect(candidates.map((u) => u.split('/').pop())).toEqual([...YOUTUBE_THUMBNAIL_QUALITIES]);
    });

    test('empty list for invalid input instead of throwing', () => {
        expect(getYouTubeThumbnailCandidates('')).toEqual([]);
        expect(getYouTubeThumbnailCandidates('https://vimeo.com/12345')).toEqual([]);
        expect(getYouTubeThumbnailCandidates('https://www.youtube.com/watch?v=badid')).toEqual([]);
    });
});

describe('getYouTubeThumbnailUrl / fallback', () => {
    test('prefers the high-res original', () => {
        expect(getYouTubeThumbnailUrl('https://www.youtube.com/watch?v=' + VIDEO_ID)).toBe(IMG + '/maxresdefault.jpg');
    });

    test('fallback is hqdefault which always exists', () => {
        expect(getYouTubeFallbackThumbnailUrl('https://youtu.be/' + VIDEO_ID)).toBe(IMG + '/hqdefault.jpg');
    });

    test('null for unusable URLs', () => {
        expect(getYouTubeThumbnailUrl('')).toBeNull();
        expect(getYouTubeFallbackThumbnailUrl('')).toBeNull();
        expect(getYouTubeThumbnailUrl('https://example.com')).toBeNull();
        expect(getYouTubeFallbackThumbnailUrl('https://example.com')).toBeNull();
    });
});

describe('extractYouTubeVideoId hardening', () => {
    test('accepts shorts, mobile hosts, and parameter-prefixed watch URLs', () => {
        expect(extractYouTubeVideoId('https://www.youtube.com/shorts/' + VIDEO_ID)).toBe(VIDEO_ID);
        expect(extractYouTubeVideoId('https://m.youtube.com/watch?v=' + VIDEO_ID)).toBe(VIDEO_ID);
        expect(extractYouTubeVideoId('https://www.youtube.com/watch?list=RD&v=' + VIDEO_ID)).toBe(VIDEO_ID);
    });

    test('rejects non-YouTube hosts even when they carry a v= parameter', () => {
        expect(extractYouTubeVideoId('https://example.com/watch?v=' + VIDEO_ID)).toBeNull();
        expect(extractYouTubeVideoId('https://youtu.be/' + VIDEO_ID + 'x')).toBeNull();
        expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=' + VIDEO_ID.slice(0, 10))).toBeNull();
    });
});
