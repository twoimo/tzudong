import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { readBoundedJsonRequest, BOUNDED_JSON_REQUEST_ERROR } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { buildYoutubeThumbnailPrompt, requestsSpecificCreatorHost } from './prompt';
import { ThumbnailGenerationError } from './types';
import { ThumbnailGeminiError } from './gemini-image-input';
import { ThumbnailChatGeminiError } from './gemini-chat-input';
import { thumbnailChatContext, thumbnailChatProvenance } from './chat-contract';
import { THUMBNAIL_CHAT_RESULT_BYTES } from './execution-contract';
import { ThumbnailPrivateStore, type AuthenticatedThumbnailWorker } from './private-store';
import { THUMBNAIL_FAILURES, THUMBNAIL_IMAGE_BYTES, ThumbnailQueueError, parseThumbnail,
  thumbnailAttempt, thumbnailEnqueue, thumbnailMime, thumbnailProvenance, thumbnailUuid, thumbnailWorker, thumbnailBrief } from './queue-contract';

if (typeof window !== 'undefined') throw new Error('Thumbnail queue API is server-only.');
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie, Authorization' };
type JobContext = { params: Promise<{ jobId: string }> };
const json = (value: unknown) => Response.json(value, { headers });
const referenceIndex = z.string().regex(/^[0-7]$/).transform(Number);
export function thumbnailQueueFailure(error: unknown) {
  const code = error instanceof ThumbnailQueueError ? error.code
    : error instanceof ThumbnailGenerationError || error instanceof ThumbnailGeminiError || error instanceof ThumbnailChatGeminiError ? 'invalid_request' : 'persistence_unavailable';
  return Response.json({ ok: false, error: code }, { status: THUMBNAIL_FAILURES[code], headers });
}
function sameOrigin(request: Request) {
  const scoped = new Headers(request.headers); scoped.delete('authorization');
  if (!isTrustedSameOriginMutation(new Request(request.url, { method: request.method, headers: scoped }))) {
    throw new ThumbnailQueueError('origin_forbidden');
  }
}
async function boundedJson(request: Request, limit = 32_768) {
  const result = await readBoundedJsonRequest(request, limit);
  if (!result.ok) throw new ThumbnailQueueError(result.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 'request_too_large' : 'invalid_request');
  return result.value;
}

/** Limit the actual stream before formData buffers it. Also reject duplicate/unknown fields. */
export async function readThumbnailMultipart(request: Request, maxBytes: number, allowed: ReadonlySet<string>) {
  const contentType = request.headers.get('content-type') ?? '';
  const declared = request.headers.get('content-length');
  if (contentType.length > 200 || !/^multipart\/form-data;\s*boundary=/i.test(contentType) || !request.body
    || (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))) {
    throw new ThumbnailQueueError('invalid_request');
  }
  if (declared !== null && Number(declared) > maxBytes) throw new ThumbnailQueueError('request_too_large');
  const reader = request.body.getReader(); const chunks: Buffer[] = []; let total = 0; let complete = false;
  let timer: ReturnType<typeof setTimeout> | undefined; let abort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new ThumbnailQueueError('invalid_request'));
    timer = setTimeout(abort, 15_000); request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) { complete = true; break; }
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new ThumbnailQueueError('request_too_large');
      chunks.push(Buffer.from(chunk.value));
    }
    if (declared !== null && total !== Number(declared)) throw new ThumbnailQueueError('invalid_request');
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) request.signal.removeEventListener('abort', abort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': contentType },
      body: new Blob([new Uint8Array(Buffer.concat(chunks, total))]) }).formData();
  } catch { throw new ThumbnailQueueError('invalid_request'); }
  const keys = [...form.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !allowed.has(key))) throw new ThumbnailQueueError('invalid_request');
  return form;
}
async function formJson(form: FormData, key: string, maxBytes = 16_384): Promise<unknown> {
  const value = form.get(key);
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxBytes) throw new ThumbnailQueueError('invalid_request');
  const result = await readBoundedJsonRequest(new Request('http://localhost/thumbnail-json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: value,
  }), maxBytes);
  if (!result.ok) throw new ThumbnailQueueError('invalid_request');
  return result.value;
}
async function imageFile(form: FormData, key: string, maxBytes: number) {
  const file = form.get(key);
  if (!(file instanceof File) || file.size < 16 || file.size > maxBytes) throw new ThumbnailQueueError('invalid_request');
  const mimeType = parseThumbnail(thumbnailMime, file.type);
  return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType };
}
const operation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('models'), models: thumbnailWorker.shape.models }).strict(),
  z.object({ action: z.literal('claim') }).strict(),
  ...(['start', 'heartbeat', 'unknown', 'recover', 'chat_recover'] as const).map((action) =>
    z.object({ action: z.literal(action), ...thumbnailAttempt.shape }).strict()),
]);

