import { expect, type Page, type Route } from '@playwright/test';

const LOCAL_REVIEW_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const SUPABASE_REST_ROUTE = '**/rest/v1/**';
const SUPABASE_AUTH_ROUTE = '**/auth/v1/**';
const LOCAL_REST_FIXTURE_PATHS = new Set([
    '/rest/v1/ad_banners',
    '/rest/v1/announcements',
    '/rest/v1/restaurants',
    '/rest/v1/reviews',
    '/rest/v1/profiles',
    '/rest/v1/review_likes',
    '/rest/v1/bookmarks',
    '/rest/v1/rpc/increment_search_count',
    '/rest/v1/rpc/search_restaurants_by_youtube_title',
]);
const LOCAL_AUTH_FIXTURE_PATHS = new Set(['/auth/v1/user']);
const LOCAL_NIGHTLY_MODE = process.env.NIGHTLY_MODE === 'local' || process.env.NIGHTLY_LOCAL_ENV_ONLY === '1';
const HOSTED_NIGHTLY_MODE = process.env.NIGHTLY_MODE === 'hosted';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const LOCAL_APP_ORIGIN = (() => {
    try {
        const value = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080');
        if (
            (value.protocol === 'http:' || value.protocol === 'https:')
            && LOOPBACK_HOSTS.has(value.hostname)
            && value.pathname === '/'
            && !value.search
            && !value.hash
            && !value.username
            && !value.password
        ) {
            return value.origin;
        }
    } catch {
        // Playwright validates its base URL before installing these fixtures.
    }
    return undefined;
})();
const LOCAL_NIGHTLY_PORTS = new Set([
    process.env.APP_PORT,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLIC_URL,
    process.env.API_EXTERNAL_URL,
    process.env.PLAYWRIGHT_BASE_URL,
].flatMap((value) => {
    if (!value) return [];
    try {
        return [new URL(value).port || '80'];
    } catch {
        return /^\d{1,5}$/.test(value) ? [value] : [];
    }
}));
const HOSTED_SUPABASE_ORIGINS = new Set(
    [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_URL]
        .flatMap((value) => {
            if (!value) return [];
            try {
                const parsed = new URL(value);
                return ['http:', 'https:'].includes(parsed.protocol) ? [parsed.origin] : [];
            } catch {
                return [];
            }
        }),
);

function isAllowedLocalNightlyUrl(url: URL): boolean {
    if (LOCAL_NIGHTLY_MODE) {
        return ['http:', 'https:'].includes(url.protocol)
            && LOOPBACK_HOSTS.has(url.hostname)
            && LOCAL_NIGHTLY_PORTS.has(url.port || (url.protocol === 'https:' ? '443' : '80'));
    }
    if (HOSTED_NIGHTLY_MODE) {
        return HOSTED_SUPABASE_ORIGINS.has(url.origin);
    }
    return true;
}

const RESTAURANT_FIXTURES = [
    {
        id: 'restaurant-search',
        approved_name: '정원분식',
        name: '정원분식',
        lat: 37.5665,
        lng: 126.978,
        road_address: '서울특별시 중구 세종대로 110',
        jibun_address: '서울특별시 중구 태평로1가 31',
        english_address: '110 Sejong-daero, Jung-gu, Seoul',
        categories: ['분식'],
        phone: '02-0000-0001',
        review_count: 12,
        weekly_search_count: 120,
        youtube_link: null,
        tzuyang_review: null,
        youtube_meta: null,
        status: 'approved',
        created_at: '2026-01-01T00:00:00.000Z',
    },
    {
        id: 'restaurant-marker-1',
        approved_name: '명동칼국수',
        name: '명동칼국수',
        lat: 37.56695,
        lng: 126.97885,
        road_address: '서울특별시 중구 을지로 30',
        jibun_address: '서울특별시 중구 을지로1가 50',
        english_address: '30 Eulji-ro, Jung-gu, Seoul',
        categories: ['한식'],
        phone: '02-0000-0002',
        review_count: 9,
        weekly_search_count: 98,
        youtube_link: null,
        tzuyang_review: null,
        youtube_meta: null,
        status: 'approved',
        created_at: '2026-01-02T00:00:00.000Z',
    },
    {
        id: 'restaurant-marker-2',
        approved_name: '서울돈까스',
        name: '서울돈까스',
        lat: 37.5661,
        lng: 126.9772,
        road_address: '서울특별시 중구 덕수궁길 15',
        jibun_address: '서울특별시 중구 서소문동 120',
        english_address: '15 Deoksugung-gil, Jung-gu, Seoul',
        categories: ['일식'],
        phone: '02-0000-0003',
        review_count: 7,
        weekly_search_count: 77,
        youtube_link: null,
        tzuyang_review: null,
        youtube_meta: null,
        status: 'approved',
        created_at: '2026-01-03T00:00:00.000Z',
    },
] as const;

