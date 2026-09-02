import type { AdminPendingCountDomainId } from "@/lib/admin/pending-counts";

export const ADMIN_MENU_OUTPUT_KINDS = ["조회", "변경", "모델생성"] as const;
export type AdminMenuOutputKind = (typeof ADMIN_MENU_OUTPUT_KINDS)[number];

export const ADMIN_CONSOLE_SECTION_LABELS = [
  "판단",
  "검수",
  "운영",
  "콘텐츠 제작",
] as const;
export type AdminConsoleSectionLabel =
  (typeof ADMIN_CONSOLE_SECTION_LABELS)[number];

export const RETIRED_ADMIN_SECTION_LABELS = ["홈", "실험실"] as const;
export type RetiredAdminSectionLabel =
  (typeof RETIRED_ADMIN_SECTION_LABELS)[number];

export const ADMIN_CONSOLE_MENU_IDS = [
  "overview",
  "insights",
  "llm",
  "restaurants",
  "restaurant-refresh-history",
  "submissions",
  "reviews",
  "map-overlays",
  "banners",
  "routes",
  "users",
  "pipeline",
  "audit",
  "storyboard",
  "youtube-thumbnail-generator",
] as const;
export type AdminConsoleMenuId = (typeof ADMIN_CONSOLE_MENU_IDS)[number];

export type AdminConsoleMenuDefinition = {
  readonly id: AdminConsoleMenuId;
  readonly title: string;
  readonly purpose: string;
  readonly operationalDuty: string;
  readonly primarySources: readonly [string, ...string[]];
  readonly primaryActionLabel: string;
  readonly outputKind: AdminMenuOutputKind;
  readonly section: AdminConsoleSectionLabel;
  readonly pendingDomains?: readonly [
    AdminPendingCountDomainId,
    ...AdminPendingCountDomainId[],
  ];
};

export type AdminConsoleSectionDefinition = {
  readonly label: AdminConsoleSectionLabel;
  readonly purpose: string;
};

export const ADMIN_CONSOLE_SECTIONS = {
  판단: {
    label: "판단",
    purpose: "무엇을 먼저 처리할지 결정하는 읽기 전용 화면",
  },
  검수: {
    label: "검수",
    purpose: "맛집·제보·리뷰 데이터의 정확성을 판정한다",
  },
  운영: {
    label: "운영",
    purpose: "공개 노출, 권한, 수집 실행, 감사 기록을 통제한다",
  },
  "콘텐츠 제작": {
    label: "콘텐츠 제작",
    purpose: "채널 업로드용 산출물 초안을 만든다",
  },
} as const satisfies Record<
  AdminConsoleSectionLabel,
  AdminConsoleSectionDefinition
>;

