import {
  ADMIN_CONSOLE_MENU_IDS,
  getAdminConsoleMenu,
  type AdminConsoleMenuId,
} from "@/lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import { buildCanonicalAdminModuleHref } from "@/lib/admin/admin-module-routing";
import { buildHomeAuthLoginPath } from "@/lib/auth/auth-redirect";

export const ADMIN_CONSOLE_MODULE_STATES = [
  "loading",
  "empty",
  "error",
  "unauthorized",
  "ready",
] as const;
export type AdminConsoleModuleState =
  (typeof ADMIN_CONSOLE_MODULE_STATES)[number];

export type AdminConsoleModuleStateInput = {
  readonly isLoading?: boolean;
  readonly hasError?: boolean;
  readonly isUnauthorized?: boolean;
  readonly isEmpty?: boolean;
};

export type AdminConsoleModuleEmptyCopy = {
  readonly message: string;
  readonly nextAction: string;
};

export type AdminConsolePrimaryRequest = {
  readonly target: string;
  readonly query: string;
};

export const ADMIN_CONSOLE_CANVAS_STATS_MENU_IDS = [
  "overview",
  "routes",
] as const satisfies readonly AdminConsoleMenuId[];

export const ADMIN_CONSOLE_MODULE_EMPTY_COPY = {
  overview: {
    message: "표시할 지표가 없습니다.",
    nextAction: "수집 로그를 확인해 주세요.",
  },
  insights: {
    message: "표시할 영상이 없습니다.",
    nextAction: "기간을 바꿔 다시 확인해 주세요.",
  },
  llm: {
    message: "대기 중인 검수 후보가 없습니다.",
    nextAction: "다른 메뉴에서 업무를 확인해 주세요.",
  },
  restaurants: {
    message: "검수할 맛집 데이터가 없습니다.",
    nextAction: "목록이 생기면 여기서 검수해 주세요.",
  },
  "restaurant-refresh-history": {
    message: "최신화 후보가 없습니다.",
    nextAction: "새 후보가 모이면 이력을 확인해 주세요.",
  },
  submissions: {
    message: "검토할 제보가 없습니다.",
    nextAction: "새 제보가 들어오면 여기서 검토해 주세요.",
  },
  reviews: {
    message: "검수할 리뷰가 없습니다.",
    nextAction: "새 리뷰가 들어오면 여기서 검수해 주세요.",
  },
  "map-overlays": {
    message: "표시할 오버레이가 없습니다.",
    nextAction: "오버레이를 추가한 뒤 다시 확인해 주세요.",
  },
  banners: {
    message: "표시할 배너가 없습니다.",
    nextAction: "배너를 추가한 뒤 노출을 관리해 주세요.",
  },
  routes: {
    message: "확인할 동선 후보가 없습니다.",
    nextAction: "후보가 모이면 여기서 동선을 확인해 주세요.",
  },
  users: {
    message: "표시할 계정이 없습니다.",
    nextAction: "계정이 등록되면 여기서 관리해 주세요.",
  },
  pipeline: {
    message: "실행 기록이 없습니다.",
    nextAction: "실행을 요청한 뒤 기록을 확인해 주세요.",
  },
  audit: {
    message: "표시할 감사 이벤트가 없습니다.",
    nextAction: "감사 범위를 다시 확인해 주세요.",
  },
  storyboard: {
    message: "사용할 소재가 없습니다.",
    nextAction: "소재를 준비한 뒤 스토리보드를 만들어 주세요.",
  },
  "youtube-thumbnail-generator": {
    message: "표시할 초안이 없습니다.",
    nextAction: "초안을 생성한 뒤 다시 확인해 주세요.",
  },
} as const satisfies Record<AdminConsoleMenuId, AdminConsoleModuleEmptyCopy>;

