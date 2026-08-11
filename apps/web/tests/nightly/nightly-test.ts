import { writeFile } from 'node:fs/promises';
import { expect, test as base, type Page, type Route, type TestInfo } from '@playwright/test';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLocalNightlyMode = process.env.NIGHTLY_MODE === 'local'
    || process.env.NIGHTLY_LOCAL_ENV_ONLY === '1';
const LOCAL_PORT_ENVIRONMENT_KEYS = [
    'APP_PORT',
    'KONG_HTTP_PORT',
    'KONG_HTTPS_PORT',
    'POSTGRES_HOST_PORT',
    'META_PORT',
    'STUDIO_PORT',
    'ANALYTICS_PORT',
    'POOLER_PROXY_PORT_TRANSACTION',
    'MAIL_SMTP_PORT',
    'MAIL_WEB_PORT',
    'MAIL_POP3_PORT',
] as const;

function configuredUrlPort(value: string | undefined): string {
    if (!value) return '';
    try {
        return new URL(value).port;
    } catch {
        return '';
    }
}

const configuredLocalPorts = new Set([
    ...LOCAL_PORT_ENVIRONMENT_KEYS.map((name) => process.env[name]).filter((value): value is string => Boolean(value)),
    configuredUrlPort(process.env.PLAYWRIGHT_BASE_URL),
    configuredUrlPort(process.env.NEXT_PUBLIC_SUPABASE_URL),
    configuredUrlPort(process.env.SUPABASE_PUBLIC_URL),
    configuredUrlPort(process.env.SUPABASE_URL),
    configuredUrlPort(process.env.API_EXTERNAL_URL),
].filter((value) => /^\d{1,5}$/.test(value)));

const LOOPBACK_PORTS = isLocalNightlyMode
    ? configuredLocalPorts
    : new Set([
        '',
        '3000',
        '54321',
        '54322',
        '54323',
        '8000',
        '8001',
        '8080',
        ...configuredLocalPorts,
    ]);
const NAVER_SDK_HOST = 'oapi.map.naver.com';
const SUPABASE_PATH = /\/(?:rest|auth|storage|realtime)\/v1(?:\/|$)/;
const LOCAL_SUPABASE_FIXTURE_PATHS = new Set([
    '/rest/v1/restaurants',
    '/rest/v1/reviews',
    '/rest/v1/profiles',
    '/rest/v1/review_likes',
    '/rest/v1/bookmarks',
    '/auth/v1/user',
]);
const LOCAL_APP_PATHS = new Set([
    '/',
    '/feed',
    '/global-map',
    '/stamp',
    '/leaderboard',
    '/insights',
    '/privacy',
    '/data-deletion',
    '/api/health',
    '/favicon.ico',
]);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_DIAGNOSTICS = 256;

const RESTAURANT_FIXTURES = [
    {
        id: 'nightly-restaurant-1',
        approved_name: '정원분식',
        name: '정원분식',
        lat: 37.5665,
        lng: 126.978,
        road_address: '서울특별시 중구 세종대로 110',
        jibun_address: '서울특별시 중구 태평로1가 31',
        english_address: '110 Sejong-daero, Jung-gu, Seoul',
        categories: ['분식'],
        phone: '02-0000-0001',
        review_count: 0,
        weekly_search_count: 0,
        youtube_link: null,
        tzuyang_review: null,
        youtube_meta: null,
        status: 'approved',
        created_at: '2026-01-01T00:00:00.000Z',
    },
    {
        id: 'nightly-restaurant-2',
        approved_name: '명동칼국수',
        name: '명동칼국수',
        lat: 37.56695,
        lng: 126.97885,
        road_address: '서울특별시 중구 을지로 30',
        jibun_address: '서울특별시 중구 을지로1가 50',
        english_address: '30 Eulji-ro, Jung-gu, Seoul',
        categories: ['한식'],
        phone: '02-0000-0002',
        review_count: 0,
        weekly_search_count: 0,
        youtube_link: null,
        tzuyang_review: null,
        youtube_meta: null,
        status: 'approved',
        created_at: '2026-01-02T00:00:00.000Z',
    },
] as const;

