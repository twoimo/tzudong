import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { GenerateContentResponse } from '@google/genai';
import sharp from 'sharp';
import { GeminiThumbnailWorkerClient } from '../../lib/admin/youtube-thumbnail-generator/gemini-worker-client';
import { ThumbnailPrivateStore, type ThumbnailDatabase, type ThumbnailStorage } from '../../lib/admin/youtube-thumbnail-generator/private-store';
import { createThumbnailQueueApi } from '../../lib/admin/youtube-thumbnail-generator/queue-api';
import { parseThumbnail, thumbnailJob, thumbnailStartReceipt } from '../../lib/admin/youtube-thumbnail-generator/queue-contract';
import { OutboundThumbnailWorker, ThumbnailWorkerTransport } from '../../lib/admin/youtube-thumbnail-generator/outbound-worker';
import { ThumbnailWorkerOutbox } from '../../lib/admin/youtube-thumbnail-generator/worker-outbox';
import { GeminiThumbnailChatWorkerClient } from '../../lib/admin/youtube-thumbnail-generator/chat-gemini-client';
import { ThumbnailChatBrowserQueue } from '../../lib/admin/youtube-thumbnail-generator/chat-browser-queue';
import { ThumbnailBrowserQueue } from '../../lib/admin/youtube-thumbnail-generator/browser-queue';

// Actual route handlers + store + PG + Gemini client; synthetic HTTP Storage and provider, egress denied except owned PG.
const mode = process.argv[2]; const owner = process.env.FIXTURE_OWNER_ID!;
const quoted = (value: unknown) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
function sql(source: string) {
  const child = spawnSync(process.env.FIXTURE_PSQL!, ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', process.env.FIXTURE_PG_PORT!, '-U', 'postgres', '-d', 'postgres'], {
    input: source, encoding: 'utf8', timeout: 8000,
  });
  if (child.status !== 0) throw new Error('synthetic fixture SQL rejection');
  return child.stdout.trim() ? JSON.parse(child.stdout.trim()) : null;
}
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
sql(`UPDATE public.admin_thumbnail_workers SET token_sha256=${quoted(tokenHash)} WHERE token_sha256=${quoted(process.env.FIXTURE_TOKEN_0)};`);
let enqueueCalls = 0; let completeCalls = 0; let startCalls = 0; let sdkCalls = 0;
const rpcTypes: Record<string, string> = { p_owner_id: 'uuid', p_action: 'text', p_job_id: 'uuid', p_request_id: 'uuid',
  p_input_sha256: 'text', p_model: 'text', p_input: 'jsonb', p_token_sha256: 'text', p_attempt_id: 'uuid', p_fence: 'bigint', p_payload: 'jsonb' };
