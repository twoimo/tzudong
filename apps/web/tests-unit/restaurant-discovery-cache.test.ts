import { expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { invalidateRestaurantDiscoveryQueries } from '../lib/restaurant-discovery-cache';

test('catalog changes invalidate shared totals and every regional category cache', async () => {
  const client = new QueryClient();
  const affected = [
    ['restaurants-count'],
    ['restaurants-categories', '서울', null],
    ['restaurants-categories', null, '일본(삿포로)'],
  ];
  for (const key of [...affected, ['unrelated']]) client.setQueryData(key, [1]);
  await invalidateRestaurantDiscoveryQueries(client);
  for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
  client.clear();
});