const MOCK_NAVER_MAPS_SOURCE = String.raw`
(() => {
  if (window.naver && window.naver.maps && window.naver.maps.Map) return;

  const listeners = new WeakMap();
  const listenerMap = (target) => {
    let map = listeners.get(target);
    if (!map) {
      map = new Map();
      listeners.set(target, map);
    }
    return map;
  };
  const addListener = (target, name, handler) => {
    const map = listenerMap(target);
    const handlers = map.get(name) || [];
    handlers.push(handler);
    map.set(name, handlers);
    return { target, name, handler };
  };
  const removeListener = (token) => {
    if (!token || !token.target) return;
    const map = listeners.get(token.target);
    if (!map) return;
    map.set(token.name, (map.get(token.name) || []).filter((handler) => handler !== token.handler));
  };
  const trigger = (target, name, ...args) => {
    if (target && typeof target.__handleMockMapEvent === 'function') target.__handleMockMapEvent(name, ...args);
    for (const handler of listenerMap(target).get(name) || []) handler(...args);
  };

  class Point {
    constructor(x, y) { this.x = Number(x); this.y = Number(y); }
  }
  class LatLng {
    constructor(lat, lng) { this._lat = Number(lat); this._lng = Number(lng); }
    lat() { return this._lat; }
    lng() { return this._lng; }
    equals(other) { return Boolean(other && typeof other.lat === 'function' && this._lat === other.lat() && this._lng === other.lng()); }
  }
  const asLatLng = (value) => {
    if (value instanceof LatLng) return value;
    if (value && typeof value.lat === 'function') return new LatLng(value.lat(), value.lng());
    return new LatLng(value?.lat || 0, value?.lng || 0);
  };
  class LatLngBounds {
    constructor(sw, ne) { this._sw = asLatLng(sw); this._ne = asLatLng(ne); }
    getSW() { return this._sw; }
    getNE() { return this._ne; }
  }
  const scaleForZoom = (zoom) => 2500 * Math.pow(2, Number(zoom) - 10);

  class MockMap {
    constructor(container, options = {}) {
      this._container = container;
      this._center = asLatLng(options.center || new LatLng(37.5665, 126.978));
      this._zoom = Number(options.zoom || 13);
      this._markers = new Set();
      this._overlay = document.createElement('div');
      this._overlay.dataset.testid = 'mock-naver-overlay';
      Object.assign(this._overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      if (!container.style.position) container.style.position = 'relative';
      container.appendChild(this._overlay);
      setTimeout(() => trigger(this, 'idle'), 0);
    }
    __handleMockMapEvent(name) { if (name === 'resize') this._rerenderMarkers(); }
    _rect() { const rect = this._container.getBoundingClientRect(); return { width: rect.width || 360, height: rect.height || 640 }; }
    _registerMarker(marker) { this._markers.add(marker); this._overlay.appendChild(marker._element); marker._render(); }
    _unregisterMarker(marker) { this._markers.delete(marker); marker._element.remove(); }
    _rerenderMarkers() { this._markers.forEach((marker) => marker._render()); }
    getCenter() { return this._center; }
    setCenter(center) { this._center = asLatLng(center); this._rerenderMarkers(); trigger(this, 'idle'); }
    panTo(center) { this.setCenter(center); }
    panBy(x, y) { const p = this.getProjection().fromCoordToOffset(this._center); this.setCenter(this.getProjection().fromOffsetToCoord(new Point(p.x + Number(x), p.y + Number(y)))); }
    morph(center, zoom) { if (center) this._center = asLatLng(center); if (typeof zoom === 'number') this._zoom = zoom; this._rerenderMarkers(); trigger(this, 'idle'); }
    getZoom() { return this._zoom; }
    setZoom(zoom) { this._zoom = Number(zoom); this._rerenderMarkers(); trigger(this, 'idle'); }
    getProjection() {
      const map = this;
      return {
        fromCoordToOffset(coordLike) {
          const coord = asLatLng(coordLike); const rect = map._rect(); const scale = scaleForZoom(map._zoom);
          return new Point(rect.width / 2 + (coord.lng() - map._center.lng()) * scale, rect.height / 2 - (coord.lat() - map._center.lat()) * scale);
        },
        fromOffsetToCoord(pointLike) {
          const point = pointLike instanceof Point ? pointLike : new Point(pointLike.x, pointLike.y); const rect = map._rect(); const scale = scaleForZoom(map._zoom);
          return new LatLng(map._center.lat() - (point.y - rect.height / 2) / scale, map._center.lng() + (point.x - rect.width / 2) / scale);
        },
      };
    }
    getBounds() {
      const projection = this.getProjection(); const rect = this._rect();
      return { getSW: () => projection.fromOffsetToCoord(new Point(0, rect.height)), getNE: () => projection.fromOffsetToCoord(new Point(rect.width, 0)) };
    }
    fitBounds(bounds) {
      if (bounds && typeof bounds.getSW === 'function' && typeof bounds.getNE === 'function') {
        const sw = bounds.getSW(); const ne = bounds.getNE();
        this._center = new LatLng((sw.lat() + ne.lat()) / 2, (sw.lng() + ne.lng()) / 2);
      }
      this._rerenderMarkers(); trigger(this, 'idle');
    }
  }

  class MockMarker {
    constructor({ position, icon, map }) {
      this._position = asLatLng(position); this._icon = icon || {}; this._map = null; this._zIndex = 1;
      this._element = document.createElement('div');
      Object.assign(this._element.style, { position: 'absolute', pointerEvents: 'auto' });
      this._element.addEventListener('click', (event) => {
        const markerEvent = { domEvent: event };
        if (typeof this.__onClick === 'function') this.__onClick(markerEvent); else trigger(this, 'click', markerEvent);
      });
      this.setIcon(this._icon); if (map) this.setMap(map);
    }
    getPosition() { return this._position; }
    setPosition(position) { this._position = asLatLng(position); this._render(); }
    getMap() { return this._map; }
    setMap(map) { if (this._map === map) return; if (this._map) this._map._unregisterMarker(this); this._map = map || null; if (this._map) this._map._registerMarker(this); }
    getIcon() { return this._icon; }
    setIcon(icon) {
      this._icon = icon || {}; this._element.innerHTML = this._icon.content || '<div data-testid="marker"></div>';
      this._element.querySelectorAll('[data-testid="marker"], .cluster-marker-container').forEach((element) => element.addEventListener('click', (event) => {
        event.stopPropagation(); const markerEvent = { domEvent: event };
        if (typeof this.__onClick === 'function') this.__onClick(markerEvent); else trigger(this, 'click', markerEvent);
      }));
      this._render();
    }
    setZIndex(zIndex) { this._zIndex = Number(zIndex); this._element.style.zIndex = String(this._zIndex); }
    getElement() { return this._element; }
    _render() {
      if (!this._map) return; const point = this._map.getProjection().fromCoordToOffset(this._position); const anchor = this._icon?.anchor || { x: 0, y: 0 };
      this._element.style.left = String(point.x - Number(anchor.x || 0)) + 'px'; this._element.style.top = String(point.y - Number(anchor.y || 0)) + 'px'; this._element.style.zIndex = String(this._zIndex);
    }
  }

  window.naver = { maps: { Event: { addListener, removeListener, trigger }, LatLng, LatLngBounds, Map: MockMap, Marker: MockMarker, Point, Position: { TOP_LEFT: 'TOP_LEFT', TOP_RIGHT: 'TOP_RIGHT' } } };
})();
`;

