"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AdminConsoleMenuId } from "@/lib/admin/console-menu-registry";
import {
  resolveAdminPendingBadgeState,
  type PendingBadgeState,
} from "@/lib/admin/console-pending-badges";
import {
  ADMIN_PENDING_COUNTS_QUERY_KEY,
  normalizeAdminPendingCountsResponse,
  type AdminPendingCountsResponse,
} from "@/lib/admin/pending-counts";

export const ADMIN_PENDING_BADGE_REFETCH_INTERVAL_MS = 60 * 1000;

export {
  ADMIN_PENDING_BADGE_STALE_AFTER_MS,
  resolveAdminPendingBadgeState,
  resolveAdminPendingBadgeStates,
  type PendingBadgeState,
  type ResolveAdminPendingBadgeInput,
} from "@/lib/admin/console-pending-badges";

async function fetchAdminPendingCounts(): Promise<AdminPendingCountsResponse> {
  const response = await fetch("/api/admin/pending-counts", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("admin-pending-counts-failed");
  }
  return normalizeAdminPendingCountsResponse(await response.json());
}

export function useAdminPendingBadges(enabled: boolean) {
  const pendingCountsQuery = useQuery({
    queryKey: ADMIN_PENDING_COUNTS_QUERY_KEY,
    queryFn: fetchAdminPendingCounts,
    enabled,
    staleTime: 15 * 1000,
    refetchInterval: ADMIN_PENDING_BADGE_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });

  const queryFailed =
    pendingCountsQuery.isError || pendingCountsQuery.isRefetchError;
  const payload = queryFailed ? null : (pendingCountsQuery.data ?? null);

  const getBadge = useCallback(
    (menuId: AdminConsoleMenuId, collapsed: boolean): PendingBadgeState =>
      resolveAdminPendingBadgeState({
        menuId,
        payload,
        collapsed,
      }),
    [payload],
  );

  return {
    getBadge,
    payload,
    queryFailed,
    isLoading: pendingCountsQuery.isLoading,
  };
}