const REVIEW_FIXTURES = [
    {
        id: 'review-marker-1',
        restaurant_id: 'restaurant-marker-1',
        user_id: 'user-reviewer-1',
        content: '국물이 진하고 만두가 푸짐해서 재방문하고 싶어요.',
        food_photos: [LOCAL_REVIEW_IMAGE],
        created_at: '2026-02-01T00:00:00.000Z',
        is_pinned: false,
    },
    {
        id: 'review-marker-2',
        restaurant_id: 'restaurant-marker-2',
        user_id: 'user-reviewer-2',
        content: '튀김이 바삭하고 소스가 깔끔했어요.',
        food_photos: [LOCAL_REVIEW_IMAGE],
        created_at: '2026-02-02T00:00:00.000Z',
        is_pinned: false,
    },
    {
        id: 'review-search',
        restaurant_id: 'restaurant-search',
        user_id: 'user-reviewer-3',
        content: '분식집 분위기가 좋고 떡볶이가 매콤해요.',
        food_photos: [LOCAL_REVIEW_IMAGE],
        created_at: '2026-02-03T00:00:00.000Z',
        is_pinned: true,
    },
] as const;

const PROFILE_FIXTURES = [
    { user_id: 'user-reviewer-1', nickname: '칼국수러버' },
    { user_id: 'user-reviewer-2', nickname: '돈까스탐험가' },
    { user_id: 'user-reviewer-3', nickname: '분식요정' },
] as const;

