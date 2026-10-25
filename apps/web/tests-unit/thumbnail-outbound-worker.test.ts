import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GenerateContentResponse } from '@google/genai';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { GeminiThumbnailWorkerClient, prepareThumbnailGeminiContent } from '../lib/admin/youtube-thumbnail-generator/gemini-worker-client';
import { ThumbnailWorkerOutbox, ThumbnailOutboxError } from '../lib/admin/youtube-thumbnail-generator/worker-outbox';
import { OutboundThumbnailWorker, ThumbnailWorkerTransport, readThumbnailWorkerFile, type ThumbnailWorkerApi } from '../lib/admin/youtube-thumbnail-generator/outbound-worker';
import { thumbnailJob, type ThumbnailJob } from '../lib/admin/youtube-thumbnail-generator/queue-contract';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'thumbnail-outbound-test-')); chmodSync(directory, 0o700);
  const outbox = new ThumbnailWorkerOutbox(directory); const stop = new AbortController();
  const content = { model: 'gemini-3.1-flash-image' as const, prompt: 'Food-only thumbnail fixture.', references: [] };
  const prepared = await prepareThumbnailGeminiContent(content); const now = new Date().toISOString();
  let job: ThumbnailJob = thumbnailJob.parse({ id: randomUUID(), ownerId: randomUUID(), workerId: randomUUID(), requestId: randomUUID(),
    attemptId: randomUUID(), fence: 1, model: content.model, inputSha256: prepared.inputSha256,
    input: { contract: 'thumbnail-gemini-image-v1', ...content }, state: 'claimed', cancelRequested: false,
    createdAt: now, updatedAt: now, leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(), providerStartedAt: null, result: null });
  const image = await sharp({ create: { width: 512, height: 288, channels: 3, background: '#df9821' } }).png().toBuffer();
  const calls = { models: 0, sdk: 0, start: 0, claim: 0, image: 0, heartbeat: 0, unknown: 0 };
  let sdkMode: 'success' | 'lost' | 'stop-received' = 'success';
  let startMode: 'success' | 'lost' | 'stop-after-receipt' = 'success';
  let deliveryMode: 'success' | 'lost-before' | 'lost-after' = 'success';
  let claimed = false; let generateGate: ((signal?: AbortSignal) => Promise<void>) | undefined;
  const gemini = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
    get: async ({ model }) => { calls.models++; return { name: `models/${model}` }; },
    generateContent: async (params) => {
      calls.sdk++; if (generateGate) await generateGate(params.config?.abortSignal);
      if (sdkMode === 'lost') throw new Error('synthetic provider response lost');
      if (sdkMode === 'stop-received') stop.abort();
      const response = new GenerateContentResponse(); response.modelVersion = content.model;
      response.responseId = 'synthetic-outbound-response'; response.candidates = [{ content: { parts: [{ inlineData: {
        mimeType: 'image/png', data: image.toString('base64'),
      } }] } }]; return response;
    },
  } } });
  const api: ThumbnailWorkerApi = { origin: 'https://www.tzudong.app',
    operation: async (op) => {
      if (op.action === 'models') return { result: { models: op.models } };
      if (op.action === 'claim') { calls.claim++; if (claimed) return { result: null }; claimed = true; return { result: structuredClone(job) }; }
      if (op.action === 'start') {
        calls.start++; if (job.state !== 'claimed') throw new Error('synthetic rejected repeat start');
        job = { ...job, state: 'provider_started', providerStartedAt: now };
        if (startMode === 'lost') throw new Error('synthetic start ACK loss');
        if (startMode === 'stop-after-receipt') stop.abort();
        return { result: { providerId: 'gemini-api', model: job.model, ownerId: job.ownerId, jobId: job.id,
          attemptId: job.attemptId, fence: job.fence, inputSha256: job.inputSha256, state: 'provider_started', permission: 'fresh-commit' } };
      }
      if (op.action === 'heartbeat') { calls.heartbeat++; return { result: structuredClone(job) }; }
      if (op.action === 'unknown') {
        calls.unknown++; if (job.state === 'provider_started') job = { ...job, state: 'unknown', leaseExpiresAt: null };
        return { result: structuredClone(job) };
      }
      throw new Error('synthetic unsupported operation');
    },
    reference: async () => { throw new Error('fixture has no references'); },
    image: async (_attempt, result) => {
      calls.image++;
      if (deliveryMode === 'lost-before') throw new Error('synthetic upload loss');
      const prefix = `${job.ownerId}/${job.id}/${job.attemptId}/`;
      const normalized = await sharp(result.bytes).rotate().resize(1280, 720, { fit: 'cover' }).png().toBuffer();
      job = thumbnailJob.parse({ ...job, state: 'succeeded', leaseExpiresAt: null,
        result: { original: { ...result.original, path: `${prefix}original.png` }, normalized: { path: `${prefix}normalized.png`,
          sha256: sha(normalized), mimeType: 'image/png', bytes: normalized.length, width: 1280, height: 720 }, provenance: result.provenance } });
      if (deliveryMode === 'lost-after') throw new Error('synthetic complete ACK loss');
      return { job: structuredClone(job) };
    },
  };
  const worker = () => new OutboundThumbnailWorker({ api, outbox, gemini, heartbeatMs: 5 });
  return { directory, outbox, stop, calls, api, gemini, worker,
    get job() { return job; }, set job(value: ThumbnailJob) { job = value; },
    set sdkMode(value: typeof sdkMode) { sdkMode = value; }, set startMode(value: typeof startMode) { startMode = value; },
    set deliveryMode(value: typeof deliveryMode) { deliveryMode = value; },
    set generateGate(value: ((signal?: AbortSignal) => Promise<void>) | undefined) { generateGate = value; },
    cleanup: () => { outbox.close(); rmSync(directory, { recursive: true, force: true }); } };
}

