import { describe, expect, test } from 'bun:test';
import { createRecordActionClient, recordActionMediaNotice, type RecordActionInput } from '../lib/admin/record-action-client';
import { RECORD_ACTION_CONFIRMATION, type RecordActionReceipt, type RecordActionRequest } from '../lib/admin/record-action-contract';
const target = '33333333-3333-4333-8333-333333333333';
const operation = '22222222-2222-4222-8222-222222222222';
const audit = '44444444-4444-4444-8444-444444444444';
const input: RecordActionInput = { action: 'restaurant.delete', targetIds: [target], payload: { reason: '합성 검수 삭제' } };
function preview(body: RecordActionRequest): RecordActionReceipt {
  return { operationId: body.operationId, action: body.action, state: 'preview', previewHash: 'a'.repeat(64), targetIds: body.targetIds, auditId: null,
    expiresAt: new Date(Date.now() + 900000).toISOString(), readback: [{ id: target, kind: body.action.split('.')[0], status: 'pending', fingerprint: 'b'.repeat(64) }], mediaCleanupPending: false };
}
function fixture(options: { fixedCode?: string; maintenancePhase?: 'preview' | 'apply'; lostPreview?: boolean; lostApply?: boolean; conflict?: boolean; pendingGet?: boolean; failedGet?: boolean; delayPreview?: Promise<void>; delayApply?: Promise<void>; mutateReceipt?: (r: RecordActionReceipt) => unknown; media?: boolean; cleanupHold?: 'maintenance' | 'unadmitted'; cleanupComplete?: boolean; denied?: number; resultIds?: string[] } = {}) {
  const calls: Array<{ method: string; path: string; operationId?: string; body?: RecordActionRequest }> = [];
  let receipt: RecordActionReceipt | null = null;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (options.denied) return Response.json({ error: 'provider text must stay hidden' }, { status: options.denied });
    if (request.method === 'GET') {
      calls.push({ method: 'GET', path: url.pathname, operationId: url.searchParams.get('operationId')! });
      if (options.failedGet) return Response.json({ code: 'RECORD_ACTION_UNCERTAIN' }, { status: 503 });
      const value = options.pendingGet && receipt ? { ...receipt, state: 'preview', auditId: null } : receipt;
      return Response.json({ success: true, receipt: options.mutateReceipt && value ? options.mutateReceipt(value as RecordActionReceipt) : value });
    }
    const body = await request.json() as RecordActionRequest;
    calls.push({ method: 'POST', path: url.pathname, operationId: body.operationId, body });
    if (url.pathname.endsWith('/media-cleanup')) {
      if (options.cleanupHold) return Response.json({ success: false, code: options.cleanupHold === 'maintenance' ? 'RECORD_ACTION_MAINTENANCE' : 'RECORD_ACTION_MEDIA_NOT_ADMITTED' }, { status: options.cleanupHold === 'maintenance' ? 423 : 503 });
      if (options.cleanupComplete && receipt) { receipt = { ...receipt, mediaCleanupPending: false }; return Response.json({ success: true, receipt }); }
      return Response.json({ code: 'RECORD_ACTION_UNCERTAIN' }, { status: 503 });
    }
    if (body.phase === options.maintenancePhase) return Response.json({ success: false, code: 'RECORD_ACTION_MAINTENANCE' }, { status: 423 });
    if (body.phase === 'preview') {
      receipt = preview(body); if (body.action === 'restaurant.create') receipt.readback = []; await options.delayPreview;
      if (options.lostPreview) return Response.json({ code: 'RECORD_ACTION_UNCERTAIN' }, { status: 503 });
    } else {
      await options.delayApply;
      if (options.fixedCode) return Response.json({ code: options.fixedCode, diagnostic: 'never display provider prose' }, { status: 409 });
      if (options.conflict) return Response.json({ code: 'RECORD_ACTION_STALE', diagnostic: 'never display provider prose' }, { status: 409 });
      receipt = { ...receipt!, state: 'applied', auditId: audit, targetIds: options.resultIds ?? body.targetIds, readback: (options.resultIds ?? body.targetIds).map(id => ({ id, kind: body.action.split('.')[0], status: body.action === 'restaurant.create' ? 'pending' : 'deleted', fingerprint: body.action === 'restaurant.create' ? 'b'.repeat(64) : null })), mediaCleanupPending: options.media ?? false };
      if (options.lostApply) return Response.json({ code: 'RECORD_ACTION_UNCERTAIN' }, { status: 503 });
    }
    return Response.json({ success: true, receipt: options.mutateReceipt ? options.mutateReceipt(receipt!) : receipt });
  } });
  const storage = new Map<string, string>();
  const transport: typeof fetch = (url, init) => fetch(new URL(String(url), server.url), init);
  const events: string[] = [];
  const client = createRecordActionClient({ actor: 'opaque-a', onInvalidate: () => events.push('invalidated'), onApplied: () => events.push('applied'), fetch: transport, uuid: () => operation, storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } } });
  return { client, calls, storage, options, transport, events, close: () => server.stop(true) };
}
async function phase(client: ReturnType<typeof createRecordActionClient>, expected: string) {
  for (let index = 0; index < 200; index++) { if (client.getSnapshot().phase === expected) return; await Bun.sleep(5); }
  expect(client.getSnapshot().phase).toBe(expected);
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { resolve, promise }; }

