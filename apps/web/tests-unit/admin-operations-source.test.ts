import { afterEach, describe, expect, test } from 'bun:test';
import { readOperationsSource } from '../lib/admin/operations-source';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const stub = (fn: typeof fetch) => { globalThis.fetch = fn; };

describe('operations source request boundary', () => {
  test('does not start a request after query cancellation', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Cancelled', 'AbortError');
    controller.abort(reason);
    let called = false;
    stub((async () => { called = true; return new Response('{}'); }) as typeof fetch);
    await expect(readOperationsSource('pipeline', controller.signal)).rejects.toBe(reason);
    expect(called).toBe(false);
  });

  test('propagates query cancellation during fetch instead of returning outage data', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Cancelled', 'AbortError');
    stub((async () => { controller.abort(reason); throw reason; }) as typeof fetch);
    await expect(readOperationsSource('pending', controller.signal)).rejects.toBe(reason);
  });

  test('propagates cancellation while reading a response body', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Cancelled', 'AbortError');
    stub((async () => ({ ok: true, json: async () => { controller.abort(reason); return {}; } })) as unknown as typeof fetch);
    await expect(readOperationsSource('automation', controller.signal)).rejects.toBe(reason);
  });

  test('retains bounded forbidden and outage states without provider text', async () => {
    for (const status of [401, 403, 500]) {
      stub((async () => new Response('provider diagnostic must not escape', { status })) as typeof fetch);
      const result = await readOperationsSource('pipeline', new AbortController().signal);
      expect(result.state).toBe(status === 500 ? 'unavailable' : 'forbidden');
      expect(JSON.stringify(result)).not.toContain('provider diagnostic');
    }
    stub((async () => { throw new DOMException('Request timed out', 'TimeoutError'); }) as typeof fetch);
    expect((await readOperationsSource('pipeline', new AbortController().signal)).state).toBe('unavailable');
  });

  test('reads only the canonical endpoint and validates successful payloads', async () => {
    let endpoint = '';
    stub((async (input, init) => {
      endpoint = String(input);
      expect(init?.method).toBe('GET');
      expect(init?.cache).toBe('no-store');
      return Response.json({ source: 'job_api', jobs: [], failures: [] });
    }) as typeof fetch);
    const result = await readOperationsSource('pipeline', new AbortController().signal);
    expect(endpoint).toBe('/api/admin/pipeline');
    expect(result.state).toBe('ready');
    stub((async () => Response.json({ changedSchema: true })) as typeof fetch);
    expect((await readOperationsSource('pipeline', new AbortController().signal)).state).toBe('invalid');
  });
});
