import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const SUPABASE_URL = 'https://project-ref.supabase.co';
const SUPABASE_KEY = 'anon-test-key';
const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const originalFetch = globalThis.fetch;

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_KEY;

type CapturedRequest = {
  input: string;
  init?: RequestInit;
};

const requests: CapturedRequest[] = [];
let fetchImplementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async () => (
  new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
);

const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({ input: String(input), init });
  return fetchImplementation(input, init);
});

globalThis.fetch = fetchMock as unknown as typeof fetch;

const {
  fetchSupabaseExactCount,
  fetchSupabaseRows,
  postgrestArrayOverlap,
  postgrestIn,
  supabaseRestRpcClient,
} = await import('../lib/supabase-rest-client.ts?unit-contract-valid');

beforeEach(() => {
  requests.length = 0;
  fetchMock.mockClear();
  fetchImplementation = async () => (
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  );
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
});

describe('Supabase REST client', () => {
  test('escapes PostgREST list operands and preserves empty input', () => {
    expect(postgrestIn(['plain', 'a"b', 'c\\d'])).toBe('in.("plain","a\\"b","c\\\\d")');
    expect(postgrestArrayOverlap(['plain', 'a"b', 'c\\d'])).toBe('ov.{"plain","a\\"b","c\\\\d"}');
    expect(postgrestIn([])).toBe('in.()');
    expect(postgrestArrayOverlap([])).toBe('ov.{}');
  });

  test('fetches rows with encoded query parameters and the public authorization headers', async () => {
    fetchImplementation = async () => new Response(JSON.stringify([{ id: 'r-1' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const rows = await fetchSupabaseRows<{ id: string }>('restaurants', [
      ['select', 'id,name'],
      ['status', 'eq.approved'],
      ['limit', 25],
    ]);

    expect(rows).toEqual([{ id: 'r-1' }]);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0].input);
    expect(url.pathname).toBe('/rest/v1/restaurants');
    expect(url.searchParams.get('select')).toBe('id,name');
    expect(url.searchParams.get('status')).toBe('eq.approved');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(requests[0].init?.method).toBeUndefined();
    expect(requests[0].init?.headers).toEqual({
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    });
  });

  test('fails closed to an empty list for announcement/banner permission denials only', async () => {
    for (const table of ['announcements', 'ad_banners']) {
      for (const status of [401, 403]) {
        fetchImplementation = async () => new Response('denied', { status });
        await expect(fetchSupabaseRows(table, [])).resolves.toEqual([]);
      }
    }

    fetchImplementation = async () => new Response('RLS denied', { status: 403 });
    await expect(fetchSupabaseRows('restaurants', [])).rejects.toThrow(
      'Supabase REST restaurants failed: 403 RLS denied',
    );
  });

  test('passes through successful JSON without runtime row-shape validation', async () => {
    fetchImplementation = async () => new Response(JSON.stringify({ unexpected: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const value = await fetchSupabaseRows<{ id: string }>('restaurants', []);
    expect(value as unknown).toEqual({ unexpected: true });
  });

  test('posts RPC arguments, encodes the function name, and returns bounded status errors', async () => {
    fetchImplementation = async () => new Response(JSON.stringify([{ rank: 1 }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(supabaseRestRpcClient.rpc('rank users/월간', { period: 'monthly' })).resolves.toEqual({
      data: [{ rank: 1 }],
      error: null,
    });
    expect(requests[0].input).toBe(
      `${SUPABASE_URL}/rest/v1/rpc/rank%20users%2F%EC%9B%94%EA%B0%84`,
    );
    expect(requests[0].init?.method).toBe('POST');
    expect(requests[0].init?.body).toBe(JSON.stringify({ period: 'monthly' }));
    expect(requests[0].init?.headers).toEqual({
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    });

    fetchImplementation = async () => new Response('denied', { status: 403 });
    await expect(supabaseRestRpcClient.rpc('private_rpc', {})).resolves.toEqual({
      data: null,
      error: { status: 403 },
    });
  });

  test('treats an unreadable successful RPC body as null data', async () => {
    fetchImplementation = async () => new Response('not-json', { status: 200 });

    await expect(supabaseRestRpcClient.rpc('nullable_rpc', {})).resolves.toEqual({
      data: null,
      error: null,
    });
  });

  test('reads exact HEAD counts and rejects missing or unauthorized count responses', async () => {
    fetchImplementation = async () => new Response(null, {
      status: 200,
      headers: { 'content-range': '0-9/17' },
    });

    await expect(fetchSupabaseExactCount('restaurants', [['status', 'eq.approved']])).resolves.toBe(17);
    expect(requests[0].init?.method).toBe('HEAD');
    expect(requests[0].init?.headers).toEqual({
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
    });

    fetchImplementation = async () => new Response(null, { status: 200 });
    await expect(fetchSupabaseExactCount('restaurants', [])).rejects.toThrow(
      'Supabase REST restaurants count missing content-range.',
    );

    fetchImplementation = async () => new Response('denied', { status: 403 });
    await expect(fetchSupabaseExactCount('restaurants', [])).rejects.toThrow(
      'Supabase REST restaurants count failed: 403 denied',
    );
  });

  test('rejects requests when either public Supabase setting is missing at module initialization', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      const missingConfigClient = await import('../lib/supabase-rest-client.ts?unit-contract-missing');
      await expect(missingConfigClient.fetchSupabaseRows('restaurants', [])).rejects.toThrow(
        'Supabase REST client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      );
      expect(requests).toHaveLength(0);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_KEY;
    }
  });
});
