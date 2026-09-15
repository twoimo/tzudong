import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CategoryFilter from '../components/filters/CategoryFilter';
import { useOverseasCountryCounts } from '../components/home/use-overseas-country-counts';

test('overseas counts expose query failure separately from legitimate zero counts', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  let observed: ReturnType<typeof useOverseasCountryCounts> | undefined;
  function Probe() {
    observed = useOverseasCountryCounts('overseas');
    return null;
  }
  const render = () => {
    renderToStaticMarkup(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
    return observed!;
  };
  try {
    expect(render().isPending).toBe(true);
    await client.fetchQuery({ queryKey: ['restaurants-count'], queryFn: async () => {
      throw new Error('RESTAURANT_COUNTS_UNAVAILABLE');
    } }).catch(() => {});
    expect(render().isError).toBe(true);
    client.setQueryData(['restaurants-count'], []);
    expect(render().isError).toBe(false);
    expect(render().counts['튀르키예(이스탄불)']).toBe(0);
    client.setQueryData(['restaurants-count'], [{ id: 'fixture', english_address: 'Turkey', road_address: 'Esenler/İstanbul' }]);
    expect(render().counts['튀르키예(이스탄불)']).toBe(1);
  } finally {
    client.clear();
  }
});

test('category counts distinguish pending, failed, empty and recovered queries', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  const render = () => renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CategoryFilter selectedCategories={[]} onCategoryChange={() => {}} />
    </QueryClientProvider>,
  );
  try {
    expect(render()).toContain('조회 중');
    await client.fetchQuery({ queryKey: ['restaurants-count'], queryFn: async () => {
      throw new Error('RESTAURANT_COUNTS_UNAVAILABLE');
    } }).catch(() => {});
    expect(render()).toContain('조회 실패');
    expect(render()).not.toContain('(0개)');
    client.setQueryData(['restaurants-count'], []);
    expect(render()).toContain('(0개)');
    client.setQueryData(['restaurants-count'], [{ id: 'fixture', categories: ['한식'] }]);
    expect(render()).toContain('(1개)');
    expect(render()).not.toContain('조회 실패');
  } finally {
    client.clear();
  }
});
