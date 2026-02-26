export const COMMON_NAV_ROUTES = [
    '/',
    '/feed',
    '/stamp',
    '/leaderboard',
    '/insights',
] as const;

export const AUTH_NAV_ROUTES = [
    '/mypage/profile',
    '/mypage/bookmarks',
    '/mypage/reviews',
    '/mypage/submissions/new',
    '/mypage/submissions/edit',
    '/mypage/submissions/recommend',
] as const;

export const ADMIN_NAV_ROUTES = [
    '/admin/evaluations',
    '/admin/submissions',
    '/admin/banners',
    '/admin/costs',
] as const;

export function getNavigationPrefetchRoutes(params: {
    isLoggedIn: boolean;
    isAdmin: boolean;
}): string[] {
    const { isLoggedIn, isAdmin } = params;
    const routes: string[] = [...COMMON_NAV_ROUTES];

    if (isLoggedIn) {
        routes.push(...AUTH_NAV_ROUTES);
    }

    if (isAdmin) {
        routes.push(...ADMIN_NAV_ROUTES);
    }

    return Array.from(new Set(routes));
}
