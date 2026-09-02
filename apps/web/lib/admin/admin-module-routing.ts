import {
  ADMIN_CONSOLE_MENU_IDS,
  isAdminConsoleMenuId,
  type AdminConsoleMenuId,
} from "@/lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";

export const ADMIN_CONSOLE_MODULE_IDS = ADMIN_CONSOLE_MENU_IDS;
export type AdminConsoleRouteModuleId = AdminConsoleMenuId;

export const ADMIN_CANONICAL_QUERY_KEYS = [
  "module",
  "video_id",
  "issue",
  "reason",
] as const;
export const ADMIN_PRESERVED_QUERY_KEYS = [
  "video_id",
  "issue",
  "reason",
] as const;

type AdminPreservedQueryKey = (typeof ADMIN_PRESERVED_QUERY_KEYS)[number];

export function isAdminConsoleRouteModuleId(
  value: string | null,
): value is AdminConsoleRouteModuleId {
  return isAdminConsoleMenuId(value);
}

export function getLegacyEvaluationModuleId(
  searchParams: Pick<URLSearchParams, "get"> | null | undefined,
): Extract<AdminConsoleRouteModuleId, "restaurants" | "submissions" | "reviews"> | null {
  const routeView = searchParams?.get("view") ?? null;
  const routeTab = searchParams?.get("tab") ?? null;
  if (routeView === "submissions") {
    return routeTab === "reviews" ? "reviews" : "submissions";
  }
  return null;
}

type AdminRouteQueryLike = Pick<URLSearchParams, "get"> | null | undefined;

function resolveAdminModuleId(
  searchParams: AdminRouteQueryLike,
  defaultModule: AdminConsoleRouteModuleId,
): AdminConsoleRouteModuleId {
  const moduleId = searchParams?.get("module") ?? null;
  if (isAdminConsoleRouteModuleId(moduleId)) return moduleId;
  return getLegacyEvaluationModuleId(searchParams) ?? defaultModule;
}

function preservedQueryKeys(
  requestedKeys: string[] | undefined,
): AdminPreservedQueryKey[] {
  const keys = requestedKeys ?? [...ADMIN_PRESERVED_QUERY_KEYS];
  return keys.filter((key): key is AdminPreservedQueryKey =>
    (ADMIN_PRESERVED_QUERY_KEYS as readonly string[]).includes(key),
  );
}

export function getAdminModuleIdFromSearchParams(
  searchParams: AdminRouteQueryLike,
): AdminConsoleRouteModuleId {
  return resolveAdminModuleId(searchParams, "overview");
}

export function buildCanonicalAdminModuleHref(
  moduleId: AdminConsoleRouteModuleId,
): string {
  const params = new URLSearchParams();
  if (moduleId !== "overview") {
    params.set("module", moduleId);
  }
  const nextQuery = params.toString();
  return `/admin${nextQuery ? `?${nextQuery}` : ""}`;
}

export function buildCanonicalAdminHrefFromSearchParams(
  searchParams: AdminRouteQueryLike,
  options?: {
    defaultModule?: AdminConsoleRouteModuleId;
    preserveKeys?: string[];
  },
): string {
  const defaultModule = options?.defaultModule ?? "overview";
  const preserveKeys = preservedQueryKeys(options?.preserveKeys);
  const moduleId = resolveAdminModuleId(searchParams, defaultModule);
  const params = new URLSearchParams();
  if (moduleId !== "overview") {
    params.set("module", moduleId);
  }
  for (const key of preserveKeys) {
    const value = searchParams?.get(key) ?? null;
    if (value) {
      params.set(key, value);
    }
  }
  const nextQuery = params.toString();
  return `/admin${nextQuery ? `?${nextQuery}` : ""}`;
}

export function buildCanonicalAdminEvaluationsHref(
  searchParams: AdminRouteQueryLike,
): string {
  return buildCanonicalAdminHrefFromSearchParams(searchParams, {
    defaultModule: "restaurants",
  });
}

export function getAdminModuleStateWarning(
  searchParams: AdminRouteQueryLike,
): string | null {
  const requestedModule = searchParams?.get("module") ?? null;
  const legacyModuleId = getLegacyEvaluationModuleId(searchParams);

  if (requestedModule && !isAdminConsoleRouteModuleId(requestedModule) && legacyModuleId) {
    return CONSOLE_FIXED_MESSAGES.legacyLinkNormalized;
  }

  if (requestedModule && !isAdminConsoleRouteModuleId(requestedModule)) {
    return CONSOLE_FIXED_MESSAGES.unknownModule;
  }

  if (legacyModuleId) {
    return CONSOLE_FIXED_MESSAGES.legacyLinkNormalized;
  }

  if (searchParams?.get("view") || searchParams?.get("tab")) {
    return CONSOLE_FIXED_MESSAGES.legacyLinkNormalized;
  }

  return null;
}
