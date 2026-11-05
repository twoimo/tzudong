import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { parseFeatureDatabaseReadiness } from '@/lib/runtime-feature-readiness-contract';
import { GeminiStoryboardClient } from './gemini-client.ts';
import {
  isAllowedStoryboardGeminiWorkerModel, storyboardGeminiDeclaredModels,
} from './gemini-models.ts';
import type { ProductionModel as WorkerModel } from './production-worker-auth.ts';
import {
  MAX_STORYBOARD_IMAGE_BYTES, MAX_STORYBOARD_IMAGE_PIXELS, STORYBOARD_PRODUCTION_MESSAGES,
  StoryboardProductionError, assertGeminiStoryboardExecutionPolicy, parseStoryboardDraft,
  type StoryboardDraft, type StoryboardProductionProvenance,
} from './production-contract.ts';
import { canAdmitStoryboardMemory } from './resource-invariants.ts';
import {
  claimedStoryboardJobSchema, validateStoryboardWorkerOrigin,
  type ClaimedStoryboardJob, type WorkerDestination, type WorkerEvent, type WorkerResult,
} from './outbound-worker-contract.ts';
export type { WorkerResult } from './outbound-worker-contract.ts';

const okSchema = z.object({ ok: z.literal(true) }).strict();
const heartbeatSchema = okSchema.extend({ leaseValid: z.boolean() });
const claimSchema = okSchema.extend({ job: claimedStoryboardJobSchema.nullable() });
const PATHS = ['/api/storyboard-worker', '/api/storyboard-worker/images'] as const;
type WorkerPath = typeof PATHS[number];
type Lease = { jobId: string; leaseToken: string };
export const DEFAULT_STORYBOARD_GEMINI_CLIENT_PEAK_BYTES = 128 * 1024 ** 2;
export const STORYBOARD_CATALOG_FAILURE_LIMIT = 3;
export const STORYBOARD_CATALOG_COOLDOWN_MS = 30_000;
export const STORYBOARD_CATALOG_MAX_COOLDOWN_MS = 120_000;
const STORYBOARD_IMAGE_UPLOAD_PEAK_BYTES = MAX_STORYBOARD_IMAGE_BYTES * 4;

export class StoryboardWorkerApiError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'StoryboardWorkerApiError'; this.code = code; }
}

/** Header inspection alone accepts truncated pixels. Keep all decoding local, before delivery. */
async function validateWorkerImage(bytes: Buffer): Promise<'png' | 'jpeg' | 'webp'> {
  if (bytes.length > MAX_STORYBOARD_IMAGE_BYTES) throw new StoryboardProductionError('image_too_large');
  try {
    const options = { limitInputPixels: MAX_STORYBOARD_IMAGE_PIXELS, animated: false, failOn: 'warning' as const };
    const metadata = await sharp(bytes, options).metadata();
    const format = metadata.format;
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1
      || metadata.width * metadata.height > MAX_STORYBOARD_IMAGE_PIXELS
      || (format !== 'png' && format !== 'jpeg' && format !== 'webp')) throw new Error();
    await sharp(bytes, options).raw().toBuffer();
    return format;
  } catch { throw new StoryboardProductionError('invalid_image'); }
}

/** An unclassified checkpoint failure has unknown delivery, never a local provider failure. */
async function workerApiCall<T>(send: () => Promise<T>): Promise<T> {
  try { return await send(); }
  catch (error) {
    if (error instanceof StoryboardWorkerApiError) throw error;
    throw new StoryboardWorkerApiError('worker_delivery_unknown');
  }
}

function validateToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new StoryboardWorkerApiError('worker_unauthorized');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length < 32 || bytes.length > 96 || bytes.toString('base64url') !== value) {
    throw new StoryboardWorkerApiError('worker_unauthorized');
  }
  return value;
}

/** No command-line token, env dump, symlink, or group/world-readable credential. */
export async function readStoryboardWorkerToken(file: string): Promise<string> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 130 || (stat.mode & 0o077) !== 0
      || (process.getuid && stat.uid !== process.getuid())) throw new Error();
    const bytes = Buffer.alloc(131);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 130) throw new Error();
    return validateToken(bytes.subarray(0, bytesRead).toString('utf8').replace(/\r?\n$/, ''));
  } catch { throw new StoryboardWorkerApiError('worker_token_file_invalid'); }
  finally { await handle?.close(); }
}

