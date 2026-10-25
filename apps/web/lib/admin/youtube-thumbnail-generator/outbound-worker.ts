import http from 'node:http';
import https from 'node:https';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { GeminiThumbnailWorkerClient, ThumbnailGeminiError, type ThumbnailGeminiImageModel } from './gemini-worker-client';
import { parseThumbnail, thumbnailAttempt, thumbnailStartReceipt, THUMBNAIL_IMAGE_BYTES,
  type ThumbnailAttempt, type ThumbnailJob } from './queue-contract';
import { GeminiThumbnailChatWorkerClient, ThumbnailChatGeminiError, prepareThumbnailChatContent } from './chat-gemini-client';
import { THUMBNAIL_CHAT_MODEL, thumbnailChatContext, thumbnailChatStartReceipt } from './chat-contract';
import { thumbnailExecutionJob, type ThumbnailChatJob, type ThumbnailExecutionJob } from './execution-contract';
import { ThumbnailWorkerOutbox, ThumbnailOutboxError, thumbnailWorkerOrigin,
  type ThumbnailChatOutboxBundle, type ThumbnailOutboxBundle, type ThumbnailOutboxIdentity } from './worker-outbox';

if (typeof window !== 'undefined') throw new Error('Thumbnail outbound worker is worker-only.');
const base = '/api/admin/youtube-thumbnail-generator/worker';
type WorkerOutcome = 'idle' | 'succeeded' | 'held';
type Event = { event: 'claimed' | 'result_saved' | 'delivered' | 'held'; code?: string };
export class ThumbnailWorkerError extends Error {
  constructor(readonly code: 'invalid_worker_configuration' | 'invalid_worker_response' | 'worker_delivery_unknown'
    | 'worker_unauthorized' | 'worker_redirect_refused' | 'worker_rejected' | 'worker_busy' | 'worker_stopped'
    | 'input_mismatch' | 'outbox_pending' | 'provider_outcome_unknown') { super(code); this.name = 'ThumbnailWorkerError'; }
}
export function thumbnailWorkerErrorCode(error: unknown): string {
  if (error instanceof ThumbnailWorkerError || error instanceof ThumbnailOutboxError || error instanceof ThumbnailGeminiError || error instanceof ThumbnailChatGeminiError) return error.code;
  return 'worker_delivery_unknown';
}
export interface ThumbnailWorkerApi {
  readonly origin: string;
  operation(value: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  reference(attempt: ThumbnailAttempt, index: number, expected: ThumbnailJob['input']['references'][number], signal?: AbortSignal): Promise<Buffer>;
  image(attempt: ThumbnailAttempt, result: ThumbnailOutboxBundle, signal?: AbortSignal): Promise<unknown>;
  chatContext?(attempt: ThumbnailAttempt, signal?: AbortSignal): Promise<unknown>;
  chat?(attempt: ThumbnailAttempt, result: ThumbnailChatOutboxBundle, signal?: AbortSignal): Promise<unknown>;
}
export async function readThumbnailWorkerFile(file: string, maxBytes: number): Promise<Buffer> {
  if (!isAbsolute(file)) throw new ThumbnailWorkerError('invalid_worker_configuration');
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600 || before.size > maxBytes
      || (process.getuid && before.uid !== process.getuid())) throw new Error('invalid');
    const bytes = Buffer.alloc(maxBytes + 1); const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (bytesRead > maxBytes || bytesRead !== before.size || before.ino !== after.ino || before.dev !== after.dev
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('invalid');
    return bytes.subarray(0, bytesRead);
  } catch { throw new ThumbnailWorkerError('invalid_worker_configuration'); }
  finally { await handle?.close(); }
}
/** Fixed origin, no proxy/redirect/retry, bounded response bytes and actual deadline. A timeout is uncertain delivery. */
export class ThumbnailWorkerTransport implements ThumbnailWorkerApi {
  readonly origin: string;
  private readonly token: string;
  constructor(options: { origin: string; token: string; timeoutMs?: number }) {
    this.origin = parseThumbnail(thumbnailWorkerOrigin, options.origin.replace(/\/$/, ''));
    const token = options.token;
    const decoded = Buffer.from(token, 'base64url');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token) || decoded.length < 32 || decoded.length > 96
      || decoded.toString('base64url') !== token) throw new ThumbnailWorkerError('invalid_worker_configuration');
    this.token = token; this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) throw new ThumbnailWorkerError('invalid_worker_configuration');
  }
  private readonly timeoutMs: number;
  private request(path: string, method: 'GET' | 'POST', body: Buffer | null, mime: string, maxBytes: number, signal?: AbortSignal,
    expectedMime = method === 'GET' ? 'image/png' : 'application/json'): Promise<Buffer> {
    if (!(path === base || path === `${base}/images` || path === `${base}/chat` || path.startsWith(`${base}/chat?`) || path.startsWith(`${base}/references?`))
      || (body && body.length > THUMBNAIL_IMAGE_BYTES + 32_768)) throw new ThumbnailWorkerError('invalid_worker_configuration');
    if (signal?.aborted) return Promise.reject(new ThumbnailWorkerError('worker_stopped'));
    const target = new URL(this.origin);
    return new Promise((resolve, reject) => {
      let finished = false; let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (error?: ThumbnailWorkerError, bytes?: Buffer) => {
        if (finished) return; finished = true; if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(bytes!);
      };
      const abort = () => { done(new ThumbnailWorkerError('worker_stopped')); request.destroy(); };
      const request = (target.protocol === 'https:' ? https : http).request({
        protocol: target.protocol, hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || 443,
        path, method, agent: false, headers: { Authorization: `Bearer ${this.token}`, Accept: expectedMime,
          ...(body ? { 'Content-Type': mime, 'Content-Length': body.length } : {}) },
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 200) {
          done(new ThumbnailWorkerError(status === 401 || status === 403 ? 'worker_unauthorized'
            : status >= 300 && status < 400 ? 'worker_redirect_refused' : status === 409 || status === 400 ? 'worker_rejected' : 'worker_delivery_unknown'));
          response.destroy(); return;
        }
        if (response.headers['content-type']?.split(';')[0].trim().toLowerCase() !== expectedMime) {
          done(new ThumbnailWorkerError('invalid_worker_response')); response.destroy(); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) { done(new ThumbnailWorkerError('invalid_worker_response')); response.destroy(); }
          else chunks.push(Buffer.from(chunk));
        });
        response.on('aborted', () => done(new ThumbnailWorkerError('worker_delivery_unknown')));
        response.on('error', () => done(new ThumbnailWorkerError('worker_delivery_unknown')));
        response.on('end', () => done(undefined, Buffer.concat(chunks, size)));
      });
      request.on('error', () => done(new ThumbnailWorkerError('worker_delivery_unknown')));
      timer = setTimeout(() => { done(new ThumbnailWorkerError('worker_delivery_unknown')); request.destroy(); }, this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort(); else request.end(body ?? undefined);
    });
  }
  private async json(path: string, body: Buffer, mime: string, signal?: AbortSignal) {
    const bytes = await this.request(path, 'POST', body, mime, 192 * 1024, signal);
    const parsed = await readBoundedJsonRequest(new Request('http://localhost/thumbnail-reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array(bytes),
    }), 192 * 1024);
    if (!parsed.ok) throw new ThumbnailWorkerError('invalid_worker_response');
    return parsed.value;
  }
  operation(value: Record<string, unknown>, signal?: AbortSignal) {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > 32_768) throw new ThumbnailWorkerError('invalid_worker_configuration');
    return this.json(base, bytes, 'application/json', signal);
  }
  async reference(attempt: ThumbnailAttempt, index: number, expected: ThumbnailJob['input']['references'][number], signal?: AbortSignal) {
    if (expected.mimeType !== 'image/png' || !Number.isInteger(index) || index < 0 || index > 7) throw new ThumbnailWorkerError('input_mismatch');
    const query = new URLSearchParams({ ...attempt, fence: String(attempt.fence), index: String(index) });
    const bytes = await this.request(`${base}/references?${query}`, 'GET', null, '', expected.bytes, signal);
    if (bytes.length !== expected.bytes) throw new ThumbnailWorkerError('input_mismatch');
    return bytes;
  }
  image(attempt: ThumbnailAttempt, result: ThumbnailOutboxBundle, signal?: AbortSignal) {
    // No raw request/body logging. Boundaries and field names are fixed; filenames contain no user text.
    const boundary = `thumbnail-${randomUUID()}`;
    const fields = { attempt: JSON.stringify(attempt), provenance: JSON.stringify(result.provenance) };
    const pieces = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="original"; filename="original.png"\r\nContent-Type: ${result.original.mimeType}\r\n\r\n`),
      Buffer.from(result.bytes), Buffer.from(`\r\n--${boundary}--\r\n`));
    return this.json(`${base}/images`, Buffer.concat(pieces), `multipart/form-data; boundary=${boundary}`, signal);
  }
  async chatContext(attempt: ThumbnailAttempt, signal?: AbortSignal) {
    const query = new URLSearchParams({ ...attempt, fence: String(attempt.fence) });
    const bytes = await this.request(`${base}/chat?${query}`, 'GET', null, '', 65_536, signal, 'application/json');
    try { return thumbnailChatContext.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
    catch { throw new ThumbnailWorkerError('invalid_worker_response'); }
  }
  chat(attempt: ThumbnailAttempt, result: ThumbnailChatOutboxBundle, signal?: AbortSignal) {
    const boundary = `thumbnail-chat-${randomUUID()}`;
    const fields = { attempt: JSON.stringify(attempt), provenance: JSON.stringify(result.provenance) };
    const pieces = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response"; filename="response.json"\r\nContent-Type: application/json\r\n\r\n`),
      Buffer.from(result.bytes), Buffer.from(`\r\n--${boundary}--\r\n`));
    return this.json(`${base}/chat`, Buffer.concat(pieces), `multipart/form-data; boundary=${boundary}`, signal);
  }
}