const MOCK_NAVER_MAPS_SOURCE = `
(() => {
  if (window.naver && window.naver.maps) return;

  const listenerStore = new WeakMap();

  const getListeners = (target) => {
    let listeners = listenerStore.get(target);
    if (!listeners) {
      listeners = new Map();
      listenerStore.set(target, listeners);
    }
    return listeners;
  };

  const addListener = (target, name, handler) => {
    const listeners = getListeners(target);
    const handlers = listeners.get(name) || [];
    handlers.push(handler);
    listeners.set(name, handlers);
    return { target, name, handler };
  };

  const removeListener = (token) => {
    if (!token || !token.target) return;
    const listeners = listenerStore.get(token.target);
    if (!listeners) return;
    const handlers = listeners.get(token.name) || [];
    listeners.set(
      token.name,
      handlers.filter((handler) => handler !== token.handler)
    );
  };

  const trigger = (target, name, ...args) => {
    if (target && typeof target.__handleMockMapEvent === 'function') {
      target.__handleMockMapEvent(name, ...args);
    }
    const listeners = listenerStore.get(target);
    if (!listeners) return;
    const handlers = listeners.get(name) || [];
    handlers.forEach((handler) => handler(...args));
  };

  class Point {
    constructor(x, y) {
      this.x = Number(x);
      this.y = Number(y);
    }
  }

  class LatLng {
    constructor(lat, lng) {
      this._lat = Number(lat);
      this._lng = Number(lng);
    }

    lat() {
      return this._lat;
    }

    lng() {
      return this._lng;
    }

    equals(other) {
      if (!other || typeof other.lat !== 'function' || typeof other.lng !== 'function') return false;
      return this._lat === other.lat() && this._lng === other.lng();
    }
  }

  const normalizeLatLng = (value) => {
    if (!value) return new LatLng(0, 0);
    if (value instanceof LatLng) return value;
    if (typeof value.lat === 'function' && typeof value.lng === 'function') {
      return new LatLng(value.lat(), value.lng());
    }
    return new LatLng(value.lat, value.lng);
  };

  const getScaleForZoom = (zoom) => 2500 * Math.pow(2, Number(zoom) - 10);

  class MockMap {
    constructor(container, options = {}) {
      this._container = container;
      this._center = normalizeLatLng(options.center || new LatLng(37.5665, 126.978));
      this._zoom = Number(options.zoom ?? 13);
      this._markers = new Set();
      this._overlay = document.createElement('div');
      this._overlay.dataset.testid = 'mock-naver-overlay';
      Object.assign(this._overlay.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
      });
      if (!container.style.position) {
        container.style.position = 'relative';
      }
      container.appendChild(this._overlay);
      setTimeout(() => trigger(this, 'idle'), 0);
    }

    __handleMockMapEvent(name) {
      if (name === 'resize') {
        this._rerenderMarkers();
      }
    }

    _getRect() {
      const rect = this._container.getBoundingClientRect();
      return {
        width: rect.width || 360,
        height: rect.height || 640,
      };
    }

    _registerMarker(marker) {
      this._markers.add(marker);
      this._overlay.appendChild(marker._element);
      marker._render();
    }

    _unregisterMarker(marker) {
      this._markers.delete(marker);
      marker._element.remove();
    }

    _rerenderMarkers() {
      this._markers.forEach((marker) => marker._render());
    }

    getCenter() {
      return this._center;
    }

    setCenter(center) {
      this._center = normalizeLatLng(center);
      this._rerenderMarkers();
      trigger(this, 'idle');
    }

    panTo(center) {
      this.setCenter(center);
    }

    panBy(x, y) {
      const projection = this.getProjection();
      const centerOffset = projection.fromCoordToOffset(this._center);
      const nextCenter = projection.fromOffsetToCoord(new Point(centerOffset.x + Number(x), centerOffset.y + Number(y)));
      this.setCenter(nextCenter);
    }

    morph(center, zoom) {
      if (center) {
        this._center = normalizeLatLng(center);
      }
      if (typeof zoom === 'number') {
        this._zoom = Number(zoom);
      }
      this._rerenderMarkers();
      trigger(this, 'idle');
    }

    getZoom() {
      return this._zoom;
    }

    setZoom(zoom) {
      this._zoom = Number(zoom);
      this._rerenderMarkers();
      trigger(this, 'idle');
    }

    getProjection() {
      const map = this;
      return {
        fromCoordToOffset(coordLike) {
          const coord = normalizeLatLng(coordLike);
          const { width, height } = map._getRect();
          const scale = getScaleForZoom(map._zoom);
          return new Point(
            width / 2 + (coord.lng() - map._center.lng()) * scale,
            height / 2 - (coord.lat() - map._center.lat()) * scale
          );
        },
        fromOffsetToCoord(pointLike) {
          const point = pointLike instanceof Point ? pointLike : new Point(pointLike.x, pointLike.y);
          const { width, height } = map._getRect();
          const scale = getScaleForZoom(map._zoom);
          return new LatLng(
            map._center.lat() - (point.y - height / 2) / scale,
            map._center.lng() + (point.x - width / 2) / scale
          );
        },
      };
    }

    getBounds() {
      const projection = this.getProjection();
      const { width, height } = this._getRect();
      const sw = projection.fromOffsetToCoord(new Point(0, height));
      const ne = projection.fromOffsetToCoord(new Point(width, 0));
      return {
        getSW: () => sw,
        getNE: () => ne,
      };
    }
  }

  class MockMarker {
    constructor({ position, icon, map }) {
      this._position = normalizeLatLng(position);
      this._icon = icon || {};
      this._map = null;
      this._zIndex = 1;
      this._element = document.createElement('div');
      Object.assign(this._element.style, {
        position: 'absolute',
        pointerEvents: 'auto',
      });
      this._element.addEventListener('click', (event) => {
        const markerEvent = { domEvent: event };
        if (typeof this.__onClick === 'function') {
          this.__onClick(markerEvent);
          return;
        }
        trigger(this, 'click', markerEvent);
      });
      this.setIcon(this._icon);
      if (map) {
        this.setMap(map);
      }
    }

    getPosition() {
      return this._position;
    }

    setPosition(position) {
      this._position = normalizeLatLng(position);
      this._render();
    }

    getMap() {
      return this._map;
    }

    setMap(map) {
      if (this._map === map) return;
      if (this._map) {
        this._map._unregisterMarker(this);
      }
      this._map = map || null;
      if (this._map) {
        this._map._registerMarker(this);
      }
    }

    getIcon() {
      return this._icon;
    }

    setIcon(icon) {
      this._icon = icon || {};
      this._element.innerHTML = this._icon.content || '<div data-testid="marker"></div>';
      this._element.querySelectorAll('[data-testid="marker"], .cluster-marker-container').forEach((interactiveElement) => {
        interactiveElement.addEventListener('click', (event) => {
          event.stopPropagation();
          const markerEvent = { domEvent: event };
          if (typeof this.__onClick === 'function') {
            this.__onClick(markerEvent);
            return;
          }
          trigger(this, 'click', markerEvent);
        });
      });
      this._render();
    }

    setZIndex(zIndex) {
      this._zIndex = Number(zIndex);
      this._element.style.zIndex = String(this._zIndex);
    }

    getElement() {
      return this._element;
    }

    _render() {
      if (!this._map) return;
      const projection = this._map.getProjection();
      const point = projection.fromCoordToOffset(this._position);
      const anchor = this._icon?.anchor || { x: 0, y: 0 };
      this._element.style.left = String(point.x - Number(anchor.x || 0)) + 'px';
      this._element.style.top = String(point.y - Number(anchor.y || 0)) + 'px';
      this._element.style.zIndex = String(this._zIndex);
    }
  }

  window.naver = {
    maps: {
      Event: { addListener, removeListener, trigger },
      LatLng,
      Map: MockMap,
      Marker: MockMarker,
      Point,
      Position: {
        TOP_LEFT: 'TOP_LEFT',
        TOP_RIGHT: 'TOP_RIGHT',
      },
    },
  };
})();
`;