describe('Gemini thumbnail outbound worker', () => {
  test('normal claim -> fresh start -> one SDK -> durable bundle -> exact completion', async () => {
    const f = await fixture();
    try {
      expect(await f.worker().runOnce()).toBe('succeeded'); expect(f.calls.sdk).toBe(1); expect(f.calls.start).toBe(1);
      expect(f.outbox.pending()).toHaveLength(0); expect(f.job.state).toBe('succeeded');
      expect(await f.worker().runOnce()).toBe('idle'); expect(f.calls.sdk).toBe(1); expect(f.calls.models).toBe(2);
    } finally { f.cleanup(); }
  });
  for (const mode of ['lost-before', 'lost-after'] as const) test(`delivery ${mode} recovers original bundle after restart without model/catalog/SDK work`, async () => {
    const f = await fixture();
    try {
      f.deliveryMode = mode; expect(await f.worker().runOnce()).toBe('held');
      expect(f.outbox.pending()[0].phase).toBe('result_saved'); expect(f.calls.sdk).toBe(1);
      const models = f.calls.models; const starts = f.calls.start; f.deliveryMode = 'success';
      f.outbox.close(); const reopened = new ThumbnailWorkerOutbox(f.directory);
      try {
        expect(await new OutboundThumbnailWorker({ api: f.api, outbox: reopened, gemini: () => { throw new Error('provider key not available during recovery'); } }).runOnce()).toBe('succeeded');
        expect(f.calls.models).toBe(models); expect(f.calls.start).toBe(starts); expect(f.calls.sdk).toBe(1);
      } finally { reopened.close(); }
    } finally { f.cleanup(); }
  });
  for (const mode of ['lost', 'stop-after-receipt'] as const) test(`start ${mode} retains tombstone even when SDK outcome says not_started`, async () => {
    const f = await fixture();
    try {
      f.startMode = mode; expect(await f.worker().runOnce(f.stop.signal)).toBe('held');
      expect(f.calls.sdk).toBe(0); expect(f.outbox.pending()[0].phase).toBe('start_requested');
      expect(await f.worker().runOnce()).toBe('held'); expect(f.calls.start).toBe(1); expect(f.calls.sdk).toBe(0); expect(f.calls.claim).toBe(1);
    } finally { f.cleanup(); }
  });
  test('provider response loss remains unknown across worker restart, with one paid attempt', async () => {
    const f = await fixture();
    try {
      f.sdkMode = 'lost'; expect(await f.worker().runOnce()).toBe('held'); expect(f.calls.sdk).toBe(1); expect(f.job.state).toBe('unknown');
      expect(await f.worker().runOnce()).toBe('held'); expect(f.calls.sdk).toBe(1); expect(f.calls.start).toBe(1); expect(f.calls.claim).toBe(1);
    } finally { f.cleanup(); }
  });
  test('a second process observing a live intent cannot abort the active paid request', async () => {
    const f = await fixture(); let release: (() => void) | undefined; let entered: (() => void) | undefined; let aborted = false;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    f.generateGate = (signal) => new Promise<void>((resolve, reject) => {
      const abort = () => { aborted = true; reject(new Error('synthetic SDK abort')); };
      release = () => { signal?.removeEventListener('abort', abort); resolve(); };
      entered!(); signal?.addEventListener('abort', abort, { once: true });
    });
    const active = f.worker().runOnce();
    try {
      await ready; expect(await f.worker().runOnce()).toBe('held'); await delay(20);
      release!(); const result = await active;
      expect(aborted).toBe(false); expect(result).toBe('succeeded'); expect(f.calls.sdk).toBe(1); expect(f.calls.unknown).toBe(0);
    } finally { release?.(); await active; f.cleanup(); }
  });
  test('saved results have delivery priority over older unresolved tombstones without permitting new generation', async () => {
    const f = await fixture();
    try {
      f.job = { ...f.job, fence: 2, state: 'provider_started', providerStartedAt: new Date().toISOString() };
      const current = { providerId: 'gemini-api' as const, model: f.job.model, ownerId: f.job.ownerId, workerId: f.job.workerId!,
        origin: f.api.origin, jobId: f.job.id, attemptId: f.job.attemptId!, fence: f.job.fence, inputSha256: f.job.inputSha256 };
      f.outbox.begin({ ...current, attemptId: randomUUID(), fence: 1 }); f.outbox.begin(current);
      const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#678123' } }).png().toBuffer();
      f.outbox.save(current, bytes, { original: { sha256: sha(bytes), bytes: bytes.length, mimeType: 'image/png', width: 16, height: 16 },
        provenance: { providerId: 'gemini-api', model: current.model, responseModel: current.model, responseId: 'synthetic-priority',
          verification: 'official-api', modelEvidence: 'response', generatedAt: '2026-10-23T09:00:00Z', attemptId: current.attemptId, inputSha256: current.inputSha256 } });
      expect(await f.worker().runOnce()).toBe('succeeded');
      expect(f.calls.sdk).toBe(0); expect(f.calls.models).toBe(0); expect(f.calls.claim).toBe(0);
      expect(f.outbox.pending()).toHaveLength(1); expect(f.outbox.pending()[0].phase).toBe('start_requested');
    } finally { f.cleanup(); }
  });
  test('paid response is committed before stop and delivered on restart', async () => {
    const f = await fixture();
    try {
      f.sdkMode = 'stop-received'; expect(await f.worker().runOnce(f.stop.signal)).toBe('held');
      expect(f.calls.sdk).toBe(1); expect(f.calls.image).toBe(0); expect(f.outbox.pending()[0].phase).toBe('result_saved');
      expect(await f.worker().runOnce()).toBe('succeeded'); expect(f.calls.sdk).toBe(1);
    } finally { f.cleanup(); }
  });
  test('local commit failure retries only the same RAM result twice and never the provider', async () => {
    for (const recover of [true, false]) {
      const f = await fixture(); let saves = 0; const save = f.outbox.save.bind(f.outbox);
      f.outbox.save = (...args) => { saves++; if (!recover || saves === 1) throw new ThumbnailOutboxError('outbox_unavailable'); save(...args); };
      try {
        expect(await f.worker().runOnce()).toBe(recover ? 'succeeded' : 'held');
        expect(f.calls.sdk).toBe(1); expect(saves).toBe(2);
        if (!recover) expect(f.outbox.pending()[0].phase).toBe('start_requested');
      } finally { f.cleanup(); }
    }
  });
  test('mismatched input cannot create an intent or invoke generation', async () => {
    const f = await fixture();
    try {
      f.job = { ...f.job, inputSha256: 'f'.repeat(64) };
      expect(await f.worker().runOnce()).toBe('held'); expect(f.calls.sdk).toBe(0); expect(f.calls.start).toBe(0); expect(f.outbox.pending()).toHaveLength(0);
    } finally { f.cleanup(); }
  });
  test('concurrent runOnce is rejected and live work renews the exact attempt', async () => {
    const f = await fixture();
    try {
      f.generateGate = async () => { await delay(30); }; const worker = f.worker(); const pending = worker.runOnce();
      await expect(worker.runOnce()).rejects.toThrow('worker_busy'); expect(await pending).toBe('succeeded');
      expect(f.calls.sdk).toBe(1); expect(f.calls.heartbeat).toBeGreaterThan(0);
    } finally { f.cleanup(); }
  });
  test('callback errors cannot discard paid output and origin mismatch cannot leak an existing bundle', async () => {
    const f = await fixture();
    try {
      f.deliveryMode = 'lost-before';
      const worker = new OutboundThumbnailWorker({ api: f.api, outbox: f.outbox, gemini: f.gemini, onEvent: () => { throw new Error('synthetic telemetry failure'); } });
      expect(await worker.runOnce()).toBe('held'); expect(f.outbox.pending()[0].phase).toBe('result_saved');
      const images = f.calls.image;
      const different = new OutboundThumbnailWorker({ api: { ...f.api, origin: 'https://tzudong.app' }, outbox: f.outbox, gemini: f.gemini });
      expect(await different.runOnce()).toBe('held'); expect(f.calls.image).toBe(images); expect(f.calls.sdk).toBe(1);
    } finally { f.cleanup(); }
  });
  test('catalog uses credits identity, caches fixed names, and stops immediately on account rate limit', async () => {
    let calls = 0;
    const client = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
      get: async ({ model }) => { calls++; return { name: `models/${model}` }; }, generateContent: async () => { throw new Error('generation forbidden'); },
    } } });
    expect(await client.models()).toEqual(['gemini-3.1-flash-image', 'gemini-3-pro-image']);
    const cached = await client.models(); cached.pop(); expect(await client.models()).toHaveLength(2); expect(calls).toBe(2);
    let throttledCalls = 0;
    const throttled = new GeminiThumbnailWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
      get: async () => { throttledCalls++; throw Object.assign(new Error('synthetic provider diagnostic'), { status: 429 }); },
      generateContent: async () => { throw new Error('generation forbidden'); },
    } } });
    await expect(throttled.models()).rejects.toThrow('model_catalog_unavailable'); expect(throttledCalls).toBe(1);
  });
  test('operator files require private owned regular files and never follow symlinks', async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'thumbnail-worker-files-'));
    try {
      const file = join(dir, 'operator'); writeFileSync(file, 'synthetic text', { mode: 0o600 });
      expect((await readThumbnailWorkerFile(file, 100)).toString()).toBe('synthetic text');
      chmodSync(file, 0o644); await expect(readThumbnailWorkerFile(file, 100)).rejects.toThrow('invalid_worker_configuration');
      chmodSync(file, 0o600); const link = join(dir, 'link'); symlinkSync(file, link);
      await expect(readThumbnailWorkerFile(link, 100)).rejects.toThrow('invalid_worker_configuration');
      await expect(readThumbnailWorkerFile(file, 3)).rejects.toThrow('invalid_worker_configuration');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('transport refuses redirects, retries neither 503 nor corrupt replies, and bounds actual bytes', async () => {
    const requests: string[] = []; let mode = '503';
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      requests.push(request.method + ' ' + new URL(request.url).pathname);
      if (mode === '503') return Response.json({ error: 'synthetic' }, { status: 503 });
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://external.invalid/' } });
      if (mode === 'large') return new Response('x'.repeat(192 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } });
      return new Response('{"result":null,"result":null}', { headers: { 'Content-Type': 'application/json' } });
    } });
    try {
      const api = new ThumbnailWorkerTransport({ origin: `http://127.0.0.1:${server.port}`, token: Buffer.alloc(32, 7).toString('base64url') });
      await expect(api.operation({ action: 'claim' })).rejects.toThrow('worker_delivery_unknown'); expect(requests).toHaveLength(1);
      mode = 'redirect'; await expect(api.operation({ action: 'claim' })).rejects.toThrow('worker_redirect_refused'); expect(requests).toHaveLength(2);
      mode = 'large'; await expect(api.operation({ action: 'claim' })).rejects.toThrow('invalid_worker_response');
      mode = 'duplicate'; await expect(api.operation({ action: 'claim' })).rejects.toThrow('invalid_worker_response'); expect(requests).toHaveLength(4);
    } finally { await server.stop(true); }
  });
});