/** Only two authenticated outbound routes; no listener, redirects, proxy, or SDK. */
export class StoryboardWorkerTransport {
  readonly origin: URL;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly onDestination?: (receipt: WorkerDestination) => void;
  constructor(options: {
    origin: string; token: string; timeoutMs?: number;
    onDestination?: (receipt: WorkerDestination) => void;
  }) {
    this.origin = validateStoryboardWorkerOrigin(options.origin);
    this.token = validateToken(options.token);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new StoryboardWorkerApiError('invalid_worker_timeout');
    }
    this.onDestination = options.onDestination;
  }

  private request(path: WorkerPath, bytes: Buffer, contentType: string, signal?: AbortSignal): Promise<unknown> {
    if (!PATHS.includes(path) || bytes.length > MAX_STORYBOARD_IMAGE_BYTES + 8192) {
      throw new StoryboardWorkerApiError('invalid_worker_request');
    }
    if (signal?.aborted) return Promise.reject(new StoryboardWorkerApiError('worker_stopped'));
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: StoryboardWorkerApiError, data?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(data);
      };
      const abort = () => { finish(new StoryboardWorkerApiError('worker_stopped')); req.destroy(); };
      const secure = this.origin.protocol === 'https:';
      const req = (secure ? https : http).request({
        protocol: this.origin.protocol, hostname: this.origin.hostname.replace(/^\[|\]$/g, ''),
        port: this.origin.port || (secure ? 443 : 80), path, method: 'POST', agent: false,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json',
          'Content-Type': contentType, 'Content-Length': bytes.length },
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200 || !res.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          const code = status === 401 || status === 403 ? 'worker_unauthorized'
            : status === 409 ? 'worker_lease_lost'
              : status === 429 ? 'worker_rate_limited'
                : status >= 300 && status < 400 ? 'worker_redirect_refused' : 'worker_api_failed';
          finish(new StoryboardWorkerApiError(code)); res.destroy(); return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 512 * 1024) { finish(new StoryboardWorkerApiError('worker_response_too_large')); res.destroy(); }
          else chunks.push(chunk);
        });
        res.on('aborted', () => finish(new StoryboardWorkerApiError('worker_delivery_unknown')));
        res.on('error', () => finish(new StoryboardWorkerApiError('worker_delivery_unknown')));
        res.on('end', () => {
          try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
          catch { finish(new StoryboardWorkerApiError('invalid_worker_response')); }
        });
      });
      req.on('socket', (socket) => {
        socket.once(secure ? 'secureConnect' : 'connect', () => this.onDestination?.({
          protocol: secure ? 'https:' : 'http:', host: this.origin.hostname,
          port: this.origin.port || (secure ? '443' : '80'), path, connected: true,
        }));
      });
      req.on('error', () => finish(new StoryboardWorkerApiError('worker_delivery_unknown')));
      timer = setTimeout(() => { finish(new StoryboardWorkerApiError('worker_delivery_unknown')); req.destroy(); }, this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort(); else req.end(bytes);
    });
  }

  async operation(value: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const bytes = Buffer.from(JSON.stringify(value), 'utf8');
    if (bytes.length > 192 * 1024) throw new StoryboardWorkerApiError('invalid_worker_request');
    return this.request(PATHS[0], bytes, 'application/json', signal);
  }

  async image(lease: Lease, sceneNo: number, bytes: Buffer, proof: StoryboardProductionProvenance, signal?: AbortSignal) {
    const format = await validateWorkerImage(bytes);
    const boundary = `storyboard-${randomUUID()}`;
    const fields = { ...lease, sceneNo: String(sceneNo), provenance: JSON.stringify(proof) };
    const pieces: Buffer[] = Object.entries(fields).map(([name, value]) => Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
    pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="scene.${format}"\r\nContent-Type: image/${format}\r\n\r\n`), bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`));
    const result = await this.request(PATHS[1], Buffer.concat(pieces), `multipart/form-data; boundary=${boundary}`, signal);
    if (!okSchema.safeParse(result).success) throw new StoryboardWorkerApiError('invalid_worker_response');
  }
}