export const ADMIN_CONSOLE_MENUS = {
  overview: {
    id: "overview",
    title: "대시보드 (KPI)",
    purpose: "채널 성과와 미처리 업무량을 한 화면에서 파악한다",
    operationalDuty: "오늘 우선 처리할 업무 판단",
    primarySources: ["/api/admin/pending-counts", "/api/admin/youtube-kpis"],
    primaryActionLabel: "오늘 업무 확인",
    outputKind: "조회",
    section: "판단",
  },
  insights: {
    id: "insights",
    title: "핵심 인사이트",
    purpose: "콘텐츠 성과 변화를 해석한다",
    operationalDuty: "조회수·좋아요·댓글·영상 길이 추이 확인",
    primarySources: [
      "/api/admin/youtube-kpis",
      "/api/admin/youtube-kpi-collection-logs",
    ],
    primaryActionLabel: "기간 전환 제어",
    outputKind: "조회",
    section: "판단",
  },
  llm: {
    id: "llm",
    title: "운영 보조",
    purpose:
      "위험 작업 전 현재 대기·실패·위험 후보를 읽기 전용으로 요약한다",
    operationalDuty: "다음 검수 후보 확인, 위험 작업 점검표 확인",
    primarySources: [
      "/api/admin/pending-counts",
      "/api/admin/system-status",
      "/api/admin/audit-events",
    ],
    primaryActionLabel: "다음 검수 후보 열기",
    outputKind: "모델생성",
    section: "판단",
  },
  restaurants: {
    id: "restaurants",
    title: "맛집 관리",
    purpose: "승인된 맛집 데이터의 정확성을 유지한다",
    operationalDuty: "맛집 수정, 삭제·복구, 좌표 오류 후보 처리",
    primarySources: ["/api/admin/evaluations", "/api/admin/restaurants"],
    primaryActionLabel: "맛집 데이터 검수",
    outputKind: "변경",
    section: "검수",
  },
  "restaurant-refresh-history": {
    id: "restaurant-refresh-history",
    title: "맛집 최신화",
    purpose: "상호명·전화번호·폐업 상태 변경을 추적한다",
    operationalDuty: "최신화 후보 확인과 변경 이력 조회",
    primarySources: ["/api/admin/restaurant-refresh-history"],
    primaryActionLabel: "최신화 이력 보기",
    outputKind: "변경",
    section: "검수",
  },
  submissions: {
    id: "submissions",
    title: "제보 관리",
    purpose: "사용자 신규·수정 제보를 판정한다",
    operationalDuty: "제보 승인, 반려, 반영",
    primarySources: ["/api/admin/restaurant-requests"],
    primaryActionLabel: "제보 검토",
    outputKind: "변경",
    section: "검수",
    pendingDomains: [
      "restaurant_submissions",
      "restaurant_recommendation_requests",
    ],
  },
  reviews: {
    id: "reviews",
    title: "리뷰 관리",
    purpose: "미승인 리뷰와 증빙을 판정한다",
    operationalDuty: "리뷰 승인, 중복·삭제 후보 처리",
    primarySources: ["/api/admin/ocr-receipts", "리뷰 조회"],
    primaryActionLabel: "리뷰 검수",
    outputKind: "변경",
    section: "검수",
    pendingDomains: ["reviews"],
  },
  "map-overlays": {
    id: "map-overlays",
    title: "지도 오버레이",
    purpose: "공개 지도에 노출되는 오버레이를 통제한다",
    operationalDuty: "수동 오버레이 편집, 트렌드 제안 판정, 실행 상태 확인",
    primarySources: [
      "/api/admin/map-overlays",
      "/api/admin/trend-proposals",
      "/api/admin/trend-job-requests",
    ],
    primaryActionLabel: "지도 오버레이 관리",
    outputKind: "변경",
    section: "운영",
  },
  banners: {
    id: "banners",
    title: "배너 관리",
    purpose: "공개 배너 노출을 통제한다",
    operationalDuty: "노출 위치·우선순위·미디어 상태 변경",
    primarySources: ["배너 관리 조회·변경"],
    primaryActionLabel: "배너 노출 관리",
    outputKind: "변경",
    section: "운영",
  },
  routes: {
    id: "routes",
    title: "맛집 동선 추천",
    purpose: "공개 지도에 제공하는 맛집 동선을 통제한다",
    operationalDuty: "후보 선택, 동선 확인, 동선 반영",
    primarySources: ["/api/admin/routes", "저장된 맛집 좌표"],
    primaryActionLabel: "동선 확인",
    outputKind: "변경",
    section: "운영",
  },
  users: {
    id: "users",
    title: "사용자 관리",
    purpose: "계정과 관리자 권한을 통제한다",
    operationalDuty: "계정 생성·수정, 권한 부여·회수, 비활성화",
    primarySources: ["/api/admin/users", "/api/admin/profile-summaries"],
    primaryActionLabel: "사용자 계정 관리",
    outputKind: "변경",
    section: "운영",
  },
  pipeline: {
    id: "pipeline",
    title: "크롤러 파이프라인",
    purpose: "수집 파이프라인의 실행 상태를 관측하고 대상별 실행을 요청한다",
    operationalDuty: "실행 요청, 실패 확인, 재실행 판단",
    primarySources: ["/api/admin/pipeline"],
    primaryActionLabel: "실행 요청",
    outputKind: "변경",
    section: "운영",
  },
  audit: {
    id: "audit",
    title: "감사 로그",
    purpose: "관리자 작업의 부분 감사 기록을 조회한다",
    operationalDuty: "사용자 관리 감사 추적, 개인정보 사고 대응 진입",
    primarySources: ["/api/admin/audit-events"],
    primaryActionLabel: "감사 범위 보기",
    outputKind: "조회",
    section: "운영",
  },
  storyboard: {
    id: "storyboard",
    title: "스토리보드 생성",
    purpose: "다음 영상 소재와 씬별 촬영안 초안을 만든다",
    operationalDuty: "히트맵 기반 소재 도출, 씬 초안 생성·검토",
    primarySources: ["/api/admin/storyboard"],
    primaryActionLabel: "스토리보드 만들기",
    outputKind: "모델생성",
    section: "콘텐츠 제작",
  },
  "youtube-thumbnail-generator": {
    id: "youtube-thumbnail-generator",
    title: "유튜브 썸네일 생성",
    purpose: "업로드용 16:9 썸네일 초안을 만든다",
    operationalDuty: "주제·참고 이미지 입력, 초안 생성, 텍스트 편집",
    primarySources: [
      "/api/admin/youtube-thumbnail-generator",
      "/api/admin/image-generation-readiness",
    ],
    primaryActionLabel: "썸네일 생성",
    outputKind: "모델생성",
    section: "콘텐츠 제작",
  },
} as const satisfies Record<AdminConsoleMenuId, AdminConsoleMenuDefinition>;

