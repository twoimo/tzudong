import { describe, expect, test } from 'bun:test';
import { getRunnableCredentials, parseSelectedRestaurantContext } from '@/lib/ocr/route-helpers';

describe('OCR route helper contracts', () => {
  const candidate = {
    provider: 'gemini' as const,
    model: 'gemini-3-flash-preview',
    models: ['gemini-3-flash-preview'],
    apiKey: 'invalid-first',
    source: 'environment' as const,
    credentialCandidates: [
      { apiKey: 'invalid-first', source: 'environment' as const, sourceName: 'GEMINI_OCR_YEON' },
      { apiKey: 'valid-second', source: 'environment' as const, sourceName: 'GEMINI_API_KEY_BYEON' },
    ],
  };

  test('automatic mode tries all provider credentials while manual mode keeps no-fallback semantics', () => {
    expect(getRunnableCredentials({ candidate, routingMode: 'automatic' }).map((entry) => entry.sourceName)).toEqual([
      'GEMINI_OCR_YEON',
      'GEMINI_API_KEY_BYEON',
    ]);
    expect(getRunnableCredentials({ candidate, routingMode: 'manual' }).map((entry) => entry.sourceName)).toEqual([
      'GEMINI_OCR_YEON',
    ]);
  });

  test('parses selected restaurant context without trusting raw client text as verified data', () => {
    const formData = new FormData();
    formData.set('selectedRestaurantId', 'restaurant-1');
    formData.set('selectedRestaurantName', '천안초밥 스시린');
    expect(parseSelectedRestaurantContext(formData)).toEqual({
      id: 'restaurant-1',
      name: '천안초밥 스시린',
      road_address: null,
      jibun_address: null,
      category: null,
    });
  });
});

describe('selected restaurant OCR context parsing', () => {
  test('keeps optional address and category context when review form provides it', () => {
    const formData = new FormData();
    formData.set('selectedRestaurantId', 'restaurant-1');
    formData.set('selectedRestaurantName', '데일리픽스 강남본점');
    formData.set('selectedRestaurantRoadAddress', '서울 강남구 테헤란로');
    formData.set('selectedRestaurantCategory', '카페·디저트');

    expect(parseSelectedRestaurantContext(formData)).toEqual({
      id: 'restaurant-1',
      name: '데일리픽스 강남본점',
      road_address: '서울 강남구 테헤란로',
      jibun_address: null,
      category: '카페·디저트',
    });
  });
});
