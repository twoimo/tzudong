export const AUTH_LOGIN_QUERY_PARAM = 'auth';
export const AUTH_LOGIN_QUERY_VALUE = 'login';
export const AUTH_REDIRECT_REASON_PARAM = 'reason';
export const AUTH_PRIVACY_ONBOARDING_REASON = 'privacy_onboarding';
export const AUTH_REDIRECT_NEXT_PARAM = 'next';

export type AuthRedirectReason = 'admin' | 'mypage' | 'review' | typeof AUTH_PRIVACY_ONBOARDING_REASON;

const SAFE_AUTH_NEXT_PATH_PATTERN = /^\/(?:admin(?:\/[A-Za-z0-9_-]+)*|mypage(?:\/[A-Za-z0-9_-]+)*|submissions(?:\/[A-Za-z0-9_-]+)*|user(?:\/[A-Za-z0-9_-]+)*|feed|stamp|)$/;
const SAFE_AUTH_NEXT_QUERY_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*$/;

export function getSafeAuthNextPath(value: string | null | undefined) {
  const next = value?.trim() || '/';
  if (next.length > 180) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return '/';
  }

  const [pathname, query = ''] = next.split('?', 2);
  if (!SAFE_AUTH_NEXT_PATH_PATTERN.test(pathname)) return '/';
  if (query && !SAFE_AUTH_NEXT_QUERY_PATTERN.test(query)) return '/';

  return query ? `${pathname}?${query}` : pathname;
}

export function isAdminAuthNextPath(nextPath: string) {
  return nextPath === '/admin' || nextPath.startsWith('/admin?') || nextPath.startsWith('/admin/');
}

export function isAdminAuthRedirect(reason: string | null | undefined, nextPath: string) {
  return reason === 'admin' && isAdminAuthNextPath(nextPath);
}

export function resolveRequestedAuthRedirect(reason: string | null | undefined, next: string | null | undefined): string | null {
  const safeNext = getSafeAuthNextPath(next);
  if (isAdminAuthRedirect(reason, safeNext)) return safeNext;
  if ((reason === 'mypage' || reason === 'review') && safeNext !== '/' && !isAdminAuthNextPath(safeNext)) return safeNext;
  return null;
}

export function buildStampReviewContinuationPath(restaurantId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantId)) return '/stamp';
  return `/stamp?restaurant=${restaurantId}&writeReview=1`;
}

export function buildHomeAuthLoginPath({
  reason,
  next,
}: {
  reason: AuthRedirectReason;
  next: string;
}) {
  const params = new URLSearchParams({
    [AUTH_LOGIN_QUERY_PARAM]: AUTH_LOGIN_QUERY_VALUE,
    [AUTH_REDIRECT_REASON_PARAM]: reason,
    [AUTH_REDIRECT_NEXT_PARAM]: getSafeAuthNextPath(next),
  });

  return `/?${params.toString()}`;
}

export function buildHomePrivacyOnboardingPath() {
  const params = new URLSearchParams({
    [AUTH_LOGIN_QUERY_PARAM]: AUTH_LOGIN_QUERY_VALUE,
    [AUTH_REDIRECT_REASON_PARAM]: AUTH_PRIVACY_ONBOARDING_REASON,
  });

  return `/?${params.toString()}`;
}

export function isHomePrivacyOnboardingRequest(
  location: { pathname: string; search: string },
) {
  if (location.pathname !== '/') return false;

  const params = new URLSearchParams(location.search);
  return params.size === 2
    && params.get(AUTH_LOGIN_QUERY_PARAM) === AUTH_LOGIN_QUERY_VALUE
    && params.get(AUTH_REDIRECT_REASON_PARAM) === AUTH_PRIVACY_ONBOARDING_REASON;
}

export function readHomeAuthLoginRequestFromLocation(location: Pick<Location, 'search'>) {
  const params = new URLSearchParams(location.search);
  const requested = params.get(AUTH_LOGIN_QUERY_PARAM) === AUTH_LOGIN_QUERY_VALUE;
  const reason = params.get(AUTH_REDIRECT_REASON_PARAM);
  const nextPath = getSafeAuthNextPath(params.get(AUTH_REDIRECT_NEXT_PARAM));

  return {
    requested,
    reason,
    nextPath,
  };
}
