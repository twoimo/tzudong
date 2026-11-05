import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  fetchCompleteRestaurantRows,
  fetchRestaurantsRecoveringMissingEmbed,
  isMissingEvidenceRelationError,
  RESTAURANT_EVIDENCE_FRAME_EMBED,
} from '../hooks/use-restaurants';
import {
  fetchSupabaseExactCount,
  fetchSupabaseRows,
  supabaseRestRpcClient,
} from '../lib/supabase-rest-client';
import { describeErrorCodeForLog } from '../lib/debug-log';

const select = `id,name:approved_name,${RESTAURANT_EVIDENCE_FRAME_EMBED}`;
const query: Array<[string, string | number]> = [
  ['select', select], ['status', 'eq.approved'], ['order', 'approved_name.asc,id.asc'],
  ['lat', 'gte.1'], ['lat', 'lte.2'],
];
const privateMarker = 'synthetic-private-provider-diagnostic';
const providerBody = (code: unknown = 'PGRST200') => JSON.stringify({
  code, message: privateMarker, details: privateMarker, hint: privateMarker,
  rows: [{ private: privateMarker }],
});
const jsonResponse = (body: string, status = 400) => new Response(body, {
  status, headers: { 'content-type': 'application/json' },
});

let requests: URL[];
let transport: (url: URL, init?: RequestInit) => Promise<Response>;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
let errorSpy: ReturnType<typeof spyOn<typeof console, 'error'>>;
let logSpy: ReturnType<typeof spyOn<typeof console, 'log'>>;
let priorUrl: string | undefined;
let priorKey: string | undefined;

beforeEach(() => {
  priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-public-key';
  requests = [];
  transport = async () => { throw new Error('unexpected synthetic request'); };
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    return transport(url, init);
  }) as typeof fetch);
  errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  fetchSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
});

async function rejectedError(request: Promise<unknown>, status: number): Promise<Error> {
  const error = await request.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(`supabase_rest_rows_failed:${status}`);
  expect(isMissingEvidenceRelationError(error)).toBe(false);
  expect(String(error)).not.toContain(privateMarker);
  expect(JSON.stringify(error)).not.toContain(privateMarker);
  expect((error as Error).stack).not.toContain(privateMarker);
  expect(errorSpy).not.toHaveBeenCalled();
  expect(logSpy).not.toHaveBeenCalled();
  return error as Error;
}

