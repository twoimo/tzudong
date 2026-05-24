import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..');

function read(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('Google geocoding API removal', () => {
  test('removes frontend Google geocoding route and client geocoder helper', () => {
    expect(existsSync(join(repoRoot, 'apps/web/app/api/google-geocode/route.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, 'apps/web/lib/google-js-geocode.ts'))).toBe(false);
  });

  test('admin forms no longer expose Google geocoding actions', () => {
    for (const path of [
      'apps/web/components/admin/AdminRestaurantModal.tsx',
      'apps/web/components/admin/EditRestaurantModal.tsx',
      'apps/web/components/admin/SubmissionDetailView.tsx',
    ]) {
      const source = read(path);
      expect(source).not.toContain('google-js-geocode');
      expect(source).not.toContain('Google 지오코딩');
      expect(source).not.toContain('Google Geocoding');
      expect(source).not.toContain('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY');
    }
  });

  test('backend rule evaluation does not call Google Geocoding or Places APIs', () => {
    const source = read('backend/restaurant-evaluation/scripts/10-rule-evaluation.py');
    expect(source).not.toContain('maps.googleapis.com/maps/api/place/textsearch/json');
    expect(source).not.toContain('maps.googleapis.com/maps/api/geocode/json');
    expect(source).not.toContain('GOOGLE_MAPS_API_KEY');
    expect(source).not.toContain('google_places_text_search');
    expect(source).not.toContain('evaluate_with_google_fallback');
    expect(source).toContain('evaluate_with_browser_review_needed');
  });

  test('browser review scripts declare read-only, no-Google-API operation', () => {
    const buildQueue = read('backend/bin/build_google_maps_browser_review_queue.mjs');
    const validate = read('backend/bin/validate_google_maps_browser_candidates.mjs');
    expect(buildQueue).toContain('db_write_performed: false');
    expect(buildQueue).toContain('google_api_used: false');
    expect(validate).toContain('google_api_used: false');
    expect(validate).toContain('https://www.google.com/maps/search/?api=1&query=');
    expect(validate).not.toContain('maps.googleapis.com/maps/api/geocode/json');
    expect(validate).not.toContain('maps.googleapis.com/maps/api/place/textsearch/json');
  });
});
