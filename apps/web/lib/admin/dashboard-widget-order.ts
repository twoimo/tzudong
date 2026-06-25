export const ADMIN_DASHBOARD_WIDGET_IDS = [
  "subscribers",
  "views",
  "likes",
  "comments",
  "videos",
  "impact",
  "trend",
  "ops",
  "topContent",
  "engagementRate",
] as const;

export type AdminDashboardWidgetId = (typeof ADMIN_DASHBOARD_WIDGET_IDS)[number];

export const ADMIN_DASHBOARD_DIAGNOSIS_WIDGET_ID = "engagementRate";

export const ADMIN_DASHBOARD_WIDGET_ALIASES = {
  diagnosis: ADMIN_DASHBOARD_DIAGNOSIS_WIDGET_ID,
} as const satisfies Record<string, AdminDashboardWidgetId>;

export const DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER: AdminDashboardWidgetId[] = [
  ...ADMIN_DASHBOARD_WIDGET_IDS,
];

const widgetSet = new Set<string>(ADMIN_DASHBOARD_WIDGET_IDS);
const widgetAliasMap = new Map<string, AdminDashboardWidgetId>(
  Object.entries(ADMIN_DASHBOARD_WIDGET_ALIASES),
);

export function isAdminDashboardWidgetId(
  value: unknown,
): value is AdminDashboardWidgetId {
  return typeof value === "string" && widgetSet.has(value);
}

export function normalizeAdminDashboardWidgetId(
  value: unknown,
): AdminDashboardWidgetId | null {
  if (isAdminDashboardWidgetId(value)) return value;
  if (typeof value !== "string") return null;

  return widgetAliasMap.get(value) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeAdminDashboardWidgetOrder(
  value: unknown,
): AdminDashboardWidgetId[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.order)
      ? value.order
      : [];
  const seen = new Set<string>();
  const preferredOrder: AdminDashboardWidgetId[] = [];

  for (const item of source) {
    const widgetId = normalizeAdminDashboardWidgetId(item);
    if (!widgetId || seen.has(widgetId)) {
      continue;
    }

    seen.add(widgetId);
    preferredOrder.push(widgetId);
  }

  return [
    ...preferredOrder,
    ...DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER.filter((item) => !seen.has(item)),
  ];
}
