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

export const DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER: AdminDashboardWidgetId[] = [
  ...ADMIN_DASHBOARD_WIDGET_IDS,
];

const widgetSet = new Set<string>(ADMIN_DASHBOARD_WIDGET_IDS);

export function isAdminDashboardWidgetId(
  value: unknown,
): value is AdminDashboardWidgetId {
  return typeof value === "string" && widgetSet.has(value);
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
  const preferredOrder = source.filter((item): item is AdminDashboardWidgetId => {
    if (!isAdminDashboardWidgetId(item) || seen.has(item)) {
      return false;
    }

    seen.add(item);
    return true;
  });

  return [
    ...preferredOrder,
    ...DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER.filter((item) => !seen.has(item)),
  ];
}
