/**
 * True while the latest settled read failed. React Query moves a failed query without data back to
 * `pending` while it is refetched, so retry UIs that key off `isError` alone vanish mid-retry.
 */
export function adminQueryLastReadFailed(query: { isError: boolean; isPending: boolean; errorUpdatedAt: number }): boolean {
  return query.isError || (query.isPending && query.errorUpdatedAt > 0);
}