const SUPABASE_FIXTURE_CORS_HEADERS = [
    'accept-profile',
    'apikey',
    'authorization',
    'content-profile',
    'content-type',
    'prefer',
    'range',
    'x-client-info',
    'x-retry-count',
] as const;
const SUPABASE_FIXTURE_CORS_HEADER_SET = new Set<string>(SUPABASE_FIXTURE_CORS_HEADERS);
const RESPONSE_HEADERS = {
    'access-control-allow-headers': SUPABASE_FIXTURE_CORS_HEADERS.join(', '),
    'access-control-allow-methods': 'GET,POST,OPTIONS,HEAD',
    'access-control-expose-headers': 'Content-Range, Link, Location',
    'access-control-max-age': '3600',
    'content-type': 'application/json',
    vary: 'Origin, Access-Control-Request-Headers',
} as const;

type RestaurantFixture = (typeof RESTAURANT_FIXTURES)[number];

function toJsonBody(data: unknown): string {
    return JSON.stringify(data);
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
    const request = route.request();
    const requestOrigin = await request.headerValue('origin');
    if (!LOCAL_APP_ORIGIN || requestOrigin !== LOCAL_APP_ORIGIN) {
        throw new Error('Mobile Supabase fixture rejected an untrusted browser origin.');
    }
    if (request.method() === 'OPTIONS') {
        const requestedMethod = (await request.headerValue('access-control-request-method'))?.toUpperCase();
        if (!requestedMethod || !['GET', 'HEAD', 'POST'].includes(requestedMethod)) {
            throw new Error('Mobile Supabase fixture rejected an unexpected preflight method.');
        }
        const requestedHeaders = (await request.headerValue('access-control-request-headers') ?? '')
            .split(',')
            .map((header) => header.trim().toLowerCase())
            .filter(Boolean);
        if (requestedHeaders.some((header) => !SUPABASE_FIXTURE_CORS_HEADER_SET.has(header))) {
            throw new Error('Mobile Supabase fixture rejected an unexpected preflight header.');
        }
    }
    await route.fulfill({
        status,
        headers: {
            ...RESPONSE_HEADERS,
            'access-control-allow-origin': LOCAL_APP_ORIGIN,
        },
        body: status === 204 || request.method() === 'HEAD' ? '' : toJsonBody(data),
    });
}

