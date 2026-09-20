import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { MlxStoryboardClient, type MlxModel } from './mlx-client.ts';
import {
  MAX_STORYBOARD_IMAGE_BYTES, MAX_STORYBOARD_IMAGE_PIXELS, STORYBOARD_PRODUCTION_MESSAGES,
  StoryboardProductionError, assertStoryboardProviderPolicy, parseStoryboardDraft,
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
type Models = Pick<MlxStoryboardClient, 'models' | 'draft' | 'image'>;
export function storyboardWorkerErrorCode(error: unknown): string {
  if (error instanceof StoryboardWorkerApiError) return error.code;
  if (error instanceof StoryboardProductionError && Object.hasOwn(STORYBOARD_PRODUCTION_MESSAGES, error.code)) return error.code;
  return 'provider_failed';
}

export function admitStoryboardWorkerMemory(
  models: ReadonlyArray<{ bytes_resident?: number }>,
  env: { physicalBytes: number; usedBytes: number } = {
    physicalBytes: os.totalmem(),
    usedBytes: process.memoryUsage().rss,
  },
): boolean {
  const resident = models.reduce((sum, model) => sum + (Number(model.bytes_resident) || 0), 0);
  return canAdmitStoryboardMemory({
    usedBytes: env.usedBytes + resident,
    additionalPeakEstimateBytes: MAX_STORYBOARD_IMAGE_BYTES * 4,
    physicalBytes: env.physicalBytes,
  });
}

/** One claimed project and one image at a time. SQL owns durable progress and retry leases. */
export class OutboundStoryboardWorker {
  private readonly api: StoryboardWorkerApi;
  private readonly mlx: Models;
  private readonly heartbeatMs: number;
  private readonly onEvent: (event: WorkerEvent) => void;
  private readonly admitMemory: (models: MlxModel[]) => boolean;
  private running = false;
  constructor(options: {
    api: StoryboardWorkerApi; mlx?: Models; heartbeatMs?: number; onEvent?: (event: WorkerEvent) => void;
    admitMemory?: (models: MlxModel[]) => boolean;
  }) {
    this.api = options.api; this.mlx = options.mlx ?? new MlxStoryboardClient();
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    if (!Number.isInteger(this.heartbeatMs) || this.heartbeatMs < 1 || this.heartbeatMs > 30_000) {
      throw new StoryboardWorkerApiError('invalid_worker_timeout');
    }
    this.onEvent = options.onEvent ?? (() => undefined);
    this.admitMemory = options.admitMemory ?? ((models) => admitStoryboardWorkerMemory(models));
  }

  private async heartbeat(models: MlxModel[], signal?: AbortSignal, lease?: Lease): Promise<void> {
    const result = heartbeatSchema.safeParse(await workerApiCall(() => this.api.operation({ action: 'heartbeat', models, ...lease }, signal)));
    if (!result.success) throw new StoryboardWorkerApiError('invalid_worker_response');
    if (lease && !result.data.leaseValid) throw new StoryboardWorkerApiError('worker_lease_lost');
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
      if (once || signal?.aborted) break;
      await delay(pollMs, undefined, { signal });
    }
    return result;
  }

  async runOnce(signal?: AbortSignal): Promise<WorkerResult> {
    if (this.running) throw new StoryboardWorkerApiError('worker_busy');
    this.running = true;
    try {
      if (signal?.aborted) throw new StoryboardWorkerApiError('worker_stopped');
      let models: MlxModel[];
      try { models = await this.mlx.models(signal); }
      catch (error) {
        if (!signal?.aborted) await this.heartbeat([], signal);
        throw error;
      }
      if (signal?.aborted) throw new StoryboardWorkerApiError('worker_stopped');
      await this.heartbeat(models, signal);
      if (!this.admitMemory(models)) {
        this.onEvent({ event: 'memory_deferred' });
        return 'idle';
      }
      const claim = claimSchema.safeParse(await workerApiCall(() => this.api.operation({ action: 'claim' }, signal)));
      if (!claim.success) throw new StoryboardWorkerApiError('invalid_worker_response');
      if (!claim.data.job) return 'idle';
      try { return await this.processJob(claim.data.job, models, signal); }
      catch (error) {
        if (!(error instanceof StoryboardWorkerApiError) || error.code !== 'worker_lease_lost') throw error;
        this.onEvent({ event: 'lease_lost', jobId: claim.data.job.id, code: error.code });
        return 'lease_lost';
      }
    } finally { this.running = false; }
  }

  private async processJob(job: ClaimedStoryboardJob, models: MlxModel[], stop?: AbortSignal): Promise<WorkerResult> {
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
    const renew = (async () => {
      try {
        while (!scope.signal.aborted) {
          await delay(this.heartbeatMs, undefined, { signal: scope.signal });
          await this.heartbeat(models, scope.signal, lease);
        }
      } catch (error) { if (!scope.signal.aborted) scope.abort(error); }
    })();
    const started = performance.now();
    this.onEvent({ event: 'claimed', jobId: job.id });
    try {
      check();
      await this.heartbeat(models, scope.signal, lease);
      check();
      assertStoryboardProviderPolicy(job.request.providers);
      if (job.document && (job.document.projectId !== job.projectId || job.document.revision !== job.revision
        || job.document.scenes.length !== job.request.sceneCount
        || job.document.scenes.some((scene, index) => scene.sceneNo !== index + 1))) {
        throw new StoryboardProductionError('invalid_structured_response');
      }
      let draft: StoryboardDraft;
      if (!job.document) {
        if (job.kind !== 'generate' || job.request.providers.text.id !== 'local-mlx') {
          throw new StoryboardProductionError('invalid_structured_response');
        }
        this.onEvent({ event: 'text_started', jobId: job.id });
        const generated = await this.mlx.draft(job.request, scope.signal);
        draft = parseStoryboardDraft(generated.draft, job.request);
        await operation({ action: 'draft', draft, provenance: generated.provenance });
        this.onEvent({ event: 'text_saved', jobId: job.id });
      } else draft = job.document;
      let imageFailure: string | undefined;
      if (job.request.providers.image.id === 'local-mlx') {
        const scenes = job.kind === 'scene' ? draft.scenes.filter((scene) => scene.sceneNo === job.sceneNo)
          : draft.scenes.filter((scene) => {
            const saved = job.document?.scenes.find((entry) => entry.sceneNo === scene.sceneNo);
            return !saved?.image || !!saved.imageError;
          });
        if (job.kind === 'scene' && scenes.length !== 1) throw new StoryboardProductionError('invalid_structured_response');
        for (const scene of scenes) {
          check();
          this.onEvent({ event: 'image_started', jobId: job.id, sceneNo: scene.sceneNo });
          // Inference and pixel decoding are local. Upload/checkpoint errors stay outside this boundary.
          let generated: Awaited<ReturnType<Models['image']>>;
          try {
            generated = await this.mlx.image(job.request, scene.imagePrompt, scope.signal);
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
      } else if (!['manual', 'chatgpt-manual', 'grok-manual'].includes(job.request.providers.image.id)) {
        throw new StoryboardProductionError('provider_not_configured');
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
