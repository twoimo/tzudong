import { expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { adminQueryLastReadFailed } from '@/lib/admin/query-read-state';

test('a failed read stays failed through a pending retry until a read succeeds', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let outcome: 'fail' | 'hang' | 'ok' = 'fail';
  let release = () => {};
  const observer = new QueryObserver(client, {
    queryKey: ['read-state'],
    queryFn: () => outcome === 'fail' ? Promise.reject(new Error('read-failed'))
      : outcome === 'hang' ? new Promise(resolve => { release = () => resolve('ready'); }) : Promise.resolve('ready'),
  });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  expect(observer.getCurrentResult().isError).toBe(true);
  expect(adminQueryLastReadFailed(observer.getCurrentResult())).toBe(true);

  outcome = 'hang';
  const retry = observer.refetch();
  await new Promise(resolve => setTimeout(resolve, 0));
  const retrying = observer.getCurrentResult();
  expect(retrying.isError).toBe(false);
  expect(retrying.isLoading).toBe(true);
  expect(adminQueryLastReadFailed(retrying)).toBe(true);
  release();
  await retry;
  expect(adminQueryLastReadFailed(observer.getCurrentResult())).toBe(false);

  outcome = 'fail';
  await observer.refetch();
  const staleFailure = observer.getCurrentResult();
  expect(staleFailure.data).toBe('ready');
  expect(adminQueryLastReadFailed(staleFailure)).toBe(true);
  unsubscribe();
  client.clear();
});