describe('guarded record action client over real loopback HTTP', () => {
  test('preview, exact confirmation, single immutable apply, GET audit readback; concurrent calls cannot replace identity', async () => {
    const f = fixture();
    try {
      const draft = structuredClone(input); const done = f.client.run(draft); await phase(f.client, 'confirming');
      (draft.payload as { reason: string }).reason = 'changed after preview'; draft.targetIds[0] = audit;
      await expect(f.client.run(input)).rejects.toThrow();
      await f.client.apply('변경적용'); expect(f.calls).toHaveLength(1);
      await Promise.all([f.client.apply(RECORD_ACTION_CONFIRMATION), f.client.apply(RECORD_ACTION_CONFIRMATION)]);
      const receipt = await done; expect(receipt.auditId).toBe(audit); expect(f.client.getSnapshot().phase).toBe('idle');
      expect(f.calls.map(call => call.method)).toEqual(['POST', 'POST', 'GET']);
      expect(f.calls[1].body).toEqual({ ...f.calls[0].body!, phase: 'apply', previewHash: 'a'.repeat(64), confirmation: RECORD_ACTION_CONFIRMATION });
      expect(f.calls.every(call => call.operationId === operation)).toBe(true); expect(f.storage.size).toBe(0);
    } finally { f.close(); }
  });
  test('cancel pending preview ignores late result, sends no apply, and cannot populate a new review', async () => {
    const wait = deferred(), f = fixture({ delayPreview: wait.promise });
    try {
      const done = f.client.run(input).catch(error => error.code); await Bun.sleep(10); f.client.cancel();
      expect(await done).toBe('CANCELLED'); wait.resolve(); await Bun.sleep(20);
      expect(f.client.getSnapshot().phase).toBe('idle'); expect(f.calls.every(call => call.body?.phase === 'preview')).toBe(true);
    } finally { wait.resolve(); f.close(); }
  });
  test('lost preview ACK only reads original UUID before presenting confirmable receipt', async () => {
    const f = fixture({ lostPreview: true });
    try {
      const done = f.client.run(input).catch(error => error.code); await phase(f.client, 'confirming');
      expect(f.calls.map(call => call.method)).toEqual(['POST', 'GET']); expect(f.calls[1].operationId).toBe(operation);
      f.client.cancel(); expect(await done).toBe('CANCELLED');
    } finally { f.close(); }
  });
  test('lost apply ACK recovers committed audit using GET without replay', async () => {
    const f = fixture({ lostApply: true });
    try {
      const done = f.client.run(input); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect((await done).state).toBe('applied'); expect(f.calls.map(call => call.method)).toEqual(['POST', 'POST', 'GET']);
    } finally { f.close(); }
  });
  test('indeterminate apply forbids cancel/new UUID/apply; reload resumes only GET with no payload stored', async () => {
    const f = fixture({ lostApply: true, pendingGet: true });
    try {
      void f.client.run(input); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect(f.client.getSnapshot().phase).toBe('uncertain'); f.client.cancel(); expect(f.client.getSnapshot().phase).toBe('uncertain');
      await expect(f.client.run(input)).rejects.toThrow(); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
      const saved = [...f.storage.values()][0]; expect(saved).not.toContain('합성'); expect(Object.keys(JSON.parse(saved)).sort()).toEqual(['action', 'cleanupAttempt', 'cleanupDeferred', 'operationId', 'previewHash', 'targetIds']);
      let recovered: RecordActionReceipt | undefined; f.options.pendingGet = false;
      const restored = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: { getItem: () => saved, setItem: () => {}, removeItem: () => {} }, onRecovered: receipt => { recovered = receipt; } });
      await restored.recover(); expect(recovered?.auditId).toBe(audit); expect(f.calls.at(-1)?.method).toBe('GET');
      await f.client.readback(); expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
    } finally { f.close(); }
  });
  test('CAS conflict never reports success and cannot repeat apply under the old preview', async () => {
    const f = fixture({ conflict: true });
    try {
      const done = f.client.run(input).catch(error => error.code); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect(await done).toBe('RECORD_ACTION_STALE'); expect(f.client.getSnapshot().message).not.toContain('provider');
      await f.client.apply(RECORD_ACTION_CONFIRMATION); expect(f.calls).toHaveLength(2); expect(f.storage.size).toBe(0);
      f.client.cancel(); expect(f.client.getSnapshot().phase).toBe('idle');
    } finally { f.close(); }
  });
  test('apply in flight cannot be cancelled or sent twice', async () => {
    const wait = deferred(), f = fixture({ delayApply: wait.promise });
    try {
      const done = f.client.run(input); await phase(f.client, 'confirming'); const applying = f.client.apply(RECORD_ACTION_CONFIRMATION);
      f.client.cancel(); await f.client.apply(RECORD_ACTION_CONFIRMATION); expect(f.client.getSnapshot().phase).toBe('applying');
      wait.resolve(); await applying; await done; expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
    } finally { wait.resolve(); f.close(); }
  });
  test('mismatched ID/hash/targets/audit or malformed status stays uncertain, never healthy', async () => {
    for (const patch of [{ operationId: audit }, { targetIds: [audit] }, { auditId: audit }, { expiresAt: 'unknown' }, { readback: [{ id: target, kind: 'restaurant', status: 'new-state', fingerprint: 'b'.repeat(64) }] }]) {
      const f = fixture({ mutateReceipt: receipt => ({ ...receipt, ...patch }) });
      try { void f.client.run(input).catch(() => {}); await phase(f.client, 'uncertain'); expect(f.calls.map(call => call.method)).toEqual(['POST', 'GET']); f.client.cancel(); } finally { f.close(); }
    }
  });
  test('authentication failures use a bounded message without claiming an uncertain mutation or exposing prose', async () => {
    for (const denied of [401, 403]) {
      const f = fixture({ denied });
      try { await expect(f.client.run(input)).rejects.toThrow('관리자 권한'); expect(f.client.getSnapshot().phase).toBe('failed'); expect(f.client.getSnapshot().message).not.toContain('provider'); } finally { f.close(); }
    }
  });
  test('expired preview never applies; invalid UUID/fields fail before HTTP', async () => {
    const f = fixture({ mutateReceipt: receipt => ({ ...receipt, expiresAt: '2000-01-01T00:00:00Z' }) });
    try {
      await expect(f.client.run({ ...input, targetIds: ['fake-id'] })).rejects.toThrow(); expect(f.calls).toHaveLength(0);
      const done = f.client.run(input).catch(error => error.code); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect(await done).toBe('RECORD_ACTION_PREVIEW_EXPIRED'); expect(f.calls).toHaveLength(1);
    } finally { f.close(); }
  });
  test('review delete cleanup starts only after applied GET and uncertain cleanup never repeats', async () => {
    const f = fixture({ media: true });
    try {
      const done = f.client.run({ ...input, action: 'review.delete' }); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      const result = await done; expect(result.state).toBe('applied'); expect(result.mediaCleanupPending).toBe(true);
      expect(f.calls.map(call => `${call.method} ${call.path}`)).toEqual(['POST /api/admin/record-actions', 'POST /api/admin/record-actions', 'GET /api/admin/record-actions', 'POST /api/admin/record-actions/media-cleanup', 'GET /api/admin/record-actions']);
    } finally { f.close(); }
  });
});

