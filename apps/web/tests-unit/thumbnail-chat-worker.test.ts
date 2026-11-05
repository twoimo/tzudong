import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { FinishReason, GenerateContentResponse } from '@google/genai';
import { GeminiThumbnailChatWorkerClient, prepareThumbnailChatContent } from '../lib/admin/youtube-thumbnail-generator/chat-gemini-client';
import { THUMBNAIL_CHAT_MODEL, thumbnailChatContext } from '../lib/admin/youtube-thumbnail-generator/chat-contract';
import { thumbnailChatJob, type ThumbnailChatJob } from '../lib/admin/youtube-thumbnail-generator/execution-contract';
import { OutboundThumbnailWorker, type ThumbnailWorkerApi } from '../lib/admin/youtube-thumbnail-generator/outbound-worker';
import { ThumbnailWorkerOutbox } from '../lib/admin/youtube-thumbnail-generator/worker-outbox';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'thumbnail-chat-worker-')); chmodSync(directory, 0o700);
  const outbox = new ThumbnailWorkerOutbox(directory), stop = new AbortController();
  const context = thumbnailChatContext.parse({ message: '문구 개선 방향을 알려줘', chatRunId: 'run-1', chatThreadId: 'thread-1', currentTopic: '한식' });
  const content = prepareThumbnailChatContent(context), owner = randomUUID(), requestId = randomUUID(), now = new Date().toISOString();
  let job: ThumbnailChatJob = thumbnailChatJob.parse({ id: randomUUID(), ownerId: owner, requestId, workerId: randomUUID(), attemptId: randomUUID(),
    fence: 1, model: THUMBNAIL_CHAT_MODEL, inputSha256: content.inputSha256, state: 'claimed', cancelRequested: false,
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(), providerStartedAt: null, createdAt: now, updatedAt: now, result: null,
    input: { contract: 'thumbnail-gemini-chat-v1', model: THUMBNAIL_CHAT_MODEL, document: { path: `${owner}/${requestId}/input/chat.json`,
      sha256: content.documentSha256, bytes: content.documentBytes.length, mimeType: 'application/json' } } });
  const calls = { sdk: 0, models: 0, start: 0, claim: 0, delivery: 0, unknown: 0, image: 0 };
  let startLost = false, responseLost = false, stopReceived = false, deliveryLost = false, tamperInput = false, claimed = false;
  const gemini = new GeminiThumbnailChatWorkerClient({ env: {}, budget: async (work) => await work(), client: { models: {
    get: async ({ model }) => { calls.models++; return { name: `models/${model}` }; },
    generateContent: async () => {
      calls.sdk++; if (responseLost) throw new Error('synthetic response loss');
      const value = new GenerateContentResponse(); value.modelVersion = THUMBNAIL_CHAT_MODEL; value.responseId = 'synthetic-chat-worker';
      value.candidates = [{ finishReason: FinishReason.STOP, content: { role: 'model', parts: [{ text: JSON.stringify({ assistantMessage: '주요 문구를 간결하게 구성해 보세요.',
        intent: 'conversation', canvasPatch: { topic: context.currentTopic, headline: context.currentHeadline, subHeadline: context.currentSubHeadline },
        textLayerPatches: [], shouldGenerate: false, shouldReset: false }) }] } }];
      if (stopReceived) stop.abort(); return value;
    },
  } } });
  const api: ThumbnailWorkerApi = {
    origin: 'http://127.0.0.1:19541', reference: async () => { throw new Error('no image references'); },
    image: async () => { calls.image++; throw new Error('wrong image delivery'); },
    chatContext: async () => tamperInput ? { ...context, message: 'Changed after enqueue' } : structuredClone(context),
    operation: async (op) => {
      if (op.action === 'models') { expect(op.models).toEqual([THUMBNAIL_CHAT_MODEL]); return { result: { models: op.models } }; }
      if (op.action === 'claim') { calls.claim++; if (claimed) return { result: null }; claimed = true; return { result: structuredClone(job) }; }
      if (op.action === 'heartbeat') return { result: structuredClone(job) };
      if (op.action === 'unknown') { calls.unknown++; job = { ...job, state: 'unknown', leaseExpiresAt: null }; return { result: structuredClone(job) }; }
      if (op.action === 'start') {
        calls.start++; job = { ...job, state: 'provider_started', providerStartedAt: now };
        if (startLost) throw new Error('synthetic start ACK loss');
        return { result: { providerId: 'gemini-api', model: job.model, ownerId: job.ownerId, jobId: job.id,
          attemptId: job.attemptId, fence: job.fence, inputSha256: job.inputSha256, state: 'provider_started', permission: 'fresh-commit' } };
      }
      throw new Error('unexpected operation');
    },
    chat: async (_attempt, result) => {
      calls.delivery++;
      job = thumbnailChatJob.parse({ ...job, state: 'succeeded', leaseExpiresAt: null, result: { content: {
        ...result.content, path: `${job.ownerId}/${job.id}/${job.attemptId}/response.json` }, provenance: result.provenance } });
      expect(sha(result.bytes)).toBe(result.content.sha256);
      if (deliveryLost) throw new Error('synthetic delivery ACK loss');
      return { job: structuredClone(job) };
    },
  };
  const imageGemini = { models: async () => [], prepareStored: async () => { throw new Error('text may not call image SDK'); } };
  const worker = (box = outbox) => new OutboundThumbnailWorker({ api, outbox: box, gemini: imageGemini, chatGemini: gemini, heartbeatMs: 5 });
  return { outbox, stop, directory, calls, api, worker, get job() { return job; },
    set startLost(value: boolean) { startLost = value; }, set responseLost(value: boolean) { responseLost = value; },
    set stopReceived(value: boolean) { stopReceived = value; }, set deliveryLost(value: boolean) { deliveryLost = value; },
    set tamperInput(value: boolean) { tamperInput = value; },
    cleanup: () => { outbox.close(); rmSync(directory, { force: true, recursive: true }); } };
}

