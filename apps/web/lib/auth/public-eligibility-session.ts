const LOOP_SAFE_API_PATHS = [
  '/api/health',
  '/api/privacy/onboarding',
] as const;

const LOOP_SAFE_PAGE_PATHS = new Set([
  '/privacy',
  '/data-deletion',
  '/auth/required',
  '/auth/callback',
]);

const PUBLIC_API_PREFIXES = ['/api/shorten'] as const;
const PUBLIC_PAGE_PATHS = new Set(['/', '/home-frame', '/stamp']);

const matchesPathOrChildPath = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export function shouldSkipPublicEligibilitySession({
  pathname,
  method,
  hasSessionHint,
}: {
  pathname: string;
  method: string;
  hasSessionHint: boolean;
}) {
  if (
    LOOP_SAFE_PAGE_PATHS.has(pathname) ||
    LOOP_SAFE_API_PATHS.some((path) => matchesPathOrChildPath(pathname, path))
  ) {
    return true;
  }

  if (hasSessionHint) return false;

  if (PUBLIC_API_PREFIXES.some((path) => matchesPathOrChildPath(pathname, path))) {
    return true;
  }

  return (method === 'GET' || method === 'HEAD') && PUBLIC_PAGE_PATHS.has(pathname);
}
