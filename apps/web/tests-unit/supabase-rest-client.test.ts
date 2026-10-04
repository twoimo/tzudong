import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

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
  supabaseRestFailureCode,
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
    await expect(fetchSupabaseRows('restaurants', [])).rejects.toMatchObject({
      message: 'supabase_rest_rows_failed:403',
    });
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
    await expect(fetchSupabaseExactCount('restaurants', [])).rejects.toMatchObject({
      message: 'supabase_rest_count_missing',
    });

    fetchImplementation = async () => new Response('denied', { status: 403 });
    await expect(fetchSupabaseExactCount('restaurants', [])).rejects.toMatchObject({
      message: 'supabase_rest_count_failed:403',
    });
  });

  test('rejects missing or blank public settings for every operation before fetch', async () => {
    try {
      for (const missing of ['url', 'key'] as const) {
        for (const blank of [undefined, '', '   ']) {
          process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_KEY;
          const name = missing === 'url' ? 'NEXT_PUBLIC_SUPABASE_URL' : 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
          if (blank === undefined) delete process.env[name];
          else process.env[name] = blank;

          for (const request of [
            () => fetchSupabaseRows('restaurants', []),
            () => fetchSupabaseExactCount('restaurants', []),
            () => supabaseRestRpcClient.rpc('bounded_rpc', {}),
          ]) {
            await expect(request()).rejects.toMatchObject({ message: 'supabase_rest_config_missing' });
          }
        }
      }
      expect(requests).toHaveLength(0);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_KEY;
    }
  });

  test('bounds failure codes to the operation and a valid integer HTTP status', () => {
    for (const kind of ['rows', 'count', 'rpc'] as const) {
      for (const status of [100, 200, 403, 500, 599]) {
        expect(supabaseRestFailureCode(kind, status)).toBe(`supabase_rest_${kind}_failed:${status}`);
      }
      for (const status of [-1, 0, 99, 600, 200.5, Number.NaN, Infinity, -Infinity]) {
        expect(supabaseRestFailureCode(kind, status)).toBe(`supabase_rest_${kind}_failed:0`);
      }
    }
  });

  test('bounds transport rejections for rows, counts and RPC without changing rejection semantics', async () => {
    const failure = new Error('untrusted-error');
    failure.name = 'untrusted-name';
    for (const rejected of [failure, 'untrusted-value', undefined]) {
      fetchImplementation = async () => { throw rejected; };
      for (const table of ['restaurants', 'announcements', 'ad_banners']) {
        await expect(fetchSupabaseRows(table, [])).rejects.toMatchObject({
          name: 'Error', message: 'supabase_rest_rows_failed:0',
        });
      }
      await expect(fetchSupabaseExactCount('restaurants', [])).rejects.toMatchObject({
        name: 'Error', message: 'supabase_rest_count_failed:0',
      });
      await expect(supabaseRestRpcClient.rpc('bounded_rpc', {})).rejects.toMatchObject({
        name: 'Error', message: 'supabase_rest_rpc_failed:0',
      });
    }
  });

  test('bounds malformed or unreadable row JSON and preserves the RPC null fallback', async () => {
    fetchImplementation = async () => new Response('not-json', { status: 200 });
    await expect(fetchSupabaseRows('restaurants', [])).rejects.toMatchObject({
      name: 'Error', message: 'supabase_rest_rows_failed:0',
    });
    await expect(supabaseRestRpcClient.rpc('nullable_rpc', {})).resolves.toEqual({
      data: null, error: null,
    });

    const response = new Response('[]', { status: 200 });
    const json = spyOn(response, 'json').mockRejectedValue(new Error('untrusted-error'));
    fetchImplementation = async () => response;
    try {
      await expect(fetchSupabaseRows('restaurants', [])).rejects.toMatchObject({
        name: 'Error', message: 'supabase_rest_rows_failed:0',
      });
      await expect(supabaseRestRpcClient.rpc('nullable_rpc', {})).resolves.toEqual({
        data: null, error: null,
      });
    } finally {
      json.mockRestore();
    }
  });

  test('bounds RPC argument serialization failures before fetch', async () => {
    const args: Record<string, unknown> = {};
    args.self = args;
    await expect(supabaseRestRpcClient.rpc('bounded_rpc', args)).rejects.toMatchObject({
      name: 'Error', message: 'supabase_rest_rpc_failed:0',
    });
    expect(requests).toHaveLength(0);
  });

  test('rejects malformed and non-HTTP config URLs with a fixed code before fetch', async () => {
    try {
      for (const url of ['not-a-url', 'https://', 'ftp://example.test', 'data:text/plain,local']) {
        process.env.NEXT_PUBLIC_SUPABASE_URL = url;
        for (const request of [
          () => fetchSupabaseRows('restaurants', []),
          () => fetchSupabaseExactCount('restaurants', []),
          () => supabaseRestRpcClient.rpc('bounded_rpc', {}),
        ]) {
          await expect(request()).rejects.toMatchObject({
            name: 'Error', message: 'supabase_rest_config_invalid',
          });
        }
      }
      expect(requests).toHaveLength(0);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    }
  });

  test('keeps HTTP failures exact and rejects other public announcement/banner failures', async () => {
    for (const status of [400, 404, 429, 500, 503]) {
      fetchImplementation = async () => new Response('untrusted-response', { status });
      for (const table of ['restaurants', 'announcements', 'ad_banners', 'untrusted-table']) {
        await expect(fetchSupabaseRows(table, [])).rejects.toMatchObject({
          message: `supabase_rest_rows_failed:${status}`,
        });
        await expect(fetchSupabaseExactCount(table, [])).rejects.toMatchObject({
          message: `supabase_rest_count_failed:${status}`,
        });
      }
    }
  });

  test('discards failed response streams without reading them even when cancellation rejects', async () => {
    for (const cancelRejects of [false, true]) {
      for (const kind of ['rows', 'count', 'rpc', 'public-rows'] as const) {
        const response = new Response('untrusted-response', { status: 403 });
        const cancel = spyOn(response.body!, 'cancel');
        const text = spyOn(response, 'text');
        const json = spyOn(response, 'json');
        if (cancelRejects) cancel.mockRejectedValue(new Error('discard-test'));
        fetchImplementation = async () => response;

        try {
          if (kind === 'rpc') {
            await expect(supabaseRestRpcClient.rpc('bounded_rpc', {})).resolves.toEqual({
              data: null, error: { status: 403 },
            });
          } else if (kind === 'public-rows') {
            await expect(fetchSupabaseRows('announcements', [])).resolves.toEqual([]);
          } else {
            const request = kind === 'rows' ? fetchSupabaseRows : fetchSupabaseExactCount;
            await expect(request('untrusted-table', [])).rejects.toMatchObject({
              message: `supabase_rest_${kind}_failed:403`,
            });
          }
          expect(cancel).toHaveBeenCalledTimes(1);
          expect(text).not.toHaveBeenCalled();
          expect(json).not.toHaveBeenCalled();
        } finally {
          cancel.mockRestore();
          text.mockRestore();
          json.mockRestore();
        }
      }
    }
  });
});