describe('shared durable thumbnail worker chat dispatch', () => {
  test('text claim uses one fresh start, one text SDK, atomic result and owner-bound completion', async () => {
    const f = fixture(); try {
      expect(await f.worker().runOnce()).toBe('succeeded'); expect(f.job.state).toBe('succeeded');
      expect(f.calls.sdk).toBe(1); expect(f.calls.start).toBe(1); expect(f.calls.image).toBe(0); expect(f.outbox.pending()).toHaveLength(0);
      expect(await f.worker().runOnce()).toBe('idle'); expect(f.calls.sdk).toBe(1);
    } finally { f.cleanup(); }
  });
  test('privacy-unsafe and malformed UTF-8 JSON never commit to the local outbox', async () => {
    const f = fixture(); try {
      const job = f.job, identity = { origin: f.api.origin, ownerId: job.ownerId, workerId: job.workerId!, jobId: job.id,
        attemptId: job.attemptId!, fence: job.fence, inputSha256: job.inputSha256, providerId: 'gemini-api' as const, model: THUMBNAIL_CHAT_MODEL };
      f.outbox.begin(identity);
      const response = { assistantMessage: ['synthetic', 'example.invalid'].join('@'), intent: 'conversation',
        canvasPatch: { topic: '한식', headline: '', subHeadline: '' }, textLayerPatches: [], shouldGenerate: false, shouldReset: false };
      const bytes = Buffer.from(JSON.stringify(response));
      const metadata = (raw: Buffer) => ({ content: { sha256: sha(raw), bytes: raw.length, mimeType: 'application/json' as const },
        provenance: { providerId: 'gemini-api' as const, model: THUMBNAIL_CHAT_MODEL, responseModel: THUMBNAIL_CHAT_MODEL, responseId: 'synthetic-private',
          verification: 'official-api' as const, modelEvidence: 'response' as const, generatedAt: new Date().toISOString(), attemptId: job.attemptId!, inputSha256: job.inputSha256 } });
      expect(() => f.outbox.saveChat(identity, bytes, metadata(bytes))).toThrow('outbox_invalid');
      const malformed = Buffer.concat([Buffer.from('{"assistantMessage":"'), Buffer.from([0xc0,0xaf]), Buffer.from('","other":"bounded"}')]);
      expect(() => f.outbox.saveChat(identity, malformed, metadata(malformed))).toThrow('outbox_invalid');
      expect(f.outbox.pending()[0].phase).toBe('start_requested'); expect(() => f.outbox.chatResult(identity)).toThrow('outbox_conflict');
    } finally { f.cleanup(); }
  });
  test('input change is detected before durable intent, start and SDK', async () => {
    const f = fixture(); try { f.tamperInput = true;
      expect(await f.worker().runOnce()).toBe('held'); expect(f.calls.start).toBe(0); expect(f.calls.sdk).toBe(0); expect(f.outbox.pending()).toHaveLength(0);
    } finally { f.cleanup(); }
  });
  for (const mode of ['startLost', 'responseLost'] as const) test(`${mode} cannot mint a second start after reopening`, async () => {
    const f = fixture(); try { f[mode] = true;
      expect(await f.worker().runOnce()).toBe('held'); expect(f.outbox.pending()[0].phase).toBe('start_requested');
      f.outbox.close(); const reopened = new ThumbnailWorkerOutbox(f.directory);
      try { expect(await f.worker(reopened).runOnce()).toBe('held'); expect(f.calls.start).toBe(1); expect(f.calls.sdk).toBe(mode === 'startLost' ? 0 : 1); }
      finally { reopened.close(); }
    } finally { f.cleanup(); }
  });
  for (const mode of ['stopReceived', 'deliveryLost'] as const) test(`${mode} preserves exact received JSON and redelivers without models, start or SDK`, async () => {
    const f = fixture(); try { f[mode] = true;
      expect(await f.worker().runOnce(f.stop.signal)).toBe('held');
      const pending = f.outbox.pending()[0]; expect(pending.phase).toBe('result_saved');
      const saved = f.outbox.chatResult(pending.identity); f.outbox.close(); f.deliveryLost = false;
      const reopened = new ThumbnailWorkerOutbox(f.directory), models = f.calls.models;
      try {
        const providerUnavailable = () => { throw new Error('key unavailable during recovery'); };
        expect(await new OutboundThumbnailWorker({ api: f.api, outbox: reopened, gemini: providerUnavailable, chatGemini: providerUnavailable }).runOnce()).toBe('succeeded');
        expect(reopened.chatResult(pending.identity).bytes.equals(saved.bytes)).toBe(true); expect(f.calls.sdk).toBe(1); expect(f.calls.start).toBe(1); expect(f.calls.models).toBe(models);
      } finally { reopened.close(); }
    } finally { f.cleanup(); }
  });
});
