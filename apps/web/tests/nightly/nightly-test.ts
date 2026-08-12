import { writeFile } from 'node:fs/promises';
import { expect, test as base, type Page, type Route, type TestInfo } from '@playwright/test';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLocalNightlyMode = process.env.NIGHTLY_MODE === 'local'
    || process.env.NIGHTLY_LOCAL_ENV_ONLY === '1';
const LOCAL_SUPABASE_ORIGIN = (() => {
    if (!isLocalNightlyMode) return undefined;
    try {
        const value = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
        return LOOPBACK_HOSTS.has(value.hostname) ? value.origin : undefined;
    } catch {
        return undefined;
    }
})();
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
        // The runner validates the configured base URL before Playwright starts.
    }
    return undefined;
})();
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
const SUPABASE_PATH = /\/(?:rest|auth|storage|realtime|functions)\/v1(?:\/|$)/;
const LOCAL_NIGHTLY_STORAGE_OBJECT_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/nightly-browser-cors\/review\.webp$/;
const LOCAL_NIGHTLY_STORAGE_UPLOAD_PATH = /^\/storage\/v1\/object\/review-photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/nightly-browser-cors\/review\.webp$/;
const LOCAL_NIGHTLY_STORAGE_WEBP_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/v89WAAAAA==';
const LOCAL_NIGHTLY_FUNCTION_BODY = '{"query":"서울특별시 중구 세종대로 110","count":1}';
const LOCAL_SUPABASE_FIXTURE_PATHS = new Set([
    '/rest/v1/ad_banners',
    '/rest/v1/announcements',
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
const LOCAL_ADMIN_MUTATION_PATHS = new Set([
    '/api/admin/map-overlays/preview',
    '/api/admin/map-overlays/apply',
]);
const LOCAL_ADMIN_READ_PATHS = new Set([
    '/api/admin/evaluations',
    '/api/admin/map-overlays',
]);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SUPABASE_FIXTURE_CORS_HEADERS = [
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
const FORBIDDEN_PUBLIC_DATA_CONSOLE_ERRORS = new Set([
    '활성 공지사항 조회 중 오류:',
    '배너 공지사항 조회 중 오류:',
    '광고 배너 조회 실패:',
]);
const MAX_DIAGNOSTICS = 256;
const MAX_DIAGNOSTIC_COUNT = 65_535;

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
    destination: DiagnosticDestination;
    method: string;
    status: number;
    class: DiagnosticClass;
    count: number;
}>;

type DiagnosticDestination =
    | 'local-web'
    | 'local-supabase'
    | 'hosted-supabase'
    | 'naver-maps'
    | 'third-party-provider'
    | 'external-other'
    | 'invalid-url';
type DiagnosticClass =
    | 'application-method-denied'
    | 'application-path-denied'
    | 'hosted-supabase-allowed'
    | 'hosted-supabase-denied'
    | 'hosted-supabase-method-denied'
    | 'local-dev-websocket'
    | 'local-supabase-allowed'
    | 'mutation-denied'
    | 'naver-offline'
    | 'request-failed'
    | 'supabase-method-denied'
    | 'supabase-offline'
    | 'supabase-path-denied'
    | 'third-party-provider-denied'
    | 'unknown-destination-denied'
    | 'websocket-denied'
    | 'websocket-path-denied';

const DIAGNOSTIC_COMPATIBILITY = new Set([
    'application-method-denied:local-web',
    'application-path-denied:local-web',
    'hosted-supabase-allowed:hosted-supabase',
    'hosted-supabase-denied:hosted-supabase',
    'hosted-supabase-method-denied:hosted-supabase',
    'local-dev-websocket:local-web',
    'local-supabase-allowed:local-supabase',
    'mutation-denied:local-web',
    'mutation-denied:local-supabase',
    'mutation-denied:hosted-supabase',
    'mutation-denied:naver-maps',
    'mutation-denied:third-party-provider',
    'mutation-denied:external-other',
    'naver-offline:naver-maps',
    'request-failed:local-web',
    'request-failed:local-supabase',
    'request-failed:hosted-supabase',
    'request-failed:naver-maps',
    'request-failed:third-party-provider',
    'request-failed:external-other',
    'supabase-method-denied:local-supabase',
    'supabase-offline:local-supabase',
    'supabase-path-denied:local-supabase',
    'third-party-provider-denied:third-party-provider',
    'unknown-destination-denied:external-other',
    'websocket-denied:hosted-supabase',
    'websocket-denied:naver-maps',
    'websocket-denied:third-party-provider',
    'websocket-denied:external-other',
    'websocket-denied:invalid-url',
    'websocket-path-denied:local-web',
    'websocket-path-denied:local-supabase',
]);

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
    return isLoopbackUrl(url) && url.pathname === '/__local/naver-maps.js';
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
    const localOrigin = LOCAL_SUPABASE_ORIGIN;
    return Boolean(localOrigin)
        && isLoopbackWebSocketUrl(url)
        && url.origin === localOrigin?.replace(/^http:/, 'ws:')
        && url.pathname === '/realtime/v1/websocket'
        && url.searchParams.size === 2
        && url.searchParams.get('apikey') === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        && url.searchParams.get('vsn') === '2.0.0';
}
function isAllowedLocalSupabaseUrl(url: URL): boolean {
    return Boolean(LOCAL_SUPABASE_ORIGIN)
        && url.origin === LOCAL_SUPABASE_ORIGIN
        && SUPABASE_PATH.test(url.pathname);
}
function isAllowedLocalStorageCleanup(postData: string | null): boolean {
    if (!postData || postData.length > 256) return false;
    try {
        const value = JSON.parse(postData) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const record = value as Record<string, unknown>;
        return Object.keys(record).length === 1
            && Array.isArray(record.prefixes)
            && record.prefixes.length === 1
            && typeof record.prefixes[0] === 'string'
            && LOCAL_NIGHTLY_STORAGE_OBJECT_PREFIX.test(record.prefixes[0]);
    } catch {
        return false;
    }
}
function isAllowedLocalSupabaseMutation(
    url: URL,
    method: string,
    postData: Buffer | null,
    headers: Record<string, string>,
): boolean {
    if (!isAllowedLocalSupabaseUrl(url)) return false;
    if (url.pathname === '/auth/v1/token') {
        return method === 'POST' && url.search === '?grant_type=password';
    }
    if (url.pathname === '/functions/v1/naver-geocode') {
        return method === 'POST'
            && !url.search
            && headers['content-type'] === 'application/json'
            && postData?.toString('utf8') === LOCAL_NIGHTLY_FUNCTION_BODY;
    }
    if (LOCAL_NIGHTLY_STORAGE_UPLOAD_PATH.test(url.pathname)) {
        return method === 'POST'
            && !url.search
            && headers['content-type'] === 'image/webp'
            && headers['cache-control'] === 'max-age=3600'
            && headers['x-upsert'] === 'false'
            && postData?.toString('base64') === LOCAL_NIGHTLY_STORAGE_WEBP_BASE64;
    }
    return method === 'DELETE'
        && url.pathname === '/storage/v1/object/review-photos'
        && !url.search
        && headers['content-type'] === 'application/json'
        && isAllowedLocalStorageCleanup(postData?.toString('utf8') ?? null);
}
function isAllowedLocalAdminMutation(url: URL, method: string): boolean {
    const appPort = process.env.APP_PORT?.trim() || configuredUrlPort(process.env.PLAYWRIGHT_BASE_URL);
    return method === 'POST'
        && Boolean(appPort)
        && isLoopbackUrl(url)
        && url.port === appPort
        && !url.search
        && LOCAL_ADMIN_MUTATION_PATHS.has(url.pathname);
}
function isAllowedLocalAdminRead(url: URL, method: string): boolean {
    const appPort = process.env.APP_PORT?.trim() || configuredUrlPort(process.env.PLAYWRIGHT_BASE_URL);
    if (
        method !== 'GET'
        || !appPort
        || !isLoopbackUrl(url)
        || url.port !== appPort
        || !LOCAL_ADMIN_READ_PATHS.has(url.pathname)
    ) {
        return false;
    }
    if (url.pathname === '/api/admin/evaluations') return !url.search;
    return url.search === '?restaurantIds=00000000-0000-4000-8000-000000000101&types=trend';
}

function classifyDestination(url: URL): DiagnosticDestination {
    if (isNaverSdkUrl(url)) return 'naver-maps';
    if (LOCAL_SUPABASE_ORIGIN && url.origin === LOCAL_SUPABASE_ORIGIN) return 'local-supabase';
    if (
        LOCAL_SUPABASE_ORIGIN
        && url.origin === LOCAL_SUPABASE_ORIGIN.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    ) return 'local-supabase';
    if (/\.supabase\.co$/i.test(url.hostname)) return 'hosted-supabase';
    if (/image|unsplash|youtube|google|pstatic|naver/i.test(url.hostname)) return 'third-party-provider';
    if (isSupabaseUrl(url) && isLoopbackUrl(url)) return 'local-supabase';
    if (isLoopbackUrl(url) || isLoopbackWebSocketUrl(url)) return 'local-web';
    return 'external-other';
}

function classifyDeniedDestination(url: URL): DiagnosticClass {
    if (/\.supabase\.co$/i.test(url.hostname)) return 'hosted-supabase-denied';
    if (/image|unsplash|youtube|google|pstatic|naver/i.test(url.hostname)) return 'third-party-provider-denied';
    return 'unknown-destination-denied';
}

function diagnosticForUrl(
    url: URL,
    method: string,
    status: number,
    diagnosticClass: DiagnosticClass,
): Omit<NightlyRouteDiagnostic, 'count'> {
    return {
        destination: classifyDestination(url),
        method: method.toUpperCase(),
        status,
        class: diagnosticClass,
    };
}

function recordDiagnostic(
    diagnostics: NightlyRouteDiagnostic[],
    diagnostic: Omit<NightlyRouteDiagnostic, 'count'>,
): void {
    if (!DIAGNOSTIC_COMPATIBILITY.has(`${diagnostic.class}:${diagnostic.destination}`)) {
        throw new Error('Nightly route diagnostic class and destination are incompatible.');
    }
    const index = diagnostics.findIndex((current) => (
        current.destination === diagnostic.destination
        && current.method === diagnostic.method
        && current.status === diagnostic.status
        && current.class === diagnostic.class
    ));
    if (index >= 0) {
        const current = diagnostics[index];
        if (!current || current.count >= MAX_DIAGNOSTIC_COUNT) {
            throw new Error('Nightly route diagnostic count exceeded its bound.');
        }
        diagnostics[index] = { ...current, count: current.count + 1 };
        return;
    }
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
        throw new Error('Nightly route diagnostic tuple count exceeded its bound.');
    }
    diagnostics.push({ ...diagnostic, count: 1 });
}