function getFilterToken(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(/[a-z]+\.(.*)/i);
    if (!match) return null;

    const rawToken = match[1] || '';
    const decodedToken = (() => {
        try {
            return decodeURIComponent(rawToken);
        } catch {
            return rawToken;
        }
    })();

    return decodedToken
        .replace(/^%/, '')
        .replace(/%$/, '')
        .replace(/\*/g, '')
        .toLowerCase();
}
function getArrayFilterTokens(value: string | null): string[] {
    const token = getFilterToken(value);
    if (!token) return [];

    return token
        .replace(/^\{/, '')
        .replace(/\}$/, '')
        .split(',')
        .map((item) => item.trim().replace(/^"|"$/g, '').toLowerCase())
        .filter(Boolean);
}


function applyBoundsFilter(restaurants: RestaurantFixture[], url: URL): RestaurantFixture[] {
    const latFilters = url.searchParams.getAll('lat');
    const lngFilters = url.searchParams.getAll('lng');

    let minLat = Number.NEGATIVE_INFINITY;
    let maxLat = Number.POSITIVE_INFINITY;
    let minLng = Number.NEGATIVE_INFINITY;
    let maxLng = Number.POSITIVE_INFINITY;

    for (const filter of latFilters) {
        if (filter.startsWith('gte.')) minLat = Number(filter.slice(4));
        if (filter.startsWith('lte.')) maxLat = Number(filter.slice(4));
    }

    for (const filter of lngFilters) {
        if (filter.startsWith('gte.')) minLng = Number(filter.slice(4));
        if (filter.startsWith('lte.')) maxLng = Number(filter.slice(4));
    }

    return restaurants.filter(
        (restaurant) =>
            restaurant.lat >= minLat &&
            restaurant.lat <= maxLat &&
            restaurant.lng >= minLng &&
            restaurant.lng <= maxLng
    );
}

function filterRestaurantsForRequest(url: URL): RestaurantFixture[] {
    const approvedNameFilter = getFilterToken(url.searchParams.get('approved_name'));
    const categoryFilters = getArrayFilterTokens(url.searchParams.get('categories'));

    let restaurants = [...RESTAURANT_FIXTURES];

    if (approvedNameFilter) {
        restaurants = restaurants.filter((restaurant) =>
            restaurant.approved_name.toLowerCase().includes(approvedNameFilter)
        );
    }

    if (categoryFilters.length > 0) {
        restaurants = restaurants.filter((restaurant) =>
            restaurant.categories.some((category) =>
                categoryFilters.some((categoryFilter) =>
                    category.toLowerCase().includes(categoryFilter)
                )
            )
        );
    }

    restaurants = applyBoundsFilter(restaurants, url);

    return restaurants;
}

