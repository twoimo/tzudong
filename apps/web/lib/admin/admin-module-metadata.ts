import {
  getAdminModuleIdFromSearchParams,
  type AdminConsoleRouteModuleId,
} from "@/lib/admin/admin-module-routing";
import { buildNoIndexMetadata, buildScopedBrowserTitle } from "@/lib/seo";

export const ADMIN_MODULE_TITLES = {
  overview: "대시보드 (KPI)",
  routes: "맛집 동선 추천",
  restaurants: "맛집 관리",
  "restaurant-refresh-history": "맛집 관리",
  submissions: "제보 관리",
  reviews: "리뷰 관리",
  storyboard: "스토리보드 생성",
  banners: "배너 관리",
  users: "사용자 관리",
  insights: "영상 성과 분석",
  audit: "감사 로그",
  "youtube-thumbnail-generator": "유튜브 썸네일 생성",
  llm: "운영 보조",
  pipeline: "크롤러 파이프라인",
  sentry: "오류 모니터링",
  "knowledge-graph": "지식 그래프",
} as const satisfies Record<AdminConsoleRouteModuleId, string>;

export function getAdminModuleTitle(moduleId: AdminConsoleRouteModuleId): string {
  return ADMIN_MODULE_TITLES[moduleId];
}

export function getAdminPageMetadata(
  query: Record<string, string | string[] | undefined>,
) {
  const moduleId = getAdminModuleIdFromSearchParams({
    get(key) {
      const value = query[key];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  });

  return buildNoIndexMetadata({
    title: buildScopedBrowserTitle([getAdminModuleTitle(moduleId), "관리자 콘솔"]),
  });
}