async function fulfillJson(route: Route, data: unknown, status = 200): Promise<void> {
    const request = route.request();
    const requestHeaders = request.headers();
    if (!LOCAL_APP_ORIGIN || requestHeaders.origin !== LOCAL_APP_ORIGIN) {
        throw new Error('Nightly Supabase fixture rejected an untrusted browser origin.');
    }
    if (request.method() === 'OPTIONS') {
        const requestedMethod = requestHeaders['access-control-request-method']?.toUpperCase();
        if (requestedMethod !== 'GET' && requestedMethod !== 'HEAD') {
            throw new Error('Nightly Supabase fixture rejected an unexpected preflight method.');
        }
        const requestedHeaders = (requestHeaders['access-control-request-headers'] ?? '')
            .split(',')
            .map((header) => header.trim().toLowerCase())
            .filter(Boolean);
        if (requestedHeaders.some((header) => !SUPABASE_FIXTURE_CORS_HEADER_SET.has(header))) {
            throw new Error('Nightly Supabase fixture rejected an unexpected preflight header.');
        }
    }
    await route.fulfill({
        status,
        headers: {
            'access-control-allow-headers': SUPABASE_FIXTURE_CORS_HEADERS.join(', '),
            'access-control-allow-methods': 'GET,HEAD,OPTIONS',
            'access-control-allow-origin': LOCAL_APP_ORIGIN,
            'access-control-expose-headers': 'Content-Range, Link, Location',
            'access-control-max-age': '3600',
            'content-type': 'application/json; charset=utf-8',
            vary: 'Origin, Access-Control-Request-Headers',
        },
        body: status === 204 || request.method() === 'HEAD' ? '' : JSON.stringify(data),
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
        recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 0, 'mutation-denied'));
        await route.abort('blockedbyclient');
        return;
    }

    if (!isAllowedSupabaseFixturePath(url)) {
        recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 0, 'supabase-path-denied'));
        await route.abort('blockedbyclient');
        return;
    }

    if (request.method() === 'OPTIONS') {
        await fulfillJson(route, {}, 204);
        recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 204, 'supabase-offline'));
        return;
    }

    if (request.method() !== 'GET') {
        recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 0, 'supabase-method-denied'));
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
        case '/rest/v1/announcements':
        case '/rest/v1/ad_banners':
            await fulfillJson(route, []);
            break;
        case '/auth/v1/user':
            await fulfillJson(route, { message: 'Auth session missing' }, 401);
            recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 401, 'supabase-offline'));
            return;
        default:
            recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 0, 'supabase-path-denied'));
            await route.abort('blockedbyclient');
            return;
    }
    recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 200, 'supabase-offline'));
}

