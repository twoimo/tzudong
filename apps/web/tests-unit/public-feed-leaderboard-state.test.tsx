import { expect, test } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedReadCount } from '../components/feed/FeedReadCount';
import { readLeaderboardUsers } from '../hooks/leaderboard-read-result';
import type { PublicProfileLeaderboardRow } from '../lib/public-profile-read';

for (const [hasData, error, count, expected] of [
  [false, false, 0, '불러오는 중'],
  [false, true, 0, '확인 필요'],
  [true, false, 0, '0개'],
  [true, true, 3, '3개'],
] as const) {
  test(`feed count distinguishes available=${hasData}, error=${error}, count=${count}`, () => {
    const html = renderToStaticMarkup(<FeedReadCount hasData={hasData} error={error} count={count} />);
    expect(html).toContain(expected);
    if (!hasData) expect(html).not.toContain('0개');
  });
}

const row: PublicProfileLeaderboardRow = {
  user_id: '11111111-1111-4111-8111-111111111111', nickname: '테스트 사용자', review_count: 5,
  verified_review_count: 4, total_likes: 3, avg_likes_per_review: 0.6, quality_score: 5.3,
};

test('successful empty leaderboard remains a successful empty result', async () => {
  await expect(readLeaderboardUsers(async () => [])).resolves.toEqual([]);
});

test('leaderboard mapping preserves rank and metrics without changing the successful response', async () => {
  await expect(readLeaderboardUsers(async () => [row])).resolves.toEqual([{
    id: row.user_id, username: row.nickname, rank: 1, reviewCount: 5,
    verifiedReviewCount: 4, totalLikes: 3, avgLikesPerReview: 0.6, qualityScore: 5.3,
  }]);
});

test('initial leaderboard failure is an error with no fabricated data and bounded diagnostics', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ['leaderboard-users', 'all'];
  try {
    await expect(client.fetchQuery({ queryKey, queryFn: () => readLeaderboardUsers(async () => { throw new Error('synthetic provider detail'); }) })).rejects.toThrow('leaderboard-unavailable');
    expect(client.getQueryState(queryKey)?.status).toBe('error');
    expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(String(client.getQueryState(queryKey)?.error)).not.toContain('synthetic provider detail');
  } finally { client.clear(); }
});

test('failed leaderboard refresh preserves the last successful rows', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ['leaderboard-users', 'monthly'];
  try {
    const prior = await client.fetchQuery({ queryKey, queryFn: () => readLeaderboardUsers(async () => [row]) });
    await expect(client.fetchQuery({ queryKey, queryFn: () => readLeaderboardUsers(async () => { throw new Error('unavailable'); }) })).rejects.toThrow('leaderboard-unavailable');
    expect(client.getQueryState(queryKey)?.status).toBe('error');
    expect(client.getQueryData(queryKey)).toEqual(prior);
  } finally { client.clear(); }
});


test('actual leaderboard hook never carries all-period rows into monthly results', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const allKey = ['leaderboard-users', 'all'];
  const monthlyKey = ['leaderboard-users', 'monthly'];
  const prior = await readLeaderboardUsers(async () => [row]);
  client.setQueryData(allKey, prior);
  function Probe() { useLeaderboard('all'); return null; }
  renderToStaticMarkup(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  const hookOptions = { ...client.getQueryCache().find({ queryKey: allKey })!.options };
  // Recompute identity for each key instead of copying the cache entry hash.
  delete hookOptions.queryHash;
  // Effects do not run in static rendering. Disable fetching here to inspect the
  // real hook's observer transition without any RPC or realtime subscription.
  const observer = new QueryObserver(client, { ...hookOptions, queryKey: allKey, enabled: false });
  try {
    expect(observer.getCurrentResult().data).toEqual(prior);
    observer.setOptions({ ...hookOptions, queryKey: monthlyKey, enabled: false });
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    expect(observer.getCurrentResult().isPending).toBe(true);
    observer.setOptions({ ...hookOptions, queryKey: allKey, enabled: false });
    expect(observer.getCurrentResult().data).toEqual(prior);
  } finally { observer.destroy(); client.clear(); }
});
