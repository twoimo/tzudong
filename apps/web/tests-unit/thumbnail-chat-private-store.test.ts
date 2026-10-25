import { describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { GenerateContentResponse } from '@google/genai';
import { thumbnailChatContext, THUMBNAIL_CHAT_MODEL, type ThumbnailChatContext, type ThumbnailChatResponse } from '../lib/admin/youtube-thumbnail-generator/chat-contract';
import { GeminiThumbnailChatWorkerClient, prepareThumbnailChatContent } from '../lib/admin/youtube-thumbnail-generator/chat-gemini-client';
import { ThumbnailPrivateStore, type ThumbnailDatabase, type ThumbnailStorage, type AuthenticatedThumbnailWorker } from '../lib/admin/youtube-thumbnail-generator/private-store';
import { createThumbnailQueueApi } from '../lib/admin/youtube-thumbnail-generator/queue-api';
import { ThumbnailQueueError, type ThumbnailAttempt } from '../lib/admin/youtube-thumbnail-generator/queue-contract';
import { type ThumbnailChatJob } from '../lib/admin/youtube-thumbnail-generator/execution-contract';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const origin = 'http://localhost:3000';
const layer = { id: 'headline', content: '원래 문구', x: 96, y: 520, fontFamily: 'system-ui', fontSize: 72,
  fontWeight: 900, fill: '#fff', stroke: '#111', strokeWidth: 8, shadow: 'none', align: 'center', rotation: 0, zIndex: 0 };
const context = (overrides: Partial<ThumbnailChatContext> = {}) => thumbnailChatContext.parse({
  message: '문구 크기를 키워줘', currentTopic: '한식', currentHeadline: layer.content, currentSubHeadline: '',
  currentTextLayers: [layer], conversationMessages: [{ role: 'user', content: '무엇을 고치면 좋을까요?' },
    { role: 'assistant', content: '글자 크기를 조절할 수 있어요.' }], ...overrides,
});
const answer = (overrides: Partial<ThumbnailChatResponse> = {}): ThumbnailChatResponse => ({
  assistantMessage: '선택한 문구 크기를 키웠어요.', intent: 'edit',
  canvasPatch: { topic: '한식', headline: layer.content, subHeadline: '' },
  textLayerPatches: [{ id: 'headline', fontSize: 88 }], shouldGenerate: false, shouldReset: false, ...overrides,
});
const post = (value: unknown, headers: HeadersInit = {}) => new Request(`${origin}/api/chat`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
});