export function createThumbnailQueueApi(options: {
  store?: ThumbnailPrivateStore; authorize?: typeof requireAdmin;
} = {}) {
  const store = options.store ?? new ThumbnailPrivateStore(); const authorize = options.authorize ?? requireAdmin;
  async function admin(request: Request, work: (owner: string) => Promise<Response>) {
    try {
      const auth = await authorize();
      if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status,
        headers: { ...Object.fromEntries(auth.response.headers), ...headers } });
      const owner = parseThumbnail(thumbnailUuid, auth.userId, 'owner_forbidden');
      const expectedOwner = request.headers.get('X-Thumbnail-Owner');
      if (expectedOwner !== null && parseThumbnail(thumbnailUuid, expectedOwner, 'owner_forbidden') !== owner) {
        throw new ThumbnailQueueError('owner_forbidden');
      }
      if (!['GET', 'HEAD'].includes(request.method)) sameOrigin(request);
      return await work(owner);
    } catch (error) { return thumbnailQueueFailure(error); }
  }
  async function worker(request: Request, work: (identity: AuthenticatedThumbnailWorker) => Promise<Response>) {
    try { return await work(await store.authenticate(request.headers.get('authorization'))); }
    catch (error) { return thumbnailQueueFailure(error); }
  }
  return {
    chatLegacyPOST: (request: Request) => admin(request, async () => Response.json({ ok: false,
      error: 'thumbnail_chat_route_retired', replacement: '/api/admin/youtube-thumbnail-generator/chat/jobs' }, { status: 410, headers })),
    chatListPOST: (request: Request) => admin(request, async (owner) => {
      const input = parseThumbnail(z.object({ requestId: thumbnailUuid, context: thumbnailChatContext }).strict(), await boundedJson(request, 68_000));
      return json({ job: await store.enqueueChat(owner, input.requestId, input.context) });
    }),
    chatListGET: (request: Request) => admin(request, async (owner) => {
      const query = new URL(request.url).searchParams;
      if (query.size !== 1 || query.getAll('requestId').length !== 1) throw new ThumbnailQueueError('invalid_request');
      return json({ job: await store.chatRequest(owner, parseThumbnail(thumbnailUuid, query.get('requestId'))) });
    }),
    chatJobGET: (request: Request, context: JobContext) => admin(request, async (owner) => {
      const jobId = parseThumbnail(thumbnailUuid, (await context.params).jobId), query = new URL(request.url).searchParams;
      if (!query.size) return json({ job: await store.chatGet(owner, jobId) });
      if (query.size !== 1 || query.get('output') !== '1') throw new ThumbnailQueueError('invalid_request');
      return json(await store.chatOutput(owner, jobId));
    }),
    chatJobPOST: (request: Request, context: JobContext) => admin(request, async (owner) => {
      parseThumbnail(z.object({ action: z.literal('cancel') }).strict(), await boundedJson(request));
      return json({ job: await store.chatCancel(owner, parseThumbnail(thumbnailUuid, (await context.params).jobId)) });
    }),
    referenceCandidatesPOST: (request: Request) => admin(request, async (owner) => {
      const input = parseThumbnail(z.object({ brief: thumbnailBrief, slots: z.number().int().min(0).max(8) }).strict(), await boundedJson(request));
      const collected = await store.referenceCandidates(owner);
      const words = `${input.brief.topic} ${input.brief.headline}`.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
      const score = (title: string) => words.reduce((sum, word) => sum + Number(title.toLocaleLowerCase().includes(word)), 0);
      const ranked = collected.candidates.map((candidate, index) => ({ ...candidate, index, score: score(candidate.title) }))
        .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.min(input.slots, 2));
      return json({ channelId: collected.channelId, bucketStartedAt: collected.bucketStartedAt,
        references: ranked.map(({ videoId, title }) => ({ videoId, title,
          role: requestsSpecificCreatorHost(input.brief) ? 'host' : 'other' })) });
    }),
    listGET: (request: Request) => admin(request, async (owner) => {
      const query = new URL(request.url).searchParams;
      const requestId = query.get('requestId');
      if (requestId !== null) {
        if (query.size !== 1) throw new ThumbnailQueueError('invalid_request');
        return json({ job: await store.request(owner, parseThumbnail(thumbnailUuid, requestId)) });
      }
      if ([...query.keys()].some((key) => !['beforeCreatedAt', 'beforeId'].includes(key)) || query.size > 2
        || query.has('beforeCreatedAt') !== query.has('beforeId')) throw new ThumbnailQueueError('invalid_request');
      const cursor = query.has('beforeId') ? { beforeCreatedAt: query.get('beforeCreatedAt')!, beforeId: query.get('beforeId')! } : undefined;
      return json({ jobs: await store.list(owner, cursor) });
    }),
    listPOST: (request: Request) => admin(request, async (owner) => {
      const allowed = new Set(['request', ...Array.from({ length: 8 }, (_, index) => `reference${index}`)]);
      const form = await readThumbnailMultipart(request, 32 * 1024 * 1024 + 65_536, allowed);
      const input = parseThumbnail(thumbnailEnqueue, await formJson(form, 'request', 65_536));
      if ([...form.keys()].length !== input.roles.length + 1) throw new ThumbnailQueueError('invalid_request');
      const references = [];
      for (const [index, role] of input.roles.entries()) {
        references.push({ ...await imageFile(form, `reference${index}`, 8 * 1024 * 1024), role });
      }
      if (requestsSpecificCreatorHost(input.brief) && !references.some((ref) => ['host', 'person'].includes(ref.role))) {
        throw new ThumbnailQueueError('invalid_request');
      }
      const prompt = buildYoutubeThumbnailPrompt({ ...input.brief, textLayers: input.editor?.textLayers }, references.map((ref, index) => ({
        ...ref, mime: ref.mimeType, name: `uploaded-reference-${index}`,
      })));
      return json({ job: await store.enqueue(owner, input.requestId, { model: input.model, prompt, references }, input.editor) });
    }),
    jobGET: (request: Request, context: JobContext) => admin(request, async (owner) => {
      const jobId = parseThumbnail(thumbnailUuid, (await context.params).jobId);
      const query = new URL(request.url).searchParams;
      if (!query.size) return json({ job: await store.get(owner, jobId) });
      if (query.size !== 1) throw new ThumbnailQueueError('invalid_request');
      if (query.get('document') === '1') return json({ document: await store.editor(owner, jobId) });
      const variant = query.get('variant');
      const image = variant === 'original' || variant === 'normalized' ? await store.resultImage(owner, jobId, variant)
        : query.has('reference') ? await store.reference(owner, jobId, parseThumbnail(referenceIndex, query.get('reference')))
          : null;
      if (!image) throw new ThumbnailQueueError('invalid_request');
      return new Response(new Uint8Array(image.bytes), { headers: { ...headers, 'Content-Type': image.mimeType,
        'Content-Length': String(image.bytes.length), 'Content-Disposition': 'inline' } });
    }),
    jobPOST: (request: Request, context: JobContext) => admin(request, async (owner) => {
      parseThumbnail(z.object({ action: z.literal('cancel') }).strict(), await boundedJson(request));
      return json({ job: await store.cancel(owner, parseThumbnail(thumbnailUuid, (await context.params).jobId)) });
    }),
    workerPOST: (request: Request) => worker(request, async (identity) => {
      const op = parseThumbnail(operation, await boundedJson(request));
      if (op.action === 'recover') return json({ job: await store.recoverResult(identity, parseThumbnail(thumbnailAttempt, {
        jobId: op.jobId, attemptId: op.attemptId, fence: op.fence, inputSha256: op.inputSha256,
      })) });
      if (op.action === 'chat_recover') return json({ job: await store.recoverChatResult(identity, parseThumbnail(thumbnailAttempt, {
        jobId: op.jobId, attemptId: op.attemptId, fence: op.fence, inputSha256: op.inputSha256,
      })) });
      const attempt = 'jobId' in op ? { jobId: op.jobId, attemptId: op.attemptId, fence: op.fence, inputSha256: op.inputSha256 } : undefined;
      return json({ result: await store.workerOperation(identity, op.action, attempt, 'models' in op ? op.models : undefined) });
    }),
    workerReferenceGET: (request: Request) => worker(request, async (identity) => {
      const query = new URL(request.url).searchParams;
      const fields = ['jobId', 'attemptId', 'fence', 'inputSha256', 'index'];
      if (query.size !== fields.length || fields.some((key) => query.getAll(key).length !== 1)) throw new ThumbnailQueueError('invalid_request');
      const attempt = parseThumbnail(thumbnailAttempt, { jobId: query.get('jobId'), attemptId: query.get('attemptId'),
        fence: Number(parseThumbnail(z.string().regex(/^[1-9]\d{0,15}$/), query.get('fence'))), inputSha256: query.get('inputSha256') });
      const image = await store.workerReference(identity, attempt, parseThumbnail(referenceIndex, query.get('index')));
      return new Response(new Uint8Array(image.bytes), { headers: { ...headers, 'Content-Type': image.mimeType,
        'Content-Length': String(image.bytes.length), 'Content-Disposition': 'inline' } });
    }),
    workerImagePOST: (request: Request) => worker(request, async (identity) => {
      const form = await readThumbnailMultipart(request, THUMBNAIL_IMAGE_BYTES + 32_768, new Set(['attempt', 'provenance', 'original']));
      if ([...form.keys()].length !== 3) throw new ThumbnailQueueError('invalid_request');
      const attempt = parseThumbnail(thumbnailAttempt, await formJson(form, 'attempt'));
      const proof = parseThumbnail(thumbnailProvenance, await formJson(form, 'provenance'));
      const original = await imageFile(form, 'original', THUMBNAIL_IMAGE_BYTES);
      return json({ job: await store.saveResult(identity, attempt, original.bytes, original.mimeType, proof) });
    }),
    workerChatGET: (request: Request) => worker(request, async (identity) => {
      const query = new URL(request.url).searchParams, fields = ['jobId', 'attemptId', 'fence', 'inputSha256'];
      if (query.size !== fields.length || fields.some((key) => query.getAll(key).length !== 1)) throw new ThumbnailQueueError('invalid_request');
      const attempt = parseThumbnail(thumbnailAttempt, { jobId: query.get('jobId'), attemptId: query.get('attemptId'),
        fence: Number(parseThumbnail(z.string().regex(/^[1-9]\d{0,15}$/), query.get('fence'))), inputSha256: query.get('inputSha256') });
      return json(await store.workerChatContext(identity, attempt));
    }),
    workerChatPOST: (request: Request) => worker(request, async (identity) => {
      const form = await readThumbnailMultipart(request, THUMBNAIL_CHAT_RESULT_BYTES + 16_384, new Set(['attempt', 'provenance', 'response']));
      if ([...form.keys()].length !== 3) throw new ThumbnailQueueError('invalid_request');
      const attempt = parseThumbnail(thumbnailAttempt, await formJson(form, 'attempt'));
      const proof = parseThumbnail(thumbnailChatProvenance, await formJson(form, 'provenance'));
      const file = form.get('response');
      if (!(file instanceof File) || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(file.type)
        || file.size < 16 || file.size > THUMBNAIL_CHAT_RESULT_BYTES) throw new ThumbnailQueueError('invalid_request');
      return json({ job: await store.saveChatResult(identity, attempt, new Uint8Array(await file.arrayBuffer()), proof) });
    }),
  };
}

export const thumbnailQueueApi = createThumbnailQueueApi();
