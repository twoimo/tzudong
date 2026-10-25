import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseStorageServerClient } from '@/lib/supabase/storage-server';
import { assertPrivacySafe, assertPrivacySafeText } from '@/lib/privacy/sanitize';
import { prepareThumbnailGeminiContent, type ThumbnailGeminiContent } from './gemini-image-input';
import { prepareThumbnailChatContent } from './gemini-chat-input';
import { thumbnailChatContext, thumbnailChatProvenance, validateThumbnailChatResponse, type ThumbnailChatContext } from './chat-contract';
import { thumbnailChatInput, thumbnailChatJob, thumbnailChatResult, thumbnailExecutionJob, thumbnailExecutionStartReceipt,
  THUMBNAIL_CHAT_DOCUMENT_BYTES, THUMBNAIL_CHAT_RESULT_BYTES, type ThumbnailChatJob, type ThumbnailChatResult } from './execution-contract';
import {
  THUMBNAIL_FAILURES, THUMBNAIL_IMAGE_BYTES, THUMBNAIL_PRIVATE_BUCKET, THUMBNAIL_REFERENCE_BYTES,
  ThumbnailQueueError, extension, inputPath, parseThumbnail, resultPrefix, thumbnailAttempt,
  thumbnailHash, thumbnailInput, thumbnailJob, thumbnailProvenance, thumbnailResult, thumbnailSummary, thumbnailCollectedReferences,
  thumbnailUuid, thumbnailWorker, validResultIdentity,
  thumbnailEditorDocument, type ThumbnailEditorDocument,
  type ThumbnailAttempt, type ThumbnailInput, type ThumbnailJob, type ThumbnailResult, type ThumbnailWorker,
} from './queue-contract';

if (typeof window !== 'undefined') throw new Error('Thumbnail private store is server-only.');

export type ThumbnailDatabase = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
/** No overwrite, listing or removal capability exists on this boundary. Paths are derived from an owned DB job. */
export type ThumbnailStorage = {
  read(path: string, maxBytes: number): Promise<Buffer | null>;
  upload(path: string, bytes: Buffer, mime: string): Promise<void>;
};
export type AuthenticatedThumbnailWorker = ThumbnailWorker & { tokenHash: string };
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const decodeOptions = { limitInputPixels: 16_000_000, animated: false, failOn: 'warning' as const };
const formats = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;
const admittedWorker = (worker: AuthenticatedThumbnailWorker) => parseThumbnail(
  thumbnailWorker.extend({ tokenHash: thumbnailHash }).strict(), worker, 'worker_unauthorized');

export function thumbnailWorkerTokenHash(authorization: string | null) {
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/i.exec(authorization ?? '');
  if (!match) throw new ThumbnailQueueError('worker_unauthorized');
  const decoded = Buffer.from(match[1], 'base64url');
  if (decoded.length < 32 || decoded.length > 96 || decoded.toString('base64url') !== match[1]) {
    throw new ThumbnailQueueError('worker_unauthorized');
  }
  return hash(match[1]);
}

/** The pinned SDK exposes streaming downloads. Cancel before buffering bytes beyond the admitted limit. */
export async function readThumbnailStream(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const reader = stream.getReader(); const chunks: Buffer[] = []; let length = 0; let complete = false;
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new ThumbnailQueueError('storage_unavailable'));
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) { complete = true; return Buffer.concat(chunks, length); }
      length += chunk.value.byteLength;
      if (length > maxBytes) throw new ThumbnailQueueError('object_conflict');
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function supabaseThumbnailStorage(): ThumbnailStorage {
  return {
    read: async (path, maxBytes) => {
      try {
        const signal = AbortSignal.timeout(15_000);
        const { data, error } = await createSupabaseStorageServerClient().from(THUMBNAIL_PRIVATE_BUCKET)
          .download(path, {}, { cache: 'no-store', signal }).asStream();
        if (error) {
          // A missing bucket is an unavailable installation, not proof of a missing object.
          const code = 'code' in error ? error.code : undefined;
          if (code === 'NoSuchKey') return null;
          throw new ThumbnailQueueError('storage_unavailable');
        }
        if (!data) throw new ThumbnailQueueError('storage_unavailable');
        return await readThumbnailStream(data, maxBytes, signal);
      } catch (error) {
        if (error instanceof ThumbnailQueueError) throw error;
        throw new ThumbnailQueueError('storage_unavailable');
      }
    },
    upload: async (path, bytes, mime) => {
      // Never use upsert:true, including after timeout. Readback below reconciles ambiguous writes.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const { error } = await Promise.race([
          createSupabaseStorageServerClient().from(THUMBNAIL_PRIVATE_BUCKET)
            .upload(path, bytes, { contentType: mime, cacheControl: '0', upsert: false }),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ThumbnailQueueError('write_unconfirmed')), 15_000); }),
        ]);
        if (error) throw new ThumbnailQueueError('write_unconfirmed');
      } finally { if (timer) clearTimeout(timer); }
    },
  };
}