async function fulfillNaverSdk(route: Route, diagnostics: NightlyRouteDiagnostic[]): Promise<void> {
    const url = new URL(route.request().url());
    await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: 'window.naver = window.naver || {};',
    });
    recordDiagnostic(diagnostics, diagnosticForUrl(url, route.request().method(), 200, 'naver-offline'));
}

export const test = base.extend({
    page: async ({ page }, fixtureUse, testInfo) => {
        const diagnostics: NightlyRouteDiagnostic[] = [];
        let applicationConsoleErrorCount = 0;
        const usesRealLocalSupabase = isLocalNightlyMode
            && testInfo.file.replaceAll('\\', '/').endsWith('/tests/local-supabase-admin.spec.ts');
        await page.addInitScript({ content: MOCK_NAVER_MAPS_SOURCE });
        page.on('console', (message) => {
            if (message.type() === 'error' && FORBIDDEN_PUBLIC_DATA_CONSOLE_ERRORS.has(message.text())) {
                applicationConsoleErrorCount += 1;
            }
        });
        page.on('requestfailed', (request) => {
            let url: URL;
            try {
                url = new URL(request.url());
            } catch {
                return;
            }
            recordDiagnostic(diagnostics, diagnosticForUrl(url, request.method(), 0, 'request-failed'));
        });
        await page.routeWebSocket('**/*', async (webSocket) => {
            let url: URL;
            try {
                url = new URL(webSocket.url());
            } catch {
                recordDiagnostic(diagnostics, {
                    destination: 'invalid-url',
                    method: 'GET',
                    status: 0,
                    class: 'websocket-denied',
                });
                await webSocket.close();
                return;
            }
            if (!isLoopbackWebSocketUrl(url) && !isAllowedHostedSupabaseWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, 'GET', 0, 'websocket-denied'));
                await webSocket.close();
                return;
            }
            if (isAllowedHostedSupabaseWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, 'GET', 200, 'hosted-supabase-allowed'));
                await webSocket.connectToServer();
                return;
            }
            if (isNextDevWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, 'GET', 200, 'local-dev-websocket'));
                await webSocket.connectToServer();
                return;
            }
            if (!isAllowedSupabaseWebSocketUrl(url)) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, 'GET', 0, 'websocket-path-denied'));
                await webSocket.close();
                return;
            }
            await webSocket.connectToServer();
        });
        await page.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const method = request.method().toUpperCase();

            if (
                isMutationMethod(method)
                && !(
                    usesRealLocalSupabase
                    && (
                        isAllowedLocalSupabaseMutation(
                            url,
                            method,
                            request.postDataBuffer(),
                            request.headers(),
                        )
                        || isAllowedLocalAdminMutation(url, method)
                    )
                )
            ) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, method, 0, 'mutation-denied'));
                await route.abort('blockedbyclient');
                return;
            }
            if (isNaverSdkUrl(url)) {
                await fulfillNaverSdk(route, diagnostics);
                return;
            }
            if (isAllowedHostedSupabaseUrl(url)) {
                if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
                    recordDiagnostic(diagnostics, diagnosticForUrl(url, method, 0, 'hosted-supabase-method-denied'));
                    await route.abort('blockedbyclient');
                    return;
                }
                await route.continue();
                return;
            }
            if (!isLoopbackUrl(url)) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, method, 0, classifyDeniedDestination(url)));
                await route.abort('blockedbyclient');
                return;
            }
            if (isSupabaseUrl(url)) {
                if (usesRealLocalSupabase && isAllowedLocalSupabaseUrl(url)) {
                    recordDiagnostic(diagnostics, diagnosticForUrl(url, method, 0, 'local-supabase-allowed'));
                    await route.continue();
                    return;
                }
                await fulfillSupabase(route, diagnostics);
                return;
            }
            const isAllowedAdminMutation = usesRealLocalSupabase
                && isAllowedLocalAdminMutation(url, method);
            const isAllowedAdminRead = usesRealLocalSupabase
                && isAllowedLocalAdminRead(url, method);
            if (!isAllowedApplicationUrl(url) && !isAllowedAdminMutation && !isAllowedAdminRead) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, method, 0, 'application-path-denied'));
                await route.abort('blockedbyclient');
                return;
            }
            if (method !== 'GET' && method !== 'HEAD' && !isAllowedAdminMutation) {
                recordDiagnostic(diagnostics, diagnosticForUrl(url, method, 0, 'application-method-denied'));
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
            expect(
                applicationConsoleErrorCount,
                'Nightly browser emitted a bounded Supabase announcement console error.',
            ).toBe(0);
        }
    },
});

export { expect };
export type { Page, Route, TestInfo };