export type NightlyRouteDiagnostic = Readonly<{
    host: string;
    method: string;
    status: number;
    class: string;
}>;

type DiagnosticClass = NightlyRouteDiagnostic['class'];

function isLoopbackUrl(url: URL): boolean {
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname) && LOOPBACK_PORTS.has(url.port);
}
function isLoopbackWebSocketUrl(url: URL): boolean {
    return (url.protocol === 'ws:' || url.protocol === 'wss:')
        && LOOPBACK_HOSTS.has(url.hostname)
        && LOOPBACK_PORTS.has(url.port);
}
function isNextDevWebSocketUrl(url: URL): boolean {
    return isLoopbackWebSocketUrl(url) && url.pathname === '/_next/webpack-hmr';
}

function isSupabaseUrl(url: URL): boolean {
    return SUPABASE_PATH.test(url.pathname);
}
const HOSTED_SUPABASE_ORIGIN = (() => {
    if (isLocalNightlyMode) return undefined;
    const projectRef = process.env.NIGHTLY_SUPABASE_PROJECT_REF?.trim();
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!projectRef || !configuredUrl) return undefined;
    try {
        const parsed = new URL(configuredUrl);
        const expectedHost = `${projectRef}.supabase.co`;
        if (
            parsed.protocol !== 'https:'
            || parsed.hostname !== expectedHost
            || (parsed.port && parsed.port !== '443')
            || parsed.pathname !== '/'
            || parsed.search
            || parsed.hash
            || parsed.username
            || parsed.password
        ) {
            return undefined;
        }
        return parsed.origin;
    } catch {
        return undefined;
    }
})();