function defaultDatabase(): ThumbnailDatabase {
  return { rpc: async (name, args) => await createSupabaseServiceRoleClient()
    .rpc(name as never, args as never).retry(false).abortSignal(AbortSignal.timeout(15_000)) };
}
function knownFailure(error: unknown): ThumbnailQueueError | null {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : null;
  if (message === 'invalid_input') return new ThumbnailQueueError('invalid_request');
  return typeof message === 'string' && Object.hasOwn(THUMBNAIL_FAILURES, message)
    ? new ThumbnailQueueError(message as keyof typeof THUMBNAIL_FAILURES) : null;
}
async function decode(bytes: Buffer, mime: string) {
  try {
    const meta = await sharp(bytes, decodeOptions).metadata();
    if (!meta.format || formats[meta.format as keyof typeof formats] !== mime || !meta.width || !meta.height
      || (meta.pages ?? 1) !== 1 || meta.width * meta.height > 16_000_000) throw new Error('invalid');
    await sharp(bytes, decodeOptions).raw().toBuffer();
    return { width: meta.width, height: meta.height };
  } catch { throw new ThumbnailQueueError('invalid_result'); }
}
function jsonBytes(bytes: Buffer): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ThumbnailQueueError('object_conflict'); }
}
function safeChatContext(context: ThumbnailChatContext) {
  // Screen bounded typed text, not coordinate-like editor geometry or the raw HTTP envelope.
  try { assertPrivacySafe([context.message, context.currentTopic, context.currentHeadline, context.currentSubHeadline,
    ...context.currentTextLayers.map((layer) => layer.content), ...context.conversationMessages.map((turn) => turn.content),
    context.lastCanvasActionLabel ?? '', context.focusContext?.label ?? '', context.focusContext?.promptContext ?? '',
    context.focusContext?.detail ?? '', ...context.referenceImageAttachments.map((attachment) => attachment.name)],
  { maxEntries: 256, maxStringLength: 24_000 }); }
  catch { throw new ThumbnailQueueError('invalid_request'); }
}

export class ThumbnailPrivateStore {
  constructor(private readonly database: ThumbnailDatabase = defaultDatabase(),
    private readonly storage: ThumbnailStorage = supabaseThumbnailStorage()) {}

