export const CAPABILITY_PATH = '/api/admin/storyboard/production/assistant';
export const FIXTURE_PATHS = Object.freeze(['/fixture', '/environment.js', '/bundle.js', '/bundle.css', '/images/ui-noise.png', '/favicon.ico', CAPABILITY_PATH]);
export const CAPABILITY = Object.freeze({ ok: true, configured: false, provider: null });

export function isFixtureOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1'
      && /^\d+$/.test(url.port) && Number(url.port) > 0 && Number(url.port) <= 65535
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
      && url.origin === value;
  } catch { return false; }
}

// This is the browser interception policy, not just a navigation boundary.
// No arbitrary same-origin route, query, websocket, write or upstream proxy.
export function isAllowedRequest({ url: value, method, resourceType }, origin) {
  if (!isFixtureOrigin(origin) || !['GET', 'HEAD'].includes(method)) return false;
  if (['websocket', 'eventsource', 'manifest'].includes(resourceType)) return false;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
      && FIXTURE_PATHS.includes(url.pathname)
      && value === `${origin}${url.pathname}`;
  } catch { return false; }
}

export const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'",
  "frame-src 'none'", "worker-src 'none'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

export function safeFailureCode(error, fallback = 'QA_FAILED') {
  return error instanceof Error && /^QA_[A-Z0-9_]+$/.test(error.message) ? error.message : fallback;
}
