export const ADMIN_CONSOLE_MODULE_IDS = [
  "overview",
  "routes",
  "map-overlays",
  "restaurants",
  "restaurant-refresh-history",
  "submissions",
  "reviews",
  "storyboard",
  "banners",
  "users",
  "insights",
  "audit",
  "youtube-thumbnail-generator",
  "llm",
  "pipeline",
] as const;

export type AdminConsoleRouteModuleId = (typeof ADMIN_CONSOLE_MODULE_IDS)[number];

export function isAdminConsoleRouteModuleId(
  value: string | null,
): value is AdminConsoleRouteModuleId {
  return Boolean(
    value && ADMIN_CONSOLE_MODULE_IDS.includes(value as AdminConsoleRouteModuleId),
  );
}

export function getLegacyEvaluationModuleId(
  searchParams: Pick<URLSearchParams, 'get'> | null | undefined,
): Extract<AdminConsoleRouteModuleId, 'restaurants' | 'submissions' | 'reviews'> | null {
  const routeView = searchParams?.get('view') ?? null;
  const routeTab = searchParams?.get('tab') ?? null;
  if (routeView === 'submissions') {
    return routeTab === 'reviews' ? 'reviews' : 'submissions';
  }
  return null;
}

type AdminRouteQueryLike = Pick<URLSearchParams, 'get'> | null | undefined;

function resolveAdminModuleId(
  searchParams: AdminRouteQueryLike,
  defaultModule: AdminConsoleRouteModuleId,
): AdminConsoleRouteModuleId {
  const moduleId = searchParams?.get('module') ?? null;
  if (isAdminConsoleRouteModuleId(moduleId)) return moduleId;
  return getLegacyEvaluationModuleId(searchParams) ?? defaultModule;
}
export function getAdminModuleIdFromSearchParams(
  searchParams: AdminRouteQueryLike,
): AdminConsoleRouteModuleId {
  return resolveAdminModuleId(searchParams, 'overview');
}

export function buildCanonicalAdminModuleHref(
  moduleId: AdminConsoleRouteModuleId,
): string {
  const params = new URLSearchParams();
  if (moduleId !== 'overview') {
    params.set('module', moduleId);
  }
  const nextQuery = params.toString();
  return `/admin${nextQuery ? `?${nextQuery}` : ''}`;
}
export function buildCanonicalAdminHrefFromSearchParams(
  searchParams: AdminRouteQueryLike,
  options?: {
    defaultModule?: AdminConsoleRouteModuleId;
    preserveKeys?: string[];
  },
): string {
  const defaultModule = options?.defaultModule ?? 'overview';
  const preserveKeys = options?.preserveKeys ?? ['video_id', 'issue', 'reason'];
  const moduleId = resolveAdminModuleId(searchParams, defaultModule);
  const params = new URLSearchParams();
  if (moduleId !== 'overview') {
    params.set('module', moduleId);
  }
  for (const key of preserveKeys) {
    const value = searchParams?.get(key) ?? null;
    if (value) {
      params.set(key, value);
    }
  }
  const nextQuery = params.toString();
  return `/admin${nextQuery ? `?${nextQuery}` : ''}`;
}

export function buildCanonicalAdminEvaluationsHref(
  searchParams: AdminRouteQueryLike,
): string {
  return buildCanonicalAdminHrefFromSearchParams(searchParams, {
    defaultModule: 'restaurants',
  });
}

export function getAdminModuleStateWarning(
  searchParams: AdminRouteQueryLike,
): string | null {
  const requestedModule = searchParams?.get('module') ?? null;
  const legacyModuleId = getLegacyEvaluationModuleId(searchParams);

  if (requestedModule && !isAdminConsoleRouteModuleId(requestedModule) && legacyModuleId) {
    return '기존 검수 링크를 새 관리자 경로로 정리했습니다.';
  }

  if (requestedModule && !isAdminConsoleRouteModuleId(requestedModule)) {
    return '알 수 없는 관리자 화면 요청을 대시보드 (KPI)로 되돌렸습니다.';
  }

  if (legacyModuleId) {
    return '기존 검수 링크를 새 관리자 경로로 정리했습니다.';
  }

  if (searchParams?.get('view') || searchParams?.get('tab')) {
    return '기존 검수 링크를 새 관리자 경로로 정리했습니다.';
  }

  return null;
}
