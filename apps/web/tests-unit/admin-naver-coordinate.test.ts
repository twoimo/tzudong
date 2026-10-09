import { describe, expect, test } from 'bun:test';
import { readAdminNaverCoordinate } from '../lib/admin/naver-coordinate';

describe('admin SDK coordinate receiver', () => {
  test('keeps the real method receiver and works with numeric and absent coordinates', () => {
    class Coordinate {
      #latitude = 37.5; #longitude = 127.1;
      lat() { return this.#latitude; }
      lng() { return this.#longitude; }
    }
    const value = new Coordinate();
    expect(readAdminNaverCoordinate(value, 'lat')).toBe(37.5);
    expect(readAdminNaverCoordinate(value, 'lng')).toBe(127.1);
    expect(readAdminNaverCoordinate({ lat: 37.5, lng: 127.1 }, 'lng')).toBe(127.1);
    expect(readAdminNaverCoordinate(undefined, 'lat')).toBeUndefined();
  });
});