async function handleSupabaseRestRoute(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const isMutationFixture = url.pathname.endsWith('/rest/v1/rpc/increment_search_count')
        || url.pathname.endsWith('/rest/v1/rpc/search_restaurants_by_youtube_title');

    if (!isAllowedLocalNightlyUrl(url)) {
        await route.abort('blockedbyclient');
        return;
    }
    if (!LOCAL_REST_FIXTURE_PATHS.has(url.pathname)) {
        await route.abort('blockedbyclient');
        return;
    }

    if (method === 'OPTIONS') {
        await fulfillJson(route, {}, 204);
        return;
    }

    if (method !== 'GET' && !(method === 'POST' && isMutationFixture)) {
        await route.abort('blockedbyclient');
        return;
    }

    if (url.pathname.endsWith('/rest/v1/restaurants')) {
        await fulfillJson(route, filterRestaurantsForRequest(url));
        return;
    }

    if (url.pathname.endsWith('/rest/v1/reviews')) {
        await fulfillJson(route, REVIEW_FIXTURES);
        return;
    }

    if (url.pathname.endsWith('/rest/v1/profiles')) {
        await fulfillJson(route, PROFILE_FIXTURES);
        return;
    }

    if (url.pathname.endsWith('/rest/v1/review_likes')) {
        await fulfillJson(route, []);
        return;
    }

    if (url.pathname.endsWith('/rest/v1/bookmarks')) {
        await fulfillJson(route, []);
        return;
    }

    if (
        url.pathname.endsWith('/rest/v1/announcements')
        || url.pathname.endsWith('/rest/v1/ad_banners')
    ) {
        await fulfillJson(route, []);
        return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/increment_search_count')) {
        await fulfillJson(route, {
            success: true,
            reason: 'ok',
            message: 'count updated',
        });
        return;
    }

    if (url.pathname.endsWith('/rest/v1/rpc/search_restaurants_by_youtube_title')) {
        const payload = request.postDataJSON?.() as { search_query?: string } | undefined;
        const query = (payload?.search_query || '').toLowerCase();
        const results = RESTAURANT_FIXTURES.filter((restaurant) =>
            restaurant.approved_name.toLowerCase().includes(query)
        );
        await fulfillJson(route, results);
        return;
    }

    await route.abort('blockedbyclient');
}

async function handleSupabaseAuthRoute(route: Route) {
    const request = route.request();
    const url = new URL(request.url());

    if (!isAllowedLocalNightlyUrl(url)) {
        await route.abort('blockedbyclient');
        return;
    }
    if (!LOCAL_AUTH_FIXTURE_PATHS.has(url.pathname)) {
        await route.abort('blockedbyclient');
        return;
    }

    if (request.method() === 'OPTIONS') {
        await fulfillJson(route, {}, 204);
        return;
    }

    if (request.method() !== 'GET') {
        await route.abort('blockedbyclient');
        return;
    }

    await fulfillJson(route, { message: 'Auth session missing!' }, 401);
}

export async function installMobileHomeMapTestMocks(page: Page) {
    await page.addInitScript({ content: MOCK_NAVER_MAPS_SOURCE });
    await installMobileHomeDataMocks(page);
}

export async function installMobileHomeDataMocks(page: Page) {
    await page.route(SUPABASE_REST_ROUTE, handleSupabaseRestRoute);
    await page.route(SUPABASE_AUTH_ROUTE, handleSupabaseAuthRoute);
}

export async function waitForMockMapReady(page: Page) {
    await page.waitForFunction(() => Boolean((window as typeof window & { __TZUDONG_DEBUG_MAP__?: unknown }).__TZUDONG_DEBUG_MAP__), undefined, {
        timeout: 15000,
    });
}

export async function openMobileSearchAndSelect(page: Page, restaurantName: string) {
    await page.getByLabel('맛집 검색 열기').click();
    await page.getByLabel('맛집 검색어 입력').fill(restaurantName);

    const searchResult = page.getByRole('button', { name: new RegExp(restaurantName) }).first();
    await expect(searchResult).toBeVisible({ timeout: 15000 });
    await searchResult.click();
}

export async function waitForVisibleMarkers(page: Page, count = 2) {
    await page.waitForFunction(
        (expectedCount) => document.querySelectorAll('[data-testid="marker"]').length >= Number(expectedCount),
        count,
        { timeout: 15000 }
    );
}

