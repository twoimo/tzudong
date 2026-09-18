import { describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { MlxStoryboardClient, type MlxModel } from '../lib/admin/storyboard/mlx-client';
import { MlxTransport } from '../lib/admin/storyboard/mlx-transport';
import {
  OutboundStoryboardWorker, StoryboardWorkerApiError, StoryboardWorkerTransport,
  readStoryboardWorkerToken, type StoryboardWorkerApi,
} from '../lib/admin/storyboard/outbound-worker';
import { validateStoryboardWorkerOrigin, type ClaimedStoryboardJob, type WorkerDestination } from '../lib/admin/storyboard/outbound-worker-contract';
import {
  STORYBOARD_WORKFLOW, StoryboardProductionError, storyboardProductionDocumentSchema,
  storyboardProductionRequestSchema, type StoryboardDraft, type StoryboardProductionProvenance,
} from '../lib/admin/storyboard/production-contract';

const proof = (kind: 'text' | 'image'): StoryboardProductionProvenance => ({
  providerId: 'local-mlx', model: `installed-${kind}`, verification: 'local-worker',
  generatedAt: new Date().toISOString(), requestId: randomUUID(), responseId: null,
  responseModel: null, modelEvidence: 'installed-catalog-and-request',
});
const draft = (): StoryboardDraft => ({ title: '워커 단위 테스트', logline: '실제 모델 결과가 아닌 테스트 픽스처',
  scenes: Array.from({ length: 5 }, (_, index) => ({ sceneNo: index + 1, title: `장면 ${index + 1}`,
    durationSec: 10, description: '음식 조리', visualDirection: '고정 구도', narration: '', caption: '',
    productionNotes: ['고정 카메라'], imagePrompt: `scene ${index + 1}`, sourceIds: [],
  })),
});
const models: MlxModel[] = ['text', 'image'].map((kind) => ({ id: `installed-${kind}`, owned_by: 'mlx-serve',
  capabilities: [kind === 'text' ? 'chat' : 'image'], loaded: true, bytes_on_disk: 100, bytes_resident: 100 }));
const fixturePixels = sharp({ create: { width: 128, height: 72, channels: 3, background: '#dddddd' } }).png().toBuffer();
function job(): ClaimedStoryboardJob {
  return { id: randomUUID(), projectId: randomUUID(), revision: 0, kind: 'generate', sceneNo: null, leaseToken: randomUUID(),
    document: null, request: storyboardProductionRequestSchema.parse({ workflow: STORYBOARD_WORKFLOW, requestId: randomUUID(),
      sceneCount: 5, prompt: '테스트', providers: { externalAI: false,
        text: { id: 'local-mlx', model: 'installed-text' }, image: { id: 'local-mlx', model: 'installed-image' } } }) };
}
function savedJob(): ClaimedStoryboardJob {
  const value = job();
  value.document = storyboardProductionDocumentSchema.parse({ ...draft(), schema: STORYBOARD_WORKFLOW,
    projectId: value.projectId, revision: 0, generatedAt: new Date().toISOString(), textProvenance: proof('text'),
    scenes: draft().scenes.map((scene) => ({ ...scene, revision: 0, image: null, imageError: null })) });
  return value;
}
function fixture(value: ClaimedStoryboardJob | null = job()) {
  const calls: Array<Record<string, unknown>> = [];
  const generated: string[] = [];
  let drafts = 0;
  const api: StoryboardWorkerApi = {
    async operation(payload) {
      calls.push(payload);
      if (payload.action === 'claim') return { ok: true, job: value };
      if (payload.action === 'heartbeat') return { ok: true, leaseValid: true };
      return { ok: true };
    },
    async image(lease, sceneNo) { calls.push({ action: 'image', ...lease, sceneNo }); },
  };
  const mlx: Pick<MlxStoryboardClient, 'models' | 'draft' | 'image'> = {
    async models() { return models; },
    async draft() { drafts++; return { draft: draft(), provenance: proof('text') }; },
    async image(_request, prompt) { generated.push(prompt); return { bytes: await fixturePixels, provenance: proof('image') }; },
  };
  return { api, mlx, calls, generated, draftCalls: () => drafts };
}
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_address');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('outbound worker lifecycle (fixture models, no live inference)', () => {
  test('claims, saves draft, uploads all scenes sequentially, then finishes', async () => {
    const f = fixture();
    let active = 0; let peak = 0;
    const generate = f.mlx.image;
    f.mlx.image = async (...args) => {
      active++; peak = Math.max(peak, active);
      try { await delay(2); return await generate(...args); } finally { active--; }
    };
    expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('completed');
    expect(peak).toBe(1); expect(f.draftCalls()).toBe(1);
    expect(f.calls.filter((call) => call.action !== 'heartbeat').map((call) => call.action))
      .toEqual(['claim', 'draft', 'image', 'image', 'image', 'image', 'image', 'finish']);
    expect(f.generated).toEqual(['scene 1', 'scene 2', 'scene 3', 'scene 4', 'scene 5']);
  });
  test('an empty queue does not invoke any generation', async () => {
    const f = fixture(null);
    expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('idle');
    expect(f.draftCalls()).toBe(0); expect(f.generated).toEqual([]);
  });
  test('targeted regeneration invokes only the requested scene and preserves the draft', async () => {
    const value = savedJob(); value.kind = 'scene'; value.sceneNo = 3;
    const f = fixture(value);
    expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('completed');
    expect(f.draftCalls()).toBe(0); expect(f.generated).toEqual(['scene 3']);
    expect(f.calls.filter((call) => call.action === 'image').map((call) => call.sceneNo)).toEqual([3]);
  });
  test('restart skips committed images and retries only missing/error scenes', async () => {
    const value = savedJob();
    const variant = { path: 'fixture', sha256: 'a'.repeat(64), mime: 'image/png' as const, width: 1, height: 1, bytes: 1 };
    for (const scene of value.document!.scenes) scene.image = { id: randomUUID(), trustPolicy: 'storyboard-private-asset-v1',
      original: variant, web: [variant], provenance: proof('image') };
    value.document!.scenes[1].image = null;
    value.document!.scenes[3].imageError = 'invalid_image_response';
    const f = fixture(value);
    expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('completed');
    expect(f.generated).toEqual(['scene 2', 'scene 4']); expect(f.draftCalls()).toBe(0);
  });
  test('manual text/local images and local text/manual images stay independent', async () => {
    const imported = savedJob(); imported.request.providers.text = { id: 'manual', model: '' };
    const a = fixture(imported);
    expect(await new OutboundStoryboardWorker(a).runOnce()).toBe('completed');
    expect(a.draftCalls()).toBe(0); expect(a.generated).toHaveLength(5);
    const local = job(); local.request.providers.image = { id: 'manual', model: '' };
    const b = fixture(local);
    expect(await new OutboundStoryboardWorker(b).runOnce()).toBe('completed');
    expect(b.draftCalls()).toBe(1); expect(b.generated).toEqual([]);
  });
  test('corrupt scene failure preserves other scenes and does not report completion', async () => {
    const f = fixture(); const generate = f.mlx.image;
    f.mlx.image = async (...args) => {
      if (args[1] === 'scene 2') throw new StoryboardProductionError('invalid_image_response');
      return generate(...args);
    };
    expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('failed');
    expect(f.calls.filter((call) => call.action === 'image').map((call) => call.sceneNo)).toEqual([1, 3, 4, 5]);
    expect(f.calls.at(-1)).toMatchObject({ action: 'finish', errorCode: 'invalid_image_response' });
  });
  test('provider authentication and invalid JSON fail without further model calls or fallback', async () => {
    for (const code of ['provider_auth_failed', 'invalid_structured_response']) {
      const f = fixture();
      f.mlx.draft = async () => { throw new StoryboardProductionError(code); };
      expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('failed');
      expect(f.generated).toEqual([]);
      expect(f.calls.at(-1)).toMatchObject({ action: 'finish', errorCode: code });
    }
  });
  test('heartbeat lease loss aborts model inference and never uploads or finishes', async () => {
    const f = fixture(); const call = f.api.operation;
    let beats = 0; let cancelled = false;
    f.api.operation = async (payload) => {
      if (payload.action === 'heartbeat' && payload.jobId && ++beats > 1) return { ok: true, leaseValid: false };
      return call(payload);
    };
    f.mlx.draft = async (_request, signal) => {
      await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => {
        cancelled = true; reject(new StoryboardProductionError('generation_cancelled'));
      }, { once: true }));
      throw new Error('unreachable');
    };
    expect(await new OutboundStoryboardWorker({ ...f, heartbeatMs: 5 }).runOnce()).toBe('lease_lost');
    expect(cancelled).toBe(true);
    expect(f.calls.some((c) => ['draft', 'image', 'finish'].includes(String(c.action)))).toBe(false);
  });
  test('shutdown stops a model that ignores abort before it can save a late result', async () => {
    const f = fixture(); const stop = new AbortController();
    f.mlx.draft = async () => { stop.abort(); return { draft: draft(), provenance: proof('text') }; };
    await expect(new OutboundStoryboardWorker(f).runOnce(stop.signal)).rejects.toThrow('worker_stopped');
    expect(f.calls.some((call) => call.action === 'draft' || call.action === 'finish')).toBe(false);
  });
  for (const stage of ['draft', 'image'] as const) {
    for (const lateResult of [false, true]) {
      test(`polling survives lease loss during ${stage}, late result=${lateResult}`, async () => {
        const first = stage === 'draft' ? job() : savedJob();
        const next = job(); next.request.providers.image = { id: 'manual', model: '' };
        const f = fixture(first); const call = f.api.operation;
        const queue = [first, next]; const stop = new AbortController();
        let generating = false; let aborted = false;
        f.api.operation = async (payload) => {
          if (payload.action === 'claim') {
            f.calls.push(payload); return { ok: true, job: queue.shift() ?? null };
          }
          if (payload.action === 'heartbeat' && payload.jobId === first.id && generating) {
            f.calls.push(payload); return { ok: true, leaseValid: false };
          }
          return call(payload);
        };
        const waitForCancellation = async (signal?: AbortSignal) => {
          generating = true;
          await new Promise<void>((resolve) => signal!.addEventListener('abort', () => {
            aborted = true; resolve();
          }, { once: true }));
          if (!lateResult) throw new StoryboardProductionError('generation_cancelled');
        };
        const generateDraft = f.mlx.draft;
        f.mlx.draft = async (request, signal) => {
          if (stage === 'draft' && request.requestId === first.request.requestId) await waitForCancellation(signal);
          return generateDraft(request, signal);
        };
        const generateImage = f.mlx.image;
        f.mlx.image = async (...args) => { await waitForCancellation(args[2]); return generateImage(...args); };
        const events: string[] = [];
        const worker = new OutboundStoryboardWorker({ ...f, heartbeatMs: 5, onEvent(event) {
          events.push(event.event);
          if (event.event === 'finished' && event.jobId === next.id) stop.abort();
        } });
        expect(await worker.run({ signal: stop.signal, pollMs: 1 })).toBe('completed');
        expect(aborted).toBe(true); expect(events).toContain('lease_lost');
        expect(f.calls.filter((c) => c.action === 'claim')).toHaveLength(2);
        expect(f.calls.filter((c) => c.jobId === first.id && ['draft', 'image', 'scene-error', 'finish'].includes(String(c.action))))
          .toEqual([]);
        expect(f.calls.filter((c) => c.jobId === next.id && c.action === 'finish')).toHaveLength(1);
      });
    }
  }
  for (const stage of ['draft', 'image', 'scene-error', 'finish'] as const) {
    test(`a rejected ${stage} checkpoint drops this lease and permits the next claim`, async () => {
      const first = job(); const next = job(); next.request.providers.image = { id: 'manual', model: '' };
      const f = fixture(first); const call = f.api.operation; const queue = [first, next];
      const stop = new AbortController();
      f.api.operation = async (payload) => {
        if (payload.action === 'claim') { f.calls.push(payload); return { ok: true, job: queue.shift() ?? null }; }
        if (payload.action === stage && payload.jobId === first.id) {
          f.calls.push(payload); throw new StoryboardWorkerApiError('worker_lease_lost');
        }
        return call(payload);
      };
      if (stage === 'image') f.api.image = async (lease, sceneNo) => {
        f.calls.push({ action: 'image', ...lease, sceneNo }); throw new StoryboardWorkerApiError('worker_lease_lost');
      };
      if (stage === 'scene-error') f.mlx.image = async () => ({ bytes: Buffer.from('corrupt'), provenance: proof('image') });
      const worker = new OutboundStoryboardWorker({ ...f, onEvent(event) {
        if (event.event === 'finished' && event.jobId === next.id) stop.abort();
      } });
      expect(await worker.run({ signal: stop.signal, pollMs: 1 })).toBe('completed');
      const checkpoints = f.calls.filter((c) => c.jobId === first.id && c.action !== 'heartbeat');
      expect(checkpoints.at(-1)?.action).toBe(stage);
      expect(checkpoints.filter((c) => c.action === stage)).toHaveLength(1);
      expect(f.calls.filter((c) => c.action === 'claim')).toHaveLength(2);
    });
  }
  test('cancellation while reporting a provider failure still permits the next job', async () => {
    const first = job(); const next = job(); next.request.providers.image = { id: 'manual', model: '' };
    const f = fixture(first); const call = f.api.operation; const generateDraft = f.mlx.draft;
    const queue = [first, next]; const stop = new AbortController();
    f.mlx.draft = async (request, signal) => {
      if (request.requestId === first.request.requestId) throw new StoryboardProductionError('provider_auth_failed');
      return generateDraft(request, signal);
    };
    f.api.operation = async (payload) => {
      if (payload.action === 'claim') { f.calls.push(payload); return { ok: true, job: queue.shift() ?? null }; }
      if (payload.action === 'finish' && payload.jobId === first.id) {
        f.calls.push(payload); throw new StoryboardWorkerApiError('worker_lease_lost');
      }
      return call(payload);
    };
    const worker = new OutboundStoryboardWorker({ ...f, onEvent(event) {
      if (event.event === 'finished' && event.jobId === next.id) stop.abort();
    } });
    expect(await worker.run({ signal: stop.signal, pollMs: 1 })).toBe('completed');
    expect(f.calls.filter((c) => c.jobId === first.id && c.action !== 'heartbeat')).toEqual([
      { action: 'finish', jobId: first.id, leaseToken: first.leaseToken, errorCode: 'provider_auth_failed' },
    ]);
    expect(f.calls.filter((c) => c.action === 'claim')).toHaveLength(2);
  });
  test('concurrent lease loss does not turn an uncertain image delivery into permission to keep polling', async () => {
    const f = fixture(); const call = f.api.operation;
    let uploading = false; let uploads = 0;
    f.api.operation = async (payload) => {
      if (payload.action === 'heartbeat' && payload.jobId && uploading) {
        f.calls.push(payload); return { ok: true, leaseValid: false };
      }
      return call(payload);
    };
    f.api.image = async (_lease, _sceneNo, _bytes, _proof, signal) => {
      uploads++; uploading = true;
      await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => {
        reject(new StoryboardWorkerApiError('worker_delivery_unknown'));
      }, { once: true }));
    };
    await expect(new OutboundStoryboardWorker({ ...f, heartbeatMs: 5 }).run({ pollMs: 1 })).rejects.toThrow('worker_delivery_unknown');
    expect(uploads).toBe(1); expect(f.generated).toEqual(['scene 1']);
    expect(f.calls.filter((c) => c.action === 'claim')).toHaveLength(1);
    expect(f.calls.some((c) => c.action === 'scene-error' || c.action === 'finish')).toBe(false);
  });
  test('uncertain checkpoint is not retried and does not trigger model regeneration', async () => {
    const f = fixture();
    f.api.image = async () => { throw new StoryboardWorkerApiError('worker_delivery_unknown'); };
    await expect(new OutboundStoryboardWorker(f).runOnce()).rejects.toThrow('worker_delivery_unknown');
    expect(f.generated).toEqual(['scene 1']);
    expect(f.calls.some((call) => call.action === 'finish' || call.action === 'scene-error')).toBe(false);
  });
  for (const stage of ['draft', 'image', 'scene-error', 'finish'] as const) {
    test(`an unclassified ${stage} delivery failure stops polling without another write or claim`, async () => {
      const f = fixture(); const call = f.api.operation;
      let attempts = 0;
      f.api.operation = async (payload) => {
        if (payload.action === stage) { attempts++; throw new Error('untrusted transport diagnostics'); }
        return call(payload);
      };
      if (stage === 'image') f.api.image = async () => { attempts++; throw new Error('untrusted transport diagnostics'); };
      if (stage === 'scene-error') f.mlx.image = async () => ({ bytes: Buffer.from('corrupt'), provenance: proof('image') });
      await expect(new OutboundStoryboardWorker(f).run({ pollMs: 1 })).rejects.toThrow('worker_delivery_unknown');
      expect(attempts).toBe(1);
      expect(f.calls.filter((c) => c.action === 'claim')).toHaveLength(1);
      expect(f.calls.some((c) => c.action === 'scene-error' || c.action === 'finish')).toBe(false);
      if (stage === 'image') expect(f.generated).toEqual(['scene 1']);
    });
  }
  test('concurrent runOnce calls are refused', async () => {
    const f = fixture(null); const worker = new OutboundStoryboardWorker(f);
    const first = worker.runOnce();
    await expect(worker.runOnce()).rejects.toThrow('worker_busy');
    expect(await first).toBe('idle');
  });
});

