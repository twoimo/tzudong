import { describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { MlxTransport, validateMlxOrigin, type MlxDestinationReceipt } from '../lib/admin/storyboard/mlx-transport';
import { decodeMlxImage, MlxStoryboardClient } from '../lib/admin/storyboard/mlx-client';
import { prepareStoryboardAsset, trustedStoryboardAsset } from '../lib/admin/storyboard/production-assets';
import {
  STORYBOARD_WORKFLOW, assertStoryboardProviderPolicy, parseStoryboardDraft,
  storyboardProductionRequestSchema, type StoryboardProductionProvenance,
} from '../lib/admin/storyboard/production-contract';

const request = () => storyboardProductionRequestSchema.parse({
  workflow: STORYBOARD_WORKFLOW, requestId: randomUUID(), prompt: '지역 음식 문화 소개', sceneCount: 5,
  providers: { externalAI: false, text: { id: 'local-mlx', model: 'installed-text' }, image: { id: 'local-mlx', model: 'installed-image' } },
});
const draft = () => ({ title: '음식 문화', logline: '조리 과정과 식탁', scenes: Array.from({ length: 5 }, (_, index) => ({
  sceneNo: index + 1, title: `장면 ${index + 1}`, durationSec: 10, description: '재료를 준비하는 장면',
  visualDirection: '식탁 위 클로즈업', narration: '', caption: '', productionNotes: ['고정 촬영'],
  imagePrompt: 'A wooden table with fresh vegetables', sourceIds: [],
})) });
const proof = (): StoryboardProductionProvenance => ({ providerId: 'local-mlx', model: 'installed-image', verification: 'local-worker',
  generatedAt: new Date().toISOString(), requestId: randomUUID(), responseId: null, responseModel: null,
  modelEvidence: 'installed-catalog-and-request' });

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

describe('local storyboard contracts', () => {
  test('external providers require explicit consent independently of the other modality', () => {
    const policy = request().providers;
    for (const key of ['text', 'image'] as const) {
      expect(() => assertStoryboardProviderPolicy({ ...policy, [key]: { id: 'chatgpt-manual', model: '' } })).not.toThrow();
      expect(() => assertStoryboardProviderPolicy({ ...policy, [key]: { id: 'grok-manual', model: '' } })).not.toThrow();
      expect(() => assertStoryboardProviderPolicy({ ...policy, [key]: { id: 'openai-api', model: 'selected' } })).toThrow('external_ai_disabled');
      expect(() => assertStoryboardProviderPolicy({ ...policy, externalAI: true, [key]: { id: 'openai-api', model: 'selected' } })).not.toThrow();
    }
    expect(storyboardProductionRequestSchema.parse({ workflow: STORYBOARD_WORKFLOW, requestId: randomUUID(), prompt: '요청', sceneCount: 5 }).providers.externalAI).toBe(false);
  });
  test('allows mixed local MLX and manual ChatGPT/Grok providers without cloud AI', () => {
    const policy = request().providers;
    expect(() => assertStoryboardProviderPolicy({
      ...policy,
      text: { id: 'chatgpt-manual', model: '' },
      image: { id: 'local-mlx', model: 'installed-image' },
    })).not.toThrow();
    expect(() => assertStoryboardProviderPolicy({
      ...policy,
      text: { id: 'local-mlx', model: 'installed-text' },
      image: { id: 'grok-manual', model: '' },
    })).not.toThrow();
    expect(() => assertStoryboardProviderPolicy({
      ...policy,
      text: { id: 'openai-api', model: 'selected' },
      image: { id: 'local-mlx', model: 'installed-image' },
    })).toThrow('external_ai_disabled');
  });
  test('rejects missing models and scene count bounds', () => {
    expect(() => assertStoryboardProviderPolicy({ ...request().providers, image: { id: 'local-mlx', model: '' } })).toThrow('model_not_selected');
    for (const sceneCount of [0, 4, 13, 5.5]) expect(storyboardProductionRequestSchema.safeParse({ ...request(), sceneCount }).success).toBe(false);
    for (const sceneCount of [5, 12]) expect(storyboardProductionRequestSchema.safeParse({ ...request(), sceneCount }).success).toBe(true);
  });
  test('validates structure, sequential scene numbers and source ownership', () => {
    expect(parseStoryboardDraft(draft(), request()).scenes).toHaveLength(5);
    const bad = draft(); bad.scenes[1].sceneNo = 1;
    expect(() => parseStoryboardDraft(bad, request())).toThrow('invalid_structured_response');
    expect(() => parseStoryboardDraft({ ...draft(), scenes: draft().scenes.slice(1) }, request())).toThrow('invalid_structured_response');
    const fakeSource = draft(); fakeSource.scenes[0].sourceIds = ['unknown'] as never;
    expect(() => parseStoryboardDraft(fakeSource, request())).toThrow('invalid_structured_response');
  });
  test('rejects oversized prompts and unsupported dimensions', () => {
    expect(storyboardProductionRequestSchema.safeParse({ ...request(), prompt: 'x'.repeat(8001) }).success).toBe(false);
    expect(storyboardProductionRequestSchema.safeParse({ ...request(), imageWidth: 1000 }).success).toBe(false);
  });
});

describe('loopback transport and real HTTP boundaries', () => {
  test('records the connected socket rather than an intended destination', async () => {
    const receipts: MlxDestinationReceipt[] = [];
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}');
    });
    const origin = await listen(server);
    try {
      const transport = new MlxTransport({ origin, onDestination: (receipt) => receipts.push(receipt) });
      await transport.request('/health');
      expect(receipts).toEqual([{
        method: 'GET', host: '127.0.0.1', port: new URL(origin).port, path: '/health',
        connected: true, remoteAddress: '127.0.0.1', remotePort: Number(new URL(origin).port),
      }]);
    } finally { await close(server); }
    receipts.length = 0;
    await expect(new MlxTransport({ origin, onDestination: (receipt) => receipts.push(receipt) })
      .request('/health')).rejects.toThrow('local_model_unavailable');
    expect(receipts).toEqual([]);
  });
  test('cancellation during request preparation cannot start inference', async () => {
    let calls = 0;
    const server = createServer((_req, res) => { calls++; res.end('{}'); });
    try {
      const controller = new AbortController();
      const transport = new MlxTransport({ origin: await listen(server) });
      const body = { toJSON() { controller.abort(); return {}; } };
      await expect(transport.request('/v1/chat/completions', body, controller.signal)).rejects.toThrow('generation_cancelled');
      expect(calls).toBe(0);
    } finally { await close(server); }
  });
  test('rejects DNS, credentials, proxy paths, remote IPs and redirect-shaped origins', () => {
    for (const value of ['https://127.0.0.1', 'http://localhost', 'http://127.0.0.1/path', 'http://127.0.0.1?url=x', 'http://user:pass@127.0.0.1', 'http://169.254.169.254', 'http://example.com']) {
      expect(() => validateMlxOrigin(value)).toThrow('invalid_local_endpoint');
    }
    expect(validateMlxOrigin('http://[::1]:11234').hostname).toBe('[::1]');
  });
  test('does not follow redirects or call a cloud host', async () => {
    let calls = 0;
    const server = createServer((_req, res) => { calls++; res.writeHead(302, { Location: 'https://api.openai.com/v1/models' }); res.end(); });
    try { const transport = new MlxTransport({ origin: await listen(server) }); await expect(transport.request('/health')).rejects.toThrow('provider_failed'); expect(calls).toBe(1); }
    finally { await close(server); }
  });
  test('maps authentication, permission, quota and temporary failures', async () => {
    let status = 401;
    const server = createServer((_req, res) => { res.writeHead(status); res.end(); });
    try {
      const transport = new MlxTransport({ origin: await listen(server) });
      for (const [code, error] of [[401, 'provider_auth_failed'], [403, 'provider_forbidden'], [429, 'provider_rate_limited'], [503, 'provider_failed']] as const) {
        status = code; await expect(transport.request('/health')).rejects.toThrow(error);
      }
    } finally { await close(server); }
  });
  test('limits streaming bytes and rejects non-JSON responses', async () => {
    let contentType = 'text/html';
    const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': contentType }); res.end('x'.repeat(600_000)); });
    try {
      const transport = new MlxTransport({ origin: await listen(server) });
      await expect(transport.request('/health')).rejects.toThrow('invalid_model_response');
      contentType = 'application/json'; await expect(transport.request('/health')).rejects.toThrow('model_response_too_large');
    } finally { await close(server); }
  });
  test('timeout and cancellation settle without waiting for a model response', async () => {
    const server = createServer(() => undefined);
    try {
      const origin = await listen(server);
      await expect(new MlxTransport({ origin, timeoutMs: 30 }).request('/health')).rejects.toThrow('model_timeout');
      const controller = new AbortController();
      const pending = new MlxTransport({ origin }).request('/health', undefined, controller.signal);
      controller.abort(); await expect(pending).rejects.toThrow('generation_cancelled');
    } finally { await close(server); }
  });
  test('missing catalog models cannot trigger generation or remote fallback', async () => {
    const paths: string[] = [];
    const server = createServer((req, res) => { paths.push(req.url!); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.url === '/health' ? { status: 'ok' } : { data: [] })); });
    try {
      const client = new MlxStoryboardClient(new MlxTransport({ origin: await listen(server) }));
      await expect(client.draft(request())).rejects.toThrow('model_not_installed');
      expect(paths).toEqual(['/health', '/v1/models']);
    } finally { await close(server); }
  });
  test('repairs a malformed draft once and records the actual response model', async () => {
    let generations = 0;
    const server = createServer((req, res) => {
      req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/health') res.end('{"status":"ok"}');
      else if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'installed-text', owned_by: 'mlx-serve', capabilities: ['chat'], bytes_on_disk: 100 }] }));
      else { generations++; res.end(JSON.stringify({ id: 'response-test', model: 'installed-text', choices: [{ finish_reason: 'stop', message: { content: generations === 1 ? '{}' : JSON.stringify(draft()) } }] })); }
    });
    try {
      const client = new MlxStoryboardClient(new MlxTransport({ origin: await listen(server) }));
      const result = await client.draft(request()); expect(generations).toBe(2); expect(result.provenance.modelEvidence).toBe('response'); expect(result.draft.scenes).toHaveLength(5);
    } finally { await close(server); }
  });
});

