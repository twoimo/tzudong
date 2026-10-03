import { describe, expect, mock, test } from 'bun:test';
mock.module('server-only', () => ({}));
const { getAdminSentryIssues, validSentryCursor } = await import('../lib/monitoring/sentry-admin');

const envFor = (name: string): NodeJS.ProcessEnv => ({ SENTRY_ORG: 'test-org', SENTRY_PROJECT: name, SENTRY_ISSUES_READ_TOKEN: 'test-only-read-token', NODE_ENV: 'test' });
const issueFor = (project: string) => ({ id: '123', shortId: 'TEST-1', project: { slug: project }, status: 'unresolved', level: 'error', count: '12', lastSeen: '2026-10-04T02:00:00Z', metadata: { type: 'TypeError' }, title: 'private@example.test', culprit: 'Bearer private', permalink: 'https://evil.example.test/?token=private', userCount: 42 });

describe('Sentry read-only bounded feed', () => {
  test('missing configuration makes zero provider calls', async () => {
    const fetcher = mock(async () => new Response('[]'));
    expect((await getAdminSentryIssues('unresolved', null, { env: {}, fetcher })).state).toBe('not_configured');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('coalesces 100 identical concurrent reads and relays only safe fields and cursor', async () => {
    const env = envFor('coalesce-test');
    const fetcher = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/0/organizations/test-org/issues/');
      expect(url.searchParams.get('project')).toBe('coalesce-test');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.get('query')).toBe('is:unresolved issue.category:error');
      expect(init?.redirect).toBe('error');
      return Response.json([issueFor('coalesce-test')], { headers: { Link: '<https://sentry.io/>; rel="next"; results="true"; cursor="100:50:0"' } });
    });
    const results = await Promise.all(Array.from({ length: 100 }, () => getAdminSentryIssues('unresolved', null, { env, fetcher })));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.state === 'connected')).toBe(true);
    expect(results[0].nextCursor).toBe('100:50:0');
    expect(results[0].issues[0].href).toBe('https://sentry.io/organizations/test-org/issues/123/');
    expect(JSON.stringify(results)).not.toMatch(/private|evil|test-only-read-token|userCount|culprit/);
  });

  test('expires cache after 30 seconds and separates changed token/status/cursor', async () => {
    let now = 0;
    const env = envFor('ttl-test');
    const fetcher = mock(async () => Response.json([]));
    const read = (status: 'unresolved' | 'resolved', cursor: string | null = null) => getAdminSentryIssues(status, cursor, { env, fetcher, now: () => now });
    await read('unresolved'); now = 29999; await read('unresolved');
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 30000; await read('unresolved'); await read('resolved'); await read('resolved', '100:50:0');
    env.SENTRY_ISSUES_READ_TOKEN = 'test-only-rotated-token'; await read('unresolved');
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  test('caps unrelated simultaneous reads at four in one server process', async () => {
    const releases: Array<() => void> = [];
    const fetcher = mock(() => new Promise<Response>((resolve) => { releases.push(() => resolve(Response.json([]))); }));
    const requests = Array.from({ length: 8 }, (_, i) => getAdminSentryIssues('unresolved', null, { env: envFor(`concurrency-${i}`), fetcher }));
    expect(fetcher).toHaveBeenCalledTimes(4);
    releases.forEach((release) => release());
    const results = await Promise.all(requests);
    expect(results.filter((row) => row.state === 'connected')).toHaveLength(4);
    expect(results.filter((row) => row.state === 'unavailable')).toHaveLength(4);
  });

  test('fails closed for invalid upstream payload, foreign project, oversized body or diagnostics', async () => {
    const payloads = [Array.from({ length: 51 }, () => issueFor('invalid-0')), [issueFor('foreign')], [issueFor('invalid-2'), issueFor('invalid-2')], { token: 'private' }];
    for (const [i, rows] of payloads.entries()) {
      const data = await getAdminSentryIssues('unresolved', null, { env: envFor(`invalid-${i}`), fetcher: async () => Response.json(rows) });
      expect(data.state).toBe('unavailable'); expect(data.issues).toEqual([]);
    }
    const large = await getAdminSentryIssues('unresolved', null, { env: envFor('large-test'), fetcher: async () => new Response('x'.repeat(1048577)) });
    expect(large.state).toBe('unavailable');
    const failure = await getAdminSentryIssues('unresolved', null, { env: envFor('failure-test'), fetcher: async () => { throw new Error('secret provider diagnostics'); } });
    expect(JSON.stringify(failure)).not.toContain('secret');
  });

  test('forbids cursor injection and unapproved API origins', async () => {
    for (const cursor of ['token=secret', 'http://localhost', '1:1:2', '1'.repeat(4097)]) expect(validSentryCursor(cursor)).toBe(false);
    const fetcher = mock(async () => Response.json([]));
    const data = await getAdminSentryIssues('unresolved', null, { env: { ...envFor('origin-test'), SENTRY_URL: 'http://127.0.0.1' }, fetcher });
    expect(data.state).toBe('not_configured'); expect(fetcher).not.toHaveBeenCalled();
  });

  test('shares Retry-After cooldown across status/cursor changes without retrying', async () => {
    let now = 0;
    const env = envFor('cooldown-test');
    const fetcher = mock(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await getAdminSentryIssues('unresolved', null, { env, fetcher, now: () => now });
    now = 31000;
    await getAdminSentryIssues('resolved', '100:50:0', { env, fetcher, now: () => now });
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 120000;
    await getAdminSentryIssues('resolved', '100:50:0', { env, fetcher, now: () => now });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