test('apply invalidates before transport; STALE and failed readback cannot publish applied, then original GET recovers', async () => {
  for (const options of [{ conflict: true }, { lostApply: true, failedGet: true }]) {
    const f = fixture(options);
    try {
      const result = f.client.run(input).catch(error => error.code); await phase(f.client, 'confirming'); expect(f.events).toEqual([]);
      await f.client.apply(RECORD_ACTION_CONFIRMATION); expect(f.events[0]).toBe('invalidated'); expect(f.events).not.toContain('applied');
      expect(f.events.filter(value => value === 'invalidated')).toHaveLength(2);
      if (options.conflict) { expect(await result).toBe('RECORD_ACTION_STALE'); f.client.cancel(); }
      else { f.options.failedGet = false; await f.client.readback(); expect((await result).auditId).toBe(audit); expect(f.events.at(-1)).toBe('applied'); expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1); }
    } finally { f.close(); }
  }
});
test('created receipt contains every unique requested new row, bounded at 25, without rewriting original empty targets', async () => {
  const changes = { approved_name: '합성 맛집', categories: ['한식'], road_address: '합성로', lat: 37, lng: 127, geocoding_success: true, youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tzuyang_review: '합성 근거' };
  for (const size of [1, 3, 25]) {
    const ids = Array.from({ length: size }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    const f = fixture({ resultIds: ids });
    try {
      const create = { action: 'restaurant.create', targetIds: [], payload: { changes, additions: Array.from({ length: size - 1 }, () => ({ ...changes })) } } as RecordActionInput;
      const result = f.client.run(create); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect((await result).targetIds).toEqual(ids); expect(f.calls.filter(call => call.method === 'POST').every(call => call.body?.targetIds.length === 0)).toBe(true);
      expect(new Set(f.calls.map(call => call.operationId))).toEqual(new Set([operation]));
    } finally { f.close(); }
  }
  for (const ids of [[], [target, target], [target], Array.from({ length: 26 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)]) {
    const f = fixture({ resultIds: ids });
    try {
      void f.client.run({ action: 'restaurant.create', targetIds: [], payload: { changes: { ...changes, categories: ['한식'] }, additions: [{ ...changes, categories: ['한식'] }] } }); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect(f.client.getSnapshot().phase).toBe('uncertain'); expect(f.events).not.toContain('applied'); expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
    } finally { f.close(); }
  }
});
test('another modal cannot replace a stored pending identity or apply a pre-existing preview', async () => {
  const waiting = deferred(), f = fixture({ delayApply: waiting.promise });
  const storage = { getItem: (key: string) => f.storage.get(key) ?? null, setItem: (key: string, value: string) => { f.storage.set(key, value); }, removeItem: (key: string) => { f.storage.delete(key); } };
  const second = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage, uuid: () => audit });
  try {
    const one = f.client.run(input); await phase(f.client, 'confirming');
    const two = second.run(input).catch(error => error.code); await phase(second, 'confirming');
    const applying = f.client.apply(RECORD_ACTION_CONFIRMATION); await Bun.sleep(5); const saved = [...f.storage.values()][0];
    await second.apply(RECORD_ACTION_CONFIRMATION); expect(await two).toBe('RECORD_ACTION_PENDING'); expect([...f.storage.values()][0]).toBe(saved);
    expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
    f.options.mutateReceipt = receipt => ({ ...receipt, operationId: operation });
    waiting.resolve(); await applying; await one;
  } finally { waiting.resolve(); f.close(); }
});
test('a new client with pending storage only performs original-ID GET; malformed persisted identity stays closed', async () => {
  const f = fixture({ lostApply: true, failedGet: true });
  try {
    void f.client.run(input); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
    const saved = [...f.storage.values()][0], before = f.calls.length;
    const restored = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, uuid: () => audit, storage: { getItem: () => saved, setItem: () => { throw Error('must not replace'); }, removeItem: () => {} } });
    await expect(restored.run(input)).rejects.toThrow('이전 작업'); await phase(restored, 'uncertain');
    expect(f.calls.slice(before).map(call => [call.method, call.operationId])).toEqual([['GET', operation]]);
    for (const value of ['{}', 'not-json']) {
      let requests = 0, invalidations = 0;
      const corrupted = createRecordActionClient({ fetch: async () => { requests++; throw Error(); }, storage: { getItem: () => value, setItem: () => {}, removeItem: () => {} }, onInvalidate: () => { invalidations++; } });
      await corrupted.recover(); corrupted.cancel(); await expect(corrupted.run(input)).rejects.toThrow();
      expect(corrupted.getSnapshot().phase).toBe('uncertain'); expect(requests).toBe(0); expect(invalidations).toBeGreaterThan(0);
    }
  } finally { f.close(); }
});

