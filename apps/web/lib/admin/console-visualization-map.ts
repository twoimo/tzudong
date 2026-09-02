import type { AdminConsoleMenuId } from "@/lib/admin/console-menu-registry";

export const CONSOLE_VIZ_FORMS = [
  "kpi-sparkline-card",
  "semicircle-gauge-arc",
  "treemap-tile",
  "range-band-area",
  "tone-stacked-bar",
  "waterfall-delta-step",
  "stage-funnel",
  "bullet-bar",
  "activity-heatmap",
  "compact-sparkline-row",
] as const;
export type ConsoleVizForm = (typeof CONSOLE_VIZ_FORMS)[number];

export type ConsoleVizBinding = {
  readonly menuId: AdminConsoleMenuId;
  readonly form: ConsoleVizForm;
  readonly question: string;
  readonly sourceLabel: string;
  readonly minimumPoints: 1 | 2;
};

export const CONSOLE_VIZ_UNBOUND_MENU_IDS = [
  "map-overlays",
  "banners",
  "routes",
  "users",
  "storyboard",
  "youtube-thumbnail-generator",
] as const satisfies readonly AdminConsoleMenuId[];

const CONSOLE_VIZ_FORM_MINIMUM_POINTS = {
  "kpi-sparkline-card": 2,
  "semicircle-gauge-arc": 1,
  "treemap-tile": 1,
  "range-band-area": 2,
  "tone-stacked-bar": 1,
  "waterfall-delta-step": 2,
  "stage-funnel": 1,
  "bullet-bar": 1,
  "activity-heatmap": 2,
  "compact-sparkline-row": 2,
} as const satisfies Record<ConsoleVizForm, 1 | 2>;

export const CONSOLE_VIZ_BINDINGS: readonly ConsoleVizBinding[] = [
  {
    menuId: "overview",
    form: "kpi-sparkline-card",
    question: "최근 구간에서 각 지표가 어느 방향으로 움직였는가",
    sourceLabel: "/api/admin/youtube-kpis",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["kpi-sparkline-card"],
  },
  {
    menuId: "overview",
    form: "semicircle-gauge-arc",
    question: "전체 대기 업무 중 각 도메인이 차지하는 비율은 얼마인가",
    sourceLabel: "대기 건수 도메인과 합계",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["semicircle-gauge-arc"],
  },
  {
    menuId: "insights",
    form: "treemap-tile",
    question: "어떤 영상이 성과를 견인하는가",
    sourceLabel: "/api/admin/youtube-kpis",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["treemap-tile"],
  },
  {
    menuId: "insights",
    form: "range-band-area",
    question: "지표 변동 폭이 어느 구간에 머무르는가",
    sourceLabel: "/api/admin/youtube-kpis",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["range-band-area"],
  },
  {
    menuId: "restaurants",
    form: "tone-stacked-bar",
    question: "상태별 맛집 구성이 어떤 비율로 나뉘는가",
    sourceLabel: "/api/admin/evaluations",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["tone-stacked-bar"],
  },
  {
    menuId: "restaurant-refresh-history",
    form: "waterfall-delta-step",
    question: "어떤 변경 유형이 최신화 건수를 늘렸는가",
    sourceLabel: "/api/admin/restaurant-refresh-history",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["waterfall-delta-step"],
  },
  {
    menuId: "submissions",
    form: "stage-funnel",
    question: "제보가 어느 단계에서 멈추는가",
    sourceLabel: "/api/admin/restaurant-requests",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["stage-funnel"],
  },
  {
    menuId: "reviews",
    form: "bullet-bar",
    question: "리뷰 검수 처리량이 목표 대비 어디에 있는가",
    sourceLabel: "리뷰 조회와 OCR 증빙",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["bullet-bar"],
  },
  {
    menuId: "pipeline",
    form: "activity-heatmap",
    question: "어느 날짜에 실행 실패가 몰렸는가",
    sourceLabel: "/api/admin/pipeline",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["activity-heatmap"],
  },
  {
    menuId: "audit",
    form: "activity-heatmap",
    question: "감사 기록이 어느 날짜와 도메인에 몰렸는가",
    sourceLabel: "/api/admin/audit-events",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["activity-heatmap"],
  },
  {
    menuId: "llm",
    form: "compact-sparkline-row",
    question: "대기 건수와 시스템 상태가 지금 어느 방향인가",
    sourceLabel: "대기 건수와 시스템 상태",
    minimumPoints: CONSOLE_VIZ_FORM_MINIMUM_POINTS["compact-sparkline-row"],
  },
];

export function getConsoleVizBindings(
  menuId: AdminConsoleMenuId,
): readonly ConsoleVizBinding[] {
  return CONSOLE_VIZ_BINDINGS.filter((binding) => binding.menuId === menuId);
}