function isAllowedHostedSupabaseUrl(url: URL): boolean {
    return Boolean(HOSTED_SUPABASE_ORIGIN)
        && url.protocol === 'https:'
        && url.origin === HOSTED_SUPABASE_ORIGIN
        && SUPABASE_PATH.test(url.pathname);
}

function isAllowedHostedSupabaseWebSocketUrl(url: URL): boolean {
    const origin = HOSTED_SUPABASE_ORIGIN;
    if (!origin) return false;
    return url.protocol === 'wss:'
        && url.origin === origin.replace(/^https:/, 'wss:')
        && url.pathname === '/realtime/v1/websocket';
}

function isNaverSdkUrl(url: URL): boolean {
    if (url.hostname === NAVER_SDK_HOST && url.pathname === '/openapi/v3/maps.js') {
        return !isLocalNightlyMode;
    }
    return isLoopbackUrl(url) && url.pathname === '/__nightly/naver-maps.js';
}

function isMutationMethod(method: string): boolean {
    return MUTATION_METHODS.has(method.toUpperCase());
}
function isAllowedSupabaseFixturePath(url: URL): boolean {
    return LOCAL_SUPABASE_FIXTURE_PATHS.has(url.pathname);
}
function isAllowedApplicationUrl(url: URL): boolean {
    const appPort = process.env.APP_PORT?.trim() || configuredUrlPort(process.env.PLAYWRIGHT_BASE_URL);
    if (!isLoopbackUrl(url) || !appPort || url.port !== appPort) return false;
    return LOCAL_APP_PATHS.has(url.pathname)
        || url.pathname.startsWith('/_next/')
        || url.pathname.startsWith('/__nextjs_');
}
function isAllowedSupabaseWebSocketUrl(url: URL): boolean {
    return isLoopbackWebSocketUrl(url) && url.pathname === '/realtime/v1/websocket';
}

function classifyDeniedDestination(url: URL): DiagnosticClass {
    if (/\.supabase\.co$/i.test(url.hostname)) return 'hosted-supabase-denied';
    if (/image|unsplash|youtube|google|pstatic|naver/i.test(url.hostname)) return 'third-party-provider-denied';
    return 'unknown-destination-denied';
}

function recordDiagnostic(diagnostics: NightlyRouteDiagnostic[], diagnostic: NightlyRouteDiagnostic): void {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
}

async function fulfillJson(route: Route, data: unknown, status = 200): Promise<void> {
    await route.fulfill({
        status,
        headers: {
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET,HEAD,OPTIONS',
            'access-control-allow-origin': '*',
            'content-type': 'application/json; charset=utf-8',
        },
        body: status === 204 || route.request().method() === 'HEAD' ? '' : JSON.stringify(data),
    });
}

function filterRestaurants(url: URL) {
    const nameFilter = url.searchParams.get('approved_name')?.replace(/^eq\./, '').toLowerCase();
    if (!nameFilter) return RESTAURANT_FIXTURES;
    return RESTAURANT_FIXTURES.filter((restaurant) => restaurant.approved_name.toLowerCase().includes(nameFilter));
}

async function fulfillSupabase(route: Route, diagnostics: NightlyRouteDiagnostic[]): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (isMutationMethod(request.method())) {
        recordDiagnostic(diagnostics, { host: url.hostname, method: request.method(), status: 0, class: 'mutation-denied' });
        await route.abort('blockedbyclient');
        return;
    }

    if (!isAllowedSupabaseFixturePath(url)) {
        recordDiagnostic(diagnostics, { host: url.hostname, method: request.method(), status: 0, class: 'supabase-path-denied' });
        await route.abort('blockedbyclient');
        return;
    }

    if (request.method() === 'OPTIONS') {
        await fulfillJson(route, {}, 204);
        recordDiagnostic(diagnostics, { host: url.hostname, method: request.method(), status: 204, class: 'supabase-offline' });
        return;
    }

    if (request.method() !== 'GET') {
        recordDiagnostic(diagnostics, { host: url.hostname, method: request.method(), status: 0, class: 'supabase-method-denied' });
        await route.abort('blockedbyclient');
        return;
    }

    switch (url.pathname) {
        case '/rest/v1/restaurants':
            await fulfillJson(route, filterRestaurants(url));
            break;
        case '/rest/v1/reviews':
        case '/rest/v1/profiles':
        case '/rest/v1/review_likes':
        case '/rest/v1/bookmarks':
            await fulfillJson(route, []);
            break;
        case '/auth/v1/user':
            await fulfillJson(route, { message: 'Auth session missing' }, 401);
            recordDiagnostic(diagnostics, { host: url.hostname, method: request.method(), status: 401, class: 'supabase-offline' });
            return;
        default:
            recordDiagnostic(diagnostics, { host: url.hostname, method: request.method(), status: 0, class: 'supabase-path-denied' });
            await route.abort('blockedbyclient');
            return;
    }
    recordDiagnostic(diagnostics, { host: url.hostname, method: request.method(), status: 200, class: 'supabase-offline' });
}