const database: ThumbnailDatabase = { rpc: async (name, args) => {
  assert.ok(['thumbnail_production_admin', 'thumbnail_production_auth_worker', 'thumbnail_production_worker'].includes(name));
  const params = Object.entries(args).map(([key, value]) => {
    assert.ok(Object.hasOwn(rpcTypes, key));
    return `${key}=>${quoted(rpcTypes[key] === 'jsonb' && value !== null ? JSON.stringify(value) : value)}::${rpcTypes[key]}`;
  });
  const data = sql(`SET ROLE service_role; SELECT public.${name}(${params.join(',')});`);
  if (args.p_action === 'enqueue') { enqueueCalls++; throw new Error('synthetic enqueue committed ACK loss'); }
  if (args.p_action === 'complete') {
    completeCalls++; if (mode === 'checkpoint-ack-lost') throw new Error('synthetic completion committed ACK loss');
  }
  if (args.p_action === 'start') {
    startCalls++; if (mode === 'start-ack-lost' || mode === 'outbound-start-ack-lost' || mode === 'chat-start-ack-lost') throw new Error('synthetic start committed ACK loss');
  }
  return { data, error: null };
} };
const objects = new Map<string, Buffer>(); const uploaded: string[] = [];
let failedNormalized = false;
const storage: ThumbnailStorage = {
  read: async (path, maxBytes) => {
    const bytes = objects.get(path); assert.ok(!bytes || bytes.length <= maxBytes); return bytes ? Buffer.from(bytes) : null;
  },
  upload: async (path, bytes) => {
    uploaded.push(path); assert.ok(!objects.has(path));
    if (mode === 'normalize-recovery' && path.endsWith('normalized.png') && !failedNormalized) {
      failedNormalized = true; throw new Error('synthetic derivative upload loss before commit');
    }
    objects.set(path, Buffer.from(bytes));
    if (path.endsWith('original.png')) throw new Error('synthetic original committed ACK loss');
  },
};
const store = new ThumbnailPrivateStore(database, storage);
const api = createThumbnailQueueApi({ store, authorize: async () => ({ ok: true, userId: owner }) });
const origin = 'http://127.0.0.1:3000'; const base = `${origin}/api/admin/youtube-thumbnail-generator`;
const image = await sharp({ create: { width: 512, height: 288, channels: 3, background: '#b67821' } }).png().toBuffer();
if (mode.startsWith('chat-')) {
  const receipts = new Map<string, string>(); let posts = 0, deliveryLost = mode === 'chat-delivery-lost';
  const directory = mkdtempSync('/private/tmp/thumbnail-chat-pg17-'); chmodSync(directory, 0o700);
  const box = new ThumbnailWorkerOutbox(directory), stop = new AbortController();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/worker/chat')) {
      if (request.method === 'GET') return api.workerChatGET(request);
      const response = await api.workerChatPOST(request);
      if (deliveryLost) { assert.equal(response.status, 200); return new Response(null, { status: 503 }); }
      return response;
    }
    if (path.endsWith('/worker')) return api.workerPOST(request);
    if (path.endsWith('/chat/jobs')) {
      if (request.method === 'GET') return api.chatListGET(request);
      posts++; return api.chatListPOST(request);
    }
    const context = { params: Promise.resolve({ jobId: path.split('/').at(-1)! }) };
    return request.method === 'GET' ? api.chatJobGET(request, context) : api.chatJobPOST(request, context);
  } });
  try {
    const workerOrigin = `http://127.0.0.1:${server.port}`;
    const options = { ownerId: owner, admission: async <T>(work: () => Promise<T>) => work(), storage: {
      getItem: (key: string) => receipts.get(key) ?? null, setItem: (key: string, value: string) => { receipts.set(key, value); },
      removeItem: (key: string) => { receipts.delete(key); } }, fetch: (async (path, init) => fetch(`${workerOrigin}${path}`, { ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), ...(init?.method === 'POST' ? { Origin: workerOrigin } : {}) } })) as typeof fetch };
    const browser = new ThumbnailChatBrowserQueue(options);
    await browser.enqueue({ message: '메인 문구를 간결하게 다듬어줘', chatRunId: 'run-pg', chatThreadId: 'thread-pg', currentHeadline: '기존 문구' }, 3);
    const client = new GeminiThumbnailChatWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
      get: async ({ model }) => ({ name: `models/${model}` }), generateContent: async () => {
        sdkCalls++; const value = new GenerateContentResponse(); value.modelVersion = 'gemini-3.8-flash'; value.responseId = 'synthetic-pg-chat';
        value.candidates = [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify({
          assistantMessage: '주요 문구를 간결하게 정리했어요.', intent: 'edit', canvasPatch: { topic: '', headline: '간결한 문구', subHeadline: '' },
          textLayerPatches: [], shouldGenerate: false, shouldReset: false }) }] } }];
        if (mode === 'chat-stop-received') stop.abort(); return value;
      },
    } } });
    const providerUnavailable = () => { throw new Error('provider unavailable during recovery'); };
    const worker = new OutboundThumbnailWorker({ api: new ThumbnailWorkerTransport({ origin: workerOrigin, token }), outbox: box,
      gemini: { models: async () => [], prepareStored: async () => { throw new Error('image SDK forbidden'); } }, chatGemini: client });
    const first = await worker.runOnce(stop.signal);
    if (mode === 'chat-start-ack-lost') {
      assert.equal(first, 'held'); assert.equal(sdkCalls, 0); assert.equal(box.pending()[0].phase, 'start_requested');
      assert.equal(await worker.runOnce(), 'held');
    } else {
      if (mode !== 'chat-normal') {
        assert.equal(first, 'held'); assert.equal(box.pending()[0].phase, 'result_saved'); deliveryLost = false;
        box.close(); const reopened = new ThumbnailWorkerOutbox(directory);
        try { assert.equal(await new OutboundThumbnailWorker({ api: new ThumbnailWorkerTransport({ origin: workerOrigin, token }),
          outbox: reopened, gemini: providerUnavailable, chatGemini: providerUnavailable }).runOnce(), 'succeeded'); }
        finally { reopened.close(); }
      } else assert.equal(first, 'succeeded');
      const result = await browser.resume(); assert.equal(result!.state, 'succeeded');
      assert.equal((await browser.output(result!.id)).response.canvasPatch.headline, '간결한 문구');
      assert.ok(browser.consume(result!.id, 3, 'thread-pg', 'run-pg'));
      assert.equal(browser.consume(result!.id, 3, 'thread-pg', 'run-pg'), null);
      const restored = new ThumbnailChatBrowserQueue(options); await restored.resume();
      assert.equal(restored.consume(result!.id, 3, 'thread-pg', 'run-pg'), null);
      assert.equal(sdkCalls, 1);
    }
    assert.equal(posts, 1); assert.equal(enqueueCalls, 1); assert.equal(startCalls, 1);
    process.stdout.write(JSON.stringify({ mode, actualApiHandlers: true, realPostgres: true, inputBound: true, actualHttp: true,
      sdkCalls, startCalls, enqueueCalls, completeCalls, browserPosts: posts, externalProviderCalls: 0, storageSynthetic: true }) + '\n');
  } finally { box.close(); await server.stop(true); rmSync(directory, { recursive: true, force: true }); }
  process.exit(0);
} else if (mode.startsWith('browser-')) {
  const receipts = new Map<string, string>(); let browserPosts = 0, cancelPosts = 0;
  const directory = mkdtempSync('/private/tmp/thumbnail-browser-pg17-'); chmodSync(directory, 0o700);
  const box = new ThumbnailWorkerOutbox(directory);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path.endsWith('/worker/references')) return api.workerReferenceGET(request);
    if (path.endsWith('/worker/images')) return api.workerImagePOST(request);
    if (path.endsWith('/worker')) return api.workerPOST(request);
    if (path.endsWith('/jobs')) {
      if (request.method === 'GET') return api.listGET(request);
      browserPosts++; const response = await api.listPOST(request);
      if (mode === 'browser-ack-lost' && browserPosts === 1) {
        assert.equal(response.status, 200); return Response.json({ ok: false, error: 'write_unconfirmed' }, { status: 503 });
      }
      return response;
    }
    const context = { params: Promise.resolve({ jobId: path.slice(path.lastIndexOf('/') + 1) }) };
    if (request.method === 'GET') return api.jobGET(request, context);
    cancelPosts++; const response = await api.jobPOST(request, context);
    if (mode === 'browser-cancel-lost') {
      assert.equal(response.status, 200); return Response.json({ ok: false, error: 'write_unconfirmed' }, { status: 503 });
    }
    return response;
  } });
  try {
    const workerOrigin = `http://127.0.0.1:${server.port}`;
    const options = { ownerId: owner, admission: async <T>(work: () => Promise<T>) => work(), storage: { getItem: (key: string) => receipts.get(key) ?? null,
      setItem: (key: string, value: string) => { receipts.set(key, value); }, removeItem: (key: string) => { receipts.delete(key); } },
    // Node/Bun fetch has no document origin; this adapter supplies the browser's real same-origin POST header.
    fetch: (async (path, init) => fetch(`${workerOrigin}${path}`, { ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), ...(init?.method === 'POST' ? { Origin: workerOrigin } : {}) } })) as typeof fetch };
    let browser = new ThumbnailBrowserQueue(options);
    const requestId = randomUUID();
    const submitted = browser.enqueue({ model: 'gemini-3.1-flash-image',
      brief: { topic: '맛있는 한 상', headline: '따뜻한 한 끼', stylePreset: 'grilled-meat-feast', acknowledgedSafety: true },
      references: [{ role: 'food', file: new File([new Uint8Array(image)], 'food.png', { type: 'image/png' }) }] }, 7, requestId);
    if (mode === 'browser-ack-lost') {
      await assert.rejects(submitted, /unconfirmed/); browser = new ThumbnailBrowserQueue(options);
    } else await submitted;
    const queued = await browser.resume(); assert.ok(queued); assert.equal(queued.requestId, requestId);
    await assert.rejects(browser.enqueue({ model: 'gemini-3.1-flash-image', brief: { topic: 'Other', headline: 'Other',
      stylePreset: 'grilled-meat-feast', acknowledgedSafety: true }, references: [] }, 8), /unresolved_request/);
    if (mode === 'browser-cancel-lost') { await assert.rejects(browser.cancel(), /unconfirmed/); await browser.resume(); }
    const gemini = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => work(), client: { models: {
      get: async ({ model }) => ({ name: `models/${model}` }), generateContent: async () => {
        sdkCalls++; const response = new GenerateContentResponse(); response.modelVersion = queued.model; response.responseId = 'synthetic-browser-pg17';
        response.candidates = [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] } }]; return response;
      },
    } } });
    const result = await new OutboundThumbnailWorker({ api: new ThumbnailWorkerTransport({ origin: workerOrigin, token }), outbox: box, gemini }).runOnce();
    const current = await browser.resume(); assert.ok(current);
    const cancelled = mode === 'browser-cancel-lost'; assert.equal(result, cancelled ? 'idle' : 'succeeded');
    assert.equal(current.state, cancelled ? 'cancelled' : 'succeeded'); assert.equal(browserPosts, 1); assert.equal(enqueueCalls, 1);
    assert.equal(sdkCalls, cancelled ? 0 : 1); assert.equal(startCalls, cancelled ? 0 : 1); assert.equal(cancelPosts, cancelled ? 1 : 0);
    assert.equal(browser.canAutoApply(queued.id, 7), mode === 'browser-normal');
    if (!cancelled) {
      assert.equal(browser.canAutoApply(queued.id, 8), false);
      const restored = new ThumbnailBrowserQueue(options); await restored.resume(); assert.equal(restored.canAutoApply(queued.id, 7), false);
      const original = await options.fetch(browser.resultUrls(current).original);
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), image);
    }
    assert.equal((await browser.history()).length, 1);
    process.stdout.write(JSON.stringify({ mode, realPostgres: true, actualApiHandlers: true, realOutboundHttp: true,
      actualBrowserProtocolClient: true, renderedBrowser: false, admissionSynthetic: true, durableSqlite: true, inputBound: true,
      browserPosts, cancelPosts, sdkCalls, startCalls, enqueueCalls, completeCalls, completed: !cancelled,
      storageSynthetic: true, externalProviderCalls: 0 }) + '\n');
  } finally { await server.stop(true); box.close(); rmSync(directory, { recursive: true, force: true }); }
  process.exit(0);
}
const form = new FormData(); const requestId = randomUUID();
form.set('request', JSON.stringify({ requestId, model: 'gemini-3.1-flash-image', roles: ['food'],
  brief: { topic: '맛있는 한 상', headline: '따뜻한 한 끼', stylePreset: 'grilled-meat-feast', acknowledgedSafety: true } }));