type Gemini = Pick<GeminiThumbnailWorkerClient, 'models' | 'prepareStored'>;
type ChatGemini = Pick<GeminiThumbnailChatWorkerClient, 'models' | 'prepareStored'>;
function resultField(raw: unknown, field: 'job' | 'result'): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || !(field in raw)) {
    throw new ThumbnailWorkerError('invalid_worker_response');
  }
  return (raw as Record<string, unknown>)[field];
}
export class OutboundThumbnailWorker {
  private running = false;
  private client?: Gemini;
  private chatClient?: ChatGemini;
  constructor(private readonly options: { api: ThumbnailWorkerApi; outbox: ThumbnailWorkerOutbox; gemini: Gemini | (() => Gemini);
    chatGemini?: ChatGemini | (() => ChatGemini);
    heartbeatMs?: number; onEvent?: (event: Event) => void }) {
    parseThumbnail(thumbnailWorkerOrigin, options.api.origin);
    if (!Number.isInteger(options.heartbeatMs ?? 30_000) || (options.heartbeatMs ?? 30_000) < 1 || (options.heartbeatMs ?? 30_000) > 30_000) {
      throw new ThumbnailWorkerError('invalid_worker_configuration');
    }
  }
  private gemini() { return this.client ??= typeof this.options.gemini === 'function' ? this.options.gemini() : this.options.gemini; }
  private chatGemini() {
    const source = this.options.chatGemini;
    if (!source) throw new ThumbnailWorkerError('invalid_worker_configuration');
    return this.chatClient ??= typeof source === 'function' ? source() : source;
  }
  private event(event: Event) { try { this.options.onEvent?.(event); } catch { /* Telemetry cannot discard a paid result. */ } }
  private attempt(identity: ThumbnailOutboxIdentity): ThumbnailAttempt {
    return { jobId: identity.jobId, attemptId: identity.attemptId, fence: identity.fence, inputSha256: identity.inputSha256 };
  }
  private async deliver(identity: ThumbnailOutboxIdentity, signal?: AbortSignal): Promise<WorkerOutcome> {
    if (identity.origin !== this.options.api.origin) throw new ThumbnailWorkerError('invalid_worker_configuration');
    const raw = identity.model === THUMBNAIL_CHAT_MODEL
      ? await this.options.api.chat?.(this.attempt(identity), this.options.outbox.chatResult(identity), signal)
      : await this.options.api.image(this.attempt(identity), this.options.outbox.result(identity), signal);
    if (!raw) throw new ThumbnailWorkerError('invalid_worker_configuration');
    this.options.outbox.delivered(identity, resultField(raw, 'job'));
    this.event({ event: 'delivered' }); return 'succeeded';
  }
  async runOnce(signal?: AbortSignal): Promise<WorkerOutcome> {
    if (this.running) throw new ThumbnailWorkerError('worker_busy'); this.running = true;
    try {
      signal?.throwIfAborted();
      const pending = this.options.outbox.pending();
      for (const item of pending) {
        if (item.identity.origin !== this.options.api.origin) throw new ThumbnailWorkerError('invalid_worker_configuration');
        if (item.phase === 'result_saved') return await this.deliver(item.identity, signal);
        // This may belong to another LIVE process. Recovery cannot mutate its remote lease/state.
        // Only the original run can report its settled unknown outcome; a tombstone grants no paid retry.
        this.event({ event: 'held', code: 'outbox_pending' }); return 'held';
      }
      const models: Array<ThumbnailGeminiImageModel | typeof THUMBNAIL_CHAT_MODEL> = await this.gemini().models(signal);
      if (this.options.chatGemini) models.push(...await this.chatGemini().models(signal));
      await this.options.api.operation({ action: 'models', models }, signal);
      const claimed = resultField(await this.options.api.operation({ action: 'claim' }, signal), 'result');
      if (claimed === null) return 'idle';
      const job = parseThumbnail(thumbnailExecutionJob, claimed);
      if (job.state !== 'claimed' || !job.workerId || !job.attemptId || !models.includes(job.model)) throw new ThumbnailWorkerError('invalid_worker_response');
      return await this.process(job, signal);
    } catch (error) {
      this.event({ event: 'held', code: thumbnailWorkerErrorCode(error) }); return 'held';
    } finally { this.running = false; }
  }
  private async process(job: ThumbnailExecutionJob, stop?: AbortSignal): Promise<WorkerOutcome> {
    const attempt = parseThumbnail(thumbnailAttempt, { jobId: job.id, attemptId: job.attemptId, fence: job.fence, inputSha256: job.inputSha256 });
    const scope = new AbortController(); const abort = () => scope.abort();
    stop?.addEventListener('abort', abort, { once: true }); if (stop?.aborted) abort();
    const heartbeat = new AbortController(); let intent = false;
    const renew = (async () => {
      try {
        while (!heartbeat.signal.aborted) {
          await delay(this.options.heartbeatMs ?? 30_000, undefined, { signal: heartbeat.signal });
          const current = parseThumbnail(thumbnailExecutionJob, resultField(await this.options.api.operation({ action: 'heartbeat', ...attempt }, heartbeat.signal), 'result'));
          if (current.id !== job.id || current.ownerId !== job.ownerId || current.workerId !== job.workerId
            || current.attemptId !== job.attemptId || current.fence !== job.fence || current.inputSha256 !== job.inputSha256
            || current.cancelRequested || !['claimed', 'provider_started'].includes(current.state)) scope.abort();
        }
      } catch { if (!heartbeat.signal.aborted) scope.abort(); }
    })();
    this.event({ event: 'claimed' });
    try {
      if (job.model === THUMBNAIL_CHAT_MODEL) {
        return await this.processChat(job, attempt, scope.signal, stop, () => { intent = true; });
      }
      const references = [];
      for (const [index, reference] of job.input.references.entries()) references.push({
        bytes: await this.options.api.reference(attempt, index, reference, scope.signal), mimeType: reference.mimeType, role: reference.role,
      });
      const prepared = await this.gemini().prepareStored({ model: job.model, prompt: job.input.prompt, references,
        ownerId: job.ownerId, jobId: job.id, attemptId: job.attemptId!, fence: job.fence });
      if (prepared.descriptor.inputSha256 !== job.inputSha256) throw new ThumbnailWorkerError('input_mismatch');
      const identity: ThumbnailOutboxIdentity = { ...prepared.descriptor, workerId: job.workerId!, origin: this.options.api.origin };
      const result = await prepared.run(async () => {
        scope.signal.throwIfAborted();
        if (!this.options.outbox.begin(identity)) throw new ThumbnailWorkerError('outbox_pending');
        intent = true;
        return parseThumbnail(thumbnailStartReceipt, resultField(await this.options.api.operation({ action: 'start', ...attempt }, scope.signal), 'result'));
      }, scope.signal);
      // Paid output is durably stored BEFORE checking stop/cancellation or attempting an HTTP delivery.
      const metadata = { original: { sha256: result.original.sha256,
        mimeType: result.original.mimeType, bytes: result.original.bytes.length, width: result.original.width, height: result.original.height },
      provenance: result.provenance };
      try { this.options.outbox.save(identity, result.original.bytes, metadata); }
      catch {
        // One bounded retry of the SAME RAM bundle. save() first reads its immutable row in a new transaction;
        // it reconciles an already committed result and never grants another provider invocation.
        this.options.outbox.save(identity, result.original.bytes, metadata);
      }
      this.event({ event: 'result_saved' });
      if (stop?.aborted) return 'held';
      return await this.deliver(identity, stop);
    } catch (error) {
      if (intent && !stop?.aborted) {
        try { await this.options.api.operation({ action: 'unknown', ...attempt }, stop); }
        catch { /* Keep local intent/result immutable. An unsuccessful unknown write is not a paid retry license. */ }
      }
      this.event({ event: 'held', code: thumbnailWorkerErrorCode(error) }); return 'held';
    } finally {
      heartbeat.abort(); scope.abort(); stop?.removeEventListener('abort', abort); await renew;
    }
  }
  private async processChat(job: ThumbnailChatJob, attempt: ThumbnailAttempt, signal: AbortSignal,
    stop: AbortSignal | undefined, started: () => void): Promise<WorkerOutcome> {
    if (!this.options.api.chatContext || !this.options.api.chat) throw new ThumbnailWorkerError('invalid_worker_configuration');
    const context = await this.options.api.chatContext(attempt, signal);
    const content = prepareThumbnailChatContent(context);
    if (content.inputSha256 !== job.inputSha256 || content.documentSha256 !== job.input.document.sha256
      || content.documentBytes.length !== job.input.document.bytes) throw new ThumbnailWorkerError('input_mismatch');
    const prepared = await this.chatGemini().prepareStored({ context: content.context, ownerId: job.ownerId,
      jobId: job.id, attemptId: job.attemptId!, fence: job.fence });
    if (prepared.descriptor.inputSha256 !== job.inputSha256) throw new ThumbnailWorkerError('input_mismatch');
    const identity: ThumbnailOutboxIdentity = { ...prepared.descriptor, workerId: job.workerId!, origin: this.options.api.origin };
    const result = await prepared.run(async () => {
      signal.throwIfAborted();
      if (!this.options.outbox.begin(identity)) throw new ThumbnailWorkerError('outbox_pending');
      started();
      return parseThumbnail(thumbnailChatStartReceipt, resultField(await this.options.api.operation({ action: 'start', ...attempt }, signal), 'result'));
    }, signal);
    const metadata = { content: { sha256: createHash('sha256').update(result.bytes).digest('hex'),
      mimeType: 'application/json' as const, bytes: result.bytes.length }, provenance: result.provenance };
    try { this.options.outbox.saveChat(identity, result.bytes, metadata); }
    catch { this.options.outbox.saveChat(identity, result.bytes, metadata); }
    this.event({ event: 'result_saved' });
    if (stop?.aborted) return 'held';
    return await this.deliver(identity, stop);
  }
  async run(options: { signal?: AbortSignal; once?: boolean; pollMs?: number } = {}): Promise<WorkerOutcome> {
    const interval = options.pollMs ?? 5000;
    if (!Number.isInteger(interval) || interval < 1 || interval > 60_000) throw new ThumbnailWorkerError('invalid_worker_configuration');
    let result: WorkerOutcome = 'idle';
    while (!options.signal?.aborted) {
      result = await this.runOnce(options.signal);
      if (options.once || result === 'held' || options.signal?.aborted) break;
      try { await delay(interval, undefined, { signal: options.signal }); } catch { break; }
    }
    return result;
  }
}