export interface StoryboardWorkerApi {
  operation(value: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  image(lease: Lease, sceneNo: number, bytes: Buffer, proof: StoryboardProductionProvenance, signal?: AbortSignal): Promise<void>;
}
type GeminiModels = Pick<GeminiStoryboardClient, 'models' | 'draft' | 'image'>;

function assertClaimedStoryboardModels(job: ClaimedStoryboardJob, models: WorkerModel[]): void {
  assertVerifiedStoryboardModels(models);
  for (const modality of ['text', 'image'] as const) {
    const selected = job.request.providers[modality].model;
    const capability = modality === 'text' ? 'chat' : 'image';
    if (!models.some((model) => model.id === selected && model.capabilities.includes(capability))) {
      throw new StoryboardProductionError('provider_failed');
    }
  }
}

function assertVerifiedStoryboardModels(models: WorkerModel[]): void {
  if (!models.length || models.some((model) => !isAllowedStoryboardGeminiWorkerModel(model))) {
    throw new StoryboardProductionError('provider_failed');
  }
}

export function storyboardWorkerErrorCode(error: unknown): string {
  if (error instanceof StoryboardWorkerApiError) return error.code;
  if (error instanceof StoryboardProductionError && Object.hasOwn(STORYBOARD_PRODUCTION_MESSAGES, error.code)) return error.code;
  return 'provider_failed';
}

export function admitStoryboardWorkerMemory(
  _models: ReadonlyArray<{ bytes_resident?: number }>,
  env: { physicalBytes: number; availableBytes?: number; usedBytes?: number } = {
    physicalBytes: os.totalmem(),
    availableBytes: os.freemem(),
  },
): boolean {
  const inferencePeakBytes = DEFAULT_STORYBOARD_GEMINI_CLIENT_PEAK_BYTES;
  if (!Number.isFinite(env.physicalBytes) || env.physicalBytes < 0) {
    throw new RangeError('physicalBytes must be a finite number >= 0');
  }

  let usedBytes: number;
  if (env.availableBytes !== undefined) {
    if (!Number.isFinite(env.availableBytes) || env.availableBytes < 0 || env.availableBytes > env.physicalBytes) {
      throw new RangeError('availableBytes must be a finite number between 0 and physicalBytes');
    }
    // os.freemem() is host-wide and already includes this worker process.
    usedBytes = env.physicalBytes - env.availableBytes;
  } else if (env.usedBytes !== undefined) {
    if (!Number.isFinite(env.usedBytes) || env.usedBytes < 0) {
      throw new RangeError('usedBytes must be a finite number >= 0');
    }
    // Gemini model residency is remote; the supplied worker RSS is the local baseline.
    usedBytes = env.usedBytes;
  } else {
    throw new RangeError('availableBytes or usedBytes is required');
  }

  return canAdmitStoryboardMemory({
    usedBytes,
    additionalPeakEstimateBytes: inferencePeakBytes + STORYBOARD_IMAGE_UPLOAD_PEAK_BYTES,
    physicalBytes: env.physicalBytes,
  });
}

/** One claimed project and one image at a time. SQL owns durable progress and retry leases. */
export class OutboundStoryboardWorker {
  private readonly api: StoryboardWorkerApi;
  private readonly gemini: GeminiModels;
  private readonly heartbeatMs: number;
  private readonly onEvent: (event: WorkerEvent) => void;
  private readonly admitMemory: (models: WorkerModel[]) => boolean;
  private readonly now: () => number;
  private catalogFailures = 0;
  private catalogRetryAfter = 0;
  private running = false;
  constructor(options: {
    api: StoryboardWorkerApi; gemini?: GeminiModels; heartbeatMs?: number; onEvent?: (event: WorkerEvent) => void;
    admitMemory?: (models: WorkerModel[]) => boolean; now?: () => number;
  }) {
    this.api = options.api; this.gemini = options.gemini ?? new GeminiStoryboardClient();
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    if (!Number.isInteger(this.heartbeatMs) || this.heartbeatMs < 1 || this.heartbeatMs > 30_000) {
      throw new StoryboardWorkerApiError('invalid_worker_timeout');
    }
    this.onEvent = options.onEvent ?? (() => undefined);
    this.admitMemory = options.admitMemory ?? ((models) => admitStoryboardWorkerMemory(models));
    this.now = options.now ?? Date.now;
  }

  private async heartbeat(models: WorkerModel[], signal?: AbortSignal, lease?: Lease): Promise<void> {
    const result = heartbeatSchema.safeParse(await workerApiCall(() => this.api.operation({ action: 'heartbeat', models, ...lease }, signal)));
    if (!result.success) throw new StoryboardWorkerApiError('invalid_worker_response');
    if (lease && !result.data.leaseValid) throw new StoryboardWorkerApiError('worker_lease_lost');
  }