test('revised duplicate-review and retired-media codes are definite bounded failures, never success or repeat apply', async () => {
  for (const code of ['RECORD_ACTION_DUPLICATE_REVIEW', 'RECORD_ACTION_MEDIA_RETIRED']) {
    const f = fixture({ fixedCode: code });
    try {
      const actionInput: RecordActionInput = code === 'RECORD_ACTION_DUPLICATE_REVIEW'
        ? { action: 'submission.approve', targetIds: [target], payload: { items: [{ id: audit, decision: 'approve', changes: { approved_name: '합성 맛집', categories: ['한식'], jibun_address: '서울 합성동', road_address: '서울 합성로', lat: 37.5, lng: 127, geocoding_success: true, youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tzuyang_review: '합성 영상 근거' } }] } }
        : { ...input, action: 'review.delete' };
      const result = f.client.run(actionInput).catch(error => error.code); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect(f.calls[1].body?.action).toBe(actionInput.action);
      expect(await result).toBe(code); expect(f.client.getSnapshot().phase).toBe('failed');
      expect(f.client.getSnapshot().nextAction).toBe(code === 'RECORD_ACTION_DUPLICATE_REVIEW' ? 'review-duplicates' : null); expect(f.client.getSnapshot().message).not.toContain('provider');
      await f.client.apply(RECORD_ACTION_CONFIRMATION); expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1); expect(f.events).not.toContain('applied');
    } finally { f.close(); }
  }
});

