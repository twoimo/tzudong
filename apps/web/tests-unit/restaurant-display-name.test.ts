import { describe, expect, test } from 'bun:test';

import {
    getRestaurantDisplayName,
    withRestaurantDisplayName,
} from '../lib/restaurant-display-name';

describe('restaurant display name helpers', () => {
    test('prefers the approved canonical restaurant name', () => {
        expect(getRestaurantDisplayName({
            approved_name: '데일리픽스 강남본점',
            name: '삭제된 중복 지점',
            naver_name: '네이버 이름',
        })).toBe('데일리픽스 강남본점');
    });

    test('falls back through available source names when approved_name is absent', () => {
        expect(getRestaurantDisplayName({ name: '스시린 불당본점' })).toBe('스시린 불당본점');
        expect(getRestaurantDisplayName({ naver_name: '네이버 맛집' })).toBe('네이버 맛집');
        expect(getRestaurantDisplayName({ origin_name: '원본 맛집' })).toBe('원본 맛집');
        expect(getRestaurantDisplayName({ google_name: 'Google Place' })).toBe('Google Place');
        expect(getRestaurantDisplayName({ channel_name: '채널 맛집' })).toBe('채널 맛집');
    });

    test('returns a safe placeholder when no display name exists', () => {
        expect(getRestaurantDisplayName({ approved_name: '   ', name: '' })).toBe('알 수 없음');
        expect(getRestaurantDisplayName(null, '이름 없음')).toBe('이름 없음');
    });

    test('normalizes rows so stamp cards never render undefined titles', () => {
        expect(withRestaurantDisplayName({
            id: 'restaurant-id',
            approved_name: '데일리픽스 강남본점',
        }).name).toBe('데일리픽스 강남본점');
    });
});
