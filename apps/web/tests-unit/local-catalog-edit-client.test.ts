import { describe, expect, test } from 'bun:test';
import {
  LocalCatalogEditSession as Session,
  pendingCatalogEdit,
  type CatalogEditPatch,
} from '../lib/admin/local-catalog-edit-client';

// Retained from the original 12 ad-hoc checks. All transport and storage are
// injected; these fixtures make no HTTP requests or database changes.
const restaurantId = '00000000-0000-4000-8000-000000000101';
const operationId = '00000000-0000-4000-8000-000000000201';
const hash = 'a'.repeat(64);
const preview = {
  ok: true,
  operationId,
  preview: {
    before: { approved_name: 'old', categories: ['old'] },
    after: { approved_name: 'new', categories: ['new'] },
    before_sha256: hash,
    preview_sha256: hash,
  },
};
const verified = {
  ok: true,
  operationId,
  readback: {
    operation_id: operationId,
    restaurant_id: restaurantId,
    after_sha256: hash,
    current_sha256: hash,
    matches: true,
    changed_fields: ['approved_name', 'categories'],
    values: { approved_name: 'new', categories: ['new'] },
  },
};
type Reply = { status: number; body: unknown } | Error;
type CapturedRequest = { phase: string; patch?: CatalogEditPatch };

function setup(replies: Reply[]) {
  const data = new Map<string, string>();
  const calls: CapturedRequest[] = [];
  const queue = [...replies];
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  const fetcher = async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as CapturedRequest);
    const reply = queue.shift();
    if (!reply) throw new Error('Unexpected mock request');
    if (reply instanceof Error) throw reply;
    return Response.json(reply.body, { status: reply.status });
  };
  return { store, calls, fetcher: fetcher as typeof fetch };
}

const prepare = (harness: ReturnType<typeof setup>, patch: CatalogEditPatch = {
  approved_name: 'new', categories: ['new'],
}) => Session.prepare(restaurantId, patch, harness.fetcher, () => harness.store);

describe('local catalog edit client retained checks', () => {
  test('rejects a wrong confirmation before emitting an apply request', async () => {
    const harness = setup([{ status: 200, body: preview }]);
    const session = await prepare(harness);
    const result = await session.apply('wrong');
    expect(result.kind === 'rejected' && harness.calls.length === 1).toBe(true);
  });

  test('accepts matching readback after exact confirmation', async () => {
    const harness = setup([{ status: 200, body: preview }, { status: 200, body: verified }]);
    const session = await prepare(harness);
    expect((await session.apply('변경 적용')).kind).toBe('verified');
  });

  test('applies the previewed patch despite later caller and category edits', async () => {
    const harness = setup([{ status: 200, body: preview }, { status: 200, body: verified }]);
    const input = { approved_name: 'new', categories: ['new'] };
    const session = await prepare(harness, input);
    input.approved_name = 'later';
    input.categories.push('later');
    await session.apply('변경 적용');
    const patch = harness.calls[1]?.patch;
    expect(patch?.approved_name === 'new' && patch.categories?.length === 1).toBe(true);
  });

  test('clears the retained operation after verified readback', async () => {
    const harness = setup([{ status: 200, body: preview }, { status: 200, body: verified }]);
    const session = await prepare(harness);
    await session.apply('변경 적용');
    expect(pendingCatalogEdit(restaurantId, harness.store)).toBeNull();
  });

  test('does not send another apply from an already applied session', async () => {
    const harness = setup([{ status: 200, body: preview }, { status: 200, body: verified }]);
    const session = await prepare(harness);
    await session.apply('변경 적용');
    const result = await session.apply('변경 적용');
    expect(result.kind === 'pending' && harness.calls.length === 2).toBe(true);
  });

  test('retains the operation ID when apply transport fails', async () => {
    const harness = setup([{ status: 200, body: preview }, new Error()]);
    const session = await prepare(harness);
    const result = await session.apply('변경 적용');
    expect(result.kind === 'pending' && pendingCatalogEdit(restaurantId, harness.store) === operationId).toBe(true);
  });

  test('restores an unknown operation without allowing apply', async () => {
    const harness = setup([{ status: 200, body: preview }, new Error()]);
    const session = await prepare(harness);
    await session.apply('변경 적용');
    const restored = Session.restore(restaurantId, operationId, harness.fetcher, () => harness.store);
    const result = await restored.apply('변경 적용');
    expect(result.kind === 'pending' && harness.calls.length === 2).toBe(true);
  });

  test('restored recovery sends readback without the patch', async () => {
    const harness = setup([{ status: 200, body: preview }, new Error(), { status: 200, body: verified }]);
    const session = await prepare(harness);
    await session.apply('변경 적용');
    const restored = Session.restore(restaurantId, operationId, harness.fetcher, () => harness.store);
    const result = await restored.readback();
    expect(result.kind === 'verified' && harness.calls[2]?.phase === 'readback'
      && !('patch' in harness.calls[2])).toBe(true);
  });

  test('rejects a stale conflict and clears its operation ID', async () => {
    const harness = setup([{ status: 200, body: preview },
      { status: 409, body: { error: 'CATALOG_EDIT_CONFLICT' } }]);
    const session = await prepare(harness);
    const result = await session.apply('변경 적용');
    expect(result.kind === 'rejected' && pendingCatalogEdit(restaurantId, harness.store) === null).toBe(true);
  });

  test('keeps a mismatched readback operation pending with its original ID', async () => {
    const harness = setup([{ status: 200, body: preview },
      { status: 200, body: { ...verified, operationId: restaurantId } }]);
    const session = await prepare(harness);
    const result = await session.apply('변경 적용');
    expect(result.kind === 'pending' && pendingCatalogEdit(restaurantId, harness.store) === operationId).toBe(true);
  });

  test('rejects a phone patch without emitting any request', async () => {
    const harness = setup([]);
    let code: string | undefined;
    try {
      await prepare(harness, { phone: 'unsupported' } as unknown as CatalogEditPatch);
    } catch (error) {
      if (error instanceof Error) code = error.message;
    }
    expect(harness.calls.length === 0 && code === 'CATALOG_EDIT_INVALID').toBe(true);
  });

  test('rejects storage failure before emitting apply', async () => {
    const harness = setup([{ status: 200, body: preview }]);
    const session = await Session.prepare(restaurantId, { approved_name: 'new', categories: ['new'] },
      harness.fetcher, () => ({ ...harness.store, setItem: () => { throw new Error(); } }));
    const result = await session.apply('변경 적용');
    expect(result.kind === 'rejected' && harness.calls.length === 1).toBe(true);
  });
});