test('unmanaged media is not a pending job and never triggers cleanup by itself; both states can coexist', async () => {
  for (const pending of [false, true]) for (const unmanaged of [false, true]) {
    const f = fixture({ media: pending, mutateReceipt: receipt => ({ ...receipt, mediaCleanupUnmanaged: unmanaged }) });
    try {
      const done = f.client.run({ ...input, action: 'review.delete' }); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      const receipt = await done;
      expect(receipt).toMatchObject({ state: 'applied', mediaCleanupPending: pending, mediaCleanupUnmanaged: unmanaged });
      expect(f.calls.filter(call => call.path.endsWith('/media-cleanup'))).toHaveLength(pending ? 1 : 0);
      const notice = recordActionMediaNotice(receipt);
      expect(notice.includes('정리가 아직 완료되지')).toBe(pending); expect(notice.includes('삭제 대상에서 제외')).toBe(unmanaged);
      expect(f.events.at(-1)).toBe('applied'); expect(f.storage.size).toBe(pending ? 1 : 0);
      expect(recordActionMediaNotice({ ...receipt, action: 'restaurant.delete' })).toBe('');
    } finally { f.close(); }
  }
});


test('HTTP423 maintenance is a definite no-apply failure, never an uncertain operation or retry',async()=>{
 for(const heldPhase of ['preview','apply'] as const) {
  const f=fixture({maintenancePhase:heldPhase});
  try {
   const done=f.client.run(input).catch(error=>error.code);
   if(heldPhase==='apply') {await phase(f.client,'confirming');await f.client.apply(RECORD_ACTION_CONFIRMATION);}
   expect(await done).toBe('RECORD_ACTION_MAINTENANCE');
   expect(f.client.getSnapshot().phase).toBe('failed');
   expect(f.client.getSnapshot().message).toContain('일시 중지');
   expect(f.calls.map(call=>call.method)).toEqual(heldPhase==='preview'?['POST']:['POST','POST']);
   const calls=f.calls.length;await f.client.apply(RECORD_ACTION_CONFIRMATION);expect(f.calls).toHaveLength(calls);
   expect(f.events).not.toContain('applied');expect(f.storage.size).toBe(0);
  } finally {f.close();}
 }
});

