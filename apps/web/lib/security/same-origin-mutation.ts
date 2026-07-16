const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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

function expectedOrigin(request: Request, env: NodeJS.ProcessEnv) {
  const production = env.NODE_ENV === 'production';
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
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

  const canonicalOrigin = expectedOrigin(request, env);
  const requestOrigin = request.headers.get('origin')?.trim();
  if (!canonicalOrigin || !requestOrigin || requestOrigin.includes(',') || requestOrigin !== canonicalOrigin) {
    return false;
  }

  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  return !fetchSite || fetchSite === 'same-origin';
}