  private async verifiedModels(signal?: AbortSignal): Promise<WorkerModel[] | null> {
    if (this.catalogFailures >= STORYBOARD_CATALOG_FAILURE_LIMIT) {
      throw new StoryboardProductionError('provider_failed');
    }
    if (this.catalogFailures > 0 && this.now() < this.catalogRetryAfter) return null;
    let models: WorkerModel[];
    try {
      models = await this.gemini.models(signal);
    } catch (error) {
      const transient = error instanceof StoryboardProductionError && error.code === 'provider_failed';
      if (signal?.aborted || !transient) throw error;
      this.catalogFailures += 1;
      if (this.catalogFailures >= STORYBOARD_CATALOG_FAILURE_LIMIT) {
        this.onEvent({ event: 'model_catalog_retry_exhausted', code: storyboardWorkerErrorCode(error) });
        throw error;
      }
      const cooldownMs = Math.min(
        STORYBOARD_CATALOG_COOLDOWN_MS * (2 ** (this.catalogFailures - 1)),
        STORYBOARD_CATALOG_MAX_COOLDOWN_MS,
      );
      this.catalogRetryAfter = this.now() + cooldownMs;
      this.onEvent({ event: 'model_catalog_deferred', code: storyboardWorkerErrorCode(error) });
      return null;
    }
    assertVerifiedStoryboardModels(models);
    this.catalogFailures = 0;
    this.catalogRetryAfter = 0;
    return models;
  }

  /** Only settled job outcomes continue polling; uncertain deliveries leave this loop. */
  async run(options: { signal?: AbortSignal; once?: boolean; pollMs?: number } = {}): Promise<WorkerResult> {
    const { signal, once = false, pollMs = 5000 } = options;
    if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 60_000) {
      throw new StoryboardWorkerApiError('invalid_worker_timeout');
    }
    let result: WorkerResult = 'idle';
    while (!signal?.aborted) {
      result = await this.runOnce(signal);
      if (once || result === 'held' || signal?.aborted) break;
      await delay(pollMs, undefined, { signal });
    }
    return result;
  }

  async runOnce(signal?: AbortSignal): Promise<WorkerResult> {
    if (this.running) throw new StoryboardWorkerApiError('worker_busy');
    this.running = true;
    try {
      if (signal?.aborted) throw new StoryboardWorkerApiError('worker_stopped');
      const readiness = parseFeatureDatabaseReadiness(
        await workerApiCall(() => this.api.operation({ action: 'readiness' }, signal)),
      );
      if (readiness.status !== 'ready') {
        this.onEvent({ event: 'feature_held', code: readiness.code });
        return 'held';
      }
      const declaredModels = storyboardGeminiDeclaredModels();
      if (!this.admitMemory(declaredModels)) {
        this.onEvent({ event: 'memory_deferred' });
        return 'idle';
      }
      // The client refreshes this verified catalog after its bounded five-minute
      // TTL. Idle polling reuses it so a five-second queue poll does not become
      // an unbounded provider metadata loop.
      const availableModels = await this.verifiedModels(signal);
      // A provider catalog outage cannot authorize a claim. Transient failures
      // retry only after bounded cooldowns and terminate after the fixed limit.
      if (!availableModels) return 'idle';
      await this.heartbeat(availableModels, signal);
      const claim = claimSchema.safeParse(await workerApiCall(() => this.api.operation({ action: 'claim' }, signal)));
      if (!claim.success) throw new StoryboardWorkerApiError('invalid_worker_response');
      if (!claim.data.job) return 'idle';
      try { return await this.processJob(claim.data.job, availableModels, signal); }
      catch (error) {
        if (!(error instanceof StoryboardWorkerApiError) || error.code !== 'worker_lease_lost') throw error;
        this.onEvent({ event: 'lease_lost', jobId: claim.data.job.id, code: error.code });
        return 'lease_lost';
      }
    } finally { this.running = false; }
  }