const recoveryStorage = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
});

test('logout and actor change detach pending work; only its original actor recovers its UUID', async () => {
  const f = fixture({ lostApply: true, failedGet: true });
  try {
    const done = f.client.run(input).catch(error => error.code); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
    const saved = [...f.storage.entries()][0], before = f.calls.length;
    f.client.setActor(null); expect(await done).toBe('CANCELLED'); await f.client.recover(); await f.client.readback();
    await expect(f.client.run(input)).rejects.toThrow('관리자 권한'); expect(f.calls.length).toBe(before);
    f.client.setActor('opaque-b'); await f.client.recover(); expect(f.client.getSnapshot().phase).toBe('idle');
    const other = createRecordActionClient({ actor: 'opaque-b', fetch: f.transport, storage: recoveryStorage(f.storage), uuid: () => audit });
    const otherDone = other.run(input).catch(error => error.code); await phase(other, 'confirming'); other.cancel(); expect(await otherDone).toBe('CANCELLED');
    expect(f.storage.get(saved[0])).toBe(saved[1]);
    // Restore the fixture's committed original receipt without another apply.
    f.options.mutateReceipt = receipt => ({ ...receipt, operationId: operation, state: 'applied', auditId: audit, readback: [{ id: target, kind: 'restaurant', status: 'deleted', fingerprint: null }] });
    f.options.failedGet = false;
    f.client.setActor('opaque-a'); await f.client.recover();
    expect(f.calls.at(-1)?.operationId).toBe(operation); expect(f.storage.size).toBe(0);
    expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
  } finally { f.close(); }
});

test('actor switch during apply ignores late ACK and preserves original pending for reload', async () => {
  const wait = deferred(), f = fixture({ delayApply: wait.promise });
  try {
    const done = f.client.run(input).catch(error => error.code); await phase(f.client, 'confirming');
    const applying = f.client.apply(RECORD_ACTION_CONFIRMATION); await Bun.sleep(5);
    f.client.setActor('opaque-b'); expect(await done).toBe('CANCELLED'); wait.resolve(); await applying;
    expect(f.client.getSnapshot().phase).toBe('idle'); expect(f.events).not.toContain('applied'); expect(f.storage.size).toBe(1);
    const restored = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: recoveryStorage(f.storage) });
    await restored.recover(); expect(f.storage.size).toBe(0); expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
  } finally { wait.resolve(); f.close(); }
});

