import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  AdminGeocodeError, adminGeocodeErrorMessage, fetchAdminGeocode, fetchAdminPlaceItems, hasValidGeocodeCoordinates,
} from '../lib/admin/admin-geocode-client';
import { normalizeCanonicalYouTubeWatchUrl } from '../lib/youtube-url';
import type { RestaurantRecordChanges } from '../lib/admin/record-action-contract';

const candidate = { roadAddress: '합성시 합성구 도로 1', jibunAddress: '합성시 합성구 동 1', englishAddress: '', addressElements: [], x: '127.1', y: '37.5' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const modal = readFileSync(new URL('../components/admin/EditRestaurantModal.tsx', import.meta.url), 'utf8');
// Run the actual handler bodies, with all I/O replaced; no React mount or provider call.
function actual<T>(from: string, until: string, names: string[], deps: Record<string, unknown>): T {
  const start = modal.indexOf(from), end = modal.indexOf(until, start);
  expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
  const code = `const {${Object.keys(deps).join(',')}}=deps;\n${modal.slice(start, end)}\nreturn {${names.join(',')}};`;
  return new Function('deps', new Bun.Transpiler({ loader: 'tsx' }).transformSync(code))(deps) as T;
}

describe('same-origin admin geocode adapter', () => {
  test('uses the exact BFF body, cookie scope and maximum three normalized candidates', async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    const result = await fetchAdminGeocode(' 합성 주소 ', async (path, init) => {
      calls.push({ path, init }); return response({ addresses: Array(5).fill(candidate) });
    });
    expect(calls).toEqual([{ path: '/api/naver-geocode', init: {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"query":"합성 주소"}',
    } }]);
    expect(result).toHaveLength(3); expect(result[0]).toEqual(candidate);
    expect(await fetchAdminGeocode('합성', async () => response({ addresses: [] }))).toEqual([]);
  });

  test.each([
    [401, 'authentication'], [403, 'access_denied'], [429, 'rate_limit'], [503, 'unavailable'],
    [502, 'provider'], [400, 'payload'], [413, 'payload'], [500, 'unavailable'],
  ] as const)('maps HTTP %i to fixed %s without exposing a response body', async (status, code) => {
    try {
      await fetchAdminGeocode('합성', async () => response({ error: 'PRIVATE_PROVIDER_DIAGNOSTIC' }, status));
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminGeocodeError);
      expect((error as AdminGeocodeError).code).toBe(code);
      expect(adminGeocodeErrorMessage(error)).not.toContain('PRIVATE');
    }
  });

  test('rejects malformed success payload and invalid coordinates, but preserves legitimate zero', async () => {
    for (const body of [null, {}, { addresses: {} }, { addresses: [null] },
      ...['', ' ', 'NaN', 'Infinity', '181', '1e2'].map(x => ({ addresses: [{ ...candidate, x }] })),
      { addresses: [{ ...candidate, y: '91' }] }, { addresses: [{ ...candidate, roadAddress: '', jibunAddress: '' }] },
    ]) {
      await expect(fetchAdminGeocode('합성', async () => response(body))).rejects.toMatchObject({ code: 'payload' });
    }
    await expect(fetchAdminGeocode('합성', async () => new Response('not json'))).rejects.toMatchObject({ code: 'payload' });
    expect(hasValidGeocodeCoordinates('0', '0')).toBe(true);
    expect(hasValidGeocodeCoordinates(undefined, null)).toBe(false);
    expect(hasValidGeocodeCoordinates('180', '-90')).toBe(true);
  });

  test('invalid queries do not reach transport and connection errors remain bounded', async () => {
    let calls = 0;
    for (const query of ['', ' ', 'x'.repeat(201), 'ab\u0000cd']) {
      await expect(fetchAdminGeocode(query, async () => { calls++; return response({}); })).rejects.toMatchObject({ code: 'payload' });
    }
    expect(calls).toBe(0);
    await expect(fetchAdminGeocode('합성', async () => { throw new Error('PRIVATE_NETWORK_ERROR'); })).rejects.toMatchObject({ code: 'network' });
    expect(adminGeocodeErrorMessage(new Error('PRIVATE'))).not.toContain('PRIVATE');
  });

  test('metadata uses its own exact BFF contract and validates the optional response', async () => {
    const place = { title: '합성', address: '주소', roadAddress: '도로', telephone: '' };
    const results = await fetchAdminPlaceItems('합성 주소', async (path, init) => {
      expect(path).toBe('/api/naver-search'); expect(init.credentials).toBe('same-origin');
      expect(JSON.parse(init.body as string)).toEqual({ query: '합성 주소', display: 5 });
      return response({ items: Array(8).fill(place) });
    });
    expect(results).toHaveLength(5);
    await expect(fetchAdminPlaceItems('합성', async () => response({ items: [{}] }))).rejects.toMatchObject({ code: 'payload' });
    await expect(fetchAdminPlaceItems('x'.repeat(101), async () => { throw new Error('must not call'); })).rejects.toMatchObject({ code: 'payload' });
  });
});

function geocodeHarness(overrides: Record<string, unknown> = {}) {
  const queries: string[] = [], errors: unknown[] = [];
  let results: Array<Record<string, unknown>> = [], selected: unknown = 0;
  const deps = {
    formData: { name: '합성 식당', address: '합성시 합성구 도로 1' },
    toast: () => {}, setGeocodingDirty: () => {}, setGeocodingNaver: () => {}, setGeocodingQueried: () => {},
    setGeocodingError: (value: unknown) => errors.push(value),
    setGeocodingResults: (value: typeof results) => { results = value; },
    setSelectedGeocodingIndex: (value: unknown) => { selected = value; },
    setAddressChanged: () => {}, setInitialAddress: () => {}, encodeJson: (value: unknown) => value,
    fetchAdminGeocode: async (query: string) => { queries.push(query); return [candidate]; },
    fetchAdminPlaceItems: async () => [], findBestNaverPlaceMatch: () => undefined,
    sanitizeNaverPlaceTitle: (value: string) => value, adminGeocodeErrorMessage, ...overrides,
  };
  const handlers = actual<{ handleReGeocodeNaver: () => Promise<void> }>(
    '  const handleReGeocodeNaver =', '  const buildChanges =', ['handleReGeocodeNaver'], deps,
  );
  return { ...handlers, queries, errors, results: () => results, selected: () => selected };
}

