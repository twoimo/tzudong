"use client";

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buildAdminStatusCenterViewModel, type AdminStatusCenterPendingCounts } from '@/lib/admin/system-status/view-model';
import {
  ADMIN_PENDING_COUNTS_QUERY_KEY,
  normalizeAdminPendingCountsResponse,
  type AdminPendingCountsResponse,
} from '@/lib/admin/pending-counts';
import type { AdminSystemStatusResponse } from '@/types/admin-system-status';


async function fetchAdminSystemStatus(): Promise<AdminSystemStatusResponse> {
  const response = await fetch('/api/admin/system-status', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('admin-system-status-failed');
  return response.json() as Promise<AdminSystemStatusResponse>;
}

async function fetchAdminPendingCounts(): Promise<AdminPendingCountsResponse> {
  const response = await fetch('/api/admin/pending-counts', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('admin-pending-counts-failed');
  return normalizeAdminPendingCountsResponse(await response.json());
}

export function useAdminStatusCenter(enabled: boolean) {
  const systemStatusQuery = useQuery({
    queryKey: ['admin-status-center', 'system-status'],
    queryFn: fetchAdminSystemStatus,
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const pendingCountsQuery = useQuery({
    queryKey: ADMIN_PENDING_COUNTS_QUERY_KEY,
    queryFn: fetchAdminPendingCounts,
    enabled,
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const systemStatusQueryFailed = systemStatusQuery.isError || systemStatusQuery.isRefetchError;
  const pendingCountsQueryFailed = pendingCountsQuery.isError || pendingCountsQuery.isRefetchError;
  const systemStatus = systemStatusQueryFailed ? undefined : systemStatusQuery.data;

  const viewModel = useMemo(
    () => {
      const pendingCounts: AdminStatusCenterPendingCounts = pendingCountsQueryFailed
        ? {
            submissions: null,
            reviews: null,
          }
        : pendingCountsQuery.data ?? {
            submissions: null,
            reviews: null,
          };

      return buildAdminStatusCenterViewModel(systemStatus, pendingCounts);
    },
    [
      pendingCountsQuery.data,
      pendingCountsQueryFailed,
      systemStatus,
    ],
  );

  return {
    viewModel,
    systemStatusQuery,
    pendingCountsQuery,
    isLoading: systemStatusQuery.isLoading || pendingCountsQuery.isLoading,
    hasError: systemStatusQueryFailed || pendingCountsQueryFailed,
  };
}