describe('worker credentials and actual HTTP boundaries', () => {
  test('decoded image validation isolates corrupt scenes before the actual multipart transport', async () => {
    const bytes = await fixturePixels; const truncated = bytes.subarray(0, Math.floor(bytes.length * 0.75));
    expect((await sharp(truncated).metadata()).format).toBe('png');
    const f = fixture(); const generate = f.mlx.image; const uploaded: number[] = [];
    f.mlx.image = async (...args) => {
      const result = await generate(...args);
      if (args[1] === 'scene 2') result.bytes = truncated;
      if (args[1] === 'scene 4') result.bytes = Buffer.from(Buffer.from('not image pixels').toString('base64'), 'base64');
      return result;
    };
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': String(req.headers['content-type']) } }).formData();
      uploaded.push(Number(form.get('sceneNo')));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
    });
    try {
      const api = new StoryboardWorkerTransport({ origin: await listen(server), token: randomBytes(32).toString('base64url') });
      f.api.image = api.image.bind(api);
      expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('failed');
      expect(uploaded).toEqual([1, 3, 5]);
      expect(f.generated).toEqual(['scene 1', 'scene 2', 'scene 3', 'scene 4', 'scene 5']);
      expect(f.calls.filter((c) => c.action === 'scene-error').map((c) => [c.sceneNo, c.errorCode]))
        .toEqual([[2, 'invalid_image'], [4, 'invalid_image']]);
      expect(f.calls.at(-1)).toMatchObject({ action: 'finish', errorCode: 'invalid_image' });
    } finally { await close(server); }
  });
  test('failed regeneration retains the old image and checkpoints the error consumed by an explicit retry', async () => {
    const value = savedJob(); value.kind = 'scene'; value.sceneNo = 3;
    const variant = { path: 'fixture', sha256: 'a'.repeat(64), mime: 'image/png' as const, width: 128, height: 72, bytes: 257 };
    for (const scene of value.document!.scenes) scene.image = { id: randomUUID(), trustPolicy: 'storyboard-private-asset-v1',
      original: variant, web: [variant], provenance: proof('image') };
    const original = structuredClone(value.document!); const f = fixture(value);
    const bytes = await fixturePixels;
    f.mlx.image = async () => ({ bytes: bytes.subarray(0, Math.floor(bytes.length * 0.75)), provenance: proof('image') });
    let uploads = 0;
    const server = createServer((req, res) => { uploads++; req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
    try {
      const transport = new StoryboardWorkerTransport({ origin: await listen(server), token: randomBytes(32).toString('base64url') });
      f.api.image = transport.image.bind(transport);
      expect(await new OutboundStoryboardWorker(f).runOnce()).toBe('failed');
      expect(uploads).toBe(0); expect(value.document).toEqual(original);
      const errors = f.calls.filter((c) => c.action === 'scene-error');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({ action: 'scene-error', jobId: value.id, leaseToken: value.leaseToken, sceneNo: 3, errorCode: 'invalid_image' });
      // The next claim carries the persisted scene error; SQL persistence itself is tested separately.
      const retryJob = structuredClone(value); retryJob.id = randomUUID(); retryJob.leaseToken = randomUUID();
      retryJob.kind = 'generate'; retryJob.sceneNo = null;
      retryJob.document!.scenes[2].imageError = String(errors[0].errorCode);
      const retry = fixture(retryJob); const upload = retry.api.image;
      retry.api.image = async (...args) => { await transport.image(...args); await upload(...args); };
      expect(await new OutboundStoryboardWorker(retry).runOnce()).toBe('completed');
      expect(retry.generated).toEqual(['scene 3']); expect(retry.draftCalls()).toBe(0);
      expect(retry.calls.filter((c) => c.action === 'image').map((c) => c.sceneNo)).toEqual([3]);
      expect(retryJob.document!.scenes.map((s) => s.image)).toEqual(original.scenes.map((s) => s.image));
      expect(uploads).toBe(1);
    } finally { await close(server); }
  });
  test('an uncertain actual image upload stops polling with no scene error, finish, or replay', async () => {
    const f = fixture(); let uploads = 0;
    const server = createServer(async (req) => {
      for await (const chunk of req) void chunk;
      uploads++; req.socket.destroy();
    });
    try {
      const transport = new StoryboardWorkerTransport({ origin: await listen(server), token: randomBytes(32).toString('base64url') });
      f.api.image = transport.image.bind(transport);
      await expect(new OutboundStoryboardWorker(f).run({ pollMs: 1 })).rejects.toThrow('worker_delivery_unknown');
      expect(uploads).toBe(1); expect(f.generated).toEqual(['scene 1']);
      expect(f.calls.filter((c) => c.action === 'claim')).toHaveLength(1);
      expect(f.calls.some((c) => c.action === 'scene-error' || c.action === 'finish')).toBe(false);
    } finally { await close(server); }
  });
  test('accepts only the exact app HTTPS origin or literal loopback origin', () => {
    for (const value of ['https://tzudong.app.attacker.test', 'https://other.test', 'http://localhost', 'http://tzudong.app',
      'https://tzudong.app:8443', 'http://127.0.0.1/proxy', 'http://user:pass@127.0.0.1', 'http://127.0.0.1?to=cloud']) {
      expect(() => validateStoryboardWorkerOrigin(value)).toThrow('invalid_worker_origin');
    }
    expect(validateStoryboardWorkerOrigin('https://tzudong.app').hostname).toBe('tzudong.app');
    expect(validateStoryboardWorkerOrigin('http://[::1]:8080').hostname).toBe('[::1]');
  });
  test('credential file checks owner-only permissions, canonical bytes and symlinks', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'storyboard-token-test-'));
    const file = path.join(dir, 'token'); const token = randomBytes(32).toString('base64url');
    try {
      await writeFile(file, `${token}\n`, { mode: 0o600 });
      expect(await readStoryboardWorkerToken(file)).toBe(token);
      await chmod(file, 0o644); await expect(readStoryboardWorkerToken(file)).rejects.toThrow('worker_token_file_invalid');
      await chmod(file, 0o600); await symlink(file, path.join(dir, 'link'));
      await expect(readStoryboardWorkerToken(path.join(dir, 'link'))).rejects.toThrow('worker_token_file_invalid');
      await writeFile(file, token + '='); await expect(readStoryboardWorkerToken(file)).rejects.toThrow('worker_token_file_invalid');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test('never follows redirects or retries authentication, rate limits and uncertain sends', async () => {
    let status = 302; let calls = 0;
    const server = createServer((req, res) => {
      calls++; req.resume();
      if (status === 0) return;
      res.writeHead(status, { Location: 'https://example.invalid/token', 'Content-Type': 'application/json' }); res.end('{}');
    });
    try {
      const transport = new StoryboardWorkerTransport({ origin: await listen(server), token: randomBytes(32).toString('base64url'), timeoutMs: 30 });
      for (const [code, error] of [[302, 'worker_redirect_refused'], [401, 'worker_unauthorized'], [429, 'worker_rate_limited'], [0, 'worker_delivery_unknown']] as const) {
        status = code; await expect(transport.operation({ action: 'claim' })).rejects.toThrow(error);
      }
      expect(calls).toBe(4);
    } finally { await close(server); }
  });
  test('real sockets carry auth only to the app and valid multipart pixels; MLX receives no token', async () => {
    const value = job(); const paths: string[] = []; const destinations: WorkerDestination[] = [];
    const token = randomBytes(32).toString('base64url');
    const image = await sharp({ create: { width: 128, height: 72, channels: 3, background: '#dddddd' } }).png().toBuffer();
    let uploads = 0; let authorizationLeak = false;
    const mlxServer = createServer((req, res) => {
      authorizationLeak ||= req.headers.authorization !== undefined;
      req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/health') res.end(JSON.stringify({ status: 'ok' }));
      else if (req.url === '/v1/models') res.end(JSON.stringify({ data: models }));
      else if (req.url === '/v1/chat/completions') res.end(JSON.stringify({ model: 'installed-text', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft()) } }] }));
      else res.end(JSON.stringify({ model: 'installed-image', data: [{ b64_json: image.toString('base64') }] }));
    });
    const appServer = createServer(async (req, res) => {
      paths.push(req.url!); expect(req.headers.authorization).toBe(`Bearer ${token}`);
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url?.endsWith('/images')) {
        const form = await new Response(bytes, { headers: { 'Content-Type': String(req.headers['content-type']) } }).formData();
        expect(form.get('jobId')).toBe(value.id); expect(form.get('leaseToken')).toBe(value.leaseToken);
        const file = form.get('file') as File;
        expect(file.type).toBe('image/png'); expect(Buffer.from(await file.arrayBuffer()).equals(image)).toBe(true);
        expect(JSON.parse(String(form.get('provenance'))).model).toBe('installed-image'); uploads++;
        res.end('{"ok":true}');
      } else {
        const body = JSON.parse(bytes.toString());
        res.end(JSON.stringify(body.action === 'claim' ? { ok: true, job: value }
          : body.action === 'heartbeat' ? { ok: true, leaseValid: true } : { ok: true }));
      }
    });
    try {
      const api = new StoryboardWorkerTransport({ origin: await listen(appServer), token, onDestination: (r) => destinations.push(r) });
      const mlx = new MlxStoryboardClient(new MlxTransport({ origin: await listen(mlxServer) }));
      expect(await new OutboundStoryboardWorker({ api, mlx }).runOnce()).toBe('completed');
      expect(uploads).toBe(5); expect(authorizationLeak).toBe(false);
      expect(paths.every((p) => ['/api/storyboard-worker', '/api/storyboard-worker/images'].includes(p))).toBe(true);
      expect(destinations.length).toBe(paths.length); expect(destinations.every((d) => d.host === '127.0.0.1' && d.connected)).toBe(true);
    } finally { await close(mlxServer); await close(appServer); }
  });
});
