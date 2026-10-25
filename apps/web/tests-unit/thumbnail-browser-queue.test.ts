import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { ThumbnailBrowserQueue, ThumbnailBrowserQueueError, type ThumbnailBrowserDraft } from '../lib/admin/youtube-thumbnail-generator/browser-queue';
import { thumbnailJob, type ThumbnailJob } from '../lib/admin/youtube-thumbnail-generator/queue-contract';

function fixture() {
  const ownerId = randomUUID(), requestId = randomUUID(), jobId = randomUUID(), now = new Date().toISOString();
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const draft: ThumbnailBrowserDraft = { model: 'gemini-3.1-flash-image', references: [],
    brief: { topic: 'Food-only fixture', headline: 'Original headline', stylePreset: 'grilled-meat-feast', acknowledgedSafety: true } };
  let job = thumbnailJob.parse({ id: jobId, ownerId, requestId, model: draft.model, inputSha256: 'a'.repeat(64),
    input: { contract: 'thumbnail-gemini-image-v1', model: draft.model, prompt: 'Fixture', references: [] }, state: 'queued',
    workerId: null, attemptId: null, fence: 0, leaseExpiresAt: null, providerStartedAt: null,
    cancelRequested: false, result: null, createdAt: now, updatedAt: now });
  let posts = 0, cancellations = 0, mode: 'normal' | 'ack-lost' | 'absent' | 'cancel-lost' = 'normal';
  let sentForm: FormData | undefined;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fetcher = (async (url, init) => {
    const path = String(url); calls.push({ path, init });
    if (init?.method === 'POST' && path.endsWith('/jobs')) {
      posts++; sentForm = init.body as FormData;
      if (mode === 'ack-lost') throw new Error('synthetic ACK loss');
    } else if (init?.method === 'POST') {
      cancellations++; job = { ...job, cancelRequested: true, state: job.state === 'queued' ? 'cancelled' : job.state };
      if (mode === 'cancel-lost') throw new Error('synthetic cancel ACK loss');
    }
    return Response.json({ job: mode === 'absent' ? null : job });
  }) as typeof fetch;
  let held = false;
  const admission = async <T>(work: () => Promise<T>) => {
    if (held) throw new ThumbnailBrowserQueueError('busy'); held = true;
    try { return await work(); } finally { held = false; }
  };
  const queue = () => new ThumbnailBrowserQueue({ ownerId, storage, admission, fetch: fetcher });
  function succeed() {
    const attemptId = randomUUID(), workerId = randomUUID(), prefix = `${ownerId}/${jobId}/${attemptId}/`;
    job = thumbnailJob.parse({ ...job, state: 'succeeded', workerId, attemptId, fence: 1, providerStartedAt: now,
      result: { original: { path: `${prefix}original.png`, sha256: 'b'.repeat(64), bytes: 80, width: 2, height: 2, mimeType: 'image/png' },
        normalized: { path: `${prefix}normalized.png`, sha256: 'c'.repeat(64), bytes: 2000, width: 1280, height: 720, mimeType: 'image/png' },
        provenance: { providerId: 'gemini-api', model: job.model, responseModel: job.model, responseId: 'fixture',
          verification: 'official-api', modelEvidence: 'response', generatedAt: now, attemptId, inputSha256: job.inputSha256 } } });
  }
  return { ownerId, requestId, jobId, entries, storage, draft, fetcher, calls, queue, succeed, admission,
    get job() { return job; }, set job(value: ThumbnailJob) { job = value; },
    get posts() { return posts; }, get cancellations() { return cancellations; }, get sentForm() { return sentForm; },
    set mode(value: typeof mode) { mode = value; } };
}