  private async rpc(name: string, args: Record<string, unknown>, mutation = false) {
    try {
      const { data, error } = await this.database.rpc(name, args);
      if (error) throw knownFailure(error) ?? new ThumbnailQueueError(mutation ? 'write_unconfirmed' : 'persistence_unavailable');
      return data;
    } catch (error) {
      if (error instanceof ThumbnailQueueError) throw error;
      throw new ThumbnailQueueError(mutation ? 'write_unconfirmed' : 'persistence_unavailable');
    }
  }
  private admin(owner: string, action: string, args: Record<string, unknown> = {}, mutation = false) {
    return this.rpc('thumbnail_production_admin', { p_owner_id: parseThumbnail(thumbnailUuid, owner), p_action: action, ...args }, mutation);
  }
  private owned(owner: string, raw: unknown): ThumbnailJob {
    const job = parseThumbnail(thumbnailJob, raw, 'persistence_unavailable');
    if (job.ownerId !== owner) throw new ThumbnailQueueError('owner_forbidden');
    return job;
  }
  async get(owner: string, jobId: string) {
    owner = parseThumbnail(thumbnailUuid, owner);
    return this.owned(owner, await this.admin(owner, 'snapshot', { p_job_id: parseThumbnail(thumbnailUuid, jobId) }));
  }
  async request(owner: string, requestId: string) {
    owner = parseThumbnail(thumbnailUuid, owner);
    const raw = await this.admin(owner, 'request', { p_request_id: parseThumbnail(thumbnailUuid, requestId) });
    if (raw === null) return null;
    const job = this.owned(owner, raw);
    if (job.requestId !== requestId.toLowerCase()) throw new ThumbnailQueueError('persistence_unavailable');
    return job;
  }
  async list(owner: string, cursor?: { beforeCreatedAt: string; beforeId: string }) {
    const input = cursor ? parseThumbnail(z.object({ beforeCreatedAt: z.iso.datetime({ offset: true }), beforeId: thumbnailUuid }).strict(), cursor) : null;
    return parseThumbnail(z.array(thumbnailSummary).max(32), await this.admin(owner, 'list', { p_input: input }), 'persistence_unavailable');
  }
  async referenceCandidates(owner: string) {
    return parseThumbnail(thumbnailCollectedReferences,
      await this.admin(owner, 'reference_candidates', {}), 'persistence_unavailable');
  }
  private async immutable(path: string, bytes: Buffer, mime: string) {
    const existing = await this.storage.read(path, bytes.length);
    if (existing) {
      if (!existing.equals(bytes)) throw new ThumbnailQueueError('object_conflict');
      return;
    }
    try { await this.storage.upload(path, bytes, mime); }
    catch { /* The upload may already be durable. Never delete or overwrite it. */ }
    let actual: Buffer | null;
    try { actual = await this.storage.read(path, bytes.length); }
    catch { throw new ThumbnailQueueError('write_unconfirmed'); }
    if (!actual) throw new ThumbnailQueueError('write_unconfirmed');
    if (!actual.equals(bytes)) throw new ThumbnailQueueError('object_conflict');
  }
  async enqueue(owner: string, requestId: string, content: ThumbnailGeminiContent, editor?: ThumbnailEditorDocument) {
    owner = parseThumbnail(thumbnailUuid, owner); requestId = parseThumbnail(thumbnailUuid, requestId);
    const document = editor ? parseThumbnail(thumbnailEditorDocument, editor) : undefined;
    const prepared = await prepareThumbnailGeminiContent(content);
    try {
      assertPrivacySafeText(prepared.prompt);
      if (document) assertPrivacySafe([document.topic, document.headline, document.subHeadline,
        ...document.textLayers.map((layer) => layer.content)], { maxEntries: 256 });
    } catch { throw new ThumbnailQueueError('invalid_request'); }
    const input: ThumbnailInput = parseThumbnail(thumbnailInput, { contract: 'thumbnail-gemini-image-v1', model: prepared.model,
      prompt: prepared.prompt, references: prepared.references.map((ref, index) => ({
        path: inputPath(owner, requestId, index, ref.sha256, ref.mimeType), sha256: ref.sha256,
        mimeType: ref.mimeType, bytes: ref.bytes.length, role: ref.role,
      })) });
    const same = (job: ThumbnailJob) => job.requestId === requestId && job.inputSha256 === prepared.inputSha256
      && job.model === prepared.model && isDeepStrictEqual(job.input, input);
    const prior = await this.request(owner, requestId);
    if (prior) {
      if (!same(prior)) throw new ThumbnailQueueError('request_conflict');
      if (document && !isDeepStrictEqual(await this.editor(owner, prior.id), document)) {
        throw new ThumbnailQueueError('request_conflict');
      }
      return prior;
    }
    if (document) {
      await this.immutable(`${owner}/${requestId}/input/editor.json`, Buffer.from(JSON.stringify({ ownerId: owner,
        requestId, inputSha256: prepared.inputSha256, document })), 'application/json');
    }
    for (const [index, reference] of prepared.references.entries()) {
      await this.immutable(input.references[index].path, reference.bytes, reference.mimeType);
    }
    try {
      const job = this.owned(owner, await this.admin(owner, 'enqueue', { p_request_id: requestId,
        p_input_sha256: prepared.inputSha256, p_model: prepared.model, p_input: input }, true));
      if (!same(job)) throw new ThumbnailQueueError('write_unconfirmed');
      return job;
    } catch (error) {
      if (!(error instanceof ThumbnailQueueError) || error.code !== 'write_unconfirmed') throw error;
      let recovered: ThumbnailJob | null = null;
      try { recovered = await this.request(owner, requestId); } catch { /* Leave uncertain input intact. */ }
      if (recovered && same(recovered)) return recovered;
      throw new ThumbnailQueueError('write_unconfirmed');
    }
  }
  async editor(owner: string, jobId: string) {
    const job = await this.get(owner, jobId);
    const bytes = await this.storage.read(`${job.ownerId}/${job.requestId}/input/editor.json`, 65_536);
    if (!bytes) return null;
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ThumbnailQueueError('object_conflict'); }
    const parsed = parseThumbnail(z.object({ ownerId: thumbnailUuid, requestId: thumbnailUuid,
      inputSha256: thumbnailHash, document: thumbnailEditorDocument }).strict(), value, 'object_conflict');
    if (parsed.ownerId !== job.ownerId || parsed.requestId !== job.requestId || parsed.inputSha256 !== job.inputSha256) {
      throw new ThumbnailQueueError('object_conflict');
    }
    return parsed.document;
  }
  private ownedChat(owner: string, raw: unknown): ThumbnailChatJob {
    const job = parseThumbnail(thumbnailChatJob, raw, 'persistence_unavailable');
    if (job.ownerId !== owner) throw new ThumbnailQueueError('owner_forbidden');
    return job;
  }
  async chatGet(owner: string, jobId: string) {
    owner = parseThumbnail(thumbnailUuid, owner);
    const job = this.ownedChat(owner, await this.admin(owner, 'chat_snapshot', { p_job_id: parseThumbnail(thumbnailUuid, jobId) }));
    if (job.id !== jobId.toLowerCase()) throw new ThumbnailQueueError('persistence_unavailable');
    return job;
  }
  async chatRequest(owner: string, requestId: string) {
    owner = parseThumbnail(thumbnailUuid, owner); requestId = parseThumbnail(thumbnailUuid, requestId);
    const raw = await this.admin(owner, 'chat_request', { p_request_id: requestId });
    if (raw === null) return null;
    const job = this.ownedChat(owner, raw);
    if (job.requestId !== requestId) throw new ThumbnailQueueError('persistence_unavailable');
    return job;
  }
  async enqueueChat(owner: string, requestId: string, rawContext: unknown) {
    owner = parseThumbnail(thumbnailUuid, owner); requestId = parseThumbnail(thumbnailUuid, requestId);
    const prepared = prepareThumbnailChatContent(rawContext); safeChatContext(prepared.context);
    const input = parseThumbnail(thumbnailChatInput, { contract: 'thumbnail-gemini-chat-v1', model: prepared.model,
      document: { path: `${owner}/${requestId}/input/chat.json`, sha256: prepared.documentSha256,
        bytes: prepared.documentBytes.length, mimeType: 'application/json' } });
    const same = (job: ThumbnailChatJob) => job.requestId === requestId && job.inputSha256 === prepared.inputSha256
      && job.model === prepared.model && isDeepStrictEqual(job.input, input);
    const prior = await this.chatRequest(owner, requestId);
    if (prior) {
      if (!same(prior)) throw new ThumbnailQueueError('request_conflict');
      await this.chatContext(prior);
      return prior;
    }
    await this.immutable(input.document.path, prepared.documentBytes, 'application/json');
    try {
      const job = this.ownedChat(owner, await this.admin(owner, 'enqueue', { p_request_id: requestId,
        p_input_sha256: prepared.inputSha256, p_model: prepared.model, p_input: input }, true));
      if (!same(job)) throw new ThumbnailQueueError('write_unconfirmed');
      return job;
    } catch (error) {
      if (!(error instanceof ThumbnailQueueError) || error.code !== 'write_unconfirmed') throw error;
      let recovered: ThumbnailChatJob | null = null;
      try { recovered = await this.chatRequest(owner, requestId); } catch { /* GET only; no new provider permission. */ }
      if (recovered && same(recovered)) return recovered;
      throw new ThumbnailQueueError('write_unconfirmed');
    }
  }
  private async chatContext(job: ThumbnailChatJob) {
    const asset = job.input.document, bytes = await this.storage.read(asset.path, THUMBNAIL_CHAT_DOCUMENT_BYTES);
    if (!bytes || bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw new ThumbnailQueueError('object_conflict');
    const context = parseThumbnail(thumbnailChatContext, jsonBytes(bytes), 'object_conflict'); safeChatContext(context);
    const prepared = prepareThumbnailChatContent(context);
    if (prepared.inputSha256 !== job.inputSha256 || prepared.documentSha256 !== asset.sha256) throw new ThumbnailQueueError('object_conflict');
    return context;
  }
  async chatOutput(owner: string, jobId: string) {
    const job = await this.chatGet(owner, jobId);
    if (job.state !== 'succeeded' || !job.result) throw new ThumbnailQueueError('job_not_found');
    return { response: await this.verifiedChatOutput(job, job.result), provenance: job.result.provenance };
  }
  async chatCancel(owner: string, jobId: string) {
    owner = parseThumbnail(thumbnailUuid, owner); jobId = parseThumbnail(thumbnailUuid, jobId);
    const job = this.ownedChat(owner, await this.admin(owner, 'chat_cancel', { p_job_id: jobId }, true));
    if (job.id !== jobId || (!job.cancelRequested && job.state !== 'succeeded')) throw new ThumbnailQueueError('write_unconfirmed');
    return job;
  }
  async cancel(owner: string, jobId: string) {
    const job = this.owned(parseThumbnail(thumbnailUuid, owner), await this.admin(owner, 'cancel', { p_job_id: parseThumbnail(thumbnailUuid, jobId) }, true));
    if (job.id !== jobId.toLowerCase() || (!job.cancelRequested && job.state !== 'succeeded')) throw new ThumbnailQueueError('write_unconfirmed');
    return job;
  }
  async authenticate(authorization: string | null): Promise<AuthenticatedThumbnailWorker> {
    const tokenHash = thumbnailWorkerTokenHash(authorization);
    const identity = parseThumbnail(thumbnailWorker,
      await this.rpc('thumbnail_production_auth_worker', { p_token_sha256: tokenHash }), 'worker_unauthorized');
    return { ...identity, tokenHash };
  }
  async workerOperation(worker: AuthenticatedThumbnailWorker, action: 'models' | 'claim' | 'start' | 'heartbeat' | 'unknown',
    attempt?: ThumbnailAttempt, models?: string[]) {
    worker = admittedWorker(worker);
    const args: Record<string, unknown> = { p_token_sha256: worker.tokenHash, p_action: action };
    if (['start', 'heartbeat', 'unknown'].includes(action)) {
      attempt = parseThumbnail(thumbnailAttempt, attempt);
      Object.assign(args, { p_job_id: attempt.jobId, p_attempt_id: attempt.attemptId, p_fence: attempt.fence, p_input_sha256: attempt.inputSha256 });
    }
    if (action === 'models') args.p_payload = { models: parseThumbnail(thumbnailWorker.shape.models, models) };
    const raw = await this.rpc('thumbnail_production_worker', args, true);
    if (action === 'models') return parseThumbnail(z.object({ models: thumbnailWorker.shape.models }).strict(), raw, 'persistence_unavailable');
    if (raw === null && action === 'claim') return null;
    // Only the direct committed start response grants fresh permission. No snapshot/readback can grant it.
    if (action === 'start') {
      const receipt = parseThumbnail(thumbnailExecutionStartReceipt, raw, 'write_unconfirmed');
      if (!attempt || receipt.ownerId !== worker.ownerId || !worker.models.includes(receipt.model)
        || receipt.jobId !== attempt.jobId || receipt.attemptId !== attempt.attemptId
        || receipt.fence !== attempt.fence || receipt.inputSha256 !== attempt.inputSha256) throw new ThumbnailQueueError('attempt_conflict');
      return receipt;
    }
    const job = parseThumbnail(thumbnailExecutionJob, raw, 'persistence_unavailable');
    if (job.ownerId !== worker.ownerId) throw new ThumbnailQueueError('owner_forbidden');
    if (job.workerId !== worker.id || (attempt && (job.id !== attempt.jobId || job.attemptId !== attempt.attemptId
      || job.fence !== attempt.fence || job.inputSha256 !== attempt.inputSha256))) throw new ThumbnailQueueError('attempt_conflict');
    return job;
  }
  private async workerJob(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt, inputRead = false) {
    worker = admittedWorker(worker);
    attempt = parseThumbnail(thumbnailAttempt, attempt);
    const job = await this.get(worker.ownerId, attempt.jobId);
    if (job.workerId !== worker.id || job.attemptId !== attempt.attemptId || job.fence !== attempt.fence
      || job.inputSha256 !== attempt.inputSha256 || !(inputRead ? ['claimed', 'provider_started', 'unknown', 'succeeded']
        : ['provider_started', 'unknown', 'succeeded']).includes(job.state)) {
      throw new ThumbnailQueueError('attempt_conflict');
    }
    return job;
  }
  private async workerChatJob(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt, inputRead = false) {
    worker = admittedWorker(worker); attempt = parseThumbnail(thumbnailAttempt, attempt);
    const job = await this.chatGet(worker.ownerId, attempt.jobId);
    if (job.workerId !== worker.id || job.attemptId !== attempt.attemptId || job.fence !== attempt.fence
      || job.inputSha256 !== attempt.inputSha256 || !(inputRead ? ['claimed', 'provider_started', 'unknown', 'succeeded']
        : ['provider_started', 'unknown', 'succeeded']).includes(job.state)) throw new ThumbnailQueueError('attempt_conflict');
    return job;
  }
  async workerChatContext(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt) {
    return await this.chatContext(await this.workerChatJob(worker, attempt, true));
  }
  private async verifiedChatOutput(job: ThumbnailChatJob, result: ThumbnailChatResult) {
    const bytes = await this.storage.read(result.content.path, THUMBNAIL_CHAT_RESULT_BYTES);
    if (!bytes || bytes.length !== result.content.bytes || hash(bytes) !== result.content.sha256) throw new ThumbnailQueueError('object_conflict');
    const context = await this.chatContext(job);
    try {
      const response = validateThumbnailChatResponse(jsonBytes(bytes), context);
      assertPrivacySafe([response.assistantMessage, ...Object.values(response.canvasPatch),
        ...response.textLayerPatches.map((patch) => patch.content ?? '')], { maxStringLength: 24_000, maxEntries: 128 });
      return response;
    } catch { throw new ThumbnailQueueError('invalid_result'); }
  }
  async saveChatResult(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt, original: Uint8Array, rawProvenance: unknown) {
    if (!(original instanceof Uint8Array) || original.length < 16 || original.length > THUMBNAIL_CHAT_RESULT_BYTES) throw new ThumbnailQueueError('invalid_result');
    const bytes = Buffer.from(original); worker = admittedWorker(worker); attempt = parseThumbnail(thumbnailAttempt, attempt);
    const proof = parseThumbnail(thumbnailChatProvenance, rawProvenance, 'invalid_result');
    const job = await this.workerChatJob(worker, attempt), context = await this.chatContext(job);
    try {
      const response = validateThumbnailChatResponse(jsonBytes(bytes), context);
      assertPrivacySafe([response.assistantMessage, ...Object.values(response.canvasPatch),
        ...response.textLayerPatches.map((patch) => patch.content ?? '')], { maxStringLength: 24_000, maxEntries: 128 });
    } catch { throw new ThumbnailQueueError('invalid_result'); }
    if (proof.inputSha256 !== job.inputSha256 || proof.attemptId !== job.attemptId) throw new ThumbnailQueueError('attempt_conflict');
    const result = parseThumbnail(thumbnailChatResult, { content: { path: `${resultPrefix(job)}response.json`, sha256: hash(bytes),
      bytes: bytes.length, mimeType: 'application/json' }, provenance: proof }, 'invalid_result');
    const recovery = { contract: 'thumbnail-chat-recovery-v1', ownerId: job.ownerId, jobId: job.id,
      workerId: worker.id, attemptId: job.attemptId, fence: job.fence, inputSha256: job.inputSha256, result };
    await this.immutable(`${resultPrefix(job)}recovery.json`, Buffer.from(JSON.stringify(recovery)), 'application/json');
    await this.immutable(result.content.path, bytes, 'application/json');
    return await this.completeChat(worker, job, result);
  }
  async recoverChatResult(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt) {
    worker = admittedWorker(worker); attempt = parseThumbnail(thumbnailAttempt, attempt);
    const job = await this.workerChatJob(worker, attempt), bytes = await this.storage.read(`${resultPrefix(job)}recovery.json`, 16_384);
    if (!bytes) throw new ThumbnailQueueError('write_unconfirmed');
    const saved = parseThumbnail(z.object({ contract: z.literal('thumbnail-chat-recovery-v1'), ownerId: thumbnailUuid,
      jobId: thumbnailUuid, workerId: thumbnailUuid, ...thumbnailAttempt.omit({ jobId: true }).shape,
      result: thumbnailChatResult }).strict(), jsonBytes(bytes), 'object_conflict');
    if (saved.ownerId !== job.ownerId || saved.jobId !== job.id || saved.workerId !== worker.id || saved.attemptId !== job.attemptId
      || saved.fence !== job.fence || saved.inputSha256 !== job.inputSha256 || saved.result.provenance.attemptId !== job.attemptId
      || saved.result.provenance.inputSha256 !== job.inputSha256 || saved.result.content.path !== `${resultPrefix(job)}response.json`) {
      throw new ThumbnailQueueError('object_conflict');
    }
    await this.verifiedChatOutput(job, saved.result);
    return await this.completeChat(worker, job, saved.result);
  }
  private async completeChat(worker: AuthenticatedThumbnailWorker, job: ThumbnailChatJob, result: ThumbnailChatResult) {
    const same = (current: ThumbnailChatJob) => current.id === job.id && current.ownerId === job.ownerId
      && current.workerId === worker.id && current.attemptId === job.attemptId && current.fence === job.fence
      && current.inputSha256 === job.inputSha256 && current.model === job.model && current.state === 'succeeded'
      && isDeepStrictEqual(current.result, result);
    try {
      const current = this.ownedChat(job.ownerId, await this.rpc('thumbnail_production_worker', {
        p_token_sha256: worker.tokenHash, p_action: 'complete', p_job_id: job.id, p_attempt_id: job.attemptId,
        p_fence: job.fence, p_input_sha256: job.inputSha256, p_payload: result }, true));
      if (!same(current)) throw new ThumbnailQueueError('write_unconfirmed');
      return current;
    } catch (error) {
      if (!(error instanceof ThumbnailQueueError) || error.code !== 'write_unconfirmed') throw error;
      let current: ThumbnailChatJob | null = null;
      try { current = await this.chatGet(job.ownerId, job.id); } catch { /* Preserve the original result on uncertain readback. */ }
      if (current && same(current)) return current;
      throw new ThumbnailQueueError('write_unconfirmed');
    }
  }
  async workerReference(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt, index: number) {
    worker = admittedWorker(worker);
    const job = await this.workerJob(worker, attempt, true);
    return await this.reference(job.ownerId, job.id, index);
  }
  async reference(owner: string, jobId: string, index: number) {
    const job = await this.get(owner, jobId);
    if (!Number.isSafeInteger(index) || index < 0 || index >= job.input.references.length) throw new ThumbnailQueueError('invalid_request');
    const ref = job.input.references[index];
    const bytes = await this.storage.read(ref.path, THUMBNAIL_REFERENCE_BYTES);
    if (!bytes || bytes.length !== ref.bytes || hash(bytes) !== ref.sha256) throw new ThumbnailQueueError('object_conflict');
    await decode(bytes, ref.mimeType);
    return { bytes, mimeType: ref.mimeType };
  }
  async resultImage(owner: string, jobId: string, variant: 'original' | 'normalized') {
    const job = await this.get(owner, jobId);
    if (!job.result || job.state !== 'succeeded') throw new ThumbnailQueueError('job_not_found');
    const asset = job.result[variant]; const bytes = await this.verifiedAsset(asset);
    return { bytes, mimeType: asset.mimeType };
  }
  private async validAssetBytes(asset: ThumbnailResult['original'], bytes: Buffer | null) {
    if (!bytes || bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw new ThumbnailQueueError('object_conflict');
    const actual = await decode(bytes, asset.mimeType);
    if (actual.width !== asset.width || actual.height !== asset.height) throw new ThumbnailQueueError('object_conflict');
    return bytes;
  }
  private async verifiedAsset(asset: ThumbnailResult['original']) {
    return await this.validAssetBytes(asset, await this.storage.read(asset.path, THUMBNAIL_IMAGE_BYTES));
  }
  async saveResult(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt, original: Uint8Array,
    mime: string, rawProvenance: unknown) {
    // Copy all mutable material before any await. Proof timestamps/response IDs are never regenerated on retry.
    if (!(original instanceof Uint8Array) || original.byteLength < 16 || original.byteLength > THUMBNAIL_IMAGE_BYTES) {
      throw new ThumbnailQueueError('invalid_result');
    }
    const bytes = Buffer.from(original);
    worker = admittedWorker(worker); attempt = parseThumbnail(thumbnailAttempt, attempt);
    const proof = parseThumbnail(thumbnailProvenance, rawProvenance, 'invalid_result');
    const job = await this.workerJob(worker, attempt);
    const dimensions = await decode(bytes, mime);
    const originalAsset = { path: `${resultPrefix(job)}original.${extension(mime as ThumbnailResult['original']['mimeType'])}`,
      sha256: hash(bytes), mimeType: mime, bytes: bytes.length, ...dimensions };
    const existing = await this.recovery(worker, job);
    if (existing) {
      if (!isDeepStrictEqual(existing.result.original, originalAsset) || !isDeepStrictEqual(existing.result.provenance, proof)) {
        throw new ThumbnailQueueError('object_conflict');
      }
      // Preserve the original even if this encoder cannot reproduce an older derivative's bytes.
      await this.immutable(existing.result.original.path, bytes, mime);
      return await this.recoverResult(worker, attempt);
    }
    const normalized = await sharp(bytes, decodeOptions).rotate().resize(1280, 720, { fit: 'cover' }).png().toBuffer();
    const manifest = parseThumbnail(thumbnailResult, {
      original: originalAsset,
      normalized: { path: `${resultPrefix(job)}normalized.png`, sha256: hash(normalized), mimeType: 'image/png',
        bytes: normalized.length, width: 1280, height: 720 }, provenance: proof,
    }, 'invalid_result');
    if (!validResultIdentity(job, manifest)) throw new ThumbnailQueueError('invalid_result');
    // Durable proof precedes images. A manifest with missing image objects is incomplete, never a success.
    const recovery = { contract: 'thumbnail-recovery-v1', ownerId: job.ownerId, jobId: job.id,
      workerId: worker.id, attemptId: job.attemptId, fence: job.fence, inputSha256: job.inputSha256, result: manifest };
    await this.immutable(`${resultPrefix(job)}recovery.json`, Buffer.from(JSON.stringify(recovery)), 'application/json');
    await this.immutable(manifest.original.path, bytes, mime);
    await this.immutable(manifest.normalized.path, normalized, 'image/png');
    return await this.complete(worker, job, manifest);
  }
  async recoverResult(worker: AuthenticatedThumbnailWorker, attempt: ThumbnailAttempt) {
    worker = admittedWorker(worker); attempt = parseThumbnail(thumbnailAttempt, attempt);
    const job = await this.workerJob(worker, attempt);
    const saved = await this.recovery(worker, job);
    if (!saved) throw new ThumbnailQueueError('write_unconfirmed');
    const original = await this.verifiedAsset(saved.result.original);
    const normalized = await this.storage.read(saved.result.normalized.path, THUMBNAIL_IMAGE_BYTES);
    if (normalized === null) {
      // Only a deterministic derivative can be rebuilt. Keep original proof/hash unchanged across recovery.
      const derived = await sharp(original, decodeOptions).rotate().resize(1280, 720, { fit: 'cover' }).png().toBuffer();
      await this.validAssetBytes(saved.result.normalized, derived);
      await this.immutable(saved.result.normalized.path, derived, 'image/png');
    } else await this.validAssetBytes(saved.result.normalized, normalized);
    return await this.complete(worker, job, saved.result);
  }
  private async recovery(worker: AuthenticatedThumbnailWorker, job: ThumbnailJob) {
    const bytes = await this.storage.read(`${resultPrefix(job)}recovery.json`, 16_384);
    if (!bytes) return null;
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ThumbnailQueueError('object_conflict'); }
    const saved = parseThumbnail(z.object({ contract: z.literal('thumbnail-recovery-v1'), ownerId: thumbnailUuid,
      jobId: thumbnailUuid, workerId: thumbnailUuid, attemptId: thumbnailUuid, fence: thumbnailAttempt.shape.fence,
      inputSha256: thumbnailHash, result: thumbnailResult }).strict(), raw, 'object_conflict');
    if (saved.ownerId !== job.ownerId || saved.jobId !== job.id || saved.workerId !== worker.id
      || saved.attemptId !== job.attemptId || saved.fence !== job.fence || saved.inputSha256 !== job.inputSha256
      || !validResultIdentity(job, saved.result)) throw new ThumbnailQueueError('object_conflict');
    return saved;
  }
  private async complete(worker: AuthenticatedThumbnailWorker, job: ThumbnailJob, result: ThumbnailResult) {
    const same = (current: ThumbnailJob) => current.id === job.id && current.ownerId === job.ownerId
      && current.workerId === worker.id && current.attemptId === job.attemptId && current.fence === job.fence
      && current.inputSha256 === job.inputSha256 && current.model === job.model && current.state === 'succeeded'
      && isDeepStrictEqual(current.result, result);
    try {
      const current = this.owned(job.ownerId, await this.rpc('thumbnail_production_worker', {
        p_token_sha256: worker.tokenHash, p_action: 'complete', p_job_id: job.id,
        p_attempt_id: job.attemptId, p_fence: job.fence, p_input_sha256: job.inputSha256, p_payload: result,
      }, true));
      if (!same(current)) throw new ThumbnailQueueError('write_unconfirmed');
      return current;
    } catch (error) {
      if (!(error instanceof ThumbnailQueueError) || error.code !== 'write_unconfirmed') throw error;
      let current: ThumbnailJob | null = null;
      try { current = await this.get(job.ownerId, job.id); } catch { /* A read failure is not proof of rollback. */ }
      if (current && same(current)) return current;
      throw new ThumbnailQueueError('write_unconfirmed');
    }
  }
}