test('recovered unattempted cleanup starts once; lost ACK/pending GET survives stop and reload without replay', async () => {
  const f = fixture({ media: true, lostApply: true, failedGet: true });
  try {
    void f.client.run({ ...input, action: 'review.delete' }).catch(() => {}); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
    expect(JSON.parse([...f.storage.values()][0]).cleanupAttempt).toBe(false);
    f.client.setActor(null); f.options.failedGet = false;
    const restored = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: recoveryStorage(f.storage) });
    await restored.recover(); expect(f.calls.filter(call => call.path.endsWith('/media-cleanup'))).toHaveLength(1);
    expect(restored.getSnapshot().phase).toBe('uncertain'); expect(JSON.parse([...f.storage.values()][0]).cleanupAttempt).toBe(true);
    restored.cancel(); expect(restored.getSnapshot().phase).toBe('uncertain'); await restored.readback();
    restored.setActor(null);
    const reloaded = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: recoveryStorage(f.storage) });
    await reloaded.recover(); expect(f.calls.filter(call => call.path.endsWith('/media-cleanup'))).toHaveLength(1); expect(f.storage.size).toBe(1);
    f.options.mutateReceipt = receipt => ({ ...receipt, mediaCleanupPending: false }); await reloaded.readback();
    expect(reloaded.getSnapshot().phase).toBe('idle'); expect(f.storage.size).toBe(0);
    expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
  } finally { f.close(); }
});

test('unbound old v1 identity is retained on forbidden GET; pending cleanup never guesses an unattempted POST', async () => {
  const f = fixture({ media: true, lostApply: true, failedGet: true });
  try {
    void f.client.run({ ...input, action: 'review.delete' }).catch(() => {}); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
    const parsed = JSON.parse([...f.storage.values()][0]); delete parsed.cleanupAttempt;
    f.storage.clear(); const saved = JSON.stringify(parsed); f.storage.set('admin:record-action-pending:v1', saved);
    let gets = 0;
    const denied = createRecordActionClient({ actor: 'opaque-b', storage: recoveryStorage(f.storage), fetch: async (url, init) => {
      gets++; expect(init?.method).toBe('GET'); expect(String(url)).toContain(operation); return Response.json({}, { status: 403 });
    } });
    await denied.recover(); denied.cancel(); await expect(denied.run(input)).rejects.toThrow();
    expect(gets).toBe(1); expect(f.storage.get('admin:record-action-pending:v1')).toBe(saved);
    f.options.failedGet = false;
    const restored = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: recoveryStorage(f.storage) });
    await restored.recover(); expect(f.calls.filter(call => call.path.endsWith('/media-cleanup'))).toHaveLength(0); expect(f.storage.size).toBe(1);
    f.options.mutateReceipt = receipt => ({ ...receipt, mediaCleanupPending: false }); await restored.readback(); expect(f.storage.size).toBe(0);
  } finally { f.close(); }
});

test('two reload clients cannot each start the same unattempted cleanup', async () => {
  const f = fixture({ media: true, lostApply: true, failedGet: true });
  try {
    void f.client.run({ ...input, action: 'review.delete' }).catch(() => {}); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
    f.client.setActor(null); f.options.failedGet = false;
    const one = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: recoveryStorage(f.storage) });
    const two = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: recoveryStorage(f.storage) });
    await Promise.all([one.recover(), two.recover()]);
    expect(f.calls.filter(call => call.path.endsWith('/media-cleanup'))).toHaveLength(1); expect(f.storage.size).toBe(1);
    expect(one.getSnapshot().phase).toBe('uncertain'); expect(two.getSnapshot().phase).toBe('uncertain');
  } finally { f.close(); }
});

