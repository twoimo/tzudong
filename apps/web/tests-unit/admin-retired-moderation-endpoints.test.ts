import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isTrustedSameOriginMutation } from '../lib/security/same-origin-mutation';
import { RECORD_ACTION_ENDPOINT } from '../lib/admin/record-action-contract';
for (const path of ['restaurant-requests/[requestId]/review', 'restaurants/[restaurantId]/destructive-action']) {
  const source = readFileSync(new URL(`../app/api/admin/${path}/route.ts`, import.meta.url), 'utf8');
  test(`${path} retirement authenticates before origin, never reads/replays a body, and returns bounded no-store responses over HTTP`, async () => {
    let authorized = true, authFailure = false, reads = 0, origins = 0;
    const executable = source.replace(/^import .*\n/gm, '').replace('export const runtime', 'const runtime').replace('export async function', 'async function');
    const run = new Function('NextResponse', 'requireAdmin', 'isTrustedSameOriginMutation', 'RECORD_ACTION_ENDPOINT', new Bun.Transpiler({ loader: 'ts' }).transformSync(executable + '\nreturn POST;'))(
      { json: Response.json }, async () => { if (authFailure) throw Error('private diagnostic'); return authorized ? { ok: true } : { ok: false, response: Response.json({ code: 'FORBIDDEN' }, { status: 403 }) }; },
      (request: Request) => { origins++; return isTrustedSameOriginMutation(request, { NODE_ENV: 'test' }); }, RECORD_ACTION_ENDPOINT,
    ) as (request: Request) => Promise<Response>;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { request.json = async () => { reads++; throw Error('BODY_MUST_NOT_BE_READ'); }; return run(request); } });
    try {
      const call = (origin: string) => fetch(server.url, { method: 'POST', headers: { Origin: origin, Cookie: 'synthetic=1' }, body: '{ invalid old request' });
      authorized = false; expect((await call(server.url.origin)).status).toBe(403); expect(origins).toBe(0);
      authorized = true; expect((await call('https://untrusted.invalid')).status).toBe(403);
      const retired = await call(server.url.origin); expect(retired.status).toBe(410); expect(retired.headers.get('cache-control')).toBe('no-store');
      expect(await retired.json()).toEqual({ success: false, code: 'RECORD_ACTION_ENDPOINT_RETIRED', replacement: RECORD_ACTION_ENDPOINT });
      authFailure = true; const failed = await call(server.url.origin); expect(failed.status).toBe(503); expect(await failed.json()).toEqual({ success: false, code: 'RECORD_ACTION_UNAVAILABLE' });
      expect(reads).toBe(0); expect(source).not.toMatch(/createSupabaseServiceRoleClient|\.rpc\(|randomUUID|request\.json|readBoundedJsonRequest/);
    } finally { server.stop(true); }
  });
}
