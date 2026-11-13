import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { IsRestoringProvider, QueryClient, QueryClientProvider, type QueryFunction } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import RestaurantSearch from '../../components/search/RestaurantSearch';
import { AnonymousHomeAuthProvider } from '../../contexts/AuthContextBase';
import { RESTAURANT_SEARCH_QUERY_KEY_PREFIX } from '../../lib/restaurant-discovery-cache';
import type { Restaurant } from '../../types/restaurant';

const originalFetch = globalThis.fetch;
const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const clients: QueryClient[] = [];
let response: () => Response;
let requests: string[];

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://search-recovery-test.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'unit-fixture-only';
  requests = [];
  response = () => Response.json([]);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://search-recovery-test.invalid') throw new Error('UNEXPECTED_TEST_ORIGIN');
    requests.push(url.pathname);
    return response();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
  clients.splice(0).forEach(client => client.clear());
});

function setup(searchType: 'name' | 'youtube') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, gcTime: Infinity, staleTime: Infinity } } });
  clients.push(client);
  const render = () => renderToStaticMarkup(
    <QueryClientProvider client={client}>
      {/* Render the settled query state without starting an SSR remount refetch. */}
      <IsRestoringProvider value={true}>
        <AnonymousHomeAuthProvider>
          <RestaurantSearch resultView="inline" searchQueryValue="가상식당" searchTypeValue={searchType} onRestaurantSelect={() => {}} />
        </AnonymousHomeAuthProvider>
      </IsRestoringProvider>
    </QueryClientProvider>,
  );
  render();
  const queryKey = [...RESTAURANT_SEARCH_QUERY_KEY_PREFIX, '가상식당', searchType, '', false];
  const query = client.getQueryCache().find({ queryKey, exact: true });
  if (!query || typeof query.options.queryFn !== 'function') throw new Error('ACTUAL_SEARCH_QUERY_MISSING');
  const queryFn = query.options.queryFn as QueryFunction<Restaurant[]>;
  const fetch = () => client.fetchQuery({ queryKey, queryFn, retry: false, staleTime: 0 });
  return { client, queryKey, fetch, render };
}

describe('restaurant search read recovery', () => {
  test.each(['name', 'youtube'] as const)('%s search distinguishes a failed read from an empty result and can retry', async (searchType) => {
    const search = setup(searchType);
    response = () => Response.json({ message: 'PRIVATE_PROVIDER_SENTINEL', code: 'unavailable' }, { status: 400 });
    await expect(search.fetch()).rejects.toThrow('RESTAURANT_SEARCH_UNAVAILABLE');
    expect(search.client.getQueryState(search.queryKey)?.status).toBe('error');
    const failure = search.render();
    expect(failure).toContain('검색 결과를 불러오지 못했습니다.');
    expect(failure).toContain('다시 검색');
    expect(failure).not.toContain('검색 결과가 없습니다.');
    expect(failure).not.toContain('PRIVATE_PROVIDER_SENTINEL');

    response = () => Response.json([]);
    expect(await search.fetch()).toEqual([]);
    expect(search.client.getQueryState(search.queryKey)?.status).toBe('success');
    const empty = search.render();
    expect(empty).toContain('검색 결과가 없습니다.');
    expect(empty).toContain(searchType === 'name' ? '영상 제목으로 찾기' : '맛집 이름으로 찾기');
    expect(empty).toContain('검색어 지우기');
    expect(empty).not.toContain('검색 결과를 불러오지 못했습니다.');
    expect(requests).toHaveLength(2);
    expect(requests.every(path => path === (searchType === 'name' ? '/rest/v1/restaurants' : '/rest/v1/rpc/search_restaurants_by_youtube_title'))).toBe(true);
  }, 15_000);

  test('a network exception stays a failure without leaking provider details', async () => {
    const search = setup('name');
    response = () => { throw new Error('PRIVATE_NETWORK_SENTINEL'); };
    await expect(search.fetch()).rejects.toThrow('RESTAURANT_SEARCH_UNAVAILABLE');
    expect(search.render()).not.toContain('PRIVATE_NETWORK_SENTINEL');
    expect(search.client.getQueryState(search.queryKey)?.data).toBeUndefined();
  }, 15_000);

  test('a failed refresh retains already loaded results with a recovery notice', async () => {
    const search = setup('name');
    search.client.setQueryData(search.queryKey, [{ id: 'synthetic-restaurant', name: '합성 맛집', address: '테스트 주소', categories: [], lat: 37.5, lng: 127 }]);
    response = () => Response.json({ message: 'unavailable' }, { status: 400 });
    await expect(search.fetch()).rejects.toThrow('RESTAURANT_SEARCH_UNAVAILABLE');
    const html = search.render();
    expect(html).toContain('합성 맛집');
    expect(html).toContain('이전 결과를 보여드리고 있습니다.');
    expect(html).toContain('다시 검색');
    expect(html).not.toContain('검색 결과가 없습니다.');
  });
});