/** Only the RPC replies and immutable object transport are synthetic; schemas, API and store are real. */
function fixture() {
  const owner = randomUUID(), requestId = randomUUID(), token = Buffer.alloc(32, 7).toString('base64url');
  const worker: AuthenticatedThumbnailWorker = { id: randomUUID(), ownerId: owner, models: [THUMBNAIL_CHAT_MODEL], tokenHash: sha(token) };
  const calls: string[] = [], reads: string[] = [], uploads: string[] = [], objects = new Map<string, Buffer>();
  let job: ThumbnailChatJob | null = null, delayed: (() => void) | undefined;
  const faults = {
    enqueue: 'none' as 'none' | 'after' | 'before' | 'late', complete: 'none' as 'none' | 'after' | 'before' | 'late',
    startAckLost: false, uploadAckLost: false, blockedSuffix: '', revoked: false,
    reply: (action: string, value: unknown): unknown => value,
    snapshotGate: undefined as undefined | (() => Promise<void>),
  };
  const reply = (action: string, value: unknown) => ({ data: faults.reply(action, structuredClone(value)), error: null });
  const loss = () => { throw new Error('synthetic transport loss: private diagnostic must not escape'); };
  const mutate = (mode: typeof faults.enqueue, commit: () => void) => {
    if (mode === 'before') loss();
    if (mode === 'late') { delayed = commit; loss(); }
    commit(); if (mode === 'after') loss();
  };
  const db: ThumbnailDatabase = { rpc: async (name, args) => {
    const action = String(args.p_action ?? 'auth'); calls.push(action);
    if (name === 'thumbnail_production_auth_worker') return args.p_token_sha256 === worker.tokenHash && !faults.revoked
      ? reply(action, { id: worker.id, ownerId: owner, models: worker.models })
      : { data: null, error: { message: 'worker_unauthorized' } };
    if (name === 'thumbnail_production_admin' && args.p_owner_id !== owner) return { data: null, error: { message: 'job_not_found' } };
    if (name === 'thumbnail_production_worker' && (args.p_token_sha256 !== worker.tokenHash || faults.revoked)) {
      return { data: null, error: { message: 'worker_unauthorized' } };
    }
    if (action === 'chat_request' || action === 'request') return reply(action, job?.requestId === args.p_request_id ? job : null);
    if (action === 'chat_snapshot' || action === 'snapshot') {
      await faults.snapshotGate?.();
      return job?.id === args.p_job_id ? reply(action, job) : { data: null, error: { message: 'job_not_found' } };
    }
    if (action === 'enqueue') {
      const prepared = { id: randomUUID(), ownerId: owner, requestId: args.p_request_id, model: args.p_model,
        inputSha256: args.p_input_sha256, input: structuredClone(args.p_input), state: 'queued', workerId: null, attemptId: null,
        fence: 0, leaseExpiresAt: null, providerStartedAt: null, cancelRequested: false, result: null,
        createdAt: '2026-10-23T09:00:00.000Z', updatedAt: '2026-10-23T09:00:00.000Z' } as ThumbnailChatJob;
      mutate(faults.enqueue, () => { job ??= prepared; }); return reply(action, job);
    }
    if (action === 'chat_cancel' && job) {
      job.cancelRequested = true;
      if (['queued', 'claimed'].includes(job.state)) { job.state = 'cancelled'; job.leaseExpiresAt = null; }
      return reply(action, job);
    }
    if (action === 'start' && job?.state === 'claimed') {
      job.state = 'provider_started'; job.providerStartedAt = '2026-10-23T09:00:01.000Z';
      if (faults.startAckLost) loss();
      return reply(action, { ownerId: owner, jobId: job.id, attemptId: job.attemptId, fence: job.fence,
        inputSha256: job.inputSha256, model: job.model, providerId: 'gemini-api', state: 'provider_started', permission: 'fresh-commit' });
    }
    if (action === 'complete' && job) {
      const manifest = structuredClone(args.p_payload) as ThumbnailChatJob['result'];
      mutate(faults.complete, () => { job = { ...job!, state: 'succeeded', leaseExpiresAt: null, result: manifest }; });
      return reply(action, job);
    }
    return { data: null, error: { message: 'attempt_conflict' } };
  } };
  const storage: ThumbnailStorage = {
    read: async (path, maximum) => {
      reads.push(path); const bytes = objects.get(path);
      if (bytes && bytes.length > maximum) throw new ThumbnailQueueError('object_conflict');
      return bytes ? Buffer.from(bytes) : null;
    },
    upload: async (path, bytes) => {
      uploads.push(path);
      if (objects.has(path)) throw new Error('immutable conflict');
      if (faults.blockedSuffix && path.endsWith(faults.blockedSuffix)) loss();
      objects.set(path, Buffer.from(bytes)); if (faults.uploadAckLost) loss();
    },
  };
  const store = new ThumbnailPrivateStore(db, storage);
  const api = createThumbnailQueueApi({ store, authorize: (async () => ({ ok: true, userId: owner })) as never });
  return { owner, requestId, worker, token, calls, reads, uploads, objects, faults, store, api,
    get job() { return job!; }, set job(value: ThumbnailChatJob) { job = value; },
    flush() { const commit = delayed; delayed = undefined; commit?.(); },
    async enqueue(ctx = context()) { return await store.enqueueChat(owner, requestId, ctx); },
    claim(started = true): ThumbnailAttempt {
      if (!job) throw new Error('enqueue first');
      job = { ...job, state: started ? 'provider_started' : 'claimed', workerId: worker.id, attemptId: randomUUID(), fence: 1,
        leaseExpiresAt: '2026-10-23T09:02:00.000Z', providerStartedAt: started ? '2026-10-23T09:00:01.000Z' : null };
      return { jobId: job.id, attemptId: job.attemptId!, fence: job.fence, inputSha256: job.inputSha256 };
    },
    proof(attempt: ThumbnailAttempt) { return { providerId: 'gemini-api', model: THUMBNAIL_CHAT_MODEL,
      responseModel: THUMBNAIL_CHAT_MODEL, responseId: 'synthetic-chat', verification: 'official-api', modelEvidence: 'response',
      generatedAt: '2026-10-23T09:00:02.000Z', attemptId: attempt.attemptId, inputSha256: attempt.inputSha256 }; },
  };
}

