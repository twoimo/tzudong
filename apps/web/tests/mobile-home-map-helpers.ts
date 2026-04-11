import type { Page, Route } from '@playwright/test';

const SUPABASE_BASE_URL = 'http://127.0.0.1:54321';

const RESTAURANT_FIXTURES = [
    {
        id: 'restaurant-search',
        approved_name: '정원분식',
        name: '정원분식',
        lat: 37.5665,
        lng: 126.978,
        road_address: '서울 중구 세종대로 110',
        jibun_address: '서울 중구 태평로1가 31',
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
        road_address: '서울 중구 을지로 30',
        jibun_address: '서울 중구 을지로1가 50',
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
        road_address: '서울 중구 덕수궁길 15',
        jibun_address: '서울 중구 서소문동 120',
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
        trigger(this, 'click', { domEvent: event });
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

const RESPONSE_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS,HEAD',
    'content-type': 'application/json',
} as const;

type RestaurantFixture = (typeof RESTAURANT_FIXTURES)[number];

function toJsonBody(data: unknown): string {
    return JSON.stringify(data);
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
    await route.fulfill({
        status,
        headers: RESPONSE_HEADERS,
        body: route.request().method() === 'HEAD' ? '' : toJsonBody(data),
    });
}

function getFilterToken(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(/[a-z]+\.(.*)/i);
    if (!match) return null;
    return decodeURIComponent(match[1] || '')
        .replace(/^%/, '')
        .replace(/%$/, '')
        .replace(/\*/g, '')
        .toLowerCase();
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
    const categoriesFilter = getFilterToken(url.searchParams.get('categories'));

    let restaurants = [...RESTAURANT_FIXTURES];

    if (approvedNameFilter) {
        restaurants = restaurants.filter((restaurant) =>
            restaurant.approved_name.toLowerCase().includes(approvedNameFilter)
        );
    }

    if (categoriesFilter) {
        restaurants = restaurants.filter((restaurant) =>
            restaurant.categories.some((category) => category.toLowerCase().includes(categoriesFilter))
        );
    }

    restaurants = applyBoundsFilter(restaurants, url);

    return restaurants;
}

async function handleSupabaseRestRoute(route: Route) {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
        await fulfillJson(route, {});
        return;
    }

    if (url.pathname.endsWith('/rest/v1/restaurants')) {
        await fulfillJson(route, filterRestaurantsForRequest(url));
        return;
    }

    if (url.pathname.endsWith('/rest/v1/reviews')) {
        await fulfillJson(route, []);
        return;
    }

    if (url.pathname.endsWith('/rest/v1/profiles')) {
        await fulfillJson(route, []);
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

    await fulfillJson(route, []);
}

async function handleSupabaseAuthRoute(route: Route) {
    const request = route.request();

    if (request.method() === 'OPTIONS') {
        await fulfillJson(route, {});
        return;
    }

    await route.fulfill({
        status: 401,
        headers: RESPONSE_HEADERS,
        body: toJsonBody({ message: 'Auth session missing!' }),
    });
}

export async function installMobileHomeMapTestMocks(page: Page) {
    await page.addInitScript({ content: MOCK_NAVER_MAPS_SOURCE });
    await page.route(`${SUPABASE_BASE_URL}/rest/v1/**`, handleSupabaseRestRoute);
    await page.route(`${SUPABASE_BASE_URL}/auth/v1/**`, handleSupabaseAuthRoute);
}

export async function waitForMockMapReady(page: Page) {
    await page.waitForFunction(() => Boolean((window as typeof window & { __TZUDONG_DEBUG_MAP__?: unknown }).__TZUDONG_DEBUG_MAP__), undefined, {
        timeout: 15000,
    });
}

export async function openMobileSearchAndSelect(page: Page, restaurantName: string) {
    await page.getByLabel('맛집 검색 열기').click();
    await page.getByLabel('맛집 검색어 입력').fill(restaurantName);
    await page.getByRole('button', { name: new RegExp(restaurantName) }).first().click();
}

export async function waitForVisibleMarkers(page: Page, count = 2) {
    await page.waitForFunction(
        (expectedCount) => document.querySelectorAll('[data-testid="marker"]').length >= Number(expectedCount),
        count,
        { timeout: 15000 }
    );
}

export async function clickAnyUnselectedMarker(page: Page) {
    await page.locator('[data-testid="marker"][style*="width: 32px"]').first().click();
}

export async function closeDetailPanelFromMap(page: Page) {
    await page.getByTestId('map-container').click({
        position: { x: 12, y: 12 },
    });
    await page.waitForFunction(() => !document.querySelector('[data-testid="restaurant-detail-panel"]'), undefined, {
        timeout: 5000,
    });
}

export async function swipeDetailPanelLeft(page: Page) {
    await page.waitForFunction(() => {
        const panel = document.querySelector('[data-testid="restaurant-detail-panel"]');
        return Boolean(panel?.parentElement);
    });

    await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="restaurant-detail-panel"]');
        const target = panel?.parentElement;
        if (!(target instanceof HTMLElement)) {
            throw new Error('Unable to find swipe target for restaurant detail panel');
        }

        const createTouchList = (clientX: number, clientY: number) => [
            {
                identifier: 1,
                clientX,
                clientY,
                pageX: clientX,
                pageY: clientY,
                screenX: clientX,
                screenY: clientY,
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

        dispatch('touchstart', createTouchList(280, 280), createTouchList(280, 280));
        dispatch('touchmove', createTouchList(80, 280), createTouchList(80, 280));
        dispatch('touchend', [], createTouchList(80, 280));
    });
}