describe('actual modal geocode flow', () => {
  test('full address then district fallback deduplicates and never selects a new candidate automatically', async () => {
    const h = geocodeHarness(); await h.handleReGeocodeNaver();
    expect(h.queries).toEqual(['합성시 합성구 도로 1', '합성시 합성구']);
    expect(h.results()).toHaveLength(1); expect(h.selected()).toBeNull();
    expect(h.results()[0].metadata_warning).toContain('찾지 못했습니다');
  });
  test('fallback can recover an empty full-address response, and identical district query is not repeated', async () => {
    let calls = 0;
    const h = geocodeHarness({ fetchAdminGeocode: async () => ++calls === 1 ? [] : [candidate] });
    await h.handleReGeocodeNaver(); expect(calls).toBe(2); expect(h.results()).toHaveLength(1);
    const district = geocodeHarness({ formData: { name: '합성', address: '합성시 합성구' } });
    await district.handleReGeocodeNaver(); expect(district.queries).toHaveLength(1);
  });
  test('valid optional place metadata enriches the candidate without claiming evaluation evidence', async () => {
    const h = geocodeHarness({
      fetchAdminPlaceItems: async () => [{ title: '합성 장소', telephone: '02-000-0000' }],
      findBestNaverPlaceMatch: (items: unknown[]) => items[0],
    });
    await h.handleReGeocodeNaver();
    expect(h.results()[0]).toEqual({
      road_address: candidate.roadAddress, jibun_address: candidate.jibunAddress, english_address: '',
      address_elements: [], x: candidate.x, y: candidate.y, place_name: '합성 장소', place_phone: '02-000-0000',
    });
  });
  test('metadata failure retains the geocode candidate with a fixed truthful warning', async () => {
    const h = geocodeHarness({ fetchAdminPlaceItems: async () => { throw new AdminGeocodeError('rate_limit'); } });
    await h.handleReGeocodeNaver(); expect(h.results()).toHaveLength(1);
    expect(h.results()[0].metadata_warning).toContain('조회 한도'); expect(h.errors).toEqual([null]);
  });
  test('auth failure stops the flow without fallback calls or candidate selection', async () => {
    let calls = 0;
    const h = geocodeHarness({ fetchAdminGeocode: async () => { calls++; throw new AdminGeocodeError('access_denied'); } });
    await h.handleReGeocodeNaver(); expect(calls).toBe(1); expect(h.results()).toEqual([]);
    expect(h.selected()).toBeNull(); expect(h.errors.at(-1)).toContain('동일 출처');
  });
});

describe('actual modal stored-address and approval changes', () => {
  test('unverified original address only prefills query; invalid stored coordinates cannot be selected', () => {
    for (const [success, info] of [[true, null], [true, { jibun_address: '저장 주소', x: '', y: '' }], [true, { jibun_address: '저장 주소', x: '127', y: '91' }], [false, { jibun_address: '저장 주소', x: '127', y: '37' }]] as const) {
      let results: unknown = undefined, selected: unknown = undefined, form: unknown;
      actual('  // Modal이 열릴 때 초기화', '\n  useEffect(() => {\n    let cancelled', [], {
        open: true, record: { geocoding_success: success, origin_address: { address: '원본 합성 주소' }, restaurant_info: { naver_address_info: info } },
        initializedRef: { current: false }, initialFormRef: { current: '' }, useEffect: (fn: () => void) => fn(),
        parseCategoryList: () => [], getAdminEvaluationDisplayName: () => '합성', RESTAURANT_CATEGORIES: [],
        setInitialAddress: () => {}, setAddressChanged: () => {}, setFormData: (value: unknown) => { form = value; },
        hasValidGeocodeCoordinates, encodeJson: (value: unknown) => value,
        setGeocodingResults: (value: unknown) => { results = value; }, setSelectedGeocodingIndex: (value: unknown) => { selected = value; },
      });
      expect(results).toEqual([]); expect(selected).toBeNull();
      expect(form).toMatchObject({ address: info ? '저장 주소' : '원본 합성 주소' });
    }
  });
  test('unchanged short URL is canonicalized to the same video only for approval, with no evidence mutation', () => {
    const build = (url: string) => {
      const formData = { name: '합성', phone: '', categories: ['한식'], youtube_link: url, tzuyang_review: '' };
      return actual<{ buildChanges: (approve: boolean) => RestaurantRecordChanges }>(
        '  const buildChanges =', '  const performApproval =', ['buildChanges'], {
          formData, initialFormRef: { current: JSON.stringify(formData) }, selectedGeocodingIndex: null,
          geocodingResults: [], geocodingDirty: false, normalizeCanonicalYouTubeWatchUrl,
        },
      ).buildChanges;
    };
    const changes = build('https://youtu.be/dQw4w9WgXcQ');
    expect(changes(false)).toEqual({});
    expect(changes(true)).toEqual({ approved_name: '합성', categories: ['한식'], youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(() => build('https://invalid.example/watch?v=dQw4w9WgXcQ')(true)).toThrow('INVALID_YOUTUBE_URL');
  });
});