async function fulfillNaverSdk(route: Route, diagnostics: NightlyRouteDiagnostic[]): Promise<void> {
    const url = new URL(route.request().url());
    await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: 'window.naver = window.naver || {};',
    });
    recordDiagnostic(diagnostics, { host: url.hostname, method: route.request().method(), status: 200, class: 'naver-offline' });
}

export const test = base.extend({
    page: async ({ page }, fixtureUse, testInfo) => {
        const diagnostics: NightlyRouteDiagnostic[] = [];
        await page.addInitScript({ content: MOCK_NAVER_MAPS_SOURCE });
        page.on('requestfailed', (request) => {
            let url: URL;
            try {
                url = new URL(request.url());
            } catch {
                return;
            }
            recordDiagnostic(diagnostics, {
                host: url.hostname,
                method: request.method(),
                status: 0,
                class: 'request-failed',
            });
        });
        await page.routeWebSocket('**/*', async (webSocket) => {
            let url: URL;
            try {
                url = new URL(webSocket.url());
            } catch {
                recordDiagnostic(diagnostics, { host: 'invalid', method: 'GET', status: 0, class: 'websocket-denied' });
                await webSocket.close();
                return;
            }
            if (!isLoopbackWebSocketUrl(url) && !isAllowedHostedSupabaseWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, { host: url.hostname, method: 'GET', status: 0, class: 'websocket-denied' });
                await webSocket.close();
                return;
            }
            if (isAllowedHostedSupabaseWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, { host: url.hostname, method: 'GET', status: 200, class: 'hosted-supabase-allowed' });
                await webSocket.connectToServer();
                return;
            }
            if (isNextDevWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, { host: url.hostname, method: 'GET', status: 200, class: 'local-dev-websocket' });
                await webSocket.connectToServer();
                return;
            }
            if (!isAllowedSupabaseWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, { host: url.hostname, method: 'GET', status: 0, class: 'websocket-path-denied' });
                await webSocket.close();
                return;
            }
            await webSocket.connectToServer();
        });
        await page.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const method = request.method().toUpperCase();

            if (isMutationMethod(method)) {
                recordDiagnostic(diagnostics, { host: url.hostname, method, status: 0, class: 'mutation-denied' });
                await route.abort('blockedbyclient');
                return;
            }
            if (isNaverSdkUrl(url)) {
                await fulfillNaverSdk(route, diagnostics);
                return;
            }
            if (isAllowedHostedSupabaseUrl(url)) {
                if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
                    recordDiagnostic(diagnostics, { host: url.hostname, method, status: 0, class: 'hosted-supabase-method-denied' });
                    await route.abort('blockedbyclient');
                    return;
                }
                await route.continue();
                return;
            }
            if (!isLoopbackUrl(url)) {
                recordDiagnostic(diagnostics, { host: url.hostname, method, status: 0, class: classifyDeniedDestination(url) });
                await route.abort('blockedbyclient');
                return;
            }
            if (isSupabaseUrl(url)) {
                await fulfillSupabase(route, diagnostics);
                return;
            }
            if (!isAllowedApplicationUrl(url)) {
                recordDiagnostic(diagnostics, { host: url.hostname, method, status: 0, class: 'application-path-denied' });
                await route.abort('blockedbyclient');
                return;
            }
            if (method !== 'GET' && method !== 'HEAD') {
                recordDiagnostic(diagnostics, { host: url.hostname, method, status: 0, class: 'application-method-denied' });
                await route.abort('blockedbyclient');
                return;
            }
            await route.continue();
        });

        const diagnosticsPath = testInfo.outputPath('nightly-route-diagnostics.json');
        try {
            await fixtureUse(page);
        } finally {
            const diagnosticsBody = JSON.stringify(diagnostics, null, 2);
            await writeFile(diagnosticsPath, diagnosticsBody, { encoding: 'utf8', mode: 0o600 });
            await testInfo.attach('nightly-route-diagnostics.json', {
                path: diagnosticsPath,
                contentType: 'application/json',
            });
        }
    },
});

export { expect };
export type { Page, Route, TestInfo };