export function resolveAdminConsoleModuleState(
  input: AdminConsoleModuleStateInput,
): AdminConsoleModuleState {
  if (input.isUnauthorized) {
    return "unauthorized";
  }
  if (input.hasError) {
    return "error";
  }
  if (input.isLoading) {
    return "loading";
  }
  if (input.isEmpty) {
    return "empty";
  }
  return "ready";
}

export function getAdminConsoleModuleEmptyCopy(
  menuId: AdminConsoleMenuId,
): AdminConsoleModuleEmptyCopy {
  return ADMIN_CONSOLE_MODULE_EMPTY_COPY[menuId];
}

export function getAdminConsoleModuleOutputKind(menuId: AdminConsoleMenuId) {
  return getAdminConsoleMenu(menuId).outputKind;
}

export function buildAdminConsoleReloginHref(menuId: AdminConsoleMenuId) {
  return buildHomeAuthLoginPath({
    reason: "admin",
    next: buildCanonicalAdminModuleHref(menuId),
  });
}

export function createSameQueryRetry(
  lastRequest: AdminConsolePrimaryRequest | null,
  issue: (request: AdminConsolePrimaryRequest) => void,
): (() => void) | null {
  if (!lastRequest) {
    return null;
  }
  const snapshot: AdminConsolePrimaryRequest = {
    target: lastRequest.target,
    query: lastRequest.query,
  };
  return () => {
    issue(snapshot);
  };
}

export function usesAdminConsoleCanvasStats(
  menuId: AdminConsoleMenuId,
): boolean {
  return (ADMIN_CONSOLE_CANVAS_STATS_MENU_IDS as readonly string[]).includes(
    menuId,
  );
}

export function resolveAdminConsolePanelRequest(
  menuId: AdminConsoleMenuId,
  props: AdminConsoleModuleStateInput & {
    readonly applyCanvasStats?: boolean;
  },
): AdminConsoleModuleStateInput {
  const applyCanvasStats =
    props.applyCanvasStats ?? usesAdminConsoleCanvasStats(menuId);
  return {
    isUnauthorized: Boolean(props.isUnauthorized),
    hasError: applyCanvasStats ? Boolean(props.hasError) : false,
    isLoading: applyCanvasStats ? Boolean(props.isLoading) : false,
    isEmpty: applyCanvasStats ? Boolean(props.isEmpty) : Boolean(props.isEmpty),
  };
}

export function isAdminConsoleCanvasStatsEmpty(stats: {
  readonly totalVideos: number | null;
  readonly totalRestaurants: number | null;
  readonly pendingTotal: number | null;
}): boolean {
  return (
    stats.totalVideos === 0 &&
    stats.totalRestaurants === 0 &&
    stats.pendingTotal === 0
  );
}

export function pickHighestPendingAdminConsoleMenu(stats: {
  readonly pendingReviews: number | null;
  readonly pendingRestaurantSubmissions: number | null;
  readonly pendingRecommendationRequests: number | null;
}): AdminConsoleMenuId {
  const reviews = stats.pendingReviews ?? 0;
  const submissions =
    (stats.pendingRestaurantSubmissions ?? 0) +
    (stats.pendingRecommendationRequests ?? 0);
  if (reviews <= 0 && submissions <= 0) {
    return "overview";
  }
  return reviews >= submissions ? "reviews" : "submissions";
}

export function getAdminConsoleCompletenessMenuIds(): readonly AdminConsoleMenuId[] {
  return ADMIN_CONSOLE_MENU_IDS;
}

export const ADMIN_CONSOLE_MODULE_ERROR_MESSAGE =
  CONSOLE_FIXED_MESSAGES.dataFetchFailed;
export const ADMIN_CONSOLE_MODULE_UNAUTHORIZED_MESSAGE =
  CONSOLE_FIXED_MESSAGES.sessionExpired;
export const ADMIN_CONSOLE_MODULE_RETRY_LABEL = "다시 시도";
export const ADMIN_CONSOLE_MODULE_RELOGIN_LABEL = "다시 로그인";