test('definite cleanup admission stops resume only on explicit recovery after hold release, preserving DB audit identity', async () => {
  for (const cleanupHold of ['maintenance', 'unadmitted'] as const) {
    const f = fixture({ media: true, cleanupHold, cleanupComplete: true });
    try {
      const result = f.client.run({ ...input, action: 'review.delete' }); await phase(f.client, 'confirming'); await f.client.apply(RECORD_ACTION_CONFIRMATION);
      expect((await result).auditId).toBe(audit); expect(f.client.getSnapshot().phase).toBe('uncertain');
      expect(JSON.parse([...f.storage.values()][0])).toMatchObject({ operationId: operation, cleanupAttempt: false, cleanupDeferred: true });
      expect(f.calls.filter(call => call.path.endsWith('/media-cleanup'))).toHaveLength(1);
      const before = f.calls.length; f.options.cleanupHold = undefined; f.client.setActor(null);
      const restored = createRecordActionClient({ actor: 'opaque-a', fetch: f.transport, storage: recoveryStorage(f.storage) });
      await restored.recover(); // Reload is a read-only observation, even after admission opens.
      expect(f.calls.slice(before).map(call => call.method)).toEqual(['GET']); expect(f.storage.size).toBe(1);
      const other = createRecordActionClient({ actor: 'opaque-b', fetch: f.transport, storage: recoveryStorage(f.storage) });
      await other.recover(); expect(other.getSnapshot().phase).toBe('idle'); expect(f.storage.size).toBe(1);
      await restored.readback(); // Operator's existing-result button explicitly resumes the same cleanup.
      expect(f.calls.slice(before).map(call => call.method)).toEqual(['GET', 'GET', 'POST', 'GET']);
      expect(f.calls.filter(call => call.path.endsWith('/media-cleanup'))).toHaveLength(2);
      expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
      expect(f.calls.every(call => call.operationId === operation)).toBe(true);
      expect(restored.getSnapshot().phase).toBe('idle'); expect(f.storage.size).toBe(0);
      expect(f.events.filter(event => event === 'applied')).toHaveLength(1);
    } finally { f.close(); }
  }
});

test('403, timeout, malformed admission status and unknown cleanup ACK never become resumable', async () => {
  for (const failure of ['forbidden', 'timeout', 'wrong-status', 'unknown'] as const) {
    const f = fixture({ media: true });
    const fetchCleanup: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/media-cleanup')) {
        if (failure === 'timeout') throw new DOMException('synthetic timeout', 'TimeoutError');
        if (failure === 'forbidden') return Response.json({ success: false, code: 'RECORD_ACTION_FORBIDDEN' }, { status: 403 });
        if (failure === 'wrong-status') return Response.json({ success: false, code: 'RECORD_ACTION_MAINTENANCE' }, { status: 409 });
      }
      return f.transport(url, init);
    };
    let cleanupRequests = 0;
    const tracked: typeof fetch = (url, init) => { if (String(url).endsWith('/media-cleanup')) cleanupRequests++; return fetchCleanup(url, init); };
    const client = createRecordActionClient({ actor: 'opaque-a', fetch: tracked, storage: recoveryStorage(f.storage), uuid: () => operation });
    try {
      const result = client.run({ ...input, action: 'review.delete' }); await phase(client, 'confirming'); await client.apply(RECORD_ACTION_CONFIRMATION); await result;
      expect(JSON.parse([...f.storage.values()][0])).toMatchObject({ cleanupAttempt: true, cleanupDeferred: false });
      await client.readback(); const restored = createRecordActionClient({ actor: 'opaque-a', fetch: tracked, storage: recoveryStorage(f.storage) });
      await restored.recover(); await restored.readback(); expect(cleanupRequests).toBe(1); expect(f.storage.size).toBe(1);
      expect(f.calls.filter(call => call.body?.phase === 'apply')).toHaveLength(1);
    } finally { f.close(); }
  }
});
