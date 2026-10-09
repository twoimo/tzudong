import { afterEach, describe, expect, mock, test } from 'bun:test';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
let lookup: { data: unknown; error: unknown } = { data: null, error: null };
let throws = false, creations = 0;
let signal: AbortSignal | null = null;
const query = {
  select: () => query, eq: () => query,
  abortSignal: (value: AbortSignal) => { signal = value; return query; },
  maybeSingle: async () => { if (throws) throw new Error('provider diagnostic'); return lookup; },
};
mock.module('@supabase/supabase-js', () => ({ createClient: () => { creations++; return { from: (table: string) => { expect(table).toBe('short_urls'); return query; } }; } }));
const { GET } = await import('../app/s/[code]/route');
afterEach(() => {
  lookup = { data: null, error: null }; throws = false; creations = 0; signal = null;
  if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
});
const read = (code: string) => GET(new Request(`https://request.invalid/s/${code}`), { params: Promise.resolve({ code }) });

describe('short URL HTTP status and recovery contract', () => {
  test('invalid code is HTTP404 without a data client and includes recovery/noindex', async () => {
    const response = await read('invalid-code');
    expect(response.status).toBe(404); expect(creations).toBe(0);
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(await response.text()).toContain('href="/"');
  });
  test('missing row is HTTP404 with a bounded read', async () => {
    expect((await read('Zz00Qq')).status).toBe(404); expect(signal).toBeInstanceOf(AbortSignal);
  });
  test('provider error, thrown read and malformed data are HTTP503 without diagnostics', async () => {
    lookup.error = { message: 'provider diagnostic' };
    let response = await read('Zz00Qq'); expect(response.status).toBe(503);
    let html = await response.text(); expect(html).toContain('href="/s/Zz00Qq"'); expect(html).not.toContain('provider diagnostic');
    throws = true; response = await read('Zz00Qq'); expect(response.status).toBe(503);
    throws = false; lookup = { data: { target_url: 3 }, error: null };
    expect((await read('Zz00Qq')).status).toBe(503);
  });
  test('safe same-origin review target is HTTP307 and an unsafe target redirects home', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://short.test';
    lookup = { data: { target_url: 'https://short.test/?review=00000000-0000-4000-8000-000000000009' }, error: null };
    let response = await read('Zz00Qq'); expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://short.test/?review=00000000-0000-4000-8000-000000000009');
    lookup.data = { target_url: 'https://external.invalid/?review=00000000-0000-4000-8000-000000000009' };
    response = await read('Zz00Qq'); expect(response.status).toBe(307); expect(response.headers.get('location')).toBe('/');
  });
  test('control characters cannot produce malformed Location headers', async () => {
    lookup = { data: { target_url: '/\r\n?review=00000000-0000-4000-8000-000000000009' }, error: null };
    expect((await read('Zz00Qq')).status).toBe(503);
  });
});