  private async processJob(job: ClaimedStoryboardJob, availableModels: WorkerModel[], stop?: AbortSignal): Promise<WorkerResult> {
    const lease = { jobId: job.id, leaseToken: job.leaseToken };
    const scope = new AbortController();
    const abort = () => scope.abort(new StoryboardWorkerApiError('worker_stopped'));
    stop?.addEventListener('abort', abort, { once: true });
    if (stop?.aborted) abort();
    const check = () => { if (scope.signal.aborted) throw scope.signal.reason; };
    const operation = async (payload: Record<string, unknown>) => {
      check();
      const result = await workerApiCall(() => this.api.operation({ ...payload, ...lease }, scope.signal));
      check();
      if (!okSchema.safeParse(result).success) throw new StoryboardWorkerApiError('invalid_worker_response');
    };
    const heartbeatModels = availableModels;
    const renew = (async () => {
      try {
        while (!scope.signal.aborted) {
          await delay(this.heartbeatMs, undefined, { signal: scope.signal });
          await this.heartbeat(heartbeatModels, scope.signal, lease);
        }
      } catch (error) { if (!scope.signal.aborted) scope.abort(error); }
    })();
    const started = performance.now();
    this.onEvent({ event: 'claimed', jobId: job.id });
    try {
      check();
      await this.heartbeat(heartbeatModels, scope.signal, lease);
      check();
      assertGeminiStoryboardExecutionPolicy(job.request.providers);
      assertClaimedStoryboardModels(job, availableModels);
      if (job.document && (job.document.projectId !== job.projectId || job.document.revision !== job.revision
        || job.document.scenes.length !== job.request.sceneCount
        || job.document.scenes.some((scene, index) => scene.sceneNo !== index + 1))) {
        throw new StoryboardProductionError('invalid_structured_response');
      }
      let draft: StoryboardDraft;
      if (!job.document) {
        if (job.kind !== 'generate' || job.request.providers.text.id !== 'gemini-api') {
          throw new StoryboardProductionError('invalid_structured_response');
        }
        this.onEvent({ event: 'text_started', jobId: job.id });
        const generated = await this.gemini.draft(job.request, scope.signal);
        draft = parseStoryboardDraft(generated.draft, job.request);
        await operation({ action: 'draft', draft, provenance: generated.provenance });
        this.onEvent({ event: 'text_saved', jobId: job.id });
      } else draft = job.document;
      let imageFailure: string | undefined;
      const scenes = job.kind === 'scene' ? draft.scenes.filter((scene) => scene.sceneNo === job.sceneNo)
        : draft.scenes.filter((scene) => {
          const saved = job.document?.scenes.find((entry) => entry.sceneNo === scene.sceneNo);
          return !saved?.image || !!saved.imageError;
        });
      if (job.kind === 'scene' && scenes.length !== 1) throw new StoryboardProductionError('invalid_structured_response');
      for (const scene of scenes) {
        check();
        this.onEvent({ event: 'image_started', jobId: job.id, sceneNo: scene.sceneNo });
        let generated: Awaited<ReturnType<GeminiModels['image']>>;
        try {
          generated = await this.gemini.image(job.request, scene.imagePrompt, scope.signal);
          check();
          await validateWorkerImage(generated.bytes);
        }
        catch (error) {
          check();
          const code = storyboardWorkerErrorCode(error);
          imageFailure ??= code;
          await operation({ action: 'scene-error', sceneNo: scene.sceneNo, errorCode: code });
          this.onEvent({ event: 'scene_failed', jobId: job.id, sceneNo: scene.sceneNo, code });
          if (['invalid_image', 'invalid_image_response', 'image_too_large'].includes(code)) continue;
          throw error;
        }
        check();
        await workerApiCall(() => this.api.image(lease, scene.sceneNo, generated.bytes, generated.provenance, scope.signal));
        check();
        this.onEvent({ event: 'image_saved', jobId: job.id, sceneNo: scene.sceneNo });
      }
      await operation({ action: 'finish', ...(imageFailure ? { errorCode: imageFailure } : {}) });
      this.onEvent({ event: imageFailure ? 'failed' : 'finished', jobId: job.id,
        ...(imageFailure ? { code: imageFailure } : {}), elapsedMs: Math.round(performance.now() - started) });
      return imageFailure ? 'failed' : 'completed';
    } catch (error) {
      // Lost/uncertain leases are recovered by SQL; no blind write or generation retry.
      // A concurrent lease loss cannot make an uncertain delivery safe to continue.
      if (error instanceof StoryboardWorkerApiError && !['worker_stopped', 'worker_lease_lost'].includes(error.code)) throw error;
      const failure = scope.signal.aborted ? scope.signal.reason : error;
      if (scope.signal.aborted || failure instanceof StoryboardWorkerApiError) throw failure;
      const code = storyboardWorkerErrorCode(failure);
      await operation({ action: 'finish', errorCode: code });
      this.onEvent({ event: 'failed', jobId: job.id, code });
      return 'failed';
    } finally {
      scope.abort(); stop?.removeEventListener('abort', abort); await renew;
    }
  }
}
