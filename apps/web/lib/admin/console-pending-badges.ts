import {
  ADMIN_CONSOLE_MENU_IDS,
  getAdminConsoleMenuPendingDomains,
  type AdminConsoleMenuId,
} from "@/lib/admin/console-menu-registry";
import type { AdminPendingCountsResponse } from "@/lib/admin/pending-counts";

export const ADMIN_PENDING_BADGE_STALE_AFTER_MS = 180 * 1000;

export type PendingBadgeState =
  | { kind: "hidden" }
  | {
      kind: "shown";
      count: number;
      displayText: string;
      accessibleText: string;
      partialAggregate: boolean;
      staleAggregate: boolean;
      dotOnly: boolean;
    };

export type ResolveAdminPendingBadgeInput = {
  menuId: AdminConsoleMenuId;
  payload: AdminPendingCountsResponse | null;
  collapsed: boolean;
  nowMs?: number;
};

function formatUnabbreviatedCount(count: number): string {
  return String(count);
}

export function resolveAdminPendingBadgeState({
  menuId,
  payload,
  collapsed,
  nowMs = Date.now(),
}: ResolveAdminPendingBadgeInput): PendingBadgeState {
  const pendingDomains = getAdminConsoleMenuPendingDomains(menuId);
  if (payload == null || pendingDomains.length === 0) {
    return { kind: "hidden" };
  }

  const count = pendingDomains.reduce((sum, domainId) => {
    const domainCount = payload.domains[domainId]?.count;
    return (
      sum +
      (typeof domainCount === "number" && Number.isFinite(domainCount)
        ? Math.max(0, Math.trunc(domainCount))
        : 0)
    );
  }, 0);
  const unabbreviatedCount = formatUnabbreviatedCount(count);
  const asOfMs = Date.parse(payload.asOf);

  return {
    kind: "shown",
    count,
    displayText: count >= 100 ? "99+" : unabbreviatedCount,
    accessibleText: `대기 ${unabbreviatedCount}건`,
    partialAggregate: payload.readiness.status === "degraded",
    staleAggregate:
      Number.isFinite(asOfMs) &&
      nowMs - asOfMs >= ADMIN_PENDING_BADGE_STALE_AFTER_MS,
    dotOnly: collapsed && count >= 1,
  };
}

export function resolveAdminPendingBadgeStates(input: {
  payload: AdminPendingCountsResponse | null;
  collapsed: boolean;
  nowMs?: number;
}): Record<AdminConsoleMenuId, PendingBadgeState> {
  return Object.fromEntries(
    ADMIN_CONSOLE_MENU_IDS.map((menuId) => [
      menuId,
      resolveAdminPendingBadgeState({
        menuId,
        payload: input.payload,
        collapsed: input.collapsed,
        nowMs: input.nowMs,
      }),
    ]),
  ) as Record<AdminConsoleMenuId, PendingBadgeState>;
}