form.set('reference0', new File([new Uint8Array(image)], 'food.png', { type: 'image/png' }));
const enqueued = await api.listPOST(new Request(`${base}/jobs`, { method: 'POST', headers: { Origin: origin }, body: form }));
assert.equal(enqueued.status, 200); const queued = parseThumbnail(thumbnailJob, (await enqueued.json()).job);
assert.equal(queued.requestId, requestId); assert.equal(enqueueCalls, 1);
if (mode.startsWith('outbound-')) {
  const directory = mkdtempSync('/private/tmp/thumbnail-outbound-pg17-'); chmodSync(directory, 0o700);
  let box = new ThumbnailWorkerOutbox(directory); let uploadsLost = 0; let metadataCalls = 0;
  const stop = new AbortController();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/references')) return await api.workerReferenceGET(request);
    if (path.endsWith('/images')) {
      const response = await api.workerImagePOST(request);
      if (['outbound-delivery-lost', 'outbound-priority-recovery'].includes(mode) && uploadsLost++ === 0) {
        assert.equal(response.status, 200); return Response.json({ error: 'synthetic committed reply lost' }, { status: 503 });
      }
      return response;
    }
    return await api.workerPOST(request);
  } });
  try {
    const transport = new ThumbnailWorkerTransport({ origin: `http://127.0.0.1:${server.port}`, token });
    const older = mode === 'outbound-priority-recovery'
      ? sql(`SET ROLE service_role; SELECT public.thumbnail_production_worker(${quoted(tokenHash)},'claim');`) : null;
    if (older) sql(`UPDATE public.admin_thumbnail_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${quoted(older.id)};`);
    let release: (() => void) | undefined; let entered: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gemini = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
      get: async ({ model }) => {
        if (older && metadataCalls === 0) box.begin({ providerId: 'gemini-api', model: older.model, ownerId: older.ownerId,
          workerId: older.workerId, jobId: older.id, attemptId: older.attemptId, fence: older.fence,
          inputSha256: older.inputSha256, origin: transport.origin });
        metadataCalls++; return { name: `models/${model}` };
      },
      generateContent: async (params) => {
        sdkCalls++;
        if (mode === 'outbound-concurrent-observer') await new Promise<void>((resolve, reject) => {
          const signal = params.config?.abortSignal;
          const abort = () => reject(new Error('synthetic active SDK aborted'));
          signal?.addEventListener('abort', abort, { once: true });
          release = () => { signal?.removeEventListener('abort', abort); resolve(); }; entered!();
        });
        if (mode === 'outbound-response-lost') throw new Error('synthetic paid response loss');
        if (mode === 'outbound-stop-received') stop.abort();
        const response = new GenerateContentResponse(); response.modelVersion = queued.model; response.responseId = 'synthetic-outbound-pg17';
        response.candidates = [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] } }]; return response;
      },
    } } });
    const worker = new OutboundThumbnailWorker({ api: transport, outbox: box, gemini });
    const running = worker.runOnce(stop.signal);
    if (mode === 'outbound-concurrent-observer') {
      try {
        await waiting; assert.equal(await new OutboundThumbnailWorker({ api: transport, outbox: box, gemini }).runOnce(), 'held');
      } finally { release?.(); }
    }
    const first = await running;
    assert.equal(first, ['outbound-normal', 'outbound-concurrent-observer'].includes(mode) ? 'succeeded' : 'held');
    box.close(); box = new ThumbnailWorkerOutbox(directory);
    const second = await new OutboundThumbnailWorker({ api: transport, outbox: box, gemini }).runOnce();
    const unknown = ['outbound-start-ack-lost', 'outbound-response-lost'].includes(mode);
    assert.equal(second, unknown ? 'held' : ['outbound-normal', 'outbound-concurrent-observer'].includes(mode) ? 'idle' : 'succeeded');
    assert.equal(sdkCalls, mode === 'outbound-start-ack-lost' || mode === 'chat-start-ack-lost' ? 0 : 1); assert.equal(startCalls, 1);
    assert.equal(metadataCalls, 2); assert.equal(box.pending().length, unknown || mode === 'outbound-priority-recovery' ? 1 : 0);
    const current = await store.get(owner, queued.id); assert.equal(current.state, unknown ? 'unknown' : 'succeeded');
    if (!unknown) assert.deepEqual((await store.resultImage(owner, queued.id, 'original')).bytes, image);
    process.stdout.write(JSON.stringify({ mode, realPostgres: true, actualApiHandlers: true, realOutboundHttp: true,
      durableSqlite: true, inputBound: true, sdkCalls, startCalls, enqueueCalls, completeCalls,
      completed: !unknown, storageSynthetic: true, externalProviderCalls: 0 }) + '\n');
  } finally { await server.stop(true); box.close(); rmSync(directory, { recursive: true, force: true }); }
} else {
async function operation(payload: unknown) {
  return await api.workerPOST(new Request(`${base}/worker`, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(payload) }));
}
const claim = await operation({ action: 'claim' }); assert.equal(claim.status, 200);
const job = parseThumbnail(thumbnailJob, (await claim.json()).result);
const attempt = { jobId: job.id, attemptId: job.attemptId!, fence: job.fence, inputSha256: job.inputSha256 };
const referenceResponse = await api.workerReferenceGET(new Request(`${base}/worker/references?${new URLSearchParams({
  ...attempt, fence: String(attempt.fence), index: '0',
})}`, { headers: { Authorization: `Bearer ${token}` } }));
assert.equal(referenceResponse.status, 200);
const reference = new Uint8Array(await referenceResponse.arrayBuffer());
const client = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
  generateContent: async () => {
    sdkCalls++; const response = new GenerateContentResponse(); response.modelVersion = job.model;
    response.responseId = 'synthetic-pg-private-store'; response.candidates = [{ content: { parts: [{ inlineData: {
      mimeType: 'image/png', data: image.toString('base64'),
    } }] } }]; return response;
  },
} } });
const prepared = await client.prepare({ ownerId: owner, jobId: job.id, attemptId: job.attemptId!, fence: job.fence,
  model: job.model, prompt: job.input.prompt, references: [{ bytes: reference, mimeType: 'image/png', role: 'food' }] });
