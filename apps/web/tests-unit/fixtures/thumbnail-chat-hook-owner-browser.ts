/** Run from apps/web: bun tests-unit/fixtures/thumbnail-chat-hook-owner-browser.ts
 * Actual React hook, browser queue and schemas in isolated Chrome.
 * Only Auth and loopback API/data are synthetic. No hosted or provider execution proof.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { thumbnailUuid } from '../../lib/admin/youtube-thumbnail-generator/queue-contract';
import { thumbnailChatJob, type ThumbnailChatJob } from '../../lib/admin/youtube-thumbnail-generator/execution-contract';
import { thumbnailChatContext } from '../../lib/admin/youtube-thumbnail-generator/chat-contract';

const app = resolve(import.meta.dir, '../..');
const sourcePaths = [
  'components/admin/thumbnail-generator/useThumbnailChatQueue.ts',
  'lib/admin/youtube-thumbnail-generator/browser-queue.ts',
  'lib/admin/youtube-thumbnail-generator/chat-browser-queue.ts',
  'lib/admin/youtube-thumbnail-generator/chat-contract.ts', 'lib/admin/youtube-thumbnail-generator/execution-contract.ts',
  'lib/admin/youtube-thumbnail-generator/queue-contract.ts',
  // Caller is inspected/hash-bound, not mounted by this hook-level fixture.
  'components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx',
  'tests-unit/fixtures/thumbnail-chat-hook-owner-browser.ts',
];
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hashes = () => Object.fromEntries(sourcePaths.map((path) => [path, sha256(readFileSync(join(app, path)))]));
const before = hashes();
const base = '/api/admin/youtube-thumbnail-generator/chat/jobs';
const model = 'gemini-3.8-flash';

type Outcome = { status: 'resolved' | 'rejected'; code: string | null };
type Snapshot = { owner: string; mountId: string; available: boolean; phase: string;
  requestId: string | null; jobId: string | null; jobOwner: string | null;
  cancelRequested: boolean | null; error: string | null };
declare global {
  interface Window {
    thumbnailChatOwnerFixture: {
      start(): void; abort(): Promise<void>; switchOwner(owner: string): void;
      snapshot(): Snapshot; outcome(): Outcome | null;
      cancelCaptured(): Promise<void>; cancelCurrent(): Promise<void>;
      unmount(): void; refresh(): Promise<void>; submitAgain(): Promise<Outcome>;
    };
  }
}

const entry = `
import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { FixtureAuthProvider, useAuth, switchOwner } from '@/contexts/AuthContext';
import { useThumbnailChatQueue } from './components/admin/thumbnail-generator/useThumbnailChatQueue';
let latest, controller, capturedCancel, settled = null, snapshot;
const root = createRoot(document.getElementById('root'));
function Probe() {
  const { user } = useAuth();
  const hook = useThumbnailChatQueue();
  const mountId = useRef(crypto.randomUUID()).current;
  useLayoutEffect(() => {
    latest = hook;
    snapshot = { owner: user.id, mountId, available: hook.ready,
      phase: hook.state.phase, requestId: hook.state.handle?.requestId ?? null,
      jobId: hook.state.job?.id ?? null, jobOwner: hook.state.job?.ownerId ?? null,
      cancelRequested: hook.state.handle?.cancelRequested ?? null, error: hook.error };
  });
  return <output data-testid="owner">{user.id}</output>;
}
window.thumbnailChatOwnerFixture = {
  start() {
    if (controller) throw new Error('fixture already submitted');
    controller = new AbortController(); capturedCancel = latest.cancel;
    void latest.submit({ message: '문구를 더 간결하게 다듬어줘', chatThreadId: 'thread-owner', chatRunId: 'run-owner'    }, 7, controller.signal).then(
      () => { settled = { status: 'resolved', code: null }; },
      (error) => { settled = { status: 'rejected', code: typeof error.code === 'string' ? error.code : error.name }; });
  },
  async abort() {
    controller.abort();
    // The explicit Stop action may also call cancel while enqueue holds the lock.
    // Its busy result must not replace the captured finally cleanup after the ACK.
    await capturedCancel();
  },
  switchOwner, snapshot: () => snapshot, outcome: () => settled,
  cancelCaptured: async () => { await capturedCancel(); },
  cancelCurrent: async () => { await latest.cancel(); },
  unmount: () => root.unmount(), refresh: async () => { await latest.refresh(); },
  submitAgain: async () => {
    try {
      await latest.submit({ message: '중복 요청 검증', chatThreadId: 'thread-owner', chatRunId: 'run-duplicate' }, 7, new AbortController().signal);
      return { status: 'resolved', code: null };
    } catch (error) { return { status: 'rejected', code: error.code ?? error.name }; }
  },
};
root.render(
  <FixtureAuthProvider initialOwner={document.body.dataset.owner}><Probe /></FixtureAuthProvider>);
`;
const auth = `
import React, { createContext, useContext, useLayoutEffect, useState } from 'react';
const Auth = createContext(null); let updateOwner;
export const switchOwner = (owner) => updateOwner(owner);
export function FixtureAuthProvider({ initialOwner, children }) {
  const [owner, setOwner] = useState(initialOwner);
  useLayoutEffect(() => { updateOwner = setOwner; }, []);
  return <Auth.Provider value={{ user: { id: owner }, isAdmin: true }}>{children}</Auth.Provider>;
}
export function useAuth() { const value = useContext(Auth); if (!value) throw new Error('missing fixture auth'); return value; }
`;
const built = await Bun.build({ entrypoints: ['thumbnail-owner-fixture'], target: 'browser', format: 'iife', write: false,
  define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'owner-auth-only', setup(builder) {
    builder.onResolve({ filter: /^thumbnail-owner-fixture$/ }, () => ({ path: 'entry', namespace: 'owner-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'owner-fixture' }, () => ({ loader: 'tsx', contents: entry, resolveDir: app }));
    builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'owner-auth' }));
    builder.onLoad({ filter: /.*/, namespace: 'owner-auth' }, () => ({ loader: 'tsx', contents: auth, resolveDir: app }));
    builder.onLoad({ filter: /useThumbnailChatQueue\.ts$/ }, (args) => {
      const original = readFileSync(args.path, 'utf8');
      if (process.env.THUMBNAIL_CHAT_OWNER_NEGATIVE !== '1') return { loader: 'ts', contents: original, resolveDir: resolve(args.path, '..') };
      const guard = "if (owner !== ownerRef.current || !isAdmin) return null;";
      assert.equal(original.split(guard).length, 2);
      return { loader: 'ts', contents: original.replace(guard, 'if (false) return null;'), resolveDir: resolve(args.path, '..') };
    });
    builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, app) }));
  } }] });
