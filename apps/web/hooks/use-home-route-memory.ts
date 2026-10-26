'use client';

import { useCallback, useLayoutEffect, useState, type SetStateAction } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

// Reuse the existing browser QueryClient. Search text/camera coordinates never
// enter history, URLs, browser storage or a network request through this helper.
export function homeRouteMemoryKey(owner: string, part: string) {
  return ['home-route-return', owner, part] as const;
}
export function readHomeRouteMemory<T>(client: QueryClient, owner: string, part: string) {
  return client.getQueryData<T>(homeRouteMemoryKey(owner, part));
}
export function writeHomeRouteMemory<T>(client: QueryClient, owner: string, part: string, value: T) {
  client.setQueryData(homeRouteMemoryKey(owner, part), value);
}
export function useHomeRouteMemory<T>(owner: string | null, part: string, initial: T) {
  const client = useQueryClient();
  const [snapshot, setSnapshot] = useState<{owner: string | null; value: T} | null>(null);
  const value = snapshot?.owner === owner ? snapshot.value
    : owner ? readHomeRouteMemory<T>(client, owner, part) ?? initial : initial;
  const setValue = useCallback((next: SetStateAction<T>) => {
    setSnapshot(previous => {
      const current = previous?.owner === owner ? previous.value
        : owner ? readHomeRouteMemory<T>(client, owner, part) ?? initial : initial;
      const updated = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      return {owner, value: updated};
    });
  }, [client, owner, part, initial]);
  // Commit before route unmount; only the matching owner can read the entry.
  useLayoutEffect(() => {
    if (owner && snapshot?.owner === owner) writeHomeRouteMemory(client, owner, part, snapshot.value);
  }, [client, owner, part, snapshot]);
  return [value, setValue] as const;
}
