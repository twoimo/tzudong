import { describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

mock.module('server-only', () => ({}));

const {
  FEATURE_DATABASE_HELD,
  FEATURE_DATABASE_READY,
  fetchFeatureDatabaseReadiness,
  parseFeatureDatabaseReadiness,
} = await import('@/lib/runtime-feature-readiness-contract');
const { readFeatureDatabaseReadiness } = await import('@/lib/server/runtime-feature-readiness');

describe('feature database readiness contract', () => {
  test('uses the final owner-scoped feature capability RPC and accepts only its exact ready receipt', async () => {
    const ownerId = randomUUID();
    const calls: unknown[] = [];
    const readiness = await readFeatureDatabaseReadiness({
      ownerId,
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: {
          schema_version: 1,
          status: 'ready',
          code: 'FEATURE_DATABASE_READY',
          capability_version: 'review-media-feature-v1',
        }, error: null };
      },
    });

    expect(readiness).toBe(FEATURE_DATABASE_READY);
    expect(calls).toEqual([{
      name: 'get_feature_runtime_capability',
      args: { p_user_id: ownerId },
    }]);
  });

  test('keeps DB86, base97, partial feature stages, malformed receipts, and exceptions held', async () => {
    const ownerId = randomUUID();
    for (const rpc of [
      async () => ({ data: null, error: { code: '42883' } }),
      async () => ({ data: null, error: null }),
      async () => ({ data: { schema_version: 1, status: 'held', code: 'FEATURE_DATABASE_HELD', capability_version: 'review-media-feature-v1' }, error: null }),
      async () => ({ data: { schema_version: 1, status: 'ready', code: 'FEATURE_DATABASE_READY', capability_version: 'partial-100' }, error: null }),
      async () => ({ data: { schema_version: 1, status: 'ready', code: 'FEATURE_DATABASE_READY', capability_version: 'review-media-feature-v1', extra: true }, error: null }),
      async () => { throw new Error('private database detail'); },
    ]) {
      expect(await readFeatureDatabaseReadiness({ ownerId, rpc })).toBe(FEATURE_DATABASE_HELD);
    }
  });

  test('rejects invalid owners before any RPC and parses only the fixed ready DTO', async () => {
    let calls = 0;
    expect(await readFeatureDatabaseReadiness({
      ownerId: 'not-an-owner',
      rpc: async () => { calls++; return { data: [], error: null }; },
    })).toBe(FEATURE_DATABASE_HELD);
    expect(calls).toBe(0);
    expect(parseFeatureDatabaseReadiness(FEATURE_DATABASE_READY)).toBe(FEATURE_DATABASE_READY);
    expect(parseFeatureDatabaseReadiness({ ...FEATURE_DATABASE_READY, extra: true })).toBe(FEATURE_DATABASE_HELD);
    expect(parseFeatureDatabaseReadiness({ status: 'ready', code: 'FEATURE_DATABASE_READY' })).toBe(FEATURE_DATABASE_HELD);
  });

  test('client fetch remains held on auth, network, or malformed responses', async () => {
    expect(await fetchFeatureDatabaseReadiness(async () => new Response(
      JSON.stringify(FEATURE_DATABASE_READY),
      { status: 200 },
    ))).toBe(FEATURE_DATABASE_READY);
    expect(await fetchFeatureDatabaseReadiness(async () => new Response('{}', { status: 200 }))).toBe(FEATURE_DATABASE_HELD);
    expect(await fetchFeatureDatabaseReadiness(async () => new Response('{}', { status: 401 }))).toBe(FEATURE_DATABASE_HELD);
    expect(await fetchFeatureDatabaseReadiness(async () => { throw new Error('offline'); })).toBe(FEATURE_DATABASE_HELD);
  });
});