assert.equal(prepared.descriptor.inputSha256, job.inputSha256);
let completed = false;
if (mode === 'start-ack-lost') {
  await assert.rejects(prepared.run(async () => {
    const response = await operation({ action: 'start', ...attempt }); assert.equal(response.status, 503);
    throw new Error('synthetic start permission unavailable');
  }), { code: 'start_not_confirmed' });
  assert.equal(sdkCalls, 0);
  assert.equal((await operation({ action: 'unknown', ...attempt })).status, 200);
  const next = await operation({ action: 'claim' }); assert.equal((await next.json()).result, null);
} else {
  const result = await prepared.run(async () => {
    const response = await operation({ action: 'start', ...attempt }); assert.equal(response.status, 200);
    return parseThumbnail(thumbnailStartReceipt, (await response.json()).result);
  });
  const output = new FormData(); output.set('attempt', JSON.stringify(attempt)); output.set('provenance', JSON.stringify(result.provenance));
  output.set('original', new File([new Uint8Array(result.original.bytes)], 'original.png', { type: result.original.mimeType }));
  let response = await api.workerImagePOST(new Request(`${base}/worker/images`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: output }));
  if (mode === 'normalize-recovery') {
    assert.equal(response.status, 503); assert.equal(completeCalls, 0);
    response = await operation({ action: 'recover', ...attempt });
  }
  assert.equal(response.status, 200); const finished = parseThumbnail(thumbnailJob, (await response.json()).job);
  assert.equal(finished.state, 'succeeded'); assert.equal(completeCalls, 1); assert.equal(sdkCalls, 1);
  const readback = await api.jobGET(new Request(`${base}/jobs/${job.id}?variant=original`), { params: Promise.resolve({ jobId: job.id }) });
  assert.equal(readback.status, 200); assert.deepEqual(Buffer.from(await readback.arrayBuffer()), image);
  assert.equal(uploaded.filter((path) => path.endsWith('original.png')).length, 1); completed = true;
}
assert.equal(startCalls, 1);
process.stdout.write(JSON.stringify({ mode, realPostgres: true, actualApiHandlers: true, inputBound: true,
  sdkCalls, startCalls, enqueueCalls, completeCalls, completed, storageSynthetic: true, externalProviderCalls: 0 }) + '\n');
}