export async function waitForMarkerCount(page: Page, count: number) {
    await page.waitForFunction(
        (expectedCount) => document.querySelectorAll('[data-testid="marker"]').length === Number(expectedCount),
        count,
        { timeout: 15000 }
    );
}

export async function clickAnyUnselectedMarker(page: Page) {
    const clicked = await page.locator('[data-testid="marker"][style*="width: 32px"]').evaluateAll((elements) => {
        const target = elements.find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 &&
                rect.height > 0 &&
                element.hasAttribute('data-restaurant-id') &&
                element.getAttribute('data-restaurant-id') !== 'restaurant-search';
        }) ?? elements.find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });

        if (!(target instanceof HTMLElement)) {
            return false;
        }

        target.click();
        return true;
    });

    expect(clicked).toBe(true);
}

export async function tapMapBackground(page: Page) {
    await page.getByTestId('map-container').click({
        position: { x: 12, y: 12 },
    });
}

export async function swipeDetailPanelLeft(page: Page) {
    await page.waitForFunction(() => Boolean(document.querySelector('[data-restaurant-detail-swipe-area="content"]')));

    await page.evaluate(() => {
        const target = document.querySelector('[data-restaurant-detail-swipe-area="content"]');
        if (!(target instanceof HTMLElement)) {
            throw new Error('Unable to find swipe target for restaurant detail panel');
        }

        const rect = target.getBoundingClientRect();
        const clientY = rect.top + Math.min(Math.max(rect.height * 0.35, 80), rect.height - 40);
        const startX = rect.right - 40;
        const endX = rect.left + 40;

        const createTouchList = (clientX: number, nextClientY: number) => [
            {
                identifier: 1,
                clientX,
                clientY: nextClientY,
                pageX: clientX,
                pageY: nextClientY,
                screenX: clientX,
                screenY: nextClientY,
                target,
            },
        ];

        const dispatch = (type: string, touches: ReturnType<typeof createTouchList>, changedTouches: ReturnType<typeof createTouchList>) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'touches', { value: touches });
            Object.defineProperty(event, 'targetTouches', { value: touches });
            Object.defineProperty(event, 'changedTouches', { value: changedTouches });
            target.dispatchEvent(event);
        };

        dispatch('touchstart', createTouchList(startX, clientY), createTouchList(startX, clientY));
        dispatch('touchmove', createTouchList(endX, clientY), createTouchList(endX, clientY));
        dispatch('touchend', [], createTouchList(endX, clientY));
    });
}

export async function panMockMap(page: Page, deltaX = 120, deltaY = 0) {
    await page.evaluate(
        ({ nextDeltaX, nextDeltaY }) => {
            const win = window as typeof window & { __TZUDONG_DEBUG_MAP__?: unknown };
            const map = win.__TZUDONG_DEBUG_MAP__;
            if (!map || !window.naver?.maps?.Event) {
                throw new Error('Mock map is not ready');
            }

            window.naver.maps.Event.trigger(map, 'dragstart');
            (map as { panBy: (x: number, y: number) => void }).panBy(nextDeltaX, nextDeltaY);
        },
        { nextDeltaX: deltaX, nextDeltaY: deltaY }
    );
}

export async function zoomMockMap(page: Page, zoom: number) {
    await page.evaluate((nextZoom) => {
        const win = window as typeof window & { __TZUDONG_DEBUG_MAP__?: unknown };
        const map = win.__TZUDONG_DEBUG_MAP__;
        if (!map) {
            throw new Error('Mock map is not ready');
        }

        (map as { setZoom: (value: number) => void }).setZoom(nextZoom);
    }, zoom);
}

export async function waitForSheetHeightRatioAtMost(page: Page, maxRatio: number) {
    await page.waitForFunction(
        (expectedRatio) => {
            const sheet = document.querySelector('[data-sheet-state]');
            if (!(sheet instanceof HTMLElement)) {
                return false;
            }

            return sheet.getBoundingClientRect().height / window.innerHeight <= Number(expectedRatio);
        },
        maxRatio,
        { timeout: 5000 }
    );
}
