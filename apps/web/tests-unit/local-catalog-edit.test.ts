import { describe, expect, test } from 'bun:test';
import { admitsLocalCatalogEdit, executeLocalCatalogEdit } from '../lib/admin/local-catalog-edit';

const actor = '11111111-1111-4111-8111-111111111111';
const restaurant = '22222222-2222-4222-8222-222222222222';
const operation = '33333333-3333-4333-8333-333333333333';
const sha = 'a'.repeat(64);
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'development', TZUDONG_LOCAL_SUPABASE_DEV: '1', LOCAL_SUPABASE_STATE_ROOT: '/fixture',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:8080', SUPABASE_URL: 'http://127.0.0.1:20000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:20000',
};
const apply = { phase: 'apply', patch: { approved_name: 'Edited restaurant' },
  previewSha256: sha, operationId: operation, confirmation: '변경 적용' };
const request = (body: unknown, origin = 'http://localhost:8080') => new Request(
  `http://localhost:8080/api/admin/restaurants/${restaurant}/local-edit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify(body),
  });
const readback = { operation_id: operation, restaurant_id: restaurant, after_sha256: sha, current_sha256: sha,
  changed_fields: ['approved_name'], matches: true, values: { approved_name: 'Edited restaurant' } };

describe('local catalog edit server boundary', () => {
  test('requires a generated local runtime and matching local database targets', () => {
    expect(admitsLocalCatalogEdit(request(apply), env)).toBe(true);
    for (const change of [
      { NODE_ENV: 'production' }, { TZUDONG_LOCAL_SUPABASE_DEV: '0' }, { LOCAL_SUPABASE_STATE_ROOT: '' },
      { SUPABASE_URL: 'https://example.supabase.co' }, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:20001' },
      { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
    ]) expect(admitsLocalCatalogEdit(request(apply), { ...env, ...change } as NodeJS.ProcessEnv)).toBe(false);
    expect(admitsLocalCatalogEdit(new Request('https://example.com/api/admin/local-edit'), env)).toBe(false);
  });

  test('rejects cross-origin, forged actor fields and unconfirmed apply before any RPC', async () => {
    let calls = 0;
    const rpc = async () => { calls++; return { data: null, error: null }; };
    for (const req of [request(apply, 'https://example.com'), request({ ...apply, confirmation: '' }),
      request({ ...apply, actorId: actor }), request({ ...apply, patch: { status: 'deleted' } }),
      request({ ...apply, patch: { lat: 37 } })]) {
      expect((await executeLocalCatalogEdit(req, restaurant, actor, rpc, env)).status).toBeGreaterThanOrEqual(400);
    }
    expect(calls).toBe(0);
  });

  test('previews only and returns the bound before/after result', async () => {
    const calls: string[] = [];
    const result = await executeLocalCatalogEdit(request({ phase: 'preview', patch: apply.patch }), restaurant, actor,
      async (name, args) => {
        calls.push(name);
        expect(args.p_actor).toBe(actor);
        expect(args.p_restaurant).toBe(restaurant);
        return { data: { before: { approved_name: 'Original' }, after: apply.patch,
          before_sha256: sha, preview_sha256: sha }, error: null };
      }, env);
    expect(result.status).toBe(200);
    expect(calls).toEqual(['prepare_local_restaurant_catalog_edit']);
    expect((await result.json()).operationId).toMatch(/^[a-f0-9-]{36}$/);
  });

  test('reports success only after an independent matching readback', async () => {
    const calls: string[] = [];
    const result = await executeLocalCatalogEdit(request(apply), restaurant, actor, async name => {
      calls.push(name);
      return { data: name.startsWith('apply_')
        ? { operation_id: operation, after_sha256: sha, changed_fields: ['approved_name'], replayed: false }
        : readback, error: null };
    }, env);
    expect(calls).toEqual(['apply_local_restaurant_catalog_edit', 'readback_local_restaurant_catalog_edit']);
    expect(result.status).toBe(200);
    expect((await result.json()).ok).toBe(true);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });

  test('keeps the same operation ID when apply delivery or readback is uncertain', async () => {
    const unknown = await executeLocalCatalogEdit(request(apply), restaurant, actor,
      async () => { throw new Error('untrusted provider diagnostic'); }, env);
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toEqual({ error: 'CATALOG_EDIT_OUTCOME_UNKNOWN', operationId: operation, applied: false });
    let calls = 0;
    const pending = await executeLocalCatalogEdit(request(apply), restaurant, actor, async () => {
      if (++calls === 1) return { data: { operation_id: operation, after_sha256: sha,
        changed_fields: ['approved_name'], replayed: true }, error: null };
      return { data: null, error: { code: 'connection_failed' } };
    }, env);
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ error: 'CATALOG_EDIT_READBACK_PENDING', operationId: operation, applied: true });
  });

  test('rejects stale edits and never reads back or retries a rejected apply', async () => {
    let calls = 0;
    const response = await executeLocalCatalogEdit(request(apply), restaurant, actor, async () => {
      calls++; return { data: null, error: { code: '40001' } };
    }, env);
    expect(response.status).toBe(409);
    expect(calls).toBe(1);
  });

  test('readback detects changed hashes and cannot confirm another restaurant', async () => {
    const changed = await executeLocalCatalogEdit(request({ phase: 'readback', operationId: operation }), restaurant, actor,
      async () => ({ data: { ...readback, current_sha256: 'b'.repeat(64) }, error: null }), env);
    expect(changed.status).toBe(409);
    const wrong = await executeLocalCatalogEdit(request({ phase: 'readback', operationId: operation }), restaurant, actor,
      async () => ({ data: { ...readback, restaurant_id: actor }, error: null }), env);
    expect(wrong.status).toBe(202);
    expect((await wrong.json()).error).toBe('CATALOG_EDIT_READBACK_PENDING');
  });
});
