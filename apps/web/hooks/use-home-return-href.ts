'use client';

import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildHomeReturnHref, type HomeReturnTarget } from '@/lib/home-return-href';
import { readHomeRouteMemory, writeHomeRouteMemory } from './use-home-route-memory';

const RETURN_PART = 'selected-detail-href';
const rootHref = () => '/';

export function useRememberHomeReturnHref(owner: string | null, target: HomeReturnTarget) {
  const client = useQueryClient();
  const href = buildHomeReturnHref(target);
  useLayoutEffect(() => {
    if (owner) writeHomeRouteMemory(client, owner, RETURN_PART, href);
  }, [client, owner, href]);
}

export function useHomeReturnHref(owner: string | null): string {
  const client = useQueryClient();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]);
  const getSnapshot = useCallback(() => owner
    ? readHomeRouteMemory<string>(client, owner, RETURN_PART) ?? '/'
    : '/', [client, owner]);
  return useSyncExternalStore(subscribe, getSnapshot, rootHref);
}
