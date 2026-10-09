import { getTrustedAuthCallbackOrigin } from '@/lib/auth/callback-origin';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const INVALID_PREVIEW_ORIGIN = 'https://invalid-preview-origin.invalid';
const INTERNAL_CAPABILITY_ROUTES = new Map([
  ['/api/internal/account-deletion', 'x-account-deletion-worker-capability'],
  ['/api/internal/privacy-retention', 'x-privacy-retention-capability'],
]);

function parseCanonicalOrigin(value: string, production: boolean) {
  try {
    const url = new URL(value);
    const localHttp = !production && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
    if (
      url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
      || (url.protocol !== 'https:' && !localHttp)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function getVercelPreviewOrigin(env: NodeJS.ProcessEnv) {
  if (env.VERCEL_ENV !== 'preview' || !env.VERCEL_URL?.trim()) return null;

  // Reuse the callback origin's Vercel host validation while replacing its
  // intentional production fallback with a sentinel that CSRF can fail closed on.
  const previewOrigin = getTrustedAuthCallbackOrigin('', {
    NODE_ENV: env.NODE_ENV,
    NEXT_PUBLIC_SITE_URL: INVALID_PREVIEW_ORIGIN,
    VERCEL_ENV: env.VERCEL_ENV,
    VERCEL_URL: env.VERCEL_URL,
  });
  if (previewOrigin === INVALID_PREVIEW_ORIGIN) return null;

  return parseCanonicalOrigin(previewOrigin, true);
}

function expectedOrigin(request: Request, env: NodeJS.ProcessEnv) {
  const production = env.NODE_ENV === 'production';
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env.VERCEL_ENV === 'preview') {
    return getVercelPreviewOrigin(env);
  }
  if (!production) {
    const requestOrigin = parseCanonicalOrigin(new URL(request.url).origin, false);
    const requestHost = requestOrigin ? new URL(requestOrigin).hostname : '';
    if (requestOrigin && LOOPBACK_HOSTS.has(requestHost)) {
      // NextURL normalizes loopback IPs to localhost. Recover only the explicit
      // local origin whose host matches the actual request; forwarded headers
      // and production origins never acquire an alias exception.
      const localConfigured = configured ? parseCanonicalOrigin(configured, false) : null;
      if (localConfigured) {
        const target = new URL(localConfigured);
        const normalized = new URL(requestOrigin);
        if (
          LOOPBACK_HOSTS.has(target.hostname)
          && target.protocol === normalized.protocol
          && target.port === normalized.port
          && request.headers.get('host')?.trim() === target.host
        ) return localConfigured;
      }
      return requestOrigin;
    }
  }
  if (configured) return parseCanonicalOrigin(configured, production);
  if (production) return null;
  return parseCanonicalOrigin(new URL(request.url).origin, false);
}

export function isTrustedSameOriginMutation(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return true;

  const cookie = request.headers.get('cookie')?.trim();
  const authorization = request.headers.get('authorization')?.trim();
  // Bearer credentials only bypass this CSRF-origin check; routes still authenticate them.
  if (!cookie && /^Bearer\s+\S+$/i.test(authorization ?? '')) {
    return true;
  }
  const internalCapabilityHeader = INTERNAL_CAPABILITY_ROUTES.get(new URL(request.url).pathname);
  const internalCapabilityFetchMode = request.headers.get('sec-fetch-mode');
  if (
    internalCapabilityHeader
    && !cookie
    && !authorization
    && !request.headers.get('origin')
    && !request.headers.get('referer')
    && !request.headers.get('sec-fetch-site')
    && (internalCapabilityFetchMode === null || internalCapabilityFetchMode === 'cors')
    && !request.headers.get('sec-fetch-dest')
    && (request.headers.get(internalCapabilityHeader)?.trim().length ?? 0) >= 32
  ) {
    return true;
  }

  const canonicalOrigin = expectedOrigin(request, env);
  const requestOrigin = request.headers.get('origin')?.trim();
  if (!canonicalOrigin || !requestOrigin || requestOrigin.includes(',') || requestOrigin !== canonicalOrigin) {
    return false;
  }

  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  return !fetchSite || fetchSite === 'same-origin';
}