describe('Gemini thumbnail browser queue protocol', () => {
  test('a persisted cancellation intent is delivered when the original enqueue appears after null and reload', async () => {
    const f = fixture(), q = f.queue(); f.mode = 'ack-lost';
    await expect(q.enqueue(f.draft, 4, f.requestId)).rejects.toThrow('unconfirmed');
    f.mode = 'absent'; expect(await q.cancel()).toBeNull();
    expect(q.state.handle?.cancelRequested).toBe(true); expect(f.cancellations).toBe(0);
    f.mode = 'normal'; const restored = f.queue();
    expect((await restored.resume())?.state).toBe('cancelled');
    expect(f.posts).toBe(1); expect(f.cancellations).toBe(1);
    await restored.resume(); expect(f.cancellations).toBe(1);
    expect(restored.canAutoApply(f.jobId, 4)).toBe(false);
  });
  test('an idle open tab adopts another tab receipt for observation without a second POST or auto apply', async () => {
    const f = fixture(), idle = f.queue(), submitting = f.queue();
    await submitting.enqueue(f.draft, 7, f.requestId);
    expect(idle.state.handle).toBeNull(); await idle.resume();
    expect(idle.state.handle?.requestId).toBe(f.requestId);
    f.succeed(); await idle.resume();
    expect(idle.canAutoApply(f.jobId, 7)).toBe(false); expect(f.posts).toBe(1);
    expect(f.calls.every((call) => new Headers(call.init?.headers).get('X-Thumbnail-Owner') === f.ownerId)).toBe(true);
  });
  test('an unresolved local request is retained when unrelated storage is replaced', async () => {
    const f = fixture(), q = f.queue(); f.mode = 'ack-lost';
    await expect(q.enqueue(f.draft, 3, f.requestId)).rejects.toThrow('unconfirmed');
    const alien = { requestId: randomUUID(), model: f.draft.model, editorSessionId: randomUUID(), editorRevision: 4, cancelRequested: false };
    f.storage.setItem(`thumbnail-gemini-request:${f.ownerId}`, JSON.stringify(alien));
    f.mode = 'normal'; await q.resume();
    expect(q.state.handle?.requestId).toBe(f.requestId);
    expect(JSON.parse(f.storage.getItem(`thumbnail-gemini-request:${f.ownerId}`)!).requestId).toBe(alien.requestId);
    expect(f.posts).toBe(1);
  });
  test('two controllers cannot delete another in-flight request receipt after a pre-insert rejection', async () => {
    const f = fixture(); let release!: (response: Response) => void; let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const second = new ThumbnailBrowserQueue({ ownerId: f.ownerId, admission: f.admission, storage: f.storage,
      fetch: (() => { entered(); return new Promise((resolve) => { release = resolve; }); }) as typeof fetch });
    const first = f.queue();
    const b = second.enqueue(f.draft, 2, randomUUID()).catch(() => undefined); await started;
    f.mode = 'ack-lost'; await expect(first.enqueue(f.draft, 1, f.requestId)).rejects.toThrow('busy');
    expect(f.posts).toBe(0);
    release(Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })); await b;
    await expect(first.enqueue(f.draft, 1, f.requestId)).rejects.toThrow('unconfirmed');
    expect(f.queue().state.handle?.requestId).toBe(f.requestId); expect(f.posts).toBe(1);
  });
  test('a reused request ID cannot apply an older successful input as the new edited draft', async () => {
    const f = fixture(); let posts = 0;
    const q = new ThumbnailBrowserQueue({ ownerId: f.ownerId, admission: f.admission, storage: f.storage, fetch: (async (path, init) => {
      if (init?.method === 'POST' && ++posts > 1) return Response.json({ ok: false, error: 'request_conflict' }, { status: 409 });
      return f.fetcher(path, init);
    }) as typeof fetch });
    await q.enqueue(f.draft, 1, f.requestId); f.succeed(); await q.resume();
    await expect(q.enqueue({ ...f.draft, brief: { ...f.draft.brief, headline: 'Different input' } }, 2, f.requestId)).rejects.toThrow();
    await q.resume(); expect(q.canAutoApply(f.jobId, 2)).toBe(false);
  });
  test('a stale idle controller cannot replace another controller receipt after admission', async () => {
    const f = fixture(), first = f.queue(), stale = f.queue();
    await first.enqueue(f.draft, 1, f.requestId);
    await expect(stale.enqueue(f.draft, 2)).rejects.toThrow('unresolved_request');
    expect(f.posts).toBe(1); expect(f.queue().state.handle?.requestId).toBe(f.requestId);
  });
  test('a nonparticipating receipt replacement during HTTP cannot be deleted by input rejection', async () => {
    const f = fixture(); const replacement = { requestId: randomUUID(), model: 'gemini-3.1-flash-image',
      editorSessionId: randomUUID(), editorRevision: 1, cancelRequested: false };
    const q = new ThumbnailBrowserQueue({ ownerId: f.ownerId, storage: f.storage, admission: f.admission,
      fetch: (async () => {
        f.storage.setItem(`thumbnail-gemini-request:${f.ownerId}`, JSON.stringify(replacement));
        return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 });
      }) as typeof fetch });
    await expect(q.enqueue(f.draft, 0, f.requestId)).rejects.toThrow('receipt_unavailable');
    expect(f.queue().state.handle?.requestId).toBe(replacement.requestId);
  });
  test('ACK loss and reload recover the same request with GET only and no repeated POST', async () => {
    const f = fixture(); f.mode = 'ack-lost'; const q = f.queue();
    await expect(q.enqueue(f.draft, 7, f.requestId)).rejects.toThrow('unconfirmed');
    expect(q.state.phase).toBe('unconfirmed'); f.mode = 'normal';
    const restored = f.queue(); expect((await restored.resume())?.id).toBe(f.jobId);
    expect(f.posts).toBe(1); expect(restored.state.handle?.editorRevision).toBe(7);
    await expect(restored.enqueue(f.draft, 8)).rejects.toThrow('unresolved_request');
    expect(f.posts).toBe(1);
  });
  test('a missing lookup, HTTP conflict or malformed response cannot mint a new request ID', async () => {
    const f = fixture(); f.mode = 'ack-lost'; const q = f.queue();
    await expect(q.enqueue(f.draft, 0, f.requestId)).rejects.toThrow(); f.mode = 'absent';
    expect(await q.resume()).toBeNull(); await expect(q.enqueue(f.draft, 0)).rejects.toThrow('unresolved_request');
    expect(f.posts).toBe(1); expect(q.state.handle?.requestId).toBe(f.requestId);
    for (const response of [Response.json({ ok: false, error: 'request_conflict' }, { status: 409 }), Response.json({ job: 'invalid' })]) {
      const other = fixture(); const queue = new ThumbnailBrowserQueue({ ownerId: other.ownerId, admission: other.admission, storage: other.storage,
        fetch: (async () => response) as typeof fetch });
      await expect(queue.enqueue(other.draft, 0, other.requestId)).rejects.toThrow();
      expect(queue.state.handle?.requestId).toBe(other.requestId); expect(queue.state.phase).toBe('unconfirmed');
    }
  });
  test('only a fixed pre-insert rejection permits correction; failure to remove the receipt stays held', async () => {
    for (const removable of [true, false]) {
      const f = fixture(); const storage = { ...f.storage, removeItem: removable ? f.storage.removeItem : () => undefined };
      const q = new ThumbnailBrowserQueue({ ownerId: f.ownerId, admission: f.admission, storage,
        fetch: (async () => Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })) as typeof fetch });
      await expect(q.enqueue(f.draft, 0, f.requestId)).rejects.toThrow(removable ? 'rejected_input' : 'receipt_unavailable');
      expect(q.state.phase).toBe(removable ? 'idle' : 'unconfirmed');
      expect(q.state.handle?.requestId ?? null).toBe(removable ? null : f.requestId);
    }
  });
  test('failed receipt persistence prevents any remote request, and corrupt receipts are preserved', async () => {
    const f = fixture(); let calls = 0;
    const q = new ThumbnailBrowserQueue({ ownerId: f.ownerId, admission: f.admission,
      storage: { ...f.storage, setItem: () => undefined }, fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
    await expect(q.enqueue(f.draft, 0, f.requestId)).rejects.toThrow('receipt_unavailable'); expect(calls).toBe(0);
    f.entries.set(`thumbnail-gemini-request:${f.ownerId}`, 'invalid retained bytes');
    expect(() => f.queue()).toThrow('receipt_unavailable'); expect([...f.entries.values()]).toEqual(['invalid retained bytes']);
  });
  test('one controller refuses concurrent submissions before its first HTTP response', async () => {
    const f = fixture(); let release!: (response: Response) => void;
    const q = new ThumbnailBrowserQueue({ ownerId: f.ownerId, admission: f.admission, storage: f.storage,
      fetch: (() => new Promise((resolve) => { release = resolve; })) as typeof fetch });
    const pending = q.enqueue(f.draft, 0, f.requestId);
    await expect(q.enqueue(f.draft, 0)).rejects.toThrow('busy');
    release(Response.json({ job: f.job })); expect((await pending).id).toBe(f.jobId);
  });
  test('later draft edits and file-array mutations do not change the submitted snapshot', async () => {
    const f = fixture(); const refs = [{ file: new File([new Uint8Array(32)], 'private-name.png', { type: 'image/png' }), role: 'host' as const }];
    f.draft.references = refs; const q = f.queue(); const pending = q.enqueue(f.draft, 2, f.requestId);
    f.draft.brief.headline = 'Later edited headline'; refs.splice(0);
    await pending;
    const submitted = JSON.parse(String(f.sentForm?.get('request')));
    expect(submitted.brief.headline).toBe('Original headline'); expect(submitted.roles).toEqual(['host']);
    expect((f.sentForm?.get('reference0') as File).size).toBe(32);
    const persisted = [...f.entries.values()].join();
    expect(persisted).not.toContain('headline'); expect(persisted).not.toContain('private-name');
    expect(Object.keys(JSON.parse(persisted)).sort()).toEqual(['cancelRequested', 'editorRevision', 'editorSessionId', 'model', 'requestId']);
  });
  test('the input snapshot precedes asynchronous shared-lock admission as well', async () => {
    const f = fixture(); let release!: () => void;
    const q = new ThumbnailBrowserQueue({ ownerId: f.ownerId, storage: f.storage, fetch: f.fetcher,
      admission: async <T>(work: () => Promise<T>) => new Promise<T>((resolve, reject) => {
        release = () => { void work().then(resolve, reject); };
      }) });
    const pending = q.enqueue(f.draft, 2, f.requestId); f.draft.brief.headline = 'Edited during lock admission'; release(); await pending;
    expect(JSON.parse(String(f.sentForm?.get('request'))).brief.headline).toBe('Original headline');
  });
  test('cancel ACK loss is reconciled separately and local cancellation blocks late auto-apply', async () => {
    const f = fixture(); const q = f.queue(); await q.enqueue(f.draft, 1, f.requestId);
    f.mode = 'cancel-lost'; await expect(q.cancel()).rejects.toThrow('unconfirmed');
    expect(q.state.handle?.cancelRequested).toBe(true); f.mode = 'normal';
    const restored = f.queue(); expect((await restored.resume())?.state).toBe('cancelled');
    expect(f.posts).toBe(1); expect(f.cancellations).toBe(1);
    f.succeed(); await restored.resume(); expect(restored.canAutoApply(f.jobId, 1)).toBe(false);
    expect(await restored.cancel()).toEqual(f.job); expect(f.cancellations).toBe(1);
  });
  test('cancel before enqueue visibility retains intent and never claims cancelled', async () => {
    const f = fixture(); f.mode = 'ack-lost'; const q = f.queue();
    await expect(q.enqueue(f.draft, 0, f.requestId)).rejects.toThrow(); f.mode = 'absent';
    expect(await q.cancel()).toBeNull(); expect(q.state.phase).toBe('unconfirmed');
    expect(q.state.handle?.cancelRequested).toBe(true); expect(f.cancellations).toBe(0);
  });
  test('late completion applies only to the same job and editor revision, with actual Gemini proof', async () => {
    const f = fixture(); const q = f.queue(); await q.enqueue(f.draft, 9, f.requestId); f.succeed(); await q.resume();
    expect(q.canAutoApply(f.jobId, 9)).toBe(true); expect(q.canAutoApply(f.jobId, 10)).toBe(false);
    expect(q.canAutoApply(randomUUID(), 9)).toBe(false);
    const reloaded = f.queue(); await reloaded.resume(); expect(reloaded.canAutoApply(f.jobId, 9)).toBe(false);
    const result = q.resultUrls(f.job); expect(result.provenance.model).toBe(f.job.model);
    expect(result.provenance.providerId).toBe('gemini-api'); expect(result.original).toBe(`/api/admin/youtube-thumbnail-generator/jobs/${f.jobId}?variant=original`);
    const snapshot = q.state; snapshot.handle!.editorRevision = 10; snapshot.job!.state = 'unknown';
    expect(q.canAutoApply(f.jobId, 9)).toBe(true);
    f.job = { ...f.job, cancelRequested: true }; await q.resume(); expect(q.canAutoApply(f.jobId, 9)).toBe(false);
  });
  test('owner, model, request and job substitutions are rejected and never applied', async () => {
    const mutations = [ { ownerId: randomUUID() }, { requestId: randomUUID() },
      { model: 'gemini-3-pro-image', input: { contract: 'thumbnail-gemini-image-v1', model: 'gemini-3-pro-image', prompt: 'Other', references: [] } } ];
    for (const mutation of mutations) {
      const f = fixture(); f.job = { ...f.job, ...mutation } as ThumbnailJob; const q = f.queue();
      await expect(q.enqueue(f.draft, 0, f.requestId)).rejects.toThrow('invalid_response'); expect(q.state.job).toBeNull();
    }
    const f = fixture(), q = f.queue(); await q.enqueue(f.draft, 0, f.requestId);
    f.job = { ...f.job, id: randomUUID() }; await expect(q.resume()).rejects.toThrow('invalid_response');
    expect(q.state.job?.id).toBe(f.jobId);
    expect(() => q.resultUrls({ ...f.job, ownerId: randomUUID() })).toThrow('not_succeeded');
  });
  test('unknown and cancelRequested are not terminal proof; observation creates no cancellation', async () => {
    const f = fixture(), q = f.queue(); await q.enqueue(f.draft, 0, f.requestId);
    f.job = { ...f.job, state: 'unknown', workerId: randomUUID(), attemptId: randomUUID(), fence: 1,
      providerStartedAt: new Date().toISOString(), cancelRequested: true };
    await q.resume(); expect(q.state.phase).toBe('tracking'); expect(f.cancellations).toBe(0);
    await expect(q.enqueue(f.draft, 0)).rejects.toThrow('unresolved_request'); expect(f.posts).toBe(1);
    expect(() => q.resultUrls(f.job)).toThrow('not_succeeded');
  });
  test('invalid models, unsafe references and oversized totals stop before network or receipt mutation', async () => {
    for (const draft of [{ ...fixture().draft, model: 'gpt-image-2' },
      { ...fixture().draft, references: [{ role: 'host', file: new File([new Uint8Array(32)], 'bad.svg', { type: 'image/svg+xml' }) }] },
      { ...fixture().draft, references: Array.from({ length: 3 }, () => ({ role: 'food',
        file: new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' }) })) }]) {
      const f = fixture(); await expect(f.queue().enqueue(draft as ThumbnailBrowserDraft, 0, f.requestId)).rejects.toThrow('invalid_input');
      expect(f.posts).toBe(0); expect(f.entries.size).toBe(0);
    }
  });
  test('same-origin credentials, bounded private requests and history cursor retain the new contract', async () => {
    const f = fixture(); const q = f.queue(); await q.enqueue(f.draft, 0, f.requestId);
    expect(f.calls[0].init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    const summary = { id: f.job.id, requestId: f.job.requestId, model: f.job.model, state: f.job.state,
      cancelRequested: false, createdAt: f.job.createdAt, updatedAt: f.job.updatedAt };
    const historyCalls: string[] = [];
    const h = new ThumbnailBrowserQueue({ ownerId: f.ownerId, admission: f.admission, storage: f.storage, fetch: (async (path) => {
      historyCalls.push(String(path)); return Response.json({ jobs: [summary] }); }) as typeof fetch });
    expect(await h.history({ beforeCreatedAt: summary.createdAt, beforeId: summary.id })).toEqual([summary]);
    const query = new URL(`http://localhost${historyCalls[0]}`).searchParams;
    expect(query.get('beforeId')).toBe(summary.id); expect(query.get('beforeCreatedAt')).toBe(summary.createdAt);
  });
  test('the actual client and shared schema bundle for browser without Node globals', async () => {
    const bundle = await Bun.build({ entrypoints: ['lib/admin/youtube-thumbnail-generator/browser-queue.ts'],
      target: 'browser', write: false });
    expect(bundle.success).toBe(true); const code = await bundle.outputs[0].text();
    expect(code).not.toContain('Buffer.byteLength'); expect(code).not.toContain('node:');
    const script = 'globalThis.Buffer=undefined; await import("./lib/admin/youtube-thumbnail-generator/queue-contract.ts").then(({thumbnailInput})=>{if(!thumbnailInput.safeParse({contract:"thumbnail-gemini-image-v1",model:"gemini-3.1-flash-image",prompt:"쯔양",references:[]}).success)process.exit(2);});';
    const child = Bun.spawn([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).toBe(0);
  });
});
