import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildGoogleMapDestinationUrl,
  buildKakaoMapDestinationUrl,
  buildNaverMapDestinationUrl,
  buildRestaurantMapDestinationUrls,
} from '@/lib/restaurant-outbound-url';
import {
  extractCanonicalYouTubeVideoId,
  normalizeCanonicalYouTubeWatchUrl,
} from '@/lib/youtube-url';

const VIDEO_ID = 'abc123DEF45';
const destination = {
  name: ' 경계 맛집 ',
  lat: -90,
  lng: 180,
};
const encodedName = encodeURIComponent('경계 맛집').replace(/%20/g, '+');

function allMapUrls(input: unknown) {
  return [
    buildNaverMapDestinationUrl(input),
    buildKakaoMapDestinationUrl(input),
    buildGoogleMapDestinationUrl(input),
    buildRestaurantMapDestinationUrls(input),
  ];
}

describe('restaurant outbound URL security', () => {
  test('rejects arbitrary-host YouTube inputs instead of creating canonical links', () => {
    const arbitraryHost = `https://video.example/watch?v=${VIDEO_ID}`;
    const deceptiveHost = `https://www.youtube.com.example/watch?v=${VIDEO_ID}`;

    expect(extractCanonicalYouTubeVideoId(arbitraryHost)).toBeNull();
    expect(normalizeCanonicalYouTubeWatchUrl(deceptiveHost)).toBeNull();
    expect(normalizeCanonicalYouTubeWatchUrl(`https://youtu.be/${VIDEO_ID}`)).toBe(
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    );
  });

  test('rejects invalid coordinates so no provider destination is available', () => {
    for (const input of [
      { name: '맛집', lat: Number.NaN, lng: 127 },
      { name: '맛집', lat: Infinity, lng: 127 },
      { name: '맛집', lat: -Infinity, lng: 127 },
      { name: '맛집', lat: 90.000001, lng: 127 },
      { name: '맛집', lat: -90.000001, lng: 127 },
      { name: '맛집', lat: 37.5, lng: 180.000001 },
      { name: '맛집', lat: 37.5, lng: -180.000001 },
    ]) {
      expect(allMapUrls(input)).toEqual([null, null, null, null]);
    }
  });

  test('rejects control characters, blank names, and oversized names', () => {
    for (const name of ['\u0000맛집', '맛\n집', '   ', '맛'.repeat(201)]) {
      expect(allMapUrls({ name, lat: 37.5, lng: 127 })).toEqual([null, null, null, null]);
    }
    expect(allMapUrls(null)).toEqual([null, null, null, null]);
  });

  test('uses only fixed origins, paths, and allowlisted encoded query parameters', () => {
    const urls = buildRestaurantMapDestinationUrls(destination);

    expect(urls).toEqual({
      naver: `https://map.naver.com/v5/search?query=${encodedName}`,
      kakao: `https://map.kakao.com/?q=${encodedName}&urlX=180&urlY=-90`,
      google: 'https://www.google.com/maps/dir/?api=1&destination=-90%2C180',
    });
    expect(buildNaverMapDestinationUrl(destination)).toBe(urls?.naver);
    expect(buildKakaoMapDestinationUrl(destination)).toBe(urls?.kakao);
    expect(buildGoogleMapDestinationUrl(destination)).toBe(urls?.google);

    const naver = new URL(urls?.naver ?? '');
    const kakao = new URL(urls?.kakao ?? '');
    const google = new URL(urls?.google ?? '');
    expect([naver.origin, naver.pathname, [...naver.searchParams.keys()]]).toEqual([
      'https://map.naver.com',
      '/v5/search',
      ['query'],
    ]);
    expect([kakao.origin, kakao.pathname, [...kakao.searchParams.keys()]]).toEqual([
      'https://map.kakao.com',
      '/',
      ['q', 'urlX', 'urlY'],
    ]);
    expect([google.origin, google.pathname, [...google.searchParams.keys()]]).toEqual([
      'https://www.google.com',
      '/maps/dir/',
      ['api', 'destination'],
    ]);
  });

  test('omits invalid YouTube and direction actions from the restaurant panel source', () => {
    const panelSource = readFileSync(
      join(import.meta.dir, '..', 'components/restaurant/RestaurantDetailPanel.tsx'),
      'utf8',
    );

    expect(panelSource).toContain('extractCanonicalYouTubeVideoId(youtubeLink)');
    expect(panelSource).toContain('{youtubeVideos.length > 0 ? (');
    expect(panelSource).not.toContain('openExternalUrl(youtubeLinks[0])');
    expect(panelSource).not.toContain('openExternalUrl(link)');
    expect(panelSource).toContain('buildRestaurantMapDestinationUrls');
    expect(panelSource).toContain('{mapDestinationUrls ? (');
  });
});