export const ADMIN_CONSOLE_MENU_LIST: readonly AdminConsoleMenuDefinition[] =
  ADMIN_CONSOLE_MENU_IDS.map((id) => ADMIN_CONSOLE_MENUS[id]);

export const ADMIN_CONSOLE_SECTION_LIST: readonly AdminConsoleSectionDefinition[] =
  ADMIN_CONSOLE_SECTION_LABELS.map((label) => ADMIN_CONSOLE_SECTIONS[label]);

const ADMIN_CONSOLE_MENU_ID_SET = new Set<string>(ADMIN_CONSOLE_MENU_IDS);
const RETIRED_ADMIN_SECTION_LABEL_SET = new Set<string>(
  RETIRED_ADMIN_SECTION_LABELS,
);

export function isAdminConsoleMenuId(
  value: unknown,
): value is AdminConsoleMenuId {
  return typeof value === "string" && ADMIN_CONSOLE_MENU_ID_SET.has(value);
}

export function isRetiredAdminSectionLabel(
  value: unknown,
): value is RetiredAdminSectionLabel {
  return (
    typeof value === "string" && RETIRED_ADMIN_SECTION_LABEL_SET.has(value)
  );
}

export function getAdminConsoleMenu(
  id: AdminConsoleMenuId,
): AdminConsoleMenuDefinition {
  return ADMIN_CONSOLE_MENUS[id];
}

export function findAdminConsoleMenu(
  id: string,
): AdminConsoleMenuDefinition | null {
  if (!isAdminConsoleMenuId(id)) {
    return null;
  }
  return ADMIN_CONSOLE_MENUS[id];
}

export function getAdminConsoleSection(
  label: AdminConsoleSectionLabel,
): AdminConsoleSectionDefinition {
  return ADMIN_CONSOLE_SECTIONS[label];
}

export function getAdminConsoleMenuIdsBySection(
  label: AdminConsoleSectionLabel,
): readonly AdminConsoleMenuId[] {
  return ADMIN_CONSOLE_MENU_IDS.filter(
    (id) => ADMIN_CONSOLE_MENUS[id].section === label,
  );
}

export function getAdminConsoleMenuPendingDomains(
  id: AdminConsoleMenuId,
): readonly AdminPendingCountDomainId[] {
  return ADMIN_CONSOLE_MENUS[id].pendingDomains ?? [];
}