assert.equal(built.success, true, built.logs.map(String).join('\n').slice(0, 2000));
const script = await built.outputs.find((file) => file.path.endsWith('.js'))!.text();
assert.deepEqual(hashes(), before, 'source changed while bundling');

type Call = { method: string; path: string; owner: string | null; status?: number };
type Case = { mode: 'success' | 'failure'; ownerA: string; ownerB: string; authOwner: string;
  jobA: ThumbnailChatJob | null; jobB: ThumbnailChatJob; calls: Call[]; enqueued: boolean;
  ack: Promise<void>; release(): void; unexpected: string[];
  polling?: { failure: '503' | 'timeout'; failures: number[]; lookups: number; hold?: Promise<void> } };
let active: Case;
const makeJob = (ownerId: string, requestId: string) => {
  const now = new Date().toISOString();
  return thumbnailChatJob.parse({ id: randomUUID(), ownerId, requestId, model, inputSha256: 'a'.repeat(64),
    input: { contract: 'thumbnail-gemini-chat-v1', model, document: { path: `${ownerId}/${requestId}/input/chat.json`, sha256: 'b'.repeat(64), bytes: 100, mimeType: 'application/json' } },
    state: 'queued', workerId: null, attemptId: null, fence: 0, leaseExpiresAt: null, providerStartedAt: null,
    cancelRequested: false, result: null, createdAt: now, updatedAt: now });
};
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const current = active, url = new URL(request.url), path = url.pathname;
  if (path === '/bundle.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
  if (path === '/') return new Response(`<!doctype html><html><meta charset="utf-8"><title>Isolated owner regression</title>
    <body data-owner="${current.ownerA}"><div id="root"></div><script src="/bundle.js"></script></body></html>`,
  { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; object-src 'none'" } });
  if (path === '/favicon.ico') return new Response(null, { status: 204 });
  const owner = request.headers.get('X-Thumbnail-Owner');
  const call: Call = { method: request.method, path: path + url.search, owner }; current.calls.push(call);
  const reply = (value: unknown, status = 200) => { call.status = status; return Response.json(value, { status }); };
  // Authentication switches to B while the already-authenticated A response is held.
  if (owner !== current.authOwner) return reply({ ok: false, error: 'owner_forbidden' }, 403);
  if (path.endsWith('/reference-candidates') && request.method === 'POST') {
    return reply({ channelId: 'UCfpaSruWW3S4dibonKXENjA', bucketStartedAt: null, references: [] });
  }
  if (path === base && request.method === 'POST') {
    assert.equal(owner, current.ownerA, 'B must not enqueue');
    assert.equal(current.enqueued, false, 'enqueue must not retry');
    const input = await request.json(); thumbnailChatContext.parse(input.context); thumbnailUuid.parse(input.requestId);
    current.jobA = makeJob(owner, input.requestId); current.enqueued = true;
    await current.ack;
    return current.mode === 'success' ? reply({ job: current.jobA })
      : reply({ ok: false, error: 'write_unconfirmed' }, 503);
  }
  if (path === base && request.method === 'GET') {
    if (!url.searchParams.has('requestId')) return reply({ jobs: [] });
    if (current.polling) {
      const lookup = ++current.polling.lookups;
      if (current.polling.hold) await current.polling.hold;
      if (current.polling.failure === '503' && current.polling.failures.includes(lookup)) {
        return reply({ ok: false, error: 'synthetic_status_unavailable' }, 503);
      }
    }
    const job = owner === current.ownerA ? current.jobA : current.jobB;
    return reply({ job: job?.requestId === url.searchParams.get('requestId') ? job : null });
  }
  if (path === `${base}/${current.jobB.id}` && request.method === 'POST') {
    assert.equal(owner, current.ownerB);
    assert.deepEqual(await request.json(), { action: 'cancel' });
    current.jobB = thumbnailChatJob.parse({ ...current.jobB, state: 'cancelled', cancelRequested: true });
    return reply({ job: current.jobB });
  }
  current.unexpected.push(`${request.method} ${path}`);
  return reply({ ok: false, error: 'unexpected_fixture_request' }, 404);
} });

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: Array<Record<string, unknown>> = [];
try {
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'] });
  for (const mode of ['success', 'failure'] as const) {
    const ownerA = randomUUID(), ownerB = randomUUID(); let release!: () => void;
    const ack = new Promise<void>((resolveAck) => { release = resolveAck; });
    const current: Case = { mode, ownerA, ownerB, authOwner: ownerA, jobA: null,
      jobB: makeJob(ownerB, randomUUID()), calls: [], enqueued: false, ack, release, unexpected: [] };
    active = current;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const origin = `http://127.0.0.1:${server.port}`, externalAttempts: string[] = [], pageErrors: string[] = [];
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalAttempts.push('blocked non-loopback request'); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', (error) => pageErrors.push(error.message));
    const bReceipt = JSON.stringify({ requestId: current.jobB.requestId, model, editorSessionId: randomUUID(),
      editorRevision: 7, cancelRequested: false, chatThreadId: 'thread-b', chatRunId: 'run-b', imageRequestId: randomUUID() });
    await page.addInitScript(({ owner, receipt }) => {
      localStorage.setItem(`thumbnail-gemini-chat-request:${owner}`, receipt);
    }, { owner: ownerB, receipt: bReceipt });
    try {
      await page.goto(origin);
      await page.waitForFunction((owner) => window.thumbnailChatOwnerFixture?.snapshot()?.owner === owner
        && window.thumbnailChatOwnerFixture.snapshot().available, ownerA);
      const original = await page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot());
      assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, nativeLocks: !!navigator.locks,
        noBuffer: !('Buffer' in window) })), { secure: true, nativeLocks: true, noBuffer: true });
      await page.evaluate(() => window.thumbnailChatOwnerFixture.start());
      await expect.poll(() => current.enqueued, { timeout: 5000 }).toBe(true);
      assert.ok(current.jobA); const requestA = current.jobA.requestId;
      await page.evaluate(() => window.thumbnailChatOwnerFixture.abort());
      assert.equal(await page.evaluate(() => window.thumbnailChatOwnerFixture.outcome()), null, 'ACK is still held after abort');
      current.authOwner = ownerB;
      await page.evaluate((owner) => window.thumbnailChatOwnerFixture.switchOwner(owner), ownerB);
      await page.waitForFunction(({ owner, id, requestId }) => {
        const state = window.thumbnailChatOwnerFixture.snapshot();
        return state.owner === owner && state.jobOwner === owner && state.jobId === id
          && state.requestId === requestId && state.phase === 'tracking' && state.available;
      }, { owner: ownerB, id: current.jobB.id, requestId: current.jobB.requestId });
      const restored = await page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot());
      assert.equal(restored.mountId, original.mountId, 'same hook component survives the account switch');
      assert.equal(restored.cancelRequested, false);
      // A callback retained by an old render must also be inert for B.
      const callsBeforeStaleCancel = current.calls.length;
      await page.evaluate(() => window.thumbnailChatOwnerFixture.cancelCaptured());
      assert.equal(current.calls.length, callsBeforeStaleCancel);
      const releaseIndex = current.calls.length;
      current.release();
      await page.waitForFunction(() => window.thumbnailChatOwnerFixture.outcome() !== null);
      assert.deepEqual(await page.evaluate(() => window.thumbnailChatOwnerFixture.outcome()), {
        status: 'rejected', code: mode === 'success' ? 'AbortError' : 'unconfirmed',
      });
      assert.deepEqual(await page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot()), restored,
        'late A success/failure must not overwrite B hook state or errors');
      const receipts = await page.evaluate(({ a, b }) => ({
        a: JSON.parse(localStorage.getItem(`thumbnail-gemini-chat-request:${a}`)!),
        b: localStorage.getItem(`thumbnail-gemini-chat-request:${b}`),
      }), { a: ownerA, b: ownerB });
      assert.equal(receipts.a.requestId, requestA); assert.equal(receipts.a.cancelRequested, true);
      assert.equal(receipts.b, bReceipt, 'B persisted receipt must remain byte-for-byte unchanged');
      const lateReads = current.calls.slice(releaseIndex).filter((call) => call.method === 'GET');
      assert.ok(lateReads.some((call) => call.owner === ownerA
        && call.path === `${base}?requestId=${requestA}` && call.status === 403),
      'captured A cancellation must actually attempt owner-bound readback, even when the new session denies it');
      const cancelPosts = () => current.calls.filter((call) => call.method === 'POST' && call.path === `${base}/${current.jobB.id}`).length;
      assert.equal(cancelPosts(), 0, 'late A completion cancelled B');
      const enqueuePosts = current.calls.filter((call) => call.method === 'POST' && call.path === base);
      assert.equal(enqueuePosts.length, 1); assert.equal(enqueuePosts[0].owner, ownerA);
      assert.equal(current.jobB.state, 'queued');
      const result: Record<string, unknown> = { ack: mode, passed: true, bCancelPosts: cancelPosts(),
        enqueuePosts: enqueuePosts.length, aCancelIntentRetained: true, bReceiptUnchanged: true,
        sameMountedHook: true, lateAOutcome: mode === 'success' ? 'AbortError' : 'unconfirmed' };
      if (mode === 'success') {
        // Negative control: reintroduce the removed UI's late "cancel current" call,
        // without modifying the hook. The same API recorder must detect the harm.
        await page.evaluate(() => window.thumbnailChatOwnerFixture.cancelCurrent());
        assert.throws(() => assert.equal(cancelPosts(), 0), /AssertionError/);
        assert.equal(cancelPosts(), 1); assert.equal(current.jobB.state, 'cancelled');
        result.removedLateCallerControlDetected = true;
      }
      assert.deepEqual(current.unexpected, []); assert.deepEqual(externalAttempts, []); assert.deepEqual(pageErrors, []);
      results.push(result);
    } finally { current.release(); await context.close(); }
  }
  for (const failure of ['503', 'timeout'] as const) {
    const ownerA = randomUUID(), ownerB = randomUUID();
    const polling: NonNullable<Case['polling']> = { failure, failures: [2, 3], lookups: 0 };
    const current: Case = { mode: 'success', ownerA, ownerB, authOwner: ownerA,
      jobA: makeJob(ownerA, randomUUID()), jobB: makeJob(ownerB, randomUUID()), calls: [],
      enqueued: false, ack: Promise.resolve(), release() {}, unexpected: [], polling };
    active = current;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const origin = `http://127.0.0.1:${server.port}`, externalAttempts: string[] = [], pageErrors: string[] = [];
    await context.route('**/*', (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { externalAttempts.push('blocked non-loopback request'); return route.abort(); }
      if (failure === 'timeout' && url.pathname === base && url.searchParams.has('requestId')
        && polling.failures.includes(polling.lookups + 1)) {
        polling.lookups++;
        current.calls.push({ method: request.method(), path: url.pathname + url.search,
          owner: request.headers()['x-thumbnail-owner'] ?? null, status: 0 });
        return route.abort('timedout');
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.clock.install(); await page.clock.pauseAt(new Date());
    await page.addInitScript(({ owner, receipt }) => {
      localStorage.setItem(`thumbnail-gemini-chat-request:${owner}`, receipt);
    }, { owner: ownerA, receipt: JSON.stringify({ requestId: current.jobA!.requestId, model,
      editorSessionId: randomUUID(), editorRevision: 7, cancelRequested: false,
      chatThreadId: 'thread-polling', chatRunId: 'run-polling', imageRequestId: randomUUID() }) });
    let releaseRead: (() => void) | undefined;
    try {
      await page.goto(origin);
      await expect.poll(() => page.evaluate(() => window.thumbnailChatOwnerFixture?.snapshot()?.phase)).toBe('tracking');
      assert.equal(polling.lookups, 1);
      const initial = await page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot());
      let fixedError: string | null = null;
      for (const expected of [2, 3]) {
        await page.clock.fastForward(4999); assert.equal(polling.lookups, expected - 1);
        await page.clock.fastForward(1);
        await expect.poll(() => polling.lookups).toBe(expected);
        await expect.poll(() => current.calls.filter((call) => call.path.includes('?requestId=') && (call.status === 503 || call.status === 0)).length).toBe(expected - 1);
        await expect.poll(() => page.evaluate(async (key) =>
          (await navigator.locks.query()).held?.filter((lock) => lock.name === key).length ?? 0,
        `thumbnail-gemini-chat-request:${ownerA}`)).toBe(0);
        await expect.poll(() => page.evaluate(() => Boolean(window.thumbnailChatOwnerFixture.snapshot().error))).toBe(true);
        const failed = await page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot());
        if (fixedError) assert.equal(failed.error, fixedError, 'second error does not change the fixed error string');
        fixedError = failed.error; assert.equal(failed.phase, 'tracking'); assert.equal(failed.requestId, initial.requestId);
      }
      await page.clock.fastForward(5000);
      await expect.poll(() => polling.lookups, { timeout: 1500 }).toBe(4);
      await expect.poll(() => page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot().error)).toBeNull();
      await page.clock.fastForward(5000);
      await expect.poll(() => polling.lookups).toBe(5);
      await expect.poll(() => current.calls.filter((call) => call.path.includes('?requestId=') && call.status === 200).length).toBe(3);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.fastForward(15_000); assert.equal(polling.lookups, 5);
      if (failure === '503') {
        current.jobA = thumbnailChatJob.parse({ ...current.jobA, state: 'cancelled', cancelRequested: true });
      } else {
        polling.hold = new Promise<void>((resolveRead) => { releaseRead = resolveRead; });
      }
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => polling.lookups).toBe(6);
      if (failure === '503') {
        await expect.poll(() => page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot().phase)).toBe('settled');
      } else {
        await page.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.fastForward(15_000); assert.equal(polling.lookups, 6, 'pending GET does not overlap');
        await page.evaluate(() => window.thumbnailChatOwnerFixture.unmount()); releaseRead!();
        await expect.poll(() => current.calls.filter((call) => call.path.includes('?requestId=') && call.status === 200).length).toBe(4);
      }
      await page.clock.fastForward(15_000); assert.equal(polling.lookups, 6, 'terminal/unmount stops scheduling');
      assert.equal(current.calls.filter((call) => call.method === 'POST').length, 0);
      assert.ok(current.calls.every((call) => call.owner === ownerA));
      assert.deepEqual(current.unexpected, []); assert.deepEqual(externalAttempts, []); assert.deepEqual(pageErrors, []);
      results.push({ statusReadFailure: failure, consecutiveIdenticalFailures: 2, lookups: polling.lookups,
        passed: true, successRearms: true, hiddenPaused: true, noOverlappingGet: true, generationPosts: 0,
        settledStops: failure === '503', pendingUnmountStops: failure === 'timeout' });
    } finally { releaseRead?.(); await context.close(); }
  }
  {
    const ownerA = randomUUID(), ownerB = randomUUID(); let release!: () => void, releaseRead!: () => void;
    const ack = new Promise<void>((resolveAck) => { release = resolveAck; });
    const polling: NonNullable<Case['polling']> = { failure: '503', failures: [1, 2], lookups: 0,
      hold: new Promise<void>((resolveRead) => { releaseRead = resolveRead; }) };
    const current: Case = { mode: 'success', ownerA, ownerB, authOwner: ownerA, jobA: null,
      jobB: makeJob(ownerB, randomUUID()), calls: [], enqueued: false, ack, release, unexpected: [], polling };
    active = current;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const origin = `http://127.0.0.1:${server.port}`, externalAttempts: string[] = [], pageErrors: string[] = [];
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalAttempts.push('blocked non-loopback request'); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.clock.install(); await page.clock.pauseAt(new Date());
    try {
      await page.goto(origin);
      await expect.poll(() => page.evaluate(() => window.thumbnailChatOwnerFixture?.snapshot()?.available)).toBe(true);
      await page.evaluate(() => window.thumbnailChatOwnerFixture.start());
      await expect.poll(() => current.enqueued).toBe(true);
      assert.deepEqual(await page.evaluate(() => window.thumbnailChatOwnerFixture.submitAgain()), { status: 'rejected', code: 'receipt_unavailable' });
      await page.clock.fastForward(10_000);
      await page.evaluate(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await window.thumbnailChatOwnerFixture.refresh();
      });
      assert.equal(polling.lookups, 0, 'active enqueue must not start background GET');
      release();
      await expect.poll(() => page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot().phase)).toBe('tracking');
      await page.clock.fastForward(2000);
      await expect.poll(() => polling.lookups).toBe(1);
      await page.evaluate(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await window.thumbnailChatOwnerFixture.refresh();
      });
      await page.clock.fastForward(15_000);
      assert.equal(polling.lookups, 1, 'active submit owns its pending GET; background timer cannot duplicate it');
      releaseRead();
      await expect.poll(() => page.evaluate(() => window.thumbnailChatOwnerFixture.outcome())).toEqual({ status: 'rejected', code: 'unconfirmed' });
      await page.clock.fastForward(5000);
      await expect.poll(() => polling.lookups).toBe(2);
      await expect.poll(() => current.calls.filter((call) => call.status === 503).length).toBe(2);
      await expect.poll(() => page.evaluate(async (key) =>
        (await navigator.locks.query()).held?.filter((lock) => lock.name === key).length ?? 0,
      `thumbnail-gemini-chat-request:${ownerA}`)).toBe(0);
      current.jobA = thumbnailChatJob.parse({ ...current.jobA, state: 'cancelled', cancelRequested: true });
      await page.clock.fastForward(5000);
      await expect.poll(() => polling.lookups).toBe(3);
      await expect.poll(() => page.evaluate(() => window.thumbnailChatOwnerFixture.snapshot().phase)).toBe('settled');
      await page.clock.fastForward(15_000); assert.equal(polling.lookups, 3);
      assert.equal(current.calls.filter((call) => call.method === 'POST' && call.path === base).length, 1);
      assert.equal(current.calls.filter((call) => call.method === 'POST' && call.path !== base).length, 0);
      assert.deepEqual(current.unexpected, []); assert.deepEqual(externalAttempts, []); assert.deepEqual(pageErrors, []);
      results.push({ activeSubmit: true, passed: true, duplicateSubmitRejected: true, enqueuePosts: 1,
        noCompetingBackgroundGet: true, recoveryAfterActiveEnds: true, consecutiveIdenticalFailures: 2, lookups: 3 });
    } finally { release(); releaseRead(); await context.close(); }
  }
  assert.deepEqual(hashes(), before, 'source changed during verification; rerun against a stable candidate');
  console.log(JSON.stringify({ passed: true, command: 'bun tests-unit/fixtures/thumbnail-chat-hook-owner-browser.ts',
    bun: Bun.version, chrome: browser.version(), react: JSON.parse(readFileSync(Bun.resolveSync('react/package.json', app), 'utf8')).version,
    sourceStable: true, sourceSha256: sha256(JSON.stringify(before)), sourceFiles: before, bundleSha256: sha256(script),
    results, externalPageRequests: 0, hostedRequests: 0, providerCalls: 0,
    limits: ['Auth/API are synthetic; actual UI caller is inspected/hash-bound but not mounted.',
      'Two identical status 503/timeout failures use virtual scheduling and real browser fetch rejection; no actual elapsed 20-second deadline is claimed.',
      'No hosted authorization, PostgreSQL, Storage, Gemini, or external cross-audit evidence.'],
  }, null, 2));
} finally { await browser?.close(); await server.stop(true); }