describe('chat private storage and API failure boundaries', () => {
  test('one immutable context, exact request recovery and changed input conflicts after claim', async () => {
    const f = fixture(); f.faults.uploadAckLost = true; f.faults.enqueue = 'after';
    const created = await f.enqueue(); const attempt = f.claim();
    expect((await f.enqueue()).attemptId).toBe(attempt.attemptId);
    expect(f.calls.filter((call) => call === 'enqueue')).toHaveLength(1); expect(f.uploads).toHaveLength(1);
    expect(f.objects.get(created.input.document.path)).toEqual(prepareThumbnailChatContent(context()).documentBytes);
    for (const ctx of [context({ message: '다른 질문입니다' }), context({ currentHeadline: '다른 문구' }),
      context({ conversationMessages: [{ role: 'assistant', content: '바뀐 대화입니다' }] })]) {
      await expect(f.enqueue(ctx)).rejects.toThrow('request_conflict');
    }
    expect(f.calls.filter((call) => call === 'enqueue')).toHaveLength(1); expect(f.uploads).toHaveLength(1);
    const readback = await f.api.chatListGET(new Request(`${origin}/api/chat?requestId=${f.requestId}`));
    expect((await readback.json()).job.id).toBe(created.id);
  });

  test('enqueue late commit stays uncertain and is recovered with GET, never a second enqueue', async () => {
    const f = fixture(); f.faults.enqueue = 'late';
    const response = await f.api.chatListPOST(post({ requestId: f.requestId, context: context() }));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'write_unconfirmed' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await f.store.chatRequest(f.owner, f.requestId)).toBeNull(); f.flush();
    expect((await f.store.chatRequest(f.owner, f.requestId))?.id).toBe(f.job.id);
    expect(f.calls.filter((call) => call === 'enqueue')).toHaveLength(1);
  });

  test('owner, request, job and kind mismatches fail before Storage reads', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(), before = f.reads.length;
    await expect(f.store.chatGet(randomUUID(), f.job.id)).rejects.toThrow('job_not_found');
    const otherOwner = randomUUID(), otherRequest = randomUUID();
    f.faults.reply = (action, value) => action === 'chat_snapshot' ? { ...f.job, ownerId: otherOwner,
      input: { ...f.job.input, document: { ...f.job.input.document, path: `${otherOwner}/${f.requestId}/input/chat.json` } } } : value;
    await expect(f.store.workerChatContext(f.worker, attempt)).rejects.toThrow('owner_forbidden');
    f.faults.reply = (action, value) => action === 'chat_request' ? { ...f.job, requestId: otherRequest,
      input: { ...f.job.input, document: { ...f.job.input.document, path: `${f.owner}/${otherRequest}/input/chat.json` } } } : value;
    await expect(f.store.chatRequest(f.owner, f.requestId)).rejects.toThrow('persistence_unavailable');
    f.faults.reply = (action, value) => action === 'chat_snapshot' ? { ...f.job, id: randomUUID() } : value;
    await expect(f.store.chatGet(f.owner, f.job.id)).rejects.toThrow('persistence_unavailable');
    f.faults.reply = (_action, value) => value;
    await expect(f.store.get(f.owner, f.job.id)).rejects.toThrow('persistence_unavailable');
    await expect(f.store.workerReference(f.worker, attempt, 0)).rejects.toThrow('persistence_unavailable');
    const image = { ...f.job, model: 'gemini-3.1-flash-image', input: { contract: 'thumbnail-gemini-image-v1',
      model: 'gemini-3.1-flash-image', prompt: 'A rice bowl', references: [] } };
    f.faults.reply = () => image;
    await expect(f.store.chatGet(f.owner, f.job.id)).rejects.toThrow('persistence_unavailable');
    await expect(f.store.workerChatContext(f.worker, attempt)).rejects.toThrow('persistence_unavailable');
    expect(f.reads).toHaveLength(before);
  });

  test('worker, attempt, fence and input mismatches are rejected before private document access', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(), before = f.reads.length;
    for (const changed of [{ ...attempt, attemptId: randomUUID() }, { ...attempt, fence: 2 }, { ...attempt, inputSha256: 'a'.repeat(64) }]) {
      await expect(f.store.workerChatContext(f.worker, changed)).rejects.toThrow('attempt_conflict');
      await expect(f.store.recoverChatResult(f.worker, changed)).rejects.toThrow('attempt_conflict');
    }
    await expect(f.store.workerChatContext({ ...f.worker, id: randomUUID() }, attempt)).rejects.toThrow('attempt_conflict');
    expect(f.reads).toHaveLength(before);
  });

  test('stored document byte, document hash and provider digest tampering all fail closed', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(), saved = structuredClone(f.job);
    const original = Buffer.from(f.objects.get(f.job.input.document.path)!);
    const mutated = Buffer.from(original); mutated[10] ^= 1; f.objects.set(f.job.input.document.path, mutated);
    await expect(f.store.workerChatContext(f.worker, attempt)).rejects.toThrow('object_conflict');
    await expect(f.enqueue()).rejects.toThrow('object_conflict');
    const changed = prepareThumbnailChatContent(context({ message: '바뀐 입력입니다' }));
    f.objects.set(f.job.input.document.path, changed.documentBytes);
    f.job = { ...saved, input: { ...saved.input, document: { ...saved.input.document,
      sha256: changed.documentSha256, bytes: changed.documentBytes.length } } };
    await expect(f.store.workerChatContext(f.worker, attempt)).rejects.toThrow('object_conflict');
    f.job = { ...saved, inputSha256: 'a'.repeat(64) }; f.objects.set(saved.input.document.path, original);
    await expect(f.store.workerChatContext(f.worker, { ...attempt, inputSha256: f.job.inputSha256 })).rejects.toThrow('object_conflict');
  });

  test('private context safety screens both roles, layer text, focus and attachment names before persistence', async () => {
    const f = fixture(), email = 'private.person@example.com';
    const contexts = [context({ message: email }), context({ currentTextLayers: [{ ...layer, align: 'center', content: email }] }),
      context({ conversationMessages: [{ role: 'assistant', content: email }] }), context({ conversationMessages: [{ role: 'user', content: email }] }),
      context({ focusContext: { kind: 'text-layer', label: '문구', promptContext: email } }),
      context({ referenceImageAttachments: [{ id: 'ref-1', name: email, mime: 'image/png', size: 40, role: 'food' }] })];
    for (const ctx of contexts) await expect(f.enqueue(ctx)).rejects.toThrow('invalid_request');
    expect(f.calls).toHaveLength(0); expect(f.uploads).toHaveLength(0);
  });

  test('privacy string boundary keeps 4096 ASCII history and 4096 Korean response characters losslessly', async () => {
    const f = fixture(), ctx = context({ conversationMessages: [{ role: 'assistant', content: 'a'.repeat(4096) }] });
    await f.enqueue(ctx); const attempt = f.claim();
    expect((await f.store.workerChatContext(f.worker, attempt)).conversationMessages[0].content).toHaveLength(4096);
    const result = answer({ assistantMessage: '가'.repeat(4096) });
    expect((await f.store.saveChatResult(f.worker, attempt, json(result), f.proof(attempt))).state).toBe('succeeded');
    expect((await f.store.chatOutput(f.owner, f.job.id)).response.assistantMessage).toBe(result.assistantMessage);
    const rejected = fixture();
    await expect(rejected.enqueue({ ...ctx, conversationMessages: [{ role: 'assistant', content: 'a'.repeat(4097) }] })).rejects.toThrow();
    expect(rejected.calls).toHaveLength(0); expect(rejected.uploads).toHaveLength(0);
    await expect(f.store.saveChatResult(f.worker, attempt, json(answer({ assistantMessage: '가'.repeat(4097) })), f.proof(attempt)))
      .rejects.toThrow('invalid_result');
  });

  test('readback screens a privacy-unsafe context even if both persisted hashes were replaced consistently', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim();
    const unsafe = prepareThumbnailChatContent(context({ conversationMessages: [{ role: 'assistant', content: 'private.person@example.com' }] }));
    f.objects.set(f.job.input.document.path, unsafe.documentBytes);
    f.job = { ...f.job, inputSha256: unsafe.inputSha256, input: { ...f.job.input, document: { ...f.job.input.document,
      sha256: unsafe.documentSha256, bytes: unsafe.documentBytes.length } } };
    await expect(f.store.workerChatContext(f.worker, { ...attempt, inputSha256: unsafe.inputSha256 })).rejects.toThrow('invalid_request');
  });

  test('result safety and actual layer binding apply before any result upload or completion', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(), before = f.uploads.length;
    for (const invalid of [answer({ textLayerPatches: [{ id: 'not-a-layer', content: '새 문구' }] }),
      answer({ textLayerPatches: [{ id: 'headline', fill: 'url(https://invalid.test)' }] }),
      answer({ assistantMessage: 'private.person@example.com' }),
      answer({ canvasPatch: { topic: '한식', headline: 'private.person@example.com', subHeadline: '' } }),
      answer({ textLayerPatches: [{ id: 'headline', content: 'private.person@example.com' }] }),
      answer({ intent: 'conversation' }), answer({ intent: 'generate', shouldGenerate: true }),
      { ...answer(), ownerId: randomUUID() }]) {
      await expect(f.store.saveChatResult(f.worker, attempt, json(invalid), f.proof(attempt))).rejects.toThrow('invalid_result');
    }
    expect(f.uploads).toHaveLength(before); expect(f.calls).not.toContain('complete');
  });

  test('result bytes, proof and identity are copied before the first await', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(), proof = f.proof(attempt);
    const bytes = json(answer()), original = Buffer.from(bytes), worker = structuredClone(f.worker), originalAttempt = { ...attempt };
    let release!: () => void; f.faults.snapshotGate = () => new Promise<void>((resolve) => { release = resolve; });
    const pending = f.store.saveChatResult(worker, attempt, bytes, proof);
    bytes.fill(0); worker.id = randomUUID(); attempt.attemptId = randomUUID(); proof.responseId = 'changed'; release();
    const result = await pending; f.faults.snapshotGate = undefined;
    expect(result.attemptId).toBe(originalAttempt.attemptId); expect(result.result!.provenance.responseId).toBe('synthetic-chat');
    expect(f.objects.get(result.result!.content.path)).toEqual(original);
  });

  test('unknown and cancel preserve received output; completion ACK loss matches an exact durable result', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim();
    f.job = { ...f.job, state: 'unknown', leaseExpiresAt: null, cancelRequested: true };
    f.faults.complete = 'after'; f.faults.uploadAckLost = true;
    const done = await f.store.saveChatResult(f.worker, attempt, json(answer()), f.proof(attempt));
    expect(done.state).toBe('succeeded'); expect(done.cancelRequested).toBe(true);
    expect((await f.store.chatOutput(f.owner, done.id)).response).toEqual(answer());
    expect(f.calls.filter((call) => call === 'complete')).toHaveLength(1);
    expect(f.uploads.map((path) => path.split('/').at(-1))).toEqual(['chat.json', 'recovery.json', 'response.json']);
  });

  test('complete ACK readback cannot substitute another response manifest', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(); f.faults.complete = 'after';
    f.faults.reply = (action, value) => action === 'chat_snapshot' && f.job.result ? { ...f.job,
      result: { ...f.job.result, provenance: { ...f.job.result.provenance, responseId: 'not-the-received-response' } } } : value;
    await expect(f.store.saveChatResult(f.worker, attempt, json(answer()), f.proof(attempt))).rejects.toThrow('write_unconfirmed');
    expect(f.calls.filter((call) => call === 'complete')).toHaveLength(1);
    expect(f.objects.has(f.job.result!.content.path)).toBe(true);
  });

  test('late complete commit recovers the original manifest without another upload or provider call', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(); f.faults.complete = 'late';
    await expect(f.store.saveChatResult(f.worker, attempt, json(answer()), f.proof(attempt))).rejects.toThrow('write_unconfirmed');
    expect(f.job.state).toBe('provider_started'); f.flush(); f.faults.complete = 'none';
    const uploads = f.uploads.length;
    expect((await f.store.recoverChatResult(f.worker, attempt)).state).toBe('succeeded');
    expect(f.uploads).toHaveLength(uploads); expect(f.calls).not.toContain('start');
  });

  test('a partial result keeps the manifest and exact original bytes can finish storage later', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(), bytes = json(answer()), proof = f.proof(attempt);
    f.faults.blockedSuffix = 'response.json';
    await expect(f.store.saveChatResult(f.worker, attempt, bytes, proof)).rejects.toThrow('write_unconfirmed');
    expect(f.calls).not.toContain('complete');
    await expect(f.store.recoverChatResult(f.worker, attempt)).rejects.toThrow('object_conflict');
    const manifestPath = [...f.objects.keys()].find((path) => path.endsWith('recovery.json'))!;
    const manifest = Buffer.from(f.objects.get(manifestPath)!); f.faults.blockedSuffix = '';
    expect((await f.store.saveChatResult(f.worker, attempt, bytes, proof)).state).toBe('succeeded');
    expect(f.objects.get(manifestPath)).toEqual(manifest);
    expect(f.uploads.filter((path) => path === manifestPath)).toHaveLength(1);
    await expect(f.store.saveChatResult(f.worker, attempt, json(answer({ assistantMessage: '다른 답변' })), proof)).rejects.toThrow('object_conflict');
    expect(f.objects.get(f.job.result!.content.path)).toEqual(bytes);
  });

  test('recovery checks owner, worker, attempt, fence, digest and exact private result path', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(); f.faults.complete = 'before';
    await expect(f.store.saveChatResult(f.worker, attempt, json(answer()), f.proof(attempt))).rejects.toThrow('write_unconfirmed');
    const path = [...f.objects.keys()].find((key) => key.endsWith('recovery.json'))!;
    const original = JSON.parse(f.objects.get(path)!.toString()), before = f.calls.filter((call) => call === 'complete').length;
    for (const changed of [{ ownerId: randomUUID() }, { workerId: randomUUID() }, { attemptId: randomUUID() }, { fence: 2 },
      { inputSha256: 'a'.repeat(64) }, { result: { ...original.result, content: { ...original.result.content, path: `${randomUUID()}/response.json` } } }]) {
      f.objects.set(path, json({ ...original, ...changed }));
      await expect(f.store.recoverChatResult(f.worker, attempt)).rejects.toThrow('object_conflict');
    }
    expect(f.calls.filter((call) => call === 'complete')).toHaveLength(before);
  });

  test('output and recovery revalidate stored result bytes and context even with matching manifest hashes', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim();
    const done = await f.store.saveChatResult(f.worker, attempt, json(answer()), f.proof(attempt));
    const path = done.result!.content.path;
    for (const invalid of [answer({ textLayerPatches: [{ id: 'not-a-layer', fontSize: 88 }] }),
      answer({ assistantMessage: 'private.person@example.com' })]) {
      const bytes = json(invalid); f.objects.set(path, bytes);
      f.job = { ...done, result: { ...done.result!, content: { ...done.result!.content, sha256: sha(bytes), bytes: bytes.length } } };
      await expect(f.store.chatOutput(f.owner, done.id)).rejects.toThrow('invalid_result');
      const recoveryPath = path.replace('response.json', 'recovery.json');
      const recovery = JSON.parse(f.objects.get(recoveryPath)!.toString()); recovery.result = f.job.result;
      f.objects.set(recoveryPath, json(recovery));
      await expect(f.store.recoverChatResult(f.worker, attempt)).rejects.toThrow('invalid_result');
    }
    f.job = done; f.objects.set(path, json(answer({ assistantMessage: 'hash mismatch' })));
    await expect(f.store.chatOutput(f.owner, done.id)).rejects.toThrow('object_conflict');
  });

  test('admin auth, account header and origin precede parsing or storage, and bodies are bounded', async () => {
    const f = fixture();
    const denied = createThumbnailQueueApi({ store: f.store, authorize: async () => ({ ok: false as const,
      response: Response.json({ error: 'unauthorized' }, { status: 401 }) }) });
    const unauthenticated = post({ malformed: true });
    expect((await denied.chatListPOST(unauthenticated)).status).toBe(401); expect(unauthenticated.bodyUsed).toBe(false);
    expect((await f.api.chatListPOST(post({}, { 'X-Thumbnail-Owner': randomUUID() }))).status).toBe(403);
    expect((await f.api.chatListPOST(post({}, { Origin: 'https://another.invalid', Authorization: 'Bearer synthetic' }))).status).toBe(403);
    expect((await f.api.chatListPOST(post({ requestId: f.requestId, context: { ...context(), ownerId: randomUUID() } }))).status).toBe(400);
    const oversized = new Request(`${origin}/api/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
      'Content-Length': '1' }, body: json({ padding: 'x'.repeat(68_001) }) });
    expect((await f.api.chatListPOST(oversized)).status).toBe(413);
    expect(f.calls).toHaveLength(0); expect(f.reads).toHaveLength(0); expect(f.uploads).toHaveLength(0);
  });

  test('worker auth precedes multipart parsing; revoked worker and noncanonical query cannot read content', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(), before = f.reads.length;
    const bad = new Request(`${origin}/api/worker/chat`, { method: 'POST', body: 'not a form' });
    expect((await f.api.workerChatPOST(bad)).status).toBe(401); expect(bad.bodyUsed).toBe(false);
    const query = new URLSearchParams({ ...attempt, fence: '01' });
    const headers = { Authorization: `Bearer ${f.token}` };
    expect((await f.api.workerChatGET(new Request(`${origin}/api/worker/chat?${query}`, { headers }))).status).toBe(400);
    query.set('fence', '1'); f.faults.revoked = true;
    expect((await f.api.workerChatGET(new Request(`${origin}/api/worker/chat?${query}`, { headers }))).status).toBe(401);
    expect(f.reads).toHaveLength(before);
  });

  test('actual client output survives cancellation and complete loss; API recovery never calls SDK again', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(false), controller = new AbortController(); let sdkCalls = 0;
    const client = new GeminiThumbnailChatWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
      generateContent: async () => { sdkCalls++; controller.abort();
        await f.store.chatCancel(f.owner, f.job.id);
        const response = new GenerateContentResponse(); response.modelVersion = THUMBNAIL_CHAT_MODEL; response.responseId = 'synthetic-chat';
        response.candidates = [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer()) }] } }]; return response;
      },
    } } });
    const prepared = await client.prepareStored({ context: await f.store.workerChatContext(f.worker, attempt), ownerId: f.owner,
      jobId: f.job.id, attemptId: attempt.attemptId, fence: attempt.fence });
    const output = await prepared.run(() => f.store.workerOperation(f.worker, 'start', attempt), controller.signal);
    f.faults.complete = 'before';
    // Exercise result persistence directly: Bun rewrites JSON File MIME; production route runs on Node 24.
    await expect(f.store.saveChatResult(f.worker, attempt, output.bytes, output.provenance)).rejects.toThrow('write_unconfirmed');
    f.job = { ...f.job, state: 'unknown', leaseExpiresAt: null }; f.faults.complete = 'none';
    const recovered = await f.api.workerPOST(post({ action: 'chat_recover', ...attempt }, { Authorization: `Bearer ${f.token}` }));
    expect(recovered.status).toBe(200); expect((await recovered.json()).job.cancelRequested).toBe(true);
    const readback = await f.api.chatJobGET(new Request(`${origin}/api/chat?output=1`), { params: Promise.resolve({ jobId: f.job.id }) });
    expect((await readback.json()).response).toEqual(answer());
    expect(sdkCalls).toBe(1); expect(f.calls.filter((call) => call === 'start')).toHaveLength(1);
    expect(f.uploads).toHaveLength(3);
    await expect(prepared.run(() => f.store.workerOperation(f.worker, 'start', attempt))).rejects.toThrow('attempt_consumed');
    expect(sdkCalls).toBe(1);
  });

  test('lost fresh start ACK is never reconstructed from a readable provider_started snapshot', async () => {
    const f = fixture(); await f.enqueue(); const attempt = f.claim(false); f.faults.startAckLost = true; let sdkCalls = 0;
    const client = new GeminiThumbnailChatWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
      generateContent: async () => { sdkCalls++; throw new Error('must never run'); },
    } } });
    const prepared = await client.prepareStored({ context: context(), ownerId: f.owner, jobId: f.job.id,
      attemptId: attempt.attemptId, fence: attempt.fence });
    await expect(prepared.run(() => f.store.workerOperation(f.worker, 'start', attempt))).rejects.toThrow('start_not_confirmed');
    expect((await f.store.chatGet(f.owner, f.job.id)).state).toBe('provider_started');
    await expect(prepared.run(() => f.store.workerOperation(f.worker, 'start', attempt))).rejects.toThrow('attempt_consumed');
    expect(sdkCalls).toBe(0); expect(f.calls.filter((call) => call === 'start')).toHaveLength(1);
  });
});