describe('default HTTP adapter to restaurant recovery (synthetic fetch only)', () => {
  test('recovers PGRST200 once, removing only the evidence embed and preserving the query', async () => {
    const before = structuredClone(query);
    transport = async () => requests.length === 1
      ? jsonResponse(providerBody())
      : jsonResponse('[{"id":"kept","name":"synthetic"}]', 200);
    await expect(fetchRestaurantsRecoveringMissingEmbed(query)).resolves.toEqual([
      { id: 'kept', name: 'synthetic' },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.pathname === '/rest/v1/restaurants')).toBe(true);
    expect([...requests[0].searchParams]).toEqual(query.map(([key, value]) => [key, String(value)]));
    expect([...requests[1].searchParams]).toEqual(query.map(([key, value]) => [
      key, key === 'select' ? 'id,name:approved_name' : String(value),
    ]));
    expect(query).toEqual(before);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('carries only the allowlisted code and status while preserving the fixed diagnostic', async () => {
    transport = async () => jsonResponse(providerBody());
    const error = await fetchSupabaseRows('restaurants', query).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'Error', message: 'supabase_rest_rows_failed:400', status: 400, code: 'PGRST200' });
    expect(isMissingEvidenceRelationError(error)).toBe(true);
    expect(describeErrorCodeForLog(error)).toBe('PGRST200');
    expect(Object.keys(error as object).sort()).toEqual(['code', 'status']);
    expect(JSON.stringify(error)).not.toContain(privateMarker);
    expect(String(error)).not.toContain(privateMarker);
    expect((error as Error).stack).not.toContain(privateMarker);
  });

  for (const status of [401, 403, 404, 429, 500, 503]) {
    test(`does not recover HTTP ${status} even with a PGRST200 body`, async () => {
      transport = async () => jsonResponse(providerBody(), status);
      await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), status);
      expect(requests).toHaveLength(1);
    });
  }

  for (const body of [
    providerBody('42501'), providerBody('PGRST201'), providerBody('PGRST200 '),
    providerBody({ code: 'PGRST200' }), 'not-json', '', 'null', '[]',
    '[{"code":"PGRST200"}]', '{"message":"PGRST200"}',
    '{"error":{"code":"PGRST200"}}', '{"code":"PGRST200",',
  ]) {
    test(`rejects malformed or unrecognized error envelope ${body.slice(0, 45)}`, async () => {
      transport = async () => jsonResponse(body);
      await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 400);
      expect(requests).toHaveLength(1);
    });
  }

  test('does not use legacy free-form PGRST200 text to classify denials or embed loss', () => {
    for (const error of [
      new Error('401 PGRST200'), new Error('403 PGRST200'), new Error('42501 PGRST200'),
      new Error('PGRST200'), Object.assign(new Error('PGRST200'), { status: 403, code: '42501' }),
    ]) expect(isMissingEvidenceRelationError(error)).toBe(false);
  });

  test('rejects network failures with a fixed error and no fallback', async () => {
    transport = async () => { throw new Error(`PGRST200 ${privateMarker}`); };
    await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 0);
    expect(requests).toHaveLength(1);
  });

  test('rejects unreadable error streams without disclosing stream errors', async () => {
    transport = async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error(privateMarker)); },
    }), { status: 400 });
    await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 400);
    expect(requests).toHaveLength(1);
  });

  test('rejects absent error bodies and invalid UTF-8 without recovery', async () => {
    for (const response of [
      new Response(null, { status: 400 }),
      new Response(new Uint8Array([
        ...new TextEncoder().encode('{"code":"PGRST200","message":"'), 255,
        ...new TextEncoder().encode('"}'),
      ]), { status: 400 }),
    ]) {
      transport = async () => response;
      await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 400);
    }
    expect(requests).toHaveLength(2);
  });

  test('accepts the byte limit and rejects a complete valid JSON body one byte over it', async () => {
    const envelope = '{"code":"PGRST200","message":""}';
    for (const bytes of [8192, 8193]) {
      const body = envelope.replace('"message":""', `"message":"${'x'.repeat(bytes - envelope.length)}"`);
      expect(new TextEncoder().encode(body).byteLength).toBe(bytes);
      transport = async () => jsonResponse(body);
      const error = await fetchSupabaseRows('restaurants', query).catch((caught: unknown) => caught);
      expect((error as Error).message).toBe('supabase_rest_rows_failed:400');
      expect(isMissingEvidenceRelationError(error)).toBe(bytes === 8192);
    }
    expect(requests).toHaveLength(2);
  });

  test('bounds streamed error bodies by actual UTF-8 bytes and cancels before the tail', async () => {
    let pulls = 0;
    let cancelled = false;
    const chunks = [
      new TextEncoder().encode('{"code":"PGRST200","message":"'),
      new TextEncoder().encode('가'.repeat(3000)),
      new TextEncoder().encode('"}'),
    ];
    transport = async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(chunks[pulls++]); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { status: 400, headers: { 'content-length': '20' } });
    await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 400);
    expect(requests).toHaveLength(1);
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });

  test('oversize stream cancellation failures keep fixed sanitized HTTP errors', async () => {
    transport = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(8193)); },
      cancel() { throw new Error(privateMarker); },
    }), { status: 400 });
    await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 400);
    expect(requests).toHaveLength(1);
  });

  test('the real deadline rejects a pending stream and cancels it once', async () => {
    let cancellations = 0;
    const response = new Response(new ReadableStream({
      pull() { return new Promise<void>(() => {}); },
      cancel() { cancellations++; },
    }, { highWaterMark: 0 }), { status: 400 });
    transport = async () => response;
    const error = await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 400);
    expect((error as { code?: unknown }).code).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(cancellations).toBe(1);
    expect(response.body?.locked).toBe(false);
  }, 1000);

  test('deadlines reject stalled bodies without accepting a JSON prefix or awaiting cleanup', async () => {
    const timer = spyOn(globalThis, 'setTimeout');
    const clear = spyOn(globalThis, 'clearTimeout');
    try {
      for (const prefix of ['', '{"code":"PGRST200"}']) {
        for (const cancelResult of ['resolve', 'pending', 'throw', 'reject']) {
          let readStarted!: () => void;
          const pendingRead = new Promise<void>((resolve) => { readStarted = resolve; });
          let pulls = 0;
          let cancellations = 0;
          const response = new Response(new ReadableStream({
            pull(controller) {
              if (prefix && pulls++ === 0) controller.enqueue(new TextEncoder().encode(prefix));
              else {
                readStarted();
                return new Promise<void>(() => {});
              }
            },
            cancel() {
              cancellations++;
              if (cancelResult === 'pending') return new Promise<void>(() => {});
              if (cancelResult === 'throw') throw new Error(privateMarker);
              if (cancelResult === 'reject') return Promise.reject(new Error(privateMarker));
            },
          }, { highWaterMark: 0 }), { status: 400 });
          transport = async () => response;
          const timerIndex = timer.mock.calls.length;
          const request = fetchRestaurantsRecoveringMissingEmbed(query);
          await pendingRead;
          const [expire, milliseconds] = timer.mock.calls[timerIndex];
          expect(milliseconds).toBe(250);
          expect(typeof expire).toBe('function');
          // Drive the actual scheduled callback; no sleep or timer framework.
          (expire as () => void)();
          const error = await rejectedError(request, 400);
          expect((error as { code?: unknown }).code).toBeUndefined();
          expect(cancellations).toBe(1);
          expect(response.body?.locked).toBe(false);
          expect(clear).toHaveBeenCalledWith(timer.mock.results[timerIndex].value);
        }
      }
      expect(requests).toHaveLength(8);
      expect(timer).toHaveBeenCalledTimes(8);
      expect(clear).toHaveBeenCalledTimes(8);
    } finally {
      timer.mockRestore();
      clear.mockRestore();
    }
  });

  test('disposes deadline timers on every completed, absent, malformed or oversized body path', async () => {
    const timer = spyOn(globalThis, 'setTimeout');
    const clear = spyOn(globalThis, 'clearTimeout');
    try {
      for (const response of [
        jsonResponse(providerBody()), jsonResponse('not-json'), jsonResponse('null'),
        jsonResponse('x'.repeat(8193)), new Response(null, { status: 400 }),
        new Response(new ReadableStream({ start(controller) { controller.error(new Error(privateMarker)); } }), { status: 400 }),
      ]) {
        transport = async () => response;
        await expect(fetchSupabaseRows('restaurants', query)).rejects.toThrow('supabase_rest_rows_failed:400');
      }
      expect(timer).toHaveBeenCalledTimes(5); // No timer is needed without a reader.
      expect(clear).toHaveBeenCalledTimes(5);
      for (const result of timer.mock.results) expect(clear).toHaveBeenCalledWith(result.value);
    } finally {
      timer.mockRestore();
      clear.mockRestore();
    }
  });

  test('cancel and releaseLock failures cannot replace the fixed sanitized HTTP rejection', async () => {
    for (const cancelThrows of [true, false]) {
      const response = jsonResponse('not-json');
      const reader = response.body!.getReader();
      const getReader = spyOn(response.body!, 'getReader').mockReturnValue(reader);
      const cancel = spyOn(reader, 'cancel').mockImplementation(() => {
        if (cancelThrows) throw new Error(privateMarker);
        return Promise.reject(new Error(privateMarker));
      });
      const release = spyOn(reader, 'releaseLock').mockImplementation(() => { throw new Error(privateMarker); });
      transport = async () => response;
      try {
        await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 400);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
      } finally {
        getReader.mockRestore();
        cancel.mockRestore();
        release.mockRestore();
        reader.releaseLock();
      }
    }
    expect(requests).toHaveLength(2);
  });

  test('parses a bounded chunked code but does not expose provider text', async () => {
    let chunk = 0;
    const chunks = ['{"co', 'de":"PGR', 'ST200","message":"', privateMarker, '"}'];
    transport = async () => requests.length === 1
      ? new Response(new ReadableStream({
        pull(controller) {
          if (chunk === chunks.length) controller.close();
          else controller.enqueue(new TextEncoder().encode(chunks[chunk++]));
        },
      }), { status: 400 })
      : jsonResponse('[]', 200);
    await expect(fetchRestaurantsRecoveringMissingEmbed(query)).resolves.toEqual([]);
    expect(requests).toHaveLength(2);
  });

  test('does not retry queries without the evidence embed', async () => {
    transport = async () => jsonResponse(providerBody());
    await expect(fetchRestaurantsRecoveringMissingEmbed([['select', 'id']])).rejects.toThrow('supabase_rest_rows_failed:400');
    expect(requests).toHaveLength(1);
  });

  test('propagates a failed fallback without a third request or success-shaped default', async () => {
    transport = async () => requests.length === 1 ? jsonResponse(providerBody()) : jsonResponse(providerBody('42501'), 403);
    await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 403);
    expect(requests).toHaveLength(2);
  });

  test('does not retry a second PGRST200', async () => {
    transport = async () => jsonResponse(providerBody());
    await expect(fetchRestaurantsRecoveringMissingEmbed(query)).rejects.toThrow('supabase_rest_rows_failed:400');
    expect(requests).toHaveLength(2);
  });

  test('preserves successful rows and rejects malformed success JSON without fallback', async () => {
    transport = async () => jsonResponse('[{"id":"original"}]', 200);
    await expect(fetchRestaurantsRecoveringMissingEmbed(query)).resolves.toEqual([{ id: 'original' }]);
    expect(requests).toHaveLength(1);
    transport = async () => jsonResponse('not-json PGRST200', 200);
    await rejectedError(fetchRestaurantsRecoveringMissingEmbed(query), 0);
    expect(requests).toHaveLength(2);
  });

  test('preserves announcement/banner denial fallback and their other errors', async () => {
    for (const table of ['announcements', 'ad_banners']) {
      for (const status of [401, 403]) {
        transport = async () => jsonResponse(providerBody(), status);
        await expect(fetchSupabaseRows(table, [])).resolves.toEqual([]);
      }
      transport = async () => jsonResponse(providerBody('42501'));
      await rejectedError(fetchSupabaseRows(table, []), 400);
    }
    expect(requests).toHaveLength(6);
  });

  test('does not apply row recovery to counts or RPC failures', async () => {
    transport = async () => jsonResponse(providerBody());
    await expect(fetchSupabaseExactCount('restaurants', query)).rejects.toThrow('supabase_rest_count_failed:400');
    await expect(supabaseRestRpcClient.rpc('synthetic_rpc', {})).resolves.toEqual({ data: null, error: { status: 400 } });
    expect(requests).toHaveLength(2);
  });

  test('complete pagination recovers each capped page through the default adapter', async () => {
    transport = async (url) => {
      if (url.searchParams.get('select')?.includes('restaurant_evidence_frames(')) return jsonResponse(providerBody());
      const offset = Number(url.searchParams.get('offset'));
      return jsonResponse(JSON.stringify(offset < 2 ? [{ id: String(offset) }] : []), 200);
    };
    await expect(fetchCompleteRestaurantRows(query)).resolves.toEqual([{ id: '0' }, { id: '1' }]);
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '0', '1', '1', '2', '2']);
    expect(requests.every((url) => url.searchParams.get('limit') === '1000')).toBe(true);
  });

  test('complete pagination rejects later-page denial instead of returning partial rows', async () => {
    transport = async (url) => {
      if (url.searchParams.get('offset') === '1') return jsonResponse(providerBody('42501'), 403);
      if (url.searchParams.get('select')?.includes('restaurant_evidence_frames(')) return jsonResponse(providerBody());
      return jsonResponse('[{"id":"first"}]', 200);
    };
    await rejectedError(fetchCompleteRestaurantRows(query), 403);
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '0', '1']);
  });
});
