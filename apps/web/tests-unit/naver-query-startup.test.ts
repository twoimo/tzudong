import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { buildNaverRestaurantsQueryOptions } from '../lib/map-query-helpers';

const options = (sdkReady = false) => buildNaverRestaurantsQueryOptions({
    // Preserve the old caller signal to catch reintroduction of SDK gating.
    ...{ isLoaded: sdkReady },
    compact: true,
    filters: { categories: [], minRating: 0, minReviews: 0, minUserVisits: 0, minJjyangVisits: 0 },
    selectedRegion: '서울',
});

// Controlled transport and real TanStack scheduling; not browser marker or latency evidence.
describe('Naver restaurant startup scheduling', () => {
    test('starts on mount and reuses resolved data across SDK-driven rerenders', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        let requests = 0;
        let resolveRows!: (rows: string[]) => void;
        const response = new Promise<string[]>((resolve) => { resolveRows = resolve; });
        const queryFn = () => { requests++; return response; };
        const queryKey = ['naver-startup-fixture'];
        const observer = new QueryObserver(client, { ...options(), queryKey, queryFn });
        const unsubscribe = observer.subscribe(() => {});
        try {
            // The SDK remains unready while the data query starts.
            expect(requests).toBe(1);
            expect(observer.getCurrentResult().fetchStatus).toBe('fetching');
            observer.setOptions({ ...options(), queryKey, queryFn });
            expect(requests).toBe(1);
            resolveRows(['fixture-restaurant']);
            await client.getQueryCache().find({ queryKey })!.promise;
            expect(observer.getCurrentResult().data).toEqual(['fixture-restaurant']);
            observer.setOptions({ ...options(true), queryKey, queryFn });
            expect(requests).toBe(1);
            expect(observer.getCurrentResult().status).toBe('success');
        } finally { unsubscribe(); client.clear(); }
    });

    test('retains the query error and supports explicit retry without SDK readiness', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        let requests = 0;
        const queryKey = ['naver-startup-error-fixture'];
        const observer = new QueryObserver(client, {
            ...options(), queryKey,
            queryFn: async () => {
                if (++requests === 1) throw new Error('fixture unavailable');
                return ['fixture-restaurant'];
            },
        });
        const unsubscribe = observer.subscribe(() => {});
        try {
            expect(requests).toBe(1);
            await client.getQueryCache().find({ queryKey })!.promise?.catch(() => {});
            expect(observer.getCurrentResult().status).toBe('error');
            await observer.refetch();
            expect(requests).toBe(2);
            expect(observer.getCurrentResult().data).toEqual(['fixture-restaurant']);
        } finally { unsubscribe(); client.clear(); }
    });
});