describe('provider-neutral private images', () => {
  test('preserves decoded original and produces verified WebP derivatives', async () => {
    const bytes = await sharp({ create: { width: 1024, height: 576, channels: 3, background: '#446677' } }).png().toBuffer();
    const projectId = randomUUID(); const result = await prepareStoryboardAsset(bytes, projectId, proof());
    expect(result.files[0].bytes.equals(bytes)).toBe(true);
    expect(result.asset.web.map((item) => item.width)).toEqual([480, 960, 1024]);
    for (const file of result.files.slice(1)) expect((await sharp(file.bytes).metadata()).format).toBe('webp');
    expect(trustedStoryboardAsset(result.asset, projectId)?.id).toBe(result.asset.id);
    expect(trustedStoryboardAsset(result.asset, randomUUID())).toBeNull();
    const forged = structuredClone(result.asset); forged.web[0].path = `${projectId}/${forged.id}/../evil.webp`;
    expect(trustedStoryboardAsset(forged, projectId)).toBeNull();
  });
  test('accepts static PNG/JPEG/WebP and does not upscale small images', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const bytes = await sharp({ create: { width: 128, height: 72, channels: 3, background: '#dddddd' } })[format]().toBuffer();
      const result = await prepareStoryboardAsset(bytes, randomUUID(), proof());
      expect(result.asset.original.mime).toBe(`image/${format}`); expect(result.asset.web).toHaveLength(1); expect(result.asset.web[0].width).toBe(128);
    }
  });
  test('rejects corrupt pixels, non-images and image URLs', async () => {
    await expect(prepareStoryboardAsset(Buffer.from('<svg>' + ' '.repeat(100) + '</svg>'), randomUUID(), proof())).rejects.toThrow('invalid_image');
    const bytes = await sharp({ create: { width: 1024, height: 576, channels: 3, background: '#000000' } }).png().toBuffer();
    await expect(prepareStoryboardAsset(bytes.subarray(0, 80), randomUUID(), proof())).rejects.toThrow('invalid_image');
    expect(() => decodeMlxImage({ data: [{ url: 'https://example.com/image.png' }] })).toThrow('invalid_image_response');
    expect(() => decodeMlxImage({ data: [{ b64_json: 'A'.repeat(21) }] })).toThrow('invalid_image_response');
  });
});
