import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { thumbnailJob, type ThumbnailJob } from '../../lib/admin/youtube-thumbnail-generator/queue-contract';

// Native Web Locks + actual browser bundle, isolated profile and loopback HTTP. API/data here are synthetic.
const path = 'lib/admin/youtube-thumbnail-generator/browser-queue.ts';
const digest = () => createHash('sha256').update(readFileSync(path)).digest('hex'); const before = digest();
const built = await Bun.build({ entrypoints: [path], target: 'browser', write: false }); assert.equal(built.success, true);
const bundle = await built.outputs[0].text(); const ownerId = randomUUID(); let posts = 0;
let release!: () => void, entered!: () => void;
const started = new Promise<void>((resolve) => { entered = resolve; });
let job: ThumbnailJob | null = null;
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/module.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
  if (url.pathname === '/') return new Response('<!doctype html><title>Isolated queue protocol verification</title>', { headers: { 'Content-Type': 'text/html' } });
  if (url.pathname !== '/api/admin/youtube-thumbnail-generator/jobs') return new Response(null, { status: 404 });
  if (request.method === 'GET') return Response.json({ job });
  posts++; const form = await request.formData(); const input = JSON.parse(String(form.get('request')));
  if (posts === 1) {
    await new Promise<void>((resolve) => { release = resolve; entered(); });
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }
  const now = new Date().toISOString();
  job = thumbnailJob.parse({ id: randomUUID(), ownerId, requestId: input.requestId, model: input.model,
    inputSha256: 'a'.repeat(64), input: { contract: 'thumbnail-gemini-image-v1', model: input.model, prompt: '실제 브라우저 fixture', references: [] },
    state: 'queued', workerId: null, attemptId: null, fence: 0, leaseExpiresAt: null, providerStartedAt: null,
    cancelRequested: false, result: null, createdAt: now, updatedAt: now });
  return Response.json({ job });
} });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext(); const origin = `http://127.0.0.1:${server.port}`;
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const first = await context.newPage(), second = await context.newPage();
  async function prepare(page: typeof first) {
    await page.goto(origin);
    return page.evaluate(async (owner) => {
      const { ThumbnailBrowserQueue } = await import(String('/module.js'));
      const state = window as unknown as { queue: InstanceType<typeof ThumbnailBrowserQueue>; draft: unknown };
      state.queue = new ThumbnailBrowserQueue({ ownerId: owner, storage: localStorage });
      state.draft = { model: 'gemini-3.1-flash-image', references: [], brief: { topic: 'Food-only fixture', headline: 'Fixture',
        acknowledgedSafety: true, stylePreset: 'grilled-meat-feast' } };
      return { secure: isSecureContext, nativeLocks: Boolean(navigator.locks), noBuffer: !('Buffer' in window) };
    }, ownerId);
  }
  const capability = await prepare(first); assert.deepEqual(capability, { secure: true, nativeLocks: true, noBuffer: true }); await prepare(second);
  await first.evaluate(() => { const s = window as unknown as { queue: { enqueue: (draft: unknown, revision: number) => Promise<unknown> }; draft: unknown; result: Promise<string> };
    s.result = s.queue.enqueue(s.draft, 1).then(() => 'accepted', (error: Error) => error.message); });
  await started;
  const collision = await second.evaluate(async () => { const s = window as unknown as { queue: { enqueue: (draft: unknown, revision: number) => Promise<unknown> }; draft: unknown };
    try { await s.queue.enqueue(s.draft, 4); return 'accepted'; } catch (error) { return (error as Error).message; } });
  assert.equal(collision, 'busy'); assert.equal(posts, 1); release();
  assert.equal(await first.evaluate(() => (window as unknown as { result: Promise<string> }).result), 'rejected_input');
  await second.evaluate(async () => { const s = window as unknown as { queue: { enqueue: (draft: unknown, revision: number) => Promise<unknown> }; draft: unknown };
    await s.queue.enqueue(s.draft, 4); });
  const stale = await first.evaluate(async () => { const s = window as unknown as { queue: { enqueue: (draft: unknown, revision: number) => Promise<unknown> }; draft: unknown };
    try { await s.queue.enqueue(s.draft, 2); return 'accepted'; } catch (error) { return (error as Error).message; } });
  assert.equal(stale, 'unresolved_request'); assert.equal(posts, 2); assert.ok(job);
  const queued = job as ThumbnailJob; const attemptId = randomUUID(), prefix = `${ownerId}/${queued.id}/${attemptId}/`, now = new Date().toISOString();
  job = thumbnailJob.parse({ ...queued, state: 'succeeded', attemptId, workerId: randomUUID(), fence: 1, providerStartedAt: now,
    result: { original: { path: `${prefix}original.png`, sha256: 'b'.repeat(64), bytes: 80, width: 2, height: 2, mimeType: 'image/png' },
      normalized: { path: `${prefix}normalized.png`, sha256: 'c'.repeat(64), bytes: 2000, width: 1280, height: 720, mimeType: 'image/png' },
      provenance: { providerId: 'gemini-api', model: queued.model, responseModel: queued.model, responseId: 'synthetic-browser-locks',
        verification: 'official-api', modelEvidence: 'response', generatedAt: now, attemptId, inputSha256: queued.inputSha256 } } });
  const apply = await second.evaluate(async (id) => { const q = (window as unknown as { queue: { resume: () => Promise<unknown>;
    canAutoApply: (id: string, revision: number) => boolean } }).queue; await q.resume(); return [q.canAutoApply(id, 4), q.canAutoApply(id, 5)]; }, queued.id);
  assert.deepEqual(apply, [true, false]); const third = await context.newPage(); await prepare(third);
  assert.equal(await third.evaluate(async (id) => { const q = (window as unknown as { queue: { resume: () => Promise<unknown>;
    canAutoApply: (id: string, revision: number) => boolean } }).queue; await q.resume(); return q.canAutoApply(id, 4); }, queued.id), false);
  await third.evaluate(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  const unsupported = await third.evaluate(async () => { const s = window as unknown as { queue: { enqueue: (draft: unknown, revision: number) => Promise<unknown> }; draft: unknown };
    try { await s.queue.enqueue(s.draft, 5); return 'accepted'; } catch (error) { return (error as Error).message; } });
  assert.equal(unsupported, 'receipt_unavailable'); assert.equal(posts, 2); assert.equal(digest(), before);
  process.stdout.write(JSON.stringify({ browserVersion: browser.version(), nativeWebLocks: true, realBrowserBundle: true,
    crossPageExclusion: true, staleReceiptPreserved: true, changedEditorNotOverwritten: true, reloadNotAutoApplied: true,
    missingLocksFailClosed: true, sourceSha256: before, sourceStable: true, httpPosts: posts, apiSynthetic: true,
    operatingAdminUi: false, externalProviderCalls: 0 }) + '\n');
  await context.close();
} finally { await browser.close(); await server.stop(true); }
