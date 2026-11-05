import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { ThumbnailChatBrowserQueue } from '../lib/admin/youtube-thumbnail-generator/chat-browser-queue';
import { thumbnailChatJob, type ThumbnailChatJob } from '../lib/admin/youtube-thumbnail-generator/execution-contract';

function fixture() {
  const owner = randomUUID(), values = new Map<string, string>(), calls: Array<{ path: string; method: string }> = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const context = { message: '제목을 간결하게 다듬어줘', chatThreadId: 'thread-1', chatRunId: 'run-1' };
  let job: ThumbnailChatJob | null = null, lost = false, absent = false, posts = 0, cancels = 0, foreign = false;
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input), method = init.method ?? 'GET'; calls.push({ path, method });
    expect(new Headers(init.headers).get('X-Thumbnail-Owner')).toBe(owner);
    if (method === 'POST' && path.endsWith('/jobs')) {
      posts++; const { requestId } = JSON.parse(String(init.body)), now = new Date().toISOString();
      job = thumbnailChatJob.parse({ id: randomUUID(), ownerId: owner, requestId, model: 'gemini-3.8-flash', inputSha256: 'a'.repeat(64),
        input: { contract: 'thumbnail-gemini-chat-v1', model: 'gemini-3.8-flash', document: { path: `${owner}/${requestId}/input/chat.json`,
          sha256: 'b'.repeat(64), bytes: 100, mimeType: 'application/json' } }, state: 'queued', workerId: null, attemptId: null, fence: 0,
        cancelRequested: false, leaseExpiresAt: null, providerStartedAt: null, result: null, createdAt: now, updatedAt: now });
      if (lost) throw new Error('synthetic enqueue ACK loss');
    } else if (method === 'POST') { cancels++; job = { ...job!, cancelRequested: true, state: 'cancelled' }; }
    const current = absent ? null : structuredClone(job);
    if (foreign && current) current.ownerId = randomUUID();
    return Response.json({ job: current });
  }) as typeof fetch;
  const queue = () => new ThumbnailChatBrowserQueue({ ownerId: owner, storage, fetch: fetcher, admission: async (work) => await work() });
  function succeed() {
    const attemptId = randomUUID(), now = new Date().toISOString();
    job = thumbnailChatJob.parse({ ...job, attemptId, workerId: randomUUID(), fence: 1, providerStartedAt: now, state: 'succeeded',
      result: { content: { path: `${owner}/${job!.id}/${attemptId}/response.json`, sha256: 'c'.repeat(64), bytes: 100, mimeType: 'application/json' },
        provenance: { providerId: 'gemini-api', model: 'gemini-3.8-flash', responseModel: 'gemini-3.8-flash', responseId: 'synthetic-browser',
          verification: 'official-api', modelEvidence: 'response', generatedAt: now, attemptId, inputSha256: 'a'.repeat(64) } } });
  }
  return { owner, storage, values, context, queue, calls, succeed, get job() { return job; }, get posts() { return posts; }, get cancels() { return cancels; },
    set lost(value: boolean) { lost = value; }, set absent(value: boolean) { absent = value; }, set foreign(value: boolean) { foreign = value; } };
}
describe('independent durable thumbnail chat browser receipt', () => {
  test('first editor chat accepts the initial null canvas action and enqueues once', async () => {
    const f = fixture(), q = f.queue();
    const job = await q.enqueue({ ...f.context, lastCanvasActionLabel: null }, 0);
    expect(job.ownerId).toBe(f.owner);
    expect(q.state.phase).toBe('tracking');
    expect(f.posts).toBe(1);
  });
  test('same editor + revision + thread + turn yields exactly one stable follow-up image request identity', async () => {
    const f = fixture(), q = f.queue(); await q.enqueue(f.context, 4); f.succeed(); await q.resume();
    expect(q.consume(f.job!.id, 5, 'thread-1', 'run-1')).toBeNull();
    expect(q.consume(f.job!.id, 4, 'other-thread', 'run-1')).toBeNull();
    expect(q.consume(f.job!.id, 4, 'thread-1', 'other-turn')).toBeNull();
    const imageId = q.state.handle!.imageRequestId;
    expect(q.consume(f.job!.id, 4, 'thread-1', 'run-1')).toBe(imageId);
    await q.resume(); expect(q.consume(f.job!.id, 4, 'thread-1', 'run-1')).toBeNull();
    expect(f.posts).toBe(1);
    const receipt = [...f.values.values()].join(''); expect(receipt).not.toContain(f.context.message); expect(receipt).not.toContain('assistantMessage');
  });
  test('reload and missing enqueue ACK can observe the old request without reapplying or POST retry', async () => {
    for (const lost of [false, true]) {
      const f = fixture(), q = f.queue(); f.lost = lost;
      if (lost) await expect(q.enqueue(f.context, 0)).rejects.toThrow('unconfirmed'); else await q.enqueue(f.context, 0);
      const restored = f.queue(); f.succeed(); await restored.resume();
      expect(restored.consume(f.job!.id, 0, 'thread-1', 'run-1')).toBeNull(); expect(f.posts).toBe(1);
    }
  });
  test('cancel lookup absence preserves exact cancel intent and later delivers it to the original job', async () => {
    const f = fixture(), q = f.queue(); await q.enqueue(f.context, 0); f.absent = true;
    expect(await q.cancel()).toBeNull(); expect(q.state.handle!.cancelRequested).toBe(true); expect(f.cancels).toBe(0);
    await expect(q.enqueue(f.context, 1)).rejects.toThrow('unresolved_request');
    f.absent = false; expect((await q.resume())!.state).toBe('cancelled'); expect(f.cancels).toBe(1); expect(f.posts).toBe(1);
  });
  test('different tab receipt cannot be overwritten or consumed, and foreign jobs never enter state', async () => {
    const f = fixture(), q = f.queue(); await q.enqueue(f.context, 0); f.succeed(); await q.resume();
    f.values.set(`thumbnail-gemini-chat-request:${f.owner}`, JSON.stringify({ ...q.state.handle, requestId: randomUUID() }));
    expect(q.consume(f.job!.id, 0, 'thread-1', 'run-1')).toBeNull();
    await expect(q.enqueue({ ...f.context, chatRunId: 'run-2' }, 1)).rejects.toThrow('unresolved_request');
    const g = fixture(), other = g.queue(); g.foreign = true; await expect(other.enqueue(g.context, 0)).rejects.toThrow('invalid_response');
    expect(other.state.job).toBeNull(); expect(g.posts).toBe(1);
  });
});
