export type PublicEligibilitySessionRouteClass =
  | 'credentialless-public'
  | 'loop-safe'
  | 'protected';

const isGetOrHead = (method: string) => method === 'GET' || method === 'HEAD';

const isLiteralRoutePath = (pathname: string) => {
  if (
    !pathname.startsWith('/')
    || (pathname !== '/' && pathname.endsWith('/'))
    || pathname.includes('//')
    || pathname.includes('\\')
  ) {
    return false;
  }

  try {
    return decodeURIComponent(pathname) === pathname;
  } catch {
    return false;
  }
};

export function classifyPublicEligibilitySessionRoute({
  pathname,
  method,
}: {
  pathname: string;
  method: string;
}): PublicEligibilitySessionRouteClass {
  if (!isLiteralRoutePath(pathname)) return 'protected';

  if (
    (pathname === '/api/privacy/onboarding' && (method === 'GET' || method === 'POST'))
    || (pathname === '/api/auth/logout' && method === 'POST')
    || (pathname === '/auth/callback' && method === 'GET')
    || (pathname === '/privacy/onboarding' && isGetOrHead(method))
    || (pathname === '/auth/reset-password' && isGetOrHead(method))
    || (pathname === '/auth/required' && isGetOrHead(method))
  ) {
    return 'loop-safe';
  }

  if (
    (
      pathname === '/'
      || pathname === '/home-frame'
      || pathname === '/stamp'
      || pathname === '/privacy'
      || pathname === '/data-deletion'
      || pathname === '/api/health'
      || pathname === '/api/shorten'
    )
    && isGetOrHead(method)
  ) {
    return 'credentialless-public';
  }

  return 'protected';
}

export function shouldSkipPublicEligibilitySession({
  pathname,
  method,
  hasSessionHint,
}: {
  pathname: string;
  method: string;
  hasSessionHint: boolean;
}) {
  const routeClass = classifyPublicEligibilitySessionRoute({ pathname, method });
  return routeClass === 'loop-safe'
    || (!hasSessionHint && routeClass === 'credentialless-public');
}
